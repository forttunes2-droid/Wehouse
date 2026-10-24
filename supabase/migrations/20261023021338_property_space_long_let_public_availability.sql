-- An undated Long Let cannot advertise a physical space already held through another offer.
-- Separate sibling rooms remain independent; existing dated Short Let discovery is unchanged.
create function private.property_space_long_let_available(p_space uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare unit uuid;
begin
 if p_space is null then return true;end if;
 select root_unit_id into unit from public.property_spaces where id=p_space and kind<>'site';
 if unit is null then return false;end if;
 return not exists(select 1 from public.reservations r where r.physical_unit_id=unit
  and r.status in('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
  and private.property_spaces_overlap(unit,p_space,r.physical_space_id,'long_stay',r.stay_type,null,null,r.stay_check_in,r.stay_check_out))
 and not exists(select 1 from public.property_host_date_blocks b join public.listings l on l.id=b.listing_id
  join public.property_spaces s on s.id=l.physical_space_id where s.root_unit_id=unit and b.reopened_at is null
  and b.reopen_date>timezone('Africa/Lagos',now())::date
  and private.property_spaces_overlap(unit,p_space,s.id,'long_stay','short_let',null,null,b.start_date,b.reopen_date));
end; $$;
revoke all on function private.property_space_long_let_available(uuid) from public,anon,authenticated,service_role;

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
    and (l.sub_type='short_let' or l.physical_space_id is null or private.property_space_long_let_available(l.physical_space_id))
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
  v_space_available boolean;
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

  v_space_available:=v_listing.sub_type='short_let' or v_listing.physical_space_id is null or private.property_space_long_let_available(v_listing.physical_space_id);
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
    'availability_status',case when v_space_available then v_listing.availability_status else 'unavailable' end,
    'status',case when v_space_available then v_listing.status else 'unavailable' end,
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

CREATE OR REPLACE FUNCTION public.get_sponsored_discovery(p_resource_type text, p_state text DEFAULT NULL::text, p_lga text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_limit integer DEFAULT 6)
 RETURNS TABLE(campaign_id uuid, resource_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select c.campaign_id,c.resource_id from public.sponsored_campaigns c
  join public.sponsored_market_rules r on r.rule_id=c.rule_id
  where c.resource_type=p_resource_type and c.status='active'
    and (c.resource_type<>'worker' or (select auth.uid()) is not null)
    and c.starts_at<=now() and c.ends_at>now() and r.enabled and r.slot_count>0
    and (nullif(p_state,'') is null or c.state_key=public.wehouse_state_key(p_state))
    and (nullif(p_lga,'') is null or c.lga_key=public.worker_market_text_key(p_lga))
    and (nullif(p_category,'') is null or c.category_key=public.worker_market_text_key(p_category))
    and case c.resource_type
      when 'worker' then exists(select 1 from public.profiles p
        where p.user_id=c.resource_id and p.user_id=c.owner_user_id
          and p.worker_status='verified' and p.worker_verified=true
          and p.available=true
          and coalesce((public._worker_publication_state(p.user_id)->>'publicly_visible')::boolean,false)
          and public.user_has_active_workspace(p.user_id,'worker')
          and not coalesce(p.deleted,false) and not coalesce(p.suspended,false)
          and not coalesce(p.banned,false))
      when 'property' then exists(select 1 from public.listings l
        join public.property_host_assignments a on a.listing_id=l.id
          and a.user_id=c.owner_user_id and a.assignment_role='owner' and a.status='active'
        where l.id::text=c.resource_id and l.deleted_at is null
          and l.approved_at is not null and l.status='available'
          and l.availability_status='available' and l.inspection_request_id is not null
          and (l.sub_type='short_let' or l.physical_space_id is null or private.property_space_long_let_available(l.physical_space_id))
          and public.user_has_active_workspace(a.user_id,'property_partner'))
      when 'hotel' then exists(select 1 from public.hotels h
        where h.hotel_id::text=c.resource_id and h.owner_id=c.owner_user_id
          and h.status='active' and h.approved_at is not null and h.published_at is not null
          and public.user_has_active_workspace(h.owner_id,'property_partner'))
      else false end
  order by md5(c.campaign_id::text||current_date::text)
  limit least(greatest(coalesce(p_limit,6),1),12)
$function$;

CREATE OR REPLACE FUNCTION public.search_discoverable_homes(p_query text DEFAULT NULL::text, p_state text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_stay_type text DEFAULT NULL::text, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_min_bedrooms integer DEFAULT NULL::integer, p_min_bathrooms integer DEFAULT NULL::integer, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_result jsonb;
begin
  execute $query$
with picked as materialized (
    select l.*
    from public.listings l
    where l.deleted_at is null
      and l.inspection_request_id is not null
      and l.approved_at is not null
      and l.status = 'available'
      and l.availability_status = 'available'
      and (l.sub_type='short_let' or l.physical_space_id is null or private.property_space_long_let_available(l.physical_space_id))
      and (l.property_type is null or l.property_type <> 'hotel')
      and (nullif(btrim($2),'') is null or lower(l.state) = lower(btrim($2)))
      and (nullif(btrim($3),'') is null or lower(l.city) = lower(btrim($3)))
      and (nullif(btrim($4),'') is null or l.sub_type = $4)
      and ($5 is null or l.price >= $5)
      and ($6 is null or l.price <= $6)
      and ($7 is null or l.bedrooms >= $7)
      and ($8 is null or l.bathrooms >= $8)
      and (nullif(btrim($1),'') is null or
        strpos(lower(coalesce(l.title,'')),lower(left(btrim($1),80))) > 0 or
        strpos(lower(coalesce(l.address,'')),lower(left(btrim($1),80))) > 0 or
        strpos(lower(coalesce(l.city,'')),lower(left(btrim($1),80))) > 0 or
        strpos(lower(coalesce(l.state,'')),lower(left(btrim($1),80))) > 0)
      and ($9 is null or $10 is null or
        (l.created_at,l.id) < ($9,$10))
    order by l.created_at desc,l.id desc
    limit least(greatest(coalesce($11,24),1),48)+1
  ),
  page as materialized (
    select * from picked
    order by created_at desc,id desc
    limit least(greatest(coalesce($11,24),1),48)
  )
  select jsonb_build_object(
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',l.id,'listing_id',l.listing_id,'title',l.title,
        'description',l.description,'price',l.price,'currency',l.currency,
        'state',l.state,'city',l.city,'address',l.address,
        'images',coalesce(l.images,array[]::text[]),
        'videos',coalesce(l.videos,array[]::text[]),
        'bedrooms',l.bedrooms,'bathrooms',l.bathrooms,
        'availability_status',l.availability_status,'status',l.status,
        'property_type',l.property_type,'sub_type',l.sub_type,
        'space_scope',l.space_scope,'space_label',l.space_label,'shared_areas',l.shared_areas,
        'security_deposit_amount',l.security_deposit_amount,
        'max_guests',l.max_guests,'max_occupants',l.max_occupants,
        'future_installments_allowed',l.future_installments_allowed,
        'amenities',coalesce(l.amenities,array[]::text[]),
        'created_at',l.created_at,'updated_at',l.updated_at,
        'gps_latitude',null,'gps_longitude',null,
        'location_accuracy_m',null,'location_exact',false,
        'partner_display_name',coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''))
      ) order by l.created_at desc,l.id desc)
      from page l
      left join public.profiles p on p.user_id=coalesce(l.partner_id,l.owner_id)
    ),'[]'::jsonb),
    'has_more',(select count(*) from picked) > (select count(*) from page),
    'next_cursor_created_at',(select created_at from page order by created_at,id limit 1),
    'next_cursor_id',(select id from page order by created_at,id limit 1)
  )
  $query$ into v_result using p_query, p_state, p_city, p_stay_type, p_min_price, p_max_price, p_min_bedrooms, p_min_bathrooms, p_cursor_created_at, p_cursor_id, p_limit;
  return v_result;
end
$function$;

