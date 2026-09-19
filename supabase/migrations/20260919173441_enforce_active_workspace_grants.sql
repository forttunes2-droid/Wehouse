begin;

-- Existing active assignments are the authority. Never manufacture a grant
-- from profiles.role here: doing so would re-enable intentionally revoked access.
create or replace function public.user_has_active_workspace(p_user_id text, p_workspace_role text)
returns boolean language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1 from public.profiles p
    join public.workspace_role_assignments w on w.user_id=p.user_id
    where p.user_id=p_user_id and w.workspace_role=p_workspace_role
      and w.status='active'
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
  );
$$;

create or replace function public.current_actor_has_workspace(p_workspace text, p_state text default null)
returns boolean language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1 from public.profiles p
    join public.workspace_role_assignments w on w.user_id=p.user_id
    where p.auth_id=(select auth.uid())::text
      and w.workspace_role=p_workspace and w.status='active'
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and (
        p_state is null or w.scope_type='global'
        or (
          nullif(public.wehouse_state_key(w.scope_state),'') is not null
          and public.wehouse_state_key(w.scope_state)=public.wehouse_state_key(p_state)
        )
      )
  );
$$;

-- This helper receives both location fields. Honor the declared branch/state
-- grant, including its revocation, instead of widening every branch to a State.
create or replace function public.current_actor_in_scope(p_state text, p_lga text)
returns boolean language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1 from public.profiles p
    join public.workspace_role_assignments w on w.user_id=p.user_id
    where p.auth_id=(select auth.uid())::text and w.status='active'
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and (
        (w.workspace_role='creator' and w.scope_type='global')
        or (
          w.workspace_role in ('admin','staff')
          and (
            w.scope_type='global'
            or (
              w.scope_type in ('state','branch')
              and nullif(public.wehouse_state_key(w.scope_state),'') is not null
              and public.wehouse_state_key(w.scope_state)=public.wehouse_state_key(p_state)
              and (
                w.scope_type='state'
                or (
                  nullif(lower(btrim(w.scope_lga)),'') is not null
                  and lower(btrim(w.scope_lga))=lower(btrim(p_lga))
                )
              )
            )
          )
        )
      )
  );
$$;

revoke all on function public.user_has_active_workspace(text,text),
  public.current_actor_has_workspace(text,text),
  public.current_actor_in_scope(text,text) from public,anon;
grant execute on function public.user_has_active_workspace(text,text),
  public.current_actor_has_workspace(text,text),
  public.current_actor_in_scope(text,text) to authenticated,service_role;
commit;
