-- A checkout attempt is not yet a booking. Keep its internal payment reference,
-- but create the customer-facing LGA booking code only after payment succeeds.
alter table public.reservations alter column booking_code drop not null;

create or replace function public.set_reservation_booking_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lga text;
begin
  if tg_op = 'UPDATE' then
    if new.status in ('cancelled', 'expired')
       and coalesce(new.manual_payment_status, 'unpaid') not in ('paid', 'completed')
       and new.paid_at is null then
      new.booking_code := null;
      return new;
    end if;

    if nullif(btrim(coalesce(old.booking_code, '')), '') is not null then
      new.booking_code := old.booking_code;
      return new;
    end if;
  end if;

  if nullif(btrim(coalesce(new.booking_code, '')), '') is not null then
    insert into public.booking_code_registry(code)
    values (upper(btrim(new.booking_code)))
    on conflict do nothing;
    new.booking_code := upper(btrim(new.booking_code));
    return new;
  end if;

  if new.status in ('reserved', 'inspection_pending', 'ready_for_move_in', 'occupied', 'completed', 'refunded')
     and (coalesce(new.manual_payment_status, 'unpaid') in ('paid', 'completed') or new.paid_at is not null) then
    select coalesce(nullif(btrim(l.city), ''), nullif(btrim(l.state), ''), 'General')
    into v_lga
    from public.listings l
    where l.id::text = new.listing_id or l.listing_id = new.listing_id
    limit 1;

    new.booking_code := public.reserve_lga_booking_code(coalesce(v_lga, 'General'));
  else
    new.booking_code := null;
  end if;

  return new;
end;
$$;

drop trigger if exists set_reservation_booking_code_trigger on public.reservations;
create trigger set_reservation_booking_code_trigger
before insert or update of booking_code, status, manual_payment_status, paid_at
on public.reservations
for each row execute function public.set_reservation_booking_code();

-- Remove codes that were allocated to abandoned checkout attempts by the old trigger.
update public.reservations
set booking_code = null,
    updated_at = now()
where status in ('payment_pending', 'cancelled', 'expired')
  and coalesce(manual_payment_status, 'unpaid') not in ('paid', 'completed')
  and paid_at is null
  and booking_code is not null;

-- Activity is a current, useful timeline rather than an archive of every transient
-- state. New-login alerts remain outside Activity and disappear shortly after review.
create or replace function public.prune_my_activity()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient text := public.current_profile_user_id();
  v_deleted integer := 0;
  v_step integer := 0;
begin
  if v_recipient is null then raise exception 'Authenticated profile required'; end if;

  delete from public.notifications n
  where n.recipient_id = v_recipient
    and (
      (n.type in ('new_device_login', 'device_confirmation_pending')
        and ((n.read and n.created_at < now() - interval '1 day') or n.created_at < now() - interval '30 days'))
      or (n.type ~* '(^|_)(message|reply|replied|chat)(_|$)'
        and ((n.read and n.created_at < now() - interval '1 day') or n.created_at < now() - interval '30 days'))
      or (n.type ~* '(payment|payout|earning|refund|dispute)'
        and ((n.read and n.created_at < now() - interval '30 days') or n.created_at < now() - interval '90 days'))
      or (n.type ~* '(roommate|match|invite|interest)'
        and ((n.read and n.created_at < now() - interval '3 days') or n.created_at < now() - interval '14 days'))
      or (n.type ~* '(booking|reservation|inspection|listing|property|hotel|job|worker|verification|password|security)'
        and ((n.read and n.created_at < now() - interval '7 days') or n.created_at < now() - interval '30 days'))
      or (n.created_at < now() - interval '30 days')
      or (n.read and n.created_at < now() - interval '7 days')
    );
  get diagnostics v_deleted = row_count;

  -- For one booking, payment, job or match, retain its newest lifecycle state.
  delete from public.notifications older
  using public.notifications newer
  where older.recipient_id = v_recipient
    and newer.recipient_id = older.recipient_id
    and nullif(older.source_type, '') is not null
    and nullif(older.source_id, '') is not null
    and newer.source_type = older.source_type
    and newer.source_id = older.source_id
    and (newer.created_at, newer.id) > (older.created_at, older.id)
    and older.type ~* '(payment|payout|earning|refund|dispute|roommate|match|invite|interest|booking|reservation|inspection|listing|property|hotel|job|worker|verification|status)';
  get diagnostics v_step = row_count;
  return v_deleted + v_step;
end;
$$;

