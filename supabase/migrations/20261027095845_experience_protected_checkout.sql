alter table public.booking_payments add column experience_booking_id uuid references public.experience_bookings(id) on delete restrict;
create unique index booking_payments_experience_booking on public.booking_payments(experience_booking_id) where experience_booking_id is not null;
alter table public.booking_payments drop constraint booking_payments_purpose_check;
alter table public.booking_payments add constraint booking_payments_purpose_check check(purpose=any(array[
 'apartment_reservation','apartment_rent','worker_booking','hotel_reservation','hotel_booking','rent_plan_contribution',
 'worker_verification','worker_pro_subscription','shared_housing_share','sponsored_campaign','partner_pro_access','other','experience_booking']::text[]));

create function private.experience_booking_can_pay(p_booking_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.experience_bookings b join public.experience_sessions s on s.id=b.session_id
  join public.experience_activities a on a.id=b.activity_id join public.experience_publications p on p.activity_id=a.id
  where b.id=p_booking_id and b.status='pending_payment' and b.expires_at>now() and s.status='draft' and s.starts_at>now()
  and s.activity_id=a.id and s.revision=(b.contract->>'session_revision')::integer
  and a.revision=(b.contract->>'activity_revision')::integer and a.host_user_id=b.host_user_id
  and p.published and p.activity_revision=a.revision
  and not exists(select 1 from jsonb_each(private.experience_publication_checks(a.id)-'commission') c where c.value is distinct from 'true'::jsonb));
$$;
revoke all on function private.experience_booking_can_pay(uuid) from public,anon,authenticated;

create function public.create_experience_checkout(p_booking_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_customer_actor();b public.experience_bookings;p public.booking_payments;reference text;
 total numeric;fee numeric;rate numeric;policy uuid;
begin
 select * into b from public.experience_bookings where id=p_booking_id and customer_user_id=actor for update;
 if b.id is null then raise exception 'Booking unavailable' using errcode='42501';end if;
 if b.payment_id is not null then
  select * into p from public.booking_payments where id=b.payment_id and experience_booking_id=b.id and payer_user_id=actor;
  if p.id is null then raise exception 'Checkout record requires WeHouse review';end if;
  if p.status in ('paid','completed') then return jsonb_build_object('booking_id',b.id,'payment_id',p.id,'reference',p.paystack_reference,'already_paid',true);end if;
  if p.status<>'pending' then raise exception 'This checkout can no longer accept payment';end if;
 end if;
 if not private.experience_booking_can_pay(b.id) then raise exception 'Session hold expired or activity eligibility changed. Refresh before paying';end if;
 if p.id is not null then return jsonb_build_object('booking_id',b.id,'payment_id',p.id,'reference',p.paystack_reference,'already_paid',false);end if;
 if b.contract->>'currency'<>'NGN' then raise exception 'Payment currency is unsupported';end if;
 total:=(b.contract->>'total_minor')::numeric/100;fee:=(b.contract->>'commission_minor')::numeric/100;
 rate:=(b.contract->>'commission_percent')::numeric;policy:=(b.contract->>'commission_policy_version_id')::uuid;
 if total<=0 or fee<>round(total*rate/100,2) or rate not between 0 and 50 or not exists(select 1 from public.creator_policy_versions where policy_version_id=policy and policy_key='commission_experience') then
  raise exception 'Accepted commission snapshot requires WeHouse review';end if;
 reference:='WHEX_'||replace(b.id::text,'-','');
 insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,payee_user_id,type,booking_type,
  experience_booking_id,amount,amount_total,amount_commission,amount_worker,commission_rate,net_amount,currency,status,purpose,
  commission_policy_version_id,commission_frozen_at,metadata)
 values(reference,reference,actor,actor,b.host_user_id,'experience','experience_booking',b.id,total,total,fee,total-fee,rate,total-fee,'NGN','pending','experience_booking',
  policy,b.created_at,jsonb_build_object('experience_booking_id',b.id,'contract',b.contract,
   'contract_hash',encode(pg_catalog.sha256(convert_to(b.contract::text,'UTF8')),'hex'),'payment_component','experience_session','return_page','my_reservations')) returning * into p;
 update public.experience_bookings set payment_id=p.id,updated_at=now() where id=b.id;
 return jsonb_build_object('booking_id',b.id,'payment_id',p.id,'reference',reference,'already_paid',false);
end $$;
revoke all on function public.create_experience_checkout(uuid) from public,anon;
grant execute on function public.create_experience_checkout(uuid) to authenticated;

