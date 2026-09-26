-- Creator-controlled Worker market capacity.
-- Capacity limits verified public Workers by State + LGA + occupation.
-- Worker signup/onboarding remains available; the rule is enforced only when a
-- profile is about to become verified/public or moves between capacity buckets.

create table if not exists public.worker_market_capacity(
  capacity_id uuid primary key default gen_random_uuid(),
  state_name text not null,
  state_key text not null,
  lga_name text not null,
  lga_key text not null,
  occupation_name text not null,
  occupation_key text not null,
  target_count integer,
  hard_limit integer,
  approvals_paused boolean not null default false,
  note text,
  updated_by text not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(target_count is null or target_count>=0),
  check(hard_limit is null or hard_limit>=0),
  check(target_count is null or hard_limit is null or target_count<=hard_limit),
  unique(state_key,lga_key,occupation_key)
);

alter table public.worker_market_capacity enable row level security;
revoke all on table public.worker_market_capacity from public,anon,authenticated;
grant all on table public.worker_market_capacity to service_role;

create or replace function public.worker_market_text_key(p_value text)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $$
  select lower(regexp_replace(btrim(coalesce(p_value,'')),'\s+',' ','g'))
$$;
revoke all on function public.worker_market_text_key(text) from public,anon,authenticated;
grant execute on function public.worker_market_text_key(text) to service_role;

