-- Saving dates is not approval: revalidate commercial and capacity context at
-- the decision boundary, including later country/currency configuration changes.
create function private.experience_sessions_current(p_activity_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare activity public.experience_activities; currency_code text; reviewed_revision integer;
begin
 select * into activity from public.experience_activities where id=p_activity_id;
 if activity.id is null or activity.status not in ('submitted','approved')
  or cardinality(private.experience_activity_issues(activity.details))<>0 then return false;end if;
 select c.currency_code into currency_code from public.platform_countries c
  where c.country_code=activity.details->>'country_code' and c.enabled;
 if currency_code is null then return false;end if;
 reviewed_revision:=(case when activity.status='approved' then activity.approved_from_revision else activity.revision end)-1;
 return exists(select 1 from public.experience_sessions s where s.activity_id=activity.id and s.status='draft' and s.starts_at>now())
  and not exists(select 1 from public.experience_sessions s where s.activity_id=activity.id and s.status='draft' and s.starts_at>now()
   and (s.activity_revision is distinct from reviewed_revision
    or s.currency is distinct from currency_code
    or s.timezone is distinct from activity.details->>'timezone'
    or s.capacity not between 1 and (activity.details->>'max_group_size')::integer
    or s.ends_at is distinct from s.starts_at+make_interval(mins=>(activity.details->>'duration_minutes')::integer)
    or s.updated_at>activity.submitted_at));
end $$;
revoke all on function private.experience_sessions_current(uuid) from public,anon,authenticated;

create or replace function private.experience_approval_checks(p_activity_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'details',cardinality(private.experience_activity_issues(a.details))=0,
  'provider_access',public.user_has_active_workspace(a.host_user_id,'worker'),
  'identity',public.account_identity_is_current(a.host_user_id),
  'evidence',private.experience_evidence_current(a.id),
  'photos',exists(select 1 from public.experience_activity_photos p where p.activity_id=a.id and p.status='approved' and p.activity_details=a.details)
   and not exists(select 1 from public.experience_activity_photos p where p.activity_id=a.id and p.status<>'archived' and (p.status<>'approved' or p.activity_details<>a.details)),
  'sessions',private.experience_sessions_current(a.id)
 ) from public.experience_activities a where a.id=p_activity_id;
$$;
revoke all on function private.experience_approval_checks(uuid) from public,anon,authenticated;
