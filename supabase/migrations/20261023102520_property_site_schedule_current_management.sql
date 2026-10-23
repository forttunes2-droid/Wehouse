create or replace function public.get_my_property_site_schedule(p_site_id uuid,p_from date,p_until date,p_after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public' as $body$
declare v_rows jsonb; v_more boolean; v_label text;
begin
 if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
 if p_from is null or p_until is null or p_until<=p_from or p_until>p_from+62 then raise exception 'Choose a schedule window of up to 62 days'; end if;
 if not exists(select 1 from public.listings l join public.property_spaces s on s.id=l.physical_space_id join public.property_spaces u on u.id=s.root_unit_id
 where u.parent_id=p_site_id and l.deleted_at is null and public.current_actor_can_manage_property(l.id) and (l.management_mode='host' or exists(select 1 from public.property_host_assignments a where a.listing_id=l.id and a.user_id=public.current_profile_user_id() and a.assignment_role='owner' and a.status='active'))) then raise exception 'Property schedule access required'; end if;
 select label into v_label from public.property_spaces where id=p_site_id and kind='site';
 with eligible as materialized(
 select l.id,l.title,l.sub_type,l.space_label,l.space_scope,l.physical_space_id
 from public.listings l join public.property_spaces s on s.id=l.physical_space_id join public.property_spaces u on u.id=s.root_unit_id
 where u.parent_id=p_site_id and l.deleted_at is null and l.approved_at is not null
 and public.current_actor_can_manage_property(l.id) and (l.management_mode='host' or exists(select 1 from public.property_host_assignments a where a.listing_id=l.id and a.user_id=public.current_profile_user_id() and a.assignment_role='owner' and a.status='active')) and (p_after_id is null or l.id>p_after_id)
 order by l.id limit 51
 ), page as(select * from eligible order by id limit 50)
 select coalesce(jsonb_agg(jsonb_build_object('listing_id',p.id,'title',p.title,'space_label',p.space_label,'space_scope',p.space_scope,'sub_type',p.sub_type,
 'events',coalesce(e.items,'[]'::jsonb),'events_truncated',coalesce(e.more,false)) order by p.id),'[]'::jsonb),
 (select count(*)>50 from eligible)
 into v_rows,v_more
 from page p left join lateral(
  with events as(
   select 'stay:'||r.id as event_id,'stay'::text as kind,r.status,r.stay_check_in as starts_on,r.stay_check_out as ends_on
   from public.reservations r where (r.listing_id=p.id::text or r.listing_id=(select listing_id from public.listings where id=p.id))
   and r.status in ('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
   and (r.stay_check_in is null or r.stay_check_out is null or daterange(r.stay_check_in,r.stay_check_out,'[)')&&daterange(p_from,p_until,'[)'))
   union all
   select 'block:'||b.block_id,'closure','closed',b.start_date,b.reopen_date from public.property_host_date_blocks b
   where b.listing_id=p.id and b.reopened_at is null and daterange(b.start_date,b.reopen_date,'[)')&&daterange(p_from,p_until,'[)')
  ), bounded as(select * from events order by starts_on nulls first,event_id limit 101)
  select (select jsonb_agg(to_jsonb(z) order by z.starts_on nulls first,z.event_id) from (select * from bounded order by starts_on nulls first,event_id limit 100)z) as items,
   (select count(*)>100 from bounded) as more
 )e on true;
 return jsonb_build_object('site_id',p_site_id,'site_label',v_label,'from',p_from,'until',p_until,'items',v_rows,'has_more',v_more,
 'next_id',case when v_more then v_rows->-1->>'listing_id' else null end);
end;$body$;
revoke all on function public.get_my_property_site_schedule(uuid,date,date,uuid) from public,anon;
grant execute on function public.get_my_property_site_schedule(uuid,date,date,uuid) to authenticated;
