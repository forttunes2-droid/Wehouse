-- Creator controls marketplace publication without changing Personal identity,
-- silently approving Workers, or making paid subscriptions a discovery gate.
begin;
create table if not exists public.worker_publication_controls(
 worker_id text primary key references public.profiles(user_id) on delete cascade,
 paused boolean not null default false, reason text,
 updated_at timestamptz not null default now(), updated_by text references public.profiles(user_id),
 constraint worker_publication_reason_length check(reason is null or length(reason)<=1000)
);
alter table public.worker_publication_controls enable row level security;
revoke all on public.worker_publication_controls from public,anon,authenticated;
grant all on public.worker_publication_controls to service_role;

create or replace function public._worker_publication_state(p_worker_id text)
returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare p public.profiles; reasons text[]:='{}'; enabled boolean:=false; approved boolean:=false;
 paused boolean:=false; ready boolean:=false; identity_ok boolean:=false;
begin
 select * into p from public.profiles where user_id=p_worker_id;
 select coalesce(is_active,true) and lower(btrim(value)) in('true','1','yes','on') into enabled
  from public.platform_settings where key='worker_marketplace_launch_enabled';
 enabled:=coalesce(enabled,false);
 approved:=public._legal_launch_gate_is_approved('worker_marketplace');
 select coalesce(c.paused,false) into paused from public.worker_publication_controls c where c.worker_id=p_worker_id;
 paused:=coalesce(paused,false);
 if p.user_id is null then return jsonb_build_object('eligible',false,'publicly_visible',false,'reasons',jsonb_build_array('Worker record unavailable')); end if;
 ready:=public.worker_professional_profile_ready(p_worker_id);
 identity_ok:=public.worker_identity_is_current(p_worker_id);
 if not public.user_has_active_workspace(p_worker_id,'worker') then reasons:=array_append(reasons,'Worker workspace is not active'); end if;
 if coalesce(p.deleted,false) or coalesce(p.suspended,false) or coalesce(p.banned,false) then reasons:=array_append(reasons,'Account access is restricted'); end if;
 if not ready then reasons:=array_append(reasons,'Professional profile or service coverage is incomplete'); end if;
 if p.worker_status is distinct from 'verified' or p.worker_verified is distinct from true then reasons:=array_append(reasons,'Professional review has not been approved'); end if;
 if not coalesce(identity_ok,false) then reasons:=array_append(reasons,'Required identity review is not current'); end if;
 if not coalesce(p.available,false) then reasons:=array_append(reasons,'Worker has paused their availability'); end if;
 if paused then reasons:=array_append(reasons,'Creator has paused marketplace publication'); end if;
 return jsonb_build_object('eligible',cardinality(reasons)=0,'publicly_visible',cardinality(reasons)=0 and enabled and approved,
  'marketplace_enabled',enabled,'launch_approved',approved,'publication_paused',paused,
  'profile_ready',ready,'identity_required',public.account_identity_checks_enabled(),
  'identity_current',public.account_identity_is_current(p_worker_id),'identity_gate_satisfied',identity_ok,
  'reasons',to_jsonb(reasons||case when not enabled then array['Worker marketplace is paused'] else '{}'::text[] end
    ||case when not approved then array['Marketplace launch review is not recorded or has expired'] else '{}'::text[] end));
end $$;
revoke all on function public._worker_publication_state(text) from public,anon,authenticated;
grant execute on function public._worker_publication_state(text) to service_role;

create or replace function public.creator_get_worker_publication(p_worker_id text default null)
returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare review jsonb; enabled boolean;
begin
 if not public.current_actor_has_workspace('creator',null) then raise exception 'Active Creator access required'; end if;
 select jsonb_build_object('status',a.status,'authority',a.authority,'reference',a.approval_reference,
  'scope',a.scope,'approved_at',a.approved_at,'expires_at',a.expires_at) into review
 from public.legal_launch_approvals a where a.gate_key='worker_marketplace';
 select coalesce(is_active,true) and lower(btrim(value)) in('true','1','yes','on') into enabled
  from public.platform_settings where key='worker_marketplace_launch_enabled';
 return jsonb_build_object('enabled',coalesce(enabled,false),'launch_approved',public._legal_launch_gate_is_approved('worker_marketplace'),
  'review',review,'worker',case when p_worker_id is null then null else public._worker_publication_state(p_worker_id) end);
end $$;

