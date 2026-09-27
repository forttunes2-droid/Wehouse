\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;
insert into public.listings (listing_id,title,description,price,property_type,sub_type,state,city,address,status,availability_status,approved_at,inspection_request_id,created_at)
select 'load-home-scale-' || g,'Synthetic scale home ' || g,'Disposable capacity fixture',80000+(g%100000),'apartment',
  case when g%3=0 then 'short_let' else 'long_stay' end,'Nasarawa',case when g%2=0 then 'Lafia' else 'Keffi' end,
  'Synthetic address ' || g,'available','available',now(),gen_random_uuid(),now()-g*interval '1 millisecond'
from generate_series(:start,:end) g;
commit;
