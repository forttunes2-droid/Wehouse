-- Companion is a mutual relationship (request, then accept) that is separate from Roommate.
-- It exists only to choose who pays with you. It shares no tables, status or chat with Roommate.
-- Also caps payers on a shared payment group at 3 and never above the booking's guest count.

create table if not exists public.companions (
  id uuid primary key default gen_random_uuid(),
  user_low text not null,
  user_high text not null,
  requested_by text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint companions_ordered_pair check (user_low < user_high),
  constraint companions_requester_in_pair check (requested_by in (user_low, user_high)),
  constraint companions_status_check check (status in ('pending','accepted','declined','removed')),
  constraint companions_unique_pair unique (user_low, user_high)
);

alter table public.companions enable row level security;
revoke all on table public.companions from public, anon, authenticated;
grant all on table public.companions to service_role;

create or replace function public.are_companions(p_user_a text, p_user_b text)
returns boolean language sql stable security definer set search_path = 'pg_catalog','public' as $$
  select exists(
    select 1 from public.companions c
    where c.user_low = least(p_user_a, p_user_b)
      and c.user_high = greatest(p_user_a, p_user_b)
      and c.status = 'accepted'
  )
$$;
revoke all on function public.are_companions(text,text) from public, anon, authenticated;
grant execute on function public.are_companions(text,text) to service_role;

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
  if exists(select 1 from public.roommate_user_blocks b
      where (b.blocker_user_id = actor and b.blocked_user_id = p_user_id)
         or (b.blocker_user_id = p_user_id and b.blocked_user_id = actor)) then
    raise exception 'That person cannot receive a companion request';
  end if;

  lo := least(actor, p_user_id); hi := greatest(actor, p_user_id);
  select * into c from public.companions where user_low = lo and user_high = hi for update;
  if c.id is null then
    insert into public.companions(user_low, user_high, requested_by) values (lo, hi, actor) returning * into c;
  elsif c.status in ('pending','accepted') then
    null;
  elsif c.status = 'declined' and c.responded_at > now() - interval '30 days' then
    raise exception 'That person cannot receive a companion request';
  else
    update public.companions set status = 'pending', requested_by = actor, responded_at = null, updated_at = now()
    where id = c.id returning * into c;
  end if;
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
  select * into c from public.companions where id = p_companion_id for update;
  if c.id is null or c.status <> 'pending' or c.requested_by = actor or actor not in (c.user_low, c.user_high) then
    raise exception 'Pending companion request not found';
  end if;
  update public.companions
  set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now(), updated_at = now()
  where id = c.id returning * into c;
  return jsonb_build_object('id', c.id, 'status', c.status);
end $$;

create or replace function public.remove_companion(p_user_id text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); n integer;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  update public.companions set status = 'removed', responded_at = now(), updated_at = now()
  where user_low = least(actor, p_user_id) and user_high = greatest(actor, p_user_id)
    and status in ('pending','accepted');
  get diagnostics n = row_count;
  return jsonb_build_object('removed', n > 0);
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
      'status', c.status,
      'requested_by_me', c.requested_by = actor
    ) order by c.updated_at desc)
    from public.companions c
    join public.profiles other on other.user_id = case when c.user_low = actor then c.user_high else c.user_low end
    where actor in (c.user_low, c.user_high) and c.status in ('pending','accepted')
  ), '[]'::jsonb);
end $$;

revoke all on function public.send_companion_request(text) from public, anon;
revoke all on function public.respond_to_companion_request(uuid,boolean) from public, anon;
revoke all on function public.remove_companion(text) from public, anon;
revoke all on function public.list_my_companions() from public, anon;
grant execute on function public.send_companion_request(text) to authenticated, service_role;
grant execute on function public.respond_to_companion_request(uuid,boolean) to authenticated, service_role;
grant execute on function public.remove_companion(text) to authenticated, service_role;
grant execute on function public.list_my_companions() to authenticated, service_role;

-- Payer cap: at most 3 payers per shared payment group, and never more than the booking's guests.
create or replace function public.guard_shared_payment_member_cap()
returns trigger language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare current_count integer; guests integer;
begin
  if new.invitation_state in ('declined','removed') then return new; end if;
  select count(*) into current_count from public.shared_payment_members m
  where m.shared_payment_group_id = new.shared_payment_group_id
    and m.invitation_state not in ('declined','removed')
    and m.shared_payment_member_id is distinct from new.shared_payment_member_id;
  select g.guest_count into guests from public.shared_payment_groups g
  where g.shared_payment_group_id = new.shared_payment_group_id;
  if current_count + 1 > 3 then
    raise exception 'At most 3 people can pay for one stay';
  end if;
  if guests is not null and current_count + 1 > guests then
    raise exception 'Paying people cannot exceed the number of guests';
  end if;
  return new;
end $$;
revoke all on function public.guard_shared_payment_member_cap() from public, anon, authenticated;
grant execute on function public.guard_shared_payment_member_cap() to service_role;

drop trigger if exists shared_payment_member_cap on public.shared_payment_members;
create trigger shared_payment_member_cap
  before insert or update of invitation_state on public.shared_payment_members
  for each row execute function public.guard_shared_payment_member_cap();
