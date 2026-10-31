begin;
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
select pg_temp.expect(private.hotel_booking_deadline(date '2026-10-31',date '2026-11-02','Africa/Lagos',time '18:00',timestamptz '2026-10-31 16:59:59+00')=timestamptz '2026-10-31 17:00+00','same-day cutoff uses Hotel time');
select pg_temp.expect(private.hotel_booking_deadline(date '2026-10-30',date '2026-11-01','America/New_York',time '23:00',timestamptz '2026-10-31 02:00+00')=timestamptz '2026-10-31 03:00+00','the Hotel calendar can differ from UTC');
select pg_temp.expect(private.hotel_booking_deadline(date '2026-11-01',date '2026-11-02','America/New_York',time '01:30',timestamptz '2026-11-01 05:45+00')=timestamptz '2026-11-01 06:30+00','repeated DST cutoff uses the later occurrence');
select pg_temp.expect(private.hotel_booking_deadline(date '2026-03-08',date '2026-03-09','America/New_York',time '02:30',timestamptz '2026-03-08 06:00+00')=timestamptz '2026-03-08 07:30+00','missing DST cutoff moves forward consistently');
select pg_temp.expect(private.hotel_booking_deadline(date '2026-11-01',date '2026-11-02','Africa/Lagos',null,timestamptz '2026-10-31 18:00+00') is null,'future stays need no same-day cutoff');
do $$begin
 begin perform private.hotel_booking_deadline('2026-10-31','2026-11-01','Africa/Lagos',null,'2026-10-31 12:00+00');raise exception 'FAIL: unconfigured Hotel accepted today';exception when invalid_parameter_value then null;end;
 begin perform private.hotel_booking_deadline('2026-10-31','2026-11-01','Africa/Lagos','18:00','2026-10-31 17:00+00');raise exception 'FAIL: cutoff boundary remained open';exception when invalid_parameter_value then null;end;
 begin perform private.hotel_booking_deadline('2026-10-30','2026-11-01','Africa/Lagos','18:00','2026-10-31 12:00+00');raise exception 'FAIL: past check-in accepted';exception when invalid_parameter_value then null;end;
 begin perform private.hotel_booking_deadline('infinity','infinity','Africa/Lagos','18:00','2026-10-31 12:00+00');raise exception 'FAIL: unbounded dates accepted';exception when invalid_parameter_value then null;end;
 begin perform private.hotel_booking_deadline('2026-10-31','2027-11-03','Africa/Lagos','18:00','2026-10-31 12:00+00');raise exception 'FAIL: booking horizon expanded';exception when invalid_parameter_value then null;end;
end$$;
select pg_temp.expect(not has_function_privilege('anon','public.partner_update_hotel_stay_policy(integer,time,time,time,timestamptz)','execute'),'anonymous callers cannot set Hotel policy');
select pg_temp.expect(not has_function_privilege('authenticated','private.hotel_booking_deadline(date,date,text,time,timestamptz)','execute'),'clients cannot choose the admission clock');
select 'PASS: Hotel-local same-day deadlines, disabled/closed windows, DST and closed helper permissions' result;
rollback;
