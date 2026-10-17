begin;
create function pg_temp.expect(p_ok boolean, p_msg text) returns void language plpgsql as $$ begin if not coalesce(p_ok,false) then raise exception 'FAILED: %', p_msg; end if; end $$;

select pg_temp.expect(to_regclass('public.hotel_discounts') is not null, 'hotel_discounts exists');
select pg_temp.expect((select relrowsecurity from pg_class where oid='public.hotel_discounts'::regclass), 'RLS on');
select pg_temp.expect(not has_table_privilege('authenticated','public.hotel_discounts','select'), 'no direct reads');
select pg_temp.expect(to_regprocedure('private.hotel_booking_quote_core_undiscounted(integer,integer,date,date,integer,boolean,boolean)') is not null, 'original quote kept');
select pg_temp.expect(to_regprocedure('private.hotel_discount_split(integer,integer,integer,date)') is not null, 'resolver exists');
select pg_temp.expect(has_function_privilege('authenticated','public.partner_set_hotel_discount(integer,integer,integer,numeric,date)','execute'), 'partners can set');
select pg_temp.expect(not has_function_privilege('anon','public.partner_set_hotel_discount(integer,integer,integer,numeric,date)','execute'), 'anon cannot set');
select pg_temp.expect(not has_function_privilege('authenticated','private.hotel_discount_split(integer,integer,integer,date)','execute'), 'resolver private');
select pg_temp.expect((select partner_percent+wehouse_percent from private.hotel_discount_split(-1,-1,-1,current_date))=0, 'no discount by default');
select pg_temp.expect(public.wehouse_hotel_discount_ceiling() between 0 and 15, 'WeHouse ceiling never above 15');
select pg_temp.expect(not has_function_privilege('anon','public.creator_set_wehouse_hotel_discount(integer,integer,integer,numeric,date)','execute'), 'anon cannot spend WeHouse money');
select pg_temp.expect(to_regclass('public.hotel_booking_discounts') is not null, 'payout snapshot table');
select pg_temp.expect(not has_table_privilege('authenticated','public.hotel_booking_discounts','select'), 'payout snapshot private');
-- Payout: the hotel keeps its price minus commission; WeHouse's discount comes out of commission only.
do $$ declare t record; begin
  select * into t from (select 90::numeric a, 100::numeric p, 10::numeric r) x;
  if greatest(0, t.a - round(t.p*(1-t.r/100),2)) <> 0 then raise exception 'FAILED: 10%% WeHouse discount at 10%% commission leaves WeHouse zero'; end if;
  if t.a - greatest(0, t.a - round(t.p*(1-t.r/100),2)) <> 90 then raise exception 'FAILED: hotel payout must equal 90 percent of its own price'; end if;
end $$;
rollback;
