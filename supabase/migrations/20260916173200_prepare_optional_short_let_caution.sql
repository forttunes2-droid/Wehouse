-- Keep optional Short Let caution consistent through Operations preparation.
create or replace function public.post_property_from_inspection(p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_caller public.profiles;
  v_ir public.inspection_requests;
  v_partner public.profiles;
  v_listing_id uuid;
  v_code text;
  v_images text[];
  v_videos text[];
  v_amenities text[];
  v_sub_type text;
  v_deposit numeric;
begin
  select * into v_caller
  from public.profiles
  where auth_id=auth.uid()::text
    and role in('staff','admin','creator')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_caller is null then raise exception 'WeHouse operations access required'; end if;
  if v_caller.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations permission required';
  end if;

  select * into v_ir
  from public.inspection_requests
  where id=(p_data->>'inspection_id')::uuid
  for update;
  if v_ir is null or v_ir.status not in('completed','approved') then
    raise exception 'Inspection must be completed before listing preparation';
  end if;
  if v_caller.role in('admin','staff') and not public.current_actor_in_scope(v_ir.property_state,v_ir.property_city) then
    raise exception 'Property is outside your assigned branch';
  end if;
  if v_ir.property_type='hotel' then raise exception 'Hotels use the hotel preparation workflow'; end if;

  if v_ir.draft_listing_id is not null then
    select id into v_listing_id
    from public.listings
    where id=v_ir.draft_listing_id
      and inspection_request_id=v_ir.id
      and deleted_at is null
    limit 1;
    if v_listing_id is not null then return v_listing_id; end if;
    update public.inspection_requests
    set draft_listing_id=null,updated_at=now()
    where id=v_ir.id;
  end if;

  select * into v_partner
  from public.profiles
  where user_id=v_ir.owner_id
    and public.user_has_active_workspace(user_id,'property_partner')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_partner is null then raise exception 'Valid Property Partner owner required'; end if;
  if nullif(btrim(p_data->>'title'),'') is null or coalesce((p_data->>'price')::numeric,0)<=0 then
    raise exception 'Listing title and valid price are required';
  end if;

  v_sub_type:=coalesce(nullif(btrim(p_data->>'sub_type'),''),v_ir.sub_type);
  if v_sub_type not in('short_let','long_stay') then
    raise exception 'Choose Short Let or Long Let before preparing this apartment';
  end if;
  v_deposit:=coalesce(nullif(p_data->>'security_deposit_amount','')::numeric,v_ir.security_deposit_amount,0);
  if v_sub_type='short_let' and v_deposit<0 then
    raise exception 'Caution amount cannot be negative';
  end if;
  if v_sub_type='long_stay' then v_deposit:=null; end if;

  select coalesce(array_agg(value),array[]::text[]) into v_images
  from jsonb_array_elements_text(coalesce(p_data->'images','[]'::jsonb));
  select coalesce(array_agg(value),array[]::text[]) into v_videos
  from jsonb_array_elements_text(coalesce(p_data->'videos','[]'::jsonb));
  select coalesce(array_agg(distinct value),array[]::text[]) into v_amenities
  from jsonb_array_elements_text(coalesce(p_data->'amenities',to_jsonb(coalesce(v_ir.amenities,array[]::text[]))));
  if v_sub_type='short_let' and not ('Furnished'=any(coalesce(v_amenities,array[]::text[]))) then
    v_amenities:=array_append(coalesce(v_amenities,array[]::text[]),'Furnished');
  end if;

  v_code:='WHL-'||upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 12));
  insert into public.listings(
    listing_id,title,description,price,currency,state,city,address,images,videos,bedrooms,bathrooms,
    property_type,sub_type,security_deposit_amount,amenities,availability_status,owner_id,partner_id,
    chat_agent_id,status,submitted_by_role,reservation_fee_paid,chat_unlocked,gps_latitude,gps_longitude,
    inspection_request_id,created_at,updated_at
  ) values(
    v_code,btrim(p_data->>'title'),nullif(btrim(p_data->>'description'),''),(p_data->>'price')::numeric,'NGN',
    v_ir.property_state,v_ir.property_city,v_ir.property_address,v_images,v_videos,
    coalesce((p_data->>'bedrooms')::int,v_ir.bedrooms,1),coalesce((p_data->>'bathrooms')::int,v_ir.bathrooms,1),
    coalesce(nullif(btrim(p_data->>'property_type'),''),v_ir.property_type,'apartment'),v_sub_type,v_deposit,v_amenities,
    'pending_approval',v_partner.user_id,v_partner.user_id,v_caller.user_id,'pending_approval','property_partner',false,false,
    v_ir.gps_latitude,v_ir.gps_longitude,v_ir.id,now(),now()
  ) returning id into v_listing_id;

  update public.inspection_requests
  set draft_listing_id=v_listing_id,sub_type=v_sub_type,
      security_deposit_amount=v_deposit,amenities=v_amenities,updated_at=now()
  where id=v_ir.id;
  return v_listing_id;
end
$$;
