-- One atomic, service-only gateway from a verified Paystack charge to the
-- compatibility lifecycle RPCs, immutable provider receipt, canonical ledger,
-- and Payment Protection. Raw webhook payloads are deliberately not retained.

create or replace function public.normalize_legacy_payment_protection_insert()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  new.subject_type:=coalesce(nullif(btrim(new.subject_type),''),nullif(btrim(new.booking_type),''));
  new.subject_id:=coalesce(nullif(btrim(new.subject_id),''),new.booking_id::text);
  if new.subject_type is null or new.subject_id is null then
    raise exception 'Payment Protection subject is required';
  end if;
  new.protection_state:=coalesce(nullif(btrim(new.protection_state),''),'awaiting_funds');
  return new;
end
$$;

drop trigger if exists normalize_legacy_payment_protection_insert
  on public.payment_protection_transactions;
create trigger normalize_legacy_payment_protection_insert
before insert on public.payment_protection_transactions
for each row execute function public.normalize_legacy_payment_protection_insert();

revoke all on function public.normalize_legacy_payment_protection_insert()
from public,anon,authenticated;
grant execute on function public.normalize_legacy_payment_protection_insert()
to service_role;

create or replace function public.process_verified_paystack_charge(
  p_provider_event_key text,
  p_event_type text,
  p_provider_reference text,
  p_payload_sha256 text,
  p_signature_verified_at timestamptz,
  p_amount_minor bigint,
  p_currency text,
  p_transaction_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
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
    or p_payload_sha256 !~ '^[0-9a-f]{64}$'
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
      select (p.value->>'percent')::numeric,p.policy_version_id
      into v_rate,v_policy_id from public.creator_policy_versions p
      where p.policy_key='commission_worker' and p.scope_type='global'
        and p.scope_key='*' and p.status='active'
        and p.effective_from<=now()
        and (p.effective_until is null or p.effective_until>now())
      order by p.effective_from desc limit 1;
      v_rate:=coalesce(v_rate,8);
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
        v_rate:=coalesce(v_rate,10);
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
        v_rate:=coalesce(v_rate,5);
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
      v_rate:=coalesce(v_rate,12);
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
        v_rate:=coalesce(v_rate,10);
      else
        select (p.value->>'percent')::numeric,p.policy_version_id
        into v_rate,v_policy_id from public.creator_policy_versions p
        where p.policy_key='commission_long_let' and p.scope_type='global'
          and p.scope_key='*' and p.status='active'
          and p.effective_from<=now()
          and (p.effective_until is null or p.effective_until>now())
        order by p.effective_from desc limit 1;
        v_rate:=coalesce(v_rate,5);
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
$$;

revoke all on function public.process_verified_paystack_charge(
  text,text,text,text,timestamptz,bigint,text,text
) from public,anon,authenticated;
grant execute on function public.process_verified_paystack_charge(
  text,text,text,text,timestamptz,bigint,text,text
) to service_role;

comment on function public.process_verified_paystack_charge(
  text,text,text,text,timestamptz,bigint,text,text
) is 'Atomic verified Paystack receipt, lifecycle confirmation, ledger posting, and Payment Protection gateway.';

-- Existing upgraded databases may already have the earlier function body.
alter function public.get_effective_policy(text,text,text,timestamptz)
  security invoker;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select
  procedure.oid::regprocedure::text,procedure.proname,
  case when procedure.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',procedure.oid,'execute'),
  has_function_privilege('anon',procedure.oid,'execute'),
  has_function_privilege('authenticated',procedure.oid,'execute'),
  has_function_privilege('service_role',procedure.oid,'execute'),
  'approved_service_only','Verified provider-to-ledger gateway or trigger helper',now()
from pg_proc procedure
join pg_namespace namespace on namespace.oid=procedure.pronamespace
where namespace.nspname='public'
  and procedure.proname in(
    'normalize_legacy_payment_protection_insert',
    'process_verified_paystack_charge'
  )
on conflict(function_signature) do update set
  function_name=excluded.function_name,
  security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,
  anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,
  rationale=excluded.rationale,
  captured_at=excluded.captured_at;
