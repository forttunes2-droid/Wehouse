-- Complete the public-gallery, location privacy, operations activity,
-- reservation queue and payout contracts agreed for WeHouse.

-- Reviewers receive both evidence sources from one authoritative response.
create or replace function public.get_inspection_media_for_review(p_inspection_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role in ('creator','admin','staff')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Operations review access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Property Operations access required';
  end if;

  select * into v_request
  from public.inspection_requests
  where id=p_inspection_id;
  if v_request is null then raise exception 'Inspection not found'; end if;
  if v_actor.role<>'creator'
     and not public.current_actor_in_scope(v_request.property_state,v_request.property_city) then
    raise exception 'Inspection is outside your assigned branch';
  end if;

  return jsonb_build_object(
    'partner_photos',coalesce(to_jsonb(v_request.photo_urls),'[]'::jsonb),
    'partner_videos',coalesce(to_jsonb(v_request.video_urls),'[]'::jsonb),
    'field_photos',coalesce(to_jsonb(v_request.field_photo_urls),'[]'::jsonb),
    'field_videos',coalesce(to_jsonb(v_request.field_video_urls),'[]'::jsonb),
    -- Compatibility aliases are deliberately Field Operations evidence only.
    'photos',coalesce(to_jsonb(v_request.field_photo_urls),'[]'::jsonb),
    'videos',coalesce(to_jsonb(v_request.field_video_urls),'[]'::jsonb),
    'report',v_request.notes,
    'status',v_request.status
  );
end;
$function$;

-- Operations Bookings is a reservation queue, never a property inventory.
create or replace function public.get_my_housing_operations()
returns table(
  listing_id text,listing_title text,listing_status text,property_type text,sub_type text,
  state text,lga text,address text,annual_rent numeric,current_reservation_id text,
  reservation_status text,customer_user_id text,customer_name text,customer_username text,
  reservation_fee_paid boolean,payment_status text,rental_plan_years integer,
  contract_rent_total numeric,upfront_rent_required numeric,installment_balance numeric,
  installment_count integer,rent_payment_status text,rent_paid_at timestamptz,
  hold_expires_at timestamptz,tenancy_start_date date,tenancy_end_date date,
  move_out_grace_until date,occupied_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare v_actor public.profiles;
begin
  select * into v_actor from public.profiles
  where auth_id=auth.uid()::text and role in ('staff','admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Housing operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations permission required';
  end if;

  return query
  select
    l.id::text,l.title,l.status,l.property_type,l.sub_type,l.state,l.city,l.address,l.price,
    r.id,r.status,r.user_id,coalesce(p.full_name,p.username,p.email),p.username,
    (coalesce(r.manual_payment_status,'unpaid') in ('paid','completed') and r.paid_at is not null),
    r.manual_payment_status,r.rental_plan_years,r.contract_rent_total,r.upfront_rent_required,
    r.installment_balance,r.installment_count,r.rent_payment_status,r.rent_paid_at,
    r.hold_expires_at,r.tenancy_start_date,r.tenancy_end_date,r.move_out_grace_until,l.occupied_at
  from public.reservations r
  join public.listings l on l.id::text=r.listing_id or l.listing_id=r.listing_id
  left join public.profiles p on p.user_id=r.user_id
  where coalesce(r.stay_type,'long_stay')='long_stay'
    and r.status not in ('cancelled','expired')
    and (v_actor.role='creator' or public.current_actor_in_scope(l.state,l.city))
  order by
    case r.status
      when 'payment_conflict' then 1 when 'ready_for_move_in' then 2
      when 'inspection_pending' then 3 when 'reserved' then 4
      when 'payment_pending' then 5 when 'occupied' then 6 else 7
    end,
    r.updated_at desc;
end;
$function$;
revoke all on function public.get_my_housing_operations() from public,anon;
grant execute on function public.get_my_housing_operations() to authenticated,service_role;

create or replace function public.admin_get_my_branch_worker_booking_summaries()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_actor public.profiles;v_result jsonb;
begin
  v_actor:=public._admin_dashboard_actor();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',wb.id,
    'conversation_id',wb.booking_conversation_id,
    'booking_code',wb.booking_code,
    'service_type',wb.service_type,
    'status',wb.status,
    'negotiated_amount',coalesce(wb.negotiated_amount,wb.agreed_amount,0),
    'scheduled_date',wb.scheduled_date,
    'created_at',wb.created_at,
    'updated_at',wb.updated_at,
    'worker_name',coalesce(w.full_name,w.username,'Worker'),
    'customer_name',coalesce(c.full_name,c.username,'Customer'),
    'needs_attention',(wb.status in ('completed_pending_approval','disputed') or exists(
      select 1 from public.booking_payments bp
      where bp.worker_booking_id=wb.id and bp.status='review_required'
    )),
    'has_dispute',wb.status='disputed',
    'payment_review_required',exists(
      select 1 from public.booking_payments bp
      where bp.worker_booking_id=wb.id and bp.status='review_required'
    )
  ) order by wb.updated_at desc),'[]'::jsonb) into v_result
  from public.worker_bookings wb
  join public.profiles w on w.user_id=wb.worker_id
  join public.profiles c on c.user_id=wb.user_id
  where v_actor.role='creator'
     or (
       lower(trim(coalesce(w.state,'')))=lower(trim(coalesce(v_actor.assigned_state,'')))
       and lower(trim(coalesce(nullif(w.local_government,''),nullif(w.city,''),'')))=lower(trim(coalesce(v_actor.assigned_lga,'')))
     );
  return v_result;
