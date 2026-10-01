begin;
alter table public.hotel_bookings add column cancellation_snapshot jsonb;
create or replace function public.snapshot_hotel_cancellation_terms()
returns trigger language plpgsql security definer set search_path='pg_catalog','public' as $$
declare h public.hotels; deadline timestamptz; refundable boolean;
begin
 if tg_op='UPDATE' then
  if new.cancellation_snapshot is distinct from old.cancellation_snapshot then raise exception 'Booked cancellation terms are immutable'; end if;
  return new;
 end if;
 select * into h from public.hotels where hotel_id=new.hotel_id;
 refundable:=coalesce((new.rate_plan_snapshot->>'refundable')::boolean,false);
 deadline:=((new.check_in+h.check_in_time) at time zone h.timezone)
   -make_interval(hours=>coalesce((new.rate_plan_snapshot->>'cancellation_hours')::integer,0));
 new.cancellation_snapshot:=jsonb_build_object('version',1,'timezone',h.timezone,
  'check_in_time',h.check_in_time,'refundable',refundable,'deadline',case when refundable then deadline else null end,
  'refund_amount_ngn',case when refundable then new.total_price else 0 end,'fee_ngn',0,
  'terms','Full booking amount returned to the original payment method if cancelled by the stored deadline before check-in. Later cancellations and exceptions require WeHouse review.');
 return new;
end $$;
revoke all on function public.snapshot_hotel_cancellation_terms() from public,anon,authenticated;
create trigger zz_snapshot_hotel_cancellation_terms before insert or update on public.hotel_bookings
 for each row execute function public.snapshot_hotel_cancellation_terms();
alter table public.financial_action_outbox drop constraint financial_action_outbox_action_type_check;
alter table public.financial_action_outbox add constraint financial_action_outbox_action_type_check check(action_type in(
 'refund_caution_undisputed','refund_caution_balance','release_caution_award','refund_unclaimed_caution',
 'refund_shared_checkout','refund_hotel_cancellation','release_worker_payment','release_long_let_payment','release_short_let_stay','release_hotel_stay'));
create or replace function public.cancel_my_hotel_booking(p_booking_id integer)
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare actor text:=public.current_profile_user_id(); b public.hotel_bookings;
 p public.payment_protection_transactions; refund_key text:='hotel-cancellation:'||p_booking_id;
begin
 if actor is null or not public.current_actor_has_personal_workspace() then raise exception 'Active Personal account required'; end if;
 perform 1 from public.booking_payments where hotel_booking_id=p_booking_id and user_id=actor and purpose='hotel_booking' order by id for update;
 select * into b from public.hotel_bookings where booking_id=p_booking_id and user_id=actor for update;
 if b.booking_id is null then raise exception 'Hotel booking unavailable'; end if;
 if b.status in ('cancelled','refunded') then return true; end if;
 if b.status='pending' and b.payment_status<>'paid' then
  update public.hotel_bookings set status='cancelled',canonical_state='cancelled',payment_status='expired',updated_at=now() where booking_id=p_booking_id;
  update public.booking_payments set status='cancelled',updated_at=now()
   where hotel_booking_id=p_booking_id and user_id=actor and purpose='hotel_booking' and status='pending';
  return true;
 end if;
 if b.status<>'confirmed' or b.payment_status<>'paid' or b.checked_in_at is not null
  or b.cancellation_snapshot is null or not coalesce((b.cancellation_snapshot->>'refundable')::boolean,false)
  or now()>(b.cancellation_snapshot->>'deadline')::timestamptz then
  raise exception 'This booking requires WeHouse cancellation review'; end if;
 select * into p from public.payment_protection_transactions where id=b.payment_protection_id for update;
 if p.id is null or p.payer_user_id<>actor or p.paystack_reference is distinct from b.payment_reference
  or p.protection_state not in ('protected','release_eligible') or p.released_amount<>0 or p.refunded_amount<>0
  or p.amount_total<>(b.cancellation_snapshot->>'refund_amount_ngn')::numeric
  or exists(select 1 from public.financial_action_outbox where payment_protection_id=p.id and status<>'completed')
  then raise exception 'Payment requires Finance reconciliation before cancellation'; end if;
 insert into public.payment_protection_transitions(payment_protection_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,metadata)
 values(p.id,p.protection_state,'risk_held','hotel_cancellation_requested',refund_key,actor,'customer',b.cancellation_snapshot);
 update public.payment_protection_transactions set protection_state='risk_held',status='risk_held',risk_held_at=now(),updated_at=now() where id=p.id;
 insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
 values('refund_hotel_cancellation','hotel',b.booking_id::text,p.id,p.amount_total,refund_key,b.cancellation_snapshot);
 -- Inventory excludes cancelled bookings. Money remains paid until the verified provider refund.
 update public.hotel_bookings set status='cancelled',canonical_state='cancelled',updated_at=now() where booking_id=b.booking_id;
 return true;
