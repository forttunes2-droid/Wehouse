-- Saved service providers are keyed by their stable profile identity, not worker_services row IDs.
create table if not exists public.saved_service_providers (
  user_id text not null references public.profiles(user_id) on delete cascade,
  worker_id text not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint saved_service_providers_pkey primary key (user_id, worker_id),
  constraint saved_service_providers_not_self check (user_id <> worker_id)
);
create index if not exists saved_service_providers_worker_id_idx
  on public.saved_service_providers(worker_id);

alter table public.saved_service_providers enable row level security;
revoke all on table public.saved_service_providers from public, anon, authenticated;
grant select on table public.saved_service_providers to authenticated;
create policy saved_service_providers_select_own
  on public.saved_service_providers for select to authenticated
  using (user_id = public.current_profile_user_id());

create or replace function public.get_my_saved_service_provider_ids()
returns table(worker_id text, created_at timestamptz)
language sql stable security definer set search_path to 'pg_catalog','public'
as $$
  select saved.worker_id, saved.created_at
  from public.saved_service_providers saved
  where saved.user_id = public.current_profile_user_id()
  order by saved.created_at desc
$$;

create or replace function public.save_my_service_provider(p_worker_id text)
returns void language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare actor_id text := public.current_profile_user_id();
begin
  if (select auth.uid()) is null or actor_id is null then raise exception 'Sign in required'; end if;
  if p_worker_id is null or p_worker_id = actor_id then raise exception 'Choose another service provider'; end if;
  if not exists(select 1 from public.get_public_workers(null,null,null) worker where worker.user_id=p_worker_id) then
    raise exception 'This service provider is not currently available';
  end if;
  insert into public.saved_service_providers(user_id,worker_id)
  values(actor_id,p_worker_id) on conflict(user_id,worker_id) do nothing;
end $$;

create or replace function public.unsave_my_service_provider(p_worker_id text)
returns void language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
begin
  if (select auth.uid()) is null or public.current_profile_user_id() is null then raise exception 'Sign in required'; end if;
  delete from public.saved_service_providers
  where user_id=public.current_profile_user_id() and worker_id=p_worker_id;
end $$;

create or replace function public.get_public_saved_service_providers(p_worker_ids text[])
returns table(
  user_id text, full_name text, username text, avatar_url text, bio text,
  state text, city text, local_government text, area text,
  worker_occupation text, worker_skills jsonb, worker_price integer,
  worker_bio text, worker_experience text, rating numeric, review_count integer,
  is_online boolean, last_seen timestamptz, services jsonb, coverage jsonb,
  pro_active boolean
)
language sql stable security definer set search_path to 'pg_catalog','public'
as $$
  select worker.*
  from public.get_public_workers(null,null,null) worker
  join public.saved_service_providers saved on saved.worker_id=worker.user_id
  where saved.user_id=public.current_profile_user_id()
    and worker.user_id=any(coalesce(p_worker_ids,'{}'::text[]))
  order by saved.created_at desc
$$;

revoke all on function public.get_my_saved_service_provider_ids(), public.save_my_service_provider(text),
  public.unsave_my_service_provider(text), public.get_public_saved_service_providers(text[]) from public, anon;
grant execute on function public.get_my_saved_service_provider_ids(), public.save_my_service_provider(text),
  public.unsave_my_service_provider(text), public.get_public_saved_service_providers(text[]) to authenticated, service_role;