create or replace function public.creator_set_worker_publication(p_worker_id text,p_paused boolean,p_reason text,p_creator_elevation_id uuid)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare old_state jsonb;
begin
 if not public.current_actor_has_workspace('creator',null) then raise exception 'Active Creator access required'; end if;
 perform public.reauthenticate_creator_action(p_creator_elevation_id,'all_sensitive');
 if p_paused is null or length(btrim(coalesce(p_reason,'')))<3 or length(p_reason)>1000 then raise exception 'Enter the reason for this publication change'; end if;
 if not public.user_has_active_workspace(p_worker_id,'worker') then raise exception 'Worker workspace is not active'; end if;
 perform 1 from public.profiles where user_id=p_worker_id for update;
 old_state:=public._worker_publication_state(p_worker_id);
 insert into public.worker_publication_controls(worker_id,paused,reason,updated_by)
 values(p_worker_id,p_paused,btrim(p_reason),public.current_profile_user_id())
 on conflict(worker_id) do update set paused=excluded.paused,reason=excluded.reason,updated_at=now(),updated_by=excluded.updated_by;
 insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
 values(public.current_profile_user_id(),'creator_worker_publication','worker',p_worker_id,
 jsonb_build_object('before',old_state,'paused',p_paused,'reason',btrim(p_reason),'elevation_id',p_creator_elevation_id)::text,now());
 return public._worker_publication_state(p_worker_id);
end $$;

create or replace function public.creator_set_worker_marketplace(p_enabled boolean,p_reason text,p_creator_elevation_id uuid)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare old_value text;
begin
 if not public.current_actor_has_workspace('creator',null) then raise exception 'Active Creator access required'; end if;
 perform public.reauthenticate_creator_action(p_creator_elevation_id,'all_sensitive');
 if p_enabled is null or length(btrim(coalesce(p_reason,'')))<3 or length(p_reason)>1000 then raise exception 'Enter a reason for changing marketplace availability'; end if;
 if p_enabled and not public._legal_launch_gate_is_approved('worker_marketplace') then raise exception 'Record the actual marketplace launch review before opening discovery'; end if;
 select value into old_value from public.platform_settings where key='worker_marketplace_launch_enabled' for update;
 update public.platform_settings set value=p_enabled::text,is_active=true,updated_at=now() where key='worker_marketplace_launch_enabled';
 if not found then raise exception 'Marketplace setting is unavailable'; end if;
 insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
 values(public.current_profile_user_id(),'creator_worker_marketplace','platform_settings','worker_marketplace_launch_enabled',
 jsonb_build_object('before',old_value,'enabled',p_enabled,'reason',btrim(p_reason),'elevation_id',p_creator_elevation_id)::text,now());
 return public.creator_get_worker_publication(null);
end $$;

-- This records an external review obtained by the owner; it does not grant a
-- government licence or perform legal review merely because a field was filled.
create or replace function public.creator_record_worker_launch_review(p_authority text,p_reference text,p_scope text,p_approved_at timestamptz,p_expires_at timestamptz,p_creator_elevation_id uuid)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
begin
 if not public.current_actor_has_workspace('creator',null) then raise exception 'Active Creator access required'; end if;
 perform public.reauthenticate_creator_action(p_creator_elevation_id,'all_sensitive');
 if length(btrim(coalesce(p_authority,'')))<3 or length(p_authority)>200
  or length(btrim(coalesce(p_reference,'')))<3 or length(p_reference)>300
  or length(btrim(coalesce(p_scope,'')))<10 or length(p_scope)>3000
  or p_approved_at is null or p_approved_at>now()
  or (p_expires_at is not null and (p_expires_at<=now() or p_expires_at<=p_approved_at)) then
  raise exception 'Provide the real reviewer, review reference, covered scope and valid review dates'; end if;
 insert into public.legal_launch_approvals(gate_key,status,authority,approval_reference,scope,approved_at,expires_at,recorded_by)
 values('worker_marketplace','approved',btrim(p_authority),btrim(p_reference),btrim(p_scope),p_approved_at,p_expires_at,public.current_profile_user_id())
 on conflict(gate_key) do update set status='approved',authority=excluded.authority,approval_reference=excluded.approval_reference,
 scope=excluded.scope,approved_at=excluded.approved_at,expires_at=excluded.expires_at,recorded_by=excluded.recorded_by,updated_at=now();
 insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
 values(public.current_profile_user_id(),'creator_worker_launch_review','legal_launch_approvals','worker_marketplace',
 jsonb_build_object('authority',btrim(p_authority),'reference',btrim(p_reference),'scope',btrim(p_scope),'elevation_id',p_creator_elevation_id)::text,now());
 return public.creator_get_worker_publication(null);
