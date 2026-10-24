-- Public offers from the same verified compound/building. No private documents,
-- occupant data, host identity or exact address is projected.
create function public.get_property_site_offers(p_listing_id uuid,p_stay_type text default null,p_check_in date default null,p_check_out date default null,p_after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare site uuid; result jsonb;
begin
 if p_stay_type is not null and p_stay_type not in ('short_let','long_stay') then raise exception 'Choose Short Let or Long Let';end if;
 if (p_check_in is null)<>(p_check_out is null) or (p_check_in is not null and (p_check_out<=p_check_in or p_check_out>p_check_in+90)) then raise exception 'Choose a stay of 1 to 90 nights';end if;
 select u.parent_id into site from public.listings l join public.property_spaces s on s.id=l.physical_space_id join public.property_spaces u on u.id=s.root_unit_id
 where l.id=p_listing_id and l.deleted_at is null and l.approved_at is not null and l.inspection_request_id is not null
 and l.status='available' and l.availability_status='available';
 if site is null then return jsonb_build_object('listing_id',p_listing_id,'grouped',false,'items','[]'::jsonb,'has_more',false,'next_id',null);end if;
 with candidates as materialized(
  select l.id,l.title,l.price,l.currency,l.bedrooms,l.bathrooms,l.sub_type,l.space_scope,l.space_label,l.home_style,s.id as space_id,s.root_unit_id
  from public.property_spaces u join public.property_spaces s on s.root_unit_id=u.id join public.listings l on l.physical_space_id=s.id
  where u.parent_id=site and l.id<>p_listing_id and (p_after_id is null or l.id>p_after_id)
   and l.deleted_at is null and l.approved_at is not null and l.inspection_request_id is not null
   and l.status='available' and l.availability_status='available' and l.sub_type in ('short_let','long_stay')
   and (p_stay_type is null or l.sub_type=p_stay_type)
   and (l.sub_type='short_let' or private.property_space_long_let_available(s.id))
   and (l.sub_type<>'short_let' or p_check_in is null or (
    not exists(select 1 from public.reservations r where r.physical_unit_id=s.root_unit_id
     and r.status in ('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
     and (r.status<>'payment_pending' or r.payment_expires_at is null or r.payment_expires_at>now()
      or exists(select 1 from public.booking_payments bp where bp.paystack_reference=r.payment_reference and bp.status in ('paid','completed')))
     and private.property_spaces_overlap(s.root_unit_id,s.id,r.physical_space_id,'short_let',r.stay_type,p_check_in,p_check_out,r.stay_check_in,r.stay_check_out))
    and not exists(select 1 from public.property_spaces blocked join public.listings bl on bl.physical_space_id=blocked.id
     join public.property_host_date_blocks b on b.listing_id=bl.id where blocked.root_unit_id=s.root_unit_id and b.reopened_at is null
     and private.property_spaces_overlap(s.root_unit_id,s.id,blocked.id,'short_let','short_let',p_check_in,p_check_out,b.start_date,b.reopen_date))
   ))
  order by l.id limit 13
 ), page as(select * from candidates order by id limit 12)
 select jsonb_build_object('listing_id',p_listing_id,'grouped',true,'check_in',p_check_in,'check_out',p_check_out,
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'price',price,'currency',currency,'bedrooms',bedrooms,'bathrooms',bathrooms,
   'sub_type',sub_type,'space_scope',space_scope,'space_label',space_label,'home_style',home_style,'unit_id',root_unit_id) order by id) from page),'[]'::jsonb),
  'has_more',(select count(*)>12 from candidates),'next_id',case when (select count(*)>12 from candidates) then (select id from page order by id desc limit 1) else null end) into result;
 return result;
end $$;
revoke all on function public.get_property_site_offers(uuid,text,date,date,uuid) from public;
grant execute on function public.get_property_site_offers(uuid,text,date,date,uuid) to anon,authenticated;
