CREATE OR REPLACE FUNCTION private.guard_submission_space_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_space public.property_spaces;
begin
 if tg_op='INSERT' then
  if new.physical_space_id is not null then raise exception 'Use the reviewed property submission to identify the physical space';end if;
  new.space_scope:=null;new.space_label:=null;new.shared_areas:=null;return new;
 end if;
 if new.physical_space_id is distinct from old.physical_space_id and
 (old.physical_space_id is not null or current_setting('wehouse.property_space_command',true) is distinct from 'link'
 or not exists(select 1 from public.property_spaces s where s.id=new.physical_space_id and s.owner_user_id=new.owner_id and s.kind<>'site'))
 then raise exception 'Use the reviewed property submission to identify the physical space'; end if;
 if new.physical_space_id is not null then
  select * into v_space from public.property_spaces where id=new.physical_space_id;
  new.space_scope:=case when v_space.kind='private_room' then 'private_room' else 'entire_unit' end;new.space_label:=v_space.label;new.shared_areas:=v_space.shared_areas;
 else new.space_scope:=null;new.space_label:=null;new.shared_areas:=null;end if;
 return new;
end; $function$;
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
create function public.get_my_property_submission_receipt(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor text:=public.current_profile_user_id();requests jsonb;
begin
 if not public._property_document_session_active() or actor is null or not public.current_actor_has_workspace('property_partner',null) then raise exception 'Active trusted Property Partner session required';end if;
 if not exists(select 1 from public.property_submission_batches b where b.id=p_batch_id and b.partner_user_id=(auth.uid())::text) then raise exception 'Submission batch not found';end if;
 if not exists(select 1 from public.property_submission_batches where id=p_batch_id and status='submitted') then return null;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'request_code',r.request_code,'position',r.submission_batch_position) order by r.submission_batch_position),'[]'::jsonb)
 into requests from public.inspection_requests r where r.submission_batch_id=p_batch_id and r.owner_id=actor;
 return jsonb_build_object('batch_id',p_batch_id,'count',jsonb_array_length(requests),'requests',requests);
end; $$;
revoke all on function public.get_my_property_submission_receipt(uuid) from public,anon,service_role;
grant execute on function public.get_my_property_submission_receipt(uuid) to authenticated;
