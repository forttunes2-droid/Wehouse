-- Bridge the existing rich chat UI to canonical typed cases. Operational
-- ownership is stored on the case; the legacy conversation is only a message
-- transport while the unified Inbox is migrated incrementally.

alter table public.partner_support_conversations
  add column if not exists operational_case_id uuid
    references public.operational_cases(operational_case_id) on delete restrict,
  add column if not exists canonical_thread_id uuid
    references public.canonical_threads(thread_id) on delete restrict;
create unique index if not exists partner_support_operational_case_unique
  on public.partner_support_conversations(operational_case_id)
  where operational_case_id is not null;

alter table public.partner_support_conversations
  drop constraint if exists partner_support_conversations_channel_kind_check;
alter table public.partner_support_conversations
  add constraint partner_support_conversations_channel_kind_check check(
    channel_kind in(
      'reservation_operations','property_operations','field_operations',
      'worker_operations','finance_operations','security_operations',
      'support','support_case'
    )
  );
alter table public.partner_support_conversations
  drop constraint if exists partner_support_conversations_requester_role_check;
alter table public.partner_support_conversations
  add constraint partner_support_conversations_requester_role_check check(
    requester_role is null or requester_role in(
      'user','worker','property_partner','staff','admin','creator','hotel_staff'
    )
  );

