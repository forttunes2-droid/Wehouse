-- Expose only the two access decisions to the pre-signup Auth service.
-- There is no user identity yet, so authorization is the explicit Auth-service
-- EXECUTE grant. Callers cannot choose keys or read settings values.
create or replace function public.get_signup_availability()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'registration_open',coalesce((select lower(btrim(value)) in ('true','1','yes','on')
      from public.platform_settings where key='registration_open' and is_active),true),
    'maintenance_mode',coalesce((select lower(btrim(value)) not in ('false','0','no','off')
      from public.platform_settings where key='maintenance_mode' and is_active),false)
  );
$$;
revoke all on function public.get_signup_availability() from public,anon,authenticated,service_role;
grant execute on function public.get_signup_availability() to supabase_auth_admin;

create or replace function public.require_reviewed_legal_signup(event jsonb)
returns jsonb language plpgsql set search_path = pg_catalog, public
as $$
declare v_documents jsonb; v_kind text; v_choice jsonb; v_access jsonb;
begin
  v_access := public.get_signup_availability();
  if (v_access->>'maintenance_mode')::boolean then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message',
      'WeHouse is currently under maintenance. Please check back later.'));
  end if;
  if not (v_access->>'registration_open')::boolean then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message',
      'New registrations are currently closed.'));
  end if;
  v_documents := public.get_current_legal_documents();
  if v_documents->>'privacy' is null or v_documents->>'terms' is null then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message',
      'Registration is unavailable until the Privacy Policy and Terms of Service are published.'));
  end if;
  foreach v_kind in array array['privacy','terms'] loop
    v_choice := event#>array['user','user_metadata','legal_review',v_kind];
    if v_choice->>'policy_version_id' is distinct from v_documents#>>array[v_kind,'policy_version_id']
      or v_choice->>'checksum' is distinct from v_documents#>>array[v_kind,'checksum'] then
      return jsonb_build_object('error',jsonb_build_object('http_code',403,'message',
        'Choose Create account and review the current Privacy Policy and Terms of Service first.'));
    end if;
  end loop;
  return '{}'::jsonb;
end;
$$;
revoke all on function public.require_reviewed_legal_signup(jsonb) from public,anon,authenticated;
grant execute on function public.require_reviewed_legal_signup(jsonb) to supabase_auth_admin;
grant execute on function public.get_current_legal_documents() to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
