\set ON_ERROR_STOP on
\echo 'Hotel city-only index plan'
explain (analyze,buffers) select h.hotel_id
from public.hotels h
where h.status='active' and h.approved_at is not null and h.published_at is not null
  and lower(h.city)=lower('Lafia')
order by h.featured desc,h.created_at desc,h.hotel_id desc
limit 25;
\echo 'Public hotel city RPC execution'
explain (analyze,buffers)
select public.search_discoverable_hotels(p_city=>'Lafia',p_limit=>24);
\echo 'Public hotel price RPC execution'
explain (analyze,buffers)
select public.search_discoverable_hotels(p_min_price=>22000,p_max_price=>24000,p_limit=>24);
\echo 'Price-filtered hotel RPC returns a complete bounded page'
do $$
declare v_result jsonb;
begin
  v_result:=public.search_discoverable_hotels(p_min_price=>22000,p_max_price=>24000,p_limit=>24);
  if jsonb_array_length(v_result->'items')<>24 then
    raise exception 'Price-filtered hotel discovery must return 24 matching rows for the scale fixture';
  end if;
end
$$;
