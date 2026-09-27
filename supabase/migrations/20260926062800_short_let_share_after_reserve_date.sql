-- Short Let cost sharing starts only after the booking owner has paid Reserve date.
-- Reserve date is never split. Only stay + refundable deposit are shared.

create or replace function public.guard_short_let_payment_method()
returns trigger language plpgsql security definer
set search_path='pg_catalog','public' as $$
begin
 if new.stay_type='short_let' and old.shared_payment_group_id is null and new.shared_payment_group_id is not null then
  if old.status not in ('reserved','ready_for_move_in')
   or old.reservation_fee_status<>'paid'
   or old.manual_payment_status not in ('paid','completed')
   or old.reservation_fee_paid_at is null
   or old.short_stay_balance_due_at is null or old.short_stay_balance_due_at<=now()
   or old.rent_payment_status in ('paid','upfront_paid','payment_pending')
   or old.rent_payment_reference is not null
   or exists(select 1 from public.booking_payments p
     where p.metadata->>'reservation_id'=old.id and p.purpose='apartment_rent'
       and p.status not in('failed','cancelled','expired','refunded','reversed'))
  then raise exception 'Reserve date must be paid and no stay checkout may already be in progress'; end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_short_let_payment_method() from public,anon,authenticated;
grant execute on function public.guard_short_let_payment_method() to service_role;

create or replace function public.create_my_shared_short_let(p_reservation_id text,p_conversation_ids uuid[])
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare
 r public.reservations; l public.listings; actor text:=public.current_profile_user_id();
 c public.conversations; cid uuid; peer text; peers text[]:='{}'::text[]; people text[];
 requested_peers text[]; existing_peers text[]; member_count integer; capacity integer;
 gid uuid:=gen_random_uuid(); mid uuid; total numeric(12,2); eligible numeric(12,2);
 refundable numeric(12,2); share numeric(12,2); eligible_share numeric(12,2);
 refundable_share numeric(12,2); assigned numeric(12,2):=0;
 eligible_assigned numeric(12,2):=0; refundable_assigned numeric(12,2):=0;
 i integer; deadline timestamptz;
