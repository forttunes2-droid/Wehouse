-- Extend the existing booking identity; a retry must not reserve another room.
alter table public.hotel_bookings add column request_key uuid;
create unique index hotel_booking_request_key on public.hotel_bookings(user_id,request_key) where request_key is not null;
create index hotel_booking_live_hold_owner on public.hotel_bookings(user_id,payment_expires_at) where status='pending' and payment_status<>'paid';

-- Keep the same fixed-window counter and service-only API used by Edge handlers.
create function private.consume_user_action(p_user_key text,p_action text,p_max_attempts integer,p_window_seconds integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare budget public.user_action_rate_limits;window_length interval;
begin
 if coalesce(p_max_attempts,0)<1 or coalesce(p_window_seconds,0)<1 or p_window_seconds>86400 then raise exception 'Invalid rate limit settings';end if;
 window_length:=make_interval(secs=>p_window_seconds);
 insert into public.user_action_rate_limits as limits(user_key,action,window_started_at,attempt_count,updated_at)
 values(p_user_key,p_action,now(),1,now()) on conflict(user_key,action) do update set
  window_started_at=case when limits.window_started_at<=now()-window_length then now() else limits.window_started_at end,
  attempt_count=case when limits.window_started_at<=now()-window_length then 1 else limits.attempt_count+1 end,updated_at=now() returning * into budget;
 return jsonb_build_object('allowed',budget.attempt_count<=p_max_attempts,'retry_after_seconds',case when budget.attempt_count<=p_max_attempts then 0 else greatest(1,ceil(extract(epoch from(budget.window_started_at+window_length-now())))::integer) end);
end $$;
revoke all on function private.consume_user_action(text,text,integer,integer) from public,anon,authenticated,service_role;
create or replace function public.consume_user_action_from_service(p_user_key text,p_action text,p_max_attempts integer,p_window_seconds integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if coalesce(nullif(auth.jwt()->>'role',''),current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'service role required';end if;
 return private.consume_user_action(p_user_key,p_action,p_max_attempts,p_window_seconds);
end $$;
revoke all on function public.consume_user_action_from_service(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_user_action_from_service(text,text,integer,integer) to service_role;
create or replace function private.experience_write_budget(p_actor text,p_action text default 'experience_activity_write') returns void
language plpgsql security definer set search_path='' as $$
begin
 if not (private.consume_user_action(p_actor,p_action,30,60)->>'allowed')::boolean then raise exception 'Too many activity requests. Wait a minute and try again';end if;
end $$;
revoke all on function private.experience_write_budget(text,text) from public,anon,authenticated,service_role;

create function private.hotel_checkout_actor() returns text language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();
begin
 if actor is null or not public._property_document_session_active() or not public.current_actor_has_personal_workspace() then raise exception 'Active trusted Personal session required' using errcode='42501';end if;
 return actor;
end $$;
revoke all on function private.hotel_checkout_actor() from public,anon,authenticated,service_role;
create function private.validate_hotel_checkout_dates(p_in date,p_out date) returns void language plpgsql stable set search_path='' as $$
begin
 if p_in is null or p_out is null then raise exception 'Choose future stay dates within the next year' using errcode='22023';end if;
 if not isfinite(p_in) or not isfinite(p_out) then raise exception 'Choose finite stay dates' using errcode='22023';end if;
 if p_in<=current_date or p_out<=p_in or p_out>current_date+366 or p_out-p_in>365 then
  raise exception 'Choose future stay dates within the next year' using errcode='22023';end if;
end $$;
revoke all on function private.validate_hotel_checkout_dates(date,date) from public,anon,authenticated,service_role;
do $$declare definition text;needle text:=E'begin\n';begin
 definition:=replace(pg_get_functiondef('public.quote_hotel_room_rate(integer,integer,integer,date,date)'::regprocedure),E'\r\n',E'\n');
 if strpos(definition,needle)=0 then raise exception 'Inspect the Hotel quote entry point';end if;
 execute replace(definition,needle,needle||' perform private.validate_hotel_checkout_dates(p_check_in,p_check_out);'||chr(10));
end $$;

do $$declare definition text;needle text;begin
 definition:=replace(pg_get_functiondef('private.hotel_booking_quote_core_undiscounted(integer,integer,date,date,integer,boolean,boolean)'::regprocedure),E'\r\n',E'\n');
 needle:='  if p_check_in is null or p_check_out is null or p_check_out<=p_check_in then';
 if strpos(definition,needle)=0 then raise exception 'Inspect the bounded Hotel inventory calculation';end if;
 execute replace(definition,needle,$bounds$
  if not isfinite(p_check_in) or not isfinite(p_check_out) then raise exception 'Choose finite stay dates' using errcode='22023';end if;
  if p_check_out-p_check_in>365 then raise exception 'A Hotel availability request cannot exceed 365 nights' using errcode='22023';end if;
$bounds$||needle);
end $$;

create function private.hotel_booking_has_recorded_payment(p_booking_id integer) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hotel_bookings where booking_id=p_booking_id and (payment_status='paid' or payment_protection_id is not null))
  or exists(select 1 from public.booking_payments where hotel_booking_id=p_booking_id and (status='paid' or verified_at is not null));
$$;
revoke all on function private.hotel_booking_has_recorded_payment(integer) from public,anon,authenticated,service_role;

do $$declare definition text;needle text;begin
 definition:=replace(pg_get_functiondef('public.create_hotel_booking_payment(integer)'::regprocedure),E'\r\n',E'\n');
 needle:=E'begin\n';if strpos(definition,needle)=0 then raise exception 'Inspect Hotel payment session guard';end if;
 definition:=replace(definition,needle,needle||'  perform private.hotel_checkout_actor();'||chr(10));
 needle:='  if v_booking.status<>''pending'' then';
 if strpos(definition,needle)=0 then raise exception 'Inspect Hotel payment recorded-charge guard';end if;
 definition:=replace(definition,needle,$guard$
  if private.hotel_booking_has_recorded_payment(v_booking.booking_id) then
    raise exception 'Payment is already recorded. Open the booking to check its stay or review status before paying again';end if;
$guard$||needle);
 execute definition;
end $$;

create function public.create_my_hotel_booking_with_rate(
 p_request_key uuid,p_hotel_id integer,p_room_id integer,p_rate_plan_id integer,p_check_in date,p_check_out date,
 p_guest_count integer,p_guest_name text,p_guest_phone text,p_special_requests text default null
) returns public.hotel_bookings language plpgsql security definer set search_path='' as $$
declare actor text:=private.hotel_checkout_actor();booking public.hotel_bookings;
begin
 if p_request_key is null then raise exception 'A checkout request reference is required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hotel-checkout:'||actor,0));
 select * into booking from public.hotel_bookings where user_id=actor and request_key=p_request_key;
 if booking.booking_id is not null then
  if booking.hotel_id is distinct from p_hotel_id or booking.room_id is distinct from p_room_id or booking.rate_plan_id is distinct from p_rate_plan_id
   or booking.check_in is distinct from p_check_in or booking.check_out is distinct from p_check_out or booking.guest_count is distinct from p_guest_count
   or booking.guest_name is distinct from btrim(p_guest_name) or booking.guest_phone is distinct from btrim(p_guest_phone)
   or booking.special_requests is distinct from nullif(btrim(p_special_requests),'') then raise exception 'These choices differ from your existing room hold. Refresh the hold before editing';end if;
  return booking;
 end if;
 perform private.validate_hotel_checkout_dates(p_check_in,p_check_out);
 if p_guest_count is null or p_guest_count<1 or length(btrim(coalesce(p_guest_name,''))) not between 1 and 120
  or length(btrim(coalesce(p_guest_phone,''))) not between 1 and 40 or coalesce(length(p_special_requests),0)>1200 then raise exception 'Check the guest name, phone number, guests and request length';end if;
 if p_guest_phone !~ '^[+0-9() .-]+$' or length(regexp_replace(p_guest_phone,'[^0-9]','','g')) not between 7 and 15 then raise exception 'Enter a phone number with 7–15 digits, including its country code when needed';end if;
 if (select count(*) from public.hotel_bookings where user_id=actor and status='pending' and payment_status<>'paid' and payment_expires_at>now())>=10 then raise exception 'Complete or release an existing room hold before starting another checkout';end if;
 if not (private.consume_user_action(actor,'hotel_booking_write',30,60)->>'allowed')::boolean then raise exception 'Too many checkout requests. Wait a minute and try again';end if;
 booking:=public.create_my_hotel_booking_with_rate(p_hotel_id,p_room_id,p_rate_plan_id,p_check_in,p_check_out,p_guest_count,p_guest_name,p_guest_phone,p_special_requests);
 update public.hotel_bookings set request_key=p_request_key where booking_id=booking.booking_id returning * into booking;
 return booking;
end $$;
revoke all on function public.create_my_hotel_booking_with_rate(uuid,integer,integer,integer,date,date,integer,text,text,text) from public,anon;
grant execute on function public.create_my_hotel_booking_with_rate(uuid,integer,integer,integer,date,date,integer,text,text,text) to authenticated;
-- Preserve the original implementation for trusted server callers; browsers use
-- the request-key overload, with the same existing price/inventory triggers.
revoke all on function public.create_my_hotel_booking_with_rate(integer,integer,integer,date,date,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.create_my_hotel_booking_with_rate(integer,integer,integer,date,date,integer,text,text,text) to service_role;

create function public.get_my_hotel_booking_hold(p_request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.hotel_checkout_actor();booking public.hotel_bookings;
begin
 if p_request_key is null then raise exception 'Choose a checkout request reference';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hotel-checkout:'||actor,0));
 select * into booking from public.hotel_bookings where user_id=actor and request_key=p_request_key;
 return case when booking.booking_id is null then null else to_jsonb(booking)||jsonb_build_object('payment_recorded',private.hotel_booking_has_recorded_payment(booking.booking_id)) end;
end $$;
revoke all on function public.get_my_hotel_booking_hold(uuid) from public,anon;
grant execute on function public.get_my_hotel_booking_hold(uuid) to authenticated;

-- Editing a stale unpaid screen must never invoke paid cancellation/refund.
create function public.release_my_hotel_booking_hold(p_booking_id integer) returns boolean language plpgsql security definer set search_path='' as $$
declare actor text:=private.hotel_checkout_actor();booking public.hotel_bookings;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hotel-checkout:'||actor,0));
 perform 1 from public.booking_payments where hotel_booking_id=p_booking_id and user_id=actor and purpose='hotel_booking' order by id for update;
 select * into booking from public.hotel_bookings where booking_id=p_booking_id and user_id=actor for update;
 if booking.booking_id is null then raise exception 'Room hold unavailable' using errcode='42501';end if;
 if private.hotel_booking_has_recorded_payment(p_booking_id) then
  raise exception 'Payment is already recorded. Open your booking to review its cancellation options';end if;
 if booking.status in('cancelled','expired') then return true;end if;
 if booking.status<>'pending' then raise exception 'This booking cannot be released as an unpaid room hold';end if;
 return public.cancel_my_hotel_booking(p_booking_id);
end $$;
revoke all on function public.release_my_hotel_booking_hold(integer) from public,anon;
grant execute on function public.release_my_hotel_booking_hold(integer) to authenticated;

create function private.preserve_hotel_request_key() returns trigger language plpgsql set search_path='' as $$
begin if old.request_key is not null and new.request_key is distinct from old.request_key then raise exception 'A checkout request reference cannot be changed';end if;return new;end $$;
revoke all on function private.preserve_hotel_request_key() from public,anon,authenticated,service_role;
create trigger preserve_hotel_request_key before update of request_key on public.hotel_bookings for each row execute function private.preserve_hotel_request_key();
