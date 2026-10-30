alter table public.inspection_requests add column home_style text check(home_style in ('apartment','penthouse','bungalow','house','other'));
alter table public.listings add column home_style text check(home_style in ('apartment','penthouse','bungalow','house','other'));
create function private.guard_home_style_submission() returns trigger language plpgsql set search_path='' as $body$
begin
 if (tg_op='INSERT' and new.home_style is not null) or (tg_op='UPDATE' and new.home_style is distinct from old.home_style) then
  if current_setting('wehouse.home_style_command',true) is distinct from 'submission' then raise exception 'Home type must come from the property submission'; end if;
 end if;
 return new;
end;
$body$;
revoke all on function private.guard_home_style_submission() from public,anon,authenticated,service_role;
create trigger inspection_home_style before insert or update of home_style on public.inspection_requests for each row execute function private.guard_home_style_submission();
create function private.snapshot_listing_home_style() returns trigger language plpgsql security definer set search_path='' as $body$
begin
 select r.home_style into new.home_style from public.inspection_requests r where r.id=new.inspection_request_id;
 return new;
end;
$body$;
revoke all on function private.snapshot_listing_home_style() from public,anon,authenticated,service_role;
create trigger listings_home_style before insert or update of home_style,inspection_request_id,physical_space_id on public.listings for each row execute function private.snapshot_listing_home_style();
CREATE OR REPLACE FUNCTION private.link_submission_space(p_request uuid, p_item jsonb, p_owner text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare spec jsonb:=p_item->'physical_space'; site uuid; unit uuid; space uuid; scope text; shared text[]; old_command text;
begin
 if nullif(p_item->>'home_style','') is not null then
  if p_item->>'property_type'<>'apartment' or p_item->>'home_style' not in ('apartment','penthouse','bungalow','house','other') then raise exception 'Invalid home type'; end if;
  if not exists(select 1 from public.inspection_requests where id=p_request and owner_id=p_owner and document_requirements is null) then raise exception 'Home classification is already under review'; end if;
  perform set_config('wehouse.home_style_command','submission',true);
  update public.inspection_requests set home_style=p_item->>'home_style' where id=p_request and owner_id=p_owner;
  perform set_config('wehouse.home_style_command','',true);
 end if;
 if spec is null or spec='null'::jsonb then return null; end if;
 if p_item->>'property_type'<>'apartment' or jsonb_typeof(spec)<>'object' then raise exception 'Physical home details are invalid'; end if;
 if not exists(select 1 from public.inspection_requests where id=p_request and owner_id=p_owner and physical_space_id is null and document_requirements is null) then raise exception 'Property review already has a space identity'; end if;
 scope:=spec->>'scope';
 if scope not in('entire_unit','private_room') or scope is null then raise exception 'Choose the whole home or a private room'; end if;
 site:=private.ensure_submission_space(p_owner,(spec->>'site_id')::uuid,null,'site',spec->>'site_label',null,'{}',p_item->>'property_address',p_item->>'property_city',p_item->>'property_state');
 unit:=private.ensure_submission_space(p_owner,(spec->>'unit_id')::uuid,site,'unit',spec->>'unit_label',spec->>'layout_name','{}');
 if scope='private_room' then
  if jsonb_typeof(spec->'shared_areas')<>'array' or jsonb_array_length(spec->'shared_areas')<1 then raise exception 'Describe the shared areas for a private room'; end if;
  select array_agg(value) into shared from jsonb_array_elements_text(spec->'shared_areas');
  space:=private.ensure_submission_space(p_owner,(spec->>'space_id')::uuid,unit,'private_room',spec->>'space_label',null,shared);
 else
  if (spec->>'space_id')::uuid is distinct from unit then raise exception 'Whole-home offer must identify its physical unit'; end if;
  space:=unit;
 end if;
 old_command:=current_setting('wehouse.property_space_command',true);
 perform set_config('wehouse.property_space_command','link',true);
 update public.inspection_requests set physical_space_id=space where id=p_request and owner_id=p_owner;
 perform set_config('wehouse.property_space_command',coalesce(old_command,''),true);
 update public.listings set physical_space_id=space where inspection_request_id=p_request;
 return space;
end; $function$
;
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
    'home_style',v_listing.home_style,'bedrooms',v_listing.bedrooms,
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
$function$
;
CREATE OR REPLACE FUNCTION public.get_my_property_pipeline_v2(p_stage text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(jsonb_agg(
    (item-'gps_latitude'-'gps_longitude'-'location_accuracy_m'-'latitude'-'longitude'-'accuracy') || jsonb_build_object(
      'home_style',ir.home_style,'property_display_name',ir.property_display_name,
      'space_scope',ir.space_scope,'space_label',ir.space_label,'shared_areas',ir.shared_areas,'submission_schema_version',ir.submission_schema_version,
      'submission_batch_id',ir.submission_batch_id,'hotel_program',coalesce(ir.hotel_program,'{}'::jsonb),
      'lifecycle_stage',case when ir.lifecycle_stage='live' and (item->'listing'->>'status'='pending_approval' or item->'hotel'->>'status'='inactive') then 'listing_prepared' else ir.lifecycle_stage end,'field_evidence_review_status',ir.field_evidence_review_status,
      'field_evidence_reviewed_by',ir.field_evidence_reviewed_by,'field_evidence_reviewed_at',ir.field_evidence_reviewed_at,
      'field_evidence_review_note',ir.field_evidence_review_note,'final_media_reviewed_at',ir.final_media_reviewed_at,
      'final_media_reviewed_by',ir.final_media_reviewed_by,'final_media_sources',ir.final_media_sources,
      'final_hotel_media_sources',ir.final_hotel_media_sources,'final_room_media_sources',ir.final_room_media_sources,
      'document_requirements_configured',ir.document_requirements is not null,
      'document_review_pending',(
        select count(*) from (
          select distinct on(requirement_code) status from public.property_submission_documents
          where request_id=ir.id and requirements_revision=ir.document_requirements_revision and status<>'abandoned'
          order by requirement_code,version desc
        ) latest where status='submitted'
      )
    ) order by (item->>'created_at')::timestamptz desc
  ),'[]'::jsonb)
  from jsonb_array_elements(public.get_my_property_pipeline('all')) item
  join public.inspection_requests ir on ir.id=(item->>'id')::uuid
  where p_stage='all'
    or(p_stage='new' and ir.lifecycle_stage in('access_required','access_review','inspection_ready'))
    or(p_stage='inspection' and ir.lifecycle_stage='inspection')
    or(p_stage='review' and ir.lifecycle_stage='awaiting_review')
    or(p_stage='ready' and ir.lifecycle_stage='ready_to_prepare')
    or(p_stage='preparing' and (case when ir.lifecycle_stage='live' and (item->'listing'->>'status'='pending_approval' or item->'hotel'->>'status'='inactive') then 'listing_prepared' else ir.lifecycle_stage end)='listing_prepared')
    or(p_stage='published' and (case when ir.lifecycle_stage='live' and (item->'listing'->>'status'='pending_approval' or item->'hotel'->>'status'='inactive') then 'listing_prepared' else ir.lifecycle_stage end)='live')
    or(p_stage='rejected' and ir.lifecycle_stage in('changes_requested','rejected'));
$function$
;
CREATE OR REPLACE FUNCTION public.notify_matching_saved_home_searches()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.deleted_at is not null or new.status<>'available' or new.availability_status<>'available' then return new; end if;
  if tg_op='UPDATE' and old.status='available' and old.availability_status='available' then return new; end if;
  with matching as materialized (
    select search.id,search.user_id
    from public.saved_searches search
    where search.search_kind='homes' and search.notifications_enabled
      and (coalesce(search.criteria->>'home_style','')='' or search.criteria->>'home_style'=new.home_style)
      and (coalesce(search.criteria->>'state','')='' or public.wehouse_state_key(search.criteria->>'state')=public.wehouse_state_key(new.state))
      and (coalesce(search.criteria->>'city','')='' or public.wehouse_lga_key(search.criteria->>'city')=public.wehouse_lga_key(new.city))
      and coalesce((search.criteria->>'min_price')::numeric,0)<=new.price
      and (nullif(search.criteria->>'max_price','') is null or new.price<=(search.criteria->>'max_price')::numeric)
      and (nullif(search.criteria->>'bedrooms','') is null or case when (search.criteria->>'bedrooms')::integer=0 then new.bedrooms=0 and new.space_scope is distinct from 'private_room' else new.bedrooms>=(search.criteria->>'bedrooms')::integer end)
      and (nullif(search.criteria->>'bathrooms','') is null or new.bathrooms>=(search.criteria->>'bathrooms')::integer)
      and (coalesce(search.criteria->>'sub_type','')='' or search.criteria->>'sub_type'=coalesce(new.sub_type,''))
  ), inserted as (
    insert into public.notifications(
      recipient_id,type,title,message,related_id,source_type,source_id,
      destination_route,destination_params,event_key
    )
    select matching.user_id,'saved_search_match','A new home matches your search',
      new.title,new.id::text,'listing',new.id::text,'detail',
      jsonb_build_object('listingId',new.id,'listing_id',new.id),
      concat('saved-search:',matching.id,':listing:',new.id)
    from matching
    on conflict(recipient_id,event_key) where event_key is not null do nothing
    returning recipient_id,event_key
  )
  update public.saved_searches search
  set last_notified_at=now(),updated_at=now()
  from inserted
  where search.user_id=inserted.recipient_id
    and inserted.event_key=concat('saved-search:',search.id,':listing:',new.id);
  return new;
end;
$function$
;
drop function public.search_discoverable_homes(text,text,text,text,numeric,numeric,integer,integer,timestamptz,uuid,integer);
CREATE OR REPLACE FUNCTION public.search_discoverable_homes(p_query text DEFAULT NULL::text, p_state text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_stay_type text DEFAULT NULL::text, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_min_bedrooms integer DEFAULT NULL::integer, p_min_bathrooms integer DEFAULT NULL::integer, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 24, p_home_style text DEFAULT NULL::text)
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
      and ($7 is null or ($7=0 and l.bedrooms=0 and l.space_scope is distinct from 'private_room') or ($7>0 and l.bedrooms >= $7))
      and (nullif($12,'') is null or l.home_style=$12)
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
        'home_style',l.home_style,'bedrooms',l.bedrooms,'bathrooms',l.bathrooms,
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
  $query$ into v_result using p_query, p_state, p_city, p_stay_type, p_min_price, p_max_price, p_min_bedrooms, p_min_bathrooms, p_cursor_created_at, p_cursor_id, p_limit, p_home_style;
  return v_result;
end
$function$
;
revoke all on function public.search_discoverable_homes(text,text,text,text,numeric,numeric,integer,integer,timestamptz,uuid,integer,text) from public;
grant execute on function public.search_discoverable_homes(text,text,text,text,numeric,numeric,integer,integer,timestamptz,uuid,integer,text) to anon,authenticated,service_role;
create index listings_home_style_discovery_idx on public.listings(home_style,created_at desc,id desc) where deleted_at is null and approved_at is not null and status='available' and availability_status='available';
