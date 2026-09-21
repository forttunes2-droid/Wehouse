create or replace function public.current_actor_can_review_account_identity(
  p_user_id text
)
returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog','public'
as $$
declare
  actor public.profiles;
  target public.profiles;
  pending_role text;
begin
  select * into actor
  from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and p.deleted_at is null
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  select * into target
  from public.profiles p
  where p.user_id=p_user_id
    and p.deleted_at is null
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  if actor.user_id is null
     or target.user_id is null
     or actor.user_id=target.user_id then
    return false;
  end if;

  select check_row.account_role
  into pending_role
  from public.worker_identity_checks check_row
  where check_row.worker_id=p_user_id
    and check_row.status='pending_review'
  limit 1;

  if pending_role not in ('worker','property_partner') then
    return false;
  end if;
  if pending_role='worker'
     and not public.user_has_active_workspace(target.user_id,'worker') then
    return false;
  end if;
  if pending_role='property_partner'
     and not public.user_has_active_workspace(target.user_id,'property_partner') then
    return false;
  end if;

  if public.current_actor_has_workspace('creator',null) then
    return true;
  end if;

  return exists(
    select 1
    from public.workspace_role_assignments w
    where w.user_id=actor.user_id
      and w.status='active'
      and w.revoked_at is null
      and (
        (
          w.workspace_role='admin'
          and public.current_actor_has_workspace('admin',null)
        )
        or (
          public.current_actor_has_workspace('staff',null)
          and (
            (pending_role='worker' and w.workspace_role='worker_operations')
            or (
              pending_role='property_partner'
              and w.workspace_role='property_operations'
            )
          )
        )
      )
      and (
        w.scope_type='global'
        or (
          w.scope_type in ('state','branch')
          and nullif(public.wehouse_state_key(w.scope_state),'') is not null
          and public.wehouse_state_key(w.scope_state)=public.wehouse_state_key(target.state)
          and (
            w.scope_type='state'
            or (
              w.scope_type='branch'
              and nullif(lower(btrim(w.scope_lga)),'') is not null
              and lower(btrim(w.scope_lga))=
                lower(btrim(coalesce(nullif(target.local_government,''),target.city)))
            )
          )
        )
      )
  );
end;
$$;

revoke all on function public.current_actor_can_review_account_identity(text)
  from public,anon;
grant execute on function public.current_actor_can_review_account_identity(text)
  to authenticated,service_role;
