-- Carry reviewed scope through public reads and maintenance blocks; preserve existing authorities.
CREATE OR REPLACE FUNCTION public.get_discoverable_listings()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',l.id,
      'listing_id',l.listing_id,
      'title',l.title,
      'description',l.description,
      'price',l.price,
      'currency',l.currency,
      'state',l.state,
      'city',l.city,
      'address',l.address,
      'images',coalesce(l.images,array[]::text[]),
      'videos',coalesce(l.videos,array[]::text[]),
      'bedrooms',l.bedrooms,
      'bathrooms',l.bathrooms,
      'availability_status',l.availability_status,
      'status',l.status,
      'property_type',l.property_type,
      'sub_type',l.sub_type,
      'space_scope',l.space_scope,'space_label',l.space_label,'shared_areas',l.shared_areas,
      'security_deposit_amount',l.security_deposit_amount,
      'max_guests',l.max_guests,
      'pets_allowed',l.pets_allowed,
      'max_occupants',l.max_occupants,
      'future_installments_allowed',l.future_installments_allowed,
      'minimum_stay_nights',l.minimum_stay_nights,
      'maximum_stay_nights',l.maximum_stay_nights,
      'non_refundable_rate_enabled',l.non_refundable_rate_enabled,
      'non_refundable_discount_percent',l.non_refundable_discount_percent,
      'rating',l.rating,
      'review_count',l.review_count,
      'amenities',coalesce(l.amenities,array[]::text[]),
      'created_at',l.created_at,
      'updated_at',l.updated_at,
      'gps_latitude',null,
      'gps_longitude',null,
      'location_accuracy_m',null,
      'location_exact',false,
      'partner_display_name',coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''))
    ) order by l.created_at desc
  ),'[]'::jsonb)
  from public.listings l
  left join public.profiles p on p.user_id=coalesce(l.partner_id,l.owner_id)
  where l.deleted_at is null
    and l.inspection_request_id is not null
    and l.approved_at is not null
    and l.status='available'
    and l.availability_status='available'
