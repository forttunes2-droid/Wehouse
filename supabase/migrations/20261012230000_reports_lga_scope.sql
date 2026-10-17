-- A local-area (branch) Admin sees only reports about people in their local area, matching the People list rule.
create or replace function public._report_in_admin_area(p_subject_user_id text,p_actor public.profiles)
returns boolean language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select p_actor.role='creator'
    or nullif(btrim(coalesce(p_actor.assigned_lga,'')),'') is null
    or exists(select 1 from public.profiles s where s.user_id=p_subject_user_id
      and lower(btrim(coalesce(nullif(s.local_government,''),s.city,'')))=lower(btrim(p_actor.assigned_lga))) $$;
revoke all on function public._report_in_admin_area(text,public.profiles) from public,anon,authenticated;

create or replace function public.admin_list_content_reports(p_status text default 'open')
returns setof public.content_reports language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_actor public.profiles;
begin
  v_actor:=public._admin_dashboard_actor();
  return query select r.* from public.content_reports r
    where r.status=coalesce(p_status,'open')
      and (v_actor.role='creator' or r.state_key=public.wehouse_state_key(v_actor.assigned_state))
      and public._report_in_admin_area(r.subject_user_id,v_actor)
    order by r.created_at desc limit 200;
end $$;

create or replace function public.admin_resolve_content_report(p_report_id uuid,p_status text,p_note text default null)
returns void language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_actor public.profiles; n int;
begin
  v_actor:=public._admin_dashboard_actor();
  if p_status not in ('reviewing','actioned','dismissed') then raise exception 'Invalid status'; end if;
  update public.content_reports r set status=p_status,resolution_note=nullif(left(btrim(coalesce(p_note,'')),1000),''),
    resolved_by=v_actor.user_id,resolved_at=case when p_status='reviewing' then null else now() end
  where r.id=p_report_id and (v_actor.role='creator' or r.state_key=public.wehouse_state_key(v_actor.assigned_state))
    and public._report_in_admin_area(r.subject_user_id,v_actor);
  get diagnostics n=row_count;
  if n=0 then raise exception 'Report not found in your area'; end if;
end $$;
revoke all on function public.admin_list_content_reports(text),public.admin_resolve_content_report(uuid,text,text) from public,anon;
grant execute on function public.admin_list_content_reports(text),public.admin_resolve_content_report(uuid,text,text) to authenticated,service_role;
