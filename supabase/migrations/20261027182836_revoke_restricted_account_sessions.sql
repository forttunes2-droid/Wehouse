-- Restriction is account-wide. End current devices without deleting bookings,
-- protected funds, settlement receipts or moderation evidence.
create function private.end_restricted_account_sessions() returns trigger
language plpgsql security definer set search_path='' as $$
declare devices integer;auth_count integer:=0;
begin
 if (coalesce(new.suspended,false) or coalesce(new.banned,false) or coalesce(new.deleted,false))
  and (new.suspended,new.banned,new.deleted) is distinct from (old.suspended,old.banned,old.deleted) then
  update public.user_sessions set is_active=false where user_id=new.user_id and is_active;
  get diagnostics devices=row_count;
  if new.auth_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
   delete from auth.sessions where user_id=new.auth_id::uuid;
   get diagnostics auth_count=row_count;
  end if;
  insert into public.audit_logs(action,target_type,target_id,admin_id,details)
  values('RESTRICTED_ACCOUNT_SESSIONS_ENDED','profiles',new.user_id,coalesce(new.updated_by,public.current_profile_user_id()),
   jsonb_build_object('devices_ended',devices,'auth_sessions_ended',auth_count,'suspended',new.suspended,'banned',new.banned,'deleted',new.deleted)::text);
 end if;return new;
end $$;
revoke all on function private.end_restricted_account_sessions() from public,anon,authenticated,service_role;
create trigger end_restricted_account_sessions after update of suspended,banned,deleted on public.profiles
 for each row execute function private.end_restricted_account_sessions();

do $existing_restrictions$
declare devices integer;auth_count integer;
begin
 update public.user_sessions s set is_active=false from public.profiles p
  where s.user_id=p.user_id and s.is_active and (coalesce(p.suspended,false) or coalesce(p.banned,false) or coalesce(p.deleted,false));
 get diagnostics devices=row_count;
 delete from auth.sessions s using public.profiles p where
  s.user_id=case when p.auth_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then p.auth_id::uuid else null end
  and (coalesce(p.suspended,false) or coalesce(p.banned,false) or coalesce(p.deleted,false));
 get diagnostics auth_count=row_count;
 if devices>0 or auth_count>0 then
  insert into public.audit_logs(action,target_type,target_id,details) values('RESTRICTED_ACCOUNT_SESSION_BACKFILL','account_sessions','restricted_accounts',jsonb_build_object('devices_ended',devices,'auth_sessions_ended',auth_count)::text);
 end if;
end $existing_restrictions$;

do $guards$
declare definition text;needle text;
begin
 definition:=replace(pg_get_functiondef('public._set_account_suspension(text,text,boolean,text)'::regprocedure),chr(13),'');
 needle:=$old$if v_target.role='creator' then$old$;
 if strpos(definition,needle)=0 then raise exception 'Inspect account restriction authority before protecting Creator workspace';end if;
 definition:=replace(definition,needle,$new$if v_target.role='creator' or public.user_has_active_workspace(v_target.user_id,'creator') then$new$);
 needle:=$old$if p_suspended then$old$;
 if strpos(definition,needle)=0 then raise exception 'Inspect suspension validation';end if;
 definition:=replace(definition,needle,$new$if p_suspended is null then raise exception 'Choose suspend or restore';end if;
 if p_suspended and (length(btrim(coalesce(p_reason,''))) not between 1 and 2000) then raise exception 'A suspension reason is required';end if;
 if p_suspended then$new$);
 execute definition;
 definition:=replace(pg_get_functiondef('public.admin_ban_user(text,text)'::regprocedure),chr(13),'');
 needle:=$old$or v_target.role='creator' then$old$;
 if strpos(definition,needle)=0 then raise exception 'Inspect ban authority before protecting Creator workspace';end if;
 definition:=replace(definition,needle,$new$or v_target.role='creator' or public.user_has_active_workspace(v_target.user_id,'creator') then$new$);
 needle:=$old$update public.profiles set banned=true$old$;
 if strpos(definition,needle)=0 then raise exception 'Inspect ban reason validation';end if;
 execute replace(definition,needle,$new$if length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'A ban reason is required';end if;
  update public.profiles set banned=true$new$);
end $guards$;

-- Preserve the reviewed geographic/sanction/audit logic behind a private core.
-- Old clients must refresh; they cannot bypass the expected-version guard.
alter function public.admin_security_case_decision(uuid,text,text) set schema private;
alter function private.admin_security_case_decision(uuid,text,text) rename to admin_security_case_decision_core;
revoke all on function private.admin_security_case_decision_core(uuid,text,text) from public,anon,authenticated,service_role;
create function public.admin_security_case_decision(uuid,text,text) returns jsonb language plpgsql set search_path='' as $$
begin raise exception 'Refresh the security case before recording a decision';end $$;
revoke all on function public.admin_security_case_decision(uuid,text,text) from public,anon,service_role;
grant execute on function public.admin_security_case_decision(uuid,text,text) to authenticated;

create function public.admin_security_case_decision_v2(p_case_id uuid,p_decision text,p_note text,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles;c public.operational_cases;
begin
 actor:=public._admin_dashboard_actor();
 if actor.role<>'admin' or not public._property_document_session_active() then raise exception 'Trusted active Branch Admin required' using errcode='42501';end if;
 if p_decision is null or p_decision not in('suspend','ban','no_action') or length(btrim(coalesce(p_note,''))) not between 1 and 2000 then raise exception 'Choose a decision and record its reason';end if;
 select * into c from public.operational_cases where operational_case_id=p_case_id for update;
 if c.operational_case_id is null or c.owning_domain<>'security_operations' then raise exception 'Security case unavailable';end if;
 if c.updated_at is distinct from p_expected_updated_at or p_expected_updated_at is null then raise exception 'Security case changed. Refresh before deciding';end if;
 if c.status is distinct from 'decision_ready' then raise exception 'Security investigation must be escalated before a decision';end if;
 return private.admin_security_case_decision_core(p_case_id,p_decision,p_note);
end $$;
revoke all on function public.admin_security_case_decision_v2(uuid,text,text,timestamptz) from public,anon,service_role;
grant execute on function public.admin_security_case_decision_v2(uuid,text,text,timestamptz) to authenticated;

-- Publicly configured contact only: no account lookup, sanction detail or keys.
create function public.get_public_account_support() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('email',(select btrim(value) from public.platform_settings where key='support_email'
  and coalesce(is_active,true) and length(btrim(value))<=320
  and btrim(value) ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z0-9-]{2,}$' limit 1));
$$;
revoke all on function public.get_public_account_support() from public,service_role;
grant execute on function public.get_public_account_support() to anon,authenticated;
