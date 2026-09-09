-- Finish the inspected-property approval path and give Short Let bookings their
-- own customer, Operations and Property Partner lifecycle.

create or replace function public.wehouse_state_key(p_value text)
returns text
language sql
immutable
set search_path = 'pg_catalog'
as $function$
  select regexp_replace(
    regexp_replace(lower(btrim(coalesce(p_value,''))), '[^a-z0-9]+', '', 'g'),
    'state$',
    ''
  );
$function$;

create or replace function public.wehouse_lga_key(p_value text)
returns text
language sql
immutable
set search_path = 'pg_catalog'
as $function$
  select regexp_replace(
    regexp_replace(lower(btrim(coalesce(p_value,''))), '[^a-z0-9]+', '', 'g'),
    '(localgovernmentarea|lga)$',
    ''
  );
$function$;

create or replace function public.current_actor_in_scope(p_state text, p_lga text)
returns boolean
language plpgsql
stable
security definer
set search_path = 'pg_catalog','public'
as $function$
declare v_actor public.profiles;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then return false; end if;
  if v_actor.role='creator' then return true; end if;
  if v_actor.role not in ('admin','staff') then return false; end if;
  return nullif(public.wehouse_state_key(coalesce(nullif(btrim(v_actor.assigned_state),''),v_actor.state)),'') is not null
    and nullif(public.wehouse_lga_key(coalesce(nullif(btrim(v_actor.assigned_lga),''),v_actor.local_government,v_actor.city)),'') is not null
    and public.wehouse_state_key(coalesce(nullif(btrim(v_actor.assigned_state),''),v_actor.state))=public.wehouse_state_key(p_state)
    and public.wehouse_lga_key(coalesce(nullif(btrim(v_actor.assigned_lga),''),v_actor.local_government,v_actor.city))=public.wehouse_lga_key(p_lga);
end;
$function$;

revoke all on function public.wehouse_state_key(text) from public,anon;
revoke all on function public.wehouse_lga_key(text) from public,anon;
revoke all on function public.current_actor_in_scope(text,text) from public,anon;
grant execute on function public.current_actor_in_scope(text,text) to authenticated,service_role;

