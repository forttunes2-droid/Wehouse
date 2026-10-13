create or replace function public.creator_get_worker_refund_rules()
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog','public' as $$
declare v jsonb;
begin
  if not exists(select 1 from public.profiles
    where user_id=public.current_profile_user_id() and role='creator'
      and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)) then
    raise exception 'Creator access required';
  end if;
  select value into v from public.creator_policy_versions
  where policy_key='worker_refund_rules' and scope_type='global' and scope_key='*'
    and status='active' and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc limit 1;
  return coalesce(v,jsonb_build_object('before_start_refund_percent',100,'review_max_refund_percent',100));
end $$;
revoke all on function public.creator_get_worker_refund_rules() from public,anon;
grant execute on function public.creator_get_worker_refund_rules() to authenticated,service_role;