end;
$function$;
revoke all on function public.admin_get_my_branch_worker_booking_summaries() from public,anon;
grant execute on function public.admin_get_my_branch_worker_booking_summaries() to authenticated,service_role;

alter table public.notifications
  add column if not exists workspace_scope text not null default 'personal';

-- One actionable reservation event has one owner and one record destination.
create or replace function public.notify_reservation_operations_activity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_listing public.listings;
  v_recipient text;
  v_role text;
  v_title text;
  v_state_key text;
begin
  if coalesce(new.status,'') not in ('reserved','inspection_pending','ready_for_move_in','payment_conflict') then
    return new;
  end if;
  if new.status='reserved'
     and coalesce(new.manual_payment_status,'unpaid') not in ('paid','completed')
     and new.paid_at is null then
    return new;
  end if;
  select * into v_listing from public.listings l
  where l.id::text=new.listing_id or l.listing_id=new.listing_id limit 1;
  if v_listing.id is null then return new; end if;

  select c.assigned_staff_id into v_recipient
  from public.partner_support_conversations c
  where c.assigned_staff_id is not null
    and c.status not in ('resolved','closed')
    and (c.context_id=new.id::text or c.context_snapshot->>'reservation_id'=new.id::text)
  order by c.updated_at desc limit 1;

  if v_recipient is null then
    select p.user_id into v_recipient
    from public.profiles p
    join public.staff_permissions sp on sp.staff_id=p.user_id
      and sp.permission='operations' and sp.is_active
    where p.role='staff' and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
      and lower(btrim(coalesce(p.assigned_state,'')))=lower(btrim(coalesce(v_listing.state,'')))
      and lower(btrim(coalesce(p.assigned_lga,'')))=lower(btrim(coalesce(v_listing.city,'')))
    order by (
      select count(*) from public.partner_support_conversations c
      where c.assigned_staff_id=p.user_id and c.status not in ('resolved','closed')
    ),p.user_id limit 1;
  end if;
  if v_recipient is null then
    select p.user_id into v_recipient from public.profiles p
    where p.role='admin' and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
      and lower(btrim(coalesce(p.assigned_state,'')))=lower(btrim(coalesce(v_listing.state,'')))
      and lower(btrim(coalesce(p.assigned_lga,'')))=lower(btrim(coalesce(v_listing.city,'')))
    order by p.user_id limit 1;
  end if;
  if v_recipient is null then
    select p.user_id into v_recipient from public.profiles p
    where p.role='creator' and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
    order by p.user_id limit 1;
  end if;
  if v_recipient is null then return new; end if;

  select role into v_role from public.profiles where user_id=v_recipient;
  v_title:=case
    when new.status='reserved' then 'Paid reservation needs review'
    when new.status='inspection_pending' then 'Apartment inspection needs coordination'
    when new.status='ready_for_move_in' then 'Handover needs coordination'
    else 'Reservation payment needs review'
  end;
  v_state_key:=coalesce(new.status,'unknown')||':'||coalesce(new.rent_payment_status,'unknown');
  insert into public.notifications(
    recipient_id,type,title,message,read,related_id,source_type,source_id,
    destination_route,destination_params,event_key,workspace_scope,created_at
  ) values(
    v_recipient,'reservation_action_required',v_title,
    concat_ws(' · ',nullif(v_listing.title,''),nullif(new.booking_code,''),replace(new.status,'_',' ')),
    false,new.id::text,'reservation',new.id::text,'operations_bookings',
    jsonb_build_object('reservation_id',new.id,'listing_id',v_listing.id,'booking_code',new.booking_code,'status',new.status),
    'operations_reservation:'||new.id::text||':'||v_state_key,
    case when v_role in ('staff','admin','creator') then v_role else 'personal' end,
    now()
  ) on conflict (recipient_id,event_key) where event_key is not null do nothing;
  return new;
end;
$function$;
revoke all on function public.notify_reservation_operations_activity() from public,anon,authenticated;
grant execute on function public.notify_reservation_operations_activity() to service_role;

-- Remove fan-out rows created by the old trigger. Future lifecycle transitions
-- recreate one correctly owned activity item.
delete from public.notifications
where type='reservation_action_required' and destination_route='operations_inbox';

-- Participant Worker activity opens its conversation when one exists; staff
-- exception activity opens the exact Worker booking oversight record.
update public.notifications n
set destination_route=case
      when n.recipient_id in (wb.user_id,wb.worker_id) and wb.booking_conversation_id is not null then 'conversation'
      when n.recipient_id in (wb.user_id,wb.worker_id) then 'worker_dashboard'
      else 'operations_workers'
    end,
    destination_params=coalesce(n.destination_params,'{}'::jsonb)||jsonb_build_object(
      'booking_id',wb.id,
      'conversation_id',wb.booking_conversation_id,
      'worker_id',wb.worker_id
    ),
    workspace_scope=case
      when n.recipient_id in (wb.user_id,wb.worker_id) then 'personal'
      else coalesce((select p.role from public.profiles p where p.user_id=n.recipient_id),'personal')
    end
from public.worker_bookings wb
where n.source_type in ('worker_booking','service_booking')
  and n.source_id=wb.id::text;

