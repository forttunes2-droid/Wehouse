begin;
-- Tokens are private delivery credentials, never profile fields or public API rows.
create table public.native_push_devices (
 id uuid primary key default gen_random_uuid(),
 user_id text not null references public.profiles(user_id) on delete cascade,
 auth_id uuid not null references auth.users(id) on delete cascade,
 auth_session_id uuid not null,
 device_id text not null check(length(device_id) between 16 and 128),
 platform text not null check(platform in ('android','ios')),
 token text not null check(length(token) between 32 and 4096),
 enabled boolean not null default true,
 updated_at timestamptz not null default now(),
 unique(platform,token),unique(platform,device_id)
);
alter table public.native_push_devices enable row level security;
revoke all on public.native_push_devices from public,anon,authenticated;
grant all on public.native_push_devices to service_role;
create index native_push_device_recipient_idx on public.native_push_devices(user_id) where enabled;

create table public.native_push_jobs (
 id uuid primary key default gen_random_uuid(),
 device_id uuid not null references public.native_push_devices(id) on delete cascade,
 user_id text not null references public.profiles(user_id) on delete cascade,
 auth_session_id uuid not null,
 activity_event_id uuid not null references public.activity_events(activity_event_id) on delete cascade,
 workspace text not null,
 status text not null default 'queued' check(status in ('queued','sending','sent','cancelled','failed')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '24 hours',
 lease_id uuid,lease_until timestamptz,provider_receipt text,
 last_error text,created_at timestamptz not null default now(),
 unique(device_id,activity_event_id,workspace)
);
alter table public.native_push_jobs enable row level security;
revoke all on public.native_push_jobs from public,anon,authenticated;
grant all on public.native_push_jobs to service_role;
create index native_push_jobs_pending_idx on public.native_push_jobs(available_at) where status in ('queued','sending');

create or replace function public.my_native_push_device(p_device_id text,p_platform text,p_action text default 'status',p_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u text:=public.current_profile_user_id(); a uuid:=(select auth.uid()); s uuid:=nullif((select auth.jwt()->>'session_id'),'')::uuid; d public.native_push_devices%rowtype;
begin
 if u is null or a is null or s is null or not public.auth_session_is_active(a,s) then raise exception 'Active sign-in required'; end if;
 if not exists(select 1 from public.user_sessions x where x.user_id=u and x.auth_id=a::text and x.auth_session_id=s::text and x.device_id=p_device_id and x.is_active and x.trust_status='trusted') then raise exception 'Confirm this device first'; end if;
 if p_platform not in ('android','ios') or p_device_id is null or length(p_device_id) not between 16 and 128 or p_action not in ('status','enable','disable') then raise exception 'Invalid device request'; end if;
 if p_action='enable' then
  if p_token is null or length(p_token) not between 32 and 4096 or p_token !~ '^[A-Za-z0-9_:\-]+$' then raise exception 'Invalid push registration'; end if;
  if p_platform='ios' and p_token !~ '^[a-fA-F0-9]{64,200}$' then raise exception 'Invalid Apple registration'; end if;
  -- Lock account registration to bound concurrent devices; a token rotation replaces this installation.
  perform 1 from public.profiles where user_id=u for update;
  if (select count(*) from public.native_push_devices where user_id=u and enabled and device_id<>p_device_id)>=10 then raise exception 'Notification device limit reached'; end if;
  delete from public.native_push_devices where platform=p_platform and token=p_token and device_id<>p_device_id;
  insert into public.native_push_devices(user_id,auth_id,auth_session_id,device_id,platform,token)
  values(u,a,s,p_device_id,p_platform,p_token)
  on conflict(platform,device_id) do update set user_id=u,auth_id=a,auth_session_id=s,token=p_token,enabled=true,updated_at=now()
  returning * into d;
 elsif p_action='disable' then
  update public.native_push_devices set enabled=false,updated_at=now() where user_id=u and device_id=p_device_id and platform=p_platform returning * into d;
 else
  select * into d from public.native_push_devices where user_id=u and auth_session_id=s and device_id=p_device_id and platform=p_platform;
 end if;
 return jsonb_build_object('device_id',p_device_id,'platform',p_platform,'enabled',coalesce(d.enabled,false));
end $$;
revoke all on function public.my_native_push_device(text,text,text,text) from public,anon;
grant execute on function public.my_native_push_device(text,text,text,text) to authenticated;

create or replace function public.queue_native_activity_push()
returns trigger language plpgsql security definer set search_path='' as $$
declare e public.activity_events%rowtype;
begin
 if new.read_at is not null or new.resolved_at is not null then return new; end if;
 select * into e from public.activity_events where activity_event_id=new.activity_event_id;
 -- No transient events, self alerts, historical backfill or content in the push payload.
 if e.created_at<now()-interval '5 minutes' or e.actor_user_id=new.recipient_user_id
  or e.event_type ~* '(typing|reaction|draft|sync|seen)' then return new; end if;
 insert into public.native_push_jobs(device_id,user_id,auth_session_id,activity_event_id,workspace)
 select d.id,d.user_id,d.auth_session_id,new.activity_event_id,new.workspace from public.native_push_devices d
 where d.user_id=new.recipient_user_id and d.enabled and d.updated_at>now()-interval '90 days'
 and public.auth_session_is_active(d.auth_id,d.auth_session_id)
 on conflict do nothing;
 return new;
end $$;
revoke all on function public.queue_native_activity_push() from public,anon,authenticated;
create trigger native_activity_push after insert on public.activity_event_audiences for each row execute function public.queue_native_activity_push();

create or replace function public.claim_native_push_jobs(p_limit integer default 25)
returns table(job_id uuid,lease_id uuid,platform text,token text,user_id text,activity_event_id uuid,workspace text,attempts integer)
language plpgsql security definer set search_path='' as $$
begin
 if (select auth.role())<>'service_role' then raise exception 'Service role required'; end if;
 update public.native_push_jobs j set status='cancelled',last_error='no_longer_eligible'
 where j.status in ('queued','sending') and (j.expires_at<=now() or not exists(
  select 1 from public.native_push_devices d join public.profiles p on p.user_id=d.user_id
  join public.user_sessions s on s.auth_session_id=d.auth_session_id::text and s.auth_id=d.auth_id::text and s.device_id=d.device_id
  join public.activity_event_audiences a on a.activity_event_id=j.activity_event_id and a.recipient_user_id=j.user_id and a.workspace=j.workspace
  where d.id=j.device_id and d.user_id=j.user_id and d.auth_session_id=j.auth_session_id and d.enabled
   and d.updated_at>now()-interval '90 days' and s.is_active and s.trust_status='trusted'
   and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
   and a.read_at is null and a.resolved_at is null and public.auth_session_is_active(d.auth_id,d.auth_session_id)));
 return query with selected as (
  select j.id from public.native_push_jobs j where j.expires_at>now() and j.attempts<5
   and ((j.status='queued' and j.available_at<=now()) or (j.status='sending' and j.lease_until<now()))
  order by j.available_at for update skip locked limit greatest(1,least(coalesce(p_limit,25),50))
 ), claimed as (
  update public.native_push_jobs j set status='sending',attempts=j.attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes'
  from selected x where j.id=x.id returning j.*
 ) select j.id,j.lease_id,d.platform,d.token,j.user_id,j.activity_event_id,j.workspace,j.attempts
 from claimed j join public.native_push_devices d on d.id=j.device_id;
end $$;
revoke all on function public.claim_native_push_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_native_push_jobs(integer) to service_role;

create or replace function public.finish_native_push_job(p_job_id uuid,p_lease_id uuid,p_outcome text,p_receipt text default null,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.native_push_jobs%rowtype;
begin
 if (select auth.role())<>'service_role' then raise exception 'Service role required'; end if;
 if p_outcome not in ('sent','retry','invalid','failed') then raise exception 'Invalid delivery outcome'; end if;
 select * into j from public.native_push_jobs where id=p_job_id and lease_id=p_lease_id and status='sending' for update;
 if not found then return false; end if;
 if p_outcome='sent' and nullif(p_receipt,'') is null then raise exception 'Provider receipt required'; end if;
 if p_outcome='invalid' then update public.native_push_devices set enabled=false where id=j.device_id and user_id=j.user_id and auth_session_id=j.auth_session_id; end if;
 update public.native_push_jobs set status=case when p_outcome='sent' then 'sent' when p_outcome='retry' and attempts<5 then 'queued' else 'failed' end,
 provider_receipt=left(p_receipt,256),last_error=left(p_error,80),available_at=now()+make_interval(secs=>least(3600,30*(2^attempts)::integer)),lease_until=null
 where id=j.id;
 return true;
end $$;
revoke all on function public.finish_native_push_job(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_native_push_job(uuid,uuid,text,text,text) to service_role;
commit;
