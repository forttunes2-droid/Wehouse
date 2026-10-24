-- Reuse existing private rooms across offers without creating a second physical identity.
create or replace function public.get_my_property_space_options(p_parent_id uuid default null,p_after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor text:=public.current_profile_user_id();result jsonb;parent_kind text;
begin
 if not public._property_document_session_active() or actor is null or not public.current_actor_has_workspace('property_partner',null)
 then raise exception 'Active trusted Property Partner session required';end if;
 if p_parent_id is not null then
  select kind into parent_kind from public.property_spaces where id=p_parent_id and owner_user_id=actor and kind in('site','unit');
  if parent_kind is null then raise exception 'Containing property unavailable';end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') into result from(
 select id,parent_id,kind,label,layout_name,address,city,state,shared_areas from public.property_spaces
 where owner_user_id=actor and(p_after_id is null or id>p_after_id)
 and((p_parent_id is null and kind='site')or(parent_id=p_parent_id and kind=case when parent_kind='site' then 'unit' else 'private_room' end))
 order by id limit 100)s;
 return result;
end; $$;
