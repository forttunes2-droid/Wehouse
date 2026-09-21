-- Admin announcements follow the same State/LGA workspace authority as Team management.
-- Recipient type matching uses additive workspaces, not legacy profiles.role.

begin;

create or replace function public._admin_announcement_role_in_scope(
  p_target_user_id text,
  p_target_roles text[]
)
returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_target public.profiles;
  v_role text;
  v_staff_grant public.workspace_role_assignments;
  v_personal_lga text;
begin
  select * into v_target
  from public.profiles
  where user_id=p_target_user_id
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_target.user_id is null then return false; end if;

  v_personal_lga:=coalesce(nullif(v_target.local_government,''),nullif(v_target.city,''));

  foreach v_role in array coalesce(p_target_roles,'{}'::text[]) loop
    if v_role='staff' and public.user_has_active_workspace(v_target.user_id,'staff') then
      select * into v_staff_grant
      from public.workspace_role_assignments
      where user_id=v_target.user_id
        and workspace_role='staff'
        and status='active'
        and revoked_at is null
      limit 1;
      if v_staff_grant.id is not null
         and public.current_actor_in_scope(
           v_staff_grant.scope_state,
           case when v_staff_grant.scope_type='branch' then v_staff_grant.scope_lga else null end
         ) then return true; end if;

    elsif v_role='worker'
      and public.user_has_active_workspace(v_target.user_id,'worker')
      and public.current_actor_in_scope(v_target.state,v_personal_lga) then
      return true;

    elsif v_role='property_partner'
      and public.user_has_active_workspace(v_target.user_id,'property_partner')
      and public.current_actor_in_scope(v_target.state,v_personal_lga) then
      return true;

    elsif v_role='user'
      and not public.user_has_active_workspace(v_target.user_id,'worker')
      and not public.user_has_active_workspace(v_target.user_id,'property_partner')
      and not public.user_has_active_workspace(v_target.user_id,'staff')
      and not public.user_has_active_workspace(v_target.user_id,'admin')
      and not public.user_has_active_workspace(v_target.user_id,'creator')
      and public.current_actor_in_scope(v_target.state,v_personal_lga) then
      return true;
    end if;
  end loop;

  return false;
end
$$;

create or replace function public.admin_count_branch_announcement_recipients(
  p_target_roles text[]
)
returns bigint
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_roles text[];
  v_count bigint;
begin
  v_actor:=public._admin_dashboard_actor();
  if v_actor.role<>'admin' then raise exception 'Admin account required'; end if;

  select coalesce(array_agg(distinct role_name),'{}'::text[])
  into v_roles
  from unnest(coalesce(p_target_roles,'{}'::text[])) role_name
  where role_name in ('user','worker','staff','property_partner');

  if coalesce(array_length(v_roles,1),0)=0 then return 0; end if;

  select count(*) into v_count
  from public.profiles p
  where p.user_id<>v_actor.user_id
    and public._admin_announcement_role_in_scope(p.user_id,v_roles);

  return v_count;
end
$$;

create or replace function public.admin_send_branch_announcement(
  p_title text,
  p_content text,
  p_target_roles text[],
  p_recipient_ids text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_id integer;
  v_count integer;
  v_roles text[];
begin
  v_actor:=public._admin_dashboard_actor();
  if v_actor.role<>'admin' then raise exception 'Admin account required'; end if;
  if nullif(btrim(coalesce(p_title,'')),'') is null then
    raise exception 'Announcement title is required';
  end if;
  if nullif(btrim(coalesce(p_content,'')),'') is null then
    raise exception 'Announcement content is required';
  end if;

  select coalesce(array_agg(distinct role_name),'{}'::text[])
  into v_roles
  from unnest(coalesce(p_target_roles,'{}'::text[])) role_name
  where role_name in ('user','worker','staff','property_partner');

  if p_recipient_ids is null and coalesce(array_length(v_roles,1),0)=0 then
    raise exception 'Select at least one recipient type';
  end if;

  insert into public.announcements(
    title,content,sender_id,sender_name,sender_role,target_type,
    target_state,target_lga,recipient_count,read_count,created_at
  ) values (
    btrim(p_title),btrim(p_content),v_actor.user_id,
    coalesce(nullif(v_actor.full_name,''),nullif(v_actor.username,''),'WeHouse'),
    'admin',
    case when p_recipient_ids is null then 'all_users' else 'specific_user' end,
    v_actor.assigned_state,v_actor.assigned_lga,0,0,now()
  ) returning id into v_id;

  insert into public.announcement_recipients(
    announcement_id,user_id,read_status,delivered_at
  )
  select v_id,p.user_id,false,now()
  from public.profiles p
  where p.user_id<>v_actor.user_id
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
    and (
      (
        p_recipient_ids is null
        and public._admin_announcement_role_in_scope(p.user_id,v_roles)
      )
      or (
        p_recipient_ids is not null
        and p.user_id=any(p_recipient_ids)
        and (
          public.current_actor_in_scope(
            case
              when public.user_has_active_workspace(p.user_id,'staff')
                then (select w.scope_state from public.workspace_role_assignments w
                  where w.user_id=p.user_id and w.workspace_role='staff'
                    and w.status='active' and w.revoked_at is null limit 1)
              else p.state
            end,
            case
              when public.user_has_active_workspace(p.user_id,'staff')
                then (select case when w.scope_type='branch' then w.scope_lga else null end
                  from public.workspace_role_assignments w
                  where w.user_id=p.user_id and w.workspace_role='staff'
                    and w.status='active' and w.revoked_at is null limit 1)
              else coalesce(nullif(p.local_government,''),p.city)
            end
          )
          or public.current_actor_in_scope(
            p.state,coalesce(nullif(p.local_government,''),p.city)
          )
        )
      )
    );

  get diagnostics v_count=row_count;
  if v_count=0 then
    delete from public.announcements where id=v_id;
    raise exception 'No accounts in your coverage match the selected recipients';
  end if;

  update public.announcements
  set recipient_count=v_count
  where id=v_id;

  return jsonb_build_object('id',v_id,'recipient_count',v_count);
end
$$;

revoke all on function public._admin_announcement_role_in_scope(text,text[])
  from public,anon,authenticated;
grant execute on function public._admin_announcement_role_in_scope(text,text[])
  to service_role;
revoke all on function public.admin_count_branch_announcement_recipients(text[])
  from public,anon;
grant execute on function public.admin_count_branch_announcement_recipients(text[])
  to authenticated,service_role;
revoke all on function public.admin_send_branch_announcement(text,text,text[],text[])
  from public,anon;
grant execute on function public.admin_send_branch_announcement(text,text,text[],text[])
  to authenticated,service_role;

commit;
