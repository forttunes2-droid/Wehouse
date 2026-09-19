-- Account > Help is one nested identity-wide entry point for Personal,
-- Service Provider and Property Partner workspaces. Routing is selected by
-- reason + linked record; free-form message text never decides authority.

create or replace function public.get_my_account_help_targets()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  return jsonb_build_object(
    'account',jsonb_build_object('subject_type','account','subject_id',v_actor,'label','My WeHouse account'),
    'worker_jobs',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','worker_job','subject_id',x.id::text,
        'context_type','worker_booking','label',coalesce(x.service_type,'Service job'),
        'detail',replace(coalesce(x.status,'job'),'_',' '),'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (
        select id,service_type,status,updated_at from public.worker_bookings
        where user_id=v_actor or worker_id=v_actor
        order by updated_at desc limit 50
      ) x
    ),'[]'::jsonb),
    'withdrawals',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','payout','subject_id',x.id::text,'context_type','contextual_help',
        'label','Withdrawal · ₦'||trim(to_char(x.amount,'FM999G999G999G990D00')),
        'detail',replace(coalesce(x.status,'withdrawal'),'_',' '),'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (
        select wd.id,wd.amount,wd.status,wd.updated_at
        from public.withdrawals wd
        join public.wallets w on w.id=wd.wallet_id
        where w.owner_id=v_actor
        order by wd.updated_at desc limit 50
      ) x
    ),'[]'::jsonb),
    'reservations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type',case when x.stay_type='short_let' then 'short_let' else 'long_let' end,
        'subject_id',x.id,'context_type','apartment_reservation',
        'label',coalesce(x.listing_title,case when x.stay_type='short_let' then 'Short Let' else 'Long Let' end),
        'detail',replace(coalesce(x.status,'reservation'),'_',' '),'stay_type',x.stay_type,'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (
        select id,listing_title,stay_type,status,updated_at from public.reservations
        where user_id=v_actor order by updated_at desc limit 50
      ) x
    ),'[]'::jsonb),
    'hotel_bookings',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','hotel','subject_id',x.booking_id::text,'context_type','hotel_booking',
        'label',coalesce(x.hotel_name,'Hotel stay'),'detail',replace(coalesce(x.status,'booking'),'_',' '),
        'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (
        select hb.booking_id,hb.status,hb.updated_at,h.name hotel_name
        from public.hotel_bookings hb
        join public.hotels h on h.hotel_id=hb.hotel_id
        where hb.user_id=v_actor order by hb.updated_at desc limit 50
      ) x
    ),'[]'::jsonb),
    'properties',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','listing','subject_id',x.listing_id,'context_type','property_listing',
        'label',coalesce(x.title,'Apartment'),'detail',replace(coalesce(x.status,'property'),'_',' '),
        'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (
        select l.listing_id,l.title,l.status,l.updated_at from public.listings l
        where coalesce(l.partner_id,l.owner_id)=v_actor
        order by l.updated_at desc limit 50
      ) x
    ),'[]'::jsonb),
    'hotels',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','hotel','subject_id',x.hotel_id::text,'context_type','hotel_property',
        'label',coalesce(x.name,'Hotel'),'detail',replace(coalesce(x.status,'hotel'),'_',' '),
        'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (
        select h.hotel_id,h.name,h.status,h.updated_at from public.hotels h
        where h.owner_id=v_actor order by h.updated_at desc limit 50
      ) x
    ),'[]'::jsonb)
  );
end
$$;

revoke all on function public.get_my_account_help_targets() from public,anon;
grant execute on function public.get_my_account_help_targets() to authenticated,service_role;

