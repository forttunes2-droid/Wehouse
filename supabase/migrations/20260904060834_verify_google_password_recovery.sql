create or replace function public.verify_google_password_recovery()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_auth_id text := (select auth.uid())::text;
  v_email text := lower(nullif(btrim((select auth.jwt() ->> 'email')), ''));
  v_google_verified boolean := false;
begin
  select exists(
    select 1
    from jsonb_array_elements(coalesce((select auth.jwt() -> 'amr'), '[]'::jsonb)) as method
    where method ->> 'method' = 'oauth'
  ) into v_google_verified;

  if v_auth_id is null or v_email is null or not v_google_verified then
    raise exception 'Confirm with Google is required';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.auth_id = v_auth_id
      and lower(p.email) = v_email
      and not coalesce(p.deleted, false)
  ) then
    raise exception 'Matching WeHouse account not found';
  end if;

  return jsonb_build_object('success', true, 'email', v_email);
end;
$$;

revoke all on function public.verify_google_password_recovery() from public;
revoke all on function public.verify_google_password_recovery() from anon;
grant execute on function public.verify_google_password_recovery() to authenticated;
grant execute on function public.verify_google_password_recovery() to service_role;
