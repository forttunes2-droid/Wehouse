begin;

-- A single authorized snapshot avoids partial dashboard failures becoming zeros.
-- People keep one Personal identity; marketplace and internal grants are additive.
create or replace function public.creator_get_dashboard_summary()
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if not public.current_actor_has_workspace('creator',null) then
    raise exception 'Active Creator workspace required';
  end if;
  return jsonb_build_object(
    'accounts',(select count(*) from public.profiles p where p.deleted_at is null and not coalesce(p.deleted,false)),
    'partners',(select count(*) from public.profiles p where public.user_has_active_workspace(p.user_id,'property_partner')),
    'workers',(select count(*) from public.profiles p where public.user_has_active_workspace(p.user_id,'worker')),
    'team',(select count(*) from public.profiles p where public.user_has_active_workspace(p.user_id,'admin') or public.user_has_active_workspace(p.user_id,'staff')),
    'apartments',(select count(*) from public.listings l where l.deleted_at is null and l.status='available'),
    'hotels',(select count(*) from public.hotels h where h.status='active'),
    'hotel_team',(select count(distinct m.member_user_id) from public.hotel_team_members m join public.profiles p on p.user_id=m.member_user_id
      where m.status='active' and m.revoked_at is null and p.deleted_at is null
        and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)),
    'pending_reviews',(select count(*) from public.profiles p where public.user_has_active_workspace(p.user_id,'worker') and p.worker_status='profile_under_review'),
    'inspections',(select count(*) from public.inspection_requests r where r.status in('pending','scheduled','in_progress')),
    'payouts',(select count(*) from public.withdrawals w where w.status in('awaiting_review','processing'))
  );
end;
$$;
revoke all on function public.creator_get_dashboard_summary() from public,anon;
grant execute on function public.creator_get_dashboard_summary() to authenticated,service_role;

create or replace function public.creator_get_people(p_workspace text default null)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare result jsonb;
begin
  if not public.current_actor_has_workspace('creator',null) then
    raise exception 'Active Creator workspace required';
  end if;
  if p_workspace is not null and p_workspace not in('worker','property_partner') then
    raise exception 'Unsupported workspace filter';
  end if;
  select coalesce(jsonb_agg(to_jsonb(p)-array[
    'auth_id','creator_auth_password','creator_auth_enabled','worker_gov_id_url',
    'maintenance_exempt','created_by','updated_by']::text[] order by p.created_at desc),'[]'::jsonb)
    into result
  from public.profiles p
  where p.deleted_at is null and not coalesce(p.deleted,false)
    and (p_workspace is null or public.user_has_active_workspace(p.user_id,p_workspace));
  return result;
end;
$$;
revoke all on function public.creator_get_people(text) from public,anon;
grant execute on function public.creator_get_people(text) to authenticated,service_role;

-- Preserve the existing reviewer authorization, while exposing the actual policy.
-- A missing/expired face check must not block free professional review when off.
create or replace function public.get_staff_worker_identity_check(p_worker_id text)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare evidence jsonb; required boolean; current_check boolean;
begin
  evidence:=public.get_review_account_identity_check(p_worker_id);
  required:=public.account_identity_checks_enabled();
  current_check:=public.account_identity_is_current(p_worker_id);
  return evidence || jsonb_build_object(
    'identity_required',required,
    'identity_current',current_check,
    'identity_gate_satisfied',not required or current_check
  );
end;
$$;
revoke all on function public.get_staff_worker_identity_check(text) from public,anon;
grant execute on function public.get_staff_worker_identity_check(text) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