-- Called by payment-init's service client, after its live session/account checks.
create function public.validate_experience_checkout(p_payment_id uuid,p_customer_user_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.booking_payments;b public.experience_bookings;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 select * into p from public.booking_payments where id=p_payment_id;
 select * into b from public.experience_bookings where id=p.experience_booking_id;
 if b.id is null or b.customer_user_id is distinct from p_customer_user_id or p.payer_user_id is distinct from p_customer_user_id
  or p.purpose<>'experience_booking' or p.status<>'pending' or b.payment_id is distinct from p.id
  or not private.experience_booking_can_pay(b.id)
  or p.metadata->'contract' is distinct from b.contract
  or p.currency is distinct from b.contract->>'currency'
  or p.amount_total is distinct from (b.contract->>'total_minor')::numeric/100
  or p.amount_commission is distinct from (b.contract->>'commission_minor')::numeric/100
  or p.net_amount is distinct from (b.contract->>'host_receives_minor')::numeric/100
  or p.commission_policy_version_id is distinct from (b.contract->>'commission_policy_version_id')::uuid
  or p.commission_rate is distinct from (b.contract->>'commission_percent')::numeric then
  raise exception 'Experience checkout no longer matches the accepted session, capacity or price';end if;
 return jsonb_build_object('valid',true,'booking_id',b.id,'expires_at',b.expires_at);
end $$;
revoke all on function public.validate_experience_checkout(uuid,text) from public,anon,authenticated;
grant execute on function public.validate_experience_checkout(uuid,text) to service_role;

create function public.confirm_experience_booking_payment(p_booking_id uuid,p_reference text,p_amount numeric,p_currency text,p_transaction_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.experience_bookings;p public.booking_payments;protection public.payment_protection_transactions;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 select * into p from public.booking_payments where paystack_reference=p_reference for update;
 -- Serialize with other session holds before making the booking confirmed.
 perform 1 from public.experience_sessions where id=(select session_id from public.experience_bookings where id=p_booking_id) for update;
 select * into b from public.experience_bookings where id=p_booking_id for update;
 if b.id is null or p.id is null or p.experience_booking_id is distinct from b.id or b.payment_id is distinct from p.id
  or p.payer_user_id is distinct from b.customer_user_id or p.payee_user_id is distinct from b.host_user_id
  or p.purpose<>'experience_booking' or p_amount is distinct from (b.contract->>'total_minor')::numeric/100
  or p_currency is distinct from b.contract->>'currency' then raise exception 'Verified payment does not match the accepted Experience booking';end if;
 if b.status='confirmed' and p.status in ('paid','completed') and b.payment_protection_id is not null then
  return jsonb_build_object('success',true,'already_paid',true,'booking_id',b.id);end if;
 perform public.validate_experience_checkout(p.id,b.customer_user_id);
 -- An expired/cancelled hold never reclaims places after a late charge.
 -- The canonical provider-event gateway retains that verified charge for Finance.
 if exists(select 1 from public.experience_sessions s where s.id=b.session_id and s.capacity<
  (select coalesce(sum(occupied.participants),0) from public.experience_bookings occupied where occupied.session_id=s.id
   and (occupied.status in ('confirmed','completed','review_pending') or (occupied.status='pending_payment' and occupied.expires_at>now())))) then
  raise exception 'Session capacity requires review';end if;
 insert into public.payment_protection_transactions(booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
  amount_commission,amount_payee,commission_rate,status,protection_state,paystack_reference,subject_type,subject_id)
 values(b.id,'experience_booking',b.customer_user_id,b.host_user_id,p.amount_total,p.amount_commission,p.net_amount,p.commission_rate,
  'protected','awaiting_funds',p_reference,'experience_booking',b.id::text) returning * into protection;
 update public.booking_payments set status='paid',paid_at=now(),verified_at=now(),verified_amount=p_amount,
  verification_source='webhook',paystack_transaction_id=p_transaction_id,updated_at=now() where id=p.id;
 update public.experience_bookings set status='confirmed',payment_protection_id=protection.id,updated_at=now() where id=b.id;
 insert into public.audit_logs(action,target_type,target_id,admin_id,details)
 values('EXPERIENCE_PAYMENT_CONFIRMED','experience_booking',b.id::text,b.customer_user_id,
  jsonb_build_object('payment_id',p.id,'payment_protection_id',protection.id,'provider_reference',p_reference)::text);
 return jsonb_build_object('success',true,'booking_id',b.id,'payment_protection_id',protection.id);
end $$;
revoke all on function public.confirm_experience_booking_payment(uuid,text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.confirm_experience_booking_payment(uuid,text,numeric,text,text) to service_role;

-- Extend the existing verified-charge/ledger gateway instead of creating a
-- second webhook, a second ledger or a direct settlement exception.
do $patch$
declare definition text;needle text;
begin
 definition:=replace(pg_get_functiondef('public.process_verified_paystack_charge(text,text,text,text,timestamptz,bigint,text,text)'::regprocedure),chr(13),'');
 needle:=$find$  if v_payment.purpose='worker_booking' then
    v_rate:=$find$;
 needle:=replace(needle,chr(13),'');
 if strpos(definition,needle)=0 then raise exception 'Inspect the canonical commission guard before adding Experience checkout';end if;
 definition:=replace(definition,needle,$new$  if v_payment.purpose in ('worker_booking','experience_booking') then
    v_rate:=$new$);
 needle:=$find$    if v_payment.purpose='worker_booking' then
      if v_payment.worker_booking_id is null then$find$;
 needle:=replace(needle,chr(13),'');
 if strpos(definition,needle)=0 then raise exception 'Inspect the canonical fulfillment branch before adding Experiences';end if;
 definition:=replace(definition,needle,$new$    if v_payment.purpose='experience_booking' then
      v_result:=public.confirm_experience_booking_payment(v_payment.experience_booking_id,p_provider_reference,v_amount,'NGN',p_transaction_id);
    elsif v_payment.purpose='worker_booking' then
      if v_payment.worker_booking_id is null then$new$);
 needle:=$find$'worker_booking','long_let_year_one','short_let_stay'$find$;
 needle:=replace(needle,chr(13),'');
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then raise exception 'Inspect both canonical protected-ledger loops';end if;
 definition:=replace(definition,needle,$new$'experience_booking','worker_booking','long_let_year_one','short_let_stay'$new$);
 execute definition;
end $patch$;

-- The existing Provider wallet receives both requested Services and Experiences.
-- Frozen checkout prices are not accumulated again when earnings are released.
do $patch$
declare definition text;needle text;
begin
 definition:=replace(pg_get_functiondef('public.attribute_wallet_transaction()'::regprocedure),chr(13),'');
 needle:=$find$subject_type = 'worker_booking'$find$;
 needle:=replace(needle,chr(13),'');
 if strpos(definition,needle)=0 then raise exception 'Inspect wallet attribution before adding Experience earnings';end if;
 execute replace(definition,needle,$new$subject_type in ('worker_booking','experience_booking')$new$);

 definition:=replace(pg_get_functiondef('public.project_completed_release_to_wallet()'::regprocedure),chr(13),'');
 needle:=$find$v_protection.subject_type='worker_booking'$find$;
 needle:=replace(needle,chr(13),'');
 if strpos(definition,needle)=0 then raise exception 'Inspect canonical wallet projection';end if;
 definition:=replace(definition,$find$v_wallet_type:=case when v_protection.subject_type='worker_booking'$find$,
  $new$v_wallet_type:=case when v_protection.subject_type in ('worker_booking','experience_booking')$new$);
 needle:=$find$amount_commission=coalesce(amount_commission,0)+v_commission,
      net_amount=coalesce(net_amount,0)+v_payee_amount$find$;
 needle:=replace(needle,chr(13),'');
 if strpos(definition,needle)=0 then raise exception 'Inspect frozen checkout fields before release projection';end if;
 definition:=replace(definition,needle,$new$amount_commission=case when commission_frozen_at is null then coalesce(amount_commission,0)+v_commission else amount_commission end,
      net_amount=case when commission_frozen_at is null then coalesce(net_amount,0)+v_payee_amount else net_amount end$new$);
 needle:=$find$when v_protection.subject_type='worker_booking' then 'worker'$find$;
 needle:=replace(needle,chr(13),'');
 if strpos(definition,needle)=0 then raise exception 'Inspect commission reporting classification';end if;
 definition:=replace(definition,needle,$new$when v_protection.subject_type='experience_booking' then 'experience'
          when v_protection.subject_type='worker_booking' then 'worker'$new$);
 execute definition;

 definition:=replace(pg_get_functiondef('public.normalize_canonical_partner_earning()'::regprocedure),chr(13),'');
 needle:=$find$v_protection.subject_type = 'worker_booking'$find$;
 needle:=replace(needle,chr(13),'');
 if strpos(definition,needle)=0 then raise exception 'Inspect Partner earning normalization';end if;
 execute replace(definition,needle,$new$v_protection.subject_type in ('worker_booking','experience_booking')$new$);
end $patch$;

create function private.guard_experience_checkout_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
 if old.purpose='experience_booking' and (new.experience_booking_id,new.metadata->'contract',new.metadata->>'contract_hash')
  is distinct from (old.experience_booking_id,old.metadata->'contract',old.metadata->>'contract_hash') then
  raise exception 'Accepted Experience checkout link and contract cannot change';end if;
 return new;
end $$;
revoke all on function private.guard_experience_checkout_snapshot() from public,anon,authenticated,service_role;
create trigger guard_experience_checkout_snapshot before update on public.booking_payments for each row execute function private.guard_experience_checkout_snapshot();
