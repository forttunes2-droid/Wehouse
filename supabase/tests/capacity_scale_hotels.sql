\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;
insert into public.hotels (hotel_id,name,description,state,city,address,owner_id,status,approved_at,published_at,created_at)
select -1000000-g,'Synthetic scale hotel ' || g,'Disposable capacity fixture','Nasarawa',
  case when g%2=0 then 'Lafia' else 'Keffi' end,'Synthetic address ' || g,
  'load-owner-' || g,'active',now(),now(),now()-g*interval '1 millisecond'
from generate_series(:start,:end) g;
commit;
