-- A Friend is a request that is sent and accepted. Either person can Block, which ends the Friendship,
-- stops chat and shared-payment use, and prevents new requests in either direction. Only the person
-- who blocked can Unblock, and Unblock does not restore the Friendship: they would have to ask again.
alter table public.companions add column if not exists blocked_by text;
alter table public.companions drop constraint if exists companions_status_check;
alter table public.companions add constraint companions_status_check
  check (status in ('pending','accepted','declined','removed','blocked'));

create or replace function public.block_friend(p_user_id text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); lo text; hi text; n integer;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if p_user_id is null or p_user_id = actor then raise exception 'Choose another person'; end if;
  lo := least(actor, p_user_id); hi := greatest(actor, p_user_id);
  perform pg_advisory_xact_lock(hashtext('companion_bucket:' || lo));
  perform pg_advisory_xact_lock(hashtext('companion_bucket:' || hi));
  update public.companions set status = 'blocked', blocked_by = actor, responded_at = now(), updated_at = now()
  where user_low = lo and user_high = hi and status in ('pending','accepted');
  get diagnostics n = row_count;
  if n = 0 then
    insert into public.companions(user_low, user_high, requested_by, status, blocked_by, responded_at)
    values (lo, hi, actor, 'blocked', actor, now())
    on conflict (user_low, user_high) do update
      set status = 'blocked', blocked_by = actor, responded_at = now(), updated_at = now()
      where public.companions.status <> 'blocked';
  end if;
  return jsonb_build_object('blocked', true);
end $$;

create or replace function public.unblock_friend(p_user_id text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); n integer;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  update public.companions set status = 'removed', blocked_by = null, responded_at = null, updated_at = now()
  where user_low = least(actor, p_user_id) and user_high = greatest(actor, p_user_id)
    and status = 'blocked' and blocked_by = actor;
  get diagnostics n = row_count;
  return jsonb_build_object('unblocked', n > 0);
end $$;

-- A blocked pair gets the same neutral refusal as a full list, so the block is not revealed.
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
  if c.id is not null and c.status = 'blocked' then
    raise exception 'That person cannot receive a companion request';
  end if;
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

-- The list also returns people I blocked, so I can Unblock them. The blocked person never sees the block.
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
      and (c.status = 'accepted'
           or (c.status = 'pending' and c.updated_at > now() - public.companion_request_expiry())
           or (c.status = 'blocked' and c.blocked_by = actor))
  ), '[]'::jsonb);
end $$;

revoke all on function public.block_friend(text), public.unblock_friend(text), public.send_companion_request(text), public.list_my_companions() from public, anon;
grant execute on function public.block_friend(text), public.unblock_friend(text), public.send_companion_request(text), public.list_my_companions() to authenticated, service_role;
