-- Restrictions are additive to grants, never replacements for identity/evidence.
create table private.workspace_restrictions (
 user_id text not null references public.profiles(user_id),
 workspace text not null check(workspace in('account','personal','worker','worker_profile','property_partner','hotel','hosting','staff','admin')),
 version uuid not null default gen_random_uuid(),
 restricted boolean not null, public_reason text not null,
 changed_by text, changed_at timestamptz not null default now(),
 primary key(user_id,workspace)
);
create table private.workspace_appeals (
 case_id uuid primary key references public.operational_cases(operational_case_id),
 user_id text not null references public.profiles(user_id),
 workspace text not null, restriction_version uuid not null,
 explanation text not null, decision text, public_decision text,
 decided_at timestamptz,
 unique(user_id,workspace,restriction_version)
);
create table private.recovery_sessions (
 token_hash bytea primary key, user_id text not null references public.profiles(user_id),
 expires_at timestamptz not null, created_at timestamptz not null default now()
);
alter table private.workspace_restrictions enable row level security;
alter table private.workspace_appeals enable row level security;
alter table private.recovery_sessions enable row level security;
revoke all on private.workspace_restrictions,private.workspace_appeals,private.recovery_sessions from public,anon,authenticated,service_role;
create index workspace_appeal_queue on private.workspace_appeals(decided_at,case_id);
create index recovery_session_expiry on private.recovery_sessions(expires_at);

create function public.workspace_access_allowed(p_user_id text,p_workspace text) returns boolean
language sql stable security definer set search_path='' as $$
 select p_user_id is not null and not exists(select 1 from private.workspace_restrictions r
  where r.user_id=p_user_id and r.restricted and r.workspace in('account',p_workspace));
$$;
revoke all on function public.workspace_access_allowed(text,text) from public,anon;
grant execute on function public.workspace_access_allowed(text,text) to authenticated,service_role;

-- Keep all existing grant, geographic and resource checks behind the new gate.
-- Preserve the public OID: existing RLS policies must call the new gate.
do $copy$begin
 execute replace(pg_get_functiondef('public.user_has_active_workspace(text,text)'::regprocedure),'FUNCTION public.user_has_active_workspace(','FUNCTION private.unrestricted_workspace_grant(');
