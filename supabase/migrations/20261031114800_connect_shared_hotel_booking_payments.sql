begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Hotel stays use the existing shared checkout and component ledger. A Hotel
-- group refers to its real Hotel booking, never to a fabricated Home listing.
alter table public.shared_payment_groups
 alter column listing_id drop not null,
 drop constraint shared_payment_groups_product_type_check,
 drop constraint shared_payment_groups_product_type_check1,
 add column hotel_booking_id integer references public.hotel_bookings(booking_id) on delete restrict,
 add column hotel_checkout_snapshot jsonb,
 add constraint shared_payment_groups_product_type_check check(product_type in('long_let','short_let','hotel')),
 add constraint shared_payment_group_resource check(
  (product_type='hotel' and listing_id is null and reservation_id is null and hotel_booking_id is not null
   and payment_phase='short_stay' and hotel_checkout_snapshot is not null and jsonb_typeof(hotel_checkout_snapshot)='object')
  or (product_type<>'hotel' and listing_id is not null and hotel_booking_id is null and hotel_checkout_snapshot is null));
create unique index shared_payment_hotel_booking_idx on public.shared_payment_groups(hotel_booking_id) where hotel_booking_id is not null;
alter table public.shared_housing_groups
 alter column listing_id drop not null,
 add column hotel_booking_id integer references public.hotel_bookings(booking_id) on delete restrict,
 add constraint shared_housing_group_resource check(
  (product_type='hotel' and listing_id is null and reservation_id is null and hotel_booking_id is not null and payment_phase='short_stay')
  or (product_type is distinct from 'hotel' and listing_id is not null and hotel_booking_id is null));
create unique index shared_housing_hotel_booking_idx on public.shared_housing_groups(hotel_booking_id) where hotel_booking_id is not null;
alter table public.hotel_bookings add column shared_payment_group_id uuid references public.shared_payment_groups(shared_payment_group_id) on delete restrict;
alter table public.hotel_bookings drop constraint hotel_bookings_payment_status_check;
alter table public.hotel_bookings add constraint hotel_bookings_payment_status_check
 check(payment_status in('unpaid','payment_pending','paid','refunded','failed','expired','refund_pending'));
create unique index hotel_bookings_shared_group_idx on public.hotel_bookings(shared_payment_group_id) where shared_payment_group_id is not null;
alter table public.shared_payment_protection_components drop constraint shared_payment_protection_components_component_type_check;
alter table public.shared_payment_protection_components add constraint shared_payment_protection_components_component_type_check
 check(component_type in('reservation_fee','long_let_payment','short_let_stay','short_let_caution','hotel_stay'));

create function private.shared_hotel_group_receipt(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();result jsonb;
begin
 if actor is null or not public._property_document_session_active() or not public.current_actor_has_personal_workspace()
  or not exists(select 1 from public.shared_housing_members where group_id=p_group_id and user_id=actor) then
  raise exception 'Trusted shared-payment access required' using errcode='42501';end if;
 select jsonb_build_object('id',g.id,'canonical_group_id',c.shared_payment_group_id,
  'created_by',g.created_by,'created_at',g.created_at,'conversation_id',null,'listing_id',null,
  'hotel_id',h.hotel_id,'hotel_booking_id',b.booking_id,'status',g.status,'product_type','hotel',
  'payment_phase',g.payment_phase,'expires_at',g.expires_at,'checkout_attempt',g.checkout_attempt,
  'total_amount',g.total_amount,'guest_count',b.guest_count,'stay_check_in',b.check_in,'stay_check_out',b.check_out,
  'booking_status',b.status,'cancellation_snapshot',c.hotel_checkout_snapshot->'cancellation_snapshot',
  'listing',jsonb_build_object('id',h.hotel_id::text,'title',h.name||' · '||r.room_type,
   'image',coalesce(r.images[1],h.images[1]),'city',h.city,'state',h.state),
  'hotel_arrival',case when c.status='fully_paid' and b.payment_status='paid' and b.status in('confirmed','checked_in','checked_out','completed') then
   jsonb_build_object('booking_id',b.booking_id,'booking_code',b.booking_code,'address',h.address,
    'check_in_time',h.check_in_time,'check_out_time',h.check_out_time,'timezone',h.timezone) else null end,
  'members',(select jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',coalesce(p.full_name,p.username,'Guest'),
   'invitation_status',m.invitation_status,'share_amount',m.share_amount,'eligible_partner_share',m.eligible_partner_share,
   'refundable_share',m.refundable_share,'payment_status',m.payment_status,'paid_at',m.paid_at,
   'payment_reference',case when m.user_id=actor then m.payment_reference else null end,
   'refund_status',case when m.user_id=actor then (select a.status from public.financial_action_outbox a
    join public.payment_protection_transactions pp on pp.id=a.payment_protection_id
    where pp.paystack_reference=m.payment_reference and a.action_type like 'refund_%' order by a.created_at desc limit 1) else null end)
   order by m.created_at,m.id)
   from public.shared_housing_members m join public.profiles p on p.user_id=m.user_id where m.group_id=g.id)) into result
 from public.shared_housing_groups g join public.shared_payment_groups c on c.shared_payment_group_id=g.canonical_group_id
 join public.hotel_bookings b on b.booking_id=g.hotel_booking_id
 join public.hotels h on h.hotel_id=b.hotel_id join public.hotel_rooms r on r.room_id=b.room_id
 where g.id=p_group_id and g.product_type='hotel' and c.hotel_booking_id=b.booking_id and b.shared_payment_group_id=c.shared_payment_group_id;
 if result is null then raise exception 'Shared Hotel booking is unavailable';end if;return result;
end $$;
revoke all on function private.shared_hotel_group_receipt(uuid) from public,anon,authenticated;