create or replace function public.post_property_from_inspection(p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  v_caller public.profiles;
  v_ir public.inspection_requests;
  v_partner public.profiles;
  v_listing_id uuid;
  v_code text;
  v_images text[];
  v_videos text[];
  v_amenities text[];
  v_sub_type text;
  v_deposit numeric;
begin
  select * into v_caller
  from public.profiles
  where auth_id=auth.uid()::text
    and role in ('staff','admin','creator')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_caller is null then raise exception 'WeHouse operations access required'; end if;
  if v_caller.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations permission required';
  end if;

  select * into v_ir
  from public.inspection_requests
  where id=(p_data->>'inspection_id')::uuid
  for update;
  if v_ir is null or v_ir.status not in ('completed','approved') then
    raise exception 'Inspection must be completed before listing preparation';
  end if;
  if v_caller.role in ('admin','staff') and not public.current_actor_in_scope(v_ir.property_state,v_ir.property_city) then
    raise exception 'Property is outside your assigned branch';
  end if;
  if v_ir.property_type='hotel' then raise exception 'Hotels use the hotel preparation workflow'; end if;

  if v_ir.draft_listing_id is not null then
    select id into v_listing_id
    from public.listings
    where id=v_ir.draft_listing_id
      and inspection_request_id=v_ir.id
      and deleted_at is null
    limit 1;
    if v_listing_id is not null then return v_listing_id; end if;
    update public.inspection_requests
    set draft_listing_id=null,updated_at=now()
    where id=v_ir.id;
  end if;

  select * into v_partner
  from public.profiles
  where user_id=v_ir.owner_id
    and role='property_partner'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_partner is null then raise exception 'Valid Property Partner owner required'; end if;
  if nullif(btrim(p_data->>'title'),'') is null or coalesce((p_data->>'price')::numeric,0)<=0 then
    raise exception 'Listing title and valid price are required';
  end if;

  v_sub_type:=coalesce(nullif(btrim(p_data->>'sub_type'),''),v_ir.sub_type);
  if v_sub_type not in ('short_let','long_stay') then
    raise exception 'Choose Short Let or Long Let before preparing this apartment';
  end if;
  v_deposit:=coalesce(nullif(p_data->>'security_deposit_amount','')::numeric,v_ir.security_deposit_amount);
  if v_sub_type='short_let' and coalesce(v_deposit,0)<=0 then
    raise exception 'Short Let requires a refundable security deposit';
  end if;
  if v_sub_type='long_stay' then v_deposit:=null; end if;

  select coalesce(array_agg(value),array[]::text[]) into v_images
  from jsonb_array_elements_text(coalesce(p_data->'images','[]'::jsonb));
  select coalesce(array_agg(value),array[]::text[]) into v_videos
  from jsonb_array_elements_text(coalesce(p_data->'videos','[]'::jsonb));
  select coalesce(array_agg(distinct value),array[]::text[]) into v_amenities
  from jsonb_array_elements_text(coalesce(p_data->'amenities',to_jsonb(coalesce(v_ir.amenities,array[]::text[]))));
  if v_sub_type='short_let' and not ('Furnished'=any(coalesce(v_amenities,array[]::text[]))) then
    v_amenities:=array_append(coalesce(v_amenities,array[]::text[]),'Furnished');
  end if;

  v_code:='WHL-'||upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 12));
  insert into public.listings(
    listing_id,title,description,price,currency,state,city,address,images,videos,bedrooms,bathrooms,
    property_type,sub_type,security_deposit_amount,amenities,availability_status,owner_id,partner_id,
    chat_agent_id,status,submitted_by_role,reservation_fee_paid,chat_unlocked,gps_latitude,gps_longitude,
    inspection_request_id,created_at,updated_at
  ) values (
    v_code,btrim(p_data->>'title'),nullif(btrim(p_data->>'description'),''),(p_data->>'price')::numeric,'NGN',
    v_ir.property_state,v_ir.property_city,v_ir.property_address,v_images,v_videos,
    coalesce((p_data->>'bedrooms')::int,v_ir.bedrooms,1),coalesce((p_data->>'bathrooms')::int,v_ir.bathrooms,1),
    coalesce(nullif(btrim(p_data->>'property_type'),''),v_ir.property_type,'apartment'),v_sub_type,v_deposit,v_amenities,
    'pending_approval',v_partner.user_id,v_partner.user_id,v_caller.user_id,'pending_approval','property_partner',false,false,
    v_ir.gps_latitude,v_ir.gps_longitude,v_ir.id,now(),now()
  ) returning id into v_listing_id;

  update public.inspection_requests
  set draft_listing_id=v_listing_id,sub_type=v_sub_type,security_deposit_amount=v_deposit,amenities=v_amenities,updated_at=now()
  where id=v_ir.id;
  return v_listing_id;
end;
$function$;

revoke all on function public.post_property_from_inspection(jsonb) from public,anon;
grant execute on function public.post_property_from_inspection(jsonb) to authenticated,service_role;