end $copy$;
revoke all on function private.unrestricted_workspace_grant(text,text) from public,anon,authenticated,service_role;
create or replace function public.user_has_active_workspace(p_user_id text,p_workspace_role text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.workspace_access_allowed(p_user_id,p_workspace_role)
  and private.unrestricted_workspace_grant(p_user_id,p_workspace_role);
$$;
revoke all on function public.user_has_active_workspace(text,text) from public,anon;
grant execute on function public.user_has_active_workspace(text,text) to authenticated,service_role;

-- Preserve the public OID: existing RLS policies must call the new gate.
do $copy$begin
 execute replace(pg_get_functiondef('public.current_actor_has_workspace(text,text)'::regprocedure),'FUNCTION public.current_actor_has_workspace(','FUNCTION private.unrestricted_actor_workspace(');
end $copy$;
revoke all on function private.unrestricted_actor_workspace(text,text) from public,anon,authenticated,service_role;
create or replace function public.current_actor_has_workspace(p_workspace text,p_state text default null) returns boolean
language sql stable security definer set search_path='' as $$
 select public.workspace_access_allowed(public.current_profile_user_id(),p_workspace)
  and private.unrestricted_actor_workspace(p_workspace,p_state);
$$;
revoke all on function public.current_actor_has_workspace(text,text) from public,anon;
grant execute on function public.current_actor_has_workspace(text,text) to authenticated,service_role;

-- Preserve the public OID: existing RLS policies must call the new gate.
do $copy$begin
 execute replace(pg_get_functiondef('public.get_my_workspace_access()'::regprocedure),'FUNCTION public.get_my_workspace_access(','FUNCTION private.unrestricted_workspace_access(');
end $copy$;
revoke all on function private.unrestricted_workspace_access() from public,anon,authenticated,service_role;
create or replace function public.get_my_workspace_access() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; who text;
begin
 result:=private.unrestricted_workspace_access();who:=result#>>'{identity,user_id}';
 if who is null then return null;end if;
 return result||jsonb_build_object('personal_workspace',
  coalesce((result->>'personal_workspace')::boolean,false) and public.workspace_access_allowed(who,'personal'),
  'privileged_workspaces',(select coalesce(jsonb_agg(item),'[]'::jsonb)
   from jsonb_array_elements(result->'privileged_workspaces') item
   where public.workspace_access_allowed(who,item->>'role')));
end $$;
revoke all on function public.get_my_workspace_access() from public,anon;
grant execute on function public.get_my_workspace_access() to authenticated,service_role;

-- Existing global controls retain their explicit all-workspace scope.
create function private.record_account_restriction() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (new.suspended,new.banned) is distinct from (old.suspended,old.banned) then
  insert into private.workspace_restrictions(user_id,workspace,restricted,public_reason,changed_by)
  values(new.user_id,'account',coalesce(new.suspended,false) or coalesce(new.banned,false),
   'Account access is restricted. You may request a review.',new.updated_by)
  on conflict(user_id,workspace) do update set version=gen_random_uuid(),
   restricted=excluded.restricted,public_reason=excluded.public_reason,changed_by=excluded.changed_by,changed_at=clock_timestamp();
 end if;return new;
end $$;
revoke all on function private.record_account_restriction() from public,anon,authenticated,service_role;
create trigger record_account_restriction after update of suspended,banned on public.profiles
 for each row execute function private.record_account_restriction();
insert into private.workspace_restrictions(user_id,workspace,restricted,public_reason)
 select user_id,'account',true,'Account access is restricted. You may request a review.'
 from public.profiles where (coalesce(suspended,false) or coalesce(banned,false)) and not coalesce(deleted,false);

-- Read/submit projections are shared by trusted account sessions and recovery-only tokens.
create function private.account_review_portal(p_user_id text,p_workspace text default null,p_explanation text default null,p_version uuid default null,p_case_id uuid default null,p_reply text default null,p_reply_key uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.workspace_restrictions;case_record public.operational_cases;existing uuid;
begin
 if not exists(select 1 from public.profiles where user_id=p_user_id and not coalesce(deleted,false)) then raise exception 'Account review unavailable';end if;
 if p_workspace is not null then
  select * into r from private.workspace_restrictions where user_id=p_user_id and workspace=p_workspace and restricted for update;
  if r.user_id is null or r.version is distinct from p_version then raise exception 'Refresh your current restrictions';end if;
  if length(btrim(coalesce(p_explanation,''))) not between 10 and 2000 then raise exception 'Explain your review request in 10 to 2000 characters';end if;
  select case_id into existing from private.workspace_appeals where user_id=p_user_id and workspace=p_workspace and restriction_version=r.version;
  if existing is null then
   if (select count(*) from public.operational_cases where requester_user_id=p_user_id and reason_code='workspace_access_review' and created_at>now()-interval '1 day')>=5 then raise exception 'Please wait before opening another review';end if;
   insert into public.operational_cases(reason_code,owning_domain,subject_type,subject_id,requester_user_id,state_scope)
   select 'workspace_access_review','security_operations','account',p_user_id,p_user_id,state from public.profiles where user_id=p_user_id returning * into case_record;
   insert into private.workspace_appeals(case_id,user_id,workspace,restriction_version,explanation)
    values(case_record.operational_case_id,p_user_id,p_workspace,r.version,btrim(p_explanation));
   insert into public.operational_case_events(operational_case_id,event_key,event_type,actor_user_id,public_note)
    values(case_record.operational_case_id,'appeal_received:'||case_record.operational_case_id,'appeal_received',p_user_id,'Your review request has been received.');
  end if;
 end if;
 if p_case_id is not null then
  select * into case_record from public.operational_cases where operational_case_id=p_case_id for update;
  if not exists(select 1 from private.workspace_appeals where case_id=p_case_id and user_id=p_user_id) then raise exception 'Review unavailable';end if;
  if p_reply_key is null or length(btrim(coalesce(p_reply,''))) not between 10 and 2000 then raise exception 'Add relevant information in 10 to 2000 characters';end if;
  if not exists(select 1 from public.operational_case_events where operational_case_id=p_case_id and event_key='appeal_reply:'||p_reply_key) then
   if exists(select 1 from private.workspace_appeals where case_id=p_case_id and decision in('restored','superseded')) then raise exception 'This review is complete';end if;
   if (select count(*) from public.operational_case_events where actor_user_id=p_user_id and event_type='appeal_reply' and created_at>now()-interval '1 day')>=20 then raise exception 'Please wait before adding more information';end if;
   insert into public.operational_case_events(operational_case_id,event_key,event_type,actor_user_id,public_note)
    values(p_case_id,'appeal_reply:'||p_reply_key,'appeal_reply',p_user_id,btrim(p_reply));
   update private.workspace_appeals set decision=null,decided_at=null,public_decision=null where case_id=p_case_id;
   update public.operational_cases set status=case when assigned_user_id is null then 'open' else 'investigating' end,resolved_at=null,updated_at=clock_timestamp() where operational_case_id=p_case_id;
  end if;
 end if;
 return jsonb_build_object('restrictions',(select coalesce(jsonb_agg(jsonb_build_object(
  'workspace',workspace,'version',version,'reason',public_reason,'changed_at',changed_at) order by changed_at desc),'[]'::jsonb)
  from private.workspace_restrictions where user_id=p_user_id and restricted),
 'appeals',(select coalesce(jsonb_agg(to_jsonb(q) order by q.updated_at desc),'[]'::jsonb) from (
  select a.case_id,c.case_number,a.workspace,a.explanation,c.status,c.updated_at,
   a.decision,a.public_decision,a.decided_at,
   (select coalesce(jsonb_agg(jsonb_build_object('note',e.public_note,'created_at',e.created_at) order by e.created_at),'[]'::jsonb)
    from public.operational_case_events e where e.operational_case_id=a.case_id and e.public_note is not null) as updates
  from private.workspace_appeals a join public.operational_cases c on c.operational_case_id=a.case_id
  where a.user_id=p_user_id order by c.updated_at desc limit 20) q));
end $$;
revoke all on function private.account_review_portal(text,text,text,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;

create function public.my_account_reviews(p_workspace text default null,p_explanation text default null,p_version uuid default null,p_case_id uuid default null,p_reply text default null,p_reply_key uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare who text:=public.current_profile_user_id();
begin
 if who is null or not public._property_document_session_active() then raise exception 'Trusted signed-in session required' using errcode='42501';end if;
 return private.account_review_portal(who,p_workspace,p_explanation,p_version,p_case_id,p_reply,p_reply_key);
end $$;
revoke all on function public.my_account_reviews(text,text,uuid,uuid,text,uuid) from public,anon,service_role;
grant execute on function public.my_account_reviews(text,text,uuid,uuid,text,uuid) to authenticated;

-- A verified Auth session is exchanged once and revoked before a recovery token
-- is returned. The browser never receives a marketplace Auth bearer from this flow.
create function public.bind_account_recovery_session(p_auth_id uuid,p_auth_session_id uuid,p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare who text;
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Service only';end if;
 if length(p_token)<>64 or p_token!~'^[0-9a-f]+$' then raise exception 'Invalid review token';end if;
 if not exists(select 1 from auth.sessions where id=p_auth_session_id and user_id=p_auth_id and created_at>now()-interval '5 minutes') then raise exception 'Fresh ownership verification required';end if;
 select p.user_id into who from public.profiles p join auth.users u on u.id=p_auth_id
  where p.auth_id=p_auth_id::text and u.email_confirmed_at is not null and not coalesce(p.deleted,false);
 delete from auth.sessions where id=p_auth_session_id and user_id=p_auth_id;
 if who is null then return jsonb_build_object('eligible',false);end if;
 delete from private.recovery_sessions where expires_at<now();
 insert into private.recovery_sessions(token_hash,user_id,expires_at)
  values(extensions.digest(p_token,'sha256'),who,now()+interval '30 minutes');
 return jsonb_build_object('eligible',true,'expires_in_seconds',1800);
end $$;
create function public.account_recovery_portal(p_token text,p_workspace text default null,p_explanation text default null,p_version uuid default null,p_case_id uuid default null,p_reply text default null,p_reply_key uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare who text;
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Service only';end if;
 if length(coalesce(p_token,''))<>64 then raise exception 'Verify account ownership again';end if;
 select user_id into who from private.recovery_sessions where token_hash=extensions.digest(p_token,'sha256') and expires_at>now();
 if who is null then raise exception 'Verify account ownership again';end if;
 return private.account_review_portal(who,p_workspace,p_explanation,p_version,p_case_id,p_reply,p_reply_key);
end $$;
revoke all on function public.bind_account_recovery_session(uuid,uuid,text),public.account_recovery_portal(text,text,text,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.bind_account_recovery_session(uuid,uuid,text),public.account_recovery_portal(text,text,text,uuid,uuid,text,uuid) to service_role;

-- Creator is global; Admin and Security Operations retain their actual scope.
create function private.account_review_target_in_scope(p_target text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles;target public.profiles;
begin
 if public.current_profile_user_id()=p_target then return false;end if;
 if public.current_actor_has_workspace('creator',null) then return true;end if;
 select * into target from public.profiles where user_id=p_target;
 if public.user_has_active_workspace(public.current_profile_user_id(),'admin') then
  actor:=public._admin_dashboard_actor();
  return public.wehouse_state_key(coalesce(target.assigned_state,target.state))=public.wehouse_state_key(actor.assigned_state)
   and (actor.assigned_lga is null or lower(btrim(coalesce(target.assigned_lga,target.local_government,target.city,'')))=lower(btrim(actor.assigned_lga)));
 end if;
 return public.current_actor_has_workspace('staff',null) and public.current_staff_has_permission('security_operations')
  and exists(select 1 from public.workspace_role_assignments g where g.user_id=public.current_profile_user_id()
   and g.workspace_role='security_operations' and g.status='active' and g.revoked_at is null
   and case g.scope_type when 'global' then true
    when 'state' then public.wehouse_state_key(g.scope_state)=public.wehouse_state_key(coalesce(target.assigned_state,target.state))
    when 'branch' then public.wehouse_state_key(g.scope_state)=public.wehouse_state_key(coalesce(target.assigned_state,target.state))
     and lower(btrim(g.scope_lga))=lower(btrim(coalesce(target.assigned_lga,target.local_government,target.city)))
    else false end);
end $$;
create function private.account_review_authority(p_target text default null,p_sensitive boolean default false,p_elevation uuid default null) returns text
language plpgsql stable security definer set search_path='' as $$
declare who text:=public.current_profile_user_id();proof boolean;
begin
 if who is null or not public._property_document_session_active() then raise exception 'Trusted review session required' using errcode='42501';end if;
 if public.current_actor_has_workspace('creator',null) then
  if p_sensitive and not public.creator_has_elevation(p_elevation,'all_sensitive') then raise exception 'Recent Creator confirmation required';end if;
 elsif public.user_has_active_workspace(who,'admin') then
  if p_sensitive then
   proof:=auth.jwt()->>'aal'='aal2' and exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) amr
    where amr->>'method'='totp' and case when amr->>'timestamp' ~ '^[0-9]{1,12}$' then (amr->>'timestamp')::bigint else 0 end>extract(epoch from now()-interval '5 minutes'))
    and exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified' and factor_type='totp');
   if not coalesce(proof,false) then raise exception 'Fresh Admin authenticator confirmation required';end if;
  end if;
 elsif public.current_actor_has_workspace('staff',null) and public.current_staff_has_permission('security_operations') then
  if p_sensitive then raise exception 'Security Operations investigates; Admin or Creator decides access';end if;
 else raise exception 'Authorized account review workspace required' using errcode='42501';end if;
 if p_target is not null and not private.account_review_target_in_scope(p_target) then raise exception 'Review is outside your scope';end if;
 return who;
end $$;
revoke all on function private.account_review_target_in_scope(text),private.account_review_authority(text,boolean,uuid) from public,anon,authenticated,service_role;

create function public.review_workspace_access(p_user_id text,p_workspace text default null,p_restricted boolean default null,p_reason text default null,p_expected_version uuid default null,p_elevation uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();r private.workspace_restrictions;
begin
 actor:=private.account_review_authority(p_user_id,p_workspace is not null,p_elevation);
 if not exists(select 1 from public.profiles where user_id=p_user_id and not coalesce(deleted,false)) then raise exception 'Account unavailable';end if;
 if p_workspace is not null then
  if p_workspace not in('personal','worker','property_partner','hotel','hosting','staff','admin') or p_restricted is null then raise exception 'Choose one workspace';end if;
  if actor=p_user_id or private.unrestricted_workspace_grant(p_user_id,'creator') then raise exception 'Cannot restrict yourself or Creator';end if;
  if p_workspace in('admin','staff') and not public.current_actor_has_workspace('creator',null) then raise exception 'Creator controls internal workspace restrictions';end if;
  if length(btrim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'A clear reviewable reason is required';end if;
  perform 1 from public.profiles where user_id=p_user_id for update;
  select * into r from private.workspace_restrictions where user_id=p_user_id and workspace=p_workspace for update;
  if r.version is distinct from p_expected_version then raise exception 'Workspace access changed. Refresh before deciding';end if;
  if p_workspace in('admin','staff') and not public.current_actor_has_workspace('creator',null) then raise exception 'Creator controls internal workspace restrictions';end if;
  if p_workspace not in('personal','hotel') and not private.unrestricted_workspace_grant(p_user_id,p_workspace) then raise exception 'No such workspace grant';end if;
  if p_workspace='hotel' and not exists(select 1 from public.hotel_team_members where member_user_id=p_user_id and status='active') then raise exception 'No Hotel Team access';end if;
  insert into private.workspace_restrictions(user_id,workspace,restricted,public_reason,changed_by)
   values(p_user_id,p_workspace,p_restricted,btrim(p_reason),actor)
   on conflict(user_id,workspace) do update set restricted=excluded.restricted,
    version=gen_random_uuid(),public_reason=excluded.public_reason,changed_by=actor,changed_at=clock_timestamp();
  insert into public.audit_logs(action,target_type,target_id,admin_id,details)
   values('WORKSPACE_ACCESS_CHANGED','profiles',p_user_id,actor,jsonb_build_object('workspace',p_workspace,'restricted',p_restricted,'reason',btrim(p_reason))::text);
  insert into public.notifications(recipient_id,type,title,message,source_type,source_id,destination_route,event_key,workspace_scope)
   values(p_user_id,'workspace_access_changed','Workspace access updated',p_workspace||': '||btrim(p_reason),'account',p_user_id,'account_reviews','workspace_access:'||gen_random_uuid(),'personal');

 end if;
 return jsonb_build_object('protected',actor=p_user_id or private.unrestricted_workspace_grant(p_user_id,'creator'),
 'workspaces',(select coalesce(jsonb_agg(w),'[]'::jsonb) from unnest(array['personal','worker','property_partner','hosting','staff','admin','hotel']) w
  where (w not in('staff','admin') or public.current_actor_has_workspace('creator',null)) and (w='personal' or (w<>'hotel' and private.unrestricted_workspace_grant(p_user_id,w))
  or (w='hotel' and exists(select 1 from public.hotel_team_members where member_user_id=p_user_id and status='active')))),
 'restrictions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
  select workspace,restricted,version,public_reason,changed_at from private.workspace_restrictions where user_id=p_user_id) x));
end $$;
revoke all on function public.review_workspace_access(text,text,boolean,text,uuid,uuid) from public,anon,service_role;
grant execute on function public.review_workspace_access(text,text,boolean,text,uuid,uuid) to authenticated;

create function public.list_account_review_queue(p_before timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.account_review_authority();
 return (select coalesce(jsonb_agg(to_jsonb(q) order by q.updated_at desc),'[]'::jsonb) from (
  select a.*,c.case_number,c.status,c.assigned_user_id,c.updated_at,p.full_name,p.username,
   r.version as current_version,r.restricted,
   (select coalesce(jsonb_agg(jsonb_build_object('public_note',e.public_note,'internal_note',e.internal_note,'created_at',e.created_at) order by e.created_at),'[]'::jsonb)
    from public.operational_case_events e where e.operational_case_id=a.case_id) as updates
  from private.workspace_appeals a join public.operational_cases c on c.operational_case_id=a.case_id
  join public.profiles p on p.user_id=a.user_id
  left join private.workspace_restrictions r on r.user_id=a.user_id and r.workspace=a.workspace
  where private.account_review_target_in_scope(a.user_id) and (p_before is null or (c.updated_at,a.case_id)<(p_before,p_before_id))
  order by c.updated_at desc,a.case_id desc limit 50) q);
end $$;
revoke all on function public.list_account_review_queue(timestamptz,uuid) from public,anon,service_role;
grant execute on function public.list_account_review_queue(timestamptz,uuid) to authenticated;

create function public.decide_account_review(p_case_id uuid,p_action text,p_public_note text,p_private_note text,p_expected_updated_at timestamptz,p_elevation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();a private.workspace_appeals;c public.operational_cases;r private.workspace_restrictions;
begin
 perform private.account_review_authority();
 select * into c from public.operational_cases where operational_case_id=p_case_id for update;
 select * into a from private.workspace_appeals where case_id=p_case_id for update;
 if a.case_id is null or c.updated_at is distinct from p_expected_updated_at then raise exception 'Review changed. Refresh first';end if;
 actor:=private.account_review_authority(a.user_id,p_action in('upheld','restored','superseded'),p_elevation);
 if a.workspace in('admin','staff','account') and p_action='restored' and not public.current_actor_has_workspace('creator',null) and exists(select 1 from public.workspace_role_assignments where user_id=a.user_id and workspace_role in('admin','staff','creator') and status='active') then raise exception 'Creator must decide internal account restoration';end if;
 if actor=a.user_id then raise exception 'Cannot decide your own review';end if;
 if length(coalesce(p_private_note,''))>2000 or length(btrim(coalesce(p_public_note,''))) not between 10 and 2000 then raise exception 'A clear public update is required';end if;
 if a.decision is not null then raise exception 'This review has already been decided';end if;
 if p_action='claim' then
  if c.assigned_user_id is not null and c.assigned_user_id<>actor and c.status<>'decision_ready' then raise exception 'Review already assigned. Investigator must escalate first';end if;
  update public.operational_cases set assigned_user_id=actor,status='investigating',updated_at=clock_timestamp() where operational_case_id=p_case_id;
 elsif p_action='escalate' then
  if c.assigned_user_id is distinct from actor or a.decision is not null then raise exception 'Claim the open review first';end if;
  update public.operational_cases set status='decision_ready',updated_at=clock_timestamp() where operational_case_id=p_case_id;
 elsif p_action='request_information' then
  if c.assigned_user_id is distinct from actor or a.decision is not null then raise exception 'Claim the open review first';end if;
  update public.operational_cases set status='waiting_customer',updated_at=clock_timestamp() where operational_case_id=p_case_id;
 elsif p_action in('upheld','restored','superseded') then
  if c.assigned_user_id is distinct from actor or a.decision is not null then raise exception 'Claim the open review before deciding';end if;
  select * into r from private.workspace_restrictions where user_id=a.user_id and workspace=a.workspace for update;
  if p_action='superseded' then
   if r.version is not distinct from a.restriction_version and r.restricted then raise exception 'This restriction is still current';end if;
  elsif r.version is distinct from a.restriction_version or not r.restricted then raise exception 'Restriction changed. Do not restore a different restriction';end if;
  if p_action='restored' then
   if a.workspace='account' then
    if private.unrestricted_workspace_grant(a.user_id,'creator') then raise exception 'Cannot change Creator';end if;
    update public.profiles set suspended=false,banned=false,suspended_at=null,suspended_by=null,suspended_reason=null,
     banned_at=null,banned_by=null,banned_reason=null,updated_by=actor,updated_at=now()
     where user_id=a.user_id and not coalesce(deleted,false);
    if not found then raise exception 'Deleted accounts cannot be restored';end if;
    update public.user_sessions set is_active=false where user_id=a.user_id and is_active;
    delete from auth.sessions where user_id=(select auth_id::uuid from public.profiles where user_id=a.user_id);
   else
    if a.workspace='worker_profile' then
     -- Review the existing evidence through the canonical approval checks.
     -- No identity/work evidence is deleted or requested again by this command.
     if not public.worker_identity_is_current(a.user_id) then raise exception 'The current private face check has not passed';end if;
     if not private.worker_credentials_current(a.user_id) then raise exception 'Current service and location credentials must be reviewed before Worker approval';end if;
     if not exists(select 1 from public.worker_verifications where worker_id=a.user_id and nullif(btrim(verification_video_url),'') is not null) then raise exception 'Professional work evidence is incomplete';end if;
     -- Same publication guards as normal review; retained evidence is reused.
     update public.profiles set worker_status='verified',worker_verified=true,available=true,updated_by=actor,updated_at=now() where user_id=a.user_id;
     update public.worker_verifications set status='verified',reviewed_by=actor,reviewed_at=now(),updated_at=now() where worker_id=a.user_id;
     insert into public.worker_verification_reviews(worker_id,reviewer_id,reviewer_role,action)
      values(a.user_id,actor,case when public.current_actor_has_workspace('creator',null) then 'creator' else 'admin' end,'approved');
    end if;
    update private.workspace_restrictions set restricted=false,version=gen_random_uuid(),changed_by=actor,changed_at=clock_timestamp()
     where user_id=a.user_id and workspace=a.workspace;
   end if;
  end if;
  update private.workspace_appeals set decision=p_action,public_decision=btrim(p_public_note),decided_at=now() where case_id=p_case_id;
  update public.operational_cases set status='resolved',resolution_code='workspace_review_'||p_action,
   resolution_summary=btrim(p_public_note),resolved_at=now(),updated_at=clock_timestamp() where operational_case_id=p_case_id;
 else raise exception 'Choose a review action';end if;
 insert into public.operational_case_events(operational_case_id,event_key,event_type,actor_user_id,public_note,internal_note)
  values(p_case_id,'workspace_review:'||gen_random_uuid(),'workspace_review_'||p_action,actor,btrim(p_public_note),nullif(btrim(p_private_note),''));
 insert into public.audit_logs(action,target_type,target_id,admin_id,details)
  values('WORKSPACE_APPEAL_'||upper(p_action),'operational_cases',p_case_id::text,actor,jsonb_build_object('workspace',a.workspace,'restriction_version',a.restriction_version)::text);
 insert into public.notifications(recipient_id,type,title,message,source_type,source_id,destination_route,event_key,workspace_scope)
  values(a.user_id,'account_review_update','Account review update',btrim(p_public_note),'account',a.user_id,'account_reviews',
   'account_review:'||p_case_id||':'||gen_random_uuid(),'personal');
 return jsonb_build_object('success',true,'case_id',p_case_id,'action',p_action);
end $$;
revoke all on function public.decide_account_review(uuid,text,text,text,timestamptz,uuid) from public,anon,service_role;
grant execute on function public.decide_account_review(uuid,text,text,text,timestamptz,uuid) to authenticated;

-- Generic case controls cannot close a review without its restriction decision.
create function private.guard_account_review_resolution() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status in('resolved','closed') and exists(select 1 from private.workspace_appeals where case_id=new.operational_case_id and decision is null) then
  raise exception 'Use the account review decision controls';end if;return new;
end $$;
revoke all on function private.guard_account_review_resolution() from public,anon,authenticated,service_role;
create trigger guard_account_review_resolution before update of status on public.operational_cases for each row execute function private.guard_account_review_resolution();

insert into public.case_reason_registry(reason_code,label,owning_domain,allowed_subject_types,customer_description)
 values('workspace_access_review','Account or workspace review','security_operations',array['account'],'Review a restriction on your account or one workspace.');

-- Rejected professional profiles are reviewable using their existing evidence.
-- This is not an account suspension or a revocation of their workspace grant.
create function private.record_professional_restriction() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.worker_status is distinct from old.worker_status
  and private.unrestricted_workspace_grant(new.user_id,'worker')
  and not coalesce(new.suspended,false) and not coalesce(new.banned,false) then
  if new.worker_status in('rejected','suspended') then
   insert into private.workspace_restrictions(user_id,workspace,restricted,public_reason,changed_by)
    values(new.user_id,'worker_profile',true,'Your Service Worker profile has a review decision. You can request a review of the existing evidence.',new.updated_by)
    on conflict(user_id,workspace) do update set restricted=true,version=gen_random_uuid(),
     public_reason=excluded.public_reason,changed_by=excluded.changed_by,changed_at=clock_timestamp();
  elsif new.worker_status='verified' then
   update private.workspace_restrictions set restricted=false,version=gen_random_uuid(),changed_by=new.updated_by,changed_at=clock_timestamp()
    where user_id=new.user_id and workspace='worker_profile' and restricted;
  end if;
 end if;return new;
end $$;
revoke all on function private.record_professional_restriction() from public,anon,authenticated,service_role;
create trigger record_professional_restriction after update of worker_status on public.profiles
 for each row execute function private.record_professional_restriction();
insert into private.workspace_restrictions(user_id,workspace,restricted,public_reason)
 select user_id,'worker_profile',true,'Your Service Worker profile has a review decision. You can request a review of the existing evidence.'
 from public.profiles where worker_status in('rejected','suspended')
 and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
 and private.unrestricted_workspace_grant(user_id,'worker');

-- Enforce scope on direct table writes and SECURITY DEFINER command writes.
-- Provider callbacks have no browser auth.uid and keep completing existing money
-- obligations. Customer cancellation/support remain available for existing work.
create function private.enforce_workspace_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare who text:=public.current_profile_user_id();scope text;row_data jsonb:=to_jsonb(new);old_data jsonb;
begin
 if auth.uid() is null then return new;end if;
 if who is null then raise exception 'Active account required';end if;
 if tg_table_name in('friend_messages','friends','messages','conversations','roommate_preferences','roommate_profiles','roommate_matches') then
  scope:='personal';
  if tg_table_name='friends' and row_data->>'status'='blocked' then return new;end if;
 elsif tg_table_name in('reservations','hotel_bookings','worker_bookings','experience_bookings') then
  if tg_op='INSERT' and who=coalesce(row_data->>'user_id',row_data->>'customer_user_id') then
   scope:='personal';
   if coalesce(row_data->>'worker_id',row_data->>'host_user_id') is not null
    and not public.workspace_access_allowed(coalesce(row_data->>'worker_id',row_data->>'host_user_id'),'worker') then raise exception 'This provider is restricted from new bookings';end if;
   if tg_table_name='reservations' and exists(select 1 from public.listings l where (l.id::text=row_data->>'listing_id' or l.listing_id=row_data->>'listing_id')
    and not public.workspace_access_allowed(coalesce(l.owner_id,l.partner_id),'property_partner')) then raise exception 'This property is restricted from new bookings';end if;
   if tg_table_name='hotel_bookings' and exists(select 1 from public.hotels h where h.hotel_id=(row_data->>'hotel_id')::integer
    and not public.workspace_access_allowed(h.owner_id,'property_partner')) then raise exception 'This hotel is restricted from new bookings';end if;
   if nullif(row_data->>'responsible_host_user_id','') is not null and not public.workspace_access_allowed(row_data->>'responsible_host_user_id','hosting') then raise exception 'This host cannot accept a new booking';end if;
  elsif who=coalesce(row_data->>'worker_id',row_data->>'host_user_id') then scope:='worker';end if;
 elsif tg_table_name in('listings','hotels') then
  if who in(coalesce(row_data->>'owner_id',''),coalesce(row_data->>'partner_id','')) then scope:='property_partner';
  elsif who=coalesce(row_data->>'management_host_user_id','') or (tg_table_name='listings' and exists(select 1 from public.property_host_assignments a where a.listing_id=(row_data->>'id')::uuid and a.user_id=who and a.status='active')) then scope:='hosting';
  elsif tg_table_name='hotels' and exists(select 1 from public.hotel_team_members m where m.hotel_id=(row_data->>'hotel_id')::integer and m.member_user_id=who and m.status='active') then scope:='hotel';end if;
 elsif tg_table_name='profiles' and who=row_data->>'user_id' and tg_op='UPDATE' then
  old_data:=to_jsonb(old);
  if (row_data->'worker_bio',row_data->'worker_occupation',row_data->'worker_price',row_data->'worker_skills',row_data->'available')
   is distinct from (old_data->'worker_bio',old_data->'worker_occupation',old_data->'worker_price',old_data->'worker_skills',old_data->'available') then scope:='worker';end if;
 elsif tg_table_name='booking_messages' then
  select case when who=c.worker_id then 'worker' when who=c.user_id then 'personal' end into scope
   from public.booking_conversations c where c.id=(row_data->>'conversation_id')::uuid;
 end if;
 if scope is not null and not public.workspace_access_allowed(who,scope) then
  raise exception 'This workspace is restricted. Existing obligations and account review remain available.' using errcode='42501';
 end if;return new;
end $$;
revoke all on function private.enforce_workspace_write() from public,anon,authenticated,service_role;
do $write_guards$
declare t text;
begin
 foreach t in array array['friend_messages','friends','messages','conversations','roommate_preferences','roommate_profiles','roommate_matches','reservations','hotel_bookings','worker_bookings','experience_bookings','listings','hotels','profiles','booking_messages'] loop
  execute format('create trigger scoped_workspace_write before insert or update on public.%I for each row execute function private.enforce_workspace_write()',t);
 end loop;
end $write_guards$;

-- Preserve the public OID: existing RLS policies must call the new gate.
do $copy$begin
 execute replace(pg_get_functiondef('public._admin_dashboard_actor()'::regprocedure),'FUNCTION public._admin_dashboard_actor(','FUNCTION private.unrestricted_admin_actor(');
end $copy$;
revoke all on function private.unrestricted_admin_actor() from public,anon,authenticated,service_role;
create or replace function public._admin_dashboard_actor() returns public.profiles
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles;
begin
 actor:=private.unrestricted_admin_actor();
 if actor.role='admin' and not public.workspace_access_allowed(actor.user_id,'admin') then raise exception 'Admin workspace restricted';end if;
 return actor;
end $$;
revoke all on function public._admin_dashboard_actor() from public,anon;
grant execute on function public._admin_dashboard_actor() to authenticated,service_role;

-- Preserve the public OID: existing RLS policies must call the new gate.
do $copy$begin
 execute replace(pg_get_functiondef('public.current_actor_hotel_capabilities(integer)'::regprocedure),'FUNCTION public.current_actor_hotel_capabilities(','FUNCTION private.unrestricted_hotel_capabilities(');
end $copy$;
revoke all on function private.unrestricted_hotel_capabilities(integer) from public,anon,authenticated,service_role;
create or replace function public.current_actor_hotel_capabilities(p_hotel_id integer) returns text[]
language sql stable security definer set search_path='' as $$
 select case when public.workspace_access_allowed(public.current_profile_user_id(),
  case when exists(select 1 from public.hotels h where h.hotel_id=p_hotel_id and h.owner_id=public.current_profile_user_id()) then 'property_partner' else 'hotel' end)
 then private.unrestricted_hotel_capabilities(p_hotel_id) else array[]::text[] end;
$$;
revoke all on function public.current_actor_hotel_capabilities(integer) from public,anon;
grant execute on function public.current_actor_hotel_capabilities(integer) to authenticated,service_role;

-- Older direct Admin access commands must not bypass fresh review authority.
-- Preserve the public OID: existing RLS policies must call the new gate.
do $copy$begin
 execute replace(pg_get_functiondef('public.admin_suspend_user(text,text)'::regprocedure),'FUNCTION public.admin_suspend_user(','FUNCTION private.scoped_admin_suspend_core(');
end $copy$;
-- Preserve the public OID: existing RLS policies must call the new gate.
do $copy$begin
 execute replace(pg_get_functiondef('public.admin_reactivate_user(text)'::regprocedure),'FUNCTION public.admin_reactivate_user(','FUNCTION private.scoped_admin_restore_core(');
end $copy$;
-- Preserve the public OID: existing RLS policies must call the new gate.
do $copy$begin
 execute replace(pg_get_functiondef('public.admin_ban_user(text,text)'::regprocedure),'FUNCTION public.admin_ban_user(','FUNCTION private.scoped_admin_ban_core(');
end $copy$;
revoke all on function private.scoped_admin_suspend_core(text,text),private.scoped_admin_restore_core(text),private.scoped_admin_ban_core(text,text) from public,anon,authenticated,service_role;
create or replace function public.admin_suspend_user(p_target_user_id text,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.account_review_authority(p_target_user_id,true,null);
 perform private.scoped_admin_suspend_core(p_target_user_id,p_reason);
end $$;
create or replace function public.admin_reactivate_user(p_target_user_id text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.account_review_authority(p_target_user_id,true,null);
 perform private.scoped_admin_restore_core(p_target_user_id);
end $$;
create or replace function public.admin_ban_user(p_target_user_id text,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.account_review_authority(p_target_user_id,true,null);
 if length(btrim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'A clear ban reason is required';end if;
 if private.unrestricted_workspace_grant(p_target_user_id,'creator') or p_target_user_id=public.current_profile_user_id() then raise exception 'Protected account';end if;
 update public.profiles set banned=true,banned_at=now(),banned_by=public.current_profile_user_id(),banned_reason=btrim(p_reason),updated_by=public.current_profile_user_id(),updated_at=now() where user_id=p_target_user_id and not coalesce(deleted,false);
 if not found then raise exception 'Account unavailable';end if;
 insert into public.audit_logs(action,target_type,target_id,details,admin_id) values('BAN','profiles',p_target_user_id,jsonb_build_object('reason',btrim(p_reason))::text,public.current_profile_user_id());
end $$;
revoke all on function public.admin_suspend_user(text,text),public.admin_reactivate_user(text),public.admin_ban_user(text,text) from public,anon;
grant execute on function public.admin_suspend_user(text,text),public.admin_reactivate_user(text),public.admin_ban_user(text,text) to authenticated,service_role;

-- Explicitly end recovery access; no browser can invoke this service-only API.
create function public.close_account_recovery_session(p_token text) returns void
language plpgsql security definer set search_path='' as $$begin
 delete from private.recovery_sessions where token_hash=extensions.digest(p_token,'sha256');
end $$;
revoke all on function public.close_account_recovery_session(text) from public,anon,authenticated;
grant execute on function public.close_account_recovery_session(text) to service_role;

-- Account access removal remains appealable and does not erase work approval.
do $ban$declare definition text;needle text;begin
 definition:=replace(pg_get_functiondef('public.creator_ban_user(text,text,uuid)'::regprocedure),chr(13),'');
 needle:='banned_reason=btrim(p_reason),deleted=true,deleted_at=now(),';
 if strpos(definition,needle)=0 then raise exception 'Inspect Creator account removal before upgrade';end if;
 definition:=replace(definition,needle,'banned_reason=btrim(p_reason),');
 definition:=replace(definition,$old$or v_target.role='creator' then$old$,$new$or v_target.role='creator' or private.unrestricted_workspace_grant(v_target.user_id,'creator') then$new$);
 needle:=$old$worker_status=case when role='worker' then 'suspended' else worker_status end,$old$;
 if strpos(definition,needle)=0 then raise exception 'Inspect Creator professional approval preservation';end if;
 execute replace(definition,needle,'');
end $ban$;
