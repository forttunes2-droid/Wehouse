-- Repair production announcement writes, make the Worker onboarding fee optional,
-- and carry property assignment into customer inspection work and conversations.

insert into public.platform_settings(
  key,value,category,label,description,data_type,editable,is_active,created_at,updated_at
) values (
  'worker_verification_fee_enabled','true','worker','Charge onboarding fee',
  'Whether an unpaid Worker must complete the one-time onboarding payment before review.',
  'boolean',true,true,now(),now()
) on conflict (key) do nothing;

create or replace function public.creator_send_announcement(
  p_title text,
  p_content text,
  p_target_roles text[],
  p_recipient_ids text[] default null,
  p_scope_state text default null,
  p_scope_lga text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_actor public.profiles;
  v_id integer;
  v_count integer;
  v_roles text[];
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_actor.user_id is null or v_actor.role<>'creator' then raise exception 'Creator account required'; end if;
  if nullif(btrim(coalesce(p_title,'')),'') is null then raise exception 'Announcement title is required'; end if;
  if nullif(btrim(coalesce(p_content,'')),'') is null then raise exception 'Announcement content is required'; end if;
  select coalesce(array_agg(distinct role_name),'{}'::text[]) into v_roles
  from unnest(coalesce(p_target_roles,'{}'::text[])) role_name
  where role_name in ('user','worker','staff','property_partner','admin');
  if coalesce(array_length(v_roles,1),0)=0 then raise exception 'Select at least one recipient type'; end if;

  insert into public.announcements(
    title,content,sender_id,sender_name,sender_role,target_type,target_state,target_lga,
    recipient_count,read_count,created_at
  ) values (
    btrim(p_title),btrim(p_content),v_actor.user_id,
    coalesce(nullif(v_actor.full_name,''),nullif(v_actor.username,''),'WeHouse'),'creator',
    case when p_recipient_ids is null then 'all_users' else 'specific_user' end,
    nullif(btrim(coalesce(p_scope_state,'')),''),nullif(btrim(coalesce(p_scope_lga,'')),''),
    0,0,now()
  ) returning id into v_id;

  insert into public.announcement_recipients(announcement_id,user_id,read_status,delivered_at)
  select v_id,p.user_id,false,now()
  from public.profiles p
  where p.user_id<>v_actor.user_id
    and p.role=any(v_roles)
    and coalesce(p.deleted,false)=false
    and coalesce(p.suspended,false)=false
    and coalesce(p.banned,false)=false
    and (p_recipient_ids is null or p.user_id=any(p_recipient_ids))
    and (nullif(btrim(coalesce(p_scope_state,'')),'') is null
      or lower(btrim(coalesce(nullif(p.state,''),nullif(p.assigned_state,''),'')))=lower(btrim(p_scope_state)))
    and (nullif(btrim(coalesce(p_scope_lga,'')),'') is null
      or lower(btrim(coalesce(nullif(p.local_government,''),nullif(p.city,''),nullif(p.assigned_lga,''),'')))=lower(btrim(p_scope_lga)));
  get diagnostics v_count=row_count;
  if v_count=0 then
    delete from public.announcements where id=v_id;
    raise exception 'No users match the selected recipients';
  end if;
  update public.announcements set recipient_count=v_count where id=v_id;
  return jsonb_build_object('id',v_id,'recipient_count',v_count);
end;
$$;

create or replace function public.admin_send_branch_announcement(
  p_title text,
  p_content text,
  p_target_roles text[],
  p_recipient_ids text[] default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_actor public.profiles;
  v_id integer;
  v_count integer;
  v_roles text[];
begin
  v_actor:=public._admin_dashboard_actor();
  if v_actor.role<>'admin' then raise exception 'Admin account required'; end if;
  if nullif(btrim(coalesce(p_title,'')),'') is null then raise exception 'Announcement title is required'; end if;
  if nullif(btrim(coalesce(p_content,'')),'') is null then raise exception 'Announcement content is required'; end if;
  select coalesce(array_agg(distinct role_name),'{}'::text[]) into v_roles
  from unnest(coalesce(p_target_roles,'{}'::text[])) role_name
  where role_name in ('user','worker','staff','property_partner');
  if coalesce(array_length(v_roles,1),0)=0 then raise exception 'Select at least one recipient type'; end if;

  insert into public.announcements(
    title,content,sender_id,sender_name,sender_role,target_type,target_state,target_lga,
    recipient_count,read_count,created_at
  ) values (
    btrim(p_title),btrim(p_content),v_actor.user_id,
    coalesce(nullif(v_actor.full_name,''),nullif(v_actor.username,''),'WeHouse'),'admin',
    case when p_recipient_ids is null then 'all_users' else 'specific_user' end,
    v_actor.assigned_state,v_actor.assigned_lga,0,0,now()
  ) returning id into v_id;

  insert into public.announcement_recipients(announcement_id,user_id,read_status,delivered_at)
  select v_id,p.user_id,false,now()
  from public.profiles p
  where p.user_id<>v_actor.user_id
    and p.role=any(v_roles)
    and coalesce(p.deleted,false)=false
    and coalesce(p.suspended,false)=false
    and coalesce(p.banned,false)=false
    and case when p.role='staff'
      then lower(btrim(coalesce(p.assigned_state,'')))=lower(btrim(v_actor.assigned_state))
        and lower(btrim(coalesce(p.assigned_lga,'')))=lower(btrim(v_actor.assigned_lga))
      else lower(btrim(coalesce(p.state,'')))=lower(btrim(v_actor.assigned_state))
        and lower(btrim(coalesce(nullif(p.local_government,''),p.city,'')))=lower(btrim(v_actor.assigned_lga))
    end
    and (p_recipient_ids is null or p.user_id=any(p_recipient_ids));
  get diagnostics v_count=row_count;
  if v_count=0 then
    delete from public.announcements where id=v_id;
    raise exception 'No users in your branch match the selected recipients';
  end if;
  update public.announcements set recipient_count=v_count where id=v_id;
  return jsonb_build_object('id',v_id,'recipient_count',v_count);
end;
$$;

create or replace function public.get_my_worker_activation()
returns jsonb
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_payment public.booking_payments;
  v_identity public.worker_identity_checks;
  v_profile_ready boolean:=false;
  v_paid boolean:=false;
  v_payment_required boolean:=true;
  v_payment_complete boolean:=false;
  v_days integer:=public.worker_identity_recheck_days();
  v_identity_current boolean:=false;
  v_due_at timestamptz;
  v_days_remaining integer;
begin
  select * into v_profile from public.profiles where auth_id=auth.uid()::text and role='worker' limit 1;
  if v_profile is null then raise exception 'Worker profile not found'; end if;
  select coalesce(lower(btrim(value)) not in ('false','0','off','no'),true) into v_payment_required
  from public.platform_settings where key='worker_verification_fee_enabled' and coalesce(is_active,true) limit 1;
  v_payment_required:=coalesce(v_payment_required,true);
  v_profile_ready:=public.worker_professional_profile_ready(v_profile.user_id);
  select * into v_ver from public.worker_verifications where worker_id=v_profile.user_id order by created_at desc limit 1;
  select * into v_payment from public.booking_payments where user_id=v_profile.user_id and purpose='worker_verification' order by created_at desc limit 1;
  select * into v_identity from public.worker_identity_checks where worker_id=v_profile.user_id;
  v_paid:=coalesce(v_payment.status in ('paid','completed'),false);
  v_payment_complete:=v_paid or not v_payment_required;
  if v_identity.status='passed' and v_identity.captured_at is not null then
    v_due_at:=v_identity.captured_at+make_interval(days=>v_days);
    v_identity_current:=v_due_at>now();
    v_days_remaining:=greatest(0,ceil(extract(epoch from (v_due_at-now()))/86400.0)::integer);
  end if;
  return jsonb_build_object(
    'worker_status',coalesce(v_profile.worker_status,'pending'),
    'live',coalesce(v_profile.worker_status='verified' and v_profile.worker_verified and v_payment_complete and v_identity_current,false),
    'profile_complete',v_profile_ready,
    'payment_status',v_payment.status,
    'payment_required',v_payment_required,
    'payment_confirmed',v_payment_complete,
    'fee_waived',not v_payment_required and not v_paid,
    'gold_badge',v_paid,
    'identity_required',true,
    'identity_status',case when v_identity.status='passed' and not v_identity_current then 'expired' else coalesce(v_identity.status,'not_started') end,
    'identity_captured',coalesce(v_identity.status='passed',false),
    'identity_passed',v_identity_current,
    'identity_current',v_identity_current,
    'identity_captured_at',v_identity.captured_at,
    'identity_due_at',v_due_at,
    'identity_recheck_days',v_days,
    'identity_days_remaining',v_days_remaining,
    'test_passed',true,'test_percent',100,'test_attempts_24h',0,
    'evidence_saved',coalesce(nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is not null,false),
    'submitted',coalesce(v_profile.worker_status='profile_under_review' and v_ver.submitted_at is not null,false),
    'review_status',v_ver.status,
    'rejection_reason',(select rejection_reason from public.worker_verification_reviews where worker_id=v_profile.user_id order by created_at desc limit 1)
  );
end;
$$;

create or replace function public.create_worker_verification_payment()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_caller text;
  v_caller_role text;
  v_amount numeric;
  v_reference text;
  v_existing record;
  v_payment_required boolean:=true;
begin
  select user_id,role into v_caller,v_caller_role from public.profiles
  where auth_id=auth.uid()::text and coalesce(deleted,false)=false and coalesce(suspended,false)=false and coalesce(banned,false)=false;
  if v_caller is null then return jsonb_build_object('success',false,'error','Not authenticated'); end if;
  if v_caller_role<>'worker' then return jsonb_build_object('success',false,'error','Worker account required'); end if;
  if not public.worker_professional_profile_ready(v_caller) then return jsonb_build_object('success',false,'error','Complete your professional profile and service coverage before payment'); end if;
  select coalesce(lower(btrim(value)) not in ('false','0','off','no'),true) into v_payment_required
  from public.platform_settings where key='worker_verification_fee_enabled' and coalesce(is_active,true) limit 1;
  if not coalesce(v_payment_required,true) then return jsonb_build_object('success',false,'fee_waived',true,'error','Worker onboarding is currently free; no payment is required'); end if;
  select coalesce(nullif(value,'')::numeric,0) into v_amount from public.platform_settings where key='worker_verification_fee';
  if v_amount<=0 then return jsonb_build_object('success',false,'error','Verification fee not configured'); end if;
  update public.booking_payments set status='expired',updated_at=now() where user_id=v_caller and purpose='worker_verification' and status='pending' and created_at<now()-interval '30 minutes';
  select * into v_existing from public.booking_payments where user_id=v_caller and purpose='worker_verification' and status='pending' order by created_at desc limit 1;
  if v_existing is not null then
    if v_existing.amount_total=v_amount then return jsonb_build_object('success',true,'reference',v_existing.paystack_reference,'amount',v_amount,'existing',true); end if;
    update public.booking_payments set status='expired',updated_at=now() where id=v_existing.id;
  end if;
  v_reference:='WH-'||gen_random_uuid()::text;
  insert into public.booking_payments(payment_reference,user_id,payer_user_id,payee_user_id,type,booking_type,amount,amount_total,net_amount,amount_commission,currency,status,purpose,paystack_reference,metadata,created_at,updated_at)
  values(v_reference,v_caller,v_caller,v_caller,'worker_subscription','worker_subscription',v_amount,v_amount,v_amount,0,'NGN','pending','worker_verification',v_reference,jsonb_build_object('source','create_worker_verification_payment'),now(),now());
  return jsonb_build_object('success',true,'reference',v_reference,'amount',v_amount,'existing',false);
exception when unique_violation then
  select * into v_existing from public.booking_payments where user_id=v_caller and purpose='worker_verification' and status='pending' order by created_at desc limit 1;
  if v_existing is not null then return jsonb_build_object('success',true,'reference',v_existing.paystack_reference,'amount',v_existing.amount_total,'existing',true); end if;
  return jsonb_build_object('success',false,'error','Payment initialization race condition');
end;
$$;

create or replace function public.submit_my_worker_verification()
returns void
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_paid boolean:=false;
  v_payment_required boolean:=true;
begin
  select * into v_profile from public.profiles
  where auth_id=auth.uid()::text and role='worker' and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_profile is null then raise exception 'Active Worker account required'; end if;
  if not public.worker_professional_profile_ready(v_profile.user_id) then raise exception 'Complete your professional profile and service coverage first'; end if;
  if not public.worker_identity_is_current(v_profile.user_id) then raise exception 'Complete the current private WeHouse face check before submission'; end if;
  select coalesce(lower(btrim(value)) not in ('false','0','off','no'),true) into v_payment_required
  from public.platform_settings where key='worker_verification_fee_enabled' and coalesce(is_active,true) limit 1;
  select exists(select 1 from public.booking_payments where user_id=v_profile.user_id and purpose='worker_verification' and status in ('paid','completed')) into v_paid;
  if coalesce(v_payment_required,true) and not v_paid then raise exception 'Confirmed Paystack payment is required before submission'; end if;
  select * into v_ver from public.worker_verifications where worker_id=v_profile.user_id limit 1;
  if v_ver is null or nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is null then raise exception 'A work demonstration video is required before review'; end if;
  update public.worker_verifications set status='profile_under_review',submitted_at=now(),updated_at=now() where id=v_ver.id;
  update public.profiles set worker_status='profile_under_review',worker_verified=false,available=false,updated_at=now() where user_id=v_profile.user_id;
end;
$$;

create or replace function public._guard_worker_profile_state()
returns trigger
language plpgsql security definer set search_path to ''
as $$
declare
  v_becoming_verified boolean:=false;
  v_payment_required boolean:=true;
begin
  if new.role<>'worker' then return new; end if;
  if new.worker_status='approved_for_verification' then new.worker_status:='verification_paid';
  elsif new.worker_status='approved' then new.worker_status:='pending';
  elsif new.worker_status='declined' then new.worker_status:='rejected'; end if;
  v_becoming_verified:=new.worker_status='verified' and (tg_op='INSERT' or old.worker_status is distinct from 'verified' or old.worker_verified is distinct from true);
  select coalesce(lower(btrim(value)) not in ('false','0','off','no'),true) into v_payment_required
  from public.platform_settings where key='worker_verification_fee_enabled' and coalesce(is_active,true) limit 1;
  if v_becoming_verified and coalesce(v_payment_required,true) and not exists(
    select 1 from public.booking_payments payment where payment.user_id=new.user_id and payment.purpose='worker_verification' and payment.status in ('paid','completed')
  ) then raise exception 'Confirmed Worker onboarding payment is required before verification'; end if;
  new.worker_verified:=new.worker_status='verified';
  if new.worker_status<>'verified' or coalesce(new.deleted,false) or coalesce(new.suspended,false) or coalesce(new.banned,false) then new.available:=false; end if;
  return new;
end;
$$;

create or replace function public.create_user_inspection_request(p_reservation_id text,p_notes text default null)
returns public.user_inspection_requests
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_user_id text;
  v_res public.reservations;
  v_existing public.user_inspection_requests;
  v_created public.user_inspection_requests;
  v_listing public.listings;
  v_field_officer_id text;
begin
  select user_id into v_user_id from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_res from public.reservations where id=p_reservation_id and user_id=v_user_id for update;
  if v_res is null then raise exception 'Reservation not found'; end if;
  if v_res.manual_payment_status not in ('paid','completed') or v_res.paid_at is null then raise exception 'Complete the reservation before requesting inspection'; end if;
  if v_res.status not in ('reserved','inspection_pending') then raise exception 'Reservation is not eligible for inspection'; end if;
  select * into v_existing from public.user_inspection_requests where reservation_id=p_reservation_id and status in ('pending','scheduled','in_progress') order by created_at desc limit 1;
  if v_existing is not null then return v_existing; end if;
  select * into v_listing from public.listings where listing_id=v_res.listing_id or id::text=v_res.listing_id order by updated_at desc limit 1;
  if v_listing.id is null or v_listing.inspection_request_id is null then raise exception 'This property is missing its verified inspection assignment'; end if;
  select coalesce(assigned_field_officer_id,field_officer_id,assigned_to) into v_field_officer_id
  from public.inspection_requests where id=v_listing.inspection_request_id;
  if nullif(btrim(coalesce(v_field_officer_id,'')),'') is null then raise exception 'A Field Officer must be assigned to this property before an inspection can be requested'; end if;
  insert into public.user_inspection_requests(reservation_id,listing_id,user_id,field_officer_id,notes,status,created_at,updated_at)
  values(v_res.id,v_res.listing_id,v_user_id,v_field_officer_id,nullif(btrim(p_notes),''),'pending',now(),now()) returning * into v_created;
  update public.reservations set status='inspection_pending',inspection_requested_at=now(),updated_at=now() where id=v_res.id;
  insert into public.notifications(recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key,workspace_scope,read,created_at)
  values(v_field_officer_id,'inspection_requested','Customer inspection requested',coalesce(v_res.listing_title,'Apartment')||' is ready for a customer visit',v_created.id::text,'user_inspection',v_created.id::text,'staff_inspections',jsonb_build_object('id',v_created.id::text),'user_inspection_requested:'||v_created.id::text,'staff',false,now());
  return v_created;
end;
$$;

create or replace function public.create_support_conversation(
  p_subject text,
  p_category text default 'general',
  p_context_type text default 'general',
  p_context_id text default null,
  p_context_snapshot jsonb default '{}'::jsonb,
  p_priority text default 'normal'
) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_actor public.profiles;
  v_id uuid;
  v_context_type text:=coalesce(nullif(btrim(p_context_type),''),'general');
  v_context_id text:=nullif(btrim(p_context_id),'');
  v_subject text;
  v_field_officer_id text;
  v_channel_kind text:='support_case';
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_actor.user_id is null then raise exception 'Authentication required'; end if;
  if v_actor.role not in ('user','worker','property_partner') then raise exception 'WeHouse Help is available to User, Worker and Property Partner accounts'; end if;
  if coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then raise exception 'Account is not active'; end if;
  v_subject:=coalesce(nullif(btrim(p_subject),''),case when v_context_type in ('apartment_reservation','reservation','hotel_booking') then 'Reservation help' else 'WeHouse Help' end);
  if v_context_type='property_inspection' then
    if v_actor.role='user' then
      select field_officer_id into v_field_officer_id from public.user_inspection_requests
      where id::text=coalesce(v_context_id,nullif(p_context_snapshot->>'inspection_id','')) and user_id=v_actor.user_id limit 1;
    elsif v_actor.role='property_partner' then
      select coalesce(assigned_field_officer_id,field_officer_id,assigned_to) into v_field_officer_id
      from public.inspection_requests
      where id::text=coalesce(v_context_id,nullif(p_context_snapshot->>'inspection_id','')) and owner_id=v_actor.user_id limit 1;
    end if;
    if nullif(btrim(coalesce(v_field_officer_id,'')),'') is null then raise exception 'This inspection is not assigned to a Field Officer'; end if;
    v_channel_kind:='field_operations';
  end if;
  select id into v_id from public.partner_support_conversations
  where partner_id=v_actor.user_id and context_type=v_context_type and context_id is not distinct from v_context_id
  order by created_at desc limit 1;
  if v_id is null then
    insert into public.partner_support_conversations(
      partner_id,requester_role,subject,status,category,context_type,context_id,context_snapshot,priority,
      property_name,property_address,property_city,property_state,property_type,rental_mode,
      channel_kind,assigned_field_officer_id,created_at,updated_at
    ) values (
      v_actor.user_id,v_actor.role,v_subject,'open',coalesce(nullif(btrim(p_category),''),'general'),v_context_type,v_context_id,
      coalesce(p_context_snapshot,'{}'::jsonb),case when p_priority in ('low','normal','high','urgent') then p_priority else 'normal' end,
      nullif(p_context_snapshot->>'property_name',''),nullif(p_context_snapshot->>'property_address',''),
      coalesce(nullif(p_context_snapshot->>'city',''),nullif(v_actor.local_government,''),v_actor.city),v_actor.state,
      nullif(p_context_snapshot->>'property_type',''),nullif(p_context_snapshot->>'rental_mode',''),
      v_channel_kind,v_field_officer_id,now(),now()
    ) returning id into v_id;
  else
    update public.partner_support_conversations set
      requester_role=v_actor.role,status='open',subject=v_subject,
      category=coalesce(nullif(btrim(p_category),''),category,'general'),
      context_snapshot=case when coalesce(p_context_snapshot,'{}'::jsonb)<>'{}'::jsonb then p_context_snapshot else context_snapshot end,
      priority=case when p_priority in ('low','normal','high','urgent') then p_priority else priority end,
      channel_kind=v_channel_kind,assigned_field_officer_id=coalesce(v_field_officer_id,assigned_field_officer_id),
      updated_at=now(),resolved_at=null,closed_at=null
    where id=v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.support_inbox(p_queue text default 'support')
returns table(
  conversation_id uuid,requester_id text,requester_role text,requester_name text,requester_email text,
  requester_state text,requester_lga text,subject text,status text,category text,context_type text,context_id text,
  context_snapshot jsonb,priority text,assigned_staff_id text,assigned_staff_name text,last_message text,
  last_message_time timestamptz,unread_count bigint,created_at timestamptz
)
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare
  actor public.profiles;
  required_permission text;
begin
  if p_queue not in ('all','operations','property_operations','reservation_operations','field_operations','support') then raise exception 'Invalid communication context'; end if;
  select * into actor from public.profiles where auth_id=(select auth.uid())::text and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if actor.user_id is null then raise exception 'Authentication required'; end if;
  required_permission:=case when p_queue in ('operations','property_operations','reservation_operations') then 'operations' when p_queue='field_operations' then 'field_officer' when p_queue='support' then 'support' else null end;
  if p_queue='all' and actor.role not in ('creator','admin') then raise exception 'Creator or Admin access required'; end if;
  if p_queue<>'all' and actor.role not in ('creator','admin') and not(actor.role='staff' and public.current_staff_has_permission(required_permission)) then raise exception 'This communication context is outside your work area'; end if;
  return query
  select c.id,c.partner_id,coalesce(c.requester_role,p.role),coalesce(p.full_name,p.username,p.email),p.email,p.state,
    coalesce(nullif(p.local_government,''),p.city),c.subject,c.status,c.category,c.context_type,c.context_id,c.context_snapshot,c.priority,
    case when c.channel_kind='field_operations' then c.assigned_field_officer_id else c.assigned_staff_id end,
    coalesce(s.full_name,s.username),
    (select case when nullif(btrim(m.content),'') is not null then m.content when cardinality(m.attachments)>0 then 'Attachment' else '' end from public.partner_support_messages m where m.conversation_id=c.id order by m.created_at desc limit 1),
    (select m.created_at from public.partner_support_messages m where m.conversation_id=c.id order by m.created_at desc limit 1),
    (select count(*) from public.partner_support_messages m where m.conversation_id=c.id and not coalesce(m.is_read,false) and m.sender_id<>actor.user_id),c.created_at
  from public.partner_support_conversations c
  join public.profiles p on p.user_id=c.partner_id
  left join public.profiles s on s.user_id=case when c.channel_kind='field_operations' then c.assigned_field_officer_id else c.assigned_staff_id end
  where exists(select 1 from public.partner_support_messages m where m.conversation_id=c.id)
    and case p_queue when 'all' then true when 'operations' then c.channel_kind in ('property_operations','reservation_operations') when 'property_operations' then c.channel_kind='property_operations' when 'reservation_operations' then c.channel_kind='reservation_operations' when 'field_operations' then c.channel_kind='field_operations' else coalesce(c.channel_kind,'support_case')='support_case' end
    and (actor.role='creator' or (p_queue='field_operations' and c.assigned_field_officer_id=actor.user_id) or (lower(btrim(coalesce(p.state,'')))=lower(btrim(coalesce(actor.assigned_state,''))) and lower(btrim(coalesce(nullif(p.local_government,''),p.city,'')))=lower(btrim(coalesce(actor.assigned_lga,'')))))
    and (actor.role<>'staff' or (p_queue='field_operations' and c.assigned_field_officer_id=actor.user_id) or (p_queue<>'field_operations' and (c.assigned_staff_id is null or c.assigned_staff_id=actor.user_id)))
  order by case when c.assigned_field_officer_id=actor.user_id or c.assigned_staff_id=actor.user_id then 0 when c.assigned_staff_id is null then 1 else 2 end,c.updated_at desc;
end;
$$;

revoke all on function public.creator_send_announcement(text,text,text[],text[],text,text) from public,anon;
grant execute on function public.creator_send_announcement(text,text,text[],text[],text,text) to authenticated,service_role;
revoke all on function public.admin_send_branch_announcement(text,text,text[],text[]) from public,anon;
grant execute on function public.admin_send_branch_announcement(text,text,text[],text[]) to authenticated,service_role;
revoke all on function public.get_my_worker_activation() from public,anon;
grant execute on function public.get_my_worker_activation() to authenticated,service_role;
revoke all on function public.create_worker_verification_payment() from public,anon;
grant execute on function public.create_worker_verification_payment() to authenticated,service_role;
revoke all on function public.submit_my_worker_verification() from public,anon;
grant execute on function public.submit_my_worker_verification() to authenticated,service_role;
revoke all on function public.create_user_inspection_request(text,text) from public,anon;
grant execute on function public.create_user_inspection_request(text,text) to authenticated,service_role;
revoke all on function public.create_support_conversation(text,text,text,text,jsonb,text) from public,anon;
grant execute on function public.create_support_conversation(text,text,text,text,jsonb,text) to authenticated,service_role;
revoke all on function public.support_inbox(text) from public,anon;
grant execute on function public.support_inbox(text) to authenticated,service_role;

create or replace function public._valid_reaction(p_emoji text)
returns boolean
language sql immutable set search_path to ''
as $$
  select char_length(btrim(p_emoji)) between 1 and 8
    and btrim(p_emoji) !~ '[[:alnum:][:space:]]';
$$;

create or replace function public.set_private_message_reaction(
  p_conversation_kind text,p_conversation_id uuid,p_message_id uuid,p_emoji text
) returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare actor text:=public.current_profile_user_id();result jsonb;
begin
  if actor is null then raise exception 'Active WeHouse profile required'; end if;
  if nullif(btrim(coalesce(p_emoji,'')),'') is not null and not public._valid_reaction(p_emoji) then raise exception 'Choose a valid emoji reaction'; end if;
  if p_conversation_kind='roommate' then
    if not exists(select 1 from public.conversations c where c.id=p_conversation_id and actor in(c.participant_a,c.participant_b) and coalesce(c.status,'active')='active') then raise exception 'Conversation access denied'; end if;
    update public.messages set reactions=case when nullif(btrim(coalesce(p_emoji,'')),'') is null then coalesce(reactions,'{}'::jsonb)-actor else jsonb_set(coalesce(reactions,'{}'::jsonb),array[actor],to_jsonb(btrim(p_emoji)),true) end
    where id=p_message_id and conversation_id=p_conversation_id returning reactions into result;
  elsif p_conversation_kind='worker' then
    if not exists(select 1 from public.booking_conversations c where c.id=p_conversation_id and actor in(c.user_id,c.worker_id)) then raise exception 'Conversation access denied'; end if;
    update public.booking_messages set reactions=case when nullif(btrim(coalesce(p_emoji,'')),'') is null then coalesce(reactions,'{}'::jsonb)-actor else jsonb_set(coalesce(reactions,'{}'::jsonb),array[actor],to_jsonb(btrim(p_emoji)),true) end
    where id=p_message_id and conversation_id=p_conversation_id returning reactions into result;
  else raise exception 'Unsupported private conversation kind'; end if;
  if result is null then raise exception 'Message was not found'; end if;
  return result;
end;
$$;

create or replace function public.set_hotel_booking_message_reaction(
  p_conversation_id uuid,p_message_id uuid,p_emoji text
) returns jsonb
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare actor_id text;result jsonb;
begin
  select user_id into actor_id from public.profiles where auth_id=(select auth.uid())::text limit 1;
  if actor_id is null or not public.can_access_hotel_booking_conversation(p_conversation_id) then raise exception 'Hotel conversation access denied'; end if;
  if nullif(btrim(coalesce(p_emoji,'')),'') is not null and not public._valid_reaction(p_emoji) then raise exception 'Choose a valid emoji reaction'; end if;
  update public.hotel_booking_messages
  set reactions=case when nullif(btrim(coalesce(p_emoji,'')),'') is null then coalesce(reactions,'{}'::jsonb)-actor_id else jsonb_set(coalesce(reactions,'{}'::jsonb),array[actor_id],to_jsonb(btrim(p_emoji)),true) end
  where id=p_message_id and conversation_id=p_conversation_id returning reactions into result;
  if result is null then raise exception 'Message not found'; end if;
  return result;
end;
$$;

create or replace function public.set_my_worker_showcase_reaction(p_post_id uuid,p_emoji text)
returns jsonb
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles where auth_id=(select auth.uid())::text and role='user' and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if actor.user_id is null then raise exception 'Regular user account required'; end if;
  if not exists(select 1 from public.worker_showcase_posts where id=p_post_id and deleted_at is null and hidden_at is null) then raise exception 'Work post not found'; end if;
  if nullif(btrim(coalesce(p_emoji,'')),'') is null then
    delete from public.worker_showcase_reactions where post_id=p_post_id and user_id=actor.user_id;
  elsif public._valid_reaction(p_emoji) then
    insert into public.worker_showcase_reactions(post_id,user_id,emoji) values(p_post_id,actor.user_id,btrim(p_emoji))
    on conflict(post_id,user_id) do update set emoji=excluded.emoji,updated_at=now();
  else raise exception 'Choose a valid emoji reaction'; end if;
  return coalesce((select jsonb_object_agg(emoji,reaction_count) from (select emoji,count(*)::integer reaction_count from public.worker_showcase_reactions where post_id=p_post_id group by emoji) totals),'{}'::jsonb);
end;
$$;

revoke all on function public._valid_reaction(text) from public,anon,authenticated;
grant execute on function public._valid_reaction(text) to service_role;
revoke all on function public.set_private_message_reaction(text,uuid,uuid,text) from public,anon;
grant execute on function public.set_private_message_reaction(text,uuid,uuid,text) to authenticated,service_role;
revoke all on function public.set_hotel_booking_message_reaction(uuid,uuid,text) from public,anon;
grant execute on function public.set_hotel_booking_message_reaction(uuid,uuid,text) to authenticated,service_role;
revoke all on function public.set_my_worker_showcase_reaction(uuid,text) from public,anon;
grant execute on function public.set_my_worker_showcase_reaction(uuid,text) to authenticated,service_role;
