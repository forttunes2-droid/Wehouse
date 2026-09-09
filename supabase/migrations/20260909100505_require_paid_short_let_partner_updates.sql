-- A Short Let becomes visible to the Property Partner only after the full
-- stay amount is confirmed, not after the preliminary reservation fee.

create or replace function public.get_my_property_partner_stays(p_listing_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare v_actor public.profiles; v_result jsonb;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role='property_partner'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;

  select coalesce(jsonb_agg(to_jsonb(stay) order by stay.created_at desc),'[]'::jsonb)
  into v_result
  from (
    select
      r.id as reservation_id,
      r.booking_code,
      coalesce(r.stay_type,'long_stay') as stay_type,
      r.status,
      r.rent_payment_status as payment_status,
      r.stay_check_in as check_in,
      r.stay_check_out as check_out,
      r.stay_nights as nights,
      coalesce(r.guest_count,1) as guest_count,
      r.tenancy_start_date,
      r.tenancy_end_date,
      r.created_at,
      l.id::text as listing_id,
      l.listing_id as public_listing_code,
      l.title as listing_title
    from public.reservations r
    join public.listings l on l.id::text=r.listing_id
    where (l.owner_id=v_actor.user_id or l.partner_id=v_actor.user_id)
      and (p_listing_id is null or l.id::text=p_listing_id or l.listing_id=p_listing_id)
      and (
        (
          coalesce(r.stay_type,'long_stay')='short_let'
          and (
            (r.rent_payment_status='paid' and r.rent_paid_at is not null)
            or r.status in ('occupied','completed')
          )
        )
        or (
          coalesce(r.stay_type,'long_stay')<>'short_let'
          and (
            r.rent_payment_status in ('paid','upfront_paid')
            or r.status in ('ready_for_move_in','occupied','completed')
          )
        )
      )
    order by r.created_at desc
    limit 50
  ) stay;
  return v_result;
end;
$function$;

revoke all on function public.get_my_property_partner_stays(text) from public,anon;
grant execute on function public.get_my_property_partner_stays(text) to authenticated,service_role;

create or replace function public.notify_property_partner_reservation_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  v_listing public.listings;
  v_partner_id text;
  v_stage text;
  v_title text;
  v_message text;
  v_short_let boolean:=coalesce(new.stay_type,'long_stay')='short_let';
begin
  select * into v_listing
  from public.listings
  where id::text=new.listing_id or listing_id=new.listing_id
  limit 1;
  if v_listing is null then return new; end if;
  v_partner_id:=coalesce(v_listing.partner_id,v_listing.owner_id);
  if v_partner_id is null then return new; end if;

  if v_short_let then
    if new.status='completed' and (tg_op='INSERT' or old.status is distinct from new.status) then
      v_stage:='checkout';
      v_title:='Guest checked out';
      v_message:=format(
        'The guest left %s on %s. WeHouse is handling the final stay and deposit checks.',
        v_listing.title,
        to_char(new.stay_check_out,'DD Mon YYYY')
      );
    elsif new.status='occupied' and (tg_op='INSERT' or old.status is distinct from new.status) then
      v_stage:='checkin';
      v_title:='Guest checked in';
      v_message:=format(
        'A guest entered %s on %s for the booked stay.',
        v_listing.title,
        to_char(new.stay_check_in,'DD Mon YYYY')
      );
    elsif new.rent_payment_status='paid'
      and new.rent_paid_at is not null
      and (
        tg_op='INSERT'
        or old.rent_payment_status is distinct from new.rent_payment_status
        or old.rent_paid_at is distinct from new.rent_paid_at
      )
    then
      v_stage:='reserved';
      v_title:='Short Let booked';
      v_message:=format(
        '%s is booked from %s to %s. WeHouse is handling the guest arrival.',
        v_listing.title,
        to_char(new.stay_check_in,'DD Mon YYYY'),
        to_char(new.stay_check_out,'DD Mon YYYY')
      );
    else
      return new;
    end if;
  else
    if new.status='ready_for_move_in'
      and new.rent_payment_status in ('paid','upfront_paid')
      and (
        tg_op='INSERT'
        or old.status is distinct from new.status
        or old.rent_payment_status is distinct from new.rent_payment_status
      )
    then
      v_stage:='arrival_ready';
      v_title:='Tenant ready for move-in';
      v_message:=format(
        'WeHouse found a tenant and confirmed the rent. %s is ready for move-in, and WeHouse will handle the handover.',
        v_listing.title
      );
    elsif new.rent_payment_status in ('paid','upfront_paid')
      and (
        tg_op='INSERT'
        or old.rent_payment_status is distinct from new.rent_payment_status
        or old.rent_paid_at is distinct from new.rent_paid_at
      )
    then
      v_stage:='reserved';
      v_title:='WeHouse found a tenant';
      v_message:=format(
        'WeHouse found a tenant for %s and confirmed the rent. WeHouse is preparing the home for move-in.',
        v_listing.title
      );
    else
      return new;
    end if;
  end if;

  insert into public.notifications(
    recipient_id,type,title,message,related_id,source_type,source_id,destination_route,
    destination_params,event_key,workspace_scope,read,created_at
  ) values (
    v_partner_id,'property_booking',v_title,v_message,v_listing.id::text,'property_booking',new.id,
    'property_detail',jsonb_build_object('listing_id',v_listing.id::text,'reservation_id',new.id),
    'property_partner_stay:'||new.id||':'||v_stage,'property_partner',false,now()
  ) on conflict (recipient_id,event_key) where event_key is not null do nothing;
  return new;
end;
$function$;

revoke all on function public.notify_property_partner_reservation_lifecycle() from public,anon,authenticated;
