begin;

-- The existing message store is the evidence authority; no second file registry.
create index partner_support_messages_attachment_lookup
 on public.partner_support_messages using gin(attachments)
 where attachments<>'{}'::text[];

create function private.support_file_can_cleanup(p_object_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare file storage.objects;
begin
 if auth.uid() is null or not public._property_document_session_active() then return false;end if;
 select * into file from storage.objects where id=p_object_id and bucket_id='support-files';
 if file.id is null or coalesce(file.owner_id,file.owner::text) is distinct from auth.uid()::text then return false;end if;
 return not exists(select 1 from public.partner_support_messages m
   where m.attachments<>'{}'::text[] and m.attachments @> array[file.name]);
end $$;
revoke all on function private.support_file_can_cleanup(uuid) from public,anon;
grant execute on function private.support_file_can_cleanup(uuid) to authenticated;

-- Cleanup remains possible after an unsent draft expires or a case closes.
-- Conversation membership and operational seniority are not file ownership.
drop policy support_files_delete on storage.objects;
create policy support_files_delete on storage.objects for delete to authenticated
 using(bucket_id='support-files' and private.support_file_can_cleanup(id));
create policy support_files_delete_boundary on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'support-files' or private.support_file_can_cleanup(id));
create policy support_files_read_own_unsent on storage.objects for select to authenticated
 using(bucket_id='support-files' and private.support_file_can_cleanup(id));
create policy support_files_read_live_session on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'support-files' or (select private.private_messaging_session_active()));
create policy support_files_no_client_replace on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'support-files') with check(bucket_id<>'support-files');

-- A real Storage delete can authorize in a rolled-back permission probe and
-- then mutate metadata as its service role. Recheck at the actual row mutation,
-- independently of RLS, before Storage commits metadata and cleans up bytes.
create function private.protect_support_sent_file() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.bucket_id='support-files' and exists(
   select 1 from public.partner_support_messages m
   where m.attachments<>'{}'::text[] and m.attachments @> array[old.name]
 ) then
  raise exception 'Sent Support attachments must be handled through the reviewed data-retention process' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
revoke all on function private.protect_support_sent_file() from public,anon,authenticated;
create trigger protect_support_sent_file_delete before delete on storage.objects
 for each row when(old.bucket_id='support-files') execute function private.protect_support_sent_file();
create trigger protect_support_sent_file_replace
 before update of name,bucket_id,owner,owner_id,metadata,version,user_metadata on storage.objects
 for each row when(old.bucket_id='support-files') execute function private.protect_support_sent_file();

-- Lock referenced object rows until message commit. Storage metadata removal
-- takes the conflicting row lock; its trigger then sees the committed reference.
-- This also prevents publishing a file which deletion has already removed.
create function private.guard_support_attachment_authority() returns trigger
language plpgsql security definer set search_path='' as $$
declare path text; file storage.objects; sender_auth text;
begin
 if tg_op='UPDATE' then
  if new.attachments is not distinct from old.attachments
     and new.attachment_types is not distinct from old.attachment_types then return new;end if;
  if coalesce(auth.jwt()->>'role',current_setting('request.jwt.claim.role',true),'')='authenticated' then
   raise exception 'Sent Support attachments require a reviewed correction or deletion' using errcode='42501';
  end if;
 end if;
 if coalesce(cardinality(new.attachments),0)=0 then return new;end if;
 if cardinality(new.attachments)>6 or array_ndims(new.attachments)<>1 or array_lower(new.attachments,1)<>1 then
  raise exception 'Chat attachment metadata mismatch' using errcode='22023';
 end if;
 select p.auth_id::text into sender_auth from public.profiles p where p.user_id=new.sender_id;
 if sender_auth is null then raise exception 'Support attachment sender is unavailable' using errcode='42501';end if;
 for path in select distinct item from unnest(new.attachments) item order by item loop
  select * into file from storage.objects where bucket_id='support-files' and name=path for key share;
  if file.id is null then raise exception 'Chat attachment upload is incomplete' using errcode='22023';end if;
  if coalesce(file.owner_id,file.owner::text) is distinct from sender_auth then
   raise exception 'Only your own uploaded files can be attached to a Support message' using errcode='42501';
  end if;
 end loop;
 return new;
end $$;
revoke all on function private.guard_support_attachment_authority() from public,anon,authenticated;
-- Existing MIME/path validation runs first, followed by this fresh ownership
-- and existence check. Neither trigger rewrites historical messages or files.
create trigger z_support_attachment_authority before insert or update of attachments,attachment_types
 on public.partner_support_messages for each row execute function private.guard_support_attachment_authority();

commit;
