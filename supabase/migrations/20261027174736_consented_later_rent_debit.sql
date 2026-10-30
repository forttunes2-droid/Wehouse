-- Optional automatic collection reuses the canonical obligation and payment.
-- Authorization secrets never appear in exposed tables or customer receipts.
create table private.later_rent_debit (
 plan_id uuid primary key references public.rent_plans(id),
 customer_user_id text not null references public.profiles(user_id),
 consent_id uuid not null default gen_random_uuid(),
 agreement_digest text not null,
 source_reference text not null,
 status text not null check(status in('pending','active','disabled','needs_action')),
 authorization_code text,email text,last4 text,card_type text,environment text,
 expires_on date,accepted_at timestamptz not null default now(),
 payment_id uuid references public.booking_payments(id),split_started boolean not null default false,
 split_code text,split_lookup_page integer not null default 1,debit_attempted_at timestamptz,next_check_at timestamptz not null default now(),
 lease_until timestamptz,last_result text,updated_at timestamptz not null default now()
);
alter table private.later_rent_debit enable row level security;
revoke all on private.later_rent_debit from public,anon,authenticated,service_role;
create index later_rent_debit_due on private.later_rent_debit(next_check_at,plan_id) where status='active' or payment_id is not null;

-- Extract a private constructor without impersonating an Auth session. Only
-- the trusted customer wrapper and the guarded mandate job can call it.
do $core$
declare definition text;needle text;
begin
 definition:=replace(pg_get_functiondef('public.create_rent_plan_contribution_payment(uuid)'::regprocedure),chr(13),'');
 needle:='public.create_rent_plan_contribution_payment(p_contribution_id uuid)';
 if strpos(definition,needle)=0 then raise exception 'Inspect canonical rent constructor before private reuse';end if;
 definition:=replace(definition,needle,'private.create_later_rent_payment(p_contribution_id uuid, p_customer text)');
 needle:='actor:=private.require_long_let_customer(c.reservation_id);';
 if strpos(definition,needle)=0 then raise exception 'Inspect trusted tenant constructor guard';end if;
 definition:=replace(definition,needle,'actor:=p_customer; if actor is null or not exists(select 1 from public.profiles where user_id=actor and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)) then raise exception ''Active tenant required'';end if;');
 execute definition;