create or replace function public.send_my_first_contextual_help_message(
  p_draft_id uuid,
  p_reason_code text,
  p_subject_type text,
  p_subject_id text,
  p_summary text default null,
  p_snapshot jsonb default '{}'::jsonb,
  p_content text default '',
  p_attachments text[] default '{}'::text[],
  p_attachment_types text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','storage'
as $$
declare
  v_actor public.profiles;
  v_draft public.support_message_drafts;
  v_opened jsonb;
  v_conversation_id uuid;
  v_message_id uuid;
  v_snapshot jsonb;
  v_prefix text;
  v_path text;
  v_type text;
  v_index integer;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Active WeHouse account required'; end if;

  select * into v_draft from public.support_message_drafts
  where draft_id=p_draft_id for update;
  if v_draft.draft_id is null or v_draft.requester_id<>v_actor.user_id then
    raise exception 'Message draft was not found';
  end if;
  if v_draft.consumed_at is not null then
    return jsonb_build_object('conversation_id',v_draft.conversation_id,'message_id',v_draft.message_id,'replayed',true);
  end if;
  if v_draft.expires_at<=now() then raise exception 'Message draft expired'; end if;
  if nullif(btrim(coalesce(p_content,'')),'') is null and coalesce(cardinality(p_attachments),0)=0 then
    raise exception 'Message or attachment is required';
  end if;
  if nullif(btrim(coalesce(p_reason_code,'')),'') is null
     or nullif(btrim(coalesce(p_subject_type,'')),'') is null
     or nullif(btrim(coalesce(p_subject_id,'')),'') is null then
    raise exception 'Help reason and linked record are required';
  end if;
  if coalesce(cardinality(p_attachments),0)<>coalesce(cardinality(p_attachment_types),0) then
    raise exception 'Attachment metadata mismatch';
  end if;
  if coalesce(cardinality(p_attachments),0)>6 then raise exception 'A maximum of 6 evidence files can be sent at once'; end if;

  v_prefix:='drafts/'||v_actor.user_id||'/'||p_draft_id::text||'/';
  if coalesce(cardinality(p_attachments),0)>0 then
    for v_index in 1..cardinality(p_attachments) loop
      v_path:=p_attachments[v_index];
      v_type:=lower(coalesce(p_attachment_types[v_index],''));
      if v_path is null or left(v_path,length(v_prefix))<>v_prefix then
        raise exception 'Evidence path does not belong to this draft';
      end if;
      if v_type not in(
        'image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime',
        'application/pdf','text/plain','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) then raise exception 'Unsupported evidence file type'; end if;
      if not exists(select 1 from storage.objects o where o.bucket_id='support-files' and o.name=v_path) then
        raise exception 'Evidence upload is incomplete';
      end if;
    end loop;
  end if;

  v_snapshot:=coalesce(p_snapshot,'{}'::jsonb)
    -'booking_code'-'check_in_code'-'access_code'-'verification_code'-'handover_code'-'recovery_code';
  v_opened:=public.open_contextual_case_conversation(
    lower(btrim(p_reason_code)),lower(btrim(p_subject_type)),btrim(p_subject_id),
    nullif(btrim(coalesce(p_summary,'')),''),v_snapshot
  );
  v_conversation_id:=(v_opened->>'conversation_id')::uuid;
  if v_conversation_id is null then raise exception 'WeHouse request could not be created'; end if;

  v_message_id:=public.send_support_message(
    v_conversation_id,btrim(coalesce(p_content,'')),coalesce(p_attachments,'{}'::text[]),
    coalesce(p_attachment_types,'{}'::text[]),'message',
    jsonb_build_object('reason_code',lower(btrim(p_reason_code)),'subject_type',lower(btrim(p_subject_type)),
      'subject_id',btrim(p_subject_id),'context_snapshot',v_snapshot),'customer'
  );

  update public.support_message_drafts
  set conversation_id=v_conversation_id,message_id=v_message_id,consumed_at=now()
  where draft_id=p_draft_id;

  return jsonb_build_object('conversation_id',v_conversation_id,'message_id',v_message_id,'replayed',false,
    'operational_case_id',v_opened->>'operational_case_id','owning_domain',v_opened->>'owning_domain');
end
$$;

revoke all on function public.send_my_first_contextual_help_message(uuid,text,text,text,text,jsonb,text,text[],text[]) from public,anon;
grant execute on function public.send_my_first_contextual_help_message(uuid,text,text,text,text,jsonb,text,text[],text[]) to authenticated,service_role;
