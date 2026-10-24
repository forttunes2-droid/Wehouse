-- Final publication uses current additive workspace grants and the same
-- independent document authority as the preceding review commands.
create or replace function public.admin_publish_inspected_listing(p_listing_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.profiles; l public.listings; r public.inspection_requests;
begin
  a:=public._current_team_actor();
  if a.role not in('admin','creator') then raise exception 'Admin or Creator access required'; end if;
  select * into l from public.listings where id=p_listing_id and deleted_at is null for update;
  if l.id is null or l.inspection_request_id is null then raise exception 'Inspection-linked listing required'; end if;
  select * into r from public.inspection_requests where id=l.inspection_request_id for update;
  a:=public._property_document_reviewer(r.id);
  if r.status not in('completed','approved') then raise exception 'Inspection is not complete'; end if;
  if r.final_media_reviewed_at is null then raise exception 'Confirm the final property gallery before publication'; end if;
  if coalesce(l.property_type,'apartment')<>'apartment' then raise exception 'Hotels must use the Hotel submission and room-inventory workflow'; end if;
  if nullif(btrim(l.title),'') is null or coalesce(l.price,0)<=0 or l.price::text in('NaN','Infinity','-Infinity')
    or nullif(btrim(l.address),'') is null or cardinality(coalesce(l.images,array[]::text[]))<1 then
    raise exception 'Title, valid price, property address and at least one image are required before publication'; end if;
  if l.sub_type is null or l.sub_type not in('short_let','long_stay') then raise exception 'Apartment must be classified as Short Let or Long Let before publication'; end if;
  if l.bedrooms is null or l.bathrooms is null or l.bedrooms<0 or l.bathrooms<0 then raise exception 'Confirm bedroom and bathroom counts before publication'; end if;
  if l.sub_type='short_let' then
    if coalesce(l.security_deposit_amount,0)<0 then raise exception 'Caution amount cannot be negative'; end if;
    if coalesce(l.max_guests,0)<1 then raise exception 'Confirm the maximum guest capacity before publication'; end if;
    if not('Furnished'=any(coalesce(l.amenities,array[]::text[]))) then raise exception 'Short Let apartment must be furnished'; end if;
  end if;
  perform public._assert_property_documents_ready(r.id);
  if l.status='available' and l.availability_status='available' and r.published_at is not null then return; end if;
  update public.listings set status='available',availability_status='available',approved_by=a.user_id,approved_at=now(),rejection_reason=null,updated_at=now() where id=l.id;
  update public.inspection_requests set status='approved',approved_by=a.user_id,approved_at=now(),published_at=now(),updated_at=now() where id=r.id;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
    values('PROPERTY_PUBLICATION_APPROVED','listings',l.id::text,jsonb_build_object('inspection_id',r.id,'document_requirements_revision',r.document_requirements_revision)::text,a.user_id,a.email);
end $$;
revoke all on function public.admin_publish_inspected_listing(uuid) from public,anon;
grant execute on function public.admin_publish_inspected_listing(uuid) to authenticated;

create or replace function public.admin_publish_inspected_hotel(p_hotel_id integer)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.profiles; h public.hotels; r public.inspection_requests; room_count integer;
begin
  a:=public._current_team_actor();
  if a.role not in('admin','creator') then raise exception 'Admin or Creator access required'; end if;
  select * into h from public.hotels where hotel_id=p_hotel_id for update;
  if h.hotel_id is null or h.inspection_request_id is null then raise exception 'Inspection-linked hotel required'; end if;
  select * into r from public.inspection_requests where id=h.inspection_request_id for update;
  a:=public._property_document_reviewer(r.id);
  if r.status not in('completed','approved') then raise exception 'Inspection is not complete'; end if;
  if r.property_type is distinct from 'hotel' then raise exception 'A Hotel submission is required'; end if;
  if r.final_media_reviewed_at is null then raise exception 'Confirm the hotel and every room gallery before publication'; end if;
  select count(*) into room_count from public.hotel_rooms where hotel_id=p_hotel_id;
  if cardinality(coalesce(h.images,array[]::text[]))<1 or room_count<1 then raise exception 'At least one hotel image and one room type are required before publication'; end if;
  if exists(select 1 from public.hotel_rooms hr where hr.hotel_id=p_hotel_id and exists(
    select 1 from jsonb_array_elements(coalesce(r.hotel_program->'room_types','[]'::jsonb)) submitted_room
    where lower(btrim(submitted_room->>'name'))=lower(btrim(hr.room_type)) and jsonb_array_length(coalesce(submitted_room->'media','[]'::jsonb))>0
  ) and cardinality(coalesce(hr.images,array[]::text[]))<1) then raise exception 'Every submitted room type needs a confirmed public gallery'; end if;
  perform public._assert_property_documents_ready(r.id);
  if h.status='active' and r.published_at is not null then return; end if;
  update public.hotels set status='active',approved_by=a.user_id,approved_at=now(),published_at=now(),updated_at=now() where hotel_id=h.hotel_id;
  update public.inspection_requests set status='approved',approved_by=a.user_id,approved_at=now(),published_at=now(),updated_at=now() where id=r.id;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
    values('HOTEL_PUBLICATION_APPROVED','hotels',h.hotel_id::text,jsonb_build_object('inspection_id',r.id,'document_requirements_revision',r.document_requirements_revision)::text,a.user_id,a.email);
end $$;
revoke all on function public.admin_publish_inspected_hotel(integer) from public,anon;
grant execute on function public.admin_publish_inspected_hotel(integer) to authenticated;
