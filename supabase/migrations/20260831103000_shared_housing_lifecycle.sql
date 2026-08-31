-- A shared home is a separate lifecycle from an individual's optional rent plan.

alter table public.shared_housing_groups
  add column if not exists conversation_id uuid references public.conversations(id) on delete restrict,
  add column if not exists payment_phase text not null default 'reservation_fee'
    check (payment_phase in ('reservation_fee','contract_rent','complete')),
  add column if not exists reservation_fee_total numeric(12,2) not null default 0,
  add column if not exists contract_total numeric(12,2) not null default 0;

drop policy if exists shared_housing_members_member_read on public.shared_housing_members;
create policy shared_housing_members_member_read on public.shared_housing_members
  for select to authenticated using (
    exists (
      select 1 from public.shared_housing_members mine
      where mine.group_id = shared_housing_members.group_id
        and mine.user_id = (select auth.uid())::text
    )
  );

create or replace function public.create_my_shared_housing_group(
  p_listing_id uuid,
  p_conversation_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  actor text := (select auth.uid())::text;
  peer text;
  property public.listings;
  group_id uuid;
  fee numeric;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  select case when participant_a=actor then participant_b else participant_a end into peer
  from public.conversations
  where id=p_conversation_id and status='accepted' and actor in (participant_a,participant_b);
  if peer is null then raise exception 'Choose an accepted roommate conversation'; end if;

  select * into property from public.listings where id=p_listing_id for update;
  if property is null or property.deleted_at is not null or property.status <> 'available' or property.availability_status <> 'available' then
    raise exception 'This property is not available to share';
  end if;
  if coalesce(property.sub_type,'long_stay') <> 'long_stay' then
    raise exception 'Shared payment is available for long-stay homes only';
  end if;
  if exists (
    select 1 from public.shared_housing_groups g join public.shared_housing_members m on m.group_id=g.id
    where g.listing_id=p_listing_id and g.status not in ('cancelled','expired') and m.user_id in (actor,peer)
  ) then raise exception 'An active shared-home plan already exists for this property'; end if;

  select coalesce(nullif(value,'')::numeric,5000) into fee from public.platform_settings where key='reservation_fee';
  fee := coalesce(fee,5000);
  insert into public.shared_housing_groups(
    listing_id,created_by,status,member_limit,total_amount,conversation_id,payment_phase,
    reservation_fee_total,contract_total,expires_at
  ) values (
    p_listing_id,actor,'inviting',2,fee,p_conversation_id,'reservation_fee',fee,
    property.price + coalesce(property.security_deposit_amount,0),now()+interval '72 hours'
  ) returning id into group_id;
  insert into public.shared_housing_members(group_id,user_id,invitation_status,share_amount)
  values
    (group_id,actor,'accepted',round(fee/2,2)),
    (group_id,peer,'invited',fee-round(fee/2,2));
  return public.get_my_shared_housing_group(group_id);
end;
$$;

create or replace function public.get_my_shared_housing_group(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare actor text := (select auth.uid())::text; result jsonb;
begin
  if not exists(select 1 from public.shared_housing_members where group_id=p_group_id and user_id=actor) then
    raise exception 'Shared-home access required';
  end if;
  select jsonb_build_object(
    'id',g.id,'status',g.status,'payment_phase',g.payment_phase,'expires_at',g.expires_at,
    'total_amount',g.total_amount,'reservation_fee_total',g.reservation_fee_total,'contract_total',g.contract_total,
    'reservation_id',g.reservation_id,'listing',jsonb_build_object('id',l.id,'title',l.title,'price',l.price,'image',l.images[1], 'address',l.address,'city',l.city,'state',l.state),
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'user_id',m.user_id,'name',coalesce(p.full_name,p.username,'Roommate'),'invitation_status',m.invitation_status,
      'share_amount',m.share_amount,'payment_status',m.payment_status,'paid_at',m.paid_at
    ) order by m.created_at) from public.shared_housing_members m left join public.profiles p on p.user_id=m.user_id where m.group_id=g.id),'[]'::jsonb)
  ) into result
  from public.shared_housing_groups g join public.listings l on l.id=g.listing_id where g.id=p_group_id;
  return result;
end;
$$;

create or replace function public.get_my_shared_housing_groups()
returns jsonb language sql security definer set search_path=public
as $$
  select coalesce(jsonb_agg(public.get_my_shared_housing_group(m.group_id) order by m.created_at desc),'[]'::jsonb)
  from public.shared_housing_members m where m.user_id=(select auth.uid())::text;
$$;