create or replace function public.get_my_short_stay_operations_v2()
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare v_actor public.profiles; v_result jsonb;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role in ('staff','admin','creator')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Housing operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations permission required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'reservation_id',r.id,
    'booking_code',r.booking_code,
    'status',r.status,
    'payment_status',r.rent_payment_status,
    'reservation_fee_paid',(r.manual_payment_status in ('paid','completed') and r.paid_at is not null),
    'check_in',r.stay_check_in,
    'check_out',r.stay_check_out,
    'nights',r.stay_nights,
    'guest_count',coalesce(r.guest_count,1),
    'nightly_rate',r.nightly_rate_snapshot,
    'stay_rent_total',r.stay_rent_total,
    'security_deposit',r.security_deposit_snapshot,
    'security_deposit_status',r.security_deposit_status,
    'customer_user_id',r.user_id,
    'customer_name',coalesce(p.full_name,p.username,p.email),
    'customer_phone',p.phone,
    'listing_id',l.id,
    'listing_title',l.title,
    'state',l.state,
    'lga',l.city,
    'address',l.address,
    'listing_status',l.status
  ) order by r.stay_check_in asc,r.created_at asc),'[]'::jsonb) into v_result
  from public.reservations r
  join public.listings l on l.id::text=r.listing_id
  left join public.profiles p on p.user_id=r.user_id
  where r.stay_type='short_let'
    and r.status in ('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
    and (v_actor.role='creator' or public.current_actor_in_scope(l.state,l.city));
  return v_result;
end;
$function$;

revoke all on function public.get_my_short_stay_operations_v2() from public,anon;
grant execute on function public.get_my_short_stay_operations_v2() to authenticated,service_role;

create or replace function public.verify_branch_booking_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  v_actor public.profiles;
  v_code text:=upper(btrim(coalesce(p_code,'')));
  v_result jsonb;
  v_state text;
  v_lga text;
begin
  if v_code !~ '^[A-Z]{3}WH[0-9]{5}$' then raise exception 'Enter a valid WeHouse booking code'; end if;
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role in ('staff','admin','creator')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations module required';
  end if;

  select jsonb_build_object(
    'kind','housing','code',r.booking_code,'status',r.status,'payment_status',r.rent_payment_status,
    'reservation_fee_status',r.manual_payment_status,'stay_type',coalesce(r.stay_type,'long_stay'),
    'customer_name',coalesce(p.full_name,p.username,r.user_email),'customer_phone',coalesce(p.phone,r.user_phone),
    'property_name',coalesce(l.title,r.listing_title),'state',l.state,'lga',l.city,'reservation_id',r.id,
    'listing_id',r.listing_id,'check_in',r.stay_check_in,'check_out',r.stay_check_out,
    'guest_count',coalesce(r.guest_count,1),'tenancy_start_date',r.tenancy_start_date,'tenancy_end_date',r.tenancy_end_date,
    'valid',(r.manual_payment_status in ('paid','completed') and r.paid_at is not null),
    'can_handover',(coalesce(r.stay_type,'long_stay')='long_stay' and r.status='ready_for_move_in'
      and r.manual_payment_status in ('paid','completed') and r.paid_at is not null
      and r.rent_payment_status in ('paid','upfront_paid') and r.rent_paid_at is not null),
    'can_check_in',(r.stay_type='short_let' and r.status='ready_for_move_in'
      and r.manual_payment_status in ('paid','completed') and r.paid_at is not null
      and r.rent_payment_status='paid' and r.rent_paid_at is not null
      and current_date>=r.stay_check_in and current_date<r.stay_check_out)
  ),l.state,l.city
  into v_result,v_state,v_lga
  from public.reservations r
  join public.listings l on l.id::text=r.listing_id or l.listing_id=r.listing_id
  left join public.profiles p on p.user_id=r.user_id
  where r.booking_code=v_code
  limit 1;

  if v_result is null then
    select jsonb_build_object(
      'kind','hotel','code',hb.booking_code,'status',hb.status,'payment_status',hb.payment_status,
      'customer_name',coalesce(p.full_name,p.username,hb.guest_name),'customer_phone',coalesce(p.phone,hb.guest_phone),
      'property_name',h.name,'state',h.state,'lga',h.city,'booking_id',hb.booking_id,'hotel_id',hb.hotel_id,
      'check_in',hb.check_in,'check_out',hb.check_out,'guest_count',hb.guest_count,
      'valid',(hb.payment_status='paid' and hb.status not in ('cancelled','refunded')),
      'can_check_in',(hb.payment_status='paid' and hb.status in ('confirmed','paid')
        and current_date>=hb.check_in and current_date<hb.check_out)
    ),h.state,h.city
    into v_result,v_state,v_lga
    from public.hotel_bookings hb
    join public.hotels h on h.hotel_id=hb.hotel_id
    left join public.profiles p on p.user_id=hb.user_id
    where hb.booking_code=v_code
    limit 1;
  end if;
  if v_result is null then return null; end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_state,v_lga) then
    raise exception 'This booking belongs to another WeHouse branch';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.verify_branch_booking_code(text) from public,anon;