end $$;
revoke all on function public.cancel_my_hotel_booking(integer) from public,anon;
grant execute on function public.cancel_my_hotel_booking(integer) to authenticated;

create or replace function public.sync_hotel_cancellation_refund()
returns trigger language plpgsql security definer set search_path='pg_catalog','public' as $$
begin
 if new.action_type='refund_hotel_cancellation' and new.status='completed' and old.status<>'completed' then
  if not exists(select 1 from public.payment_protection_transactions where id=new.payment_protection_id
   and refunded_amount=amount_total and protection_state='refunded') then raise exception 'Verified refund ledger required'; end if;
  update public.hotel_bookings set payment_status='refunded',updated_at=now()
   where booking_id=new.subject_id::integer and payment_protection_id=new.payment_protection_id and status='cancelled';
  update public.booking_payments set status='refunded',updated_at=now()
   where hotel_booking_id=new.subject_id::integer and paystack_reference=(select paystack_reference from public.payment_protection_transactions where id=new.payment_protection_id)
    and purpose='hotel_booking' and status='paid';
 end if;
 return new;
end $$;
revoke all on function public.sync_hotel_cancellation_refund() from public,anon,authenticated;
create trigger sync_hotel_cancellation_refund after update of status on public.financial_action_outbox
 for each row execute function public.sync_hotel_cancellation_refund();
