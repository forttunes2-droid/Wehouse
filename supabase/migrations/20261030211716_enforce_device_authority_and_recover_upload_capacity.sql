set local search_path='';
-- Trust is a server decision. Browser-visible IDs do not authenticate devices.
revoke all on public.user_sessions from public,anon,authenticated;
grant select on public.user_sessions to authenticated;
-- Remove column grants too, including grants inherited from an earlier release.
do $$declare c text;begin
 for c in select attname from pg_attribute where attrelid='public.user_sessions'::regclass and attnum>0 and not attisdropped loop
  execute format('revoke insert(%I),update(%I),references(%I) on public.user_sessions from anon,authenticated',c,c,c);
 end loop;
end $$;
drop policy if exists user_sessions_owner_insert on public.user_sessions;
drop policy if exists user_sessions_owner_update on public.user_sessions;
-- Reusing a readable label must not evict another active session either.
drop trigger if exists replace_active_device_session_before_insert on public.user_sessions;
drop index if exists public.user_sessions_one_active_device_idx;
-- Old browser-writable trust flags cannot serve as independent approval proof.
-- Preserve verified service-side email receipts; other active devices confirm
-- once again. This changes no account identity, stored chat key or KYC approval.
update public.user_sessions s set trust_status='pending',trust_reviewed_at=null,trust_reviewed_by_session_id=null
where s.is_active and s.trust_status='trusted' and not exists(
 select 1 from public.email_account_challenges c where c.device_session_id=s.id
 and c.auth_id::text=s.auth_id and c.auth_session_id::text=s.auth_session_id
 and c.purpose='device_confirmation' and c.status='consumed' and c.proof_verified_at is not null and c.cleanup_completed_at is not null
);
CREATE OR REPLACE FUNCTION public.register_current_device(p_device_id text, p_device text, p_os text, p_browser text, p_existing_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_auth_id text := (select auth.uid())::text;
  v_user_id text;
  v_auth_session_id text := nullif((select auth.jwt() ->> 'session_id'), '');
  v_row public.user_sessions%rowtype;
  v_status text;
  v_new_device boolean;
begin
  if v_auth_id is null or v_auth_session_id is null then
    raise exception 'Authentication session is required';
  end if;
  if p_device_id is null or length(trim(p_device_id)) < 16 or length(p_device_id) > 128 then
    raise exception 'A valid device identifier is required';
  end if;

  if not public.auth_session_is_active(v_auth_id::uuid, v_auth_session_id::uuid) then
    raise exception 'Sign in again to confirm this device';
  end if;

  v_user_id := public.current_profile_user_id();
  if v_user_id is null then raise exception 'WeHouse profile not found'; end if;

  perform pg_advisory_xact_lock(hashtextextended('device-registration:'||v_auth_id,0));

  select * into v_row
  from public.user_sessions
  where auth_session_id = v_auth_session_id
    and user_id = v_user_id
    and auth_id = v_auth_id
  limit 1;

  if found then
    update public.user_sessions
    set last_seen = now(),
        device_id = p_device_id,
        device = left(coalesce(nullif(trim(p_device), ''), 'Device'), 120),
        os = left(coalesce(nullif(trim(p_os), ''), 'Unknown'), 120),
        browser = left(coalesce(nullif(trim(p_browser), ''), 'Unknown'), 120)
    where id = v_row.id
    returning * into v_row;
    return jsonb_build_object(
      'session_id', v_row.id,
      'trust_status', v_row.trust_status,
      'new_device', false
    );
  end if;

  -- Device IDs and legacy row IDs are labels, never possession proofs. Every
  -- new Auth session uses verified email or an already trusted device approval.
  v_new_device := true;
  v_status := 'pending';

  insert into public.user_sessions(
    user_id, auth_id, device_id, auth_session_id, device, os, browser,
    is_active, is_current, last_seen, trust_status
  ) values (
    v_user_id, v_auth_id, p_device_id, v_auth_session_id,
    left(coalesce(nullif(trim(p_device), ''), 'Device'), 120),
    left(coalesce(nullif(trim(p_os), ''), 'Unknown'), 120),
    left(coalesce(nullif(trim(p_browser), ''), 'Unknown'), 120),
    true, true, now(), v_status
  ) returning * into v_row;

  if v_status = 'pending' then
    insert into public.notifications(
      recipient_id, type, title, message, related_id, source_type, source_id,
      destination_route, destination_params, event_key
    )
    select
      v_user_id,
      'new_device_login',
      'New device signed in',
      concat_ws(' · ', v_row.device, v_row.os, v_row.browser),
      v_row.id::text,
      'security',
      v_row.id::text,
      'security',
      jsonb_build_object(
        'session_id', v_row.id,
        'device', v_row.device,
        'os', v_row.os,
        'browser', v_row.browser,
        'login_time', v_row.login_time
      ),
      'new_device_login:' || v_row.id::text
    where not exists (
      select 1 from public.notifications
      where event_key = 'new_device_login:' || v_row.id::text
    );
  end if;

  return jsonb_build_object(
    'session_id', v_row.id,
    'trust_status', v_status,
    'new_device', v_new_device
  );
end;
$function$;

create or replace function public.register_current_device_v2(p_device_id text,p_device text,p_os text,p_browser text,p_location text default null,p_existing_session_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;location text:=left(coalesce(nullif(btrim(p_location),''),'Location unavailable'),120);
begin
 result:=public.register_current_device(p_device_id,p_device,p_os,p_browser,p_existing_session_id);
 if coalesce((result->>'new_device')::boolean,false) then
  update public.notifications set type='device_confirmation_pending',title='New device confirmation in progress',message=null,
   read=true,read_at=coalesce(read_at,now()),destination_route='security',
   destination_params=coalesce(destination_params,'{}'::jsonb)||jsonb_build_object('location',location,'decision','awaiting_email')
  where source_id=result->>'session_id' and recipient_id=public.current_profile_user_id() and type='new_device_login';
 end if;
 return result||jsonb_build_object('location',location);
end $$;

create function public.touch_current_device_session(p_session_id uuid,p_end boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare current_id uuid;changed boolean;
begin
 begin current_id:=nullif(auth.jwt()->>'session_id','')::uuid;exception when invalid_text_representation then return false;end;
 if auth.uid() is null or current_id is null or not public.auth_session_is_active(auth.uid(),current_id) then return false;end if;
 if p_end then
  update public.user_sessions set is_active=false,is_current=false,logout_time=coalesce(logout_time,clock_timestamp())
  where id=p_session_id and auth_id=auth.uid()::text and auth_session_id=current_id::text;
 else
  update public.user_sessions set last_seen=clock_timestamp()
  where id=p_session_id and auth_id=auth.uid()::text and auth_session_id=current_id::text and is_active;
 end if;
 changed:=found;return changed;
end $$;
revoke all on function public.touch_current_device_session(uuid,boolean) from public,anon,service_role;
grant execute on function public.touch_current_device_session(uuid,boolean) to authenticated;
-- The existing decision functions retain ownership/other-device checks and now
-- reject a removed Auth session before inspecting a still-active app row.
do $patch$declare definition text;signature text;anchor text:='begin';begin
 foreach signature in array array['public.respond_to_device_login(uuid,boolean)','public.review_new_device_login(uuid,boolean)','public.terminate_my_device_session(uuid)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('An active signed-in device is required' in definition)=0 and position('Authentication session is required' in definition)=0 then raise exception 'Inspect changed device decision function %',signature;end if;
  definition:=overlay(definition placing E'begin\n  if not public._property_document_session_active() then raise exception ''A live trusted session is required'' using errcode=''42501'';end if;' from position(anchor in definition) for length(anchor));
  execute definition;
 end loop;
end $patch$;

-- Session revocation gates fresh private-file reads and signed-link creation.
-- Already-issued signed URLs remain usable until their short expiry; downloaded
-- ciphertext cannot be recalled. Do not claim otherwise in the product.
create policy private_chat_files_require_live_session on storage.objects as restrictive for all to authenticated
 using(bucket_id not in('chat-files','property-host-chat-files') or (select private.private_messaging_session_active()))
 with check(bucket_id not in('chat-files','property-host-chat-files') or (select private.private_messaging_session_active()));

-- A final Storage metadata write and reservation reclaim share one transaction
-- lock. Permission probes may roll back; they do not consume or release space.
alter table private.media_upload_reservations drop constraint media_upload_reservations_state_check;
alter table private.media_upload_reservations add constraint media_upload_reservations_state_check check(state in('pending','completed','expired'));
create function private.reclaim_expired_media_uploads() returns integer
language plpgsql volatile security definer set search_path='' as $$
declare reclaimed integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('media-upload-reservation-budget',0));
 update private.media_upload_reservations r set state=case when exists(select 1 from storage.objects o
  where o.bucket_id=r.bucket_id and o.name=r.object_name and o.version is distinct from r.previous_version) then 'completed' else 'expired' end
 where r.state='pending' and r.expires_at<=clock_timestamp();
 get diagnostics reclaimed=row_count;return reclaimed;
end $$;
revoke all on function private.reclaim_expired_media_uploads() from public,anon,authenticated;
grant execute on function private.reclaim_expired_media_uploads() to service_role;

do $patch$
declare definition text;anchor text;
begin
 definition:=pg_get_functiondef('public.reserve_my_media_upload(text,text)'::regprocedure);
 anchor:=' select coalesce(file_size_limit,50000000) into cap';
 if position(anchor in definition)=0 then raise exception 'Inspect changed upload allocator';end if;
 definition:=replace(definition,anchor,E' perform private.reclaim_expired_media_uploads();\n select coalesce(file_size_limit,50000000) into cap');
 anchor:=' if found and ticket.state=''pending'' and ticket.previous_version is not distinct from old_version then';
 if position(anchor in definition)=0 then raise exception 'Inspect changed reservation renewal';end if;
 definition:=replace(definition,anchor,E' if found and ticket.state=''expired'' then raise exception ''This upload expired. Choose the file again to create a new upload path.'';end if;\n'||anchor);
 execute definition;
 definition:=pg_get_functiondef('private.storage_upload_within_budget(text,uuid,text,jsonb)'::regprocedure);
 if position('STABLE' in definition)=0 or position('select * into ticket' in definition)=0 then raise exception 'Inspect changed Storage reservation policy';end if;
 definition:=replace(definition,'STABLE','VOLATILE');
 definition:=replace(definition,' select * into ticket',E' perform pg_advisory_xact_lock(hashtextextended(''media-upload-reservation-budget'',0));\n select * into ticket');
 execute definition;
end $patch$;

-- Refresh the existing fail-closed reservation authority after adding the
-- restrictive live-session policy. Its signature still detects future drift.
do $authority$
declare permissive text; restrictive text; signature text; definition text;
begin
 select string_agg('('||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid)||')',' or ' order by polname)
 filter(where polpermissive),
 string_agg('('||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid)||')',' and ' order by polname)
 filter(where not polpermissive),
 md5(string_agg(polname||':'||polpermissive::text||':'||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid),E'\n' order by polname))
 into permissive,restrictive,signature
 from pg_catalog.pg_policy where polrelid='storage.objects'::regclass and polcmd in('a','*')
 and polname<>'wehouse_upload_budget_insert' and (polroles @> array[0::oid] or polroles @> array['authenticated'::regrole::oid]);
 if permissive is null then raise exception 'Storage upload authority is missing';end if;
 definition:=pg_catalog.format($fn$
 create or replace function private.can_reserve_storage_upload(p_bucket text,p_name text)
 returns boolean language plpgsql stable security definer set search_path='' as $body$
 declare current_signature text; permitted boolean;
 begin
 select md5(string_agg(polname||':'||polpermissive::text||':'||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid),E'\n' order by polname))
 into current_signature from pg_catalog.pg_policy
 where polrelid='storage.objects'::regclass and polcmd in('a','*') and polname<>'wehouse_upload_budget_insert'
 and (polroles @> array[0::oid] or polroles @> array['authenticated'::regrole::oid]);
 if current_signature is distinct from %L then raise exception 'Upload permissions need a configuration refresh. Contact support';end if;
 select coalesce(((%s) and (%s)),false) into permitted from
 (select p_bucket as bucket_id,p_name as name,auth.uid()::text as owner_id) objects;
 return permitted;
 end $body$;
 $fn$,signature,permissive,coalesce(restrictive,'true'));
 execute definition;
end $authority$;
revoke all on function private.can_reserve_storage_upload(text,text) from public,anon,authenticated;
