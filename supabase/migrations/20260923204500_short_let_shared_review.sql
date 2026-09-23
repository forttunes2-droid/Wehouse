begin;
-- Prevent an in-flight full-stay checkout from becoming a shared payment.
-- The existing row lock in both payment creation and group creation serializes this choice.
create or replace function public.guard_short_let_payment_method()
returns trigger language plpgsql security definer set search_path='pg_catalog','public' as $$
begin
 if new.stay_type='short_let' and old.shared_payment_group_id is null and new.shared_payment_group_id is not null then
  if old.status<>'payment_pending' or old.payment_expires_at is null or old.payment_expires_at<=now()
   or old.rent_payment_status in('paid','upfront_paid','payment_pending')
   or old.payment_reference is not null or old.rent_payment_reference is not null
   or exists(select 1 from public.booking_payments p where p.metadata->>'reservation_id'=old.id
     and p.purpose='apartment_rent' and p.status not in('failed','cancelled','expired')) then
    raise exception 'Finish or cancel the existing checkout before starting a shared payment';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_short_let_payment_method() from public,anon,authenticated;
grant execute on function public.guard_short_let_payment_method() to service_role;
drop trigger if exists short_let_payment_method_guard on public.reservations;
create trigger short_let_payment_method_guard before update of shared_payment_group_id on public.reservations
 for each row execute function public.guard_short_let_payment_method();

create or replace function public.create_my_shared_short_let(p_reservation_id text,p_conversation_ids uuid[])
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare r public.reservations; actor text:=public.current_profile_user_id(); result jsonb; old_deadline timestamptz;
 group_id uuid; existing_peers text[]; requested_peers text[];
begin
 if actor is null or not public.current_actor_has_personal_workspace() then raise exception 'Active Personal account required'; end if;
 select * into r from public.reservations where id=p_reservation_id and user_id=actor and stay_type='short_let';
 if r.id is null then raise exception 'Your Short Let reservation was not found'; end if;
 -- Follow the existing group-creation lock order: listing, then reservation.
 perform 1 from public.listings where id::text=r.listing_id for update;
 select * into r from public.reservations where id=p_reservation_id and user_id=actor and stay_type='short_let' for update;
 if r.status<>'payment_pending' or r.payment_expires_at is null or r.payment_expires_at<=now() then raise exception 'This reservation cannot start a new shared payment'; end if;
 if coalesce(cardinality(p_conversation_ids),0)<1 or cardinality(p_conversation_ids)>=coalesce(r.guest_count,0)
  or cardinality(p_conversation_ids)<>(select count(distinct x) from unnest(p_conversation_ids) x) then
  raise exception 'Choose distinct connections within the reserved guest count'; end if;
 if r.shared_payment_group_id is not null then
  select array_agg(m.user_id order by m.user_id) into existing_peers from public.shared_housing_members m
   where m.group_id=r.shared_payment_group_id and m.user_id<>actor;
  select array_agg(case when c.participant_a=actor then c.participant_b else c.participant_a end
   order by case when c.participant_a=actor then c.participant_b else c.participant_a end) into requested_peers
   from public.conversations c where c.id=any(p_conversation_ids) and actor in(c.participant_a,c.participant_b)
   and c.conversation_type='roommate' and c.status in('active','accepted');
  if existing_peers is distinct from requested_peers then raise exception 'This stay already has a different shared payment'; end if;
  return public.get_my_shared_housing_group(r.shared_payment_group_id);
 end if;
 old_deadline:=r.payment_expires_at;
 result:=public.create_my_shared_housing_group_v2(r.listing_id::uuid,p_conversation_ids,r.stay_check_in,r.stay_check_out,r.guest_count);
 group_id:=(result->>'id')::uuid;
 if group_id is null or result->>'reservation_id' is distinct from r.id then raise exception 'Shared payment did not bind to the reviewed reservation'; end if;
 -- Splitting is not a free extension of the existing provisional date checkout.
 update public.reservations set payment_expires_at=least(payment_expires_at,old_deadline) where id=r.id;
 update public.shared_housing_groups set expires_at=least(expires_at,old_deadline) where id=group_id;
 update public.shared_payment_groups set checkout_expires_at=least(checkout_expires_at,old_deadline) where shared_payment_group_id=group_id;
 return public.get_my_shared_housing_group(group_id);