create or replace function public.respond_to_shared_housing_invite(p_group_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare actor text := (select auth.uid())::text;
begin
  update public.shared_housing_members set invitation_status=case when p_accept then 'accepted' else 'declined' end,updated_at=now()
  where group_id=p_group_id and user_id=actor and invitation_status='invited';
  if not found then raise exception 'Pending shared-home invitation not found'; end if;
  update public.shared_housing_groups set status=case when p_accept then 'ready' else 'cancelled' end,updated_at=now() where id=p_group_id;
  return public.get_my_shared_housing_group(p_group_id);
end;
$$;

create or replace function public.create_my_shared_housing_payment(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare actor text := (select auth.uid())::text; member public.shared_housing_members; group_row public.shared_housing_groups; reference text;
begin
  select * into group_row from public.shared_housing_groups where id=p_group_id for update;
  select * into member from public.shared_housing_members where group_id=p_group_id and user_id=actor for update;
  if group_row is null or member is null then raise exception 'Shared-home access required'; end if;
  if group_row.status not in ('ready','payment_pending') or member.invitation_status <> 'accepted' then raise exception 'Both roommates must accept first'; end if;
  if group_row.expires_at <= now() then update public.shared_housing_groups set status='expired' where id=p_group_id; raise exception 'This shared-home hold has expired'; end if;
  if member.payment_status='paid' then return jsonb_build_object('already_paid',true); end if;
  reference := coalesce(member.payment_reference,'WH-SH-'||replace(gen_random_uuid()::text,'-',''));
  update public.shared_housing_members set payment_status='pending',payment_reference=reference,updated_at=now() where id=member.id;
  update public.shared_housing_groups set status='payment_pending',updated_at=now() where id=p_group_id;
  insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,type,booking_type,listing_id,amount,amount_total,currency,status,purpose,metadata,created_at,updated_at)
  values(reference,reference,actor,actor,'shared_housing','shared_housing',group_row.listing_id::text,member.share_amount,member.share_amount,'NGN','pending','shared_housing_share',jsonb_build_object('shared_group_id',p_group_id,'shared_member_id',member.id,'payment_phase',group_row.payment_phase),now(),now())
  on conflict (payment_reference) do nothing;
  return jsonb_build_object('reference',reference,'amount',member.share_amount,'payment_phase',group_row.payment_phase);
end;
$$;

create or replace function public.confirm_shared_housing_payment(p_reference text,p_transaction_id text,p_verified_amount numeric)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare payment public.booking_payments; member public.shared_housing_members; group_row public.shared_housing_groups; property public.listings; reservation_id text;
begin
  select * into payment from public.booking_payments where paystack_reference=p_reference and purpose='shared_housing_share' for update;
  if payment is null then raise exception 'Shared-home payment not found'; end if;
  if payment.status in ('paid','completed') then return jsonb_build_object('success',true,'already_processed',true); end if;
  if round(coalesce(payment.amount_total,payment.amount)*100)<>round(p_verified_amount*100) then raise exception 'Shared-home amount mismatch'; end if;
  select * into member from public.shared_housing_members where id=(payment.metadata->>'shared_member_id')::uuid for update;
  select * into group_row from public.shared_housing_groups where id=member.group_id for update;
  update public.booking_payments set status='paid',paystack_transaction_id=p_transaction_id,verified_amount=p_verified_amount,verified_at=now(),paid_at=now(),webhook_processed=true,verification_source='webhook',updated_at=now() where id=payment.id;
  update public.shared_housing_members set payment_status='paid',paid_at=now(),updated_at=now() where id=member.id;

  if not exists(select 1 from public.shared_housing_members where group_id=group_row.id and payment_status<>'paid') then
    if group_row.payment_phase='reservation_fee' then
      select * into property from public.listings where id=group_row.listing_id for update;
      reservation_id := gen_random_uuid()::text;
      insert into public.reservations(id,listing_id,user_id,listing_title,listing_price,listing_location,status,amount,currency,paid_at,reservation_type,hold_expires_at,annual_rent_snapshot,contract_rent_total,upfront_rent_required,rent_payment_status,booking_code,created_at,updated_at)
      values(reservation_id,property.id::text,group_row.created_by,property.title,property.price,concat_ws(', ',property.address,property.city,property.state),'reserved',group_row.reservation_fee_total,'NGN',now(),'shared_apartment',now()+interval '7 days',property.price,property.price,property.price+coalesce(property.security_deposit_amount,0),'not_started','WH-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),now(),now());
      update public.listings set status='reserved',availability_status='reserved',current_reservation_id=reservation_id,reserved_by=group_row.created_by,reservation_fee_paid=true,updated_at=now() where id=property.id;
      update public.shared_housing_groups set status='paid',reservation_id=reservation_id,updated_at=now() where id=group_row.id;
    else
      update public.shared_housing_groups set status='paid',payment_phase='complete',updated_at=now() where id=group_row.id;
      update public.reservations set rent_payment_status='paid',rent_paid_at=now(),updated_at=now() where id=group_row.reservation_id;
    end if;
  end if;
  return jsonb_build_object('success',true,'group_id',group_row.id);
end;
$$;

create or replace function public.start_my_shared_contract_split(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare actor text := (select auth.uid())::text; group_row public.shared_housing_groups;
begin
  select * into group_row from public.shared_housing_groups where id=p_group_id for update;
  if group_row.created_by<>actor then raise exception 'Only the group creator can start contract payment'; end if;
  if group_row.reservation_id is null or not exists(select 1 from public.reservations where id=group_row.reservation_id and inspection_result='passed') then raise exception 'Property inspection must pass first'; end if;
  update public.shared_housing_groups set status='ready',payment_phase='contract_rent',total_amount=contract_total,updated_at=now() where id=p_group_id;
  update public.shared_housing_members set share_amount=round(group_row.contract_total/2,2),payment_status='not_started',payment_reference=null,paid_at=null,updated_at=now() where group_id=p_group_id;
  update public.reservations set rent_payment_status='payment_pending',updated_at=now() where id=group_row.reservation_id;
  return public.get_my_shared_housing_group(p_group_id);
end;
$$;

revoke all on function public.create_my_shared_housing_group(uuid,uuid), public.get_my_shared_housing_group(uuid), public.get_my_shared_housing_groups(), public.respond_to_shared_housing_invite(uuid,boolean), public.create_my_shared_housing_payment(uuid), public.start_my_shared_contract_split(uuid) from public,anon;
grant execute on function public.create_my_shared_housing_group(uuid,uuid), public.get_my_shared_housing_group(uuid), public.get_my_shared_housing_groups(), public.respond_to_shared_housing_invite(uuid,boolean), public.create_my_shared_housing_payment(uuid), public.start_my_shared_contract_split(uuid) to authenticated;
revoke all on function public.confirm_shared_housing_payment(text,text,numeric) from public,anon,authenticated;
grant execute on function public.confirm_shared_housing_payment(text,text,numeric) to service_role;