grant execute on function public.verify_branch_booking_code(text) to authenticated,service_role;

create or replace function public.confirm_short_stay_check_in_by_code(
  p_booking_code text,
  p_check_in_date date default current_date
)
returns public.reservations
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare v_verified jsonb; v_result public.reservations;
begin
  v_verified:=public.verify_branch_booking_code(p_booking_code);
  if v_verified is null
    or v_verified->>'kind'<>'housing'
    or v_verified->>'stay_type'<>'short_let'
  then
    raise exception 'Enter a valid Short Let booking code';
  end if;
  select public.activate_short_stay(v_verified->>'reservation_id',p_check_in_date)
  into v_result;
  return v_result;
end;
$function$;

revoke all on function public.confirm_short_stay_check_in_by_code(text,date) from public,anon;
grant execute on function public.confirm_short_stay_check_in_by_code(text,date) to authenticated,service_role;

create or replace function public.get_my_property_partner_stays(p_listing_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare v_actor public.profiles; v_result jsonb;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and role='property_partner'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;

  select coalesce(jsonb_agg(to_jsonb(stay) order by stay.created_at desc),'[]'::jsonb)
  into v_result
  from (
    select
      r.id as reservation_id,
      r.booking_code,
      coalesce(r.stay_type,'long_stay') as stay_type,
      r.status,
      r.rent_payment_status as payment_status,
      r.stay_check_in as check_in,
      r.stay_check_out as check_out,
      r.stay_nights as nights,
      coalesce(r.guest_count,1) as guest_count,
      r.tenancy_start_date,
      r.tenancy_end_date,
      r.created_at,
      l.id::text as listing_id,
      l.listing_id as public_listing_code,
      l.title as listing_title
    from public.reservations r
    join public.listings l on l.id::text=r.listing_id
    where (l.owner_id=v_actor.user_id or l.partner_id=v_actor.user_id)
      and (p_listing_id is null or l.id::text=p_listing_id or l.listing_id=p_listing_id)
      and (
        (r.manual_payment_status in ('paid','completed') and r.paid_at is not null)
        or r.status in ('occupied','completed')
      )
    order by r.created_at desc
    limit 50
  ) stay;
  return v_result;
end;
$function$;

revoke all on function public.get_my_property_partner_stays(text) from public,anon;
grant execute on function public.get_my_property_partner_stays(text) to authenticated,service_role;

create or replace function public.notify_property_partner_reservation_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  v_listing public.listings;
  v_partner_id text;
  v_stage text;
  v_title text;
  v_message text;
begin
  select * into v_listing
  from public.listings
  where id::text=new.listing_id or listing_id=new.listing_id
  limit 1;
  if v_listing is null then return new; end if;
  v_partner_id:=coalesce(v_listing.partner_id,v_listing.owner_id);
  if v_partner_id is null then return new; end if;

  if new.status='completed' and (tg_op='INSERT' or old.status is distinct from new.status) then
    v_stage:='checkout';
    v_title:=case when new.stay_type='short_let' then 'Guest checked out' else 'Tenancy completed' end;
    v_message:=case when new.stay_type='short_let'
      then format('The guest has checked out of %s. Deposit review remains with WeHouse.',v_listing.title)
      else format('The tenancy at %s has been completed.',v_listing.title) end;
  elsif new.status='occupied' and (tg_op='INSERT' or old.status is distinct from new.status) then
    v_stage:='checkin';
    v_title:=case when new.stay_type='short_let' then 'Guest checked in' else 'Tenant moved in' end;
    v_message:=case when new.stay_type='short_let'
      then format('The guest has checked in to %s for the booked dates.',v_listing.title)
      else format('The tenant has received access to %s.',v_listing.title) end;
  elsif new.status='ready_for_move_in'
    and new.rent_payment_status in ('paid','upfront_paid')
    and (tg_op='INSERT' or old.status is distinct from new.status or old.rent_payment_status is distinct from new.rent_payment_status)
  then
    v_stage:='arrival_ready';
    v_title:=case when new.stay_type='short_let' then 'Short Let ready for check-in' else 'Tenancy ready for handover' end;
    v_message:=case when new.stay_type='short_let'
      then format('%s is paid and ready for guest check-in on %s.',v_listing.title,to_char(new.stay_check_in,'DD Mon YYYY'))
      else format('%s is paid and ready for verified handover.',v_listing.title) end;
  elsif new.manual_payment_status in ('paid','completed')
    and new.paid_at is not null
    and (tg_op='INSERT' or old.manual_payment_status is distinct from new.manual_payment_status or old.paid_at is distinct from new.paid_at)
  then
    v_stage:='reserved';
    v_title:=case when new.stay_type='short_let' then 'New Short Let booking' else 'New property reservation' end;
    v_message:=case when new.stay_type='short_let'
      then format('%s was booked from %s to %s.',v_listing.title,to_char(new.stay_check_in,'DD Mon YYYY'),to_char(new.stay_check_out,'DD Mon YYYY'))
      else format('%s now has an active reservation moving through WeHouse Operations.',v_listing.title) end;
  else
    return new;
  end if;

  insert into public.notifications(
    recipient_id,type,title,message,related_id,source_type,source_id,destination_route,
    destination_params,event_key,workspace_scope,read,created_at
  ) values (
    v_partner_id,'property_booking',v_title,v_message,v_listing.id::text,'property_booking',new.id,
    'property_detail',jsonb_build_object('listing_id',v_listing.id::text,'reservation_id',new.id),
    'property_partner_stay:'||new.id||':'||v_stage,'property_partner',false,now()
  ) on conflict (recipient_id,event_key) where event_key is not null do nothing;
  return new;
end;
$function$;

revoke all on function public.notify_property_partner_reservation_lifecycle() from public,anon,authenticated;

drop trigger if exists reservations_notify_property_partner_lifecycle on public.reservations;
create trigger reservations_notify_property_partner_lifecycle
after insert or update of status,manual_payment_status,paid_at,rent_payment_status,rent_paid_at,tenancy_start_date,completed_at
on public.reservations
for each row execute function public.notify_property_partner_reservation_lifecycle();

create or replace function public.get_my_support_conversations()
returns table(
  conversation_id uuid,
  subject text,
  status text,
  category text,
  context_type text,
  context_id text,
  context_snapshot jsonb,
  priority text,
  assigned_staff_name text,
  last_message text,
  last_message_time timestamptz,
  unread_count bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare v_actor public.profiles;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Authentication required'; end if;
  return query
  select
    c.id,
    coalesce(nullif(btrim(c.subject),''),'WeHouse Help')::text,
    c.status,
    c.category,
    c.context_type,
    c.context_id,
    coalesce(c.context_snapshot,'{}'::jsonb)||jsonb_build_object('case_number',c.case_number),
    c.priority,
    coalesce(s.full_name,s.username),
    (select case
      when nullif(btrim(m.content),'') is not null then m.content
      when coalesce(cardinality(m.attachments),0)>0 then 'Attachment'
      else '' end
     from public.partner_support_messages m
     where m.conversation_id=c.id
     order by m.created_at desc limit 1),
    (select m.created_at from public.partner_support_messages m where m.conversation_id=c.id order by m.created_at desc limit 1),
    (select count(*) from public.partner_support_messages m where m.conversation_id=c.id and not coalesce(m.is_read,false) and m.sender_id<>v_actor.user_id),
    c.created_at
  from public.partner_support_conversations c
  left join public.profiles s on s.user_id=c.assigned_staff_id
  where c.partner_id=v_actor.user_id
    and exists(select 1 from public.partner_support_messages first_message where first_message.conversation_id=c.id)
  order by coalesce((select max(latest.created_at) from public.partner_support_messages latest where latest.conversation_id=c.id),c.created_at) desc;
end;
$function$;

revoke all on function public.get_my_support_conversations() from public,anon;
grant execute on function public.get_my_support_conversations() to authenticated,service_role;