end $$;
revoke all on function public.create_my_shared_short_let(text,uuid[]) from public,anon;
grant execute on function public.create_my_shared_short_let(text,uuid[]) to authenticated,service_role;
CREATE OR REPLACE FUNCTION public.create_short_stay_payment(p_reservation_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_user_id text;
  v_res public.reservations;
  v_listing public.listings;
  v_pending public.booking_payments;
  v_reference text;
  v_stay numeric(12,2);
  v_caution numeric(12,2);
  v_total numeric(12,2);
  v_checkout_minutes integer;
begin
  select user_id into v_user_id from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'An active Personal account is required';
  end if;
  select * into v_res from public.reservations
  where id=p_reservation_id and user_id=v_user_id for update;
  if v_res.id is null then raise exception 'Short Let checkout not found'; end if;
  if v_res.stay_type<>'short_let' then raise exception 'This is not a Short Let'; end if;
  if v_res.shared_payment_group_id is not null then raise exception 'Open the shared payment and pay only your own share'; end if;
  if v_res.rent_payment_status='paid' then
    return jsonb_build_object('success',true,'already_paid',true,'status','paid');
  end if;
  if v_res.status not in ('payment_pending','reserved','ready_for_move_in') then
    raise exception 'This Short Let checkout cannot be paid';
  end if;
  if v_res.status='payment_pending' and (v_res.payment_expires_at is null or v_res.payment_expires_at<=now()) then raise exception 'The date reservation expired. Reserve your dates again'; end if;
  if v_res.stay_check_out<=current_date then raise exception 'This Short Let has ended'; end if;

  select * into v_listing from public.listings
  where id::text=v_res.listing_id and deleted_at is null and sub_type='short_let'
  for share;
  if v_listing.id is null then raise exception 'Short Let not found'; end if;
  if coalesce(v_res.guest_count,1)>coalesce(v_listing.max_guests,0) then
    raise exception 'Guest count exceeds this Short Let capacity';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('short-let:'||v_listing.id::text,0));
  if exists(
    select 1 from public.reservations r
    where r.listing_id=v_res.listing_id and r.id<>v_res.id
      and r.stay_type='short_let'
      and r.status=any(array['reserved','ready_for_move_in','occupied']::text[])
      and daterange(r.stay_check_in,r.stay_check_out,'[)')
        && daterange(v_res.stay_check_in,v_res.stay_check_out,'[)')
  ) then raise exception 'Those Short Let dates are no longer available'; end if;

  v_stay:=round(coalesce(v_res.stay_rent_total,
    v_res.nightly_rate_snapshot*v_res.stay_nights),2);
  v_caution:=round(coalesce(v_res.security_deposit_snapshot,0),2);
  v_total:=v_stay+v_caution;
  if v_stay<=0 or v_caution<0 then raise exception 'Short Let checkout amount is invalid'; end if;

  select * into v_pending from public.booking_payments
  where user_id=v_user_id and purpose='apartment_rent' and status='pending'
    and metadata->>'reservation_id'=v_res.id
    and metadata->>'payment_component'='short_stay_rent'
    and round(coalesce(amount_total,amount),2)=v_total
  order by created_at desc limit 1;
  if v_pending.id is not null then
    update public.reservations set
      payment_reference=v_pending.paystack_reference,
      rent_payment_status='payment_pending',
      rent_payment_reference=v_pending.paystack_reference,updated_at=now()
    where id=v_res.id;
    return jsonb_build_object('success',true,'reference',v_pending.paystack_reference,
      'amount',v_total,'stay_price',v_stay,'caution_fee',v_caution,'existing',true);
  end if;

  v_reference:='WHSTAY-'||upper(replace(gen_random_uuid()::text,'-',''));
  insert into public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,listing_id,
    amount,amount_total,currency,status,purpose,payment_method,paystack_reference,
    metadata,created_at,updated_at
  ) values(
    v_reference,v_user_id,v_user_id,'apartment','apartment',v_listing.id::text,
    v_total,v_total,'NGN','pending','apartment_rent','paystack',v_reference,
    jsonb_build_object('reservation_id',v_res.id,'listing_id',v_listing.id::text,
      'payment_component','short_stay_rent','check_in',v_res.stay_check_in,
      'check_out',v_res.stay_check_out,'nights',v_res.stay_nights,
      'guest_count',v_res.guest_count,'nightly_rate',v_res.nightly_rate_snapshot,
      'stay_rent_total',v_stay,'security_deposit_amount',v_caution,
      'eligible_partner_amount',v_stay,'separate_reservation_fee',false),
    now(),now()
  );
  select nullif(value,'')::integer into v_checkout_minutes
  from public.platform_settings where key='apartment_payment_hold_minutes'
    and coalesce(is_active,true) limit 1;
  if v_checkout_minutes is null or v_checkout_minutes<5 or v_checkout_minutes>120 then
    v_checkout_minutes:=30;
  end if;
  update public.reservations set
    amount=v_total,payment_reference=v_reference,manual_payment_status='unpaid',
    stay_rent_total=v_stay,security_deposit_snapshot=v_caution,
    security_deposit_status=case when v_caution=0 then 'not_required' else 'pending' end,
    rent_payment_status='payment_pending',rent_payment_reference=v_reference,
    payment_expires_at=now()+make_interval(mins=>v_checkout_minutes),updated_at=now()
  where id=v_res.id;
  return jsonb_build_object('success',true,'reference',v_reference,'amount',v_total,
    'stay_price',v_stay,'caution_fee',v_caution,'existing',false);
