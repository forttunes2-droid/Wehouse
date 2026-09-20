\set ON_ERROR_STOP on
begin;

-- Deterministic date boundaries, including Nigeria's date changing before UTC.
do $$
declare t timestamptz:='2026-09-23 23:30:00+00';
begin
  if not public.property_arrival_allowed('short_let','2026-09-24','2026-09-26',null,'2026-09-24',t) then raise exception 'Nigeria midnight arrival rejected'; end if;
  if public.property_arrival_allowed('short_let','2026-09-25','2026-09-27',null,'2026-09-25',t) then raise exception 'Future date forged early entry'; end if;
  if public.property_arrival_allowed('short_let','2026-09-22','2026-09-24',null,'2026-09-24',t) then raise exception 'Checkout day accepted for entry'; end if;
  if public.property_arrival_allowed('short_let',null,null,null,'2026-09-24',t) then raise exception 'Missing dates accepted'; end if;
  if public.property_arrival_allowed('long_stay',null,null,t+interval '1 hour','2026-09-24',t) then raise exception 'Early Long Let handover accepted'; end if;
  if not public.property_arrival_allowed('long_stay',null,null,t-interval '5 minutes','2026-09-24',t) then raise exception 'Due Long Let handover rejected'; end if;
  if public.property_arrival_allowed('long_stay',null,null,t-interval '1 day','2026-09-24',t) then raise exception 'Different move-in day accepted'; end if;
  if public.property_arrival_allowed('long_stay',null,null,null,'2026-09-24',t) then raise exception 'Unscheduled handover accepted'; end if;
end; $$;

-- Exercise the actual trigger separately from payment fixtures. Scheduling is
-- still permitted; recording physical entry must obey the booked date/time.
create temp table arrival_probe (
  status text, checked_in_at timestamptz, verified_handover_at timestamptz,
  canonical_state text, stay_type text, stay_check_in date, stay_check_out date,
  requested_move_in_at timestamptz, tenancy_start_date date
);
create trigger arrival_probe_guard before insert or update on arrival_probe
for each row execute function public.enforce_actual_property_arrival();
insert into arrival_probe(status,stay_type,requested_move_in_at)
values('ready_for_move_in','long_stay',now()+interval '1 day');
do $$ begin
  begin
    update arrival_probe set status='occupied',tenancy_start_date=timezone('Africa/Lagos',now())::date+1;
    raise exception 'Future appointment was activated early';
  exception when raise_exception then
    if sqlerrm not like 'Arrival must be recorded today%' then raise; end if;
  end;
end; $$;
insert into arrival_probe(status,stay_type,stay_check_in,stay_check_out,tenancy_start_date)
values('occupied','short_let',timezone('Africa/Lagos',now())::date,timezone('Africa/Lagos',now())::date+2,timezone('Africa/Lagos',now())::date);

set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('99999999-1111-4111-8111-000000000001','arrival-ops@example.invalid','arrival-ops','creator',true),
('99999999-1111-4111-8111-000000000002','arrival-guest@example.invalid','arrival-guest','user',true);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status)
values('arrival-ops','creator','global','active');
insert into public.listings(id,listing_id,title,sub_type,state,city,status,availability_status)
values('99999999-2222-4222-8222-000000000001','arrival-property','Contract apartment','short_let','Nasarawa','Lafia','available','available');
insert into public.reservations(id,listing_id,user_id,status,stay_type,stay_check_in,stay_check_out,stay_nights,booking_code,rent_payment_status,rent_paid_at,manual_payment_status)
values('arrival-short','99999999-2222-4222-8222-000000000001','arrival-guest','ready_for_move_in','short_let',timezone('Africa/Lagos',now())::date+2,timezone('Africa/Lagos',now())::date+4,2,'NASWH99991','paid',now(),'pending');
insert into public.hotels(hotel_id,name,state,city,owner_id,timezone,check_in_time,check_out_time)
values(-9999,'Arrival Contract Hotel','Nasarawa','Lafia','arrival-ops','Africa/Lagos','14:00','12:00');
set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','99999999-1111-4111-8111-000000000001',true);
set local role authenticated;
do $$ declare result jsonb; begin
  result:=public.verify_branch_booking_code('NASWH99991');
  if not (result->>'valid')::boolean then raise exception 'Short Let wrongly required a reservation fee'; end if;
  if (result->>'can_check_in')::boolean then raise exception 'Future Short Let enabled check-in'; end if;
  begin
    perform public.confirm_short_stay_check_in_by_code('NASWH99991',timezone('Africa/Lagos',now())::date+2);
    raise exception 'Future date parameter bypassed booking code check';
  exception when raise_exception then
    if sqlerrm not like 'Check-in requires verified stay payment%' then raise; end if;
  end;
end; $$;
reset role;
-- Direct service entry is also guarded, not just the code wrapper.
do $$ begin
  begin
    perform public.activate_short_stay('arrival-short',timezone('Africa/Lagos',now())::date+2);
    raise exception 'Direct activation accepted a future date';
  exception when raise_exception then
    if sqlerrm not like 'Check-in must be recorded today%' then raise; end if;
  end;
end; $$;
update public.workspace_role_assignments set status='revoked' where user_id='arrival-ops';
set local role authenticated;
do $$ begin
  begin
    perform public.verify_branch_booking_code('NASWH99991');
    raise exception 'Revoked Creator retained booking-code access';
  exception when raise_exception then
    if sqlerrm<>'Operations access required' then raise; end if;
  end;
end; $$;
reset role;
create temp table hotel_arrival_probe(hotel_id integer,status text,check_in date,check_out date);
create trigger hotel_arrival_probe_guard before insert or update on hotel_arrival_probe
for each row execute function public.enforce_actual_hotel_arrival();
insert into hotel_arrival_probe values(-9999,'checked_in',timezone('Africa/Lagos',now())::date-1,timezone('Africa/Lagos',now())::date+1);
do $$ begin
  begin
    insert into hotel_arrival_probe values(-9999,'checked_in',timezone('Africa/Lagos',now())::date+1,timezone('Africa/Lagos',now())::date+3);
    raise exception 'Future hotel arrival accepted';
  exception when raise_exception then
    if sqlerrm not like 'Hotel check-in is only available%' then raise; end if;
  end;
end; $$;
rollback;
