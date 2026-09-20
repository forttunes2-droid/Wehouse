begin;
-- The invoker v2 RPC needs this dependency, which default-grant lockdown revoked.
-- Grant only after replacing legacy role authority with active scoped assignments.
CREATE OR REPLACE FUNCTION public.get_my_property_pipeline(p_stage text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_result jsonb;
begin
  select * into v_actor from public.profiles
  where auth_id = auth.uid()::text
    and not coalesce(deleted, false)
    and not coalesce(suspended, false)
    and not coalesce(banned, false)
  limit 1;
  if v_actor is null or not (
    public.current_actor_has_workspace('creator')
    or public.current_actor_has_workspace('admin')
    or (public.current_actor_has_workspace('staff') and public.current_actor_has_workspace('property_operations'))
  ) then
    raise exception 'WeHouse operations access required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',ir.id,'request_code',ir.request_code,'owner_id',ir.owner_id,
    'owner_name',coalesce(owner.full_name,owner.username,owner.email),'owner_email',ir.owner_email,'owner_phone',ir.owner_phone,
    'property_address',ir.property_address,'property_city',ir.property_city,'property_state',ir.property_state,
    'property_type',ir.property_type,'sub_type',ir.sub_type,'bedrooms',ir.bedrooms,'bathrooms',ir.bathrooms,
    'expected_rent',ir.expected_rent,'security_deposit_amount',ir.security_deposit_amount,'amenities',ir.amenities,
    'description',ir.description,'status',ir.status,'scheduled_date',ir.scheduled_date,
    'assigned_field_officer_id',coalesce(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to),
    'field_officer_name',coalesce(officer.full_name,officer.username,officer.email),'notes',ir.notes,
    'photo_urls',ir.photo_urls,'video_urls',ir.video_urls,'document_urls',ir.document_urls,
    'draft_listing_id',ir.draft_listing_id,'draft_hotel_id',ir.draft_hotel_id,
    'approved_by',ir.approved_by,'approved_at',ir.approved_at,'published_at',ir.published_at,
    'listing',case when l.id is null then null else jsonb_build_object(
      'id',l.id,'listing_id',l.listing_id,'title',l.title,'price',l.price,'status',l.status,
      'availability_status',l.availability_status,'sub_type',l.sub_type,
      'security_deposit_amount',l.security_deposit_amount,'amenities',l.amenities,
      'images',l.images,'videos',l.videos,'created_at',l.created_at
    ) end,
    'hotel',case when h.hotel_id is null then null else jsonb_build_object(
      'hotel_id',h.hotel_id,'name',h.name,'status',h.status,'images',h.images,'created_at',h.created_at
    ) end,
    'created_at',ir.created_at
  ) order by ir.created_at desc),'[]'::jsonb) into v_result
  from public.inspection_requests ir
  left join public.profiles owner on owner.user_id = ir.owner_id
  left join public.profiles officer
    on officer.user_id = coalesce(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to)
  left join public.listings l on l.id = ir.draft_listing_id and l.deleted_at is null
  left join public.hotels h on h.hotel_id = ir.draft_hotel_id
  where public.current_actor_in_scope(ir.property_state,ir.property_city)
  and (p_stage = 'all'
    or (p_stage = 'new' and ir.status = 'pending'
        and coalesce(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to) is null)
    or (p_stage = 'inspection' and ir.status in ('pending','scheduled','in_progress')
        and coalesce(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to) is not null)
    or (p_stage = 'ready' and ir.status in ('completed','approved')
        and ir.draft_listing_id is null and ir.draft_hotel_id is null)
    or (p_stage = 'preparing' and (ir.draft_listing_id is not null or ir.draft_hotel_id is not null)
        and ir.published_at is null)
    or (p_stage = 'published' and ir.published_at is not null)
    or (p_stage = 'rejected' and ir.status = 'rejected'));
  return v_result;
end;
$function$;

revoke all on function public.get_my_property_pipeline(text) from public,anon;
grant execute on function public.get_my_property_pipeline(text) to authenticated,service_role;