end $$;

create or replace function public.get_public_workers(
  p_state text default null,
  p_city text default null,
  p_occupation text default null
)
returns table(
  user_id text,
  full_name text,
  username text,
  avatar_url text,
  bio text,
  state text,
  city text,
  local_government text,
  area text,
  worker_occupation text,
  worker_skills jsonb,
  worker_price integer,
  worker_bio text,
  worker_experience text,
  rating numeric,
  review_count integer,
  is_online boolean,
  last_seen timestamptz,
  services jsonb,
  coverage jsonb,
  pro_active boolean
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_marketplace_enabled boolean:=false;
  v_internal_preview boolean:=false;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  v_internal_preview :=
    public.current_actor_has_workspace('creator',null)
    or public.current_actor_has_workspace('admin',null);

  select coalesce(lower(setting.value) in('true','1','yes','on'),false)
  into v_marketplace_enabled
  from public.platform_settings setting
  where setting.key='worker_marketplace_launch_enabled'
    and setting.is_active=true
  limit 1;

  if (not coalesce(v_marketplace_enabled,false) or not public._legal_launch_gate_is_approved('worker_marketplace'))
     and not coalesce(v_internal_preview,false) then
    return;
  end if;

  return query
  select
    profile.user_id,profile.full_name,profile.username,profile.avatar_url,
    profile.bio,profile.state,profile.city,profile.local_government,
    profile.area,profile.worker_occupation,profile.worker_skills,
    profile.worker_price,profile.worker_bio,profile.worker_experience,
    profile.rating,profile.review_count,profile.is_online,profile.last_seen,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name',service.service_name,'price',service.price,
        'price_type',service.price_type
      ))
      from public.worker_services service
      where service.worker_id=profile.user_id
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'state',coverage_row.state,'lga',coverage_row.lga,
        'areas',coverage_row.areas
      ))
      from public.worker_service_coverage coverage_row
      where coverage_row.worker_id=profile.user_id
    ),'[]'::jsonb),
    public.worker_pro_is_active(profile.user_id)
  from public.profiles profile
  where public.user_has_active_workspace(profile.user_id,'worker')
    and coalesce((public._worker_publication_state(profile.user_id)->>'eligible')::boolean,false)
    and profile.worker_status='verified'
    and profile.worker_verified=true
    and profile.available=true
    and public.worker_identity_is_current(profile.user_id)
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
    and (
      p_state is null
      or public.wehouse_state_key(profile.state)=public.wehouse_state_key(p_state)
    )
    and (
      p_city is null
      or profile.city ilike p_city
      or profile.local_government ilike p_city
    )
    and (
      p_occupation is null
      or profile.worker_occupation ilike p_occupation
    )
    and not exists(
      select 1
      from public.worker_user_blocks blocked_pair
      where v_actor is not null
        and (
          (blocked_pair.blocker_user_id=v_actor
            and blocked_pair.blocked_user_id=profile.user_id)
          or
          (blocked_pair.blocker_user_id=profile.user_id
            and blocked_pair.blocked_user_id=v_actor)
        )
    )
  order by profile.rating desc nulls last,profile.review_count desc nulls last;
end
$$;

create or replace function public.get_my_worker_activation()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_identity public.worker_identity_checks;
  v_profile_ready boolean:=false;
  v_identity_required boolean:=public.account_identity_checks_enabled();
  v_identity_current boolean:=false;
  v_identity_gate boolean:=false;
  v_recurring boolean:=public.account_identity_recurring_enabled();
  v_marketplace_enabled boolean:=false;
  v_days integer:=public.account_identity_recheck_days();
  v_due_at timestamptz;
  v_days_remaining integer;
  v_pro_active boolean:=false;
