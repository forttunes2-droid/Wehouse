-- Preserve the existing assignment/booking visibility, adding bounded keyset history and exact targets.
create index if not exists reservations_listing_history_idx on public.reservations(listing_id,created_at desc,id desc);
drop function public.get_my_property_partner_stays(text);
CREATE OR REPLACE FUNCTION public.get_my_property_partner_stays(p_listing_id text DEFAULT NULL::text, p_before_created_at timestamptz DEFAULT NULL, p_before_id text DEFAULT NULL, p_limit integer DEFAULT 51, p_reservation_id text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_limit is null or p_limit<1 or p_limit>51 then raise exception 'Page size must be between 1 and 51';end if;
  if (p_before_created_at is null)<>(p_before_id is null) then raise exception 'Complete reservation cursor required';end if;
  if p_reservation_id is not null and (length(btrim(p_reservation_id)) not between 1 and 128 or p_before_id is not null) then raise exception 'Invalid reservation target';end if;
  if p_listing_id is not null and length(btrim(p_listing_id)) not between 1 and 128 then raise exception 'Invalid property target';end if;
  select coalesce(jsonb_agg(to_jsonb(stay) order by stay.created_at desc,stay.reservation_id desc),'[]'::jsonb)
  into v_result from (
    select r.id reservation_id,coalesce(r.stay_type,'long_stay') stay_type,r.status,
      r.rent_payment_status payment_status,r.manual_payment_status,
      r.reservation_fee_status,r.reservation_fee_snapshot,r.reservation_fee_paid_at,
      r.rent_paid_at,r.stay_check_in check_in,r.stay_check_out check_out,r.stay_nights nights,
      coalesce(r.guest_count,1) guest_count,r.requested_move_in_at,r.move_in_requested_at,
      r.tenancy_start_date,r.tenancy_end_date,r.created_at,
      r.management_mode_snapshot,r.responsible_host_user_id,
      l.id::text listing_id,l.listing_id public_listing_code,l.title listing_title,
      a.assignment_role,
      case when a.assignment_role='owner' then 'full_hosting' else a.access_level end access_level
    from public.reservations r
    join public.listings l on l.id::text=r.listing_id
    join public.property_host_assignments a
      on a.listing_id=l.id and a.user_id=v_actor and a.status='active'
    where (p_listing_id is null or l.id::text=p_listing_id or l.listing_id=p_listing_id)
      and(p_reservation_id is null or r.id=p_reservation_id)
      and(p_before_created_at is null or (r.created_at,r.id)<(p_before_created_at,p_before_id))
      and public.current_actor_can_manage_property(l.id)
      and (
        (r.management_mode_snapshot='host'
          and (a.assignment_role='owner' or r.responsible_host_user_id=v_actor)
          and (r.reservation_fee_status='paid' or r.manual_payment_status in ('paid','completed')))
        or (r.management_mode_snapshot='wehouse' and a.assignment_role='owner'
          and ((coalesce(r.stay_type,'long_stay')='short_let'
            and ((r.rent_payment_status='paid' and r.rent_paid_at is not null)
              or r.status in ('occupied','completed')))
          or (coalesce(r.stay_type,'long_stay')<>'short_let'
            and ((r.rent_payment_status in ('paid','upfront_paid') and r.rent_paid_at is not null)
              or r.status in ('occupied','completed')))))
      )
    order by r.created_at desc,r.id desc limit case when p_reservation_id is null then p_limit else 1 end
  ) stay;
  return v_result;
end
$function$;
revoke all on function public.get_my_property_partner_stays(text,timestamptz,text,integer,text) from public,anon,service_role;
grant execute on function public.get_my_property_partner_stays(text,timestamptz,text,integer,text) to authenticated;

