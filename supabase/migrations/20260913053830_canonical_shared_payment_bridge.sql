-- Replace the disconnected two-person shared-home generation with one
-- capacity-safe canonical checkout while preserving its current UI/RPC names.
-- A property share in chat is unrelated and is implemented separately.

alter table public.shared_housing_groups
  add column if not exists product_type text,
  add column if not exists canonical_group_id uuid,
  add column if not exists stay_check_in date,
  add column if not exists stay_check_out date,
  add column if not exists guest_count integer,
  add column if not exists checkout_attempt integer not null default 1;
alter table public.shared_housing_groups
  drop constraint if exists shared_housing_groups_status_check;
alter table public.shared_housing_groups
  add constraint shared_housing_groups_status_check check(status in(
    'inviting','ready','payment_pending','paid','cancelled','expired',
    'refunding','refunded'
  ));
alter table public.shared_housing_groups
  drop constraint if exists shared_housing_groups_payment_phase_check;
alter table public.shared_housing_groups
  add constraint shared_housing_groups_payment_phase_check check(payment_phase in(
    'reservation_fee','contract_rent','short_stay','complete'
  ));
alter table public.shared_housing_groups
  drop constraint if exists shared_housing_groups_member_limit_check;
alter table public.shared_housing_groups
  add constraint shared_housing_groups_member_limit_check
  check(member_limit between 2 and 12);

alter table public.shared_housing_members
  add column if not exists canonical_member_id uuid,
  add column if not exists eligible_partner_share numeric(12,2) not null default 0,
  add column if not exists refundable_share numeric(12,2) not null default 0;

alter table public.shared_payment_groups
  add column if not exists legacy_group_id uuid,
  add column if not exists conversation_id uuid,
  add column if not exists payment_phase text,
  add column if not exists stay_check_in date,
  add column if not exists stay_check_out date,
  add column if not exists guest_count integer,
  add column if not exists checkout_attempt integer not null default 1;
create unique index if not exists shared_payment_groups_legacy_unique
  on public.shared_payment_groups(legacy_group_id)
  where legacy_group_id is not null;

alter table public.shared_payment_members
  add column if not exists legacy_member_id uuid,
  add column if not exists eligible_partner_share numeric(12,2) not null default 0,
  add column if not exists refundable_share numeric(12,2) not null default 0;
create unique index if not exists shared_payment_members_legacy_unique
  on public.shared_payment_members(legacy_member_id)
  where legacy_member_id is not null;

alter table public.reservations
  add column if not exists shared_payment_group_id uuid;

-- Current rows stay readable and acquire canonical identity without changing
-- their payment or reservation state.
insert into public.shared_payment_groups(
  shared_payment_group_id,product_type,listing_id,reservation_id,created_by,
  total_amount,capacity,status,checkout_expires_at,legacy_group_id,
  conversation_id,payment_phase,stay_check_in,stay_check_out,guest_count,
  checkout_attempt,created_at,updated_at
)
select g.id,
  case when l.sub_type='short_let' then 'short_let' else 'long_let' end,
  g.listing_id::text,g.reservation_id,g.created_by,g.total_amount,
  greatest(g.member_limit,2),
  case g.status when 'payment_pending' then 'checkout_open'
    when 'paid' then 'fully_paid' else g.status end,
  g.expires_at,g.id,g.conversation_id,g.payment_phase,
  r.stay_check_in,r.stay_check_out,r.guest_count,g.checkout_attempt,
  g.created_at,g.updated_at
from public.shared_housing_groups g
join public.listings l on l.id=g.listing_id
left join public.reservations r on r.id=g.reservation_id
on conflict(shared_payment_group_id) do nothing;

insert into public.shared_payment_members(
  shared_payment_member_id,shared_payment_group_id,user_id,share_amount,
  invitation_state,payment_state,provider_reference,paid_at,legacy_member_id,
  eligible_partner_share,refundable_share,created_at,updated_at
)
select m.id,m.group_id,m.user_id,greatest(m.share_amount,0.01),
  m.invitation_status,
  case m.payment_status when 'pending' then 'provider_pending'
    else m.payment_status end,
  m.payment_reference,m.paid_at,m.id,m.eligible_partner_share,
  m.refundable_share,m.created_at,m.updated_at
from public.shared_housing_members m
join public.shared_payment_groups g on g.shared_payment_group_id=m.group_id
on conflict(shared_payment_group_id,user_id) do nothing;

update public.shared_housing_groups
set product_type=coalesce(product_type,
      (select case when l.sub_type='short_let' then 'short_let' else 'long_let' end
       from public.listings l where l.id=shared_housing_groups.listing_id)),
    canonical_group_id=coalesce(canonical_group_id,id)
where canonical_group_id is null or product_type is null;
update public.shared_housing_members
set canonical_member_id=coalesce(canonical_member_id,id)
where canonical_member_id is null;
update public.reservations r set shared_payment_group_id=g.id
from public.shared_housing_groups g
where g.reservation_id=r.id and r.shared_payment_group_id is null;

create table if not exists public.shared_payment_protection_components(
  component_id uuid primary key default gen_random_uuid(),
  shared_payment_group_id uuid not null
    references public.shared_payment_groups(shared_payment_group_id) on delete restrict,
  shared_payment_member_id uuid not null
    references public.shared_payment_members(shared_payment_member_id) on delete restrict,
  payment_protection_id uuid not null unique
    references public.payment_protection_transactions(id) on delete restrict,
  component_type text not null check(component_type in(
    'reservation_fee','long_let_payment','short_let_stay','short_let_caution'
  )),
  amount numeric(12,2) not null check(amount>0),
  provider_reference text not null,
  created_at timestamptz not null default now(),
  unique(shared_payment_member_id,component_type,provider_reference)
);
alter table public.shared_payment_protection_components enable row level security;
revoke all on table public.shared_payment_protection_components
from public,anon,authenticated;
grant all on table public.shared_payment_protection_components to service_role;
create policy shared_payment_protection_components_service_only
on public.shared_payment_protection_components for all to service_role
using(true) with check(true);

