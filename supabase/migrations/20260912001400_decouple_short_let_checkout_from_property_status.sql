-- Short Let checkout completes the stay reservation only.
-- Maintenance/closure are separate explicit property operations; they must not be
-- implicit side effects of a normal checkout or a stale client default.

create or replace function public.complete_short_stay(
  p_reservation_id text,
  p_next_status text default 'available'
)
returns public.reservations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_result public.reservations;
begin
  -- Retain the legacy parameter for client compatibility only. Property status
  -- changes now go through the explicit listing-operations RPC.
  perform p_next_status;

  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role in ('staff','admin','creator')
    and coalesce(deleted,false)=false
    and coalesce(suspended,false)=false
    and coalesce(banned,false)=false
  limit 1;

  if v_actor is null then raise exception 'Housing operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations permission required';
  end if;

  select * into v_res
  from public.reservations
  where id=p_reservation_id
    and stay_type='short_let'
    and status='occupied'
  for update;
  if v_res is null then raise exception 'Active Short Stay not found'; end if;

  select * into v_listing
  from public.listings
  where id::text=v_res.listing_id
  for update;
  if v_listing is null then raise exception 'Short Stay listing not found'; end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Listing is outside your assigned State/LGA';
  end if;

  update public.reservations
  set status='completed',
      completed_at=now(),
      processed_by=v_actor.user_id,
      processed_at=now(),
      security_deposit_status=case
        when coalesce(security_deposit_snapshot,0)>0 then 'refund_due'
        else 'not_required'
      end,
      updated_at=now()
  where id=v_res.id
  returning * into v_result;

  -- Clean old listing-wide pointers only. Do not change publication/availability.
  update public.listings
  set reserved_by=null,
      reservation_expiry=null,
      occupied_by=null,
      occupied_at=null,
      tenancy_ends_at=null,
      current_reservation_id=null,
      updated_at=now()
  where id=v_listing.id
    and current_reservation_id=v_res.id;

  return v_result;
end;
$$;

comment on function public.complete_short_stay(text,text)
is 'Completes one dated Short Let stay. It never changes listing publication/operational status; maintenance or closure requires a separate explicit property operation.';