create or replace function public.creator_set_worker_market_capacity(
  p_state text,
  p_lga text,
  p_occupation text,
  p_target_count integer,
  p_hard_limit integer,
  p_approvals_paused boolean,
  p_note text,
  p_creator_elevation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_state_key text:=public.wehouse_state_key(p_state);
  v_lga_key text:=public.worker_market_text_key(p_lga);
  v_occupation_key text:=public.worker_market_text_key(p_occupation);
  v_row public.worker_market_capacity;
begin
  if not public.creator_has_elevation(p_creator_elevation_id,'staff_authority') then
    raise exception 'Recent Creator authentication required';
  end if;
  if nullif(v_state_key,'') is null then raise exception 'State is required'; end if;
  if nullif(v_lga_key,'') is null then raise exception 'LGA is required'; end if;
  if nullif(v_occupation_key,'') is null then raise exception 'Occupation is required'; end if;
  if p_target_count is not null and p_target_count<0 then raise exception 'Target cannot be negative'; end if;
  if p_hard_limit is not null and p_hard_limit<0 then raise exception 'Hard limit cannot be negative'; end if;
  if p_target_count is not null and p_hard_limit is not null and p_target_count>p_hard_limit then
    raise exception 'Target cannot be greater than the hard limit';
  end if;

  insert into public.worker_market_capacity(
    state_name,state_key,lga_name,lga_key,occupation_name,occupation_key,
    target_count,hard_limit,approvals_paused,note,updated_by,created_at,updated_at
  ) values(
    btrim(p_state),v_state_key,btrim(p_lga),v_lga_key,btrim(p_occupation),v_occupation_key,
    p_target_count,p_hard_limit,coalesce(p_approvals_paused,false),
    nullif(btrim(coalesce(p_note,'')),''),v_actor,now(),now()
  )
  on conflict(state_key,lga_key,occupation_key) do update set
    state_name=excluded.state_name,
    lga_name=excluded.lga_name,
    occupation_name=excluded.occupation_name,
    target_count=excluded.target_count,
    hard_limit=excluded.hard_limit,
    approvals_paused=excluded.approvals_paused,
    note=excluded.note,
    updated_by=v_actor,
    updated_at=now()
  returning * into v_row;

  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(
    v_actor,'worker_market_capacity_updated','worker_market_capacity',v_row.capacity_id::text,
    jsonb_build_object(
      'state',v_row.state_name,'lga',v_row.lga_name,'occupation',v_row.occupation_name,
      'target_count',v_row.target_count,'hard_limit',v_row.hard_limit,
      'approvals_paused',v_row.approvals_paused
    )::text,now()
  );

  return to_jsonb(v_row);
end
$$;

create or replace function public.creator_remove_worker_market_capacity(
  p_capacity_id uuid,
  p_creator_elevation_id uuid
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_row public.worker_market_capacity;
begin
  if not public.creator_has_elevation(p_creator_elevation_id,'staff_authority') then
    raise exception 'Recent Creator authentication required';
  end if;

  delete from public.worker_market_capacity
  where capacity_id=p_capacity_id
  returning * into v_row;

  if v_row.capacity_id is null then raise exception 'Capacity rule not found'; end if;

  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(
    v_actor,'worker_market_capacity_removed','worker_market_capacity',p_capacity_id::text,
    jsonb_build_object(
      'state',v_row.state_name,'lga',v_row.lga_name,'occupation',v_row.occupation_name
    )::text,now()
  );
  return true;
end
$$;

create or replace function public.creator_get_worker_market_capacity()
returns table(
  capacity_id uuid,
  state_name text,
  lga_name text,
  occupation_name text,
  target_count integer,
  hard_limit integer,
  approvals_paused boolean,
  note text,
  live_count bigint,
  remaining bigint,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select
    rule.capacity_id,
    rule.state_name,
    rule.lga_name,
    rule.occupation_name,
    rule.target_count,
    rule.hard_limit,
    rule.approvals_paused,
    rule.note,
    (
      select count(*)
      from public.profiles worker
      where public.user_has_active_workspace(worker.user_id,'worker')
        and worker.worker_status='verified'
        and worker.worker_verified=true
        and not coalesce(worker.deleted,false)
        and not coalesce(worker.suspended,false)
        and not coalesce(worker.banned,false)
        and public.wehouse_state_key(worker.state)=rule.state_key
        and public.worker_market_text_key(coalesce(nullif(worker.local_government,''),worker.city))=rule.lga_key
        and public.worker_market_text_key(worker.worker_occupation)=rule.occupation_key
    ) as live_count,
    case when rule.hard_limit is null then null
      else greatest(
        rule.hard_limit-(
          select count(*)
          from public.profiles worker
          where public.user_has_active_workspace(worker.user_id,'worker')
            and worker.worker_status='verified'
            and worker.worker_verified=true
            and not coalesce(worker.deleted,false)
            and not coalesce(worker.suspended,false)
            and not coalesce(worker.banned,false)
            and public.wehouse_state_key(worker.state)=rule.state_key
            and public.worker_market_text_key(coalesce(nullif(worker.local_government,''),worker.city))=rule.lga_key
            and public.worker_market_text_key(worker.worker_occupation)=rule.occupation_key
        ),0
      )::bigint
    end as remaining,
    rule.updated_at
  from public.worker_market_capacity rule
  where public.current_actor_has_workspace('creator',null)
  order by rule.state_name,rule.lga_name,rule.occupation_name
$$;

create or replace function public.worker_market_capacity_status(p_worker_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_worker public.profiles;
  v_rule public.worker_market_capacity;
  v_live bigint:=0;
begin
  select * into v_worker
  from public.profiles
  where user_id=p_worker_id
    and public.user_has_active_workspace(user_id,'worker')
    and not coalesce(deleted,false);

  if v_worker.user_id is null then
    return jsonb_build_object('configured',false,'eligible',false,'reason','Worker not found');
  end if;

  select * into v_rule
  from public.worker_market_capacity rule
  where rule.state_key=public.wehouse_state_key(v_worker.state)
    and rule.lga_key=public.worker_market_text_key(coalesce(nullif(v_worker.local_government,''),v_worker.city))
    and rule.occupation_key=public.worker_market_text_key(v_worker.worker_occupation)
  limit 1;

  if v_rule.capacity_id is null then
    return jsonb_build_object(
      'configured',false,'eligible',true,
      'state',v_worker.state,
      'lga',coalesce(nullif(v_worker.local_government,''),v_worker.city),
      'occupation',v_worker.worker_occupation
    );
  end if;

  select count(*) into v_live
  from public.profiles other
  where other.user_id<>v_worker.user_id
    and public.user_has_active_workspace(other.user_id,'worker')
    and other.worker_status='verified'
    and other.worker_verified=true
    and not coalesce(other.deleted,false)
    and not coalesce(other.suspended,false)
    and not coalesce(other.banned,false)
    and public.wehouse_state_key(other.state)=v_rule.state_key
    and public.worker_market_text_key(coalesce(nullif(other.local_government,''),other.city))=v_rule.lga_key
    and public.worker_market_text_key(other.worker_occupation)=v_rule.occupation_key;

  return jsonb_build_object(
    'configured',true,
    'eligible',not v_rule.approvals_paused
      and (v_rule.hard_limit is null or v_live<v_rule.hard_limit),
    'state',v_rule.state_name,
    'lga',v_rule.lga_name,
    'occupation',v_rule.occupation_name,
    'target_count',v_rule.target_count,
    'hard_limit',v_rule.hard_limit,
    'approvals_paused',v_rule.approvals_paused,
    'live_count',v_live,
    'remaining',case when v_rule.hard_limit is null then null else greatest(v_rule.hard_limit-v_live,0) end
  );
end
$$;

create or replace function public.enforce_worker_market_capacity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_old_public boolean:=coalesce(old.worker_status='verified' and old.worker_verified=true,false);
  v_new_public boolean:=coalesce(new.worker_status='verified' and new.worker_verified=true,false);
  v_old_state text:=public.wehouse_state_key(old.state);
  v_new_state text:=public.wehouse_state_key(new.state);
  v_old_lga text:=public.worker_market_text_key(coalesce(nullif(old.local_government,''),old.city));
  v_new_lga text:=public.worker_market_text_key(coalesce(nullif(new.local_government,''),new.city));
  v_old_occupation text:=public.worker_market_text_key(old.worker_occupation);
  v_new_occupation text:=public.worker_market_text_key(new.worker_occupation);
  v_rule public.worker_market_capacity;
  v_live bigint:=0;
begin
  if not v_new_public then return new; end if;
  if v_old_public
     and v_old_state=v_new_state
     and v_old_lga=v_new_lga
     and v_old_occupation=v_new_occupation then
    return new;
  end if;

  select * into v_rule
  from public.worker_market_capacity rule
  where rule.state_key=v_new_state
    and rule.lga_key=v_new_lga
    and rule.occupation_key=v_new_occupation
  limit 1;

  if v_rule.capacity_id is null then return new; end if;
  if v_rule.approvals_paused then
    raise exception 'New % approvals are paused in %, %',
      v_rule.occupation_name,v_rule.lga_name,v_rule.state_name;
  end if;

  if v_rule.hard_limit is not null then
    select count(*) into v_live
    from public.profiles other
    where other.user_id<>new.user_id
      and public.user_has_active_workspace(other.user_id,'worker')
      and other.worker_status='verified'
      and other.worker_verified=true
      and not coalesce(other.deleted,false)
      and not coalesce(other.suspended,false)
      and not coalesce(other.banned,false)
      and public.wehouse_state_key(other.state)=v_rule.state_key
      and public.worker_market_text_key(coalesce(nullif(other.local_government,''),other.city))=v_rule.lga_key
      and public.worker_market_text_key(other.worker_occupation)=v_rule.occupation_key;

    if v_live>=v_rule.hard_limit then
      raise exception '% capacity is full in %, % (% of % verified)',
        v_rule.occupation_name,v_rule.lga_name,v_rule.state_name,v_live,v_rule.hard_limit;
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists profiles_worker_market_capacity_guard on public.profiles;
create trigger profiles_worker_market_capacity_guard
before update of worker_status,worker_verified,state,local_government,city,worker_occupation
on public.profiles
for each row execute function public.enforce_worker_market_capacity();

revoke all on function public.creator_set_worker_market_capacity(text,text,text,integer,integer,boolean,text,uuid) from public,anon,authenticated;
revoke all on function public.creator_remove_worker_market_capacity(uuid,uuid) from public,anon,authenticated;
revoke all on function public.creator_get_worker_market_capacity() from public,anon;
revoke all on function public.worker_market_capacity_status(text) from public,anon;
revoke all on function public.enforce_worker_market_capacity() from public,anon,authenticated;

grant execute on function public.creator_set_worker_market_capacity(text,text,text,integer,integer,boolean,text,uuid) to authenticated,service_role;
grant execute on function public.creator_remove_worker_market_capacity(uuid,uuid) to authenticated,service_role;
grant execute on function public.creator_get_worker_market_capacity() to authenticated,service_role;
grant execute on function public.worker_market_capacity_status(text) to authenticated,service_role;

comment on table public.worker_market_capacity is
  'Creator-set verified Worker capacity by State + LGA + occupation. It never blocks signup or onboarding.';
