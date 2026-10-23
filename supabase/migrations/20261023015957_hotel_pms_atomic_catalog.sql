-- Typed, bounded provider input. Never turn missing prices into one-naira offers.
create function private.hotel_pms_integer(value jsonb,label text,minimum integer,maximum integer default 2147483647)
returns integer language plpgsql immutable set search_path=pg_catalog as $$
declare number numeric;
begin
 if value is null or jsonb_typeof(value)<>'number' or value::text!~'^[0-9]+$' then raise exception '% must be a whole number',label;end if;
 number:=value::text::numeric;
 if number<minimum or number>maximum then raise exception '% is outside its supported range',label;end if;
 return number::integer;
end; $$;
create function private.hotel_pms_text_array(value jsonb,label text)
returns text[] language plpgsql immutable set search_path=pg_catalog as $$
declare item jsonb;result text[]:=array[]::text[];
begin
 if value is null then return result;end if;
 if jsonb_typeof(value)<>'array' or jsonb_array_length(value)>50 then raise exception '% must contain at most 50 text items',label;end if;
 for item in select v from jsonb_array_elements(value)v loop
  if jsonb_typeof(item)<>'string' or length(btrim(item#>>'{}')) not between 1 and 100 then raise exception '% contains an invalid item',label;end if;
  result:=array_append(result,btrim(item#>>'{}'));
 end loop;
 return result;
end; $$;
revoke all on function private.hotel_pms_integer(jsonb,text,integer,integer),private.hotel_pms_text_array(jsonb,text) from public,anon,authenticated,service_role;

create function public.apply_hotel_pms_catalog(p_integration_id uuid,p_event_id uuid,p_catalog jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare integration public.hotel_integrations;event public.hotel_integration_events;item jsonb;domain text;source text;
 reference text;room_reference text;label text;v_description text;seen text[];room_id_value integer;rate_id_value integer;
 price integer;capacity integer;quantity integer;room_total integer;room_bed text;tags text[];v_refundable boolean;hours integer;meal text;timing text;v_active boolean;
 inventory_day date;override_price integer;note text;rooms_count integer:=0;rates_count integer:=0;inventory_count integer:=0;receipt jsonb;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service role required';end if;
 select * into integration from public.hotel_integrations where integration_id=p_integration_id for update;
 if integration.integration_id is null or not public.hotel_integration_runtime_active(p_integration_id)
  or not('catalog.write'=any(integration.scopes)) then raise exception 'Active authorized PMS catalog connection required';end if;
 if p_catalog is null or jsonb_typeof(p_catalog)<>'object' or octet_length(p_catalog::text)>262144 then raise exception 'A bounded catalog object is required';end if;
 if p_catalog?'currency' and p_catalog->>'currency'<>'NGN' then raise exception 'Only NGN catalog pricing is supported in this market';end if;
 foreach domain in array array['rooms','rates','inventory'] loop
  if p_catalog?domain then
   if jsonb_typeof(p_catalog->domain)<>'array' or jsonb_array_length(p_catalog->domain)>200 then raise exception '% accepts at most 200 records',domain;end if;
   if not(domain=any(integration.authoritative_domains)) then raise exception 'This connection does not own the % domain',domain;end if;
  end if;
 end loop;
 select * into event from public.hotel_integration_events where integration_event_id=p_event_id and integration_id=p_integration_id
  and direction='inbound' and event_type='catalog_sync' for update;
 if event.integration_event_id is null or event.status<>'pending' then raise exception 'Pending catalog event required';end if;
 source:='pms:'||p_integration_id;seen:=array[]::text[];
 for item in select v from jsonb_array_elements(coalesce(p_catalog->'rooms','[]'))v loop
  reference:=btrim(item->>'external_reference');label:=btrim(item->>'room_type');v_description:=nullif(btrim(item->>'description'),'');room_bed:=nullif(btrim(item->>'bed_type'),'');
  if jsonb_typeof(item)<>'object' or coalesce(length(reference),0) not between 1 and 200 or coalesce(length(label),0) not between 1 and 120
   or length(coalesce(v_description,''))>4000 or length(coalesce(room_bed,''))>120 or reference=any(seen) then raise exception 'Invalid or duplicate PMS room identity/details';end if;
  seen:=array_append(seen,reference);
  price:=private.hotel_pms_integer(item->'base_price','Room base price',1);
  capacity:=private.hotel_pms_integer(item->'max_guests','Room guest capacity',1);
  quantity:=private.hotel_pms_integer(item->'total_rooms','Room inventory',1);
  tags:=private.hotel_pms_text_array(item->'amenities','Room amenities');
  select r.room_id into room_id_value from public.hotel_rooms r where r.hotel_id=integration.hotel_id and r.source_system=source and r.external_reference=reference for update;
  if room_id_value is null then
   insert into public.hotel_rooms(hotel_id,room_type,description,price_per_night,max_guests,bed_type,total_rooms,amenities,source_system,external_reference,images)
   values(integration.hotel_id,label,v_description,price,capacity,room_bed,quantity,tags,source,reference,array[]::text[]) returning room_id into room_id_value;
  else
   update public.hotel_rooms set room_type=label,description=v_description,price_per_night=price,max_guests=capacity,bed_type=room_bed,total_rooms=quantity,amenities=tags,updated_at=now() where room_id=room_id_value;
  end if;
  rooms_count:=rooms_count+1;
 end loop;
 seen:=array[]::text[];
 for item in select v from jsonb_array_elements(coalesce(p_catalog->'rates','[]'))v loop
  reference:=btrim(item->>'external_reference');room_reference:=btrim(item->>'room_external_reference');label:=btrim(item->>'name');v_description:=nullif(btrim(item->>'description'),'');
  if jsonb_typeof(item)<>'object' or coalesce(length(reference),0) not between 1 and 200 or coalesce(length(room_reference),0) not between 1 and 200
   or coalesce(length(label),0) not between 1 and 120 or length(coalesce(v_description,''))>4000 or reference=any(seen)
   or jsonb_typeof(item->'refundable') is distinct from 'boolean' then raise exception 'Invalid or duplicate PMS rate identity/details';end if;
  seen:=array_append(seen,reference);
  select r.room_id into room_id_value from public.hotel_rooms r where r.hotel_id=integration.hotel_id and r.source_system=source and r.external_reference=room_reference;
  if room_id_value is null then raise exception 'Unknown PMS room %',room_reference;end if;
  price:=private.hotel_pms_integer(item->'price_per_night','Nightly rate',1);v_refundable:=(item->>'refundable')::boolean;
  hours:=case when v_refundable then private.hotel_pms_integer(item->'cancellation_hours','Cancellation hours',0,8760) else null end;
  meal:=coalesce(item->>'meal_plan','room_only');timing:=coalesce(item->>'payment_timing','pay_now');
  if meal not in('room_only','breakfast','half_board','full_board','all_inclusive') or timing<>'pay_now' then raise exception 'Unsupported meal plan or payment timing';end if;
  if item?'active' and jsonb_typeof(item->'active')<>'boolean' then raise exception 'Rate active must be true or false';end if;
  v_active:=coalesce((item->>'active')::boolean,true);tags:=private.hotel_pms_text_array(item->'included_features','Rate inclusions');
  select r.rate_plan_id into rate_id_value from public.hotel_rate_plans r where r.hotel_id=integration.hotel_id and r.source_system=source and r.external_reference=reference for update;
  if rate_id_value is null then
   insert into public.hotel_rate_plans(hotel_id,room_id,name,description,meal_plan,payment_timing,refundable,cancellation_hours,cancellation_template,price_per_night,included_features,active,source_system,external_reference)
   values(integration.hotel_id,room_id_value,label,v_description,meal,timing,v_refundable,hours,case when v_refundable then 'standard' else 'non_refundable' end,price,tags,v_active,source,reference);
  else
   update public.hotel_rate_plans set room_id=room_id_value,name=label,description=v_description,meal_plan=meal,payment_timing=timing,
    refundable=v_refundable,cancellation_hours=hours,cancellation_template=case when v_refundable then 'standard' else 'non_refundable' end,
    price_per_night=price,included_features=tags,active=v_active,updated_at=now() where rate_plan_id=rate_id_value;
  end if;
  rates_count:=rates_count+1;
 end loop;
 seen:=array[]::text[];
 for item in select v from jsonb_array_elements(coalesce(p_catalog->'inventory','[]'))v loop
  room_reference:=btrim(item->>'room_external_reference');reference:=nullif(btrim(item->>'external_reference'),'');note:=nullif(btrim(item->>'note'),'');
  if jsonb_typeof(item)<>'object' or coalesce(length(room_reference),0) not between 1 and 200 or length(coalesce(reference,''))>200 or length(coalesce(note,''))>1000
   or coalesce(item->>'date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid inventory identity/date';end if;
  inventory_day:=(item->>'date')::date;
  if room_reference||':'||inventory_day::text=any(seen) then raise exception 'Duplicate room/date inventory';end if;
  seen:=array_append(seen,room_reference||':'||inventory_day::text);
  select r.room_id,r.total_rooms into room_id_value,room_total from public.hotel_rooms r where r.hotel_id=integration.hotel_id and r.source_system=source and r.external_reference=room_reference;
  if room_id_value is null then raise exception 'Unknown PMS room %',room_reference;end if;
  quantity:=private.hotel_pms_integer(item->'available_quantity','Available quantity',0,room_total);
  override_price:=case when item->'rate_override' is null or item->'rate_override'='null'::jsonb then null else private.hotel_pms_integer(item->'rate_override','Nightly rate override',1) end;
  if item?'closed' and jsonb_typeof(item->'closed')<>'boolean' then raise exception 'Inventory closed must be true or false';end if;
  insert into public.hotel_inventory_daily(hotel_id,room_id,inventory_date,available_quantity,rate_override,closed,note,source_system,external_reference)
  values(integration.hotel_id,room_id_value,inventory_day,quantity,override_price,coalesce((item->>'closed')::boolean,false),note,source,reference)
  on conflict(room_id,inventory_date) do update set available_quantity=excluded.available_quantity,rate_override=excluded.rate_override,closed=excluded.closed,note=excluded.note,source_system=excluded.source_system,external_reference=excluded.external_reference,updated_at=now();
  inventory_count:=inventory_count+1;
 end loop;
 receipt:=jsonb_build_object('rooms',rooms_count,'rates',rates_count,'inventory',inventory_count);
 update public.hotel_integrations set last_sync_at=now(),last_error=null,updated_at=now() where integration_id=p_integration_id;
 update public.hotel_integration_events set status='acknowledged',details=receipt,processed_at=now(),acknowledged_at=now(),error_message=null where integration_event_id=p_event_id;
 return receipt;
end; $$;
revoke all on function public.apply_hotel_pms_catalog(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_hotel_pms_catalog(uuid,uuid,jsonb) to service_role;
