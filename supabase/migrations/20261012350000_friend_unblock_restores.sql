-- Friend Block works like WhatsApp: Unblock restores the Friend and the chat history, with no new request.
-- Only Roommate needs a new connection after Cancel.
alter table public.companions add column if not exists status_before_block text;

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
  update public.companions
     set status_before_block = status, status = 'blocked', blocked_by = actor, responded_at = now(), updated_at = now()
   where user_low = lo and user_high = hi and status in ('pending','accepted');
  get diagnostics n = row_count;
  if n = 0 then
    insert into public.companions(user_low, user_high, requested_by, status, blocked_by, responded_at, status_before_block)
    values (lo, hi, actor, 'blocked', actor, now(), 'removed')
    on conflict (user_low, user_high) do update
      set status_before_block = case when public.companions.status = 'blocked' then public.companions.status_before_block else 'removed' end,
          status = 'blocked', blocked_by = case when public.companions.status = 'blocked' then public.companions.blocked_by else actor end,
          responded_at = now(), updated_at = now();
  end if;
  return jsonb_build_object('blocked', true);
end $$;

create or replace function public.unblock_friend(p_user_id text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); lo text; hi text; c public.companions;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  lo := least(actor, p_user_id); hi := greatest(actor, p_user_id);
  perform pg_advisory_xact_lock(hashtext('companion_bucket:' || lo));
  perform pg_advisory_xact_lock(hashtext('companion_bucket:' || hi));
  select * into c from public.companions where user_low = lo and user_high = hi and status = 'blocked' and blocked_by = actor for update;
  if c.id is null then return jsonb_build_object('unblocked', false); end if;
  if c.status_before_block = 'accepted' then
    update public.companions set status = 'accepted', blocked_by = null, status_before_block = null, updated_at = now() where id = c.id;
  else
    update public.companions set status = 'removed', blocked_by = null, status_before_block = null, responded_at = null, updated_at = now() where id = c.id;
  end if;
  return jsonb_build_object('unblocked', true, 'restored', c.status_before_block = 'accepted');
end $$;
revoke all on function public.block_friend(text), public.unblock_friend(text) from public, anon;
grant execute on function public.block_friend(text), public.unblock_friend(text) to authenticated, service_role;
