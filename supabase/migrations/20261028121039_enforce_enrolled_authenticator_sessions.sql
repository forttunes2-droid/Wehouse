-- One authenticator belongs to the identity, not to each workspace.
create function private.identity_requires_mfa(p_auth_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.workspace_role_assignments g on g.user_id=p.user_id
  where p.auth_id=p_auth_id::text and g.workspace_role in('creator','admin','staff')
   and g.status='active' and g.revoked_at is null and not coalesce(p.deleted,false));
$$;
revoke all on function private.identity_requires_mfa(uuid) from public,anon,authenticated,service_role;

create function public.request_mfa_satisfied() returns boolean
language sql stable security definer set search_path='' as $$
 select case when coalesce(auth.jwt()->>'role',current_setting('request.jwt.claim.role',true),'')<>'authenticated' then true
  when auth.uid() is null then false
  else case when private.identity_requires_mfa(auth.uid()) or exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified' and f.factor_type='totp')
   then auth.jwt()->>'aal'='aal2' and exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified' and f.factor_type='totp')
   else true end end;
$$;
revoke all on function public.request_mfa_satisfied() from public;
grant execute on function public.request_mfa_satisfied() to anon,authenticated,service_role;

-- This deliberately limited bootstrap read exposes only the caller's security
-- requirements. Auth's enrollment/challenge APIs do not use the Data API.
create function public.get_my_authentication_requirements() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();session_key uuid;enrolled boolean;required boolean;
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 begin session_key:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then raise exception 'Live sign-in session required' using errcode='42501';end;
 if session_key is null or not public.auth_session_is_active(actor,session_key) then raise exception 'Live sign-in session required' using errcode='42501';end if;
 enrolled:=exists(select 1 from auth.mfa_factors where user_id=actor and status='verified' and factor_type='totp');
 required:=private.identity_requires_mfa(actor);
 return jsonb_build_object('auth_id',actor,'required',required,'enrolled',enrolled,
  'stage',case when required and not enrolled then 'setup' when enrolled and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then 'challenge' else 'ready' end);
end $$;
revoke all on function public.get_my_authentication_requirements() from public,anon,service_role;
grant execute on function public.get_my_authentication_requirements() to authenticated;

create function public.wehouse_api_request_guard() returns void
language plpgsql stable set search_path='' as $$
begin
 -- Only the caller's bootstrap and the already-public support contact are exempt.
 if current_setting('request.path',true) in('/rpc/get_my_authentication_requirements','/rpc/get_public_account_support') then return;end if;
 if not coalesce(public.request_mfa_satisfied(),false) then
  raise sqlstate 'PT403' using message='Authenticator verification required',detail='Complete two-factor verification before using WeHouse.',hint='mfa_required';
 end if;
end $$;
revoke all on function public.wehouse_api_request_guard() from public;
grant execute on function public.wehouse_api_request_guard() to anon,authenticated,service_role;

-- Do not silently overwrite another project's request hook.
do $request_hook$declare prior text;begin
 select substr(setting,length('pgrst.db_pre_request=')+1) into prior from pg_roles r
  cross join lateral unnest(coalesce(r.rolconfig,'{}')) setting
  where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%';
 if nullif(prior,'') is not null and prior<>'public.wehouse_api_request_guard' then raise exception 'Review the existing API pre-request hook before adding MFA enforcement';end if;
 alter role authenticator set pgrst.db_pre_request='public.wehouse_api_request_guard';
end $request_hook$;
notify pgrst,'reload config';

-- The pre-request hook covers Data API calls. RLS also covers direct Storage
-- and Realtime use. InitPlans evaluate the identity check once per statement.
do $policies$declare t record;begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind in('r','p') and c.relrowsecurity and (n.nspname='public' or (n.nspname='storage' and c.relname='objects') or (n.nspname='realtime' and c.relname='messages')) loop
  execute format('create policy wehouse_mfa_boundary on %I.%I as restrictive for all to authenticated using((select public.request_mfa_satisfied())) with check((select public.request_mfa_satisfied()))',t.nspname,t.relname);
 end loop;
end $policies$;

-- Refresh the fail-closed upload-authority projection after adding the
-- restrictive MFA policy. The new projection includes that policy; it is not exempt.
do $authority$
declare permissive text; restrictive text; signature text; definition text;
begin
 -- Match the empty search path used when the projection checks its signature.
 perform pg_catalog.set_config('search_path','',true);
 select string_agg('('||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid)||')',' or ' order by polname)
 filter(where polpermissive),
 string_agg('('||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid)||')',' and ' order by polname)
 filter(where not polpermissive),
 md5(string_agg(polname||':'||polpermissive::text||':'||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid),E'\n' order by polname))
 into permissive,restrictive,signature
 from pg_catalog.pg_policy where polrelid='storage.objects'::regclass and polcmd in('a','*')
 and polname<>'wehouse_upload_budget_insert' and (polroles @> array[0::oid] or polroles @> array['authenticated'::regrole::oid]);
 if permissive is null then raise exception 'Storage upload authority is missing';end if;
 definition:=pg_catalog.format($fn$
 create or replace function private.can_reserve_storage_upload(p_bucket text,p_name text)
 returns boolean language plpgsql stable security definer set search_path='' as $body$
 declare current_signature text; permitted boolean;
 begin
 select md5(string_agg(polname||':'||polpermissive::text||':'||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid),E'\n' order by polname))
 into current_signature from pg_catalog.pg_policy
 where polrelid='storage.objects'::regclass and polcmd in('a','*') and polname<>'wehouse_upload_budget_insert'
 and (polroles @> array[0::oid] or polroles @> array['authenticated'::regrole::oid]);
 if current_signature is distinct from %L then raise exception 'Upload permissions need a configuration refresh. Contact support';end if;
 select coalesce(((%s) and (%s)),false) into permitted from
 (select p_bucket as bucket_id,p_name as name,auth.uid()::text as owner_id) objects;
 return permitted;
 end $body$;
 $fn$,signature,permissive,coalesce(restrictive,'true'));
 execute definition;
end $authority$;
revoke all on function private.can_reserve_storage_upload(text,text) from public,anon,authenticated;

-- Service-key Edge requests have already verified the caller's bearer with
-- Auth. They submit its verified AAL, never a browser-supplied role selection.
create function public.auth_session_security_satisfied(p_auth_id uuid,p_session_id uuid,p_aal text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare enrolled boolean;
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Service only' using errcode='42501';end if;
 if not public.auth_session_is_active(p_auth_id,p_session_id) then return false;end if;
 enrolled:=exists(select 1 from auth.mfa_factors where user_id=p_auth_id and status='verified' and factor_type='totp');
 if enrolled or private.identity_requires_mfa(p_auth_id) then return enrolled and p_aal='aal2';end if;
 return true;
end $$;
revoke all on function public.auth_session_security_satisfied(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.auth_session_security_satisfied(uuid,uuid,text) to service_role;