create or replace function public.create_my_shared_housing_group_v2(
  p_listing_id uuid,
  p_conversation_ids uuid[],
  p_check_in date default null,
  p_check_out date default null,
  p_guest_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_listing public.listings;
  v_conversation public.conversations;
  v_conversation_id uuid;
  v_peer text;
  v_peers text[]:='{}'::text[];
  v_people text[];
  v_capacity integer;
  v_member_count integer;
  v_total numeric(12,2);
  v_eligible numeric(12,2):=0;
  v_refundable numeric(12,2):=0;
  v_fee numeric(12,2);
  v_nights integer;
  v_min_nights integer;
  v_max_nights integer;
  v_reservation public.reservations;
  v_group_id uuid:=gen_random_uuid();
  v_member_id uuid;
  v_share numeric(12,2);
  v_eligible_share numeric(12,2);
  v_refundable_share numeric(12,2);
  v_assigned numeric(12,2):=0;
  v_eligible_assigned numeric(12,2):=0;
  v_refundable_assigned numeric(12,2):=0;
  v_index integer;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'An active Personal account is required';
  end if;
  if coalesce(cardinality(p_conversation_ids),0)<1 then
    raise exception 'Choose at least one connected roommate';
  end if;

  select * into v_listing from public.listings
  where id=p_listing_id and deleted_at is null for update;
  if v_listing.id is null or v_listing.property_type<>'apartment'
    or v_listing.status<>'available' or v_listing.availability_status<>'available' then
    raise exception 'This property is unavailable';
  end if;
  if v_listing.sub_type not in('long_stay','short_let') then
    raise exception 'Shared payment is available only for Long Let or Short Let';
  end if;
  v_capacity:=case when v_listing.sub_type='short_let'
    then coalesce(v_listing.max_guests,0) else coalesce(v_listing.max_occupants,0) end;
  if v_capacity<2 then raise exception 'This property cannot accept two paying guests or occupants'; end if;

  foreach v_conversation_id in array p_conversation_ids loop
    select * into v_conversation from public.conversations
    where id=v_conversation_id and conversation_type='roommate'
      and coalesce(status,'active') in('active','accepted')
      and v_actor.user_id in(participant_a,participant_b);
    if v_conversation.id is null then
      raise exception 'Every person must have an accepted roommate conversation';
    end if;
    v_peer:=case when v_conversation.participant_a=v_actor.user_id
      then v_conversation.participant_b else v_conversation.participant_a end;
    if v_peer=any(v_peers) then raise exception 'Choose each roommate once'; end if;
    if exists(select 1 from public.roommate_user_blocks b
      where (b.blocker_user_id=v_actor.user_id and b.blocked_user_id=v_peer)
         or (b.blocker_user_id=v_peer and b.blocked_user_id=v_actor.user_id)) then
      raise exception 'A blocked roommate cannot join a shared payment';
    end if;
    v_peers:=array_append(v_peers,v_peer);
  end loop;
  v_people:=array_prepend(v_actor.user_id,v_peers);
  v_member_count:=cardinality(v_people);
  if v_member_count>v_capacity then
    raise exception 'This property accepts only % guests or occupants',v_capacity;
  end if;
  if v_member_count>12 then raise exception 'A shared payment supports up to 12 people'; end if;
  if exists(
    select 1 from public.shared_housing_groups g
    join public.shared_housing_members m on m.group_id=g.id
    where g.listing_id=v_listing.id and m.user_id=v_actor.user_id
      and g.status not in('cancelled','expired','refunded')
  ) then raise exception 'You already have an active shared payment for this property'; end if;

  if v_listing.sub_type='short_let' then
    if p_check_in is null or p_check_out is null or p_check_in<current_date
      or p_check_out<=p_check_in then raise exception 'Choose valid Short Let dates'; end if;
    select coalesce(nullif(value,'')::integer,1) into v_min_nights
    from public.platform_settings where key='short_stay_min_nights'
      and coalesce(is_active,true) limit 1;
    select coalesce(nullif(value,'')::integer,90) into v_max_nights
    from public.platform_settings where key='short_stay_max_nights'
      and coalesce(is_active,true) limit 1;
    v_min_nights:=greatest(coalesce(v_min_nights,1),1);
    v_max_nights:=greatest(coalesce(v_max_nights,90),v_min_nights);
    v_nights:=p_check_out-p_check_in;
    if v_nights<v_min_nights or v_nights>v_max_nights then
      raise exception 'Short Let must be between % and % nights',v_min_nights,v_max_nights;
    end if;
    if coalesce(p_guest_count,v_member_count)<v_member_count
      or coalesce(p_guest_count,v_member_count)>v_capacity then
      raise exception 'Guest count must include every paying roommate and fit the property';
    end if;
    select * into v_reservation from public.create_short_stay_reservation(
      v_listing.id::text,p_check_in,p_check_out,coalesce(p_guest_count,v_member_count)
    );
    update public.reservations set
      payment_expires_at=now()+interval '72 hours',
      shared_payment_group_id=v_group_id,updated_at=now()
    where id=v_reservation.id returning * into v_reservation;
    v_eligible:=round(v_reservation.stay_rent_total,2);
    v_refundable:=round(coalesce(v_reservation.security_deposit_snapshot,0),2);
    v_total:=v_eligible+v_refundable;
  else
    select coalesce(nullif(value,'')::numeric,10000) into v_fee
    from public.platform_settings where key='reservation_fee'
      and coalesce(is_active,true) limit 1;
    v_total:=round(coalesce(v_fee,10000),2);
    if v_total<=0 then raise exception 'Creator reservation fee is not configured'; end if;
    v_refundable:=v_total;
  end if;

  insert into public.shared_housing_groups(
    id,listing_id,created_by,status,member_limit,total_amount,conversation_id,
    payment_phase,reservation_fee_total,contract_total,expires_at,
    reservation_id,product_type,canonical_group_id,stay_check_in,stay_check_out,
    guest_count,checkout_attempt,created_at,updated_at
  ) values(
    v_group_id,v_listing.id,v_actor.user_id,'inviting',v_member_count,v_total,
    case when cardinality(p_conversation_ids)=1 then p_conversation_ids[1] else null end,
    case when v_listing.sub_type='short_let' then 'short_stay' else 'reservation_fee' end,
    case when v_listing.sub_type='long_stay' then v_total else 0 end,
    case when v_listing.sub_type='long_stay' then
      round(v_listing.price+coalesce(v_listing.security_deposit_amount,0),2)
      else v_total end,
    now()+interval '72 hours',v_reservation.id,
    case when v_listing.sub_type='short_let' then 'short_let' else 'long_let' end,
    v_group_id,p_check_in,p_check_out,coalesce(p_guest_count,v_member_count),1,now(),now()
  );
  insert into public.shared_payment_groups(
    shared_payment_group_id,product_type,listing_id,reservation_id,created_by,
    total_amount,capacity,status,checkout_expires_at,legacy_group_id,
    conversation_id,payment_phase,stay_check_in,stay_check_out,guest_count,
    checkout_attempt,created_at,updated_at
  ) values(
    v_group_id,case when v_listing.sub_type='short_let' then 'short_let' else 'long_let' end,
    v_listing.id::text,v_reservation.id,v_actor.user_id,v_total,v_capacity,
    'inviting',now()+interval '72 hours',v_group_id,
    case when cardinality(p_conversation_ids)=1 then p_conversation_ids[1] else null end,
    case when v_listing.sub_type='short_let' then 'short_stay' else 'reservation_fee' end,
    p_check_in,p_check_out,coalesce(p_guest_count,v_member_count),1,now(),now()
  );

  for v_index in 1..v_member_count loop
    v_member_id:=gen_random_uuid();
    v_share:=case when v_index=v_member_count then v_total-v_assigned
      else round(v_total/v_member_count,2) end;
    v_eligible_share:=case when v_index=v_member_count then v_eligible-v_eligible_assigned
      else round(v_eligible/v_member_count,2) end;
    v_refundable_share:=case when v_index=v_member_count then v_refundable-v_refundable_assigned
      else round(v_refundable/v_member_count,2) end;
    insert into public.shared_housing_members(
      id,group_id,user_id,invitation_status,share_amount,payment_status,
      canonical_member_id,eligible_partner_share,refundable_share,created_at,updated_at
    ) values(
      v_member_id,v_group_id,v_people[v_index],
      case when v_index=1 then 'accepted' else 'invited' end,
      v_share,'not_started',v_member_id,v_eligible_share,v_refundable_share,now(),now()
    );
    insert into public.shared_payment_members(
      shared_payment_member_id,shared_payment_group_id,user_id,share_amount,
      invitation_state,payment_state,legacy_member_id,eligible_partner_share,
      refundable_share,created_at,updated_at
    ) values(
      v_member_id,v_group_id,v_people[v_index],v_share,
      case when v_index=1 then 'accepted' else 'invited' end,
      'not_started',v_member_id,v_eligible_share,v_refundable_share,now(),now()
    );
    v_assigned:=v_assigned+v_share;
    v_eligible_assigned:=v_eligible_assigned+v_eligible_share;
    v_refundable_assigned:=v_refundable_assigned+v_refundable_share;
  end loop;
  return public.get_my_shared_housing_group(v_group_id);
end
$$;

create or replace function public.create_my_shared_housing_group(
  p_listing_id uuid,p_conversation_id uuid
)
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','public'
as $$
  select public.create_my_shared_housing_group_v2(
    p_listing_id,array[p_conversation_id]::uuid[],null,null,null
  )
$$;

create or replace function public.respond_to_shared_housing_invite(
  p_group_id uuid,p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_group public.shared_housing_groups;
begin
  select * into v_group from public.shared_housing_groups where id=p_group_id for update;
  if v_group.id is null or v_group.status<>'inviting' or v_group.expires_at<=now() then
    raise exception 'Pending shared-payment invitation not found';
  end if;
  update public.shared_housing_members set
    invitation_status=case when p_accept then 'accepted' else 'declined' end,
    updated_at=now()
  where group_id=p_group_id and user_id=v_actor and invitation_status='invited';
  if not found then raise exception 'Pending shared-payment invitation not found'; end if;
  update public.shared_payment_members set
    invitation_state=case when p_accept then 'accepted' else 'declined' end,
    updated_at=now()
  where shared_payment_group_id=p_group_id and user_id=v_actor;
  if not p_accept then
    update public.shared_housing_groups set status='cancelled',updated_at=now()
    where id=p_group_id;
    update public.shared_payment_groups set status='cancelled',updated_at=now()
    where shared_payment_group_id=p_group_id;
    update public.reservations set status='cancelled',canonical_state='cancelled',updated_at=now()
    where id=v_group.reservation_id and status='payment_pending';
  elsif not exists(
    select 1 from public.shared_housing_members
    where group_id=p_group_id and invitation_status<>'accepted'
  ) then
    update public.shared_housing_groups set
      status='payment_pending',expires_at=now()+interval '30 minutes',updated_at=now()
    where id=p_group_id;
    update public.shared_payment_groups set
      status='checkout_open',checkout_expires_at=now()+interval '30 minutes',updated_at=now()
    where shared_payment_group_id=p_group_id;
    update public.reservations set payment_expires_at=now()+interval '30 minutes',updated_at=now()
    where id=v_group.reservation_id and status='payment_pending';
  end if;
  return public.get_my_shared_housing_group(p_group_id);
end
$$;

create or replace function public.create_my_shared_housing_payment(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_member public.shared_housing_members;
  v_group public.shared_housing_groups;
  v_reference text;
  v_subject_id text;
begin
  select * into v_group from public.shared_housing_groups where id=p_group_id for update;
  select * into v_member from public.shared_housing_members
  where group_id=p_group_id and user_id=v_actor for update;
  if v_group.id is null or v_member.id is null then raise exception 'Shared-payment access required'; end if;
  if v_group.status<>'payment_pending' or v_member.invitation_status<>'accepted'
    or exists(select 1 from public.shared_housing_members
      where group_id=p_group_id and invitation_status<>'accepted') then
    raise exception 'Every roommate must accept before payment';
  end if;
  if v_group.expires_at<=now() then raise exception 'This 30-minute shared checkout expired'; end if;
  if v_member.payment_status='paid' then return jsonb_build_object('already_paid',true); end if;
  v_reference:='WH-SH-'||upper(replace(gen_random_uuid()::text,'-',''));
  v_subject_id:=v_member.id::text||':'||v_group.payment_phase||':'||v_group.checkout_attempt;
  update public.shared_housing_members set
    payment_status='pending',payment_reference=v_reference,updated_at=now()
  where id=v_member.id;
  update public.shared_payment_members set
    payment_state='provider_pending',provider_reference=v_reference,updated_at=now()
  where shared_payment_member_id=v_member.canonical_member_id;
  insert into public.booking_payments(
    payment_reference,paystack_reference,user_id,payer_user_id,type,booking_type,
    listing_id,amount,amount_total,currency,status,purpose,metadata,created_at,updated_at
  ) values(
    v_reference,v_reference,v_actor,v_actor,'shared_housing','shared_housing',
    v_group.listing_id::text,v_member.share_amount,v_member.share_amount,'NGN',
    'pending','shared_housing_share',jsonb_build_object(
      'shared_group_id',p_group_id,
      'shared_member_id',v_subject_id,
      'legacy_shared_member_id',v_member.id,
      'canonical_shared_payment_group_id',v_group.canonical_group_id,
      'canonical_shared_payment_member_id',v_member.canonical_member_id,
      'canonical_product_type',v_group.product_type,
      'payment_phase',v_group.payment_phase,
      'checkout_attempt',v_group.checkout_attempt,
      'eligible_partner_amount',v_member.eligible_partner_share,
      'refundable_amount',v_member.refundable_share,
      'reservation_id',v_group.reservation_id
    ),now(),now()
  );
  return jsonb_build_object(
    'reference',v_reference,'amount',v_member.share_amount,
    'payment_phase',v_group.payment_phase,'expires_at',v_group.expires_at,
    'product_type',v_group.product_type
  );
end
$$;

create or replace function public.confirm_shared_housing_payment(
  p_reference text,p_transaction_id text,p_verified_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_payment public.booking_payments;
  v_member public.shared_housing_members;
  v_group public.shared_housing_groups;
  v_listing public.listings;
  v_reservation public.reservations;
  v_reservation_id text;
  v_creator text;
begin
  select * into v_payment from public.booking_payments
  where paystack_reference=p_reference and purpose='shared_housing_share' for update;
  if v_payment.id is null then raise exception 'Shared payment not found'; end if;
  if v_payment.status in('paid','completed') then
    return jsonb_build_object('success',true,'already_processed',true); end if;
  if round(coalesce(v_payment.amount_total,v_payment.amount)*100)
    <>round(p_verified_amount*100) then raise exception 'Shared payment amount mismatch'; end if;
  select * into v_member from public.shared_housing_members
  where id=(v_payment.metadata->>'legacy_shared_member_id')::uuid for update;
  select * into v_group from public.shared_housing_groups
  where id=v_member.group_id for update;
  if v_member.id is null or v_group.id is null then raise exception 'Shared payment identity is missing'; end if;
  if v_payment.metadata->>'checkout_attempt'<>v_group.checkout_attempt::text then
    raise exception 'Shared payment belongs to an earlier checkout attempt'; end if;
  select * into v_listing from public.listings where id=v_group.listing_id for update;

  update public.booking_payments set
    status='paid',paystack_transaction_id=p_transaction_id,
    verified_amount=p_verified_amount,verified_at=now(),paid_at=now(),
    webhook_processed=true,verification_source='webhook',updated_at=now()
  where id=v_payment.id;
  update public.shared_housing_members set payment_status='paid',paid_at=now(),updated_at=now()
  where id=v_member.id;
  update public.shared_payment_members set payment_state='paid',paid_at=now(),updated_at=now()
  where shared_payment_member_id=v_member.canonical_member_id;

  -- The Long Let reservation charge is refundable if the coordinated checkout
  -- fails, so it receives a zero-commission protected balance for this attempt.
  if v_group.product_type='long_let' and v_group.payment_phase='reservation_fee' then
    select user_id into v_creator from public.profiles
    where role='creator' and not coalesce(deleted,false) order by created_at limit 1;
    if v_creator is null then raise exception 'Creator financial authority is unavailable'; end if;
    insert into public.payment_protection_transactions(
      booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
      amount_commission,amount_payee,commission_rate,status,paystack_reference,
      protection_state,subject_type,subject_id
    ) values(
      null,'shared_reservation_fee',v_member.user_id,v_creator,v_member.share_amount,
      0,v_member.share_amount,0,'protected',p_reference,'awaiting_funds',
      'shared_housing_share',v_payment.metadata->>'shared_member_id'
    ) on conflict(subject_type,subject_id) do update
      set paystack_reference=excluded.paystack_reference,updated_at=now();
  end if;

  if not exists(
    select 1 from public.shared_housing_members
    where group_id=v_group.id and invitation_status='accepted' and payment_status<>'paid'
  ) then
    if now()>v_group.expires_at then
      update public.shared_housing_groups set status='refunding',updated_at=now()
      where id=v_group.id;
      update public.shared_payment_groups set status='refunding',updated_at=now()
      where shared_payment_group_id=v_group.canonical_group_id;
      return jsonb_build_object('success',true,'group_id',v_group.id,'refund_required',true);
    elsif v_group.product_type='long_let' and v_group.payment_phase='reservation_fee' then
      v_reservation_id:=gen_random_uuid()::text;
      insert into public.reservations(
        id,listing_id,user_id,listing_title,listing_price,listing_location,status,
        amount,currency,paid_at,manual_payment_status,reservation_type,stay_type,
        hold_expires_at,annual_rent_snapshot,contract_rent_total,
        upfront_rent_required,rent_payment_status,booking_code,occupant_count,
        canonical_state,shared_payment_group_id,created_at,updated_at
      ) values(
        v_reservation_id,v_listing.id::text,v_group.created_by,v_listing.title,
        v_listing.price,concat_ws(', ',v_listing.address,v_listing.city,v_listing.state),
        'reserved',v_group.reservation_fee_total,'NGN',now(),'paid','apartment','long_stay',
        now()+interval '3 days',v_listing.price,v_listing.price,
        v_listing.price+coalesce(v_listing.security_deposit_amount,0),'not_started',
        'WH-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
        (select count(*) from public.shared_housing_members
          where group_id=v_group.id and invitation_status='accepted'),
        'hold_active',v_group.id,now(),now()
      );
      update public.listings set status='reserved',availability_status='reserved',
        current_reservation_id=v_reservation_id,reserved_by=v_group.created_by,
        reservation_fee_paid=true,updated_at=now()
      where id=v_listing.id;
      update public.shared_housing_groups set
        status='paid',reservation_id=v_reservation_id,updated_at=now()
      where id=v_group.id;
      update public.shared_payment_groups set
        status='fully_paid',reservation_id=v_reservation_id,updated_at=now()
      where shared_payment_group_id=v_group.canonical_group_id;
    elsif v_group.product_type='short_let' and v_group.payment_phase='short_stay' then
      perform pg_advisory_xact_lock(hashtextextended('short-let:'||v_listing.id::text,0));
      if exists(select 1 from public.reservations other
        where other.listing_id=v_listing.id::text and other.id<>v_group.reservation_id
          and other.stay_type='short_let'
          and other.status=any(array['reserved','ready_for_move_in','occupied']::text[])
          and daterange(other.stay_check_in,other.stay_check_out,'[)')
            && daterange(v_group.stay_check_in,v_group.stay_check_out,'[)')) then
        update public.shared_housing_groups set status='refunding',updated_at=now()
        where id=v_group.id;
        update public.shared_payment_groups set status='refunding',updated_at=now()
        where shared_payment_group_id=v_group.canonical_group_id;
        update public.reservations set status='payment_conflict',canonical_state='payment_conflict',updated_at=now()
        where id=v_group.reservation_id;
        return jsonb_build_object('success',true,'group_id',v_group.id,'refund_required',true,'conflict',true);
      end if;
      update public.reservations set
        status='reserved',manual_payment_status='paid',paid_at=now(),
        rent_payment_status='paid',rent_paid_at=now(),canonical_state='payment_confirmed',
        security_deposit_status=case when coalesce(security_deposit_snapshot,0)>0
          then 'held' else 'not_required' end,payment_expires_at=null,updated_at=now()
      where id=v_group.reservation_id returning * into v_reservation;
      insert into public.short_let_booking_transitions(
        reservation_id,from_state,to_state,event_type,event_key,actor_user_id,
        actor_type,metadata
      ) values(
        v_reservation.id,'checkout_pending','payment_confirmed','shared_checkout_paid',
        'short-let-shared-paid:'||v_group.id,v_group.created_by,'customer',
        jsonb_build_object('shared_payment_group_id',v_group.id,
          'guest_count',v_group.guest_count,'date_specific_availability',true)
      ) on conflict(event_key) do nothing;
      update public.shared_housing_groups set status='paid',payment_phase='complete',updated_at=now()
      where id=v_group.id;
      update public.shared_payment_groups set status='fully_paid',updated_at=now()
      where shared_payment_group_id=v_group.canonical_group_id;
    else
      update public.reservations set rent_payment_status='paid',rent_paid_at=now(),updated_at=now()
      where id=v_group.reservation_id;
      update public.shared_housing_groups set status='paid',payment_phase='complete',updated_at=now()
      where id=v_group.id;
      update public.shared_payment_groups set status='fully_paid',updated_at=now()
      where shared_payment_group_id=v_group.canonical_group_id;
    end if;
  end if;
  return jsonb_build_object('success',true,'group_id',v_group.id);
end
$$;

-- Split each verified Short Let roommate charge into its Stay and Caution
-- balances before the provider gateway records its ledger liabilities. This
-- keeps the 10% commission off the 100%-refundable Caution amount.
create or replace function public.split_shared_short_let_protection()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_payment public.booking_payments;
  v_group_id uuid;
  v_member_id uuid;
  v_stay numeric(12,2);
  v_caution numeric(12,2);
  v_rate numeric;
  v_stay_protection uuid;
  v_caution_protection uuid;
begin
  if new.subject_type<>'shared_housing_share' then return new; end if;
  select * into v_payment from public.booking_payments
  where paystack_reference=new.paystack_reference and purpose='shared_housing_share';
  if v_payment.id is null
    or v_payment.metadata->>'canonical_product_type'<>'short_let' then return new; end if;
  v_group_id:=(v_payment.metadata->>'canonical_shared_payment_group_id')::uuid;
  v_member_id:=(v_payment.metadata->>'canonical_shared_payment_member_id')::uuid;
  v_stay:=round(coalesce((v_payment.metadata->>'eligible_partner_amount')::numeric,0),2);
  v_caution:=round(coalesce((v_payment.metadata->>'refundable_amount')::numeric,0),2);
  if v_stay<=0 or v_stay+v_caution<>new.amount_total then
    raise exception 'Shared Short Let Stay and Caution allocation is invalid'; end if;
  select (p.value->>'percent')::numeric into v_rate
  from public.creator_policy_versions p
  where p.policy_key='commission_short_let' and p.scope_type='global'
    and p.scope_key='*' and p.status='active' and p.effective_from<=now()
    and (p.effective_until is null or p.effective_until>now())
  order by p.effective_from desc limit 1;
  if v_rate is null or v_rate<0 or v_rate>50 then
    raise exception 'Active Creator Short Let commission is required'; end if;
  insert into public.payment_protection_transactions(
    booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
    amount_commission,amount_payee,commission_rate,status,paystack_reference,
    protection_state,subject_type,subject_id
  ) values(
    null,'short_let_stay',new.payer_user_id,new.payee_user_id,v_stay,
    round(v_stay*v_rate/100,2),v_stay-round(v_stay*v_rate/100,2),v_rate,
    'protected',new.paystack_reference,'awaiting_funds','short_let_stay',
    'shared:'||v_member_id::text||':stay:'||(v_payment.metadata->>'checkout_attempt')
  ) on conflict(subject_type,subject_id) do update
    set paystack_reference=excluded.paystack_reference,updated_at=now()
  returning id into v_stay_protection;
  insert into public.shared_payment_protection_components(
    shared_payment_group_id,shared_payment_member_id,payment_protection_id,
    component_type,amount,provider_reference
  ) values(v_group_id,v_member_id,v_stay_protection,'short_let_stay',v_stay,new.paystack_reference)
  on conflict(payment_protection_id) do nothing;
  if v_caution>0 then
    insert into public.payment_protection_transactions(
      booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
      amount_commission,amount_payee,commission_rate,status,paystack_reference,
      protection_state,subject_type,subject_id
    ) values(
      null,'short_let_caution',new.payer_user_id,new.payee_user_id,v_caution,
      0,v_caution,0,'protected',new.paystack_reference,'awaiting_funds',
      'short_let_caution','shared:'||v_member_id::text||':caution:'||
        (v_payment.metadata->>'checkout_attempt')
    ) on conflict(subject_type,subject_id) do update
      set paystack_reference=excluded.paystack_reference,updated_at=now()
    returning id into v_caution_protection;
    insert into public.shared_payment_protection_components(
      shared_payment_group_id,shared_payment_member_id,payment_protection_id,
      component_type,amount,provider_reference
    ) values(v_group_id,v_member_id,v_caution_protection,'short_let_caution',v_caution,new.paystack_reference)
    on conflict(payment_protection_id) do nothing;
  end if;
  return null;
end
$$;
drop trigger if exists split_shared_short_let_protection_trigger
on public.payment_protection_transactions;
create trigger split_shared_short_let_protection_trigger
before insert on public.payment_protection_transactions
for each row when(new.subject_type='shared_housing_share')
execute function public.split_shared_short_let_protection();

create or replace function public.start_my_shared_contract_split(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_group public.shared_housing_groups;
  v_listing public.listings;
  v_count integer;
  v_total numeric(12,2);
  v_eligible numeric(12,2);
  v_refundable numeric(12,2);
  v_index integer:=0;
  v_assigned numeric(12,2):=0;
  v_eligible_assigned numeric(12,2):=0;
  v_refundable_assigned numeric(12,2):=0;
  v_member public.shared_housing_members;
  v_share numeric(12,2);
  v_eligible_share numeric(12,2);
  v_refundable_share numeric(12,2);
begin
  select * into v_group from public.shared_housing_groups where id=p_group_id for update;
  if v_group.id is null or v_group.created_by<>v_actor then
    raise exception 'Only the group creator can start the Long Let payment'; end if;
  if v_group.product_type<>'long_let' then raise exception 'This is not a Long Let'; end if;
  if v_group.reservation_id is null or not exists(
    select 1 from public.reservations where id=v_group.reservation_id and inspection_result='passed'
  ) then raise exception 'Property inspection must pass first'; end if;
  if v_group.status not in('paid','refunded') then
    raise exception 'The earlier shared checkout must be complete'; end if;
  select * into v_listing from public.listings where id=v_group.listing_id;
  v_eligible:=round(v_listing.price,2);
  v_refundable:=round(coalesce(v_listing.security_deposit_amount,0),2);
  v_total:=v_eligible+v_refundable;
  select count(*) into v_count from public.shared_housing_members
  where group_id=p_group_id and invitation_status='accepted';
  if v_count<2 or v_count>coalesce(v_listing.max_occupants,1) then
    raise exception 'Accepted occupants exceed this Long Let capacity'; end if;
  update public.shared_housing_groups set
    status='payment_pending',payment_phase='contract_rent',total_amount=v_total,
    contract_total=v_total,expires_at=now()+interval '30 minutes',
    checkout_attempt=checkout_attempt+1,updated_at=now()
  where id=p_group_id returning * into v_group;
  update public.shared_payment_groups set
    status='checkout_open',payment_phase='contract_rent',total_amount=v_total,
    checkout_expires_at=v_group.expires_at,checkout_attempt=v_group.checkout_attempt,
    updated_at=now()
  where shared_payment_group_id=v_group.canonical_group_id;
  for v_member in select * from public.shared_housing_members
    where group_id=p_group_id and invitation_status='accepted' order by created_at,id
  loop
    v_index:=v_index+1;
    v_share:=case when v_index=v_count then v_total-v_assigned else round(v_total/v_count,2) end;
    v_eligible_share:=case when v_index=v_count then v_eligible-v_eligible_assigned else round(v_eligible/v_count,2) end;
    v_refundable_share:=case when v_index=v_count then v_refundable-v_refundable_assigned else round(v_refundable/v_count,2) end;
    update public.shared_housing_members set share_amount=v_share,
      eligible_partner_share=v_eligible_share,refundable_share=v_refundable_share,
      payment_status='not_started',payment_reference=null,paid_at=null,updated_at=now()
    where id=v_member.id;
    update public.shared_payment_members set share_amount=v_share,
      eligible_partner_share=v_eligible_share,refundable_share=v_refundable_share,
      payment_state='not_started',provider_reference=null,paid_at=null,updated_at=now()
    where shared_payment_member_id=v_member.canonical_member_id;
    v_assigned:=v_assigned+v_share;
    v_eligible_assigned:=v_eligible_assigned+v_eligible_share;
    v_refundable_assigned:=v_refundable_assigned+v_refundable_share;
  end loop;
  update public.reservations set rent_payment_status='payment_pending',updated_at=now()
  where id=v_group.reservation_id;
  return public.get_my_shared_housing_group(p_group_id);
end
$$;

create or replace function public.get_my_shared_housing_group(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null or not exists(select 1 from public.shared_housing_members
    where group_id=p_group_id and user_id=v_actor) then
    raise exception 'Shared-payment access required'; end if;
  select jsonb_build_object(
    'id',g.id,'created_by',g.created_by,'conversation_id',g.conversation_id,
    'listing_id',g.listing_id,'status',g.status,'product_type',g.product_type,
    'payment_phase',g.payment_phase,'expires_at',g.expires_at,
    'total_amount',g.total_amount,'reservation_fee_total',g.reservation_fee_total,
    'contract_total',g.contract_total,'reservation_id',g.reservation_id,
    'capacity',case when g.product_type='short_let' then l.max_guests else l.max_occupants end,
    'guest_count',g.guest_count,'stay_check_in',g.stay_check_in,'stay_check_out',g.stay_check_out,
    'listing',jsonb_build_object(
      'id',l.id,'title',l.title,'price',l.price,'image',l.images[1],
      'address',l.address,'city',l.city,'state',l.state,
      'available',l.deleted_at is null and l.status='available'
        and l.availability_status='available'
    ),
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'user_id',m.user_id,'name',coalesce(p.full_name,p.username,'Roommate'),
      'invitation_status',m.invitation_status,'share_amount',m.share_amount,
      'eligible_partner_share',m.eligible_partner_share,
      'refundable_share',m.refundable_share,
      'payment_status',m.payment_status,'paid_at',m.paid_at
    ) order by m.created_at,m.id)
    from public.shared_housing_members m left join public.profiles p on p.user_id=m.user_id
    where m.group_id=g.id),'[]'::jsonb)
  ) into v_result
  from public.shared_housing_groups g join public.listings l on l.id=g.listing_id
  where g.id=p_group_id;
  return v_result;
end
$$;

create or replace function public.get_my_shared_housing_groups()
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','public'
as $$
  select coalesce(jsonb_agg(public.get_my_shared_housing_group(m.group_id)
    order by m.created_at desc),'[]'::jsonb)
  from public.shared_housing_members m
  where m.user_id=public.current_profile_user_id()
$$;

alter table public.financial_action_outbox
  drop constraint if exists financial_action_outbox_action_type_check;
alter table public.financial_action_outbox
  add constraint financial_action_outbox_action_type_check check(action_type in(
    'refund_caution_undisputed','refund_caution_balance','release_caution_award',
    'refund_unclaimed_caution','refund_shared_checkout',
    'release_worker_payment','release_long_let_payment',
    'release_short_let_stay','release_hotel_stay'
  ));

create or replace function public.expire_shared_payment_checkout_from_service(p_group_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_group public.shared_housing_groups; v_component record; v_queued integer:=0;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  select * into v_group from public.shared_housing_groups where id=p_group_id for update;
  if v_group.id is null or v_group.status not in('payment_pending','refunding')
    or v_group.expires_at>now() then return 0; end if;
  if not exists(select 1 from public.shared_housing_members
    where group_id=p_group_id and payment_status='paid') then
    update public.shared_housing_groups set status='expired',updated_at=now() where id=p_group_id;
    update public.shared_payment_groups set status='expired',updated_at=now()
    where shared_payment_group_id=v_group.canonical_group_id;
    update public.reservations set status='expired',canonical_state='expired',updated_at=now()
    where id=v_group.reservation_id and status='payment_pending';
    return 0;
  end if;
  update public.shared_housing_groups set status='refunding',updated_at=now() where id=p_group_id;
  update public.shared_payment_groups set status='refunding',updated_at=now()
  where shared_payment_group_id=v_group.canonical_group_id;
  for v_component in
    select protection.id,protection.amount_total,member.id member_id
    from public.shared_housing_members member
    join public.booking_payments payment on payment.metadata->>'legacy_shared_member_id'=member.id::text
      and payment.metadata->>'checkout_attempt'=v_group.checkout_attempt::text
      and payment.status in('paid','completed')
    join public.payment_protection_transactions protection
      on protection.paystack_reference=payment.paystack_reference
      and protection.protection_state not in('refunded','released','reversed')
    where member.group_id=p_group_id and member.payment_status='paid'
  loop
    insert into public.financial_action_outbox(
      action_type,subject_type,subject_id,payment_protection_id,amount,
      idempotency_key,metadata
    ) values(
      'refund_shared_checkout','shared_payment_member',v_component.member_id::text,
      v_component.id,v_component.amount_total,
      'shared-checkout-refund:'||v_component.id,
      jsonb_build_object('shared_payment_group_id',p_group_id,
        'refund_destination','original_payment','retry_allowed',true)
    ) on conflict(idempotency_key) do nothing;
    if found then v_queued:=v_queued+1; end if;
  end loop;
  return v_queued;
end
$$;

create or replace function public.sweep_expired_shared_payment_checkouts(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_group record; v_count integer:=0;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  for v_group in select id from public.shared_housing_groups
    where status in('payment_pending','refunding') and expires_at<=now()
    order by expires_at for update skip locked limit least(greatest(p_limit,1),500)
  loop
    perform public.expire_shared_payment_checkout_from_service(v_group.id);
    v_count:=v_count+1;
  end loop;
  return v_count;
end
$$;

create or replace function public.sync_refunded_shared_payment_member()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_component public.shared_payment_protection_components; v_group uuid;
begin
  if new.protection_state<>'refunded' or old.protection_state='refunded' then return new; end if;
  select * into v_component from public.shared_payment_protection_components
  where payment_protection_id=new.id;
  if v_component.component_id is not null then
    if not exists(select 1 from public.shared_payment_protection_components c
      join public.payment_protection_transactions p on p.id=c.payment_protection_id
      where c.shared_payment_member_id=v_component.shared_payment_member_id
        and c.provider_reference=v_component.provider_reference
        and p.protection_state<>'refunded') then
      update public.shared_payment_members set payment_state='refunded',updated_at=now()
      where shared_payment_member_id=v_component.shared_payment_member_id;
      update public.shared_housing_members set payment_status='refunded',updated_at=now()
      where canonical_member_id=v_component.shared_payment_member_id;
    end if;
    v_group:=v_component.shared_payment_group_id;
  else
    select (payment.metadata->>'canonical_shared_payment_group_id')::uuid
    into v_group from public.booking_payments payment
    where payment.paystack_reference=new.paystack_reference
      and payment.purpose='shared_housing_share' limit 1;
    update public.shared_payment_members set payment_state='refunded',updated_at=now()
    where shared_payment_member_id=(select
      (payment.metadata->>'canonical_shared_payment_member_id')::uuid
      from public.booking_payments payment
      where payment.paystack_reference=new.paystack_reference
        and payment.purpose='shared_housing_share' limit 1);
    update public.shared_housing_members set payment_status='refunded',updated_at=now()
    where canonical_member_id=(select
      (payment.metadata->>'canonical_shared_payment_member_id')::uuid
      from public.booking_payments payment
      where payment.paystack_reference=new.paystack_reference
        and payment.purpose='shared_housing_share' limit 1);
  end if;
  if v_group is not null and not exists(
    select 1 from public.shared_payment_members
    where shared_payment_group_id=v_group and payment_state in('paid','provider_pending')
  ) then
    update public.shared_payment_groups set status='refunded',updated_at=now()
    where shared_payment_group_id=v_group;
    update public.shared_housing_groups set status='refunded',updated_at=now()
    where canonical_group_id=v_group;
    update public.reservations set status='refunded',canonical_state='refunded',updated_at=now()
    where shared_payment_group_id=v_group and status in('payment_pending','payment_conflict');
  end if;
  return new;
end
$$;
drop trigger if exists sync_refunded_shared_payment_member_trigger
on public.payment_protection_transactions;
create trigger sync_refunded_shared_payment_member_trigger
after update of protection_state on public.payment_protection_transactions
for each row execute function public.sync_refunded_shared_payment_member();

create or replace function public.retry_my_shared_payment_checkout(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_group public.shared_housing_groups;
begin
  select * into v_group from public.shared_housing_groups where id=p_group_id for update;
  if v_group.id is null or v_group.created_by<>v_actor or v_group.status not in('expired','refunded') then
    raise exception 'This shared checkout cannot be retried'; end if;
  if exists(select 1 from public.shared_housing_members where group_id=p_group_id
    and payment_status not in('not_started','refunded','failed')) then
    raise exception 'Refund reconciliation must finish before retry'; end if;
  if v_group.product_type='short_let' then
    perform pg_advisory_xact_lock(hashtextextended('short-let:'||v_group.listing_id::text,0));
    if exists(select 1 from public.reservations other
      where other.listing_id=v_group.listing_id::text and other.id<>v_group.reservation_id
        and other.stay_type='short_let'
        and other.status=any(array['reserved','ready_for_move_in','occupied']::text[])
        and daterange(other.stay_check_in,other.stay_check_out,'[)')
          && daterange(v_group.stay_check_in,v_group.stay_check_out,'[)')) then
      raise exception 'Those Short Let dates are no longer available'; end if;
    update public.reservations set status='payment_pending',canonical_state='checkout_pending',
      payment_expires_at=now()+interval '30 minutes',updated_at=now()
    where id=v_group.reservation_id;
  end if;
  update public.shared_housing_groups set status='payment_pending',
    expires_at=now()+interval '30 minutes',checkout_attempt=checkout_attempt+1,updated_at=now()
  where id=p_group_id returning * into v_group;
  update public.shared_payment_groups set status='checkout_open',
    checkout_expires_at=v_group.expires_at,checkout_attempt=v_group.checkout_attempt,updated_at=now()
  where shared_payment_group_id=v_group.canonical_group_id;
  update public.shared_housing_members set payment_status='not_started',
    payment_reference=null,paid_at=null,updated_at=now() where group_id=p_group_id;
  update public.shared_payment_members set payment_state='not_started',
    provider_reference=null,paid_at=null,updated_at=now()
  where shared_payment_group_id=v_group.canonical_group_id;
  return public.get_my_shared_housing_group(p_group_id);
end
$$;

revoke all on function public.create_my_shared_housing_group_v2(uuid,uuid[],date,date,integer)
from public,anon;
revoke all on function public.create_my_shared_housing_group(uuid,uuid) from public,anon;
revoke all on function public.respond_to_shared_housing_invite(uuid,boolean) from public,anon;
revoke all on function public.create_my_shared_housing_payment(uuid) from public,anon;
revoke all on function public.start_my_shared_contract_split(uuid) from public,anon;
revoke all on function public.get_my_shared_housing_group(uuid) from public,anon;
revoke all on function public.get_my_shared_housing_groups() from public,anon;
revoke all on function public.retry_my_shared_payment_checkout(uuid) from public,anon;
grant execute on function public.create_my_shared_housing_group_v2(uuid,uuid[],date,date,integer)
to authenticated,service_role;
grant execute on function public.create_my_shared_housing_group(uuid,uuid) to authenticated,service_role;
grant execute on function public.respond_to_shared_housing_invite(uuid,boolean) to authenticated,service_role;
grant execute on function public.create_my_shared_housing_payment(uuid) to authenticated,service_role;
grant execute on function public.start_my_shared_contract_split(uuid) to authenticated,service_role;
grant execute on function public.get_my_shared_housing_group(uuid) to authenticated,service_role;
grant execute on function public.get_my_shared_housing_groups() to authenticated,service_role;
grant execute on function public.retry_my_shared_payment_checkout(uuid) to authenticated,service_role;
revoke all on function public.confirm_shared_housing_payment(text,text,numeric)
from public,anon,authenticated;
revoke all on function public.expire_shared_payment_checkout_from_service(uuid)
from public,anon,authenticated;
revoke all on function public.sweep_expired_shared_payment_checkouts(integer)
from public,anon,authenticated;
revoke all on function public.split_shared_short_let_protection()
from public,anon,authenticated;
revoke all on function public.sync_refunded_shared_payment_member()
from public,anon,authenticated;
grant execute on function public.confirm_shared_housing_payment(text,text,numeric) to service_role;
grant execute on function public.expire_shared_payment_checkout_from_service(uuid) to service_role;
grant execute on function public.sweep_expired_shared_payment_checkouts(integer) to service_role;
grant execute on function public.split_shared_short_let_protection() to service_role;
grant execute on function public.sync_refunded_shared_payment_member() to service_role;

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
  case when has_function_privilege('authenticated',p.oid,'execute')
    then 'approved_client_rpc' else 'approved_service_only' end,
  case when has_function_privilege('authenticated',p.oid,'execute')
    then 'Participant-bound canonical shared-payment action'
    else 'Canonical shared-payment provider, expiry or projection authority' end,now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'create_my_shared_housing_group_v2','create_my_shared_housing_group',
  'respond_to_shared_housing_invite','create_my_shared_housing_payment',
  'confirm_shared_housing_payment','start_my_shared_contract_split',
  'get_my_shared_housing_group','get_my_shared_housing_groups',
  'expire_shared_payment_checkout_from_service','sweep_expired_shared_payment_checkouts',
  'split_shared_short_let_protection','sync_refunded_shared_payment_member',
  'retry_my_shared_payment_checkout'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,captured_at=now();

comment on table public.shared_payment_groups is
  'Canonical atomic Long Let or Short Let checkout; property chat shares and Hotels are excluded.';
comment on function public.sweep_expired_shared_payment_checkouts(integer) is
  'Queues original-payment refunds after an incomplete 30-minute coordinated checkout.';