-- Worker rating and review count are derived only from reviews attached to completed
-- WeHouse jobs. This prevents deleted test jobs/reviews from leaking into discovery.
create or replace function public.refresh_worker_review_summary(p_worker_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles p
  set rating = coalesce(summary.average_rating, 0),
      review_count = summary.review_total,
      updated_at = now()
  from (
    select round(avg(r.rating)::numeric, 2) as average_rating,
           count(*)::integer as review_total
    from public.worker_booking_reviews r
    join public.worker_bookings b on b.id = r.booking_id
    where r.worker_id = p_worker_id
      and b.worker_id = p_worker_id
      and b.status = 'approved_released'
  ) summary
  where p.user_id = p_worker_id;
$$;

create or replace function public.sync_worker_review_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'worker_booking_reviews' then
    if tg_op <> 'INSERT' then perform public.refresh_worker_review_summary(old.worker_id); end if;
    if tg_op <> 'DELETE' then perform public.refresh_worker_review_summary(new.worker_id); end if;
  else
    if tg_op <> 'INSERT' then perform public.refresh_worker_review_summary(old.worker_id); end if;
    if tg_op <> 'DELETE' then perform public.refresh_worker_review_summary(new.worker_id); end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists worker_review_summary_after_review on public.worker_booking_reviews;
create trigger worker_review_summary_after_review
after insert or update or delete on public.worker_booking_reviews
for each row execute function public.sync_worker_review_summary();

drop trigger if exists worker_review_summary_after_booking on public.worker_bookings;
create trigger worker_review_summary_after_booking
after insert or update of status, worker_id or delete on public.worker_bookings
for each row execute function public.sync_worker_review_summary();

create or replace function public.get_worker_marketplace_trust(p_worker_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker public.profiles;
  v_enabled boolean := false;
  v_min_jobs integer := 5;
  v_min_rating numeric := 4.5;
  v_max_cancel numeric := 20;
  v_block_disputes boolean := true;
  v_completed integer := 0;
  v_worker_cancelled integer := 0;
  v_open_disputes integer := 0;
  v_review_count integer := 0;
  v_rating numeric := 0;
  v_cancel_rate numeric := 0;
  v_trusted boolean := false;
begin
  select * into v_worker
  from public.profiles
  where user_id = p_worker_id and role = 'worker'
    and worker_status = 'verified' and worker_verified = true and available = true
    and not coalesce(deleted, false) and not coalesce(suspended, false) and not coalesce(banned, false)
  limit 1;
  if v_worker is null then return jsonb_build_object('reviewed', false, 'trusted', false); end if;

  select coalesce(lower(value) in ('true','1','yes','on'), false) into v_enabled from public.platform_settings where key='worker_trust_enabled' and is_active=true limit 1;
  select coalesce(nullif(value,''),'5')::integer into v_min_jobs from public.platform_settings where key='worker_trusted_min_completed_jobs' and is_active=true limit 1;
  select coalesce(nullif(value,''),'4.5')::numeric into v_min_rating from public.platform_settings where key='worker_trusted_min_rating' and is_active=true limit 1;
  select coalesce(nullif(value,''),'20')::numeric into v_max_cancel from public.platform_settings where key='worker_trusted_max_cancel_rate' and is_active=true limit 1;
  select coalesce(lower(value) in ('true','1','yes','on'), true) into v_block_disputes from public.platform_settings where key='worker_trusted_block_open_disputes' and is_active=true limit 1;

  select count(*) into v_completed from public.worker_bookings where worker_id=p_worker_id and status='approved_released';
  select count(*) into v_worker_cancelled from public.worker_bookings where worker_id=p_worker_id and status='cancelled' and cancelled_by=p_worker_id;
  select count(*) into v_open_disputes from public.worker_bookings where worker_id=p_worker_id and status='disputed';
  select coalesce(round(avg(r.rating)::numeric, 2), 0), count(*)::integer
  into v_rating, v_review_count
  from public.worker_booking_reviews r
  join public.worker_bookings b on b.id=r.booking_id
  where r.worker_id=p_worker_id and b.worker_id=p_worker_id and b.status='approved_released';

  if v_completed + v_worker_cancelled > 0 then
    v_cancel_rate := round((v_worker_cancelled::numeric * 100) / (v_completed + v_worker_cancelled), 2);
  end if;
  v_trusted := coalesce(v_enabled,false) and v_completed >= coalesce(v_min_jobs,5)
    and v_rating >= coalesce(v_min_rating,4.5)
    and v_cancel_rate <= coalesce(v_max_cancel,20)
    and (not coalesce(v_block_disputes,true) or v_open_disputes=0);

  return jsonb_build_object(
    'reviewed', true, 'trusted', v_trusted, 'trusted_enabled', coalesce(v_enabled,false),
    'completed_jobs', v_completed, 'rating', v_rating, 'review_count', v_review_count,
    'worker_cancel_rate', v_cancel_rate, 'open_disputes', v_open_disputes,
    'label', case when v_trusted then 'WeHouse Trusted' else 'WeHouse Reviewed' end
  );
end;
$$;

-- Reconcile existing profile aggregates after earlier test-data cleanup.
do $$
declare worker_row record;
begin
  for worker_row in select user_id from public.profiles where role='worker' loop
    perform public.refresh_worker_review_summary(worker_row.user_id);
  end loop;
end;
$$;

revoke all on function public.refresh_worker_review_summary(text) from public, anon, authenticated;
revoke all on function public.sync_worker_review_summary() from public, anon, authenticated;
grant execute on function public.refresh_worker_review_summary(text) to service_role;
grant execute on function public.sync_worker_review_summary() to service_role;
