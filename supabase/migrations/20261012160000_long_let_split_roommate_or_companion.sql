-- Long Let cost sharing can now be chosen from Roommates (accepted roommate conversations) or Companions.
-- Payers (booker included) are capped at 3 and can never exceed the property's occupant capacity.
-- Replaces the Roommate-only entry point for new Long Let groups; existing groups are untouched.

create or replace function public.create_my_shared_long_let(
  p_listing_id uuid,
  p_roommate_conversation_ids uuid[] default '{}'::uuid[],
  p_companion_user_ids text[] default '{}'::text[]
) returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  v_actor public.profiles; v_listing public.listings; v_conversation public.conversations;
  v_conversation_id uuid; v_peer text; v_peers text[] := '{}'::text[]; v_people text[];
  v_capacity integer; v_member_count integer; v_total numeric(12,2); v_fee numeric(12,2);
  v_group_id uuid := gen_random_uuid(); v_member_id uuid; v_share numeric(12,2);
  v_assigned numeric(12,2) := 0; v_index integer; v_single_conversation uuid;
begin
  select * into v_actor from public.profiles
  where auth_id = (select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'An active Personal account is required';
  end if;
  p_roommate_conversation_ids := coalesce(p_roommate_conversation_ids, '{}'::uuid[]);
  p_companion_user_ids := coalesce(p_companion_user_ids, '{}'::text[]);
  if cardinality(p_roommate_conversation_ids) + cardinality(p_companion_user_ids) < 1 then
    raise exception 'Choose at least one Roommate or Companion';
  end if;

  select * into v_listing from public.listings where id = p_listing_id and deleted_at is null for update;
  if v_listing.id is null or v_listing.property_type <> 'apartment' or v_listing.sub_type <> 'long_stay'
    or v_listing.status <> 'available' or v_listing.availability_status <> 'available' then
    raise exception 'This property is unavailable';
  end if;
  v_capacity := coalesce(v_listing.max_occupants, 0);
  if v_capacity < 2 then raise exception 'This property cannot accept two paying occupants'; end if;

  foreach v_conversation_id in array p_roommate_conversation_ids loop
    select * into v_conversation from public.conversations
    where id = v_conversation_id and conversation_type = 'roommate'
      and coalesce(status,'active') in ('active','accepted')
      and v_actor.user_id in (participant_a, participant_b);
    if v_conversation.id is null then raise exception 'Every Roommate must have an accepted roommate conversation'; end if;
    v_peer := case when v_conversation.participant_a = v_actor.user_id then v_conversation.participant_b else v_conversation.participant_a end;
    if v_peer = any(v_peers) then raise exception 'Choose each person once'; end if;
    if exists(select 1 from public.roommate_user_blocks b
      where (b.blocker_user_id = v_actor.user_id and b.blocked_user_id = v_peer)
         or (b.blocker_user_id = v_peer and b.blocked_user_id = v_actor.user_id)) then
      raise exception 'A blocked person cannot join a shared payment';
    end if;
    v_peers := array_append(v_peers, v_peer);
  end loop;

  foreach v_peer in array p_companion_user_ids loop
    if v_peer is null or v_peer = v_actor.user_id or v_peer = any(v_peers) then raise exception 'Choose each person once'; end if;
    if not public.are_companions(v_actor.user_id, v_peer) then
      raise exception 'Only accepted Companions can share this stay'; end if;
    v_peers := array_append(v_peers, v_peer);
  end loop;

  if exists(select 1 from unnest(v_peers) pp where not exists(
      select 1 from public.profiles p where p.user_id = pp and p.account_kind = 'consumer'
        and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false))) then
    raise exception 'Every invited person must have an active Personal account';
  end if;

  v_people := array_prepend(v_actor.user_id, v_peers);
  v_member_count := cardinality(v_people);
  if v_member_count > 3 then raise exception 'At most 3 people can pay for one property'; end if;
  if v_member_count > v_capacity then raise exception 'This property accepts only % occupants', v_capacity; end if;
  if exists(
    select 1 from public.shared_housing_groups g
    join public.shared_housing_members m on m.group_id = g.id
    where g.listing_id = v_listing.id and m.user_id = v_actor.user_id
      and g.status not in ('cancelled','expired','refunded')
  ) then raise exception 'You already have an active shared payment for this property'; end if;

  select coalesce(nullif(value,'')::numeric,10000) into v_fee
  from public.platform_settings where key = 'reservation_fee' and coalesce(is_active,true) limit 1;
  v_total := round(coalesce(v_fee,10000),2);
  if v_total <= 0 then raise exception 'Creator reservation fee is not configured'; end if;

  v_single_conversation := case when cardinality(p_roommate_conversation_ids) = 1 and cardinality(p_companion_user_ids) = 0
    then p_roommate_conversation_ids[1] else null end;

  insert into public.shared_housing_groups(
    id,listing_id,created_by,status,member_limit,total_amount,conversation_id,payment_phase,
    reservation_fee_total,contract_total,expires_at,product_type,canonical_group_id,
    guest_count,checkout_attempt,created_at,updated_at
  ) values(
    v_group_id,v_listing.id,v_actor.user_id,'inviting',v_member_count,v_total,v_single_conversation,'reservation_fee',
    v_total,round(v_listing.price + coalesce(v_listing.security_deposit_amount,0),2),
    now() + interval '72 hours','long_let',v_group_id,v_member_count,1,now(),now()
  );
  insert into public.shared_payment_groups(
    shared_payment_group_id,product_type,listing_id,created_by,total_amount,capacity,status,
    checkout_expires_at,legacy_group_id,conversation_id,payment_phase,guest_count,checkout_attempt,created_at,updated_at
  ) values(
    v_group_id,'long_let',v_listing.id::text,v_actor.user_id,v_total,v_capacity,'inviting',
    now() + interval '72 hours',v_group_id,v_single_conversation,'reservation_fee',v_member_count,1,now(),now()
  );

  for v_index in 1..v_member_count loop
    v_member_id := gen_random_uuid();
    v_share := case when v_index = v_member_count then v_total - v_assigned else round(v_total / v_member_count, 2) end;
    insert into public.shared_housing_members(
      id,group_id,user_id,invitation_status,share_amount,payment_status,canonical_member_id,
      eligible_partner_share,refundable_share,created_at,updated_at
    ) values(
      v_member_id,v_group_id,v_people[v_index],case when v_index = 1 then 'accepted' else 'invited' end,
      v_share,'not_started',v_member_id,0,v_share,now(),now()
    );
    insert into public.shared_payment_members(
      shared_payment_member_id,shared_payment_group_id,user_id,share_amount,invitation_state,payment_state,
      legacy_member_id,eligible_partner_share,refundable_share,created_at,updated_at
    ) values(
      v_member_id,v_group_id,v_people[v_index],v_share,case when v_index = 1 then 'accepted' else 'invited' end,
      'not_started',v_member_id,0,v_share,now(),now()
    );
    v_assigned := v_assigned + v_share;
  end loop;
  return public.get_my_shared_housing_group(v_group_id);
end $$;

revoke all on function public.create_my_shared_long_let(uuid, uuid[], text[]) from public, anon;
grant execute on function public.create_my_shared_long_let(uuid, uuid[], text[]) to authenticated, service_role;

-- The old Roommate-only Long Let entry points stay for existing clients but now share the 3-payer cap through
-- the shared_payment_member_cap trigger.
