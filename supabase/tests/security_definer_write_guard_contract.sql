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
  -- Some endpoints delegate their caller check to a canonical helper. Accept
  -- only these reviewed paths, after checking the helper's own guard and ACL.
  -- A function-name exception alone must never waive the authorization audit.
  with reviewed_helpers(signature,call_name,required_checks) as (values
   ('private.experience_host_actor()','private.experience_host_actor',
    array['current_profile_user_id','_property_document_session_active','user_has_active_workspace','raise exception']),
   ('private.experience_customer_actor()','private.experience_customer_actor',
    array['current_profile_user_id','_property_document_session_active','deleted','suspended','banned','raise exception']),
   ('private.experience_creator_actor()','private.experience_creator_actor',
    array['current_profile_user_id','_property_document_session_active','current_actor_has_workspace','creator_has_elevation','raise exception']),
   ('public._property_document_reviewer(uuid)','public._property_document_reviewer',
    array['_current_team_actor','can_access_property_documents','r.owner_id=a.user_id','raise exception']),
   ('public._partner_operating_cost_actor()','public._partner_operating_cost_actor',
    array['auth.uid','current_actor_has_workspace','partner_pro_is_active','raise exception']),
   ('public._property_arrival_actor(text,text)','public._property_arrival_actor',
    array['current_profile_user_id','_property_document_session_active','partner_pro_owns_asset','raise exception']),
   ('private.private_call_actor()','private.private_call_actor',
    array['_current_comm_actor','_property_document_session_active','user_has_active_workspace','raise exception'])
  ), validated_helpers as (
   select h.call_name from reviewed_helpers h
   join pg_proc guard on guard.oid=to_regprocedure(h.signature)
   where guard.prosecdef
    and not has_function_privilege('anon',guard.oid,'EXECUTE')
    and not has_function_privilege('authenticated',guard.oid,'EXECUTE')
    and not exists(select 1 from unnest(h.required_checks) needle
     where position(needle in lower(pg_get_functiondef(guard.oid)))=0)
  )
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into bad
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.prosecdef
    and has_function_privilege('authenticated',p.oid,'EXECUTE')
    and pg_get_functiondef(p.oid) ~* '(insert|update|delete|truncate)[[:space:]]+'
    and p.oid::regprocedure::text <> 'begin_identity_provider_password_recovery(text,text)'
    and position('auth.uid' in lower(pg_get_functiondef(p.oid)))=0
    and position('auth.jwt' in lower(pg_get_functiondef(p.oid)))=0
    and position('current_profile_user_id' in lower(pg_get_functiondef(p.oid)))=0
    and position('current_actor' in lower(pg_get_functiondef(p.oid)))=0
    and position('_current_' in lower(pg_get_functiondef(p.oid)))=0
    and position('is_current_' in lower(pg_get_functiondef(p.oid)))=0
    and position('creator_has_' in lower(pg_get_functiondef(p.oid)))=0
    and position('user_has_active_workspace' in lower(pg_get_functiondef(p.oid)))=0
    and position('current_staff_has_permission' in lower(pg_get_functiondef(p.oid)))=0
    and position('hotel_actor_has_capability' in lower(pg_get_functiondef(p.oid)))=0
    and position('verify_' in lower(pg_get_functiondef(p.oid)))=0
    and position('actor_can_' in lower(pg_get_functiondef(p.oid)))=0
    and position('_admin_dashboard_actor' in lower(pg_get_functiondef(p.oid)))=0
    and position('can_access_' in lower(pg_get_functiondef(p.oid)))=0
    and position('can_current_actor' in lower(pg_get_functiondef(p.oid)))=0
    and position('require_' in lower(pg_get_functiondef(p.oid)))=0
    and not exists(select 1 from validated_helpers h
      where position(h.call_name||'(' in lower(pg_get_functiondef(p.oid)))>0);

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

-- Authorization and money ledgers are server-owned. A compromised browser
-- session must not gain a direct table mutation path around the RPC guards.
do $$
declare
  relation_name text;
  browser_role text;
  privilege_name text;
  protected_relations text[]:=array[
    'workspace_role_assignments',
    'staff_permissions',
    'activity_events',
    'activity_event_audiences',
    'wallets',
    'withdrawals'
  ];
begin
  foreach relation_name in array protected_relations loop
    foreach browser_role in array array['anon','authenticated'] loop
      foreach privilege_name in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
        if has_table_privilege(
          browser_role,
          format('public.%I',relation_name),
          privilege_name
        ) then
          raise exception
            'Browser role % retains direct % privilege on protected table %',
            browser_role,privilege_name,relation_name;
        end if;
      end loop;
    end loop;
  end loop;

  if not has_table_privilege(
    'authenticated','public.staff_permissions','SELECT'
  ) then
    raise exception 'Authenticated Staff permission reads were accidentally removed';
  end if;
end
$$;
