-- Close the runtime gaps found while tracing the protected handover guard.
-- Payment flags are not financial authority. A provider event, a paid booking
-- payment, a balanced protected ledger entry and the correctly-linked Payment
-- Protection row must agree before arrival starts.

-- The shared checkout functions already write this canonical purpose, but the
-- table constraint omitted it. Migration replay alone did not exercise that
-- insert, so every real shared payment would have failed before Paystack.
alter table public.booking_payments
drop constraint if exists booking_payments_purpose_check;
alter table public.booking_payments
add constraint booking_payments_purpose_check check(purpose=any(array[
  'apartment_reservation','apartment_rent','worker_booking',
  'hotel_reservation','hotel_booking','rent_plan_contribution',
  'worker_verification','worker_pro_subscription','shared_housing_share','other'
]::text[]));

create or replace function public.accommodation_access_authorization(
  p_reservation_id text,
  p_listing_id text,
  p_user_id text,
  p_stay_type text,
  p_reservation_status text,
  p_manual_payment_status text,
  p_paid_at timestamptz,
  p_rent_payment_status text,
  p_rent_paid_at timestamptz,
  p_rent_payment_reference text,
  p_stay_payment_protection_id uuid,
  p_year_one_rent_protection_id uuid,
  p_shared_payment_group_id uuid,
  p_expected_protected_amount numeric,
  p_access text default 'handover'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_short boolean:=coalesce(p_stay_type,'long_stay')='short_let';
  v_expected_subject text;
  v_protection_id uuid;
  v_component_type text;
  v_allowed_states text[];
  v_accepted_count integer:=0;
  v_paid_member_count integer:=0;
  v_protected_count integer:=0;
  v_component_total numeric(12,2):=0;
  v_group_valid boolean:=false;
  v_direct_valid boolean:=false;
begin
  if p_access not in ('handover','location') then
    raise exception 'Unsupported accommodation access decision';
  end if;

  if p_manual_payment_status not in ('paid','completed')
    or p_paid_at is null
    or p_rent_payment_status not in ('paid','upfront_paid')
    or p_rent_paid_at is null
  then
    return jsonb_build_object('authorized',false,'reason','payment_not_confirmed');
  end if;

  -- Initial arrival/handover must begin while the money is still protected.
  -- Once occupancy has actually begun, exact directions remain available to
  -- the participant during a release, dispute, risk hold or partial release.
  v_allowed_states:=case
    when p_access='location' and p_reservation_status in ('occupied','completed')
      then array[
        'protected','release_eligible','release_pending','released',
        'disputed','risk_held','partially_released'
      ]::text[]
    else array['protected']::text[]
  end;

  v_expected_subject:=case when v_short
    then 'short_let_stay' else 'long_let_year_one' end;
  v_protection_id:=case when v_short
    then p_stay_payment_protection_id else p_year_one_rent_protection_id end;

  if p_shared_payment_group_id is null then
    if v_protection_id is null then
      return jsonb_build_object('authorized',false,'reason','protection_missing');
    end if;
    select exists(
      select 1
      from public.payment_protection_transactions protection
      where protection.id=v_protection_id
        and protection.subject_type=v_expected_subject
        and protection.subject_id=p_reservation_id
        and protection.payer_user_id=p_user_id
        and protection.paystack_reference=p_rent_payment_reference
        and nullif(btrim(coalesce(p_rent_payment_reference,'')),'') is not null
        and protection.status=protection.protection_state
        and protection.protection_state=any(v_allowed_states)
        and protection.protected_ledger_transaction_id is not null
        and round(protection.amount_total,2)
          =round(coalesce(p_expected_protected_amount,0),2)
        and round(coalesce(p_expected_protected_amount,0),2)>0
        and exists(
          select 1
          from public.booking_payments payment
          where payment.paystack_reference=protection.paystack_reference
            and payment.purpose='apartment_rent'
            and payment.metadata->>'reservation_id'=p_reservation_id
            and payment.listing_id=p_listing_id
            and payment.metadata->>'listing_id'=p_listing_id
            and payment.metadata->>'payment_component'=case when v_short
              then 'short_stay_rent' else 'long_stay_rent' end
            and payment.status in ('paid','completed')
            and payment.verified_at is not null
            and coalesce(payment.webhook_processed,false)
            and coalesce(payment.payer_user_id,payment.user_id)=p_user_id
            and upper(coalesce(payment.currency,'NGN'))='NGN'
            and round(coalesce(payment.verified_amount,0),2)
              =round(coalesce(payment.amount_total,payment.amount,0),2)
            and exists(
              select 1
              from public.ledger_transactions ledger
              join public.verified_provider_events provider_event
                on provider_event.provider_event_id=ledger.provider_event_id
              where ledger.ledger_transaction_id=
                    protection.protected_ledger_transaction_id
                and ledger.transaction_type='provider_charge'
                and ledger.currency='NGN'
                and ledger.reference_type='booking_payment'
                and ledger.reference_id=payment.id::text
                and provider_event.provider='paystack'
                and provider_event.event_type='charge.success'
                and provider_event.provider_reference=
                    protection.paystack_reference
                and provider_event.processing_status='processed'
                and provider_event.processed_at is not null
            )
        )
    ) into v_direct_valid;
    return jsonb_build_object(
      'authorized',v_direct_valid,
      'reason',case when v_direct_valid then 'current' else 'protection_mismatch' end,
      'mode','direct'
    );
  end if;

  -- Shared accommodation has one protection component per accepted payer.
  -- It must never be forced into one person's reservation protection ID.
  v_component_type:=case when v_short
    then 'short_let_stay' else 'long_let_payment' end;

  select exists(
      select 1 from public.shared_payment_groups payment_group
      where payment_group.shared_payment_group_id=p_shared_payment_group_id
        and payment_group.reservation_id=p_reservation_id
        and payment_group.listing_id=p_listing_id
        and payment_group.product_type=case when v_short then 'short_let' else 'long_let' end
        and payment_group.status='fully_paid'
    ),
    count(*) filter(where member.invitation_state='accepted')::integer,
    count(*) filter(
      where member.invitation_state='accepted'
        and member.payment_state='paid'
    )::integer,
    count(*) filter(
      where member.invitation_state='accepted'
        and member.payment_state='paid'
        and component.component_id is not null
        and protection.id is not null
        and component.amount=protection.amount_total
        and protection.subject_type=component.component_type
        and protection.subject_id like
          'shared:'||member.shared_payment_member_id::text||':%'
        and protection.payer_user_id=member.user_id
        and protection.paystack_reference=component.provider_reference
        and protection.status=protection.protection_state
        and protection.protection_state=any(v_allowed_states)
        and protection.protected_ledger_transaction_id is not null
        and exists(
          select 1 from public.booking_payments payment
          where payment.paystack_reference=component.provider_reference
            and payment.purpose='shared_housing_share'
            and payment.listing_id=p_listing_id
            and payment.metadata->>'canonical_shared_payment_group_id'
              =p_shared_payment_group_id::text
            and payment.metadata->>'canonical_shared_payment_member_id'
              =member.shared_payment_member_id::text
            and payment.status in ('paid','completed')
            and payment.verified_at is not null
            and coalesce(payment.webhook_processed,false)
            and coalesce(payment.payer_user_id,payment.user_id)=member.user_id
            and upper(coalesce(payment.currency,'NGN'))='NGN'
            and round(coalesce(payment.verified_amount,0),2)
              =round(coalesce(payment.amount_total,payment.amount,0),2)
            and exists(
              select 1
              from public.ledger_transactions ledger
              join public.verified_provider_events provider_event
                on provider_event.provider_event_id=ledger.provider_event_id
              where ledger.ledger_transaction_id=
                    protection.protected_ledger_transaction_id
                and ledger.transaction_type='provider_charge'
                and ledger.currency='NGN'
                and ledger.reference_type='booking_payment'
                and ledger.reference_id=payment.id::text
                and provider_event.provider='paystack'
                and provider_event.event_type='charge.success'
                and provider_event.provider_reference=
                    component.provider_reference
                and provider_event.processing_status='processed'
                and provider_event.processed_at is not null
            )
        )
    )::integer,
    round(coalesce(sum(component.amount) filter(
      where member.invitation_state='accepted'
        and member.payment_state='paid'
    ),0),2)
  into v_group_valid,v_accepted_count,v_paid_member_count,
    v_protected_count,v_component_total
  from public.shared_payment_members member
  left join public.shared_payment_protection_components component
    on component.shared_payment_group_id=member.shared_payment_group_id
    and component.shared_payment_member_id=member.shared_payment_member_id
    and component.component_type=v_component_type
    and component.provider_reference=member.provider_reference
  left join public.payment_protection_transactions protection
    on protection.id=component.payment_protection_id
  where member.shared_payment_group_id=p_shared_payment_group_id;

  v_group_valid:=v_group_valid
    and v_accepted_count>=2
    and v_paid_member_count=v_accepted_count
    and v_protected_count=v_accepted_count
    and round(coalesce(p_expected_protected_amount,0),2)>0
    and v_component_total=round(p_expected_protected_amount,2);

  return jsonb_build_object(
    'authorized',v_group_valid,
    'reason',case when v_group_valid then 'current'
      when not v_group_valid and v_component_type='long_let_payment'
        and v_protected_count=0 then 'shared_long_let_protection_incomplete'
      else 'shared_protection_mismatch' end,
    'mode','shared',
    'accepted_member_count',v_accepted_count,
    'paid_member_count',v_paid_member_count,
    'protected_member_count',v_protected_count,
    'component_total',v_component_total
  );
end;
$$;

revoke all on function public.accommodation_access_authorization(
  text,text,text,text,text,text,timestamptz,text,timestamptz,text,uuid,uuid,uuid,numeric,text
) from public,anon,authenticated;
grant execute on function public.accommodation_access_authorization(
  text,text,text,text,text,text,timestamptz,text,timestamptz,text,uuid,uuid,uuid,numeric,text
) to service_role;

-- A trigger protects future writes, but it does not validate rows that already
-- exist when this migration is installed. Refuse deployment if any legacy row
-- has already started arrival/occupancy without the same authorization that
-- the runtime guard and exact-location read model require.
do $$
declare
  reservation_row public.reservations;
  decision jsonb;
  access_kind text;
begin
  for reservation_row in
    select reservation.*
    from public.reservations reservation
    where reservation.status in ('occupied','completed')
      or reservation.occupancy_started_at is not null
      or reservation.tenancy_start_date is not null
      or (
        reservation.stay_type='short_let'
        and (
          reservation.checked_in_at is not null
          or reservation.canonical_state in ('checked_in','checked_out','completed')
        )
      )
      or (
        coalesce(reservation.stay_type,'long_stay')<>'short_let'
        and (
          reservation.verified_handover_at is not null
          or reservation.handover_confirmed_by_customer_at is not null
          or reservation.canonical_state in ('handover_verified','active')
        )
      )
      or (
        reservation.requested_move_in_at is not null
        and reservation.status not in (
          'cancelled','expired','refunded','payment_conflict'
        )
      )
  loop
    access_kind:=case
      when reservation_row.status in ('occupied','completed')
        or reservation_row.occupancy_started_at is not null
        or reservation_row.tenancy_start_date is not null
        or reservation_row.checked_in_at is not null
        or reservation_row.verified_handover_at is not null
        or reservation_row.handover_confirmed_by_customer_at is not null
        or reservation_row.canonical_state in (
          'checked_in','checked_out','completed','handover_verified','active'
        )
      then 'location' else 'handover' end;

    decision:=public.accommodation_access_authorization(
      reservation_row.id,reservation_row.listing_id,reservation_row.user_id,
      reservation_row.stay_type,reservation_row.status,
      reservation_row.manual_payment_status,reservation_row.paid_at,
      reservation_row.rent_payment_status,reservation_row.rent_paid_at,
      reservation_row.rent_payment_reference,
      reservation_row.stay_payment_protection_id,
      reservation_row.year_one_rent_protection_id,
      reservation_row.shared_payment_group_id,
      case when reservation_row.stay_type='short_let'
        then reservation_row.stay_rent_total
        else coalesce(
          reservation_row.upfront_rent_required,
          reservation_row.annual_rent_snapshot
        )
      end,
      access_kind
    );
    if not coalesce((decision->>'authorized')::boolean,false) then
      raise exception
        'Existing accommodation % must be reconciled before protected handover enforcement (%)',
        reservation_row.id,coalesce(decision->>'reason','unknown');
    end if;
  end loop;
end;
$$;

create or replace function public.enforce_protected_accommodation_handover()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_short boolean:=coalesce(new.stay_type,'long_stay')='short_let';
  v_access_active boolean:=false;
  v_starting_access boolean:=false;
  v_authorization jsonb;
begin
  if new.status='completed'
    and (tg_op='INSERT' or coalesce(old.status,'') not in ('occupied','completed'))
  then
    raise exception 'Accommodation cannot complete before recorded occupancy';
  end if;

  if v_short
    and new.canonical_state in ('checked_out','completed')
    and (tg_op='INSERT'
      or coalesce(old.canonical_state,'') not in ('checked_in','checked_out','completed'))
  then
    raise exception 'Short Let cannot finish before recorded check-in';
  end if;

  if not v_short
    and new.canonical_state='active'
    and (tg_op='INSERT'
      or coalesce(old.canonical_state,'') not in ('handover_verified','active'))
  then
    raise exception 'Long Let cannot become active before verified handover';
  end if;

  -- Reject every way the reservation can begin arrival or occupancy. Once
  -- arrival has begun, re-check mutations of the authorization inputs too so
  -- a valid link cannot be swapped for an unrelated payment or protection.
  v_starting_access:=
    (new.requested_move_in_at is not null
      and new.status not in ('occupied','completed')
      and (tg_op='INSERT' or old.requested_move_in_at is distinct from new.requested_move_in_at))
    or (new.status='occupied'
      and (tg_op='INSERT' or old.status is distinct from new.status))
    or (new.occupancy_started_at is not null
      and (tg_op='INSERT' or old.occupancy_started_at is null))
    or (new.tenancy_start_date is not null
      and (tg_op='INSERT' or old.tenancy_start_date is null))
    or (v_short
      and new.checked_in_at is not null
      and (tg_op='INSERT' or old.checked_in_at is null))
    or (v_short
      and new.canonical_state='checked_in'
      and (tg_op='INSERT' or old.canonical_state is distinct from new.canonical_state))
    or (not v_short
      and new.verified_handover_at is not null
      and (tg_op='INSERT' or old.verified_handover_at is null))
    or (not v_short
      and new.handover_confirmed_by_customer_at is not null
      and (tg_op='INSERT' or old.handover_confirmed_by_customer_at is null))
    or (not v_short
      and new.canonical_state='handover_verified'
      and (tg_op='INSERT' or old.canonical_state is distinct from new.canonical_state));

  v_access_active:=new.status in ('occupied','completed')
    or new.occupancy_started_at is not null
    or new.tenancy_start_date is not null
    or (v_short and new.checked_in_at is not null)
    or (v_short and new.canonical_state in ('checked_in','checked_out','completed'))
    or (not v_short and new.verified_handover_at is not null)
    or (not v_short and new.handover_confirmed_by_customer_at is not null)
    or (not v_short and new.canonical_state in ('handover_verified','active'))
    or (new.requested_move_in_at is not null
      and new.status not in ('cancelled','expired','refunded','payment_conflict'));

  if not v_access_active then return new; end if;

  v_authorization:=public.accommodation_access_authorization(
    new.id,new.listing_id,new.user_id,new.stay_type,new.status,
    new.manual_payment_status,new.paid_at,
    new.rent_payment_status,new.rent_paid_at,new.rent_payment_reference,
    new.stay_payment_protection_id,new.year_one_rent_protection_id,
    new.shared_payment_group_id,
    case when v_short then new.stay_rent_total
      else coalesce(new.upfront_rent_required,new.annual_rent_snapshot) end,
    case when v_starting_access then 'handover' else 'location' end
  );

  if not coalesce((v_authorization->>'authorized')::boolean,false) then
    raise exception 'Current Payment Protection is required before accommodation arrival or handover (%)',
      coalesce(v_authorization->>'reason','unknown');
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_protected_accommodation_handover() from public;

drop trigger if exists reservations_require_protected_accommodation_handover
on public.reservations;
create trigger reservations_require_protected_accommodation_handover
before insert or update of
  requested_move_in_at,status,canonical_state,verified_handover_at,
  handover_confirmed_by_customer_at,tenancy_start_date,
  occupancy_started_at,checked_in_at,manual_payment_status,paid_at,
  rent_payment_status,rent_paid_at,rent_payment_reference,
  stay_payment_protection_id,year_one_rent_protection_id,
  shared_payment_group_id,stay_type,user_id,listing_id,
  stay_rent_total,upfront_rent_required,annual_rent_snapshot
on public.reservations
for each row
execute function public.enforce_protected_accommodation_handover();

-- Use the same authorization decision for the public listing read model.
-- A protected shared stay belongs to every accepted payer, while an unrelated
-- or merely-paid reservation must never disclose the exact entrance.
create or replace function public.get_public_listing_detail(p_listing_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_listing public.listings;
  v_actor public.profiles;
  v_partner_name text;
  v_internal boolean:=false;
  v_paid boolean:=false;
begin
  select * into v_listing
  from public.listings listing
  where (listing.id::text=p_listing_id or listing.listing_id=p_listing_id)
    and listing.deleted_at is null
  limit 1;
  if v_listing.id is null then return null; end if;

  select coalesce(nullif(btrim(profile.full_name),''),nullif(btrim(profile.username),''))
  into v_partner_name
  from public.profiles profile
  where profile.user_id=coalesce(v_listing.partner_id,v_listing.owner_id);

  select * into v_actor
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;

  if v_actor.user_id is not null then
    v_internal:=v_listing.owner_id=v_actor.user_id
      or v_listing.partner_id=v_actor.user_id
      or v_actor.role='creator'
      or (v_actor.role='admin' and public.current_actor_in_scope(v_listing.state,v_listing.city))
      or (
        v_actor.role='staff'
        and public.current_staff_has_permission('operations')
        and public.current_actor_in_scope(v_listing.state,v_listing.city)
      );

    v_paid:=exists(
      select 1
      from public.reservations reservation
      where reservation.listing_id in (v_listing.id::text,v_listing.listing_id)
        and reservation.status in (
          'reserved','inspection_pending','ready_for_move_in','occupied','completed'
        )
        and (
          reservation.user_id=v_actor.user_id
          or (
            reservation.shared_payment_group_id is not null
            and exists(
              select 1
              from public.shared_payment_members member
              where member.shared_payment_group_id=reservation.shared_payment_group_id
                and member.user_id=v_actor.user_id
                and member.invitation_state='accepted'
                and member.payment_state='paid'
            )
          )
        )
        and coalesce((public.accommodation_access_authorization(
          reservation.id,reservation.listing_id,reservation.user_id,
          reservation.stay_type,reservation.status,
          reservation.manual_payment_status,reservation.paid_at,
          reservation.rent_payment_status,reservation.rent_paid_at,
          reservation.rent_payment_reference,
          reservation.stay_payment_protection_id,
          reservation.year_one_rent_protection_id,
          reservation.shared_payment_group_id,
          case when reservation.stay_type='short_let'
            then reservation.stay_rent_total
            else coalesce(reservation.upfront_rent_required,reservation.annual_rent_snapshot)
          end,
          'location'
        )->>'authorized')::boolean,false)
    );
  end if;

  if not v_internal
    and not v_paid
    and not (v_listing.status='available' and v_listing.availability_status='available')
  then return null; end if;

  if v_internal then
    return to_jsonb(v_listing)||jsonb_build_object(
      'location_exact',true,
      'partner_display_name',v_partner_name
    );
  end if;

  return (
    to_jsonb(v_listing)
      -'address'-'gps_latitude'-'gps_longitude'-'location_accuracy_m'
      -'owner_id'-'partner_id'-'chat_agent_id'-'contact_phone'
      -'reserved_by'-'occupied_by'-'current_reservation_id'
      -'inspection_request_id'
  )||jsonb_build_object(
    'address',case when v_paid then v_listing.address else null end,
    'gps_latitude',case
      when v_listing.gps_latitude is null then null
      when v_paid then v_listing.gps_latitude
      else round(v_listing.gps_latitude,2)
    end,
    'gps_longitude',case
      when v_listing.gps_longitude is null then null
      when v_paid then v_listing.gps_longitude
      else round(v_listing.gps_longitude,2)
    end,
    'location_accuracy_m',case when v_paid then v_listing.location_accuracy_m else null end,
    'location_exact',v_paid,
    'partner_display_name',v_partner_name
  );
end;
$$;

revoke all on function public.get_public_listing_detail(text) from public;
grant execute on function public.get_public_listing_detail(text)
to authenticated,service_role;

-- Shared Long Let contract checkout has no complete per-payer rent protection
-- implementation. Stop before a Paystack reference is created; charging first
-- would leave a fully-paid group unable to pass handover safely.
create or replace function public.start_my_shared_contract_split(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  perform p_group_id;
  raise exception using
    message='Shared Long Let contract payment is temporarily unavailable',
    detail='Each payer needs a canonical rent protection component before checkout can reopen.',
    hint='Use one payer for this Long Let or complete the shared rent protection implementation.';
end;
$$;
