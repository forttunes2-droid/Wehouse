begin;
-- The same active grants that open a workspace must govern private reviews.
-- Preserve self-review denial and narrow Admin/Staff to their assigned geography.
create or replace function public.current_actor_can_review_account_identity(p_user_id text)
returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare actor public.profiles; target public.profiles;
begin
  select * into actor from public.profiles p where p.auth_id=(select auth.uid())::text
    and p.deleted_at is null and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false) and not coalesce(p.banned,false) limit 1;
  select * into target from public.profiles p where p.user_id=p_user_id
    and p.deleted_at is null and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false) and not coalesce(p.banned,false) limit 1;
  if actor.user_id is null or target.user_id is null or actor.user_id=target.user_id then return false; end if;
  if not (public.user_has_active_workspace(target.user_id,'worker') or public.user_has_active_workspace(target.user_id,'property_partner')) then return false; end if;
  if public.current_actor_has_workspace('creator',null) then return true; end if;
  if not public.current_actor_in_scope(target.state,coalesce(nullif(target.local_government,''),target.city)) then return false; end if;
  if public.current_actor_has_workspace('admin',null) then return true; end if;
  return public.current_actor_has_workspace('staff',null) and (
    (public.user_has_active_workspace(target.user_id,'worker') and public.current_staff_has_permission('worker_operations'))
    or (public.user_has_active_workspace(target.user_id,'property_partner') and public.current_staff_has_permission('property_operations'))
  );
end;
$$;
revoke all on function public.current_actor_can_review_account_identity(text) from public,anon;
grant execute on function public.current_actor_can_review_account_identity(text) to authenticated,service_role;
commit;
