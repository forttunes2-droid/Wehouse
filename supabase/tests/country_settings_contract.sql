begin;
create function pg_temp.expect(p_ok boolean, p_msg text) returns void language plpgsql as $$ begin if not coalesce(p_ok,false) then raise exception 'FAILED: %', p_msg; end if; end $$;
select pg_temp.expect((select relrowsecurity from pg_class where oid='public.platform_countries'::regclass), 'RLS on');
select pg_temp.expect(not has_table_privilege('authenticated','public.platform_countries','insert'), 'users cannot add countries');
select pg_temp.expect(not has_table_privilege('anon','public.platform_countries','update'), 'anon cannot edit countries');
select pg_temp.expect((select count(*) from public.platform_countries where is_default)=1, 'exactly one default');
select pg_temp.expect((select currency_code||time_zone from public.platform_default_country())='NGNAfrica/Lagos', 'Nigeria is the first row');
rollback;