begin
 if actor is null or not public.current_actor_has_personal_workspace() then raise exception 'Active Personal account required'; end if;
 select * into r from public.reservations where id=p_reservation_id and user_id=actor and stay_type='short_let';
 if r.id is null then raise exception 'Your Short Let reservation was not found'; end if;
 perform 1 from public.listings where id::text=r.listing_id for update;
 select * into r from public.reservations where id=p_reservation_id and user_id=actor and stay_type='short_let' for update;
 select * into l from public.listings where id::text=r.listing_id and deleted_at is null and sub_type='short_let' for share;
 if l.id is null then raise exception 'Short Let not found'; end if;
 if r.status not in('reserved','ready_for_move_in') or r.reservation_fee_status<>'paid'
   or r.manual_payment_status not in('paid','completed') or r.reservation_fee_paid_at is null then
   raise exception 'Pay Reserve date before splitting the remaining stay cost'; end if;
 if r.short_stay_balance_due_at is null or r.short_stay_balance_due_at<=now() then raise exception 'The stay balance deadline has passed. Reserve the dates again'; end if;
 if r.rent_payment_status in('payment_pending','paid','upfront_paid') or r.rent_payment_reference is not null
   or exists(select 1 from public.booking_payments p where p.metadata->>'reservation_id'=r.id
     and p.purpose='apartment_rent' and p.status not in('failed','cancelled','expired','refunded','reversed')) then
   raise exception 'Finish or cancel the existing stay checkout before splitting costs'; end if;
 if coalesce(cardinality(p_conversation_ids),0)<1
   or cardinality(p_conversation_ids)>=coalesce(r.guest_count,0)
   or cardinality(p_conversation_ids)<>(select count(distinct x) from unnest(p_conversation_ids) x) then
   raise exception 'Choose distinct connections within the reserved guest count'; end if;

 foreach cid in array p_conversation_ids loop
   select * into c from public.conversations where id=cid and conversation_type='roommate'
     and coalesce(status,'active') in('active','accepted') and actor in(participant_a,participant_b);
   if c.id is null then raise exception 'Every person must have an accepted roommate conversation'; end if;
   peer:=case when c.participant_a=actor then c.participant_b else c.participant_a end;
   if peer=any(peers) then raise exception 'Choose each roommate once'; end if;
   if not exists(select 1 from public.profiles p where p.user_id=peer and p.account_kind='consumer'
     and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)) then
     raise exception 'Every invited person must have an active Personal account'; end if;
   if exists(select 1 from public.roommate_user_blocks b where
     (b.blocker_user_id=actor and b.blocked_user_id=peer) or (b.blocker_user_id=peer and b.blocked_user_id=actor)) then
     raise exception 'A blocked roommate cannot join a shared payment'; end if;
   peers:=array_append(peers,peer);
 end loop;

 requested_peers:=array(select unnest(peers) order by 1);
 if r.shared_payment_group_id is not null then
   select array_agg(m.user_id order by m.user_id) into existing_peers
   from public.shared_housing_members m where m.group_id=r.shared_payment_group_id and m.user_id<>actor;
   if existing_peers is distinct from requested_peers then raise exception 'This stay already has a different shared payment'; end if;
   return public.get_my_shared_housing_group(r.shared_payment_group_id);
 end if;

 capacity:=coalesce(l.max_guests,0); people:=array_prepend(actor,peers); member_count:=cardinality(people);
 if member_count<2 or member_count>capacity or member_count>12 then raise exception 'Selected paying guests exceed this Short Let capacity'; end if;
 eligible:=round(coalesce(r.stay_rent_total,0),2); refundable:=round(coalesce(r.security_deposit_snapshot,0),2); total:=eligible+refundable;
 if eligible<=0 or refundable<0 or total<=0 then raise exception 'Stored Short Let balance is invalid'; end if;
 deadline:=r.short_stay_balance_due_at;

 insert into public.shared_housing_groups(
   id,listing_id,created_by,status,member_limit,total_amount,conversation_id,payment_phase,
   reservation_fee_total,contract_total,expires_at,reservation_id,product_type,canonical_group_id,
   stay_check_in,stay_check_out,guest_count,checkout_attempt,created_at,updated_at
 ) values(gid,l.id,actor,'inviting',member_count,total,
   case when cardinality(p_conversation_ids)=1 then p_conversation_ids[1] else null end,
   'short_stay',0,total,deadline,r.id,'short_let',gid,r.stay_check_in,r.stay_check_out,r.guest_count,1,now(),now());

 insert into public.shared_payment_groups(
   shared_payment_group_id,product_type,listing_id,reservation_id,created_by,total_amount,capacity,status,
   checkout_expires_at,legacy_group_id,conversation_id,payment_phase,stay_check_in,stay_check_out,
   guest_count,checkout_attempt,created_at,updated_at
 ) values(gid,'short_let',l.id::text,r.id,actor,total,capacity,'inviting',deadline,gid,
   case when cardinality(p_conversation_ids)=1 then p_conversation_ids[1] else null end,
   'short_stay',r.stay_check_in,r.stay_check_out,r.guest_count,1,now(),now());

 for i in 1..member_count loop
   mid:=gen_random_uuid();
   share:=(floor(total*100/member_count)+case when i<=mod((total*100)::bigint,member_count) then 1 else 0 end)/100;
   eligible_share:=(floor(eligible*100/member_count)+case when i<=mod((eligible*100)::bigint,member_count) then 1 else 0 end)/100;
   refundable_share:=share-eligible_share;
   insert into public.shared_housing_members(
     id,group_id,user_id,invitation_status,share_amount,payment_status,canonical_member_id,
     eligible_partner_share,refundable_share,created_at,updated_at
   ) values(mid,gid,people[i],case when i=1 then 'accepted' else 'invited' end,share,'not_started',
     mid,eligible_share,refundable_share,now(),now());
   insert into public.shared_payment_members(
     shared_payment_member_id,shared_payment_group_id,user_id,share_amount,invitation_state,payment_state,
     legacy_member_id,eligible_partner_share,refundable_share,created_at,updated_at
   ) values(mid,gid,people[i],share,case when i=1 then 'accepted' else 'invited' end,'not_started',
     mid,eligible_share,refundable_share,now(),now());
   assigned:=assigned+share; eligible_assigned:=eligible_assigned+eligible_share; refundable_assigned:=refundable_assigned+refundable_share;
 end loop;
 if round(assigned,2)<>total or round(eligible_assigned,2)<>eligible or round(refundable_assigned,2)<>refundable then
   raise exception 'Shared Short Let split did not reconcile'; end if;
 update public.reservations set shared_payment_group_id=gid,updated_at=now() where id=r.id;
 return public.get_my_shared_housing_group(gid);
end $$;
revoke all on function public.create_my_shared_short_let(text,uuid[]) from public,anon;
grant execute on function public.create_my_shared_short_let(text,uuid[]) to authenticated,service_role;