create or replace function public.actor_can_open_case_for_subject(
  p_user_id text,p_subject_type text,p_subject_id text
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select
    (p_subject_type='account' and p_subject_id=p_user_id)
    or (p_subject_type='page' and p_subject_id in(
      'explore','bookings','inbox','account','privacy','terms','security'
    ))
    or (p_subject_type='listing' and exists(
      select 1 from public.listings l
      where (l.id::text=p_subject_id or l.listing_id=p_subject_id)
        and l.deleted_at is null
        and (
          (l.status='available' and l.approved_at is not null)
          or p_user_id in(l.owner_id,l.partner_id)
        )
    ))
    or (p_subject_type in('long_let','short_let') and exists(
      select 1 from public.reservations r
      where r.id=p_subject_id and r.user_id=p_user_id
    ))
    or (p_subject_type='hotel' and exists(
      select 1 from public.hotel_bookings h
      where h.booking_id::text=p_subject_id and h.user_id=p_user_id
    ))
    or (p_subject_type='worker_job' and exists(
      select 1 from public.worker_bookings w
      where w.id::text=p_subject_id and p_user_id in(w.user_id,w.worker_id)
    ))
    or (p_subject_type='worker' and p_subject_id=p_user_id)
    or (p_subject_type='inspection' and (
      exists(select 1 from public.user_inspection_requests i
        where i.id::text=p_subject_id and i.user_id=p_user_id)
      or exists(select 1 from public.inspection_requests i
        where i.id::text=p_subject_id
          and p_user_id in(i.owner_id,i.partner_id::text))
    ))
    or (p_subject_type='conversation' and (
      exists(select 1 from public.conversations c
        where c.id::text=p_subject_id and p_user_id in(c.participant_a,c.participant_b))
      or exists(select 1 from public.booking_conversations c
        where c.id::text=p_subject_id and p_user_id in(c.user_id,c.worker_id))
      or exists(select 1 from public.hotel_booking_conversations c
        where c.id::text=p_subject_id and (
          c.guest_user_id=p_user_id or public.hotel_actor_has_capability(c.hotel_id,'stay.message')
        ))
    ))
    or (p_subject_type='shared_payment' and exists(
      select 1 from public.shared_payment_groups g
      left join public.shared_payment_members m
        on m.shared_payment_group_id=g.shared_payment_group_id
      where g.shared_payment_group_id::text=p_subject_id
        and p_user_id in(g.created_by,m.user_id)
    ))
    or (p_subject_type='payout' and (
      exists(select 1 from public.withdrawal_requests w
        where w.id::text=p_subject_id and w.user_id=p_user_id)
      or exists(select 1 from public.withdrawals w
        join public.wallets wallet on wallet.id=w.wallet_id
        where w.id::text=p_subject_id and wallet.owner_id=p_user_id)
      or exists(select 1 from public.payout_account_change_requests r
        where r.request_id::text=p_subject_id and r.user_id=p_user_id)
    ))
$$;

create or replace function public.open_contextual_case_conversation(
  p_reason_code text,p_subject_type text,p_subject_id text,
  p_summary text default null,p_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user text:=public.current_profile_user_id();
  v_profile public.profiles;
  v_case_id uuid;
  v_case public.operational_cases;
  v_reason public.case_reason_registry;
  v_conversation public.partner_support_conversations;
  v_thread public.canonical_threads;
  v_snapshot jsonb;
  v_title text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_profile from public.profiles where user_id=v_user;
  select * into v_reason from public.case_reason_registry
  where reason_code=p_reason_code and active;
  if v_reason.reason_code is null then raise exception 'Case reason is unavailable'; end if;

  v_case_id:=public.open_contextual_case(
    p_reason_code,p_subject_type,p_subject_id,p_summary
  );
  select * into v_case from public.operational_cases
  where operational_case_id=v_case_id;
  v_snapshot:=coalesce(p_snapshot,'{}'::jsonb)
    -'booking_code'-'check_in_code'-'access_code'-'verification_code'
    -'handover_code'-'recovery_code';
  v_snapshot:=v_snapshot||jsonb_build_object(
    'operational_case_id',v_case_id,'case_number',v_case.case_number,
    'reason_code',v_reason.reason_code,'reason_label',v_reason.label,
    'owning_domain',v_reason.owning_domain,'source_type',p_subject_type,
    'source_id',p_subject_id
  );
  v_title:=v_reason.label||coalesce(
    ' · '||nullif(btrim(coalesce(
      v_snapshot->>'listing_title',v_snapshot->>'hotel_name',
      v_snapshot->>'service_type',v_snapshot->>'property_name',''
    )),''),'');

  insert into public.canonical_threads(
    thread_type,subject_type,subject_id,state,created_at,updated_at
  ) values('case','operational_case',v_case_id::text,'open',now(),now())
  on conflict(thread_type,subject_type,subject_id) do update set
    state=case when canonical_threads.state='closed' then 'read_only'
      else canonical_threads.state end,
    updated_at=now()
  returning * into v_thread;
  insert into public.canonical_thread_participants(
    thread_id,user_id,participant_role,can_message,can_view_obligation
  ) values(v_thread.thread_id,v_user,'requester',true,true)
  on conflict(thread_id,user_id) do update set left_at=null,
    can_view_obligation=true;

  insert into public.partner_support_conversations(
    partner_id,requester_role,subject,status,category,context_type,context_id,
    context_snapshot,priority,channel_kind,case_number,
    operational_case_id,canonical_thread_id,created_at,updated_at
  ) values(
    v_user,v_profile.role,v_title,'open',v_reason.reason_code,
    'operational_case',p_subject_id,v_snapshot,v_case.priority,
    v_reason.owning_domain,'WHC-'||lpad(v_case.case_number::text,10,'0'),
    v_case_id,v_thread.thread_id,now(),now()
  ) on conflict(operational_case_id) where operational_case_id is not null
  do update set context_snapshot=excluded.context_snapshot,updated_at=now()
  returning * into v_conversation;

  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,attachments,
    attachment_types,action_type,action_metadata,is_read,visibility,created_at
  ) select
    v_conversation.id,v_user,'system',
    'Request created and routed to '||replace(v_reason.owning_domain,'_',' ')||'.',
    array[]::text[],array[]::text[],'request_received',
    jsonb_build_object('operational_case_id',v_case_id,
      'reason_code',v_reason.reason_code,'owning_domain',v_reason.owning_domain),
    false,'customer',now()
  where not exists(
    select 1 from public.partner_support_messages m
    where m.conversation_id=v_conversation.id and m.sender_role='system'
      and m.action_type='request_received'
      and m.action_metadata->>'operational_case_id'=v_case_id::text
  );

  insert into public.canonical_thread_items(
    thread_id,item_type,sender_user_id,body,payload,event_key
  ) values(
    v_thread.thread_id,'case_action',v_user,nullif(btrim(p_summary),''),
    jsonb_build_object(
      'action','opened','case_id',v_case_id,'case_number',v_case.case_number,
      'reason_code',v_reason.reason_code,'owning_domain',v_reason.owning_domain
    ),'case_action:opened:'||v_case_id
  ) on conflict(event_key) do nothing;

  insert into public.activity_events(
    event_key,event_type,subject_type,subject_id,actor_user_id,
    title,summary,route,route_params,occurred_at
  ) values(
    'case_opened:'||v_case_id,'case_opened','operational_case',v_case_id::text,
    v_user,v_reason.label,'WeHouse received your request.','inbox',
    jsonb_build_object('thread_id',v_thread.thread_id,
      'conversation_id',v_conversation.id),now()
  ) on conflict(event_key) do nothing;
  insert into public.activity_event_audiences(
    activity_event_id,recipient_user_id,workspace,domain,state_scope
  ) select e.activity_event_id,v_user,'personal',v_reason.owning_domain,v_case.state_scope
  from public.activity_events e where e.event_key='case_opened:'||v_case_id
  on conflict do nothing;

  return jsonb_build_object(
    'operational_case_id',v_case_id,'conversation_id',v_conversation.id,
    'canonical_thread_id',v_thread.thread_id,'case_number',v_conversation.case_number,
    'owning_domain',v_reason.owning_domain
  );
end
$$;

create or replace function public.mirror_operational_message_to_canonical_thread()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_thread uuid;
begin
  if new.visibility='internal' then return new; end if;
  select c.canonical_thread_id into v_thread
  from public.partner_support_conversations c
  where c.id=new.conversation_id;
  if v_thread is null then return new; end if;
  insert into public.canonical_thread_items(
    thread_id,item_type,sender_user_id,body,payload,event_key,created_at
  ) values(
    v_thread,
    case when new.action_type is not null then 'case_action'
      when nullif(btrim(coalesce(new.content,'')),'') is not null then 'message'
      else 'attachment' end,
    new.sender_id,nullif(btrim(coalesce(new.content,'')),''),
    jsonb_build_object(
      'legacy_message_id',new.id,'attachments',coalesce(new.attachments,array[]::text[]),
      'attachment_types',coalesce(new.attachment_types,array[]::text[]),
      'action_type',new.action_type,'action_metadata',coalesce(new.action_metadata,'{}'::jsonb)
    ),'operational_message:'||new.id,new.created_at
  ) on conflict(event_key) do nothing;
  update public.canonical_threads set updated_at=new.created_at
  where thread_id=v_thread;
  return new;
end
$$;
drop trigger if exists partner_support_message_canonical_mirror
  on public.partner_support_messages;
create trigger partner_support_message_canonical_mirror
after insert on public.partner_support_messages
for each row execute function public.mirror_operational_message_to_canonical_thread();

create or replace function public.support_inbox(p_queue text default 'support')
returns table(
  conversation_id uuid,requester_id text,requester_role text,
  requester_name text,requester_email text,requester_state text,
  requester_lga text,subject text,status text,category text,
  context_type text,context_id text,context_snapshot jsonb,priority text,
  assigned_staff_id text,assigned_staff_name text,last_message text,
  last_message_time timestamptz,unread_count bigint,created_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare actor public.profiles; v_queue text;
begin
  if p_queue not in(
    'all','operations','property_operations','reservation_operations',
    'field_operations','worker_operations','finance_operations',
    'security_operations','support'
  ) then raise exception 'Invalid communication context'; end if;
  select * into actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if actor.user_id is null then raise exception 'Authentication required'; end if;
  v_queue:=case when p_queue in(
    'operations','property_operations','reservation_operations'
  ) then 'property_operations' else p_queue end;
  if p_queue='all' and actor.role not in('creator','admin') then
    raise exception 'Creator or Admin access required'; end if;
  if p_queue<>'all' and actor.role not in('creator','admin')
    and not public.current_actor_has_workspace(v_queue,null) then
    raise exception 'This communication context is outside your work area';
  end if;

  return query
  select c.id,c.partner_id,coalesce(c.requester_role,p.role),
    coalesce(p.full_name,p.username,p.email),p.email,p.state,
    coalesce(nullif(p.local_government,''),p.city),c.subject,c.status,
    c.category,c.context_type,c.context_id,c.context_snapshot,c.priority,
    case when c.channel_kind='field_operations'
      then c.assigned_field_officer_id else c.assigned_staff_id end,
    coalesce(s.full_name,s.username),
    (select case when nullif(btrim(m.content),'') is not null then m.content
      when cardinality(m.attachments)>0 then 'Attachment' else '' end
      from public.partner_support_messages m where m.conversation_id=c.id
      and coalesce(m.visibility,'customer')<>'internal'
      order by m.created_at desc limit 1),
    (select m.created_at from public.partner_support_messages m
      where m.conversation_id=c.id and coalesce(m.visibility,'customer')<>'internal'
      order by m.created_at desc limit 1),
    (select count(*) from public.partner_support_messages m
      where m.conversation_id=c.id and not coalesce(m.is_read,false)
        and m.sender_id<>actor.user_id),c.created_at
  from public.partner_support_conversations c
  join public.profiles p on p.user_id=c.partner_id
  left join public.operational_cases oc
    on oc.operational_case_id=c.operational_case_id
  left join public.profiles s on s.user_id=case
    when c.channel_kind='field_operations' then c.assigned_field_officer_id
    else c.assigned_staff_id end
  where exists(select 1 from public.partner_support_messages m
    where m.conversation_id=c.id)
    and (
      p_queue='all' or
      case
        when c.channel_kind in('reservation_operations','property_operations')
          then 'property_operations'
        when c.channel_kind='support_case' then 'support'
        else c.channel_kind
      end=v_queue
    )
    and (
      actor.role='creator'
      or lower(btrim(coalesce(oc.state_scope,p.state,'')))
        =lower(btrim(coalesce(actor.assigned_state,actor.state,'')))
    )
  order by
    case when c.assigned_field_officer_id=actor.user_id
      or c.assigned_staff_id=actor.user_id then 0
      when c.assigned_staff_id is null then 1 else 2 end,
    c.updated_at desc;
end
$$;

revoke all on function public.actor_can_open_case_for_subject(text,text,text)
from public,anon;
revoke all on function public.open_contextual_case_conversation(
  text,text,text,text,jsonb
) from public,anon;
revoke all on function public.mirror_operational_message_to_canonical_thread()
from public,anon,authenticated;
revoke all on function public.support_inbox(text) from public,anon;
grant execute on function public.actor_can_open_case_for_subject(text,text,text)
to authenticated,service_role;
grant execute on function public.open_contextual_case_conversation(
  text,text,text,text,jsonb
) to authenticated,service_role;
grant execute on function public.mirror_operational_message_to_canonical_thread()
to service_role;
grant execute on function public.support_inbox(text)
to authenticated,service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select p.oid::regprocedure::text,p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  case when p.prorettype='trigger'::regtype then 'approved_service_only'
    else 'approved_client_rpc' end,
  case when p.prorettype='trigger'::regtype
    then 'Mirrors customer-visible case messages; direct execution denied'
    else 'Actor, typed subject, operational domain and state scope enforced' end,
  now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'actor_can_open_case_for_subject','open_contextual_case_conversation',
  'mirror_operational_message_to_canonical_thread','support_inbox'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,
  captured_at=excluded.captured_at;
