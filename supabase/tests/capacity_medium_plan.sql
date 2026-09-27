\timing on
\echo 'Home feed index and heap plan'
explain (analyze,buffers) select l.id
from public.listings l
where l.deleted_at is null and l.inspection_request_id is not null
  and l.approved_at is not null and l.status='available'
  and l.availability_status='available'
  and (l.property_type is null or l.property_type <> 'hotel')
order by l.created_at desc,l.id desc limit 25;
\echo 'Home city filter plan'
explain (analyze,buffers) select l.id
from public.listings l
where l.deleted_at is null and l.inspection_request_id is not null
  and l.approved_at is not null and l.status='available'
  and l.availability_status='available'
  and (l.property_type is null or l.property_type <> 'hotel')
  and lower(l.city)=lower('Lafia')
order by l.created_at desc,l.id desc limit 25;
\echo 'Public home RPC plan'
explain (analyze,buffers) select public.search_discoverable_homes(p_limit=>24);
\echo 'Public home city RPC plan'
explain (analyze,buffers) select public.search_discoverable_homes(p_city=>'Lafia',p_limit=>24);
\echo 'Temporary local experiment: force a parameter-specific plan'
alter function public.search_discoverable_homes(text,text,text,text,numeric,numeric,integer,integer,timestamptz,uuid,integer)
  set plan_cache_mode = 'force_custom_plan';
explain (analyze,buffers) select public.search_discoverable_homes(p_limit=>24);
explain (analyze,buffers) select public.search_discoverable_homes(p_city=>'Lafia',p_limit=>24);