create or replace function public.respond_to_shared_housing_invite(p_group_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare actor text:=public.current_profile_user_id(); g public.shared_housing_groups;
 r public.reservations; deadline timestamptz;
begin
 if actor is null or not public.current_actor_has_personal_workspace() then raise exception 'Active Personal account required'; end if;
 select * into g from public.shared_housing_groups where id=p_group_id for update;
 if g.id is null or g.status<>'inviting' or g.expires_at<=now() then raise exception 'Pending shared-payment invitation not found'; end if;
 select * into r from public.reservations where id=g.reservation_id for update;
 if p_accept and exists(select 1 from public.shared_housing_members m join public.profiles p on p.user_id=m.user_id
   where m.group_id=p_group_id and (coalesce(p.deleted,false) or coalesce(p.suspended,false) or coalesce(p.banned,false))) then
   raise exception 'A participant is no longer eligible'; end if;
 if p_accept and exists(select 1 from public.shared_housing_members m join public.roommate_user_blocks b
   on (b.blocker_user_id=actor and b.blocked_user_id=m.user_id) or (b.blocker_user_id=m.user_id and b.blocked_user_id=actor)
   where m.group_id=p_group_id) then raise exception 'Blocked participants cannot accept shared payment'; end if;

 update public.shared_housing_members set invitation_status=case when p_accept then 'accepted' else 'declined' end,updated_at=now()
 where group_id=p_group_id and user_id=actor and invitation_status='invited';
 if not found then raise exception 'Pending shared-payment invitation not found'; end if;
 update public.shared_payment_members set invitation_state=case when p_accept then 'accepted' else 'declined' end,updated_at=now()
 where shared_payment_group_id=p_group_id and user_id=actor;

 if not p_accept then
   if exists(select 1 from public.shared_housing_members where group_id=p_group_id and payment_status='paid') then
     update public.shared_housing_groups set status='refunding',updated_at=now() where id=p_group_id;
     update public.shared_payment_groups set status='refunding',updated_at=now() where shared_payment_group_id=p_group_id;
   else
     update public.shared_housing_groups set status='cancelled',updated_at=now() where id=p_group_id;
     update public.shared_payment_groups set status='cancelled',updated_at=now() where shared_payment_group_id=p_group_id;
     update public.reservations set shared_payment_group_id=null,updated_at=now()
     where id=g.reservation_id and shared_payment_group_id=p_group_id and rent_payment_status='not_started';
   end if;
   return public.get_my_shared_housing_group(p_group_id);
 end if;

 if not exists(select 1 from public.shared_housing_members where group_id=p_group_id and invitation_status<>'accepted') then
   if g.product_type='short_let' then
     if r.id is null or r.reservation_fee_status<>'paid' or r.short_stay_balance_due_at is null or r.short_stay_balance_due_at<=now() then
       raise exception 'This Short Let balance window is no longer active'; end if;
     deadline:=least(r.short_stay_balance_due_at,now()+interval '30 minutes');
   else deadline:=now()+interval '30 minutes'; end if;
   update public.shared_housing_groups set status='payment_pending',expires_at=deadline,updated_at=now() where id=p_group_id;
   update public.shared_payment_groups set status='checkout_open',checkout_expires_at=deadline,updated_at=now()
   where shared_payment_group_id=p_group_id;
 end if;
 return public.get_my_shared_housing_group(p_group_id);
end $$;

create or replace function public.normalize_paid_shared_short_let()
returns trigger language plpgsql security definer set search_path='pg_catalog','public' as $$
declare r public.reservations;
begin
 if new.product_type<>'short_let' or new.status<>'fully_paid'
   or (tg_op='UPDATE' and old.status='fully_paid') then return new; end if;
 select * into r from public.reservations where id=new.reservation_id for update;
 if r.id is null then raise exception 'Shared Short Let reservation is missing'; end if;
 if r.reservation_fee_status<>'paid' or r.reservation_fee_paid_at is null
   or r.manual_payment_status not in('paid','completed') then
   raise exception 'Reserve date payment is missing from the Shared Short Let'; end if;
 update public.reservations set status='ready_for_move_in',rent_payment_status='paid',
   rent_paid_at=coalesce(rent_paid_at,now()),canonical_state='stay_paid',
   security_deposit_status=case when coalesce(security_deposit_snapshot,0)>0 then 'held' else 'not_required' end,
   payment_expires_at=null,updated_at=now()
 where id=r.id and status<>'payment_conflict';
 insert into public.short_let_booking_transitions(
   reservation_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,metadata
 ) values(r.id,coalesce(r.canonical_state,'date_reserved'),'stay_paid','shared_stay_payment_verified',
   'short-let-shared-stay-paid:'||new.shared_payment_group_id,new.created_by,'customer',
   jsonb_build_object('shared_payment_group_id',new.shared_payment_group_id,'reservation_fee_kept_separate',true))
 on conflict(event_key) do nothing;
 return new;
end $$;
drop trigger if exists shared_short_let_paid_normalize on public.shared_payment_groups;
create trigger shared_short_let_paid_normalize after update of status on public.shared_payment_groups
for each row execute function public.normalize_paid_shared_short_let();