$function$;
CREATE OR REPLACE FUNCTION public.get_public_listing_detail(p_listing_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_listing public.listings;
  v_actor public.profiles;
  v_partner_name text;
  v_internal boolean:=false;
  v_platform_min integer:=1;
  v_platform_max integer:=90;
  v_cancellation jsonb:='{}'::jsonb;
begin
  select * into v_listing
  from public.listings l
  where (l.id::text=p_listing_id or l.listing_id=p_listing_id)
    and l.deleted_at is null
  limit 1;
  if v_listing.id is null then return null; end if;

  select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''))
  into v_partner_name
  from public.profiles p
  where p.user_id=coalesce(v_listing.partner_id,v_listing.owner_id);

  select * into v_actor
  from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  if v_actor.user_id is not null then
    v_internal:=public.current_actor_can_manage_property(v_listing.id)
      or public.current_actor_has_workspace('creator',null)
      or (
        public.current_actor_has_workspace('admin',v_listing.state)
        and public.current_actor_in_scope(v_listing.state,v_listing.city)
      )
      or (
        public.current_staff_has_permission('operations')
        and public.current_actor_in_scope(v_listing.state,v_listing.city)
      );
  end if;

  if not v_internal and not (
    v_listing.status='available'
    and v_listing.availability_status='available'
    and v_listing.inspection_request_id is not null
    and v_listing.approved_at is not null
  ) then return null; end if;

  if v_listing.sub_type='short_let' then
    select coalesce(nullif(value,'')::integer,1) into v_platform_min
    from public.platform_settings
    where key='short_stay_min_nights' and coalesce(is_active,true) limit 1;
    select coalesce(nullif(value,'')::integer,90) into v_platform_max
    from public.platform_settings
    where key='short_stay_max_nights' and coalesce(is_active,true) limit 1;
    select p.value into v_cancellation
    from public.creator_policy_versions p
    where p.policy_key='short_let_cancellation'
      and p.scope_type='global' and p.scope_key='*' and p.status='active'
      and p.effective_from<=now()
      and (p.effective_until is null or p.effective_until>now())
    order by p.effective_from desc,p.version desc limit 1;
    v_platform_min:=greatest(coalesce(v_platform_min,1),1);
    v_platform_max:=greatest(coalesce(v_platform_max,90),v_platform_min);
  end if;

  if v_internal then
    return to_jsonb(v_listing)||jsonb_build_object(
      'location_exact',true,
      'partner_display_name',v_partner_name,
      'minimum_stay_nights',case when v_listing.sub_type='short_let' then
        greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min) else null end,
      'maximum_stay_nights',case when v_listing.sub_type='short_let' then
        greatest(
          least(coalesce(v_listing.maximum_stay_nights,v_platform_max),v_platform_max),
          greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min)
        ) else null end,
      'standard_cancellation',v_cancellation
    );
  end if;

  return jsonb_build_object(
    'id',v_listing.id,
    'listing_id',v_listing.listing_id,
    'title',v_listing.title,
    'description',v_listing.description,
    'price',v_listing.price,
    'currency',v_listing.currency,
    'state',v_listing.state,
    'city',v_listing.city,
    'address',v_listing.address,
    'images',coalesce(v_listing.images,array[]::text[]),
    'videos',coalesce(v_listing.videos,array[]::text[]),
    'bedrooms',v_listing.bedrooms,
    'bathrooms',v_listing.bathrooms,
    'availability_status',v_listing.availability_status,
    'status',v_listing.status,
    'property_type',v_listing.property_type,
    'sub_type',v_listing.sub_type,
      'space_scope',v_listing.space_scope,'space_label',v_listing.space_label,'shared_areas',v_listing.shared_areas,
    'security_deposit_amount',v_listing.security_deposit_amount,
    'max_guests',v_listing.max_guests,
    'pets_allowed',v_listing.pets_allowed,
    'max_occupants',v_listing.max_occupants,
    'future_installments_allowed',v_listing.future_installments_allowed,
    'minimum_stay_nights',case when v_listing.sub_type='short_let' then
      greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min) else null end,
    'maximum_stay_nights',case when v_listing.sub_type='short_let' then
      greatest(
        least(coalesce(v_listing.maximum_stay_nights,v_platform_max),v_platform_max),
        greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min)
      ) else null end,
    'non_refundable_rate_enabled',v_listing.non_refundable_rate_enabled,
    'non_refundable_discount_percent',v_listing.non_refundable_discount_percent,
    'standard_cancellation',v_cancellation,
    'rating',v_listing.rating,
    'review_count',v_listing.review_count,
    'amenities',coalesce(v_listing.amenities,array[]::text[]),
    'created_at',v_listing.created_at,
    'updated_at',v_listing.updated_at,
    'gps_latitude',null,
    'gps_longitude',null,
    'location_accuracy_m',null,
    'location_exact',false,
    'partner_display_name',v_partner_name
  );