-- Receipts are private payer records. The owner check is explicit and independent
-- of operational roles; even Creator cannot retrieve another payer's receipt here.
create or replace function public.get_my_payment_receipts(
  p_reference text default null, p_subject_type text default null, p_subject_id text default null
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare v_user text; v_result jsonb;
begin
  select user_id into v_user from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false);
  if v_user is null then raise exception 'Active account required'; end if;
  select coalesce(jsonb_agg(receipt order by paid_at desc),'[]'::jsonb) into v_result
  from (
    select coalesce(bp.paid_at,bp.verified_at) paid_at,
      jsonb_build_object(
        'id',bp.id,'reference',coalesce(bp.paystack_reference,bp.payment_reference),
        'purpose',bp.purpose,'amount',bp.verified_amount,'currency',bp.currency,
        'paid_at',coalesce(bp.paid_at,bp.verified_at),'status',bp.status,
        'refund_processed_at',bp.refund_processed_at,
        'environment',case when bp.metadata->>'paystack_domain' in ('test','live') then bp.metadata->>'paystack_domain' else null end,
        'payer_name',coalesce(nullif(hb.guest_name,''),nullif(p.full_name,''),p.username,'WeHouse customer'),
        'merchant_name',coalesce(h.name,r.listing_title,nullif(worker.full_name,''),worker.username,'WeHouse'),
        'description',case when bp.purpose='hotel_booking' then coalesce(hr.room_type,'Hotel stay')
          when bp.purpose='worker_booking' then coalesce(wb.service_type,'Service booking')
          when r.stay_type='short_let' then 'Short Let stay'
          when bp.purpose='apartment_reservation' then 'Apartment reservation fee'
          when bp.purpose='apartment_rent' then 'Apartment rent'
          when bp.purpose='worker_pro_subscription' then 'Worker Pro subscription'
          when bp.purpose='shared_housing_share' then 'Shared home contribution'
          else 'WeHouse payment' end,
        'package_name',hb.rate_plan_name,
        'booking_id',coalesce(hb.booking_id::text,wb.id::text,r.id),
        'booking_type',case when hb.booking_id is not null then 'hotel' when wb.id is not null then 'service' when r.id is not null then 'housing' else null end,
        'check_in',coalesce(hb.check_in,r.stay_check_in),'check_out',coalesce(hb.check_out,r.stay_check_out),
        'nights',coalesce(hb.total_nights,r.stay_nights),'guests',coalesce(hb.guest_count,r.guest_count),
        'stay_amount',case when r.stay_type='short_let' then r.stay_rent_total else null end,
        'deposit_amount',case when r.stay_type='short_let' then r.security_deposit_snapshot else null end
      ) receipt
    from public.booking_payments bp
    join public.profiles p on p.user_id=v_user
    left join public.hotel_bookings hb on hb.booking_id=bp.hotel_booking_id
    left join public.hotels h on h.hotel_id=hb.hotel_id
    left join public.hotel_rooms hr on hr.room_id=hb.room_id
    left join public.worker_bookings wb on wb.id=bp.worker_booking_id
    left join public.profiles worker on worker.user_id=wb.worker_id
    left join public.reservations r on r.id=bp.metadata->>'reservation_id'
    where coalesce(bp.payer_user_id,bp.user_id)=v_user
      and bp.status in ('paid','completed','refunded','partially_refunded')
      and bp.verified_at is not null and bp.paystack_transaction_id is not null
      and bp.verified_amount is not null
      and (p_reference is null or p_reference=coalesce(bp.paystack_reference,bp.payment_reference))
      and (p_subject_type is null
        or (p_subject_type='hotel' and hb.booking_id::text=p_subject_id)
        or (p_subject_type='service' and wb.id::text=p_subject_id)
        or (p_subject_type='housing' and r.id=p_subject_id))
    order by coalesce(bp.paid_at,bp.verified_at) desc
    limit 100
  ) receipts;
  return v_result;
end;
$$;
revoke all on function public.get_my_payment_receipts(text,text,text) from public,anon;
grant execute on function public.get_my_payment_receipts(text,text,text) to authenticated,service_role;
commit;
