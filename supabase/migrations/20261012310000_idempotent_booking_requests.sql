-- Server-side duplicate protection. The browser sends one UUID per intended action;
-- a repeat with the same UUID returns the stored result instead of running again.
create table if not exists public.idempotency_keys (
  user_id uuid not null,
  scope text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, scope, idempotency_key)
);
create index if not exists idempotency_keys_created_idx on public.idempotency_keys (created_at);
alter table public.idempotency_keys enable row level security;
revoke all on public.idempotency_keys from public, anon, authenticated;

create or replace function public.create_short_stay_reservation_idem(
  p_idempotency_key uuid,
  p_listing_id text,
  p_check_in date,
  p_check_out date,
  p_guest_count integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user uuid := auth.uid();
  v_hash text;
  v_existing public.idempotency_keys;
  v_result jsonb;
begin
  if v_user is null then raise exception 'Sign in to book' using errcode='28000'; end if;
  if p_idempotency_key is null then raise exception 'Missing request key' using errcode='22023'; end if;

  v_hash := md5(concat_ws('|', p_listing_id, p_check_in::text, p_check_out::text, p_guest_count::text));
  -- Concurrent duplicates wait here, then read the stored result below.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':reserve:' || p_idempotency_key::text, 0));

  select * into v_existing from public.idempotency_keys
   where user_id = v_user and scope = 'reserve' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'This request key was already used for a different booking' using errcode='22023';
    end if;
    return v_existing.response;
  end if;

  delete from public.idempotency_keys where user_id = v_user and created_at < now() - interval '24 hours';

  v_result := to_jsonb(public.create_short_stay_reservation(p_listing_id, p_check_in, p_check_out, p_guest_count));
  insert into public.idempotency_keys (user_id, scope, idempotency_key, request_hash, response)
  values (v_user, 'reserve', p_idempotency_key, v_hash, v_result);
  return v_result;
end;
$$;

revoke all on function public.create_short_stay_reservation_idem(uuid,text,date,date,integer) from public, anon;
grant execute on function public.create_short_stay_reservation_idem(uuid,text,date,date,integer) to authenticated;

-- Posting a listing twice (double tap, retry after a bad network) returns the first listing.
create or replace function public.create_internal_listing_idem(p_idempotency_key uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user uuid := auth.uid();
  -- Photos are re-uploaded on a retry, so only the identity of the listing is compared.
  v_hash text := md5(concat_ws('|', p_data->>'title', p_data->>'price', p_data->>'state', p_data->>'city'));
  v_existing public.idempotency_keys;
  v_result jsonb;
begin
  if v_user is null then raise exception 'Sign in to post a listing' using errcode='28000'; end if;
  if p_idempotency_key is null then raise exception 'Missing request key' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':listing:' || p_idempotency_key::text, 0));

  select * into v_existing from public.idempotency_keys
   where user_id = v_user and scope = 'listing' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'This request key was already used for a different listing' using errcode='22023';
    end if;
    return v_existing.response;
  end if;

  v_result := to_jsonb(public.create_internal_listing(p_data));
  insert into public.idempotency_keys (user_id, scope, idempotency_key, request_hash, response)
  values (v_user, 'listing', p_idempotency_key, v_hash, v_result);
  return v_result;
end;
$$;

revoke all on function public.create_internal_listing_idem(uuid,jsonb) from public, anon;
grant execute on function public.create_internal_listing_idem(uuid,jsonb) to authenticated;
