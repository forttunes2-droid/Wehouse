-- A booking reference is visible to the hotel team and cannot establish that
-- the guest is at reception. The guest presents a short-lived separate code.
create table private.hotel_stay_proofs (
  booking_id integer primary key references public.hotel_bookings(booking_id) on delete cascade,
  action text not null check (action in ('checked_in','checked_out')),
  salt text not null,
  code_hash text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5)
);
alter table private.hotel_stay_proofs enable row level security;
revoke all on private.hotel_stay_proofs from public, anon, authenticated;

create function public.issue_my_hotel_stay_code(p_booking_id integer, p_action text)
returns text language plpgsql security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_actor text := public.current_profile_user_id();
  v_booking public.hotel_bookings;
  v_hotel public.hotels;
  v_now timestamp;
  v_code text;
  v_salt text;
begin
  if p_action is null or p_action not in ('checked_in','checked_out') then
    raise exception 'Choose arrival or departure';
  end if;
  select * into v_booking from public.hotel_bookings
  where booking_id=p_booking_id for update;
  if v_actor is null or v_booking.booking_id is null or v_booking.user_id<>v_actor then
    raise exception 'This hotel stay is not available to your account';
  end if;
  select * into v_hotel from public.hotels where hotel_id=v_booking.hotel_id;
  v_now:=timezone(v_hotel.timezone,now());
  if v_booking.payment_status<>'paid' then raise exception 'This hotel stay must be paid first'; end if;
  if p_action='checked_in' then
    if coalesce(v_booking.canonical_state,v_booking.status) not in ('confirmed','check_in_ready')
       or v_now<v_booking.check_in::timestamp+v_hotel.check_in_time
       or v_now>=v_booking.check_out::timestamp+v_hotel.check_out_time then
      raise exception 'Check-in opens during the booked arrival window';
    end if;
  elsif coalesce(v_booking.canonical_state,v_booking.status)<>'checked_in' then
    raise exception 'The guest must be checked in before departure';
  end if;
  if exists(select 1 from private.hotel_stay_proofs
            where booking_id=p_booking_id and issued_at>now()-interval '30 seconds') then
    raise exception 'Please wait briefly before requesting another code';
  end if;
  v_code:=lpad(((('x'||encode(extensions.gen_random_bytes(4),'hex'))::bit(32)::bigint)%100000000)::text,8,'0');
  v_salt:=encode(extensions.gen_random_bytes(16),'hex');
  insert into private.hotel_stay_proofs(booking_id,action,salt,code_hash,issued_at,expires_at,attempts)
  values(p_booking_id,p_action,v_salt,encode(extensions.digest(v_salt||v_code,'sha256'),'hex'),now(),now()+interval '10 minutes',0)
  on conflict(booking_id) do update set action=excluded.action,salt=excluded.salt,
    code_hash=excluded.code_hash,issued_at=excluded.issued_at,
    expires_at=excluded.expires_at,attempts=0;
  return v_code;
end;
$$;
revoke all on function public.issue_my_hotel_stay_code(integer,text) from public,anon;
grant execute on function public.issue_my_hotel_stay_code(integer,text) to authenticated;

create function public.partner_confirm_hotel_stay_with_code(
  p_booking_id integer,p_action text,p_code text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_booking public.hotel_bookings;
  v_proof private.hotel_stay_proofs;
  v_result public.hotel_bookings;
begin
  if p_action is null or p_action not in ('checked_in','checked_out') then raise exception 'Unsupported hotel action'; end if;
  select * into v_booking from public.hotel_bookings
  where booking_id=p_booking_id for update;
  if v_booking.booking_id is null then raise exception 'Hotel booking not found'; end if;
  if not public.hotel_actor_has_capability(v_booking.hotel_id,
      case when p_action='checked_in' then 'stay.check_in' else 'stay.check_out' end)
     or (p_action='checked_in' and not public.hotel_actor_has_capability(v_booking.hotel_id,'stay.assign_unit')) then
    raise exception 'Hotel stay capability required';
  end if;
  select * into v_proof from private.hotel_stay_proofs
  where booking_id=p_booking_id for update;
  if v_proof.booking_id is null or v_proof.action<>p_action
      or v_proof.expires_at<=now() or v_proof.attempts>=5 then
    return jsonb_build_object('success',false,'error','Ask the guest for a new code at reception.');
  end if;
  if p_code is null or p_code !~ '^[0-9]{8}$' or
      encode(extensions.digest(v_proof.salt||p_code,'sha256'),'hex')<>v_proof.code_hash then
    -- Return instead of raising: an exception would roll back the attempt count.
    update private.hotel_stay_proofs set attempts=attempts+1 where booking_id=p_booking_id;
    return jsonb_build_object('success',false,'error','Code not accepted. Check the guest’s current code.');
  end if;
  select * into v_result from public.partner_transition_hotel_booking(p_booking_id,p_action);
  delete from private.hotel_stay_proofs where booking_id=p_booking_id;
  update public.hotel_stay_transitions
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('guest_presence_code_verified',true)
  where event_key='hotel_'||p_action||':'||p_booking_id;
  return jsonb_build_object('success',true,'status',v_result.status);
end;
$$;
revoke all on function public.partner_confirm_hotel_stay_with_code(integer,text,text) from public,anon;
grant execute on function public.partner_confirm_hotel_stay_with_code(integer,text,text) to authenticated;

-- The older click-only and shared booking-reference paths would bypass proof.
revoke all on function public.partner_transition_hotel_booking(integer,text) from public,anon,authenticated;
revoke all on function public.confirm_hotel_check_in_by_code(text) from public,anon,authenticated;
