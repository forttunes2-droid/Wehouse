begin;

create function private.shared_home_arrival(p_reservation_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $function$
declare actor text:=public.current_profile_user_id();r public.reservations;decision jsonb;l public.listings;
begin
 if actor is null or not public._property_document_session_active() or not public.current_actor_has_personal_workspace() then return null;end if;
 select * into r from public.reservations where id=p_reservation_id and shared_payment_group_id is not null
  and status in('ready_for_move_in','occupied','completed');
 if r.id is null or not exists(select 1 from public.shared_payment_members m
  where m.shared_payment_group_id=r.shared_payment_group_id and m.user_id=actor
   and m.invitation_state='accepted' and m.payment_state='paid') then return null;end if;
 decision:=public.accommodation_access_authorization(r.id,r.listing_id,r.user_id,r.stay_type,r.status,
  r.manual_payment_status,r.paid_at,r.rent_payment_status,r.rent_paid_at,r.rent_payment_reference,
  r.stay_payment_protection_id,r.year_one_rent_protection_id,r.shared_payment_group_id,
  case when r.stay_type='short_let' then r.stay_rent_total else r.upfront_rent_required end,'location');
 if coalesce((decision->>'authorized')::boolean,false) is distinct from true then return null;end if;
 select * into l from public.listings where id::text=r.listing_id;
 return jsonb_build_object('reservation_id',r.id,'booking_code',r.booking_code,'status',r.status,
  'requested_move_in_at',r.requested_move_in_at,'tenancy_start_date',r.tenancy_start_date,'tenancy_end_date',r.tenancy_end_date,
  'address',nullif(btrim(concat_ws(', ',l.address,l.city,l.state)),''));
end; $function$;
revoke all on function private.shared_home_arrival(text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_my_shared_housing_group(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null or not public.current_actor_has_personal_workspace() or not exists(select 1 from public.shared_housing_members
    where group_id=p_group_id and user_id=v_actor) then
    raise exception 'Shared-payment access required'; end if;
  select jsonb_build_object(
    'id',g.id,'created_at',g.created_at,'created_by',g.created_by,'conversation_id',g.conversation_id,
    'listing_id',g.listing_id,'status',g.status,'product_type',g.product_type,
    'payment_phase',g.payment_phase,'expires_at',g.expires_at,'checkout_attempt',g.checkout_attempt,'canonical_group_id',g.canonical_group_id,
    'rent_agreement',(select member.rent_agreement_snapshot from public.shared_payment_members member where member.shared_payment_group_id=g.canonical_group_id and member.user_id=v_actor),
    'tenancy_agreement',(select reservation.rent_terms_snapshot from public.reservations reservation where reservation.id=g.reservation_id),
    'total_amount',g.total_amount,'reservation_fee_total',g.reservation_fee_total,
    'contract_total',g.contract_total,'reservation_id',g.reservation_id,
    'booking_status',(select r.status from public.reservations r where r.id=g.reservation_id),
    'arrival',private.shared_home_arrival(g.reservation_id),
    'capacity',case when g.product_type='short_let' then l.max_guests else l.max_occupants end,
    'guest_count',g.guest_count,'stay_check_in',g.stay_check_in,'stay_check_out',g.stay_check_out,
    'listing',jsonb_build_object(
      'id',l.id,'title',l.title,'price',l.price,'image',l.images[1],
      'address',case when private.shared_home_arrival(g.reservation_id) is not null then l.address else null end,'city',l.city,'state',l.state,
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
$function$;
CREATE OR REPLACE FUNCTION public.get_my_stay_arrival_instructions(p_kind text, p_booking_id text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare actor text:=public.current_profile_user_id(); asset text; r public.reservations; decision jsonb;
begin
 if actor is null or not public._property_document_session_active() then return null; end if;
 if p_kind='home' then
  select * into r from public.reservations where id=p_booking_id and (user_id=actor or private.shared_home_arrival(id) is not null);
  if r.id is null or r.status not in ('ready_for_move_in','occupied','completed') then return null; end if;
  decision:=public.accommodation_access_authorization(
    r.id,r.listing_id,r.user_id,r.stay_type,r.status,r.manual_payment_status,r.paid_at,
    r.rent_payment_status,r.rent_paid_at,r.rent_payment_reference,r.stay_payment_protection_id,
    r.year_one_rent_protection_id,r.shared_payment_group_id,
    case when r.stay_type='short_let' then r.stay_rent_total else coalesce(r.upfront_rent_required,r.annual_rent_snapshot) end,'location');
  if not coalesce((decision->>'authorized')::boolean,false) then return null; end if;
  select id::text into asset from public.listings where id::text=r.listing_id or listing_id=r.listing_id limit 1;
 elsif p_kind='hotel' then
  select b.hotel_id::text into asset from public.hotel_bookings b where b.booking_id::text=p_booking_id
    and b.user_id=actor and b.payment_status='paid' and b.status not in ('cancelled','expired','refunded','payment_conflict');
 else return null;
 end if;
 return (select instructions from public.property_arrival_instructions where asset_kind=p_kind and asset_id=asset);
end $function$;
commit;
