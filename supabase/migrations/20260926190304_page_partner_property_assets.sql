-- Bounded, grant-scoped read for published Partner and delegated Hosting homes.
-- The final row is an optional lookahead; callers retain a cursor from the
-- last displayed row. Exact record navigation uses the same authorization.
create or replace function public.get_my_property_assets_page(
  p_workspace text,
  p_limit integer default 41,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_listing_id text default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if p_workspace is null or p_workspace not in ('property_partner','hosting')
     or v_actor is null or not public.current_actor_has_workspace(p_workspace,null) then
    raise exception 'Property workspace required';
  end if;
  if p_limit is null or p_limit<1 or p_limit>51 then
    raise exception 'Page size must be between 1 and 51';
  end if;
  if (p_before_created_at is null)<>(p_before_id is null) then
    raise exception 'Incomplete property page cursor';
  end if;
  if p_listing_id is not null and (btrim(p_listing_id)='' or length(p_listing_id)>128) then
    raise exception 'Invalid property target';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',row.id,'listing_id',row.listing_id,'title',row.title,
    'address',row.address,'city',row.city,'state',row.state,
    'images',row.images,'videos',row.videos,'price',row.price,
    'availability_status',row.availability_status,'status',row.status,
    'property_type',row.property_type,'sub_type',row.sub_type,
    'bedrooms',row.bedrooms,'bathrooms',row.bathrooms,
    'management_mode',row.management_mode,
    'management_updated_at',row.management_updated_at,
    'created_at',row.created_at,
    '_assignment_role',row.assignment_role,
    '_assignment_status','active',
    '_access_level',row.access_level,
    '_can_manage',true,
    '_can_control_commercials',row.access_level='full_hosting'
      and row.management_mode='host',
    '_is_owner',row.assignment_role='owner'
  ) order by row.created_at desc,row.id desc),'[]'::jsonb)
  into v_result
  from (
    select l.id,l.listing_id,l.title,l.address,l.city,l.state,
      l.images,l.videos,l.price,l.availability_status,l.status,
      l.property_type,l.sub_type,l.bedrooms,l.bathrooms,
      l.management_mode,l.management_updated_at,l.created_at,
      a.assignment_role,
      case when a.assignment_role='owner' then 'full_hosting' else a.access_level end access_level
    from public.property_host_assignments a
    join public.listings l on l.id=a.listing_id
    where a.user_id=v_actor and a.status='active'
      and ((p_workspace='property_partner' and a.assignment_role='owner')
        or (p_workspace='hosting' and a.assignment_role='manager'
          and (l.management_mode='host' or exists(
            select 1 from public.reservations r
            where (r.listing_id=l.id::text or r.listing_id=l.listing_id)
              and r.management_mode_snapshot='host'
              and r.responsible_host_user_id=v_actor
              and r.status not in ('completed','cancelled','refunded','expired')))))
      and l.deleted_at is null and l.approved_at is not null
      and l.status in ('available','unavailable','reserved','occupied','maintenance','closed')
      and (p_listing_id is null or l.id::text=p_listing_id or l.listing_id=p_listing_id)
      and (p_before_created_at is null
        or (l.created_at,l.id)<(p_before_created_at,p_before_id))
    order by l.created_at desc,l.id desc
    limit case when p_listing_id is null then p_limit else 1 end
  ) row;
  return v_result;
end
$$;
revoke all on function public.get_my_property_assets_page(text,integer,timestamptz,uuid,text)
  from public,anon;
grant execute on function public.get_my_property_assets_page(text,integer,timestamptz,uuid,text)
  to authenticated,service_role;