end $core$;
revoke all on function private.create_later_rent_payment(uuid,text) from public,anon,authenticated,service_role;
create or replace function public.create_rent_plan_contribution_payment(p_contribution_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare reservation text;actor text;
begin
 select reservation_id into reservation from public.rent_plan_contributions where id=p_contribution_id;
 actor:=private.require_long_let_customer(reservation);
 if exists(select 1 from private.later_rent_debit d join public.booking_payments p on p.id=d.payment_id
  where p.metadata->>'contribution_id'=p_contribution_id::text and p.status='pending') then
  raise exception 'An automatic payment is being confirmed. Check its status before paying manually';end if;
 return private.create_later_rent_payment(p_contribution_id,actor);
end $$;
revoke all on function public.create_rent_plan_contribution_payment(uuid) from public,anon,service_role;
grant execute on function public.create_rent_plan_contribution_payment(uuid) to authenticated;

create function public.get_my_later_rent_debit(p_reservation_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.require_long_let_customer(p_reservation_id);plan public.rent_plans;d private.later_rent_debit;
begin
 select * into plan from public.rent_plans where reservation_id=p_reservation_id and user_id=actor;
 if plan.id is null then raise exception 'Accepted rent plan unavailable';end if;
 select * into d from private.later_rent_debit where plan_id=plan.id;
 return jsonb_build_object('reservation_id',p_reservation_id,'status',coalesce(d.status,'manual'),'last4',d.last4,
  'card_type',d.card_type,'expires_on',d.expires_on,'payment_pending',d.payment_id is not null,'last_result',d.last_result,
  'source_reference',d.source_reference,'accepted_at',d.accepted_at);
end $$;
revoke all on function public.get_my_later_rent_debit(text) from public,anon,service_role;
grant execute on function public.get_my_later_rent_debit(text) to authenticated;

create function public.prepare_my_later_rent_debit(p_reservation_id text,p_agreement_digest text,p_accept boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.require_long_let_customer(p_reservation_id);plan public.rent_plans;p public.booking_payments;d private.later_rent_debit;
begin
 select * into plan from public.rent_plans where reservation_id=p_reservation_id and user_id=actor for update;
 perform private.assert_later_rent_consent(plan.id,p_agreement_digest);
 if p_accept is distinct from true or plan.status<>'active' or not private.later_rent_collection_enabled()
  or not exists(select 1 from public.reservations where id=p_reservation_id and status='occupied' and rent_payment_choice='monthly') then
  raise exception 'Explicit consent for the active later-year rent schedule is required';end if;
 select * into d from private.later_rent_debit where plan_id=plan.id for update;
 if d.payment_id is not null then raise exception 'Resolve the current payment before changing automatic debit';end if;
 if d.status in('pending','active') then
  return jsonb_build_object('consent_id',d.consent_id,'source_reference',d.source_reference,'agreement_digest',d.agreement_digest,'already_active',d.status='active');end if;
 select bp.* into p from public.booking_payments bp join public.reservations r on r.id=plan.reservation_id
  where bp.user_id=actor and bp.status in('paid','completed') and bp.verified_at is not null
   and ((bp.purpose='apartment_rent' and bp.paystack_reference=r.rent_payment_reference)
    or (bp.purpose='rent_plan_contribution' and bp.metadata->>'rent_plan_id'=plan.id::text))
  order by bp.paid_at desc,coalesce((bp.metadata->>'agreement_sequence')::integer,0) desc,bp.id desc limit 1;
 if p.id is null then raise exception 'A verified rent payment is required to check a reusable card';end if;
 insert into private.later_rent_debit(plan_id,customer_user_id,agreement_digest,source_reference,status)
 values(plan.id,actor,p_agreement_digest,p.paystack_reference,'pending')
 on conflict(plan_id) do update set consent_id=gen_random_uuid(),agreement_digest=excluded.agreement_digest,
  source_reference=excluded.source_reference,status='pending',authorization_code=null,email=null,last4=null,card_type=null,environment=null,
  expires_on=null,accepted_at=now(),last_result=null,next_check_at=now(),updated_at=now() returning * into d;
 insert into public.audit_logs(action,target_type,target_id,admin_id,details) values('LATER_RENT_DEBIT_CONSENT','rent_plan',plan.id::text,actor,
  jsonb_build_object('consent_id',d.consent_id,'agreement_digest',p_agreement_digest,'source_reference',p.paystack_reference,'scope','Only due scheduled later-year rent; saved amount and fee; disable future debits at any time; in-flight charges remain reconcilable')::text);
 return jsonb_build_object('consent_id',d.consent_id,'source_reference',d.source_reference,'agreement_digest',d.agreement_digest,'amount_minor',p.verified_amount*100,'transaction_id',p.paystack_transaction_id,'currency',p.currency);
end $$;
revoke all on function public.prepare_my_later_rent_debit(text,text,boolean) from public,anon,service_role;
grant execute on function public.prepare_my_later_rent_debit(text,text,boolean) to authenticated;

create function public.disable_my_later_rent_debit(p_reservation_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.require_long_let_customer(p_reservation_id);v_plan_id uuid;d private.later_rent_debit;
begin
 select id into v_plan_id from public.rent_plans where reservation_id=p_reservation_id and user_id=actor;
 select * into d from private.later_rent_debit where later_rent_debit.plan_id=v_plan_id for update;
 if d.payment_id is not null and d.debit_attempted_at is null then
  update public.booking_payments set metadata=metadata-'rent_automatic_debit',updated_at=now() where id=d.payment_id and status='pending';
  update private.later_rent_debit set payment_id=null where later_rent_debit.plan_id=d.plan_id;
 end if;
 update private.later_rent_debit target set status='disabled',authorization_code=null,email=null,updated_at=now(),
  last_result='Future automatic charges disabled. A payment already sent still needs confirmation.' where target.plan_id=v_plan_id;
 insert into public.audit_logs(action,target_type,target_id,admin_id,details) values('LATER_RENT_DEBIT_DISABLED','rent_plan',v_plan_id::text,actor,'Future charges disabled; tenancy and in-flight payment records retained');
 return public.get_my_later_rent_debit(p_reservation_id);
end $$;
revoke all on function public.disable_my_later_rent_debit(text) from public,anon,service_role;
grant execute on function public.disable_my_later_rent_debit(text) to authenticated;

create function public.bind_verified_later_rent_debit(p_consent_id uuid,p_reference text,p_authorization text,p_email text,p_last4 text,p_card_type text,p_environment text,p_expires_on date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d private.later_rent_debit;plan public.rent_plans;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Provider authority required' using errcode='42501';end if;
 select * into d from private.later_rent_debit where consent_id=p_consent_id for update;
 select * into plan from public.rent_plans where id=d.plan_id;
 if d.status is distinct from 'pending' or d.source_reference is distinct from p_reference or d.payment_id is not null
  or p_authorization !~ '^AUTH_[A-Za-z0-9]+$' or p_authorization is null or length(coalesce(p_email,'')) not between 3 and 320
  or p_last4 !~ '^[0-9]{4}$' or p_last4 is null or p_environment not in('test','live') or p_environment is null
  or p_expires_on is null or p_expires_on<current_date then raise exception 'Current tenant consent and valid provider authorization required';end if;
 perform private.assert_later_rent_consent(plan.id,d.agreement_digest);
 update private.later_rent_debit set status='active',authorization_code=p_authorization,email=p_email,last4=p_last4,
  card_type=left(p_card_type,40),environment=p_environment,expires_on=p_expires_on,next_check_at=now(),updated_at=now(),last_result='Automatic payment enabled for due scheduled rent only' where plan_id=d.plan_id;
 return jsonb_build_object('success',true,'consent_id',d.consent_id);
end $$;
revoke all on function public.bind_verified_later_rent_debit(uuid,text,text,text,text,text,text,date) from public,anon,authenticated;
grant execute on function public.bind_verified_later_rent_debit(uuid,text,text,text,text,text,text,date) to service_role;

create function public.claim_due_later_rent_debit() returns jsonb
language plpgsql security definer set search_path='' as $$
declare d private.later_rent_debit;plan public.rent_plans;c public.rent_plan_contributions;p public.booking_payments;checkout jsonb;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Provider authority required' using errcode='42501';end if;
 for d in select * from private.later_rent_debit debit where (payment_id is not null or (status='active' and
  (expires_on<current_date or exists(select 1 from public.rent_plan_contributions contribution where contribution.rent_plan_id=debit.plan_id
   and contribution.status in('scheduled','pending') and contribution.paystack_reference is null
   and contribution.due_date<=(now() at time zone 'Africa/Lagos')::date
   and not exists(select 1 from public.rent_plan_contributions earlier where earlier.rent_plan_id=debit.plan_id
    and earlier.agreement_sequence<contribution.agreement_sequence and earlier.status not in('paid','completed'))))))
  and next_check_at<=now() and coalesce(lease_until,'-infinity')<=now() order by next_check_at,plan_id limit 1 for update skip locked loop
  select * into plan from public.rent_plans where id=d.plan_id;
  if d.payment_id is not null then
   select * into p from public.booking_payments where id=d.payment_id;
   if p.status in('paid','completed') then
    update private.later_rent_debit set payment_id=null,split_started=false,split_code=null,debit_attempted_at=null,next_check_at=now()+interval '1 hour',last_result='Scheduled payment confirmed',updated_at=now() where plan_id=d.plan_id;
    return null;
   end if;
   if d.debit_attempted_at is null and d.status<>'active' then
    update public.booking_payments set metadata=metadata-'rent_automatic_debit',updated_at=now() where id=p.id and status='pending';
    update private.later_rent_debit set payment_id=null,lease_until=null,updated_at=now() where plan_id=d.plan_id;
    return null;
   end if;
  else
   if d.expires_on<current_date then
    update private.later_rent_debit set status='needs_action',authorization_code=null,email=null,
     last_result='The saved card has expired. Pay manually or check another verified rent payment.',updated_at=now() where plan_id=d.plan_id;return null;end if;
   if d.status<>'active' or d.expires_on<current_date or plan.status<>'active' or not private.later_rent_collection_enabled()
    or not exists(select 1 from public.reservations where id=plan.reservation_id and status='occupied')
    or not exists(select 1 from public.profiles where user_id=d.customer_user_id and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)) then
    update private.later_rent_debit set next_check_at=now()+interval '1 hour',updated_at=now() where plan_id=d.plan_id;return null;end if;
   select * into c from public.rent_plan_contributions where rent_plan_id=d.plan_id and status not in('paid','completed') order by agreement_sequence limit 1;
   if c.id is null or c.due_date is null or c.due_date>(now() at time zone 'Africa/Lagos')::date or c.paystack_reference is not null then
    update private.later_rent_debit set next_check_at=now()+interval '1 hour',updated_at=now() where plan_id=d.plan_id;return null;end if;
   begin
    checkout:=private.create_later_rent_payment(c.id,d.customer_user_id);
   exception when others then
    update private.later_rent_debit set status='needs_action',authorization_code=null,email=null,last_result='Scheduled rent needs review. Open the booking or contact Help.',next_check_at=now()+interval '1 hour',updated_at=now() where plan_id=d.plan_id;
    return null;
   end;
   select * into p from public.booking_payments where paystack_reference=checkout->>'reference';
   update public.booking_payments set metadata=metadata||jsonb_build_object('rent_automatic_debit',true),updated_at=now() where id=p.id;
   update private.later_rent_debit set payment_id=p.id,split_started=false,split_code=null,debit_attempted_at=null,updated_at=now() where plan_id=d.plan_id returning * into d;
  end if;
  update private.later_rent_debit set lease_until=now()+interval '2 minutes',next_check_at=now()+interval '5 minutes' where plan_id=d.plan_id;
  return jsonb_build_object('consent_id',d.consent_id,'status',d.status,'payment_id',p.id,'reference',p.paystack_reference,
   'authorization_code',d.authorization_code,'email',d.email,'environment',d.environment,'expires_on',d.expires_on,
   'amount_minor',p.amount_total*100,'currency',p.currency,'route',p.metadata->'rent_settlement_route',
   'split_started',d.split_started,'split_code',d.split_code,'split_lookup_page',d.split_lookup_page,'attempted',d.debit_attempted_at is not null);
 end loop;return null;
end $$;
revoke all on function public.claim_due_later_rent_debit() from public,anon,authenticated;
grant execute on function public.claim_due_later_rent_debit() to service_role;

create function public.start_later_rent_debit_split(p_consent_id uuid,p_payment_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Provider authority required' using errcode='42501';end if;
 update private.later_rent_debit set split_started=true,updated_at=now() where consent_id=p_consent_id and payment_id=p_payment_id and status='active'
  and split_started=false and lease_until>now() and debit_attempted_at is null;
 return found;
end $$;
revoke all on function public.start_later_rent_debit_split(uuid,uuid) from public,anon,authenticated;
grant execute on function public.start_later_rent_debit_split(uuid,uuid) to service_role;

create function public.save_later_rent_debit_split(p_consent_id uuid,p_payment_id uuid,p_split_code text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Provider authority required' using errcode='42501';end if;
 if p_split_code !~ '^SPL_[A-Za-z0-9]+$' or p_split_code is null then raise exception 'Verified provider split required';end if;
 update private.later_rent_debit set split_code=p_split_code,updated_at=now() where consent_id=p_consent_id and payment_id=p_payment_id and status='active'
  and split_started and (split_code is null or split_code=p_split_code) and debit_attempted_at is null;
 return found;
end $$;
revoke all on function public.save_later_rent_debit_split(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.save_later_rent_debit_split(uuid,uuid,text) to service_role;

create function public.authorize_later_rent_debit_dispatch(p_consent_id uuid,p_payment_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare d private.later_rent_debit;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Provider authority required' using errcode='42501';end if;
 select * into d from private.later_rent_debit where consent_id=p_consent_id and payment_id=p_payment_id for update;
 if d.status is distinct from 'active' or d.split_code is null or d.debit_attempted_at is not null or d.authorization_code is null or d.expires_on<current_date then return false;end if;
 perform public.validate_later_rent_checkout(p_payment_id,d.customer_user_id);
 if exists(select 1 from public.booking_payments where id=p_payment_id and metadata->>'paystack_access_code' is not null) then raise exception 'Manual checkout must be reconciled before automatic debit';end if;
 update private.later_rent_debit set debit_attempted_at=now(),last_result='Automatic payment sent; confirmation pending',updated_at=now() where plan_id=d.plan_id;
 return true;
end $$;
revoke all on function public.authorize_later_rent_debit_dispatch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorize_later_rent_debit_dispatch(uuid,uuid) to service_role;

create function public.finish_later_rent_debit_check(p_consent_id uuid,p_payment_id uuid,p_status text,p_split_page integer default 1) returns void
language plpgsql security definer set search_path='' as $$
declare d private.later_rent_debit;p public.booking_payments;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Provider authority required' using errcode='42501';end if;
 select * into d from private.later_rent_debit where consent_id=p_consent_id and payment_id=p_payment_id for update;
 if d.plan_id is null then return;end if;
 select * into p from public.booking_payments where id=p_payment_id for update;
 if p_status='failed' and d.debit_attempted_at is not null and p.status='pending'
  and not exists(select 1 from public.verified_provider_events where provider_reference=p.paystack_reference and processing_status='processed') then
  -- Only an authenticated provider lookup of a terminal failed transaction
  -- reaches this path. Unknown/timeouts never create another reference.
  update public.booking_payments set status='failed',metadata=metadata||jsonb_build_object('rent_debit_terminal_failure',now()),updated_at=now() where id=p.id;
  update public.rent_plan_contributions set status='scheduled',payment_reference=null,paystack_reference=null,updated_at=now()
   where id=(p.metadata->>'contribution_id')::uuid and paystack_reference=p.paystack_reference and status='payment_pending';
  update private.later_rent_debit set status=case when status='disabled' then status else 'needs_action' end,
   authorization_code=null,email=null,payment_id=null,split_code=null,split_started=false,debit_attempted_at=null,lease_until=null,
   last_result='The provider confirmed this automatic payment failed. No rent credit was added. Pay manually or review automatic payment.',updated_at=now() where plan_id=d.plan_id;
 else
  update private.later_rent_debit set lease_until=null,split_lookup_page=least(greatest(coalesce(p_split_page,1),1),10000),next_check_at=now()+interval '5 minutes',updated_at=now() where plan_id=d.plan_id;
 end if;
end $$;
revoke all on function public.finish_later_rent_debit_check(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.finish_later_rent_debit_check(uuid,uuid,text,integer) to service_role;

do $manual_visibility$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.get_my_later_rent_history(text,integer,integer)'::regprocedure);
 needle:=$old$and (p.id is null or p.status='pending')$old$;
 if strpos(definition,needle)=0 then raise exception 'Inspect rent history before excluding in-flight automatic payments';end if;
 execute replace(definition,needle,needle||$new$ and coalesce(p.metadata->>'rent_automatic_debit','false')<>'true'$new$);
end $manual_visibility$;

create function private.revoke_inactive_rent_debit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(new.deleted,false) or coalesce(new.suspended,false) or coalesce(new.banned,false) then
  update private.later_rent_debit set status='disabled',authorization_code=null,email=null,updated_at=now(),
   last_result='Automatic rent is disabled while the account is inactive. In-flight payments remain reconcilable.'
   where customer_user_id=new.user_id and (status in('active','pending') or authorization_code is not null);
 end if;return new;
end $$;
revoke all on function private.revoke_inactive_rent_debit() from public,anon,authenticated,service_role;
create trigger revoke_inactive_rent_debit after update of deleted,suspended,banned on public.profiles
 for each row execute function private.revoke_inactive_rent_debit();

create function private.revoke_closed_tenancy_debit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status is distinct from 'active' then
  update private.later_rent_debit set status='disabled',authorization_code=null,email=null,updated_at=now(),
   last_result='Future automatic rent is disabled because the rent plan is no longer active. In-flight payment records remain available.'
   where plan_id=new.id and (status in('active','pending') or authorization_code is not null);
 end if;return new;
end $$;
revoke all on function private.revoke_closed_tenancy_debit() from public,anon,authenticated,service_role;
create trigger revoke_closed_tenancy_debit after update of status on public.rent_plans
 for each row execute function private.revoke_closed_tenancy_debit();

create function private.notify_later_rent_debit() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text;title text;event_id uuid;r public.reservations;
begin
 if tg_op='INSERT' then return new;end if;
 kind:=case when new.status is distinct from old.status then new.status
  when new.debit_attempted_at is not null and old.debit_attempted_at is null then 'sent'
  when old.payment_id is not null and new.payment_id is null then case when new.last_result like 'The provider confirmed%' then 'failed' else 'confirmed' end else null end;
 if kind is null then return new;end if;
 select reservation.* into r from public.rent_plans plan join public.reservations reservation on reservation.id=plan.reservation_id where plan.id=new.plan_id;
 title:=case kind when 'active' then 'Automatic rent enabled' when 'disabled' then 'Future automatic rent disabled'
  when 'sent' then 'Automatic rent confirmation pending' when 'confirmed' then 'Scheduled rent payment confirmed'
  else 'Automatic rent needs your attention' end;
 event_id:=private.upsert_activity_event('rent_debit:'||new.consent_id||':'||kind||':'||coalesce(new.payment_id,old.payment_id,new.consent_id),
  'rent.debit.'||kind,'reservation',r.id,null,title,'Open your booking for the payment result, rent credit and payment-method controls.',
  'my_reservations',jsonb_build_object('reservation_id',r.id),now());
 perform private.add_activity_audience(event_id,new.customer_user_id,'personal','property',null,kind in('needs_action','failed'));
 return new;
end $$;
revoke all on function private.notify_later_rent_debit() from public,anon,authenticated,service_role;
create trigger later_rent_debit_activity after update of status,debit_attempted_at,payment_id on private.later_rent_debit
 for each row execute function private.notify_later_rent_debit();