begin
  select * into v_profile
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker')
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_profile.user_id is null then raise exception 'Service Provider profile not found'; end if;

  select coalesce(lower(setting.value) in('true','1','yes','on'),false)
  into v_marketplace_enabled
  from public.platform_settings setting
  where setting.key='worker_marketplace_launch_enabled'
    and setting.is_active=true
  limit 1;

  v_profile_ready:=public.worker_professional_profile_ready(v_profile.user_id);
  select * into v_ver
  from public.worker_verifications verification
  where verification.worker_id=v_profile.user_id
  order by verification.created_at desc
  limit 1;
  select * into v_identity
  from public.worker_identity_checks identity_check
  where identity_check.worker_id=v_profile.user_id;

  v_identity_current:=public.account_identity_is_current(v_profile.user_id);
  v_identity_gate:=not v_identity_required or v_identity_current;
  if v_identity_required and v_recurring and v_identity.captured_at is not null then
    v_due_at:=v_identity.captured_at+make_interval(days=>v_days);
    v_days_remaining:=greatest(
      0,ceil(extract(epoch from (v_due_at-now()))/86400.0)::integer
    );
  end if;
  v_pro_active:=public.worker_pro_is_active(v_profile.user_id);

  return jsonb_build_object(
    'worker_status',coalesce(v_profile.worker_status,'pending'),
    'reviewed',coalesce(
      v_profile.worker_status='verified' and v_profile.worker_verified,false
    ),
    'live',(public._worker_publication_state(v_profile.user_id)->>'publicly_visible')::boolean,
    'publication',public._worker_publication_state(v_profile.user_id),
    'marketplace_enabled',coalesce(v_marketplace_enabled,false),
    'profile_complete',v_profile_ready,
    'payment_status','not_required',
    'payment_required',false,
    'payment_confirmed',true,
    'fee_waived',true,
    'pro_active',v_pro_active,
    'identity_required',v_identity_required,
    'identity_gate_satisfied',v_identity_gate,
    'identity_recurring_required',v_identity_required and v_recurring,
    'identity_status',case
      when not v_identity_required then 'not_required'
      when v_recurring and v_identity.status='passed' and not v_identity_current then 'expired'
      else coalesce(v_identity.status,'not_started')
    end,
    'identity_captured',coalesce(v_identity.status='passed',false),
    'identity_passed',coalesce(v_identity.status='passed',false),
    'identity_current',v_identity_current,
    'identity_captured_at',v_identity.captured_at,
    'identity_due_at',v_due_at,
    'identity_recheck_days',case when v_identity_required and v_recurring then v_days else null end,
    'identity_days_remaining',v_days_remaining,
    'test_passed',true,
    'test_percent',100,
    'test_attempts_24h',0,
    'evidence_saved',coalesce(
      nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is not null,
      false
    ),
    'submitted',coalesce(
      v_profile.worker_status='profile_under_review'
      and v_ver.submitted_at is not null,
      false
    ),
    'review_status',v_ver.status,
    'rejection_reason',(
      select review.rejection_reason
      from public.worker_verification_reviews review
      where review.worker_id=v_profile.user_id
      order by review.created_at desc
      limit 1
    )
  );
end;
$$;

revoke all on function public.creator_get_worker_publication(text) from public,anon;
revoke all on function public.creator_set_worker_publication(text,boolean,text,uuid) from public,anon;
revoke all on function public.creator_set_worker_marketplace(boolean,text,uuid) from public,anon;
revoke all on function public.creator_record_worker_launch_review(text,text,text,timestamptz,timestamptz,uuid) from public,anon;
grant execute on function public.creator_get_worker_publication(text),public.creator_set_worker_publication(text,boolean,text,uuid),
 public.creator_set_worker_marketplace(boolean,text,uuid),public.creator_record_worker_launch_review(text,text,text,timestamptz,timestamptz,uuid) to authenticated,service_role;
insert into public.function_execution_registry(function_signature,function_name,security_mode,public_allowed,anon_allowed,authenticated_allowed,service_role_allowed,review_state,rationale,captured_at)
select p.oid::regprocedure::text,p.proname,'definer',false,false,p.proname<>'_worker_publication_state',true,
 case when p.proname='_worker_publication_state' then 'approved_service_only' else 'approved_client_rpc' end,
 'Creator grant, recent elevation and audit-bound marketplace controls; no subscription requirement or review bypass',now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in('_worker_publication_state','creator_get_worker_publication','creator_set_worker_publication','creator_set_worker_marketplace','creator_record_worker_launch_review')
on conflict(function_signature) do update set public_allowed=false,anon_allowed=false,
 authenticated_allowed=excluded.authenticated_allowed,service_role_allowed=true,review_state=excluded.review_state,rationale=excluded.rationale,captured_at=now();
commit;