end
$$;
CREATE OR REPLACE FUNCTION public.get_my_shared_housing_group(p_group_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null or not public.current_actor_has_personal_workspace() or not exists(select 1 from public.shared_housing_members
    where group_id=p_group_id and user_id=v_actor) then
    raise exception 'Shared-payment access required'; end if;
  select jsonb_build_object(
    'id',g.id,'created_at',g.created_at,'created_by',g.created_by,'conversation_id',g.conversation_id,
    'listing_id',g.listing_id,'status',g.status,'product_type',g.product_type,
    'payment_phase',g.payment_phase,'expires_at',g.expires_at,
    'total_amount',g.total_amount,'reservation_fee_total',g.reservation_fee_total,
    'contract_total',g.contract_total,'reservation_id',g.reservation_id,
    'booking_status',(select r.status from public.reservations r where r.id=g.reservation_id),
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
CREATE OR REPLACE FUNCTION public.create_my_shared_housing_group_v2(p_listing_id uuid, p_conversation_ids uuid[], p_check_in date DEFAULT NULL::date, p_check_out date DEFAULT NULL::date, p_guest_count integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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
    if not exists(select 1 from public.profiles p where p.user_id=v_peer and p.account_kind='consumer'
      and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)) then
      raise exception 'Every invited person must have an active Personal account'; end if;
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
    if v_listing.sub_type='short_let' then
      -- Allocate whole kobo deterministically. Each member's components must add
      -- to their payment and all shares must add exactly to the stored bill.
      v_share:=(floor(v_total*100/v_member_count)+case when v_index<=mod((v_total*100)::bigint,v_member_count) then 1 else 0 end)/100;
      v_eligible_share:=(floor(v_eligible*100/v_member_count)+case when v_index<=mod((v_eligible*100)::bigint,v_member_count) then 1 else 0 end)/100;
      v_refundable_share:=v_share-v_eligible_share;
    end if;
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


insert into public.function_execution_registry(function_signature,function_name,security_mode,public_allowed,anon_allowed,authenticated_allowed,service_role_allowed,review_state,rationale,captured_at)
select p.oid::regprocedure::text,p.proname,'definer',false,false,p.proname='create_my_shared_short_let',true,
 case when p.proname='create_my_shared_short_let' then 'approved_client_rpc' else 'approved_service_only' end,
 'Existing Short Let reservation binding, participant choice, no double/full payment and no renewed hold',now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in('create_my_shared_short_let','guard_short_let_payment_method')
on conflict(function_signature) do update set public_allowed=false,anon_allowed=false,
 authenticated_allowed=excluded.authenticated_allowed,service_role_allowed=true,review_state=excluded.review_state,rationale=excluded.rationale,captured_at=now();
CREATE OR REPLACE FUNCTION public.respond_to_shared_housing_invite(p_group_id uuid, p_accept boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare v_actor text:=public.current_profile_user_id(); v_group public.shared_housing_groups; deadline timestamptz;
begin
  if v_actor is null or not public.current_actor_has_personal_workspace() then raise exception 'Active Personal account required'; end if;
  select * into v_group from public.shared_housing_groups where id=p_group_id for update;
  if v_group.id is null or v_group.status<>'inviting' or v_group.expires_at<=now() then
    raise exception 'Pending shared-payment invitation not found';
  end if;
  if p_accept and exists(select 1 from public.shared_housing_members m join public.profiles p on p.user_id=m.user_id where m.group_id=p_group_id and (coalesce(p.deleted,false) or coalesce(p.suspended,false) or coalesce(p.banned,false))) then raise exception 'A participant is no longer eligible'; end if;
  if p_accept and exists(select 1 from public.shared_housing_members m join public.roommate_user_blocks b on (b.blocker_user_id=v_actor and b.blocked_user_id=m.user_id) or (b.blocker_user_id=m.user_id and b.blocked_user_id=v_actor) where m.group_id=p_group_id) then raise exception 'Blocked participants cannot accept shared payment'; end if;
  deadline:=case when v_group.product_type='short_let' then least(v_group.expires_at,now()+interval '30 minutes') else now()+interval '30 minutes' end;
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
      status='payment_pending',expires_at=deadline,updated_at=now()
    where id=p_group_id;
    update public.shared_payment_groups set
      status='checkout_open',checkout_expires_at=deadline,updated_at=now()
    where shared_payment_group_id=p_group_id;
    update public.reservations set payment_expires_at=deadline,updated_at=now()
    where id=v_group.reservation_id and status='payment_pending';
  end if;
  return public.get_my_shared_housing_group(p_group_id);
end
$$;

CREATE OR REPLACE FUNCTION public.create_my_shared_housing_payment(p_group_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_actor text:=public.current_profile_user_id();
  v_member public.shared_housing_members;
  v_group public.shared_housing_groups;
  v_reference text;
  v_subject_id text;
  v_pending public.booking_payments;
begin
  if v_actor is null or not public.current_actor_has_personal_workspace() then raise exception 'Active Personal account required'; end if;
  select * into v_group from public.shared_housing_groups where id=p_group_id for update;
  select * into v_member from public.shared_housing_members
  where group_id=p_group_id and user_id=v_actor for update;
  if v_group.id is null or v_member.id is null then raise exception 'Shared-payment access required'; end if;
  if v_member.payment_status='paid' then return jsonb_build_object('already_paid',true); end if;
  if v_group.status<>'payment_pending' or v_member.invitation_status<>'accepted'
    or exists(select 1 from public.shared_housing_members
      where group_id=p_group_id and invitation_status<>'accepted') then
    raise exception 'Every roommate must accept before payment';
  end if;
  if v_group.expires_at<=now() then raise exception 'This 30-minute shared checkout expired'; end if;
  if v_member.payment_status='paid' then return jsonb_build_object('already_paid',true); end if;
  -- A lost response or repeated click must reuse this member's pending checkout.
  select * into v_pending from public.booking_payments p where p.paystack_reference=v_member.payment_reference
    and p.purpose='shared_housing_share' and p.payer_user_id=v_actor and p.status='pending'
    and p.metadata->>'checkout_attempt'=v_group.checkout_attempt::text
    and p.metadata->>'shared_group_id'=p_group_id::text
    and round(coalesce(p.amount_total,p.amount),2)=v_member.share_amount limit 1;
  if v_pending.id is not null then return jsonb_build_object('reference',v_pending.paystack_reference,
    'amount',v_member.share_amount,'payment_phase',v_group.payment_phase,'expires_at',v_group.expires_at,'product_type',v_group.product_type,'existing',true); end if;
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

-- Each participant has an independent response event; booking identity is unchanged.
CREATE OR REPLACE FUNCTION public.notify_shared_housing_member_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  group_row public.shared_housing_groups;
  listing_title text;
  actor_name text;
  member_name text;
begin
  select * into group_row from public.shared_housing_groups where id=new.group_id;
  select title into listing_title from public.listings where id=group_row.listing_id;
  select coalesce(full_name, username, 'Your roommate') into actor_name
    from public.profiles where user_id=coalesce(group_row.created_by,new.user_id);

  select coalesce(nullif(btrim(full_name),''),nullif(btrim(username),''),'Your connection') into member_name
    from public.profiles where user_id=new.user_id;

  if tg_op='INSERT' and new.invitation_status='invited' then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,read,source_type,source_id,
      destination_route,destination_params,event_key
    ) values (
      new.user_id,'shared_home_invite','Shared home invitation',
      actor_name||' invited you to share '||coalesce(listing_title,'a home')||'.',
      new.group_id::text,false,'shared_housing',new.group_id,'my_reservations',
      jsonb_build_object('sharedGroupId',new.group_id),
      'shared_home_invite:'||new.group_id::text||':'||new.user_id
    ) on conflict (recipient_id,event_key) where event_key is not null do nothing;
  elsif tg_op='UPDATE' and new.invitation_status is distinct from old.invitation_status
    and new.invitation_status in ('accepted','declined') then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,read,source_type,source_id,
      destination_route,destination_params,event_key
    ) values (
      group_row.created_by,'shared_home_response',
      case when new.invitation_status='accepted' then 'Shared home accepted' else 'Shared home declined' end,
      case when new.invitation_status='accepted'
        then member_name||' accepted the invitation for '||coalesce(listing_title,'the selected home')||'.'
        else member_name||' declined the invitation for '||coalesce(listing_title,'the selected home')||'.' end,
      new.group_id::text,false,'shared_housing',new.group_id,'my_reservations',
      jsonb_build_object('sharedGroupId',new.group_id),
      'shared_home_response:'||new.group_id::text||':'||new.user_id||':'||new.invitation_status
    ) on conflict (recipient_id,event_key) where event_key is not null do nothing;
  elsif tg_op='UPDATE' and new.payment_status='paid'
    and old.payment_status is distinct from 'paid' then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,read,source_type,source_id,
      destination_route,destination_params,event_key
    )
    select member.user_id,'shared_home_payment','Roommate share updated',
      'A payment share for '||coalesce(listing_title,'your shared home')||' was confirmed.',
      new.group_id::text,false,'shared_housing',new.group_id,'my_reservations',
      jsonb_build_object('sharedGroupId',new.group_id),
      'shared_home_payment:'||new.group_id::text||':'||new.id::text
    from public.shared_housing_members member
    where member.group_id=new.group_id and member.user_id<>new.user_id
    on conflict (recipient_id,event_key) where event_key is not null do nothing;
  end if;
  return new;
end;
$$;

commit;