-- Finance authority is explicit for both Staff and Admin. Creator keeps global
-- oversight but nobody may review their own withdrawal.
create or replace function public.finance_reviewer_is_authorized(p_reviewer_id text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
  select exists(
    select 1 from public.profiles p
    where p.user_id=p_reviewer_id
      and p.role in ('staff','admin','creator')
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and (
        p.role='creator'
        or exists(
          select 1 from public.staff_permissions sp
          where sp.staff_id=p.user_id and sp.permission='finance' and sp.is_active
        )
      )
  )
$function$;

create or replace function public.claim_withdrawal_for_payout(
  p_withdrawal_id uuid,p_reviewer_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_reviewer public.profiles;
  v_withdrawal public.withdrawals;
  v_wallet public.wallets;
  v_reference text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'Service role required';
  end if;
  if not public.finance_reviewer_is_authorized(p_reviewer_id) then
    raise exception 'Finance permission required';
  end if;
  select * into v_reviewer from public.profiles where user_id=p_reviewer_id;
  select * into v_withdrawal from public.withdrawals where id=p_withdrawal_id for update;
  if v_withdrawal.id is null then raise exception 'Withdrawal not found'; end if;
  select * into v_wallet from public.wallets where id=v_withdrawal.wallet_id for update;
  if v_wallet.id is null then raise exception 'Wallet not found'; end if;
  if v_wallet.owner_id=p_reviewer_id then raise exception 'You cannot review your own withdrawal'; end if;
  if v_reviewer.role in ('staff','admin')
     and not public.can_current_actor_read_profile_for(v_reviewer.user_id,v_wallet.owner_id) then
    raise exception 'Withdrawal is outside your branch';
  end if;
  if v_withdrawal.status='processing' and v_withdrawal.paystack_transfer_reference is not null then
    return jsonb_build_object(
      'success',true,'already_claimed',true,'withdrawal_id',v_withdrawal.id,
      'amount',v_withdrawal.amount,'recipient_code',v_withdrawal.payout_recipient_code,
      'reference',v_withdrawal.paystack_transfer_reference,'owner_type',v_wallet.owner_type
    );
  end if;
  if v_withdrawal.status<>'awaiting_review' then
    raise exception 'Withdrawal is not awaiting review';
  end if;
  if coalesce(v_wallet.frozen_balance,0)<v_withdrawal.amount then
    raise exception 'Reserved wallet balance is incomplete';
  end if;
  if nullif(btrim(coalesce(v_withdrawal.payout_recipient_code,'')),'') is null then
    raise exception 'Paystack recipient is missing';
  end if;
  v_reference:='WHP-'||replace(v_withdrawal.id::text,'-','');
  update public.withdrawals
  set status='processing',reviewed_by=p_reviewer_id,reviewed_at=now(),
      paystack_transfer_reference=v_reference,paystack_status='initiating',updated_at=now()
  where id=v_withdrawal.id;
  insert into public.financial_audit_logs(
    event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata
  ) values(
    'withdrawal_processing',p_reviewer_id,v_wallet.owner_id,v_withdrawal.amount,
    v_withdrawal.id::text,'withdrawal','Withdrawal approved for Paystack transfer',
    jsonb_build_object('paystack_reference',v_reference,'owner_type',v_wallet.owner_type)
  );
  return jsonb_build_object(
    'success',true,'already_claimed',false,'withdrawal_id',v_withdrawal.id,
    'amount',v_withdrawal.amount,'recipient_code',v_withdrawal.payout_recipient_code,
    'reference',v_reference,'owner_type',v_wallet.owner_type
  );
end;
$function$;

create or replace function public.get_withdrawal_payout_snapshot(
  p_withdrawal_id uuid,p_reviewer_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare v_reviewer public.profiles;v_withdrawal public.withdrawals;v_wallet public.wallets;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
  if not public.finance_reviewer_is_authorized(p_reviewer_id) then raise exception 'Finance permission required'; end if;
  select * into v_reviewer from public.profiles where user_id=p_reviewer_id;
  select * into v_withdrawal from public.withdrawals where id=p_withdrawal_id;
  select * into v_wallet from public.wallets where id=v_withdrawal.wallet_id;
  if v_reviewer.user_id is null or v_withdrawal.id is null or v_wallet.id is null then raise exception 'Payout record not found'; end if;
  if v_wallet.owner_id=p_reviewer_id then raise exception 'You cannot review your own withdrawal'; end if;
  if v_reviewer.role in ('staff','admin') and not public.can_current_actor_read_profile_for(v_reviewer.user_id,v_wallet.owner_id) then raise exception 'Withdrawal is outside your branch'; end if;
  return jsonb_build_object(
    'success',true,'withdrawal_id',v_withdrawal.id,'status',v_withdrawal.status,
    'amount',v_withdrawal.amount,'reference',v_withdrawal.paystack_transfer_reference,
    'transfer_code',v_withdrawal.paystack_transfer_code,'paystack_status',v_withdrawal.paystack_status
  );
end;
$function$;

create or replace function public.record_withdrawal_transfer_response(
  p_withdrawal_id uuid,p_transfer_code text,p_paystack_status text,p_response jsonb
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
  update public.withdrawals set
    paystack_transfer_code=coalesce(nullif(btrim(coalesce(p_transfer_code,'')),''),paystack_transfer_code),
    paystack_status=case
      when status in ('paid','failed','reversed') then paystack_status
      else nullif(lower(btrim(coalesce(p_paystack_status,''))),'')
    end,
    transfer_response=case
      when status in ('paid','failed','reversed') then transfer_response
      else coalesce(p_response,'{}'::jsonb)
    end,
    updated_at=now()
  where id=p_withdrawal_id and status in ('processing','paid','failed','reversed');
  if not found then raise exception 'Withdrawal transfer record not found'; end if;
  return true;
end;
$function$;

create or replace function public.return_reserved_withdrawal(
  p_withdrawal_id uuid,p_status text,p_reason text,p_event_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_withdrawal public.withdrawals;
  v_wallet public.wallets;
  v_event text;
  v_was_paid boolean:=false;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
  if p_status not in ('rejected','failed','reversed') then raise exception 'Invalid terminal payout status'; end if;
  select * into v_withdrawal from public.withdrawals where id=p_withdrawal_id for update;
  if v_withdrawal.id is null then raise exception 'Withdrawal not found'; end if;
  if v_withdrawal.status='paid' and p_status='reversed' then
    v_was_paid:=true;
  elsif v_withdrawal.status in ('paid','rejected','failed','reversed') then
    return jsonb_build_object('success',true,'already_finalized',true,'status',v_withdrawal.status);
  end if;

  select * into v_wallet from public.wallets where id=v_withdrawal.wallet_id for update;
  if v_wallet.id is null then raise exception 'Wallet not found'; end if;
  if not v_was_paid and coalesce(v_wallet.frozen_balance,0)<v_withdrawal.amount then
    raise exception 'Reserved wallet balance is incomplete';
  end if;
  if v_was_paid then
    update public.wallets set
      available_balance=coalesce(available_balance,0)+v_withdrawal.amount,
      total_withdrawn=greatest(0,coalesce(total_withdrawn,0)-v_withdrawal.amount),
      updated_at=now()
    where id=v_wallet.id returning * into v_wallet;
  else
    update public.wallets set
      available_balance=coalesce(available_balance,0)+v_withdrawal.amount,
      frozen_balance=frozen_balance-v_withdrawal.amount,updated_at=now()
    where id=v_wallet.id returning * into v_wallet;
  end if;
  update public.withdrawals set
    status=p_status,failed_reason=nullif(btrim(coalesce(p_reason,'')),''),
    paystack_status=case when p_status='reversed' then 'reversed' else paystack_status end,
    reversed_at=case when p_status='reversed' then now() else reversed_at end,
    finalized_at=now(),settlement_event_key=p_event_key,updated_at=now()
  where id=v_withdrawal.id;
  insert into public.wallet_transactions(
    user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata,created_at
  ) values(
    v_wallet.owner_id,'withdrawal_reversal',v_withdrawal.amount,v_wallet.available_balance,
    v_withdrawal.id::text,'withdrawal','Withdrawal funds returned to available balance',
    jsonb_build_object('status',p_status,'was_paid',v_was_paid,'reason',nullif(btrim(coalesce(p_reason,'')),''),'event_key',p_event_key),now()
  );
  v_event:=case p_status when 'rejected' then 'withdrawal_rejected' when 'reversed' then 'withdrawal_reversed' else 'withdrawal_failed' end;
  insert into public.financial_audit_logs(
    event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata
  ) values(
    v_event,null,v_wallet.owner_id,v_withdrawal.amount,v_withdrawal.id::text,'withdrawal',
    'Withdrawal did not complete; funds returned',
    jsonb_build_object('status',p_status,'was_paid',v_was_paid,'reason',nullif(btrim(coalesce(p_reason,'')),''),'event_key',p_event_key)
  );
  insert into public.notifications(
    recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key,workspace_scope
  ) values(
    v_wallet.owner_id,'withdrawal_'||p_status,
    case when p_status='rejected' then 'Withdrawal not approved' when p_status='reversed' then 'Withdrawal reversed' else 'Withdrawal failed' end,
    coalesce(nullif(btrim(coalesce(p_reason,'')),''),'The amount is available in your wallet again.'),
    v_withdrawal.id::text,'withdrawal',v_withdrawal.id::text,
    case when v_wallet.owner_type='worker' then 'worker_wallet' else 'partner_finance' end,
    jsonb_build_object('withdrawal_id',v_withdrawal.id),
    'withdrawal-final:'||v_withdrawal.id::text||':'||p_status,
    case when v_wallet.owner_type='worker' then 'worker' else 'property_partner' end
  ) on conflict do nothing;
  return jsonb_build_object('success',true,'status',p_status,'amount_returned',v_withdrawal.amount,'recovered_after_payment',v_was_paid);
end;
$function$;

create or replace function public.reject_withdrawal_for_payout(
  p_withdrawal_id uuid,p_reviewer_id text,p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare v_reviewer public.profiles;v_withdrawal public.withdrawals;v_wallet public.wallets;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
  if not public.finance_reviewer_is_authorized(p_reviewer_id) then raise exception 'Finance permission required'; end if;
  select * into v_reviewer from public.profiles where user_id=p_reviewer_id;
  select * into v_withdrawal from public.withdrawals where id=p_withdrawal_id for update;
  select * into v_wallet from public.wallets where id=v_withdrawal.wallet_id;
  if v_reviewer.user_id is null or v_withdrawal.id is null or v_wallet.id is null then raise exception 'Payout record not found'; end if;
  if v_wallet.owner_id=p_reviewer_id then raise exception 'You cannot review your own withdrawal'; end if;
  if v_reviewer.role in ('staff','admin') and not public.can_current_actor_read_profile_for(v_reviewer.user_id,v_wallet.owner_id) then raise exception 'Withdrawal is outside your branch'; end if;
  if v_withdrawal.status<>'awaiting_review' then raise exception 'Only a withdrawal awaiting review can be rejected'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'A rejection reason is required'; end if;
  update public.withdrawals set reviewed_by=p_reviewer_id,reviewed_at=now() where id=p_withdrawal_id;
  return public.return_reserved_withdrawal(p_withdrawal_id,'rejected',p_reason,'review-rejected:'||p_withdrawal_id::text);
end;
$function$;

create or replace function public.settle_withdrawal_transfer_event(
  p_reference text,p_transfer_code text,p_paystack_status text,p_reason text,
  p_event_key text,p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_withdrawal public.withdrawals;
  v_wallet public.wallets;
  v_status text:=lower(btrim(coalesce(p_paystack_status,'')));
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
  if v_status not in ('success','failed','reversed') then raise exception 'Unsupported Paystack transfer status'; end if;
  select * into v_withdrawal from public.withdrawals
  where paystack_transfer_reference=p_reference for update;
  if v_withdrawal.id is null then return jsonb_build_object('success',false,'error','Withdrawal not found'); end if;
  if v_withdrawal.status='paid' and v_status='reversed' then
    return public.return_reserved_withdrawal(v_withdrawal.id,'reversed',p_reason,p_event_key);
  end if;
  if v_withdrawal.status in ('paid','rejected','failed','reversed') then
    return jsonb_build_object('success',true,'already_finalized',true,'status',v_withdrawal.status);
  end if;
  if v_withdrawal.status<>'processing' then raise exception 'Withdrawal is not processing'; end if;
  update public.withdrawals set
    paystack_transfer_code=coalesce(nullif(btrim(coalesce(p_transfer_code,'')),''),paystack_transfer_code),
    paystack_status=v_status,transfer_response=coalesce(p_payload,'{}'::jsonb),updated_at=now()
  where id=v_withdrawal.id;
  if v_status in ('failed','reversed') then
    return public.return_reserved_withdrawal(v_withdrawal.id,v_status,p_reason,p_event_key);
  end if;
  select * into v_wallet from public.wallets where id=v_withdrawal.wallet_id for update;
  if v_wallet.id is null or coalesce(v_wallet.frozen_balance,0)<v_withdrawal.amount then
    raise exception 'Reserved wallet balance is incomplete';
  end if;
  update public.wallets set
    frozen_balance=frozen_balance-v_withdrawal.amount,
    total_withdrawn=coalesce(total_withdrawn,0)+v_withdrawal.amount,updated_at=now()
  where id=v_wallet.id;
  update public.withdrawals set
    status='paid',processed_at=now(),finalized_at=now(),
    settlement_event_key=p_event_key,updated_at=now()
  where id=v_withdrawal.id;
  insert into public.financial_audit_logs(
    event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata
  ) values(
    'withdrawal_paid',v_withdrawal.reviewed_by,v_wallet.owner_id,v_withdrawal.amount,
    v_withdrawal.id::text,'withdrawal','Paystack confirmed the withdrawal transfer',
    jsonb_build_object('paystack_reference',p_reference,'transfer_code',p_transfer_code,'event_key',p_event_key)
  );
  insert into public.notifications(
    recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key,workspace_scope
  ) values(
    v_wallet.owner_id,'withdrawal_paid','Withdrawal paid','Paystack confirmed that your withdrawal was paid.',
    v_withdrawal.id::text,'withdrawal',v_withdrawal.id::text,
    case when v_wallet.owner_type='worker' then 'worker_wallet' else 'partner_finance' end,
    jsonb_build_object('withdrawal_id',v_withdrawal.id),
    'withdrawal-final:'||v_withdrawal.id::text||':paid',
    case when v_wallet.owner_type='worker' then 'worker' else 'property_partner' end
  ) on conflict do nothing;
  return jsonb_build_object('success',true,'status','paid','amount',v_withdrawal.amount);
end;
$function$;

-- Admin and Staff finance queues require the same explicit permission. Patch
-- the established queue function without duplicating its large response shape.
do $block$
declare v_definition text;v_patched text;
begin
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_my_staff_finance_queue'
  limit 1;
  if v_definition is not null then
    v_patched:=replace(
      v_definition,
      $$if v_actor.role='staff' and not public.current_staff_has_permission('finance') then$$,
      $$if v_actor.role in ('staff','admin') and not exists(
        select 1 from public.staff_permissions sp
        where sp.staff_id=v_actor.user_id and sp.permission='finance' and sp.is_active
      ) then$$
    );
    if v_patched=v_definition then
      raise exception 'Finance queue permission guard could not be patched';
    end if;
    execute v_patched;
  end if;
end;
$block$;

revoke all on function public.finance_reviewer_is_authorized(text) from public,anon,authenticated;
revoke all on function public.claim_withdrawal_for_payout(uuid,text) from public,anon,authenticated;
revoke all on function public.get_withdrawal_payout_snapshot(uuid,text) from public,anon,authenticated;
revoke all on function public.record_withdrawal_transfer_response(uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.return_reserved_withdrawal(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.reject_withdrawal_for_payout(uuid,text,text) from public,anon,authenticated;
revoke all on function public.settle_withdrawal_transfer_event(text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.finance_reviewer_is_authorized(text) to service_role;
grant execute on function public.claim_withdrawal_for_payout(uuid,text) to service_role;
grant execute on function public.get_withdrawal_payout_snapshot(uuid,text) to service_role;
grant execute on function public.record_withdrawal_transfer_response(uuid,text,text,jsonb) to service_role;
grant execute on function public.return_reserved_withdrawal(uuid,text,text,text) to service_role;
grant execute on function public.reject_withdrawal_for_payout(uuid,text,text) to service_role;
grant execute on function public.settle_withdrawal_transfer_event(text,text,text,text,text,jsonb) to service_role;
revoke all on function public.get_inspection_media_for_review(uuid) from public,anon;
grant execute on function public.get_inspection_media_for_review(uuid) to authenticated,service_role;

-- Any inspection-backed hotel that bypassed deliberate gallery review is not
-- allowed to remain public. It returns to the prepared state for a real choice.
update public.hotels h
set status='draft',approved_by=null,approved_at=null,published_at=null,updated_at=now()
where h.inspection_request_id is not null
  and h.status='active'
  and exists(
    select 1 from public.inspection_requests ir
    where ir.id=h.inspection_request_id and ir.final_media_reviewed_at is null
  );
update public.inspection_requests ir
set status='completed',lifecycle_stage='listing_prepared',approved_by=null,
    approved_at=null,published_at=null,updated_at=now()
where ir.draft_hotel_id is not null
  and ir.final_media_reviewed_at is null
  and exists(
    select 1 from public.hotels h
    where h.hotel_id=ir.draft_hotel_id and h.status='draft'
  );

-- Canonical discovery reads never expose a private street address and expose
-- only coordinates rounded to an approximate neighbourhood.
create or replace function public.get_discoverable_homes()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
  select coalesce(jsonb_agg(
    (to_jsonb(l)-'address'-'gps_latitude'-'gps_longitude'-'location_accuracy_m')
    || jsonb_build_object(
      'address',null,
      'gps_latitude',case when l.gps_latitude is null then null else round(l.gps_latitude,2) end,
      'gps_longitude',case when l.gps_longitude is null then null else round(l.gps_longitude,2) end,
      'location_exact',false
    ) order by l.created_at desc
  ),'[]'::jsonb)
  from public.listings l
  where l.deleted_at is null
    and coalesce(l.property_type,'apartment')<>'hotel'
    and (l.status='available' or (l.status='occupied' and l.sub_type='short_let'))
$function$;

create or replace function public.get_public_listing_detail(p_listing_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_listing public.listings;
  v_actor public.profiles;
  v_exact boolean:=false;
begin
  select * into v_listing from public.listings l
  where (l.id::text=p_listing_id or l.listing_id=p_listing_id)
    and l.deleted_at is null
  limit 1;
  if v_listing.id is null then return null; end if;

  select * into v_actor from public.profiles
  where auth_id=auth.uid()::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is not null then
    v_exact:=v_listing.owner_id=v_actor.user_id
      or v_listing.partner_id=v_actor.user_id
      or v_actor.role='creator'
      or (v_actor.role='admin' and public.current_actor_in_scope(v_listing.state,v_listing.city))
      or (v_actor.role='staff' and public.current_staff_has_permission('operations')
          and public.current_actor_in_scope(v_listing.state,v_listing.city))
      or exists(
        select 1 from public.reservations r
        where r.user_id=v_actor.user_id
          and r.listing_id in (v_listing.id::text,v_listing.listing_id)
          and (r.paid_at is not null or r.manual_payment_status in ('paid','completed'))
          and r.status not in ('cancelled','expired')
      );
  end if;
  if not v_exact
     and not (v_listing.status='available'
       or (v_listing.status='occupied' and v_listing.sub_type='short_let')) then
    return null;
  end if;
  if v_exact then
    return to_jsonb(v_listing)||jsonb_build_object('location_exact',true);
  end if;
  return (to_jsonb(v_listing)-'address'-'gps_latitude'-'gps_longitude'-'location_accuracy_m')
    ||jsonb_build_object(
      'address',null,
      'gps_latitude',case when v_listing.gps_latitude is null then null else round(v_listing.gps_latitude,2) end,
      'gps_longitude',case when v_listing.gps_longitude is null then null else round(v_listing.gps_longitude,2) end,
      'location_exact',false
    );
end;
$function$;

create or replace function public.get_discoverable_hotels()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
  select coalesce(jsonb_agg(
    (to_jsonb(h)-'address'-'gps_latitude'-'gps_longitude')
    ||jsonb_build_object(
      'address',null,
      'gps_latitude',case when h.gps_latitude is null then null else round(h.gps_latitude,2) end,
      'gps_longitude',case when h.gps_longitude is null then null else round(h.gps_longitude,2) end,
      'location_exact',false,
      'hotel_rooms',coalesce((
        select jsonb_agg(jsonb_build_object(
          'room_id',r.room_id,'price_per_night',r.price_per_night,'room_type',r.room_type
        ) order by r.price_per_night)
        from public.hotel_rooms r where r.hotel_id=h.hotel_id
      ),'[]'::jsonb)
    ) order by h.featured desc,h.created_at desc
  ),'[]'::jsonb)
  from public.hotels h where h.status='active'
$function$;

create or replace function public.get_public_hotel_detail(p_hotel_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_hotel public.hotels;
  v_actor public.profiles;
  v_exact boolean:=false;
  v_rooms jsonb;
begin
  select * into v_hotel from public.hotels where hotel_id=p_hotel_id;
  if v_hotel.hotel_id is null then return null; end if;
  select * into v_actor from public.profiles
  where auth_id=auth.uid()::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is not null then
    v_exact:=v_hotel.owner_id=v_actor.user_id
      or exists(select 1 from public.hotel_team_members tm where tm.hotel_id=v_hotel.hotel_id and tm.member_user_id=v_actor.user_id and tm.status='active')
      or v_actor.role='creator'
      or (v_actor.role='admin' and public.current_actor_in_scope(v_hotel.state,v_hotel.city))
      or (v_actor.role='staff' and public.current_staff_has_permission('operations') and public.current_actor_in_scope(v_hotel.state,v_hotel.city))
      or exists(
        select 1 from public.hotel_bookings hb
        where hb.hotel_id=v_hotel.hotel_id and hb.user_id=v_actor.user_id
          and hb.payment_status='paid'
          and hb.status in ('confirmed','checked_in','checked_out','completed')
      );
  end if;
  if v_hotel.status<>'active' and not v_exact then return null; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.price_per_night),'[]'::jsonb)
  into v_rooms from public.hotel_rooms r where r.hotel_id=v_hotel.hotel_id;
  if v_exact then
    return to_jsonb(v_hotel)||jsonb_build_object('hotel_rooms',v_rooms,'location_exact',true);
  end if;
  return (to_jsonb(v_hotel)-'address'-'gps_latitude'-'gps_longitude')
    ||jsonb_build_object(
      'address',null,
      'gps_latitude',case when v_hotel.gps_latitude is null then null else round(v_hotel.gps_latitude,2) end,
      'gps_longitude',case when v_hotel.gps_longitude is null then null else round(v_hotel.gps_longitude,2) end,
      'hotel_rooms',v_rooms,
      'location_exact',false
    );
end;
$function$;

revoke all on function public.get_discoverable_homes() from public;
revoke all on function public.get_public_listing_detail(text) from public;
revoke all on function public.get_discoverable_hotels() from public;
revoke all on function public.get_public_hotel_detail(integer) from public;
grant execute on function public.get_discoverable_homes() to anon,authenticated,service_role;
grant execute on function public.get_public_listing_detail(text) to anon,authenticated,service_role;
grant execute on function public.get_discoverable_hotels() to anon,authenticated,service_role;
grant execute on function public.get_public_hotel_detail(integer) to anon,authenticated,service_role;

-- Inspection-backed commercial facts cannot be changed through direct client
-- table updates. Trusted preparation/lifecycle functions remain responsible.
create or replace function public.guard_reviewed_listing_commercial_facts()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $function$
begin
  if old.inspection_request_id is not null
     and current_user not in ('postgres','service_role')
     and (
       new.price is distinct from old.price or new.currency is distinct from old.currency
       or new.state is distinct from old.state or new.city is distinct from old.city
       or new.address is distinct from old.address
       or new.bedrooms is distinct from old.bedrooms or new.bathrooms is distinct from old.bathrooms
       or new.property_type is distinct from old.property_type or new.sub_type is distinct from old.sub_type
       or new.security_deposit_amount is distinct from old.security_deposit_amount
       or new.owner_id is distinct from old.owner_id or new.partner_id is distinct from old.partner_id
       or new.contact_phone is distinct from old.contact_phone
       or new.amenities is distinct from old.amenities
       or new.gps_latitude is distinct from old.gps_latitude
       or new.gps_longitude is distinct from old.gps_longitude
       or new.inspection_request_id is distinct from old.inspection_request_id
     ) then
    raise exception 'Verified commercial facts are read-only. Return the property for correction.';
  end if;
  return new;
end;
$function$;
drop trigger if exists guard_reviewed_listing_commercial_facts on public.listings;
create trigger guard_reviewed_listing_commercial_facts
before update on public.listings
for each row execute function public.guard_reviewed_listing_commercial_facts();

create or replace function public.guard_reviewed_hotel_commercial_facts()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $function$
begin
  if old.inspection_request_id is not null
     and current_user not in ('postgres','service_role')
     and (
       new.name is distinct from old.name or new.state is distinct from old.state
       or new.city is distinct from old.city or new.area is distinct from old.area
       or new.address is distinct from old.address or new.amenities is distinct from old.amenities
       or new.owner_id is distinct from old.owner_id
       or new.gps_latitude is distinct from old.gps_latitude
       or new.gps_longitude is distinct from old.gps_longitude
       or new.inspection_request_id is distinct from old.inspection_request_id
     ) then
    raise exception 'Verified hotel facts are read-only. Return the hotel for correction.';
  end if;
  return new;
end;
$function$;
drop trigger if exists guard_reviewed_hotel_commercial_facts on public.hotels;
create trigger guard_reviewed_hotel_commercial_facts
before update on public.hotels
for each row execute function public.guard_reviewed_hotel_commercial_facts();

create or replace function public.guard_reviewed_hotel_room_facts()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $function$
begin
  if exists(select 1 from public.hotels h where h.hotel_id=old.hotel_id and h.inspection_request_id is not null)
     and current_user not in ('postgres','service_role')
     and (
       new.hotel_id is distinct from old.hotel_id or new.room_type is distinct from old.room_type
       or new.description is distinct from old.description
       or new.price_per_night is distinct from old.price_per_night
       or new.max_guests is distinct from old.max_guests or new.bed_type is distinct from old.bed_type
       or new.amenities is distinct from old.amenities or new.total_rooms is distinct from old.total_rooms
       or new.images is distinct from old.images
     ) then
    raise exception 'Verified room facts are read-only. Return the hotel for correction.';
  end if;
  return new;
end;
$function$;
drop trigger if exists guard_reviewed_hotel_room_facts on public.hotel_rooms;
create trigger guard_reviewed_hotel_room_facts
before update on public.hotel_rooms
for each row execute function public.guard_reviewed_hotel_room_facts();

create or replace function public.partner_update_hotel_room(
  p_room_id integer,p_room_type text,p_description text,p_price_per_night integer,
  p_max_guests integer,p_bed_type text,p_total_rooms integer,
  p_amenities text[] default null,p_images text[] default null
)
returns public.hotel_rooms
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare v_room public.hotel_rooms;v_role text;
begin
  select * into v_room from public.hotel_rooms where room_id=p_room_id for update;
  if v_room is null then raise exception 'Room type not found'; end if;
  v_role:=public.current_actor_hotel_role(v_room.hotel_id);
  if v_role not in ('owner','manager') then raise exception 'Hotel owner or Manager access required'; end if;
  if exists(select 1 from public.hotels h where h.hotel_id=v_room.hotel_id and h.inspection_request_id is not null) then
    raise exception 'Verified room facts are locked. Submit a correction for WeHouse review.';
  end if;
  if nullif(btrim(p_room_type),'') is null or coalesce(p_price_per_night,0)<=0
     or coalesce(p_max_guests,0)<1 or coalesce(p_total_rooms,0)<0 then
    raise exception 'Valid room name, rate, capacity and quantity are required';
  end if;
  update public.hotel_rooms set
    room_type=btrim(p_room_type),description=nullif(btrim(coalesce(p_description,'')),''),
    price_per_night=p_price_per_night,max_guests=p_max_guests,
    bed_type=nullif(btrim(coalesce(p_bed_type,'')),''),total_rooms=p_total_rooms,
    amenities=coalesce(p_amenities,amenities),images=coalesce(p_images,images),updated_at=now()
  where room_id=p_room_id returning * into v_room;
  return v_room;
end;
$function$;

-- Property workflow activity also has one accountable owner. Field Operations
-- receives an assignment in the property record; it is not a broadcast inbox.
create or replace function public.notify_property_operations_activity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_stage text:=lower(coalesce(new.lifecycle_stage,''));
  v_title text;
  v_recipient text;
  v_role text;
begin
  if tg_op='INSERT'
     or (tg_op='UPDATE' and new.lifecycle_stage is not distinct from old.lifecycle_stage) then
    return new;
  end if;
  if v_stage not in ('access_review','inspection_ready','awaiting_review','listing_prepared') then
    return new;
  end if;
  v_title:=case v_stage
    when 'access_review' then 'Access evidence needs review'
    when 'inspection_ready' then 'Property needs a field assignment'
    when 'awaiting_review' then 'Field evidence needs review'
    else 'Listing is ready for publication review'
  end;

  if v_stage='listing_prepared' then
    select p.user_id into v_recipient from public.profiles p
    where p.role='admin' and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
      and lower(btrim(coalesce(p.assigned_state,'')))=lower(btrim(coalesce(new.property_state,'')))
      and lower(btrim(coalesce(p.assigned_lga,'')))=lower(btrim(coalesce(new.property_city,'')))
    order by p.user_id limit 1;
  else
    select c.assigned_staff_id into v_recipient
    from public.partner_support_conversations c
    where c.assigned_staff_id is not null and c.status not in ('resolved','closed')
      and (c.inspection_id=new.id or c.context_id=new.id::text)
    order by c.updated_at desc limit 1;
    if v_recipient is null then
      select p.user_id into v_recipient
      from public.profiles p join public.staff_permissions sp
        on sp.staff_id=p.user_id and sp.permission='operations' and sp.is_active
      where p.role='staff' and not coalesce(p.deleted,false)
        and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
        and lower(btrim(coalesce(p.assigned_state,'')))=lower(btrim(coalesce(new.property_state,'')))
        and lower(btrim(coalesce(p.assigned_lga,'')))=lower(btrim(coalesce(new.property_city,'')))
      order by (
        select count(*) from public.partner_support_conversations c
        where c.assigned_staff_id=p.user_id and c.status not in ('resolved','closed')
      ),p.user_id limit 1;
    end if;
  end if;
  if v_recipient is null then
    select p.user_id into v_recipient from public.profiles p
    where p.role='creator' and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
    order by p.user_id limit 1;
  end if;
  if v_recipient is null then return new; end if;
  select role into v_role from public.profiles where user_id=v_recipient;
  insert into public.notifications(
    recipient_id,type,title,message,read,related_id,source_type,source_id,
    destination_route,destination_params,event_key,workspace_scope,created_at
  ) values(
    v_recipient,'property_'||v_stage,v_title,
    concat_ws(' · ',nullif(new.property_address,''),nullif(new.request_code,'')),false,
    new.id::text,'inspection_request',new.id::text,'operations_properties',
    jsonb_build_object('inspection_id',new.id,'request_code',new.request_code),
    'operations_property:'||new.id::text||':'||v_stage,
    case when v_role in ('staff','admin','creator') then v_role else 'personal' end,
    now()
  ) on conflict (recipient_id,event_key) where event_key is not null do nothing;
  return new;
end;
$function$;
revoke all on function public.notify_property_operations_activity() from public,anon,authenticated;
grant execute on function public.notify_property_operations_activity() to service_role;

delete from public.notifications
where source_type='inspection_request'
  and destination_route='operations_properties'
  and type like 'property\_%' escape '\';
