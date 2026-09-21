\set ON_ERROR_STOP on

-- Browser-callable SECURITY DEFINER functions can bypass ordinary RLS, so
-- every write-capable endpoint needs an explicit caller/ownership/authority
-- path. The password-recovery starter is intentionally public: it returns an
-- opaque constant-shape attempt and is rate-limited without exposing account
-- existence.
do $$
declare
  bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into bad
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.prosecdef
    and has_function_privilege('authenticated',p.oid,'EXECUTE')
    and pg_get_functiondef(p.oid) ~* '(insert|update|delete|truncate)[[:space:]]+'
    and p.oid::regprocedure::text <> 'begin_identity_provider_password_recovery(text,text)'
    and pg_get_functiondef(p.oid) !~* (
      'auth\\.uid|current_profile_user_id|current_actor|_current_|is_current_|' ||
      'creator_has_|user_has_active_workspace|current_staff_has_permission|' ||
      'hotel_actor_has_capability|verify_|actor_can_|_admin_dashboard_actor'
    );

  if bad is not null then
    raise exception 'Write-capable SECURITY DEFINER RPC lacks visible authorization path: %',bad;
  end if;
end
$$;

do $$
declare
  bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into bad
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.prosecdef
    and has_function_privilege('anon',p.oid,'EXECUTE')
    and pg_get_functiondef(p.oid) ~* '(insert|update|delete|truncate)[[:space:]]+'
    and p.oid::regprocedure::text <> 'begin_identity_provider_password_recovery(text,text)';

  if bad is not null then
    raise exception 'Anonymous write-capable SECURITY DEFINER RPC is not allowlisted: %',bad;
  end if;
end
$$;

-- The public recovery starter must retain anti-enumeration and rate limiting.
do $$
declare d text:=pg_get_functiondef('public.begin_identity_provider_password_recovery(text,text)'::regprocedure);
begin
  if d !~* 'same shape'
     or d !~* '15 minutes'
     or d !~* '>=5'
     or d !~* 'return v_attempt_id' then
    raise exception 'Public recovery starter lost anti-enumeration/rate-limit guards';
  end if;
end
$$;
