-- Reject an ended/revoked Auth session before any protected Data API operation,
-- including older owner-scoped endpoints which do not call a private-chat guard.
-- MFA remains attached to the same identity and follows its existing policy.
create or replace function public.wehouse_api_request_guard() returns void
language plpgsql stable security definer set search_path='' as $$
declare session_key uuid;
begin
 if current_setting('request.path',true)='/rpc/get_public_account_support' then return;end if;
 if coalesce(auth.jwt()->>'role',current_setting('request.jwt.claim.role',true),'')='authenticated' then
  begin session_key:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then session_key:=null;end;
  if auth.uid() is null or session_key is null or not public.auth_session_is_active(auth.uid(),session_key) then
   raise sqlstate 'PT401' using message='Sign in again to continue',
    detail='This WeHouse sign-in session is no longer active.',hint='session_ended';
  end if;
 end if;
 if current_setting('request.path',true)='/rpc/get_my_authentication_requirements' then return;end if;
 if not coalesce(public.request_mfa_satisfied(),false) then
  raise sqlstate 'PT403' using message='Authenticator verification required',
   detail='Complete two-factor verification before using WeHouse.',hint='mfa_required';
 end if;
end $$;
revoke all on function public.wehouse_api_request_guard() from public;
grant execute on function public.wehouse_api_request_guard() to anon,authenticated,service_role;