CREATE OR REPLACE FUNCTION public.process_verified_paystack_refund_event(p_provider_event_key text, p_event_type text, p_original_reference text, p_refund_reference text, p_provider_refund_id text, p_payload_sha256 text, p_signature_verified_at timestamp with time zone, p_amount_minor bigint, p_currency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_event public.verified_provider_events;
  v_action public.financial_action_outbox;
  v_protection public.payment_protection_transactions;
  v_amount numeric(12,2);
  v_match_count integer;
  v_ledger uuid;
  v_new_released numeric(12,2);
  v_new_refunded numeric(12,2);
  v_to_state text;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  if p_event_type not in(
    'refund.pending','refund.processing','refund.needs-attention',
    'refund.failed','refund.processed'
  ) or nullif(btrim(p_provider_event_key),'') is null
    or nullif(btrim(p_original_reference),'') is null
    or p_payload_sha256 !~ '^[0-9a-f]{64}$'
    or p_amount_minor<=0 or upper(p_currency)<>'NGN' then
    raise exception 'Invalid verified Paystack refund event'; end if;
  -- Match the charge path's payment -> booking lock order before claiming the outbox.
  perform 1 from public.booking_payments where paystack_reference=p_original_reference for update;
  perform 1 from public.hotel_bookings where payment_reference=p_original_reference for update;
  v_amount:=round(p_amount_minor::numeric/100,2);
  insert into public.verified_provider_events(
    provider,provider_event_key,event_type,provider_reference,payload_sha256,
    signature_verified_at,processing_status
  ) values(
    'paystack',p_provider_event_key,p_event_type,
    coalesce(nullif(btrim(p_refund_reference),''),p_provider_event_key),
    lower(p_payload_sha256),p_signature_verified_at,'received'
  ) on conflict do nothing;
  select * into v_event from public.verified_provider_events
  where provider='paystack' and provider_event_key=p_provider_event_key for update;
  if v_event.provider_event_id is null then raise exception 'Refund event was not registered'; end if;
  if v_event.payload_sha256<>lower(p_payload_sha256) then
    raise exception 'Refund event replay checksum mismatch'; end if;
  if v_event.processing_status='processed' then
    return jsonb_build_object('success',true,'already_processed',true); end if;

  select count(*) into v_match_count
  from public.financial_action_outbox a
  join public.payment_protection_transactions p on p.id=a.payment_protection_id
  where a.action_type like 'refund_%'
    and a.status in('processing','provider_pending','provider_attention','manual_review')
    and p.paystack_reference=p_original_reference
    and a.amount=v_amount
    and (nullif(btrim(p_provider_refund_id),'') is null
      or a.provider_action_id is null
      or a.provider_action_id=p_provider_refund_id);
  if v_match_count=0 then
    update public.verified_provider_events set processing_status='ignored',
      processed_at=now(),processing_error='No matching pending refund action'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',true,'ignored',true);
  end if;
  if v_match_count<>1 then
    update public.verified_provider_events set processing_status='failed',
      processed_at=now(),processing_error='Refund event matched multiple actions'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',false,'error','Refund matching requires Finance review');
  end if;
  select a.* into v_action
  from public.financial_action_outbox a
  join public.payment_protection_transactions p on p.id=a.payment_protection_id
  where a.action_type like 'refund_%'
    and a.status in('processing','provider_pending','provider_attention','manual_review')
    and p.paystack_reference=p_original_reference and a.amount=v_amount
    and (nullif(btrim(p_provider_refund_id),'') is null
      or a.provider_action_id is null or a.provider_action_id=p_provider_refund_id)
  for update of a;
  update public.financial_action_outbox set
    provider_action_id=coalesce(provider_action_id,nullif(btrim(p_provider_refund_id),'')),
    provider_status=replace(p_event_type,'refund.',''),updated_at=now()
  where financial_action_id=v_action.financial_action_id;

  if p_event_type='refund.needs-attention' then
    update public.financial_action_outbox set status='provider_attention'
    where financial_action_id=v_action.financial_action_id;
  elsif p_event_type='refund.failed' then
    update public.financial_action_outbox set status='manual_review',
      last_error='Paystack reported that the refund failed',updated_at=now()
    where financial_action_id=v_action.financial_action_id;
  elsif p_event_type='refund.processed' then
    select * into v_protection from public.payment_protection_transactions
    where id=v_action.payment_protection_id for update;
    if v_action.amount>
        v_protection.amount_total-v_protection.released_amount-v_protection.refunded_amount then
      raise exception 'Refund exceeds the protected balance'; end if;
    v_ledger:=public.post_ledger_transaction(
      'paystack-refund:'||p_provider_event_key,'provider_refund','NGN',
      v_action.subject_type,v_action.subject_id,v_event.provider_event_id,
      jsonb_build_object(
        'financial_action_id',v_action.financial_action_id,
        'original_reference',p_original_reference,
        'refund_reference',p_refund_reference
      ),jsonb_build_array(
        jsonb_build_object(
          'account_key','liability:payment_protection:'||v_protection.id::text,
          'account_class','liability','owner_type',v_protection.subject_type,
          'owner_id',v_protection.subject_id,'amount',v_action.amount,
          'memo','Original-payment refund'
        ),
        jsonb_build_object(
          'account_key','asset:paystack_clearing:NGN','account_class','asset',
          'amount',-v_action.amount,'memo','Paystack processed refund'
        )
      )
    );
    update public.payment_protection_transactions set
      refunded_amount=refunded_amount+v_action.amount,
      refund_ledger_transaction_id=v_ledger,updated_at=now()
    where id=v_protection.id
    returning released_amount,refunded_amount into v_new_released,v_new_refunded;
    v_to_state:=case
      when v_new_refunded=v_protection.amount_total then 'refunded'
      else 'partially_released' end;
    perform public.transition_payment_protection(
      v_protection.id,v_to_state,'provider_refund_processed',
      'provider-refund-processed:'||p_provider_event_key,
      null,'paystack',null,v_ledger,
      jsonb_build_object('financial_action_id',v_action.financial_action_id)
    );
    update public.financial_action_outbox set status='completed',processed_at=now(),
      last_error=null,updated_at=now()
    where financial_action_id=v_action.financial_action_id;
  end if;
  update public.verified_provider_events set processing_status='processed',
    processed_at=now(),processing_error=null
  where provider_event_id=v_event.provider_event_id;
  return jsonb_build_object('success',true,'financial_action_id',v_action.financial_action_id);
end
$function$;
CREATE OR REPLACE FUNCTION public.get_my_hotel_bookings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user text:=public.current_profile_user_id();
begin
  if v_user is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;

  return coalesce((
    select jsonb_agg(
      to_jsonb(booking)||jsonb_build_object(
        'hotels',(
          to_jsonb(hotel)
            -'gps_latitude'-'gps_longitude'-'owner_id'
            -'inspection_request_id'-'approved_by'
        )||jsonb_build_object(
          'address',hotel.address,
          'gps_latitude',null,
          'gps_longitude',null,
          'location_exact',false
        ),
        'refund_status',(select a.status from public.financial_action_outbox a where a.idempotency_key='hotel-cancellation:'||booking.booking_id),
        'refund_amount_ngn',(select a.amount from public.financial_action_outbox a where a.idempotency_key='hotel-cancellation:'||booking.booking_id),
        'hotel_rooms',to_jsonb(room),
        'hotel_rate_plans',to_jsonb(rate_plan)
      )
      order by booking.created_at desc
    )
    from public.hotel_bookings booking
    join public.hotels hotel on hotel.hotel_id=booking.hotel_id
    join public.hotel_rooms room on room.room_id=booking.room_id
    left join public.hotel_rate_plans rate_plan
      on rate_plan.rate_plan_id=booking.rate_plan_id
    where booking.user_id=v_user
  ),'[]'::jsonb);
end
$function$;
create or replace function public.quote_hotel_room_rate(p_hotel_id integer,p_room_id integer,p_rate_plan_id integer,p_check_in date,p_check_out date)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public','private' as $
declare h public.hotels; rp public.hotel_rate_plans; q jsonb; deadline timestamptz;
begin
 if p_check_in is null or p_check_out is null or p_check_in<=current_date or p_check_out<=p_check_in then raise exception 'Choose valid future check-in and check-out dates'; end if;
 select * into h from public.hotels where hotel_id=p_hotel_id and status='active' and approved_at is not null and published_at is not null;
 select * into rp from public.hotel_rate_plans where rate_plan_id=p_rate_plan_id and hotel_id=p_hotel_id and room_id=p_room_id and active;
 if h.hotel_id is null or rp.rate_plan_id is null then raise exception 'Hotel room package is not available'; end if;
 q:=private.hotel_booking_quote_v2(p_room_id,p_rate_plan_id,p_check_in,p_check_out,null,true);
 deadline:=((p_check_in+h.check_in_time) at time zone h.timezone)-make_interval(hours=>coalesce(rp.cancellation_hours,0));
 return q||jsonb_build_object('cancellation_deadline',case when rp.refundable then deadline else null end,
 'cancellation_timezone',h.timezone,'refund_amount_ngn',case when rp.refundable then (q->>'total_price')::numeric else 0 end);
end $;

CREATE OR REPLACE FUNCTION public.process_verified_paystack_charge(p_provider_event_key text, p_event_type text, p_provider_reference text, p_payload_sha256 text, p_signature_verified_at timestamp with time zone, p_amount_minor bigint, p_currency text, p_transaction_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_event public.verified_provider_events;
  v_payment public.booking_payments;
  v_result jsonb;
  v_amount numeric(18,2);
  v_payer text;
  v_payee text;
  v_subject_type text;
  v_subject_id text;
  v_component text;
  v_rate numeric:=0;
  v_policy_id uuid;
  v_protection public.payment_protection_transactions;
  v_stay_protection public.payment_protection_transactions;
  v_caution_protection public.payment_protection_transactions;
  v_reservation public.reservations;
  v_listing public.listings;
  v_hotel_booking public.hotel_bookings;
  v_group public.shared_housing_groups;
  v_stay_amount numeric(18,2):=0;
  v_caution_amount numeric(18,2):=0;
  v_entries jsonb;
  v_liability_total numeric(18,2):=0;
  v_ledger_transaction_id uuid;
  v_error text;
begin
  if (select auth.role())<>'service_role' then
    raise exception 'service role required';
  end if;
  if p_event_type<>'charge.success'
    or nullif(btrim(p_provider_event_key),'') is null
    or nullif(btrim(p_provider_reference),'') is null
    or p_payload_sha256 !~ '^[0-9a-f]{64}
    or p_signature_verified_at is null
    or p_amount_minor<=0
    or upper(p_currency)<>'NGN'
  then raise exception 'Invalid verified Paystack charge'; end if;
  v_amount:=round((p_amount_minor::numeric/100)::numeric,2);

  insert into public.verified_provider_events(
    provider,provider_event_key,event_type,provider_reference,payload_sha256,
    signature_verified_at,processing_status
  ) values(
    'paystack',p_provider_event_key,p_event_type,p_provider_reference,
    lower(p_payload_sha256),p_signature_verified_at,'received'
  ) on conflict do nothing;

  select * into v_event
  from public.verified_provider_events
  where provider='paystack'
    and event_type=p_event_type
    and provider_reference=p_provider_reference
  for update;
  if v_event.provider_event_id is null then
    raise exception 'Provider event could not be registered';
  end if;
  if v_event.provider_event_key<>p_provider_event_key
    or v_event.payload_sha256<>lower(p_payload_sha256) then
    raise exception 'Provider event replay does not match the verified receipt';
  end if;
  if v_event.processing_status='processed' then
    return jsonb_build_object(
      'success',true,'already_processed',true,
      'provider_event_id',v_event.provider_event_id
    );
  end if;

  select * into v_payment from public.booking_payments
  where paystack_reference=p_provider_reference for update;
  if v_payment.id is null then
    update public.verified_provider_events
    set processing_status='ignored',processed_at=now(),
        processing_error='No matching WeHouse payment reference'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',true,'ignored',true);
  end if;
  if v_payment.purpose='hotel_booking' and exists(select 1 from public.financial_action_outbox
      where idempotency_key='hotel-cancellation:'||v_payment.hotel_booking_id) then
    update public.verified_provider_events set processing_status='processed',processed_at=now()
      where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',true,'already_processed',true);
  end if;
  if round(coalesce(v_payment.amount_total,v_payment.amount,0)::numeric*100)
      <>p_amount_minor then
    update public.verified_provider_events
    set processing_status='failed',processed_at=now(),
        processing_error='Verified amount does not match the payment request'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',false,'error','Amount mismatch');
  end if;
  if upper(coalesce(v_payment.currency,'NGN'))<>'NGN' then
    update public.verified_provider_events
    set processing_status='failed',processed_at=now(),
        processing_error='Verified currency does not match the payment request'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',false,'error','Currency mismatch');
  end if;

  if v_payment.purpose='worker_booking' then
    select (p.value->>'percent')::numeric,p.policy_version_id
    into v_rate,v_policy_id from public.creator_policy_versions p
    where p.policy_key='commission_worker' and p.scope_type='global'
      and p.scope_key='*' and p.status='active'
      and p.effective_from<=now()
      and (p.effective_until is null or p.effective_until>now())
    order by p.effective_from desc limit 1;
    if v_rate is null or v_rate<0 or v_rate>50 then
      raise exception 'Active Creator Worker commission is required';
    end if;
    update public.platform_settings
    set value=v_rate::text,editable=false,is_active=true,updated_at=now()
    where key='worker_commission_rate';
  end if;

  begin
    if v_payment.purpose='worker_booking' then
      if v_payment.worker_booking_id is null then
        raise exception 'Worker booking link is missing';
      end if;
      v_result:=public.confirm_worker_booking_payment(
        v_payment.worker_booking_id,p_provider_reference,v_amount,'NGN',p_transaction_id
      );
    elsif v_payment.purpose='shared_housing_share' then
      v_result:=public.confirm_shared_housing_payment(
        p_provider_reference,p_transaction_id,v_amount
      );
    elsif v_payment.purpose in(
      'apartment_reservation','apartment_rent','rent_plan_contribution',
      'hotel_booking','worker_verification'
    ) then
      v_result:=public.confirm_booking_payment(
        p_provider_reference,p_transaction_id,v_amount,'webhook',v_payment.purpose
      );
    else
      raise exception 'Unsupported payment purpose: %',coalesce(v_payment.purpose,'missing');
    end if;
    if not coalesce((v_result->>'success')::boolean,false) then
      raise exception '%',coalesce(v_result->>'error','Lifecycle payment confirmation failed');
    end if;

    v_payer:=coalesce(v_payment.payer_user_id,v_payment.user_id);
    v_payee:=v_payment.payee_user_id;
    v_component:=coalesce(v_payment.metadata->>'payment_component','');

    if v_payment.listing_id is not null then
      select * into v_listing from public.listings
      where id::text=v_payment.listing_id limit 1;
      v_payee:=coalesce(v_payee,v_listing.partner_id,v_listing.owner_id);
    end if;

    if v_payment.purpose='worker_booking' then
      select * into v_protection
      from public.payment_protection_transactions
      where booking_type='worker_booking'
        and booking_id=v_payment.worker_booking_id
      for update;
      if v_protection.id is null then
        raise exception 'Worker payment did not create Payment Protection';
      end if;
      update public.payment_protection_transactions
      set subject_type='worker_booking',subject_id=v_payment.worker_booking_id::text,
          amount_commission=round(v_amount*v_rate/100,2),
          amount_payee=v_amount-round(v_amount*v_rate/100,2),
          commission_rate=v_rate,updated_at=now()
      where id=v_protection.id returning * into v_protection;
      update public.worker_bookings
      set payment_protection_id=v_protection.id,policy_version_id=v_policy_id,
          wehouse_fee=v_protection.amount_commission,
          worker_commission=v_protection.amount_commission,
          worker_receives=v_protection.amount_payee,updated_at=now()
      where id=v_payment.worker_booking_id;

    elsif v_payment.purpose='apartment_rent' then
      select * into v_reservation from public.reservations
      where id=v_payment.metadata->>'reservation_id' for update;
      if v_reservation.id is null then raise exception 'Reservation link is missing'; end if;
      if v_listing.id is null then
        select * into v_listing from public.listings
        where id::text=v_reservation.listing_id limit 1;
        v_payee:=coalesce(v_payee,v_listing.partner_id,v_listing.owner_id);
      end if;
      if v_payee is null then raise exception 'Property payee is missing'; end if;

      if v_component='short_stay_rent' or v_reservation.stay_type='short_let' then
        select (p.value->>'percent')::numeric,p.policy_version_id
        into v_rate,v_policy_id from public.creator_policy_versions p
        where p.policy_key='commission_short_let' and p.scope_type='global'
          and p.scope_key='*' and p.status='active'
          and p.effective_from<=now()
          and (p.effective_until is null or p.effective_until>now())
        order by p.effective_from desc limit 1;
        if v_rate is null or v_rate<0 or v_rate>50 then
          raise exception 'Active Creator Short Let commission is required';
        end if;
        v_stay_amount:=round(coalesce(v_reservation.stay_rent_total,
          (v_payment.metadata->>'stay_rent_total')::numeric,0),2);
        v_caution_amount:=round(coalesce(v_reservation.security_deposit_snapshot,
          (v_payment.metadata->>'security_deposit_amount')::numeric,0),2);
        if v_stay_amount<=0 or v_stay_amount+v_caution_amount<>v_amount then
          raise exception 'Short Let stay and Caution split does not match verified money';
        end if;
        insert into public.payment_protection_transactions(
          booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
          amount_commission,amount_payee,commission_rate,status,
          paystack_reference,protection_state,subject_type,subject_id
        ) values(
          null,'short_let_stay',v_payer,v_payee,v_stay_amount,
          round(v_stay_amount*v_rate/100,2),
          v_stay_amount-round(v_stay_amount*v_rate/100,2),v_rate,
          'protected',p_provider_reference,'awaiting_funds',
          'short_let_stay',v_reservation.id
        ) on conflict(subject_type,subject_id) do update
          set paystack_reference=excluded.paystack_reference,updated_at=now()
        returning * into v_stay_protection;
        if v_caution_amount>0 then
          insert into public.payment_protection_transactions(
            booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
            amount_commission,amount_payee,commission_rate,status,
            paystack_reference,protection_state,subject_type,subject_id
          ) values(
            null,'short_let_caution',v_payer,v_payee,v_caution_amount,
            0,v_caution_amount,0,'protected',p_provider_reference,
            'awaiting_funds','short_let_caution',v_reservation.id
          ) on conflict(subject_type,subject_id) do update
            set paystack_reference=excluded.paystack_reference,updated_at=now()
          returning * into v_caution_protection;
        end if;
        update public.reservations
        set stay_payment_protection_id=v_stay_protection.id,
            caution_payment_protection_id=v_caution_protection.id,
            commission_policy_version_id=v_policy_id,updated_at=now()
        where id=v_reservation.id;
      else
        select (p.value->>'percent')::numeric,p.policy_version_id
        into v_rate,v_policy_id from public.creator_policy_versions p
        where p.policy_key='commission_long_let' and p.scope_type='global'
          and p.scope_key='*' and p.status='active'
          and p.effective_from<=now()
          and (p.effective_until is null or p.effective_until>now())
        order by p.effective_from desc limit 1;
        if v_rate is null or v_rate<0 or v_rate>50 then
          raise exception 'Active Creator Long Let commission is required';
        end if;
        insert into public.payment_protection_transactions(
          booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
          amount_commission,amount_payee,commission_rate,status,
          paystack_reference,protection_state,subject_type,subject_id
        ) values(
          null,'long_let_year_one',v_payer,v_payee,v_amount,
          round(v_amount*v_rate/100,2),v_amount-round(v_amount*v_rate/100,2),
          v_rate,'protected',p_provider_reference,'awaiting_funds',
          'long_let_year_one',v_reservation.id
        ) on conflict(subject_type,subject_id) do update
          set paystack_reference=excluded.paystack_reference,updated_at=now()
        returning * into v_protection;
        update public.reservations
        set year_one_rent_protection_id=v_protection.id,
            commission_policy_version_id=v_policy_id,updated_at=now()
        where id=v_reservation.id;
      end if;

    elsif v_payment.purpose='hotel_booking' then
      select * into v_hotel_booking from public.hotel_bookings
      where booking_id=v_payment.hotel_booking_id for update;
      if v_hotel_booking.booking_id is null then raise exception 'Hotel booking is missing'; end if;
      select h.owner_id into v_payee from public.hotels h
      where h.hotel_id=v_hotel_booking.hotel_id;
      if v_payee is null then raise exception 'Hotel payee is missing'; end if;
      select (p.value->>'percent')::numeric,p.policy_version_id
      into v_rate,v_policy_id from public.creator_policy_versions p
      where p.policy_key='commission_hotel' and p.scope_type='global'
        and p.scope_key='*' and p.status='active'
        and p.effective_from<=now()
        and (p.effective_until is null or p.effective_until>now())
      order by p.effective_from desc limit 1;
      if v_rate is null or v_rate<0 or v_rate>50 then
        raise exception 'Active Creator Hotel commission is required';
      end if;
      insert into public.payment_protection_transactions(
        booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
        amount_commission,amount_payee,commission_rate,status,
        paystack_reference,protection_state,subject_type,subject_id
      ) values(
        null,'hotel_stay',v_payer,v_payee,v_amount,
        round(v_amount*v_rate/100,2),v_amount-round(v_amount*v_rate/100,2),
        v_rate,'protected',p_provider_reference,'awaiting_funds',
        'hotel_stay',v_hotel_booking.booking_id::text
      ) on conflict(subject_type,subject_id) do update
        set paystack_reference=excluded.paystack_reference,updated_at=now()
      returning * into v_protection;
      update public.hotel_bookings
      set payment_protection_id=v_protection.id,policy_version_id=v_policy_id,
          updated_at=now()
      where booking_id=v_hotel_booking.booking_id;

    elsif v_payment.purpose='shared_housing_share'
      and coalesce(v_payment.metadata->>'payment_phase','')<>'reservation_fee' then
      select g.* into v_group from public.shared_housing_groups g
      where g.id=(v_payment.metadata->>'shared_group_id')::uuid;
      if v_group.id is null then raise exception 'Shared payment group is missing'; end if;
      select * into v_listing from public.listings where id=v_group.listing_id;
      v_payee:=coalesce(v_listing.partner_id,v_listing.owner_id);
      if v_payee is null then raise exception 'Shared payment payee is missing'; end if;
      if v_listing.sub_type='short_let' then
        select (p.value->>'percent')::numeric,p.policy_version_id
        into v_rate,v_policy_id from public.creator_policy_versions p
        where p.policy_key='commission_short_let' and p.scope_type='global'
          and p.scope_key='*' and p.status='active'
          and p.effective_from<=now()
          and (p.effective_until is null or p.effective_until>now())
        order by p.effective_from desc limit 1;
        if v_rate is null or v_rate<0 or v_rate>50 then
          raise exception 'Active Creator Short Let commission is required';
        end if;
      else
        select (p.value->>'percent')::numeric,p.policy_version_id
        into v_rate,v_policy_id from public.creator_policy_versions p
        where p.policy_key='commission_long_let' and p.scope_type='global'
          and p.scope_key='*' and p.status='active'
          and p.effective_from<=now()
          and (p.effective_until is null or p.effective_until>now())
        order by p.effective_from desc limit 1;
        if v_rate is null or v_rate<0 or v_rate>50 then
          raise exception 'Active Creator Long Let commission is required';
        end if;
      end if;
      insert into public.payment_protection_transactions(
        booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
        amount_commission,amount_payee,commission_rate,status,
        paystack_reference,protection_state,subject_type,subject_id
      ) values(
        null,'shared_housing_share',v_payer,v_payee,v_amount,
        round(v_amount*v_rate/100,2),v_amount-round(v_amount*v_rate/100,2),
        v_rate,'protected',p_provider_reference,'awaiting_funds',
        'shared_housing_share',v_payment.metadata->>'shared_member_id'
      ) on conflict(subject_type,subject_id) do update
        set paystack_reference=excluded.paystack_reference,updated_at=now()
      returning * into v_protection;
    end if;

    v_entries:=jsonb_build_array(jsonb_build_object(
      'account_key','asset:paystack_clearing:NGN','account_class','asset',
      'amount',v_amount,'memo','Paystack verified charge'
    ));
    for v_protection in
      select p.* from public.payment_protection_transactions p
      where p.paystack_reference=p_provider_reference
        and p.subject_type in(
          'worker_booking','long_let_year_one','short_let_stay',
          'short_let_caution','hotel_stay','shared_housing_share'
        )
      order by p.subject_type,p.id
    loop
      v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
        'account_key','liability:payment_protection:'||v_protection.id::text,
        'account_class','liability','owner_type',v_protection.subject_type,
        'owner_id',v_protection.subject_id,'amount',-v_protection.amount_total,
        'memo','Protected customer funds'
      ));
      v_liability_total:=v_liability_total+v_protection.amount_total;
    end loop;
    if v_liability_total>v_amount then
      raise exception 'Payment Protection allocation exceeds verified money';
    end if;
    if v_liability_total<v_amount then
      v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
        'account_key',case
          when v_payment.purpose='apartment_reservation'
            or (v_payment.purpose='shared_housing_share'
              and v_payment.metadata->>'payment_phase'='reservation_fee')
            then 'liability:unearned_reservation_fee:'||v_payment.id::text
          when v_payment.purpose='rent_plan_contribution'
            then 'liability:partner_payable:'||coalesce(v_payee,'unresolved')
          else 'liability:customer_funds:'||v_payment.id::text end,
        'account_class','liability','owner_type','booking_payment',
        'owner_id',v_payment.id::text,'amount',-(v_amount-v_liability_total),
        'memo','Unreleased customer funds'
      ));
    end if;

    v_ledger_transaction_id:=public.post_ledger_transaction(
      'paystack-charge:'||p_provider_reference,'provider_charge','NGN',
      'booking_payment',v_payment.id::text,v_event.provider_event_id,
      jsonb_build_object(
        'provider','paystack','provider_reference',p_provider_reference,
        'purpose',v_payment.purpose,'payer_user_id',v_payer
      ),v_entries
    );

    for v_protection in
      select p.* from public.payment_protection_transactions p
      where p.paystack_reference=p_provider_reference
        and p.subject_type in(
          'worker_booking','long_let_year_one','short_let_stay',
          'short_let_caution','hotel_stay','shared_housing_share'
        )
      order by p.subject_type,p.id
    loop
      update public.payment_protection_transactions
      set protected_ledger_transaction_id=v_ledger_transaction_id,updated_at=now()
      where id=v_protection.id;
      if v_protection.protection_state='awaiting_funds' then
        perform public.transition_payment_protection(
          v_protection.id,'protected','provider_charge_verified',
          'paystack-protected:'||p_provider_reference||':'||v_protection.id::text,
          null,'paystack',null,v_ledger_transaction_id,
          jsonb_build_object('provider_event_id',v_event.provider_event_id)
        );
      elsif v_protection.protection_state<>'protected' then
        raise exception 'Existing Payment Protection is not awaiting funds';
      end if;
    end loop;

    update public.verified_provider_events
    set processing_status='processed',processed_at=now(),processing_error=null
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object(
      'success',true,'provider_event_id',v_event.provider_event_id,
      'ledger_transaction_id',v_ledger_transaction_id,
      'lifecycle_result',v_result
    );
  exception when others then
    get stacked diagnostics v_error=message_text;
    update public.verified_provider_events
    set processing_status='failed',processed_at=now(),
        processing_error=left(v_error,500)
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',false,'error','Verified payment requires retry or Finance review');
  end;
end
$function$;

commit;