end
$function$;
create or replace function private.guard_physical_space_occupancy()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid; unit uuid; active_new boolean; active_old boolean:=false;
begin
 select l.physical_space_id into target from public.listings l where l.id::text=new.listing_id or l.listing_id=new.listing_id limit 1;
 if tg_op='UPDATE' and old.physical_space_id is not null and old.physical_space_id is distinct from target then raise exception 'Booked physical space cannot change'; end if;
 if target is null then new.physical_space_id:=null;new.physical_unit_id:=null;return new;end if;
 select root_unit_id into unit from public.property_spaces where id=target and kind<>'site';
 if unit is null then raise exception 'Bookable physical unit is unavailable'; end if;
 new.physical_space_id:=target;new.physical_unit_id:=unit;
 active_new:=new.status in('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied');
 if tg_op='UPDATE' then active_old:=old.status in('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied');end if;
 if not active_new and not active_old then return new;end if;
 -- An actual row version change serializes sibling offers even at stronger isolation levels.
 update public.property_spaces set availability_revision=availability_revision+1 where id=unit;
 if not active_new then return new;end if;
 if new.stay_type='short_let' and(new.stay_check_in is null or new.stay_check_out is null or new.stay_check_out<=new.stay_check_in) then raise exception 'Choose valid stay dates';end if;
 if exists(select 1 from public.property_host_date_blocks b
 join public.listings l on l.id=b.listing_id
 join public.property_spaces s on s.id=l.physical_space_id
 where s.root_unit_id=unit and b.reopened_at is null
 and private.property_spaces_overlap(unit,target,s.id,new.stay_type,'short_let',new.stay_check_in,new.stay_check_out,b.start_date,b.reopen_date))
 then raise exception 'This physical space is closed for those dates';end if;
 if exists(
  select 1 from public.reservations r
  where r.physical_unit_id=unit and r.id is distinct from new.id
  and r.status in('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
  and private.property_spaces_overlap(unit,target,r.physical_space_id,new.stay_type,r.stay_type,new.stay_check_in,new.stay_check_out,r.stay_check_in,r.stay_check_out)
 )then raise exception 'This physical space is already held or occupied for those dates';end if;
 return new;
end; $$;

create function private.guard_physical_host_block()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid; unit uuid;
begin
 select physical_space_id into target from public.listings where id=new.listing_id;
 if target is null then return new;end if;
 select root_unit_id into unit from public.property_spaces where id=target;
 update public.property_spaces set availability_revision=availability_revision+1 where id=unit;
 if new.reopened_at is not null then return new;end if;
 if exists(select 1 from public.reservations r where r.physical_unit_id=unit
 and r.status in('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
 and private.property_spaces_overlap(unit,target,r.physical_space_id,'short_let',r.stay_type,new.start_date,new.reopen_date,r.stay_check_in,r.stay_check_out))
 then raise exception 'An existing booking prevents closing this physical space';end if;
 return new;
end; $$;
revoke all on function private.guard_physical_host_block() from public,anon,authenticated,service_role;
create trigger aa_property_host_blocks_physical_space before insert or update of listing_id,start_date,reopen_date,reopened_at on public.property_host_date_blocks
for each row execute function private.guard_physical_host_block();
CREATE OR REPLACE FUNCTION public.get_short_stay_unavailable_listing_ids(p_check_in date, p_check_out date)
 RETURNS TABLE(listing_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if p_check_in is null or p_check_out is null or p_check_out<=p_check_in then
    raise exception 'Valid dates required';
  end if;

  return query
  select distinct unavailable.listing_id
  from (
    select r.listing_id
    from public.reservations r
    join public.listings l on l.id::text=r.listing_id
    where l.sub_type='short_let'
      and r.stay_type='short_let'
      and r.status=any(array['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
      and (
        r.status<>'payment_pending'
        or r.payment_expires_at is null
        or r.payment_expires_at>now()
        or exists(
          select 1 from public.booking_payments bp
          where bp.paystack_reference=r.payment_reference
            and bp.status in ('paid','completed')
        )
      )
      and daterange(r.stay_check_in,r.stay_check_out,'[)')
        && daterange(p_check_in,p_check_out,'[)')
    union all
    select b.listing_id::text
    from public.property_host_date_blocks b
    join public.listings l on l.id=b.listing_id
    where l.sub_type='short_let'
      and b.reopened_at is null
      and daterange(b.start_date,b.reopen_date,'[)')
        && daterange(p_check_in,p_check_out,'[)')
    union all
    select l.id::text from public.listings l join public.property_spaces s on s.id=l.physical_space_id
    join public.reservations r on r.physical_unit_id=s.root_unit_id
    where l.sub_type='short_let' and l.approved_at is not null and l.deleted_at is null
    and r.status in('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
    and private.property_spaces_overlap(s.root_unit_id,s.id,r.physical_space_id,'short_let',r.stay_type,p_check_in,p_check_out,r.stay_check_in,r.stay_check_out)
    union all
    select l.id::text from public.listings l join public.property_spaces s on s.id=l.physical_space_id
    join public.property_spaces blocked on blocked.root_unit_id=s.root_unit_id
    join public.listings blocked_listing on blocked_listing.physical_space_id=blocked.id
    join public.property_host_date_blocks b on b.listing_id=blocked_listing.id
    where l.sub_type='short_let' and l.approved_at is not null and l.deleted_at is null and b.reopened_at is null
    and private.property_spaces_overlap(s.root_unit_id,s.id,blocked.id,'short_let','short_let',p_check_in,p_check_out,b.start_date,b.reopen_date)
  ) unavailable;
end
$function$;
