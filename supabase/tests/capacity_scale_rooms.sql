\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;
insert into public.hotel_rooms (room_id,hotel_id,room_type,price_per_night,total_rooms)
select -10000000-g,-1000000-g,'Synthetic room',20000+(g%10)*1000,10
from generate_series(:start,:end) g;
commit;
