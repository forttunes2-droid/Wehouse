begin;
create function pg_temp.expect(p_ok boolean, p_msg text) returns void language plpgsql as $$ begin if not coalesce(p_ok,false) then raise exception 'FAILED: %', p_msg; end if; end $$;

select pg_temp.expect(to_regclass('public.hotel_discounts') is not null, 'hotel_discounts exists');
select pg_temp.expect((select relrowsecurity from pg_class where oid='public.hotel_discounts'::regclass), 'RLS on');
select pg_temp.expect(not has_table_privilege('authenticated','public.hotel_discounts','select'), 'no direct reads');
select pg_temp.expect(to_regprocedure('private.hotel_booking_quote_core_undiscounted(integer,integer,date,date,integer,boolean,boolean)') is not null, 'original quote kept');
select pg_temp.expect(to_regprocedure('private.hotel_discount_for(integer,integer,integer,date)') is not null, 'resolver exists');
select pg_temp.expect(has_function_privilege('authenticated','public.partner_set_hotel_discount(integer,integer,integer,numeric,date)','execute'), 'partners can set');
select pg_temp.expect(not has_function_privilege('anon','public.partner_set_hotel_discount(integer,integer,integer,numeric,date)','execute'), 'anon cannot set');
select pg_temp.expect(not has_function_privilege('authenticated','private.hotel_discount_for(integer,integer,integer,date)','execute'), 'resolver private');
select pg_temp.expect(private.hotel_discount_for(-1,-1,-1,current_date)=0, 'no discount by default');
rollback;
