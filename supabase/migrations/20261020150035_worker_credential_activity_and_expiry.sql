begin;
-- Require the same trusted device registration used by the application shell.
do $upgrade$
declare definition text:=pg_get_functiondef('public.can_access_worker_credentials(text,boolean)'::regprocedure);
 needle text:='or exists(select 1 from public.user_sessions s where s.auth_id=auth.uid()::text and s.auth_session_id=session_id::text and s.trust_status<>''trusted'')';
begin
 if position(needle in definition)=0 then raise exception 'Inspect credential session checks before upgrading';end if;
 execute replace(definition,needle,'or not exists(select 1 from public.user_sessions s where s.auth_id=auth.uid()::text and s.auth_session_id=session_id::text and s.is_active and s.trust_status=''trusted'')');
end $upgrade$;

create function private.worker_credential_required_activity(p_worker_id text) returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles;v public.worker_verifications;e uuid;
begin
 select * into p from public.profiles where user_id=p_worker_id;
 select * into v from public.worker_verifications where worker_id=p_worker_id;
 if v.credential_requirements is null then return;end if;
 perform private.resolve_subject_activity('worker_credentials',p_worker_id,'worker.credentials.required','worker');
 if private.worker_credentials_current(p_worker_id) then return;end if;
 e:=private.upsert_activity_event('worker_credentials_required:'||p_worker_id||':'||v.credential_revision::text||':'||md5(private.worker_credential_context(p_worker_id)::text),
 'worker.credentials.required','worker_credentials',p_worker_id,null,'Service credentials need attention',
 'Review the current requirements or correction notes in Service Worker onboarding.','worker_verification',jsonb_build_object('worker_id',p_worker_id),now());
 perform private.add_activity_audience(e,p_worker_id,'worker','services',p.state,true);
end $$;
revoke all on function private.worker_credential_required_activity(text) from public,anon,authenticated;

create function private.worker_credential_requirements_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.credential_revision is distinct from old.credential_revision then perform private.worker_credential_required_activity(new.worker_id);end if;
 return new;
end $$;
revoke all on function private.worker_credential_requirements_activity() from public,anon,authenticated;
create trigger worker_credential_requirements_activity after update of credential_revision on public.worker_verifications for each row execute function private.worker_credential_requirements_activity();

create function private.worker_credential_document_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.profiles;e uuid;event_type text:='worker.credentials.'||new.requirement_code||'.submitted';
begin
 if new.status is not distinct from old.status then return new;end if;
 if not exists(select 1 from public.worker_verifications v where v.worker_id=new.worker_id and v.credential_revision=new.requirements_revision) then return new;end if;
 select * into p from public.profiles where user_id=new.worker_id;
 if new.status='submitted' then
  e:=private.upsert_activity_event('worker_credential_review:'||new.worker_id||':'||new.requirement_code,event_type,'worker_credentials',new.worker_id,new.worker_id,
   'Service credential needs review','Review the current privately submitted credential.','staff_dashboard',jsonb_build_object('worker_id',new.worker_id,'document_id',new.id),now());
  perform private.fanout_team_activity(e,'worker_operations',p.state,coalesce(nullif(p.local_government,''),p.city),true);
 elsif new.status in('approved','correction_required','rejected','abandoned') then
  perform private.resolve_subject_activity('worker_credentials',new.worker_id,event_type,'worker_operations');
  if new.status<>'abandoned' then
   e:=private.upsert_activity_event('worker_credential_decision:'||new.id::text||':'||new.status,'worker.credentials.'||new.status,'worker_credentials',new.worker_id,new.reviewed_by,
    case new.status when 'approved' then 'Service credential approved' when 'correction_required' then 'Service credential needs correction' else 'Service credential rejected' end,
    'Open Service Worker onboarding for the persistent review note.','worker_verification',jsonb_build_object('worker_id',new.worker_id,'document_id',new.id),now());
   perform private.add_activity_audience(e,new.worker_id,'worker','services',p.state,new.status<>'approved');
  end if;
 end if;
 if private.worker_credentials_current(new.worker_id) then perform private.resolve_subject_activity('worker_credentials',new.worker_id,'worker.credentials.required','worker');end if;
 return new;
end $$;
revoke all on function private.worker_credential_document_activity() from public,anon,authenticated;
create trigger worker_credential_document_activity after update of status on public.worker_credential_documents for each row execute function private.worker_credential_document_activity();

create function private.invalidate_worker_credential_context() returns trigger language plpgsql security definer set search_path='' as $$
declare worker_id text;
begin
 if tg_table_name='profiles' then worker_id:=new.user_id;
 elsif tg_op='DELETE' then worker_id:=old.worker_id;
 else worker_id:=new.worker_id;end if;
 if exists(select 1 from public.worker_verifications v where v.worker_id=worker_id and v.credential_requirements is not null and v.credential_context is distinct from private.worker_credential_context(worker_id)) then
  update public.profiles set worker_status='profile_under_review',worker_verified=false,available=false,updated_at=now() where user_id=worker_id;
  perform private.worker_credential_required_activity(worker_id);
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function private.invalidate_worker_credential_context() from public,anon,authenticated;
create trigger worker_credential_profile_context after update of worker_occupation,worker_skills,country,state on public.profiles for each row execute function private.invalidate_worker_credential_context();
create trigger worker_credential_coverage_context after insert or update or delete on public.worker_service_coverage for each row execute function private.invalidate_worker_credential_context();
create trigger worker_credential_category_context after update of service_category_id,service_subcategory_id on public.worker_verifications for each row execute function private.invalidate_worker_credential_context();

create function private.expire_worker_credentials() returns integer language plpgsql security definer set search_path='' as $$
declare p public.profiles;count_expired integer:=0;
begin
 for p in select profile.* from public.profiles profile where profile.worker_verified
  and not private.worker_credentials_current(profile.user_id)
  and exists(select 1 from public.worker_credential_documents d join public.worker_verifications v on v.worker_id=d.worker_id and v.credential_revision=d.requirements_revision
   where d.worker_id=profile.user_id and d.status='approved' and d.expires_at<=now()
    and not exists(select 1 from public.worker_credential_documents newer where newer.worker_id=d.worker_id and newer.requirements_revision=d.requirements_revision and newer.requirement_code=d.requirement_code and newer.version>d.version and newer.status<>'abandoned'))
  order by profile.user_id for update skip locked limit 100 loop
  update public.profiles set worker_status='profile_under_review',worker_verified=false,available=false,updated_at=now() where user_id=p.user_id;
  perform private.worker_credential_required_activity(p.user_id);count_expired:=count_expired+1;
 end loop;
 return count_expired;
end $$;
revoke all on function private.expire_worker_credentials() from public,anon,authenticated;
grant execute on function private.expire_worker_credentials() to service_role;
create index worker_credentials_expiry_idx on public.worker_credential_documents(expires_at,worker_id) where status='approved' and expires_at is not null;
select cron.schedule('wehouse-worker-credential-expiry','* * * * *','select private.expire_worker_credentials()');
commit;
