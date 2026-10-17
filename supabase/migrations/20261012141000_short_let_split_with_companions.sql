-- Short Let cost sharing is chosen from Companions, never from Roommate conversations.
-- Payers (booker included) are capped at 3 and can never exceed the reserved guest count.
-- Reserve date is never split. Only the stay and the refundable deposit are shared.

drop function if exists public.create_my_shared_short_let(text, uuid[]);

create or replace function public.create_my_shared_short_let(p_reservation_id text, p_user_ids text[])
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
 r public.reservations; l public.listings; actor text := public.current_profile_user_id();
 peer text; peers text[] := '{}'::text[]; people text[];
 requested_peers text[]; existing_peers text[]; member_count integer; capacity integer;
 gid uuid := gen_random_uuid(); mid uuid; total numeric(12,2); eligible numeric(12,2);
 refundable numeric(12,2); share numeric(12,2); eligible_share numeric(12,2);
 refundable_share numeric(12,2); assigned numeric(12,2) := 0;
 eligible_assigned numeric(12,2) := 0; refundable_assigned numeric(12,2) := 0;
 i integer; deadline timestamptz;
begin
 if actor is null or not public.current_actor_has_personal_workspace() then raise exception 'Active Personal account required'; end if;
 select * into r from public.reservations where id = p_reservation_id and user_id = actor and stay_type = 'short_let';
 if r.id is null then raise exception 'Your Short Let reservation was not found'; end if;
 perform 1 from public.listings where id::text = r.listing_id for update;
 select * into r from public.reservations where id = p_reservation_id and user_id = actor and stay_type = 'short_let' for update;
 select * into l from public.listings where id::text = r.listing_id and deleted_at is null and sub_type = 'short_let' for share;
 if l.id is null then raise exception 'Short Let not found'; end if;
 if r.status not in ('reserved','ready_for_move_in') or r.reservation_fee_status <> 'paid'
   or r.manual_payment_status not in ('paid','completed') or r.reservation_fee_paid_at is null then
   raise exception 'Pay Reserve date before splitting the remaining stay cost'; end if;
 if r.short_stay_balance_due_at is null or r.short_stay_balance_due_at <= now() then raise exception 'The stay balance deadline has passed. Reserve the dates again'; end if;
 if r.rent_payment_status in ('payment_pending','paid','upfront_paid') or r.rent_payment_reference is not null
   or exists(select 1 from public.booking_payments p where p.metadata->>'reservation_id' = r.id
     and p.purpose = 'apartment_rent' and p.status not in ('failed','cancelled','expired','refunded','reversed')) then
   raise exception 'Finish or cancel the existing stay checkout before splitting costs'; end if;
 if coalesce(cardinality(p_user_ids), 0) < 1
   or cardinality(p_user_ids) >= coalesce(r.guest_count, 0)
   or cardinality(p_user_ids) >= 3
   or cardinality(p_user_ids) <> (select count(distinct x) from unnest(p_user_ids) x) then
   raise exception 'Choose distinct companions within the reserved guest count, with at most 3 paying people'; end if;

 foreach peer in array p_user_ids loop
   if peer is null or peer = actor then raise exception 'Choose each companion once'; end if;
   if not public.are_companions(actor, peer) then
     raise exception 'Only accepted companions can share a Short Let stay'; end if;
   if not exists(select 1 from public.profiles p where p.user_id = peer and p.account_kind = 'consumer'
     and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)) then
     raise exception 'Every invited person must have an active Personal account'; end if;
   peers := array_append(peers, peer);
 end loop;

 requested_peers := array(select unnest(peers) order by 1);
 if r.shared_payment_group_id is not null then
   select array_agg(m.user_id order by m.user_id) into existing_peers
   from public.shared_housing_members m where m.group_id = r.shared_payment_group_id and m.user_id <> actor;
   if existing_peers is distinct from requested_peers then raise exception 'This stay already has a different shared payment'; end if;
   return public.get_my_shared_housing_group(r.shared_payment_group_id);
 end if;

 capacity := coalesce(l.max_guests, 0); people := array_prepend(actor, peers); member_count := cardinality(people);
 if member_count < 2 or member_count > capacity or member_count > 3 then raise exception 'Selected paying guests exceed this Short Let capacity'; end if;
 eligible := round(coalesce(r.stay_rent_total, 0), 2); refundable := round(coalesce(r.security_deposit_snapshot, 0), 2); total := eligible + refundable;
 if eligible <= 0 or refundable < 0 or total <= 0 then raise exception 'Stored Short Let balance is invalid'; end if;
 deadline := r.short_stay_balance_due_at;

 insert into public.shared_housing_groups(
   id,listing_id,created_by,status,member_limit,total_amount,conversation_id,payment_phase,
   reservation_fee_total,contract_total,expires_at,reservation_id,product_type,canonical_group_id,
   stay_check_in,stay_check_out,guest_count,checkout_attempt,created_at,updated_at
 ) values(gid,l.id,actor,'inviting',member_count,total,null,
   'short_stay',0,total,deadline,r.id,'short_let',gid,r.stay_check_in,r.stay_check_out,r.guest_count,1,now(),now());

 insert into public.shared_payment_groups(
   shared_payment_group_id,product_type,listing_id,reservation_id,created_by,total_amount,capacity,status,
   checkout_expires_at,legacy_group_id,conversation_id,payment_phase,stay_check_in,stay_check_out,
   guest_count,checkout_attempt,created_at,updated_at
 ) values(gid,'short_let',l.id::text,r.id,actor,total,capacity,'inviting',deadline,gid,null,
   'short_stay',r.stay_check_in,r.stay_check_out,r.guest_count,1,now(),now());

 for i in 1..member_count loop
   mid := gen_random_uuid();
   share := (floor(total*100/member_count) + case when i <= mod((total*100)::bigint, member_count) then 1 else 0 end)/100;
   eligible_share := (floor(eligible*100/member_count) + case when i <= mod((eligible*100)::bigint, member_count) then 1 else 0 end)/100;
   refundable_share := share - eligible_share;
   insert into public.shared_housing_members(
     id,group_id,user_id,invitation_status,share_amount,payment_status,canonical_member_id,
     eligible_partner_share,refundable_share,created_at,updated_at
   ) values(mid,gid,people[i],case when i = 1 then 'accepted' else 'invited' end,share,'not_started',
     mid,eligible_share,refundable_share,now(),now());
   insert into public.shared_payment_members(
     shared_payment_member_id,shared_payment_group_id,user_id,share_amount,invitation_state,payment_state,
     legacy_member_id,eligible_partner_share,refundable_share,created_at,updated_at
   ) values(mid,gid,people[i],share,case when i = 1 then 'accepted' else 'invited' end,'not_started',
     mid,eligible_share,refundable_share,now(),now());
   assigned := assigned + share; eligible_assigned := eligible_assigned + eligible_share; refundable_assigned := refundable_assigned + refundable_share;
 end loop;
 if round(assigned,2) <> total or round(eligible_assigned,2) <> eligible or round(refundable_assigned,2) <> refundable then
   raise exception 'Shared Short Let split did not reconcile'; end if;
 update public.reservations set shared_payment_group_id = gid, updated_at = now() where id = r.id;
 return public.get_my_shared_housing_group(gid);
end $$;

revoke all on function public.create_my_shared_short_let(text, text[]) from public, anon;
grant execute on function public.create_my_shared_short_let(text, text[]) to authenticated, service_role;
