-- Keep a customer's selected unit label in the existing booking snapshot; offer bounded reuse of owned compounds.
CREATE OR REPLACE FUNCTION private.guard_physical_space_occupancy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare target uuid; unit uuid; display_label text; active_new boolean; active_old boolean:=false;
begin
 select l.physical_space_id,l.space_label into target,display_label from public.listings l where l.id::text=new.listing_id or l.listing_id=new.listing_id limit 1;
 if tg_op='UPDATE' and old.physical_space_id is not null and old.physical_space_id is distinct from target then raise exception 'Booked physical space cannot change'; end if;
 if target is null then new.physical_space_id:=null;new.physical_unit_id:=null;return new;end if;
 select root_unit_id into unit from public.property_spaces where id=target and kind<>'site';
 if unit is null then raise exception 'Bookable physical unit is unavailable'; end if;
 new.physical_space_id:=target;new.physical_unit_id:=unit;
 if tg_op='INSERT' and nullif(btrim(display_label),'') is not null then new.listing_title:=concat_ws(' · ',nullif(new.listing_title,''),display_label);end if;
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
end; $function$;
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
  new.space_scope:=case when v_space.kind='private_room' then 'private_room' else 'entire_unit' end;new.space_label:=case when v_space.kind='private_room' then (select p.label from public.property_spaces p where p.id=v_space.root_unit_id)||' / '||v_space.label else v_space.label end;new.shared_areas:=v_space.shared_areas;
 else new.space_scope:=null;new.space_label:=null;new.shared_areas:=null;end if;
 return new;
end; $function$;
CREATE OR REPLACE FUNCTION private.snapshot_listing_space()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare expected uuid; s public.property_spaces;
begin
 select physical_space_id into expected from public.inspection_requests where id=new.inspection_request_id;
 if tg_op='UPDATE' and old.physical_space_id is not null and old.physical_space_id is distinct from expected then raise exception 'Published space identity cannot be replaced'; end if;
 if new.physical_space_id is not null and new.physical_space_id is distinct from expected then raise exception 'Listing space must match its reviewed submission'; end if;
 if tg_op='UPDATE' and old.physical_space_id is null and expected is not null and exists(select 1 from public.reservations r where r.listing_id in(new.id::text,new.listing_id)) then raise exception 'Existing booking history needs reviewed space migration'; end if;
 new.physical_space_id:=expected;
 if expected is not null then
  select * into s from public.property_spaces where id=expected;
  new.space_scope:=case when s.kind='private_room' then 'private_room' else 'entire_unit' end;
  new.space_label:=case when s.kind='private_room' then (select p.label from public.property_spaces p where p.id=s.root_unit_id)||' / '||s.label else s.label end;new.shared_areas:=s.shared_areas;
 else new.space_scope:=null;new.space_label:=null;new.shared_areas:=null;
 end if;
 return new;
end; $function$;

create function public.get_my_property_space_options(p_parent_id uuid default null,p_after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor text:=public.current_profile_user_id();result jsonb;
begin
 if not public._property_document_session_active() or actor is null or not public.current_actor_has_workspace('property_partner',null)
 then raise exception 'Active trusted Property Partner session required';end if;
 if p_parent_id is not null and not exists(select 1 from public.property_spaces where id=p_parent_id and owner_user_id=actor and kind='site')then raise exception 'Containing property unavailable';end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') into result from(
 select id,parent_id,kind,label,layout_name,address,city,state from public.property_spaces
 where owner_user_id=actor and (p_after_id is null or id>p_after_id)
 and ((p_parent_id is null and kind='site')or(p_parent_id is not null and parent_id=p_parent_id and kind='unit'))
 order by id limit 100)s;
 return result;
end; $$;
revoke all on function public.get_my_property_space_options(uuid,uuid) from public,anon,service_role;
grant execute on function public.get_my_property_space_options(uuid,uuid) to authenticated;
