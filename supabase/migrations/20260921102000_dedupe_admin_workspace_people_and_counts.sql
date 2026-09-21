begin;

create or replace function public.admin_get_my_branch_profiles(p_role text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_result jsonb;
begin
  v_actor:=public._admin_dashboard_actor();

  if p_role is not null and p_role not in(
    'user','worker','property_partner','staff','admin'
  ) then
    raise exception 'Invalid role filter';
  end if;

  select coalesce(
    jsonb_agg(
      to_jsonb(p)-array[
        'auth_id','creator_auth_password','creator_auth_enabled',
        'worker_gov_id_url','maintenance_exempt','created_by','updated_by'
      ]::text[]
      order by p.created_at desc
    ),
    '[]'::jsonb
  )
  into v_result
  from public.profiles p
  where p.deleted_at is null
    and not coalesce(p.deleted,false)
    and p.role<>'creator'
    and (
      v_actor.role='creator'
      or public.current_actor_in_scope(
        case
          when public.user_has_active_workspace(p.user_id,'staff')
            or public.user_has_active_workspace(p.user_id,'admin')
          then p.assigned_state
          else p.state
        end,
        case
          when public.user_has_active_workspace(p.user_id,'staff')
            or public.user_has_active_workspace(p.user_id,'admin')
          then p.assigned_lga
          else coalesce(nullif(p.local_government,''),p.city)
        end
      )
    )
    and (
      p_role is null
      or (p_role='worker' and public.user_has_active_workspace(p.user_id,'worker'))
      or (p_role='property_partner' and public.user_has_active_workspace(p.user_id,'property_partner'))
      or (p_role='staff' and public.user_has_active_workspace(p.user_id,'staff'))
      or (p_role='admin' and public.user_has_active_workspace(p.user_id,'admin'))
      or (
        p_role='user'
        and not public.user_has_active_workspace(p.user_id,'worker')
        and not public.user_has_active_workspace(p.user_id,'property_partner')
        and not public.user_has_active_workspace(p.user_id,'staff')
        and not public.user_has_active_workspace(p.user_id,'admin')
        and not public.user_has_active_workspace(p.user_id,'creator')
      )
    );

  return v_result;
end
$$;

create or replace function public.admin_get_my_branch_stats()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
begin
  v_actor:=public._admin_dashboard_actor();

  return jsonb_build_object(
    'users',(
      select count(distinct p.user_id)
      from public.profiles p
      where p.deleted_at is null
        and not coalesce(p.deleted,false)
        and not public.user_has_active_workspace(p.user_id,'worker')
        and not public.user_has_active_workspace(p.user_id,'property_partner')
        and not public.user_has_active_workspace(p.user_id,'staff')
        and not public.user_has_active_workspace(p.user_id,'admin')
        and not public.user_has_active_workspace(p.user_id,'creator')
        and (
          v_actor.role='creator'
          or public.current_actor_in_scope(
            p.state,coalesce(nullif(p.local_government,''),p.city)
          )
        )
    ),
    'workers',(
      select count(distinct p.user_id)
      from public.profiles p
      where public.user_has_active_workspace(p.user_id,'worker')
        and p.deleted_at is null
        and not coalesce(p.deleted,false)
        and (
          v_actor.role='creator'
          or public.current_actor_in_scope(
            p.state,coalesce(nullif(p.local_government,''),p.city)
          )
        )
    ),
    'partners',(
      select count(distinct p.user_id)
      from public.profiles p
      where public.user_has_active_workspace(p.user_id,'property_partner')
        and p.deleted_at is null
        and not coalesce(p.deleted,false)
        and (
          v_actor.role='creator'
          or public.current_actor_in_scope(
            p.state,coalesce(nullif(p.local_government,''),p.city)
          )
        )
    ),
    'staff',(
      select count(distinct p.user_id)
      from public.profiles p
      where public.user_has_active_workspace(p.user_id,'staff')
        and p.deleted_at is null
        and not coalesce(p.deleted,false)
        and (
          v_actor.role='creator'
          or public.current_actor_in_scope(p.assigned_state,p.assigned_lga)
        )
    ),
    'admins',(
      select count(distinct p.user_id)
      from public.profiles p
      where public.user_has_active_workspace(p.user_id,'admin')
        and p.deleted_at is null
        and not coalesce(p.deleted,false)
        and (
          v_actor.role='creator'
          or public.current_actor_in_scope(p.assigned_state,p.assigned_lga)
        )
    ),
    'listings',(
      select count(distinct l.id)
      from public.listings l
      where l.deleted_at is null
        and l.status='available'
        and (
          v_actor.role='creator'
          or public.current_actor_in_scope(
            l.state,coalesce(nullif(l.local_government,''),l.city)
          )
        )
    ),
    'pending_verifications',(
      select count(distinct p.user_id)
      from public.profiles p
      where public.user_has_active_workspace(p.user_id,'worker')
        and p.worker_status in('verification_paid','profile_under_review')
        and p.deleted_at is null
        and not coalesce(p.deleted,false)
        and (
          v_actor.role='creator'
          or public.current_actor_in_scope(
            p.state,coalesce(nullif(p.local_government,''),p.city)
          )
        )
    )
  );
end
$$;

commit;
