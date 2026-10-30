-- Friend requests expire if unanswered, and one person can only send a limited number per day.
-- Both numbers live here so they can be changed in one place.
create or replace function public.companion_request_expiry()
returns interval language sql immutable set search_path = 'pg_catalog' as $$ select interval '24 hours' $$;
create or replace function public.companion_daily_request_cap()
returns integer language sql immutable set search_path = 'pg_catalog' as $$ select 10 $$;
revoke all on function public.companion_request_expiry(), public.companion_daily_request_cap() from public, anon, authenticated;
grant execute on function public.companion_request_expiry(), public.companion_daily_request_cap() to service_role;

create table if not exists public.companion_request_log (
  id bigint generated always as identity primary key,
  sender text not null,
  created_at timestamptz not null default now()
);
create index if not exists companion_request_log_sender_idx on public.companion_request_log (sender, created_at desc);
alter table public.companion_request_log enable row level security;
revoke all on public.companion_request_log from public, anon, authenticated;
grant all on public.companion_request_log to service_role;

-- An unanswered request stops holding a slot once it has expired.
create or replace function public.companion_bucket_count(p_user_id text)
returns integer language sql stable security definer set search_path = 'pg_catalog','public' as $$
  select count(*)::integer from public.companions c
  where p_user_id in (c.user_low, c.user_high)
    and (c.status = 'accepted'
         or (c.status = 'pending' and c.requested_by = p_user_id and c.updated_at > now() - public.companion_request_expiry()))
$$;

create or replace function public.send_companion_request(p_user_id text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  lo text; hi text; c public.companions;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if p_user_id is null or p_user_id = actor then
    raise exception 'Choose another person';
  end if;
  if not exists(select 1 from public.profiles p where p.user_id = p_user_id and p.account_kind = 'consumer'
      and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)) then
    raise exception 'That person cannot receive a companion request';
  end if;
  perform pg_advisory_xact_lock(hashtext('companion_bucket:' || least(actor, p_user_id)));
  perform pg_advisory_xact_lock(hashtext('companion_bucket:' || greatest(actor, p_user_id)));

  lo := least(actor, p_user_id); hi := greatest(actor, p_user_id);
  select * into c from public.companions where user_low = lo and user_high = hi for update;
  if c.id is not null and (c.status = 'accepted'
      or (c.status = 'pending' and c.updated_at > now() - public.companion_request_expiry())) then
    return jsonb_build_object('id', c.id, 'status', c.status, 'requested_by_me', c.requested_by = actor);
  end if;
  if c.id is not null and c.status in ('declined','removed') and c.responded_at > now() - public.companion_rerequest_wait() then
    raise exception 'That person cannot receive a companion request';
  end if;
  if (select count(*) from public.companion_request_log l
      where l.sender = actor and l.created_at > now() - interval '24 hours') >= public.companion_daily_request_cap() then
    raise exception 'You have sent many requests today. Try again tomorrow';
  end if;
  if public.companion_bucket_count(actor) >= 5 then
    raise exception 'Your Companion list is full. Remove a Companion to add another';
  end if;
  if public.companion_bucket_count(p_user_id) >= 5 then
    raise exception 'That person cannot receive a companion request';
  end if;

  if c.id is null then
    insert into public.companions(user_low, user_high, requested_by) values (lo, hi, actor) returning * into c;
  else
    update public.companions set status = 'pending', requested_by = actor, responded_at = null, updated_at = now()
    where id = c.id returning * into c;
  end if;
  insert into public.companion_request_log(sender) values (actor);
  return jsonb_build_object('id', c.id, 'status', c.status, 'requested_by_me', c.requested_by = actor);
end $$;

create or replace function public.respond_to_companion_request(p_companion_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  c public.companions;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  select * into c from public.companions where id = p_companion_id;
  if c.id is not null then
    perform pg_advisory_xact_lock(hashtext('companion_bucket:' || c.user_low));
    perform pg_advisory_xact_lock(hashtext('companion_bucket:' || c.user_high));
  end if;
  select * into c from public.companions where id = p_companion_id for update;
  if c.id is null or c.status <> 'pending' or c.requested_by = actor or actor not in (c.user_low, c.user_high)
     or c.updated_at <= now() - public.companion_request_expiry() then
    raise exception 'Pending companion request not found';
  end if;
  if p_accept then
    if public.companion_bucket_count(actor) >= 5 then
      raise exception 'Your Companion list is full. Remove a Companion to add another';
    end if;
  end if;
  update public.companions
  set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now(), updated_at = now()
  where id = c.id returning * into c;
  return jsonb_build_object('id', c.id, 'status', c.status);
end $$;

create or replace function public.list_my_companions()
returns jsonb language plpgsql stable security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id();
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'companion_id', c.id,
      'user_id', other.user_id,
      'full_name', other.full_name,
      'username', other.username,
      'status', c.status,
      'requested_by_me', c.requested_by = actor
    ) order by c.updated_at desc)
    from public.companions c
    join public.profiles other on other.user_id = case when c.user_low = actor then c.user_high else c.user_low end
    where actor in (c.user_low, c.user_high)
      and (c.status = 'accepted' or (c.status = 'pending' and c.updated_at > now() - public.companion_request_expiry()))
  ), '[]'::jsonb);
end $$;

revoke all on function public.send_companion_request(text), public.respond_to_companion_request(uuid,boolean), public.list_my_companions() from public, anon;
grant execute on function public.send_companion_request(text), public.respond_to_companion_request(uuid,boolean), public.list_my_companions() to authenticated, service_role;
