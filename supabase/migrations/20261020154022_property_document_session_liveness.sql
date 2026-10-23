-- Private evidence must honour the canonical Auth and trusted-device boundary.
create or replace function public._property_document_session_active()
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare session_key uuid;
begin
 begin session_key:=nullif(auth.jwt()->>'session_id','')::uuid;
 exception when invalid_text_representation then return false; end;
 return session_key is not null
   and public.auth_session_is_active(auth.uid(),session_key)
   and exists(select 1 from public.user_sessions d
     where d.auth_id=auth.uid()::text and d.auth_session_id=session_key::text
       and d.is_active and d.trust_status='trusted');
end $$;
revoke all on function public._property_document_session_active() from public,anon,authenticated;