create function public.create_my_shared_hotel(p_booking_id integer,p_user_ids text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();b public.hotel_bookings;r public.hotel_rooms;
 c public.shared_payment_groups;peer text;people text[];count_people integer;gid uuid:=gen_random_uuid();mid uuid;
 q jsonb;total_minor bigint;net_minor bigint;share_minor bigint;net_share_minor bigint;i integer;
begin
 perform private.hotel_checkout_actor();
 if actor is null or not public.current_actor_has_personal_workspace() then raise exception 'Active Personal account required';end if;
 select * into b from public.hotel_bookings where booking_id=p_booking_id and user_id=actor for update;
 if b.booking_id is null then raise exception 'Your Hotel booking was not found';end if;
 if cardinality(p_user_ids) is null or cardinality(p_user_ids) not between 1 and 2
  or cardinality(p_user_ids)<>(select count(distinct x) from unnest(p_user_ids)x) then
  raise exception 'Choose one or two distinct accepted Friends joining this stay';end if;
 foreach peer in array p_user_ids loop
  if peer is null or peer=actor or not public.are_friends(actor,peer)
   or public.user_has_active_workspace(peer,'personal') is distinct from true then
   raise exception 'Only active accepted Friends joining this stay can pay a share';end if;
 end loop;
 if b.shared_payment_group_id is not null then
  if array(select m.user_id from public.shared_housing_members m where m.group_id=b.shared_payment_group_id and m.user_id<>actor order by m.user_id)
    is distinct from array(select unnest(p_user_ids) order by 1) then raise exception 'This stay already has different paying guests';end if;
  return private.shared_hotel_group_receipt(b.shared_payment_group_id);
 end if;
 if b.status<>'pending' or b.payment_expires_at is null or b.payment_expires_at<=now()
  or private.hotel_booking_has_recorded_payment(b.booking_id) then raise exception 'Only an active unpaid Hotel hold can start shared costs';end if;
 if exists(select 1 from public.booking_payments where hotel_booking_id=b.booking_id and purpose='hotel_booking'
  and status not in('cancelled','expired','failed','refunded','reversed')) then
  raise exception 'A single-payer checkout already exists. Finish or release that hold before sharing';end if;
 select * into r from public.hotel_rooms where room_id=b.room_id;
 people:=array_prepend(actor,array(select unnest(p_user_ids) order by 1));count_people:=cardinality(people);
 if count_people>b.guest_count or b.guest_count>r.max_guests then raise exception 'Paying guests must fit within the reserved guest count and room capacity';end if;
 if b.cancellation_snapshot is null then raise exception 'Saved Hotel cancellation terms are required';end if;
 q:=private.hotel_checkout_fee_snapshot(b.booking_id)||jsonb_build_object('cancellation_snapshot',b.cancellation_snapshot,
  'check_in',b.check_in,'check_out',b.check_out,'guest_count',b.guest_count,'hold_expires_at',b.payment_expires_at,'guests_only',true,'organiser_user_id',actor);
 total_minor:=b.total_price*100;net_minor:=(q->>'partner_net_amount')::numeric*100;
 if total_minor<count_people then raise exception 'Each guest must have a positive recorded share';end if;
 insert into public.shared_housing_groups(id,created_by,status,member_limit,total_amount,expires_at,payment_phase,
  reservation_fee_total,contract_total,product_type,canonical_group_id,stay_check_in,stay_check_out,guest_count,checkout_attempt,hotel_booking_id)
 values(gid,actor,'inviting',count_people,b.total_price,b.payment_expires_at,'short_stay',0,b.total_price,'hotel',gid,b.check_in,b.check_out,b.guest_count,1,b.booking_id);
 insert into public.shared_payment_groups(shared_payment_group_id,product_type,created_by,total_amount,capacity,status,checkout_expires_at,
  policy_version_id,legacy_group_id,payment_phase,stay_check_in,stay_check_out,guest_count,checkout_attempt,hotel_booking_id,hotel_checkout_snapshot)
 values(gid,'hotel',actor,b.total_price,r.max_guests,'inviting',b.payment_expires_at,(q->>'commission_policy_version_id')::uuid,
  gid,'short_stay',b.check_in,b.check_out,b.guest_count,1,b.booking_id,q);
 for i in 1..count_people loop
  mid:=gen_random_uuid();share_minor:=total_minor/count_people+case when i<=mod(total_minor,count_people) then 1 else 0 end;
  net_share_minor:=net_minor/count_people+case when i<=mod(net_minor,count_people) then 1 else 0 end;
  insert into public.shared_housing_members(id,group_id,user_id,invitation_status,share_amount,payment_status,canonical_member_id,eligible_partner_share,refundable_share)
  values(mid,gid,people[i],case when i=1 then 'accepted' else 'invited' end,share_minor/100.0,'not_started',mid,net_share_minor/100.0,0);
  insert into public.shared_payment_members(shared_payment_member_id,shared_payment_group_id,user_id,share_amount,invitation_state,payment_state,legacy_member_id,eligible_partner_share,refundable_share)
  values(mid,gid,people[i],share_minor/100.0,case when i=1 then 'accepted' else 'invited' end,'not_started',mid,net_share_minor/100.0,0);
 end loop;
 update public.hotel_bookings set shared_payment_group_id=gid,updated_at=now() where booking_id=b.booking_id;
 return private.shared_hotel_group_receipt(gid);
end $$;
revoke all on function public.create_my_shared_hotel(integer,text[]) from public,anon;
grant execute on function public.create_my_shared_hotel(integer,text[]) to authenticated;

create function private.respond_shared_hotel_invite(p_group_id uuid,p_accept boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();g public.shared_housing_groups;m public.shared_housing_members;
begin
 perform private.shared_hotel_group_receipt(p_group_id);
 select * into g from public.shared_housing_groups where id=p_group_id and product_type='hotel' for update;
 select * into m from public.shared_housing_members where group_id=g.id and user_id=actor for update;
 if m.invitation_status=(case when p_accept then 'accepted' else 'declined' end) then return private.shared_hotel_group_receipt(g.id);end if;
 if g.status<>'inviting' or g.expires_at<=now() or m.invitation_status<>'invited' then raise exception 'This Hotel invitation is no longer accepting decisions';end if;
 if p_accept and exists(select 1 from public.shared_housing_members other where other.group_id=g.id and
  (public.user_has_active_workspace(other.user_id,'personal') is distinct from true
   or (other.user_id<>g.created_by and not public.are_friends(g.created_by,other.user_id)))) then
  raise exception 'A paying guest is no longer eligible';end if;
 update public.shared_housing_members set invitation_status=case when p_accept then 'accepted' else 'declined' end,updated_at=now() where id=m.id;
 update public.shared_payment_members set invitation_state=case when p_accept then 'accepted' else 'declined' end,updated_at=now() where shared_payment_member_id=m.canonical_member_id;
 if not p_accept then
  update public.shared_housing_groups set status='cancelled',updated_at=now() where id=g.id;
  update public.shared_payment_groups set status='cancelled',updated_at=now() where shared_payment_group_id=g.canonical_group_id;
  update public.hotel_bookings set status='cancelled',canonical_state='cancelled',payment_status='expired',updated_at=now() where booking_id=g.hotel_booking_id;
 elsif not exists(select 1 from public.shared_housing_members where group_id=g.id and invitation_status<>'accepted') then
  update public.shared_housing_groups set status='payment_pending',updated_at=now() where id=g.id;
  update public.shared_payment_groups set status='checkout_open',updated_at=now() where shared_payment_group_id=g.canonical_group_id;
 end if;
 -- Accepting never extends the original room hold.
 return private.shared_hotel_group_receipt(g.id);
end $$;
revoke all on function private.respond_shared_hotel_invite(uuid,boolean) from public,anon,authenticated;

create function private.shared_hotel_payment_snapshot(p_group_id uuid,p_user_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare g public.shared_housing_groups;c public.shared_payment_groups;m public.shared_housing_members;b public.hotel_bookings;q jsonb;
begin
 select * into g from public.shared_housing_groups where id=p_group_id and product_type='hotel';
 select * into c from public.shared_payment_groups where shared_payment_group_id=g.canonical_group_id and product_type='hotel';
 select * into b from public.hotel_bookings where booking_id=g.hotel_booking_id;
 select * into m from public.shared_housing_members where group_id=g.id and user_id=p_user_id;
 if g.id is null or c.shared_payment_group_id is null or b.booking_id is null or m.id is null
  or c.legacy_group_id is distinct from g.id or c.hotel_booking_id is distinct from b.booking_id
  or b.shared_payment_group_id is distinct from c.shared_payment_group_id or c.checkout_attempt is distinct from g.checkout_attempt
  or c.total_amount is distinct from g.total_amount or c.total_amount is distinct from b.total_price
  or c.guest_count is distinct from b.guest_count or g.guest_count is distinct from b.guest_count
  or c.checkout_expires_at is distinct from g.expires_at or g.expires_at is distinct from b.payment_expires_at
  or c.stay_check_in is distinct from b.check_in or g.stay_check_in is distinct from b.check_in
  or c.stay_check_out is distinct from b.check_out or g.stay_check_out is distinct from b.check_out
  or m.invitation_status<>'accepted' then raise exception 'Shared Hotel checkout identity or terms changed';end if;
 q:=c.hotel_checkout_snapshot;
 if q->>'guests_only' is distinct from 'true' or (q->>'booking_id')::integer is distinct from b.booking_id
  or q->'cancellation_snapshot' is distinct from b.cancellation_snapshot
  or q->>'payee_user_id' is distinct from (select owner_id from public.hotels where hotel_id=b.hotel_id)
  or c.policy_version_id is distinct from (q->>'commission_policy_version_id')::uuid
  or (select count(*) from public.shared_housing_members where group_id=g.id) not between 2 and least(3,b.guest_count,c.capacity)
  or (select count(*) from public.shared_payment_members where shared_payment_group_id=c.shared_payment_group_id)
    is distinct from (select count(*) from public.shared_housing_members where group_id=g.id)
  or exists(select 1 from public.shared_housing_members lm left join public.shared_payment_members cm
   on cm.shared_payment_member_id=lm.canonical_member_id and cm.shared_payment_group_id=c.shared_payment_group_id
   where lm.group_id=g.id and (cm.shared_payment_member_id is null or cm.legacy_member_id is distinct from lm.id
    or cm.user_id is distinct from lm.user_id or cm.share_amount is distinct from lm.share_amount
    or cm.eligible_partner_share is distinct from lm.eligible_partner_share or cm.invitation_state is distinct from lm.invitation_status))
  or (select sum(share_amount) from public.shared_housing_members where group_id=g.id) is distinct from c.total_amount
  or (select sum(eligible_partner_share) from public.shared_housing_members where group_id=g.id) is distinct from (q->>'partner_net_amount')::numeric
  or m.eligible_partner_share<0 or m.eligible_partner_share>m.share_amount then
  raise exception 'Shared Hotel payer amounts or saved Partner earnings do not reconcile';end if;
 return jsonb_build_object('version',1,'group_id',g.id,'canonical_group_id',c.shared_payment_group_id,
  'member_id',m.id,'canonical_member_id',m.canonical_member_id,'hotel_booking_id',b.booking_id,'hotel_id',b.hotel_id,
  'checkout_attempt',g.checkout_attempt,'payer_user_id',p_user_id,'payee_user_id',q->>'payee_user_id','currency','NGN',
  'amount',m.share_amount,'partner_net_amount',m.eligible_partner_share,'commission_amount',m.share_amount-m.eligible_partner_share,
  'commission_percent',(q->>'commission_percent')::numeric,'commission_policy_version_id',c.policy_version_id,
  'accepted_terms',q);
end $$;
revoke all on function private.shared_hotel_payment_snapshot(uuid,text) from public,anon,authenticated;

create function private.create_shared_hotel_payment(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();g public.shared_housing_groups;m public.shared_housing_members;
 p public.booking_payments;q jsonb;reference text;
begin
 perform private.shared_hotel_group_receipt(p_group_id);
 select * into g from public.shared_housing_groups where id=p_group_id and product_type='hotel' for update;
 select * into m from public.shared_housing_members where group_id=g.id and user_id=actor for update;
 if m.payment_status='paid' then return jsonb_build_object('success',true,'already_paid',true);end if;
 if g.status<>'payment_pending' or g.expires_at<=now()
  or exists(select 1 from public.shared_housing_members where group_id=g.id and invitation_status<>'accepted')
  or exists(select 1 from public.shared_housing_members where group_id=g.id and public.user_has_active_workspace(user_id,'personal') is distinct from true)
  or not exists(select 1 from public.hotel_bookings where booking_id=g.hotel_booking_id and status='pending') then
  raise exception 'All guests must accept and pay before the original Hotel hold expires';end if;
 q:=private.shared_hotel_payment_snapshot(g.id,actor);
 if m.payment_reference is not null then
  select * into p from public.booking_payments where paystack_reference=m.payment_reference and purpose='shared_housing_share';
  if p.status='pending' and p.metadata->'hotel_share_snapshot'=q then
   return jsonb_build_object('success',true,'reference',p.paystack_reference,'amount',p.amount_total,'existing',true);end if;
  raise exception 'A recorded checkout already exists for your share. Refresh its payment status';
 end if;
 reference:='WHHOTELSHARE-'||upper(replace(gen_random_uuid()::text,'-',''));
 insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,payee_user_id,type,booking_type,
  hotel_booking_id,amount,amount_total,currency,status,purpose,payment_method,commission_rate,amount_commission,net_amount,
  commission_policy_version_id,commission_frozen_at,metadata)
 values(reference,reference,actor,actor,q->>'payee_user_id','shared_housing','shared_housing',g.hotel_booking_id,m.share_amount,m.share_amount,'NGN','pending',
  'shared_housing_share','paystack',(q->>'commission_percent')::numeric,(q->>'commission_amount')::numeric,(q->>'partner_net_amount')::numeric,
  (q->>'commission_policy_version_id')::uuid,now(),jsonb_build_object('shared_group_id',g.id,
   'shared_member_id',m.id::text||':short_stay:'||g.checkout_attempt,'legacy_shared_member_id',m.id,
   'canonical_shared_payment_group_id',g.canonical_group_id,'canonical_shared_payment_member_id',m.canonical_member_id,
   'canonical_product_type','hotel','payment_phase','short_stay','checkout_attempt',g.checkout_attempt,
   'hotel_booking_id',g.hotel_booking_id,'eligible_partner_amount',m.eligible_partner_share,'refundable_amount',0,'hotel_share_snapshot',q));
 update public.shared_housing_members set payment_reference=reference,payment_status='pending',updated_at=now() where id=m.id;
 update public.shared_payment_members set provider_reference=reference,payment_state='provider_pending',updated_at=now() where shared_payment_member_id=m.canonical_member_id;
 return jsonb_build_object('success',true,'reference',reference,'amount',m.share_amount,'existing',false);
end $$;
revoke all on function private.create_shared_hotel_payment(uuid) from public,anon,authenticated;

create function private.shared_hotel_payment_valid(p_payment public.booking_payments,p_customer text,p_live boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare g public.shared_housing_groups;m public.shared_housing_members;c public.shared_payment_groups;q jsonb;
begin
 if p_payment.purpose is distinct from 'shared_housing_share' or p_payment.metadata->>'canonical_product_type' is distinct from 'hotel'
  or p_payment.user_id is distinct from p_customer or coalesce(p_payment.payer_user_id,p_payment.user_id) is distinct from p_customer
  or p_payment.currency is distinct from 'NGN' or p_payment.commission_frozen_at is null then return false;end if;
 select * into g from public.shared_housing_groups where id=(p_payment.metadata->>'shared_group_id')::uuid and product_type='hotel';
 select * into m from public.shared_housing_members where group_id=g.id and user_id=p_customer;
 select * into c from public.shared_payment_groups where shared_payment_group_id=g.canonical_group_id;
 q:=private.shared_hotel_payment_snapshot(g.id,p_customer);
 if p_payment.metadata->'hotel_share_snapshot' is distinct from q
  or p_payment.hotel_booking_id is distinct from g.hotel_booking_id or p_payment.listing_id is not null
  or p_payment.amount_total is distinct from m.share_amount or p_payment.amount is distinct from m.share_amount
  or p_payment.paystack_reference is distinct from m.payment_reference
  or p_payment.payee_user_id is distinct from q->>'payee_user_id'
  or p_payment.net_amount is distinct from (q->>'partner_net_amount')::numeric
  or p_payment.amount_commission is distinct from (q->>'commission_amount')::numeric
  or p_payment.commission_rate is distinct from (q->>'commission_percent')::numeric
  or p_payment.commission_policy_version_id is distinct from (q->>'commission_policy_version_id')::uuid
  or p_payment.metadata->>'legacy_shared_member_id' is distinct from m.id::text
  or p_payment.metadata->>'canonical_shared_payment_member_id' is distinct from m.canonical_member_id::text
  or p_payment.metadata->>'canonical_shared_payment_group_id' is distinct from g.canonical_group_id::text
  or p_payment.metadata->>'shared_member_id' is distinct from m.id::text||':short_stay:'||g.checkout_attempt
  or p_payment.metadata->>'payment_phase' is distinct from 'short_stay'
  or p_payment.metadata->>'checkout_attempt' is distinct from g.checkout_attempt::text then return false;end if;
 if p_live and (p_payment.status<>'pending' or g.status<>'payment_pending' or c.status<>'checkout_open' or g.expires_at<=now()
  or m.payment_status<>'pending' or public.user_has_active_workspace(p_customer,'personal') is distinct from true
  or exists(select 1 from public.shared_housing_members where group_id=g.id and
   (invitation_status<>'accepted' or public.user_has_active_workspace(user_id,'personal') is distinct from true))
  or not exists(select 1 from public.hotel_bookings where booking_id=g.hotel_booking_id and status='pending')) then return false;end if;
 return true;
exception when invalid_text_representation or invalid_parameter_value or raise_exception then return false;
end $$;
revoke all on function private.shared_hotel_payment_valid(public.booking_payments,text,boolean) from public,anon,authenticated;

create function private.confirm_shared_hotel_payment(p_reference text,p_transaction_id text,p_amount numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.booking_payments;g public.shared_housing_groups;b public.hotel_bookings;m public.shared_housing_members;quote jsonb;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service authority required' using errcode='42501';end if;
 select * into p from public.booking_payments where paystack_reference=p_reference and purpose='shared_housing_share' for update;
 if p.id is null then raise exception 'Shared Hotel payment not found';end if;
 if p.status in('paid','completed') then return jsonb_build_object('success',true,'already_processed',true);end if;
 select * into g from public.shared_housing_groups where id=(p.metadata->>'shared_group_id')::uuid for update;
 select * into b from public.hotel_bookings where booking_id=g.hotel_booking_id for update;
 select * into m from public.shared_housing_members where group_id=g.id and user_id=p.user_id for update;
 if not private.shared_hotel_payment_valid(p,p.user_id,false) or p_amount is null or p_amount::text in('NaN','Infinity','-Infinity')
  or p_amount is distinct from p.amount_total then raise exception 'Verified Hotel share does not match its saved checkout';end if;
 update public.booking_payments set status='paid',verified_amount=p_amount,verified_at=now(),paid_at=now(),
  paystack_transaction_id=p_transaction_id,webhook_processed=true,verification_source='webhook',updated_at=now() where id=p.id;
 update public.shared_housing_members set payment_status='paid',paid_at=now(),updated_at=now() where id=m.id;
 update public.shared_payment_members set payment_state='paid',paid_at=now(),updated_at=now() where shared_payment_member_id=m.canonical_member_id;
 if g.expires_at<=now() or g.status not in('payment_pending','paid') or b.status not in('pending','confirmed') then
  update public.shared_housing_groups set status='refunding',updated_at=now() where id=g.id;
  update public.shared_payment_groups set status='refunding',updated_at=now() where shared_payment_group_id=g.canonical_group_id;
  update public.hotel_bookings set status='cancelled',canonical_state='cancelled',payment_status='refund_pending',updated_at=now() where booking_id=b.booking_id;
  return jsonb_build_object('success',true,'group_id',g.id,'refund_required',true);
 end if;
 if not exists(select 1 from public.shared_housing_members where group_id=g.id and (invitation_status<>'accepted' or payment_status<>'paid')) then
  quote:=private.hotel_booking_quote_v2(b.room_id,b.rate_plan_id,b.check_in,b.check_out,b.booking_id,false);
  if not coalesce((quote->>'available')::boolean,false) then
   update public.shared_housing_groups set status='refunding',updated_at=now() where id=g.id;
   update public.shared_payment_groups set status='refunding',updated_at=now() where shared_payment_group_id=g.canonical_group_id;
   update public.hotel_bookings set status='payment_conflict',canonical_state='payment_conflict',payment_status='refund_pending',updated_at=now() where booking_id=b.booking_id;
   return jsonb_build_object('success',true,'group_id',g.id,'refund_required',true,'conflict',true);
  end if;
  update public.shared_housing_groups set status='paid',updated_at=now() where id=g.id;
  update public.shared_payment_groups set status='fully_paid',updated_at=now() where shared_payment_group_id=g.canonical_group_id;
  update public.hotel_bookings set status='confirmed',canonical_state='confirmed',payment_status='paid',paid_at=coalesce(paid_at,now()),
   confirmed_at=coalesce(confirmed_at,now()),policy_version_id=p.commission_policy_version_id,updated_at=now() where booking_id=b.booking_id;
 end if;
 return jsonb_build_object('success',true,'group_id',g.id,'hotel_booking_id',b.booking_id);
end $$;
revoke all on function private.confirm_shared_hotel_payment(text,text,numeric) from public,anon,authenticated;

create function private.create_shared_hotel_protection(p_payment_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.booking_payments;q jsonb;protection public.payment_protection_transactions;subject text;
begin
 select * into p from public.booking_payments where id=p_payment_id for update;
 if p.status not in('paid','completed') or p.verified_at is null or p.verified_amount is distinct from p.amount_total
  or not private.shared_hotel_payment_valid(p,p.user_id,false) then raise exception 'Hotel share needs a matching verified payment';end if;
 q:=p.metadata->'hotel_share_snapshot';subject:='shared:'||(q->>'member_id')||':hotel:'||(q->>'checkout_attempt');
 insert into public.payment_protection_transactions(booking_type,payer_user_id,payee_user_id,amount_total,amount_commission,
  amount_payee,commission_rate,status,paystack_reference,protection_state,subject_type,subject_id)
 values('hotel_stay',p.user_id,p.payee_user_id,p.amount_total,p.amount_commission,p.net_amount,p.commission_rate,
  'protected',p.paystack_reference,'awaiting_funds','hotel_stay',subject)
 on conflict(subject_type,subject_id) do nothing;
 select * into protection from public.payment_protection_transactions where subject_type='hotel_stay' and subject_id=subject for update;
 if protection.payer_user_id is distinct from p.user_id or protection.payee_user_id is distinct from p.payee_user_id
  or protection.paystack_reference is distinct from p.paystack_reference or protection.amount_total is distinct from p.amount_total
  or protection.amount_commission is distinct from p.amount_commission or protection.amount_payee is distinct from p.net_amount then
  raise exception 'An existing Hotel share protection has different payment terms';end if;
 insert into public.shared_payment_protection_components(shared_payment_group_id,shared_payment_member_id,payment_protection_id,component_type,amount,provider_reference)
 values((q->>'canonical_group_id')::uuid,(q->>'canonical_member_id')::uuid,protection.id,'hotel_stay',p.amount_total,p.paystack_reference)
 on conflict(payment_protection_id) do nothing;
 return protection.id;
end $$;
revoke all on function private.create_shared_hotel_protection(uuid) from public,anon,authenticated;

-- Customer commands cannot call the service-role-only transition API. This
-- private helper permits only the two holds already authorised by those commands.
create function private.hold_shared_hotel_protection(p_id uuid,p_state text,p_event text,p_key text,p_actor text,p_reason text,p_metadata jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare p public.payment_protection_transactions;
begin
 select * into p from public.payment_protection_transactions where id=p_id for update;
 if p.protection_state=p_state then return;end if;
 if p_state not in('risk_held','disputed') or p.protection_state not in('protected','release_eligible') then
  raise exception 'Shared Hotel funds are no longer eligible for a new hold';end if;
 insert into public.payment_protection_transitions(payment_protection_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,reason,metadata)
 values(p.id,p.protection_state,p_state,p_event,p_key,p_actor,case when p_actor is null then 'system' else 'customer' end,p_reason,p_metadata);
 update public.payment_protection_transactions set protection_state=p_state,status=p_state,risk_held_at=now(),updated_at=now() where id=p.id;
end $$;
revoke all on function private.hold_shared_hotel_protection(uuid,text,text,text,text,text,jsonb) from public,anon,authenticated;

create function private.queue_shared_hotel_refunds(p_group_id uuid,p_reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare g public.shared_housing_groups;item record;queued integer:=0;
begin
 select * into g from public.shared_housing_groups where id=p_group_id and product_type='hotel' for update;
 if g.id is null then raise exception 'Shared Hotel group not found';end if;
 for item in select p.* from public.shared_payment_protection_components c
  join public.payment_protection_transactions p on p.id=c.payment_protection_id
  where c.shared_payment_group_id=g.canonical_group_id and c.component_type='hotel_stay' order by p.id for update of p loop
  if item.protection_state='refunded' then continue;end if;
  if item.released_amount<>0 or item.refunded_amount<>0 or item.protection_state not in('protected','release_eligible','risk_held') then
   raise exception 'A shared Hotel payment requires Finance reconciliation before refund';end if;
  if exists(select 1 from public.financial_action_outbox where payment_protection_id=item.id and status<>'completed'
   and action_type not in('refund_shared_checkout','refund_hotel_cancellation')) then raise exception 'A shared Hotel payment already has an unsettled money action';end if;
  if item.protection_state<>'risk_held' then
   perform private.hold_shared_hotel_protection(item.id,'risk_held','shared_hotel_refund_requested',
    'shared-hotel-risk-held:'||item.id,null,p_reason,jsonb_build_object('reason',p_reason,'group_id',g.id));
  end if;
  insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
  values('refund_shared_checkout','shared_payment_member',
   (select shared_payment_member_id::text from public.shared_payment_protection_components where payment_protection_id=item.id),item.id,item.amount_total,
   'shared-hotel-refund:'||item.id,jsonb_build_object('shared_payment_group_id',g.canonical_group_id,'hotel_booking_id',g.hotel_booking_id,
    'reason',p_reason,'refund_destination','original_payment')) on conflict(idempotency_key) do nothing;
  if found then queued:=queued+1;end if;
 end loop;
 update public.booking_payments set status='cancelled',updated_at=now() where hotel_booking_id=g.hotel_booking_id and purpose='shared_housing_share' and status='pending';
 update public.shared_housing_members set payment_status='failed',updated_at=now() where group_id=g.id and payment_status='pending';
 update public.shared_payment_members set payment_state='failed',updated_at=now() where shared_payment_group_id=g.canonical_group_id and payment_state='provider_pending';
 update public.shared_housing_groups set status=case when exists(select 1 from public.shared_housing_members where group_id=g.id and payment_status='paid') then 'refunding' else 'cancelled' end,
  updated_at=now() where id=g.id;
 update public.shared_payment_groups set status=(select status from public.shared_housing_groups where id=g.id),
  updated_at=now() where shared_payment_group_id=g.canonical_group_id;
 update public.hotel_bookings set status='cancelled',canonical_state='cancelled',
  payment_status=case when exists(select 1 from public.shared_housing_members where group_id=g.id and payment_status in('paid','refunded')) then 'refund_pending' else 'expired' end,
  updated_at=now() where booking_id=g.hotel_booking_id;
 return queued;
end $$;
revoke all on function private.queue_shared_hotel_refunds(uuid,text) from public,anon,authenticated;

create function private.shared_hotel_protection_current(p_booking_id integer) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hotel_bookings b join public.shared_payment_groups g on g.shared_payment_group_id=b.shared_payment_group_id
  where b.booking_id=p_booking_id and g.product_type='hotel' and g.status='fully_paid' and b.payment_status='paid'
   and (select count(*) from public.shared_payment_members where shared_payment_group_id=g.shared_payment_group_id) between 2 and 3
   and (select sum(amount) from public.shared_payment_protection_components where shared_payment_group_id=g.shared_payment_group_id and component_type='hotel_stay')=b.total_price
   and not exists(select 1 from public.shared_payment_members m left join public.shared_payment_protection_components c
    on c.shared_payment_member_id=m.shared_payment_member_id and c.component_type='hotel_stay' and c.provider_reference=m.provider_reference
    left join public.payment_protection_transactions p on p.id=c.payment_protection_id
    where m.shared_payment_group_id=g.shared_payment_group_id and (m.invitation_state<>'accepted' or m.payment_state<>'paid'
     or p.id is null or p.payer_user_id is distinct from m.user_id or p.amount_total is distinct from m.share_amount
     or p.protected_ledger_transaction_id is null or p.protection_state not in('protected','release_eligible'))))
$$;
revoke all on function private.shared_hotel_protection_current(integer) from public,anon,authenticated;

create function private.shared_hotel_cancellation_preview(p_booking_id integer,p_actor text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.hotel_bookings;g public.shared_payment_groups;paid numeric;terms jsonb;state text;
 review jsonb:=jsonb_build_object('kind','review_required','can_cancel',false,'message','Contact WeHouse to review this shared Hotel booking.');
begin
 select * into b from public.hotel_bookings where booking_id=p_booking_id and user_id=p_actor;
 select * into g from public.shared_payment_groups where shared_payment_group_id=b.shared_payment_group_id and product_type='hotel';
 if b.booking_id is null or g.shared_payment_group_id is null then raise exception 'Hotel organiser access required';end if;
 if b.status in('cancelled','refunded','expired','payment_conflict') then
  return jsonb_build_object('kind','already_cancelled','can_cancel',false,'message','This shared stay is cancelled. Each recorded payment is refunded to its original payer.',
   'refund_status',case when b.payment_status='refunded' then 'completed' when b.payment_status='refund_pending' then 'pending' else null end);
 end if;
 select sum(m.share_amount) into paid from public.shared_payment_members m where m.shared_payment_group_id=g.shared_payment_group_id and m.payment_state='paid';
 if coalesce(paid,0)=0 and b.status='pending' then return jsonb_build_object('kind','unpaid','can_cancel',true,'message','Cancel this unpaid shared Hotel hold.',
  'currency','NGN','refund_amount_ngn',0,'fee_ngn',0);end if;
 terms:=g.hotel_checkout_snapshot->'cancellation_snapshot';
 -- Before complete funding, cancelling the coordinated hold returns all received shares.
 if b.status='pending' and g.status='checkout_open' or b.status='confirmed' and b.checked_in_at is null
  and coalesce((terms->>'refundable')::boolean,false) and (terms->>'deadline')::timestamptz>=now() then
  if exists(select 1 from public.shared_payment_protection_components c join public.payment_protection_transactions p on p.id=c.payment_protection_id
   where c.shared_payment_group_id=g.shared_payment_group_id and (p.protection_state not in('protected','release_eligible','refunded')
    or p.released_amount<>0 or exists(select 1 from public.financial_action_outbox a where a.payment_protection_id=p.id and a.status<>'completed'))) then return review;end if;
  return jsonb_build_object('kind','full_refund','can_cancel',true,'message','Cancel the whole shared stay. Each received share returns to its original payer.',
   'currency','NGN','refund_amount_ngn',paid,'fee_ngn',0,'deadline',least(b.payment_expires_at,coalesce((terms->>'deadline')::timestamptz,b.payment_expires_at)),
   'timezone',terms->>'timezone');
 end if;return review;
end $$;
revoke all on function private.shared_hotel_cancellation_preview(integer,text) from public,anon,authenticated;

create function private.cancel_shared_hotel_booking(p_booking_id integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();b public.hotel_bookings;preview jsonb;
begin
 if actor is null or not public._property_document_session_active() or not public.current_actor_has_personal_workspace() then
  raise exception 'Trusted active Personal account required' using errcode='42501';end if;
 -- Payment -> group -> booking matches receipt processing; never lock the booking before its payments.
 perform 1 from public.booking_payments where hotel_booking_id=p_booking_id and purpose='shared_housing_share' order by id for update;
 select * into b from public.hotel_bookings where booking_id=p_booking_id and user_id=actor;
 if b.shared_payment_group_id is null then raise exception 'Hotel organiser access required';end if;
 perform 1 from public.shared_housing_groups where canonical_group_id=b.shared_payment_group_id for update;
 select * into b from public.hotel_bookings where booking_id=p_booking_id and user_id=actor for update;
 if b.status in('cancelled','refunded','expired') then return true;end if;
 preview:=private.shared_hotel_cancellation_preview(b.booking_id,actor);
 if not coalesce((preview->>'can_cancel')::boolean,false) then raise exception '%',preview->>'message';end if;
 perform private.queue_shared_hotel_refunds(b.shared_payment_group_id,'organiser_cancelled');return true;
end $$;
revoke all on function private.cancel_shared_hotel_booking(integer) from public,anon,authenticated;

create function private.guard_shared_hotel_payment_snapshot() returns trigger
language plpgsql security definer set search_path='' as $$
declare key text;
begin
 if tg_op='UPDATE' and old.metadata->'hotel_share_snapshot' is not null then
  foreach key in array array['shared_group_id','shared_member_id','legacy_shared_member_id','canonical_shared_payment_group_id',
   'canonical_shared_payment_member_id','canonical_product_type','payment_phase','checkout_attempt','hotel_booking_id','eligible_partner_amount','refundable_amount','hotel_share_snapshot'] loop
   if new.metadata->key is distinct from old.metadata->key then raise exception 'Accepted Hotel share identity and terms are immutable';end if;
  end loop;
  if new.hotel_booking_id is distinct from old.hotel_booking_id or new.listing_id is distinct from old.listing_id then
   raise exception 'Accepted Hotel share booking is immutable';end if;
 end if;return new;
end $$;
revoke all on function private.guard_shared_hotel_payment_snapshot() from public,anon,authenticated;
create trigger shared_hotel_payment_snapshot before update on public.booking_payments for each row execute function private.guard_shared_hotel_payment_snapshot();

-- Route Hotel cases through the established public commands; Home behavior remains
-- in its existing implementation rather than a second copy of those engines.
do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.get_my_shared_housing_group(uuid)'::regprocedure);
 needle:=$n$begin
$n$;
 replacement:=$r$begin
 if exists(select 1 from public.shared_housing_groups where id=p_group_id and product_type='hotel') then
  return private.shared_hotel_group_receipt(p_group_id);end if;
$r$;
 if position(needle in definition)=0 then raise exception 'Inspect shared receipt entry';end if;execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.respond_to_shared_housing_invite(uuid,boolean)'::regprocedure);
 replacement:=$r$begin
 if exists(select 1 from public.shared_housing_groups where id=p_group_id and product_type='hotel') then
  return private.respond_shared_hotel_invite(p_group_id,p_accept);end if;
$r$;
 if position(needle in definition)=0 then raise exception 'Inspect shared invitation entry';end if;execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.create_my_shared_housing_payment(uuid)'::regprocedure);
 replacement:=$r$begin
 if exists(select 1 from public.shared_housing_groups where id=p_group_id and product_type='hotel') then
  return private.create_shared_hotel_payment(p_group_id);end if;
$r$;
 if position(needle in definition)=0 then raise exception 'Inspect shared payment entry';end if;execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.confirm_shared_housing_payment(text,text,numeric)'::regprocedure);
 replacement:=$r$begin
 if exists(select 1 from public.booking_payments where paystack_reference=p_reference and purpose='shared_housing_share' and metadata->>'canonical_product_type'='hotel') then
  return private.confirm_shared_hotel_payment(p_reference,p_transaction_id,p_verified_amount);end if;
$r$;
 if position(needle in definition)=0 then raise exception 'Inspect shared receipt confirmation entry';end if;execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.validate_shared_housing_checkout(uuid,text)'::regprocedure);
 needle:=$n$ begin
  checkout_group_id:=$n$;
 replacement:=$r$ if payment.metadata->>'canonical_product_type'='hotel' then
  return jsonb_build_object('valid',private.shared_hotel_payment_valid(payment,p_customer_user_id,true));end if;
 begin
  checkout_group_id:=$r$;
 if position(needle in definition)=0 then raise exception 'Inspect shared provider validation entry';end if;execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.validate_paid_accommodation_snapshot()'::regprocedure);
 needle:=$n$  select * into v_group from public.shared_payment_groups payment_group$n$;
 replacement:=$r$  if new.metadata->>'canonical_product_type'='hotel' then
    if not private.shared_hotel_payment_valid(new,v_payer,false) or v_total is distinct from new.amount_total then
      raise exception 'Hotel share does not match its accepted paid snapshot';end if;
    return new;
  end if;
  select * into v_group from public.shared_payment_groups payment_group$r$;
 if position(needle in definition)=0 then raise exception 'Inspect paid Hotel share boundary';end if;execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.process_verified_paystack_charge(text,text,text,text,timestamptz,bigint,text,text)'::regprocedure);
 needle:=$n$    elsif v_payment.purpose='shared_housing_share' and v_payment.metadata->>'canonical_product_type'='long_let'$n$;
 replacement:=$r$    elsif v_payment.purpose='shared_housing_share' and v_payment.metadata->>'canonical_product_type'='hotel' then
      perform private.create_shared_hotel_protection(v_payment.id);
    elsif v_payment.purpose='shared_housing_share' and v_payment.metadata->>'canonical_product_type'='long_let'$r$;
 if position(needle in definition)=0 then raise exception 'Inspect shared Hotel gateway allocation';end if;execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.create_hotel_booking_payment(integer)'::regprocedure);
 needle:=$n$  if v_booking.status='confirmed' and v_booking.payment_status='paid' then$n$;
 replacement:=$r$  if v_booking.shared_payment_group_id is not null then raise exception 'Pay only your assigned Hotel share from Bookings';end if;
  if v_booking.status='confirmed' and v_booking.payment_status='paid' then$r$;
 if position(needle in definition)=0 then raise exception 'Inspect single Hotel checkout exclusion';end if;execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.release_my_hotel_booking_hold(integer)'::regprocedure);
 needle:=$n$begin
$n$;
 replacement:=$r$begin
 if exists(select 1 from public.hotel_bookings where booking_id=p_booking_id and shared_payment_group_id is not null and user_id=public.current_profile_user_id()) then
  raise exception 'Review cancellation from the shared Hotel booking so every payer keeps their payment record';end if;
$r$;
 if position(needle in definition)=0 then raise exception 'Inspect unpaid Hotel release exclusion';end if;execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('private.hotel_cancellation_eligibility(integer,text)'::regprocedure);
 replacement:=$r$begin
 if exists(select 1 from public.hotel_bookings where booking_id=p_booking_id and shared_payment_group_id is not null) then
  return private.shared_hotel_cancellation_preview(p_booking_id,p_actor);end if;
$r$;
 if position(needle in definition)=0 then raise exception 'Inspect Hotel cancellation preview entry';end if;execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.cancel_my_hotel_booking(integer)'::regprocedure);
 replacement:=$r$begin
 if exists(select 1 from public.hotel_bookings where booking_id=p_booking_id and shared_payment_group_id is not null) then
  return private.cancel_shared_hotel_booking(p_booking_id);end if;
$r$;
 if position(needle in definition)=0 then raise exception 'Inspect Hotel cancellation entry';end if;execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.expire_shared_payment_checkout_from_service(uuid)'::regprocedure);
 needle:=$n$  if v_group.id is null or v_group.status not in('payment_pending','refunding')$n$;
 replacement:=$r$  if v_group.product_type='hotel' and (v_group.status='refunding' or v_group.status in('inviting','payment_pending') and v_group.expires_at<=now()) then
    return private.queue_shared_hotel_refunds(v_group.id,'checkout_expired');end if;
  if v_group.id is null or v_group.status not in('payment_pending','refunding')$r$;
 if position(needle in definition)=0 then raise exception 'Inspect shared Hotel expiry entry';end if;execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('public.sweep_expired_shared_payment_checkouts(integer)'::regprocedure);
 needle:=$n$where status in('payment_pending','refunding') and expires_at<=now()$n$;
 if position(needle in definition)=0 then raise exception 'Inspect shared Hotel expiry selection';end if;
 execute replace(definition,needle,$r$where (status in('payment_pending','refunding') or (product_type='hotel' and status='inviting')) and expires_at<=now()$r$);

 definition:=pg_get_functiondef('public.partner_transition_hotel_booking(integer,text)'::regprocedure);
 needle:=$n$if not public.hotel_payment_protection_is_current(v_booking.payment_protection_id) then$n$;
 if position(needle in definition)=0 then raise exception 'Inspect Hotel all-payer arrival proof';end if;
 execute replace(definition,needle,$r$if not (case when v_booking.shared_payment_group_id is not null then private.shared_hotel_protection_current(v_booking.booking_id)
      else public.hotel_payment_protection_is_current(v_booking.payment_protection_id) end) then$r$);
end $patch$;

create function private.shared_hotel_participant(p_booking_id integer,p_user_id text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hotel_bookings b join public.shared_payment_members m on m.shared_payment_group_id=b.shared_payment_group_id
  where b.booking_id=p_booking_id and m.user_id=p_user_id and m.invitation_state='accepted' and m.payment_state='paid')
$$;
revoke all on function private.shared_hotel_participant(integer,text) from public,anon,authenticated;

create function private.shared_hotel_arrival_protection(p_booking_id integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();b public.hotel_bookings;p public.payment_protection_transactions;case_id uuid;
begin
 if actor is null or not public._property_document_session_active() or not public.current_actor_has_personal_workspace()
  or not private.shared_hotel_participant(p_booking_id,actor) then raise exception 'Trusted paid guest access required' using errcode='42501';end if;
 select * into b from public.hotel_bookings where booking_id=p_booking_id;
 select pp.* into p from public.shared_payment_protection_components c
  join public.shared_payment_members m on m.shared_payment_member_id=c.shared_payment_member_id
  join public.payment_protection_transactions pp on pp.id=c.payment_protection_id
  where c.shared_payment_group_id=b.shared_payment_group_id and c.component_type='hotel_stay' and m.user_id=actor;
 select operational_case_id into case_id from public.operational_cases where subject_type='hotel' and subject_id=p_booking_id::text
  and reason_code='arrival_issue' and requester_user_id=actor and status not in('resolved','closed') order by created_at desc limit 1;
 return jsonb_build_object('subject_type','hotel','subject_id',p_booking_id::text,'protection_state',p.protection_state,'amount_total',p.amount_total,
  'checked_in_at',b.checked_in_at,'arrival_issue_window_hours',b.arrival_issue_window_hours,'arrival_issue_deadline_at',b.arrival_issue_deadline_at,
  'policy_version_id',b.arrival_issue_policy_version_id,'arrival_issue_case_id',case_id,
  'can_report_arrival_issue',b.checked_in_at is not null and b.arrival_issue_deadline_at is not null and b.arrival_issue_deadline_at>=now()
   and case_id is null and p.protection_state in('protected','release_eligible'));
end $$;
revoke all on function private.shared_hotel_arrival_protection(integer) from public,anon,authenticated;

create function private.report_shared_hotel_arrival_issue(p_booking_id integer,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();b public.hotel_bookings;item public.payment_protection_transactions;case_id uuid;info jsonb;
begin
 info:=private.shared_hotel_arrival_protection(p_booking_id);
 if not coalesce((info->>'can_report_arrival_issue')::boolean,false) then raise exception 'This shared Hotel stay is not eligible for a new arrival issue';end if;
 if nullif(btrim(p_reason),'') is null or length(p_reason)>6000 then raise exception 'Explain the arrival issue in up to 6000 characters';end if;
 select * into b from public.hotel_bookings where booking_id=p_booking_id;
 perform 1 from public.payment_protection_transactions p join public.shared_payment_protection_components c on c.payment_protection_id=p.id
  where c.shared_payment_group_id=b.shared_payment_group_id and c.component_type='hotel_stay' order by p.id for update of p;
 if exists(select 1 from public.shared_payment_protection_components c join public.payment_protection_transactions p on p.id=c.payment_protection_id
  where c.shared_payment_group_id=b.shared_payment_group_id and (p.protection_state not in('protected','release_eligible','disputed') or p.released_amount<>0)) then
  raise exception 'A Hotel payment already needs Finance review';end if;
 case_id:=public.open_contextual_case('arrival_issue','hotel',p_booking_id::text,btrim(p_reason));
 for item in select p.* from public.payment_protection_transactions p join public.shared_payment_protection_components c on c.payment_protection_id=p.id
  where c.shared_payment_group_id=b.shared_payment_group_id and c.component_type='hotel_stay' order by p.id loop
  if item.protection_state<>'disputed' then
   perform private.hold_shared_hotel_protection(item.id,'disputed','arrival_issue_reported','shared-hotel-arrival:'||case_id||':'||item.id,
    actor,btrim(p_reason),jsonb_build_object('operational_case_id',case_id,'hotel_booking_id',b.booking_id));
   update public.payment_protection_transactions set dispute_case_id=case_id,risk_held_at=now(),updated_at=now() where id=item.id;
  end if;
  update public.financial_action_outbox set status='manual_review',claimed_by=null,claimed_at=null,
   last_error='Frozen by timely shared Hotel arrival issue '||case_id,
   metadata=metadata||jsonb_build_object('arrival_issue_case_id',case_id),updated_at=now()
   where payment_protection_id=item.id and action_type='release_hotel_stay' and status in('pending','processing');
 end loop;return case_id;
end $$;
revoke all on function private.report_shared_hotel_arrival_issue(integer,text) from public,anon,authenticated;

create function private.guard_shared_hotel_group_terms() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.product_type='hotel' then
  if (to_jsonb(new)-array['status','updated_at']) is distinct from (to_jsonb(old)-array['status','updated_at']) then
   raise exception 'Accepted Hotel group terms cannot be changed';end if;
 end if;return new;
end $$;
revoke all on function private.guard_shared_hotel_group_terms() from public,anon,authenticated;
create trigger shared_hotel_canonical_terms before update on public.shared_payment_groups for each row execute function private.guard_shared_hotel_group_terms();
create trigger shared_hotel_compatibility_terms before update on public.shared_housing_groups for each row execute function private.guard_shared_hotel_group_terms();

-- The existing refund completion trigger owns member status. This additional
-- projection changes the Hotel only after every received component is refunded.
create function private.sync_shared_hotel_refund() returns trigger
language plpgsql security definer set search_path='' as $$
declare gid uuid;
begin
 if new.protection_state<>'refunded' or old.protection_state='refunded' then return new;end if;
 select c.shared_payment_group_id into gid from public.shared_payment_protection_components c
  join public.shared_payment_groups g on g.shared_payment_group_id=c.shared_payment_group_id
  where c.payment_protection_id=new.id and c.component_type='hotel_stay' and g.product_type='hotel';
 if gid is null then return new;end if;
 update public.booking_payments set status='refunded',updated_at=now() where paystack_reference=new.paystack_reference and purpose='shared_housing_share';
 if not exists(select 1 from public.shared_payment_protection_components c join public.payment_protection_transactions p on p.id=c.payment_protection_id
  where c.shared_payment_group_id=gid and p.protection_state<>'refunded') then
  update public.hotel_bookings set payment_status='refunded',updated_at=now() where shared_payment_group_id=gid and status in('cancelled','expired','payment_conflict');
 end if;return new;
end $$;
revoke all on function private.sync_shared_hotel_refund() from public,anon,authenticated;
create trigger sync_shared_hotel_refund after update of protection_state on public.payment_protection_transactions
 for each row execute function private.sync_shared_hotel_refund();

do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.actor_can_open_case_for_subject(text,text,text)'::regprocedure);
 needle:=$n$h.booking_id::text=p_subject_id and h.user_id=p_user_id$n$;
 replacement:=$r$h.booking_id::text=p_subject_id and (h.user_id=p_user_id or private.shared_hotel_participant(h.booking_id,p_user_id))$r$;
 if position(needle in definition)=0 then raise exception 'Inspect Hotel participant case authority';end if;execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.get_my_accommodation_protection(text,text)'::regprocedure);
 needle:=$n$begin
$n$;
 replacement:=$r$begin
 if p_subject_type='hotel' and exists(select 1 from public.hotel_bookings where booking_id::text=p_subject_id and shared_payment_group_id is not null) then
  return private.shared_hotel_arrival_protection(p_subject_id::integer);end if;
$r$;
 if position(needle in definition)=0 then raise exception 'Inspect Hotel shared protection receipt';end if;execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.report_my_accommodation_arrival_issue(text,text,text)'::regprocedure);
 replacement:=$r$begin
 if p_subject_type='hotel' and exists(select 1 from public.hotel_bookings where booking_id::text=p_subject_id and shared_payment_group_id is not null) then
  return private.report_shared_hotel_arrival_issue(p_subject_id::integer,p_reason);end if;
$r$;
 if position(needle in definition)=0 then raise exception 'Inspect Hotel shared arrival issue';end if;execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.get_my_stay_arrival_instructions(text,text)'::regprocedure);
 needle:=$n$and b.user_id=actor and b.payment_status='paid'$n$;
 if position(needle in definition)=0 then raise exception 'Inspect shared Hotel arrival instructions';end if;
 execute replace(definition,needle,$r$and (b.user_id=actor or private.shared_hotel_participant(b.booking_id,actor)) and b.payment_status='paid'$r$);

 definition:=pg_get_functiondef('public.enqueue_due_canonical_financial_actions(integer)'::regprocedure);
 needle:=$n$    select 'release_hotel_stay','hotel',h.booking_id::text,h.payment_protection_id$n$;
 replacement:=$r$    select 'release_hotel_stay','hotel',h.booking_id::text,p.id
    from public.hotel_bookings h join public.shared_payment_groups g on g.shared_payment_group_id=h.shared_payment_group_id
    join public.shared_payment_protection_components c on c.shared_payment_group_id=g.shared_payment_group_id and c.component_type='hotel_stay'
    join public.payment_protection_transactions p on p.id=c.payment_protection_id
    where g.product_type='hotel' and g.status='fully_paid' and h.payment_status='paid' and h.checked_in_at is not null
      and h.status in('checked_in','checked_out','completed') and p.protection_state in('protected','release_eligible')
      and not exists(select 1 from public.operational_cases issue where
        ((issue.subject_type='hotel' and issue.subject_id=h.booking_id::text) or (issue.subject_type='shared_payment' and issue.subject_id=g.shared_payment_group_id::text))
        and issue.status not in('resolved','closed'))
    union all
    select 'release_hotel_stay','hotel',h.booking_id::text,h.payment_protection_id$r$;
 if position(needle in definition)=0 then raise exception 'Inspect shared Hotel release selection';end if;execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.complete_internal_release_action(uuid)'::regprocedure);
 needle:=$n$  if v_protection.protection_state not in(
$n$;
 replacement:=$r$  if v_action.action_type='release_hotel_stay' and exists(select 1 from public.shared_payment_protection_components c
    join public.shared_payment_groups g on g.shared_payment_group_id=c.shared_payment_group_id where c.payment_protection_id=v_protection.id and g.product_type='hotel') then
    if v_protection.protection_state<>'release_eligible' or not exists(select 1 from public.hotel_bookings b
      join public.shared_payment_protection_components c on c.shared_payment_group_id=b.shared_payment_group_id
      where b.booking_id::text=v_action.subject_id and c.payment_protection_id=v_protection.id
      and b.payment_status='paid' and b.status in('checked_in','checked_out','completed','no_show')
      and (b.arrival_issue_deadline_at<=now() or b.status='no_show')
      and not exists(select 1 from public.operational_cases issue where issue.status not in('resolved','closed') and
       ((issue.subject_type='hotel' and issue.subject_id=b.booking_id::text) or (issue.subject_type='shared_payment' and issue.subject_id=b.shared_payment_group_id::text)))) then
      raise exception 'This shared Hotel payment is no longer eligible for release';end if;
  end if;
  if v_protection.protection_state not in(
$r$;
 if position(needle in definition)=0 then raise exception 'Inspect shared Hotel release revalidation';end if;execute replace(definition,needle,replacement);
end $patch$;

-- Old clients with a saved single-payer reference must also satisfy the frozen
-- checkout boundary before a new Paystack initialization can be requested.
create function public.validate_hotel_checkout(p_payment_id uuid,p_customer_user_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.booking_payments;b public.hotel_bookings;q jsonb;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service authority required' using errcode='42501';end if;
 select * into p from public.booking_payments where id=p_payment_id;
 select * into b from public.hotel_bookings where booking_id=p.hotel_booking_id;
 q:=p.metadata->'hotel_fee_snapshot';
 return jsonb_build_object('valid',coalesce(p.purpose='hotel_booking' and p.status='pending' and p.currency='NGN'
  and p.user_id=p_customer_user_id and coalesce(p.payer_user_id,p.user_id)=p_customer_user_id
  and b.user_id=p_customer_user_id and b.status='pending' and b.shared_payment_group_id is null and b.payment_status='payment_pending'
  and b.payment_reference=p.paystack_reference and b.payment_expires_at>now() and p.amount_total=b.total_price
  and p.amount=p.amount_total and p.commission_frozen_at is not null and p.commission_policy_version_id is not null
  and p.net_amount+p.amount_commission=p.amount_total and p.net_amount>=0 and p.amount_commission>=0
  and p.payee_user_id=(select owner_id from public.hotels where hotel_id=b.hotel_id)
  and (q->>'booking_id')::integer=b.booking_id and q->>'payee_user_id'=p.payee_user_id
  and (q->>'gross_amount')::numeric=p.amount_total and (q->>'commission_amount')::numeric=p.amount_commission
  and (q->>'partner_net_amount')::numeric=p.net_amount and (q->>'commission_percent')::numeric=p.commission_rate
  and (q->>'commission_policy_version_id')::uuid=p.commission_policy_version_id
  and public.user_has_active_workspace(p_customer_user_id,'personal'),false));
exception when invalid_text_representation then return jsonb_build_object('valid',false);
end $$;
revoke all on function public.validate_hotel_checkout(uuid,text) from public,anon,authenticated;
grant execute on function public.validate_hotel_checkout(uuid,text) to service_role;

commit;
