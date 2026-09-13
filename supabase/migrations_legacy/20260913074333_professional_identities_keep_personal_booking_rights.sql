-- Personal is a permanent workspace. Choosing Worker or Property Partner must
-- never remove ordinary customer booking, review or reaction rights.

create or replace function public.enforce_hotel_booking_integrity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_actor public.profiles;
  v_hotel public.hotels;
  v_room public.hotel_rooms;
  v_plan public.hotel_rate_plans;
  v_quote jsonb;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if tg_op='INSERT' then
    if v_actor.user_id is null or not public.current_actor_has_personal_workspace() then
      raise exception 'Active Personal account required';
    end if;
    new.user_id:=v_actor.user_id;
    new.status:='pending';
    new.payment_status:='unpaid';
    new.payment_expires_at:=coalesce(
      new.payment_expires_at,now()+interval '30 minutes'
    );
    if new.check_in is null or new.check_out is null
       or new.check_in<=current_date or new.check_out<=new.check_in then
      raise exception 'Choose valid future check-in and check-out dates';
    end if;
    if coalesce(new.guest_count,0)<1 then
      raise exception 'At least one guest is required';
    end if;
    if nullif(btrim(new.guest_name),'') is null
       or nullif(btrim(new.guest_phone),'') is null then
      raise exception 'Guest name and phone are required';
    end if;
    select * into v_hotel from public.hotels
    where hotel_id=new.hotel_id and status='active'
      and approved_at is not null and published_at is not null;
    if v_hotel.hotel_id is null then
      raise exception 'Hotel is not available for booking';
    end if;
    select * into v_room from public.hotel_rooms
    where room_id=new.room_id and hotel_id=new.hotel_id;
    if v_room.room_id is null then
      raise exception 'Room type not found for this hotel';
    end if;
    if new.guest_count>coalesce(v_room.max_guests,2) then
      raise exception 'Guest count exceeds this room type capacity';
    end if;
    if new.rate_plan_id is null then
      select * into v_plan from public.hotel_rate_plans
      where room_id=new.room_id and active
      order by (name='Room only') desc,price_per_night,rate_plan_id limit 1;
      new.rate_plan_id:=v_plan.rate_plan_id;
    else
      select * into v_plan from public.hotel_rate_plans
      where rate_plan_id=new.rate_plan_id and room_id=new.room_id
        and hotel_id=new.hotel_id and active;
    end if;
    if v_plan.rate_plan_id is null then
      raise exception 'Room package is not available';
    end if;
    v_quote:=private.hotel_booking_quote_v2(
      new.room_id,v_plan.rate_plan_id,new.check_in,new.check_out,null,true
    );
    if not coalesce((v_quote->>'available')::boolean,false) then
      raise exception 'This room type is unavailable on %',v_quote->>'blocked_date';
    end if;
    new.total_nights:=(v_quote->>'nights')::integer;
    new.total_price:=(v_quote->>'total_price')::numeric;
    new.rate_plan_name:=v_plan.name;
    new.rate_plan_snapshot:=jsonb_build_object(
      'rate_plan_id',v_plan.rate_plan_id,'name',v_plan.name,
      'description',v_plan.description,'meal_plan',v_plan.meal_plan,
      'payment_timing',v_plan.payment_timing,'refundable',v_plan.refundable,
      'cancellation_hours',v_plan.cancellation_hours,
      'price_per_night',v_plan.price_per_night,
      'included_features',v_plan.included_features
    );
    new.created_at:=coalesce(new.created_at,now());
    new.updated_at:=now();
    return new;
  end if;
  if tg_op='UPDATE' then
    if current_user not in ('anon','authenticated') then
      new.updated_at:=now();
      return new;
    end if;
    if v_actor.user_id is null then raise exception 'Authentication required'; end if;
    if v_actor.role='creator' then
      new.updated_at:=now();
      return new;
    end if;
    if not public.current_actor_has_personal_workspace()
       or old.user_id is distinct from v_actor.user_id then
      raise exception 'Booking owner access required';
    end if;
    if old.status<>'pending' or new.status<>'cancelled'
       or old.payment_status='paid' then
      raise exception 'Customers can only cancel their own unpaid pending booking';
    end if;
    new.hotel_id:=old.hotel_id;
    new.room_id:=old.room_id;
    new.rate_plan_id:=old.rate_plan_id;
    new.rate_plan_name:=old.rate_plan_name;
    new.rate_plan_snapshot:=old.rate_plan_snapshot;
    new.user_id:=old.user_id;
    new.check_in:=old.check_in;
    new.check_out:=old.check_out;
    new.guest_count:=old.guest_count;
    new.total_nights:=old.total_nights;
    new.total_price:=old.total_price;
    new.guest_name:=old.guest_name;
    new.guest_phone:=old.guest_phone;
    new.special_requests:=old.special_requests;
    new.payment_reference:=old.payment_reference;
    new.paid_at:=old.paid_at;
    new.confirmed_at:=old.confirmed_at;
    new.created_at:=old.created_at;
    new.updated_at:=now();
    return new;
  end if;
  return new;
end
$$;

create or replace function public.create_my_hotel_booking_with_rate(
  p_hotel_id integer,
  p_room_id integer,
  p_rate_plan_id integer,
  p_check_in date,
  p_check_out date,
  p_guest_count integer,
  p_guest_name text,
  p_guest_phone text,
  p_special_requests text default null
)
returns public.hotel_bookings
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_actor public.profiles;
  v_result public.hotel_bookings;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  insert into public.hotel_bookings(
    hotel_id,room_id,rate_plan_id,user_id,check_in,check_out,guest_count,
    guest_name,guest_phone,special_requests
  ) values(
    p_hotel_id,p_room_id,p_rate_plan_id,v_actor.user_id,p_check_in,p_check_out,
    p_guest_count,btrim(p_guest_name),btrim(p_guest_phone),
    nullif(btrim(p_special_requests),'')
  ) returning * into v_result;
  return v_result;
end
$$;

create or replace function public.create_hotel_booking_payment(
  p_booking_id integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user_id text:=public.current_profile_user_id();
  v_booking public.hotel_bookings;
  v_hotel public.hotels;
  v_reference text;
  v_pending public.booking_payments;
begin
  if v_user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  select * into v_booking from public.hotel_bookings
  where booking_id=p_booking_id and user_id=v_user_id for update;
  if v_booking.booking_id is null then raise exception 'Hotel booking not found'; end if;
  if v_booking.status='confirmed' and v_booking.payment_status='paid' then
    return jsonb_build_object(
      'success',true,'already_paid',true,
      'booking_code',v_booking.booking_code
    );
  end if;
  if v_booking.status<>'pending' then
    raise exception 'Hotel booking is no longer awaiting payment';
  end if;
  if v_booking.payment_expires_at is null
     or v_booking.payment_expires_at<=now() then
    update public.hotel_bookings
    set status='expired',payment_status='expired',updated_at=now()
    where booking_id=v_booking.booking_id;
    raise exception 'Hotel checkout hold has expired. Choose the room again.';
  end if;
  if coalesce(v_booking.total_price,0)<=0 then
    raise exception 'Hotel booking amount is invalid';
  end if;
  select * into v_hotel from public.hotels
  where hotel_id=v_booking.hotel_id;
  if v_hotel.hotel_id is null then raise exception 'Hotel not found'; end if;
  select * into v_pending from public.booking_payments
  where user_id=v_user_id and purpose='hotel_booking'
    and hotel_booking_id=v_booking.booking_id and status='pending'
    and round(coalesce(amount_total,amount),2)=round(v_booking.total_price,2)
  order by created_at desc limit 1;
  if v_pending.id is not null then
    update public.hotel_bookings
    set payment_status='payment_pending',
        payment_reference=v_pending.paystack_reference,updated_at=now()
    where booking_id=v_booking.booking_id;
    return jsonb_build_object(
      'success',true,'reference',v_pending.paystack_reference,
      'amount',coalesce(v_pending.amount_total,v_pending.amount),
      'existing',true,'booking_code',v_booking.booking_code
    );
  end if;
  v_reference:='WHHOTEL-'||upper(replace(gen_random_uuid()::text,'-',''));
  insert into public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,
    hotel_booking_id,amount,amount_total,currency,status,purpose,
    payment_method,paystack_reference,metadata,created_at,updated_at
  ) values(
    v_reference,v_user_id,v_user_id,'hotel','hotel',v_booking.booking_id,
    v_booking.total_price,v_booking.total_price,'NGN','pending',
    'hotel_booking','paystack',v_reference,jsonb_build_object(
      'hotel_booking_id',v_booking.booking_id,
      'hotel_id',v_booking.hotel_id,'hotel_name',v_hotel.name,
      'room_id',v_booking.room_id,'rate_plan_id',v_booking.rate_plan_id,
      'rate_plan_name',v_booking.rate_plan_name,
      'booking_code',v_booking.booking_code,
      'check_in',v_booking.check_in,'check_out',v_booking.check_out,
      'eligible_partner_amount',v_booking.total_price
    ),now(),now()
  );
  update public.hotel_bookings
  set payment_status='payment_pending',payment_reference=v_reference,
      updated_at=now()
  where booking_id=v_booking.booking_id;
  return jsonb_build_object(
    'success',true,'reference',v_reference,'amount',v_booking.total_price,
    'existing',false,'booking_code',v_booking.booking_code
  );
end
$$;

create or replace function public.get_my_hotel_bookings()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_user text:=public.current_profile_user_id();
begin
  if v_user is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  return coalesce((
    select jsonb_agg(
      to_jsonb(booking)||jsonb_build_object(
        'hotels',(
          to_jsonb(hotel)-'address'-'gps_latitude'-'gps_longitude'
            -'owner_id'-'inspection_request_id'-'approved_by'
        )||jsonb_build_object(
          'address',case when booking.payment_status='paid'
            and booking.status in ('confirmed','checked_in','checked_out','completed')
            then hotel.address else null end,
          'gps_latitude',case when hotel.gps_latitude is null then null
            when booking.payment_status='paid'
              and booking.status in ('confirmed','checked_in','checked_out','completed')
            then hotel.gps_latitude else round(hotel.gps_latitude,2) end,
          'gps_longitude',case when hotel.gps_longitude is null then null
            when booking.payment_status='paid'
              and booking.status in ('confirmed','checked_in','checked_out','completed')
            then hotel.gps_longitude else round(hotel.gps_longitude,2) end,
          'location_exact',booking.payment_status='paid'
            and booking.status in ('confirmed','checked_in','checked_out','completed')
        ),
        'hotel_rooms',to_jsonb(room),
        'hotel_rate_plans',to_jsonb(rate_plan)
      ) order by booking.created_at desc
    )
    from public.hotel_bookings booking
    join public.hotels hotel on hotel.hotel_id=booking.hotel_id
    join public.hotel_rooms room on room.room_id=booking.room_id
    left join public.hotel_rate_plans rate_plan
      on rate_plan.rate_plan_id=booking.rate_plan_id
    where booking.user_id=v_user
  ),'[]'::jsonb);
end
$$;

create or replace function public.cancel_my_hotel_booking(
  p_booking_id integer
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user_id text:=public.current_profile_user_id();
  v_changed integer;
begin
  if v_user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  update public.hotel_bookings
  set status='cancelled',
      payment_status=case when payment_status='paid'
        then payment_status else 'expired' end,
      updated_at=now()
  where booking_id=p_booking_id and user_id=v_user_id
    and status='pending' and payment_status<>'paid';
  get diagnostics v_changed=row_count;
  if v_changed=0 then
    raise exception 'Only your unpaid pending Hotel booking can be cancelled';
  end if;
  update public.booking_payments
  set status='cancelled',updated_at=now()
  where hotel_booking_id=p_booking_id and user_id=v_user_id
    and purpose='hotel_booking' and status='pending';
  return true;
end
$$;

create or replace function public.create_my_verified_hotel_review(
  p_hotel_id integer,
  p_rating integer,
  p_comment text default null
)
returns public.hotel_reviews
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user text:=public.current_profile_user_id();
  v_review public.hotel_reviews;
begin
  if v_user is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if p_rating not between 1 and 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;
  if not exists(
    select 1 from public.hotel_bookings
    where hotel_id=p_hotel_id and user_id=v_user and payment_status='paid'
      and status in ('checked_out','completed')
  ) then raise exception 'A completed paid stay is required before reviewing this Hotel'; end if;
  insert into public.hotel_reviews(hotel_id,user_id,rating,comment)
  values(p_hotel_id,v_user,p_rating,nullif(btrim(coalesce(p_comment,'')),''))
  on conflict(hotel_id,user_id) do update
  set rating=excluded.rating,comment=excluded.comment,created_at=now()
  returning * into v_review;
  update public.hotels hotel
  set rating=(
        select round(avg(review.rating)::numeric,1)
        from public.hotel_reviews review where review.hotel_id=p_hotel_id
      ),
      review_count=(
        select count(*) from public.hotel_reviews review
        where review.hotel_id=p_hotel_id
      ),
      updated_at=now()
  where hotel.hotel_id=p_hotel_id;
  return v_review;
end
$$;

create or replace function public.request_my_apartment_move_in(
  p_reservation_id text,
  p_requested_at timestamptz
)
returns public.reservations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_result public.reservations;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  select * into v_res from public.reservations
  where id=p_reservation_id and user_id=v_actor.user_id for update;
  if v_res is null then raise exception 'Apartment reservation not found'; end if;
  if coalesce(v_res.stay_type,'long_stay')<>'long_stay' then
    raise exception 'Use the reserved check-in time for a Short Let';
  end if;
  if v_res.status<>'ready_for_move_in'
     or v_res.rent_payment_status not in ('paid','upfront_paid')
     or v_res.rent_paid_at is null then
    raise exception 'Verified Year 1 rent is required before choosing move-in';
  end if;
  if p_requested_at is null
     or p_requested_at<now()-interval '15 minutes'
     or p_requested_at>now()+interval '3 days' then
    raise exception 'Choose a move-in time within the next 3 days';
  end if;
  select * into v_listing from public.listings
  where id::text=v_res.listing_id or listing_id=v_res.listing_id limit 1;
  if v_listing is null then raise exception 'Apartment listing not found'; end if;
  update public.reservations
  set requested_move_in_at=p_requested_at,move_in_requested_at=now(),
      updated_at=now()
  where id=v_res.id returning * into v_result;
  insert into public.notifications(
    recipient_id,type,title,message,read,source_type,source_id,
    destination_route,destination_params,workspace_scope
  ) values(
    v_actor.user_id,'move_in_request_saved','Move-in time sent',
    'Property Operations received your preferred arrival time. Your tenancy has not started yet.',
    false,'apartment_reservation',v_res.id,'my_reservations',
    jsonb_build_object('reservation_id',v_res.id),'personal'
  );
  insert into public.notifications(
    recipient_id,type,title,message,read,source_type,source_id,
    destination_route,destination_params,workspace_scope
  )
  select staff.user_id,'property_move_in_requested','Move-in time requested',
    coalesce(
      nullif(v_actor.full_name,''),nullif(v_actor.username,''),'A customer'
    )||' chose an arrival time for '
      ||coalesce(v_listing.title,'an apartment')||'.',
    false,'apartment_reservation',v_res.id,'operations_bookings',
    jsonb_build_object(
      'reservation_id',v_res.id,'listing_id',v_res.listing_id
    ),
    case staff.role when 'creator' then 'creator'
      when 'admin' then 'admin' else 'staff' end
  from public.profiles staff
  where staff.role in ('staff','admin','creator')
    and not coalesce(staff.deleted,false)
    and not coalesce(staff.suspended,false)
    and not coalesce(staff.banned,false)
    and (
      staff.role in ('admin','creator')
      or (
        lower(btrim(coalesce(staff.state,'')))
          =lower(btrim(coalesce(v_listing.state,'')))
        and lower(btrim(coalesce(
          staff.local_government,staff.city,''
        )))=lower(btrim(coalesce(v_listing.city,'')))
      )
    );
  return v_result;
end
$$;

create or replace function public.create_booking_request(
  p_worker_id text,
  p_service_type text,
  p_description text,
  p_address text,
  p_scheduled_date text,
  p_customer_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_customer public.profiles;
  v_worker public.profiles;
  v_booking_id uuid;
  v_conversation_id uuid;
  v_code text;
  v_date date;
  v_service text:=trim(coalesce(p_service_type,''));
  v_service_ok boolean:=false;
  v_has_specific_services boolean:=false;
begin
  select * into v_customer from public.profiles
  where auth_id=(select auth.uid())::text limit 1;
  if v_customer is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if coalesce(v_customer.deleted,false)
     or coalesce(v_customer.suspended,false)
     or coalesce(v_customer.banned,false) then
    raise exception 'Customer account is not active';
  end if;
  if v_service='' then raise exception 'Choose a service'; end if;
  if nullif(trim(coalesce(p_description,'')),'') is null then
    raise exception 'Describe the work you need';
  end if;
  if nullif(trim(coalesce(p_address,'')),'') is null then
    raise exception 'Job location is required';
  end if;
  if nullif(trim(coalesce(p_scheduled_date,'')),'') is not null then
    v_date:=p_scheduled_date::date;
    if v_date<current_date then raise exception 'Schedule date cannot be in the past'; end if;
  end if;
  select * into v_worker from public.profiles
  where user_id=p_worker_id limit 1;
  if v_worker is null
     or not public.user_has_active_workspace(p_worker_id,'worker') then
    raise exception 'Worker not found';
  end if;
  if v_worker.worker_status<>'verified'
     or v_worker.worker_verified is distinct from true then
    raise exception 'Worker is not verified';
  end if;
  if not public.worker_identity_is_current(v_worker.user_id) then
    raise exception 'This Worker is temporarily unavailable while identity is re-checked';
  end if;
  if v_worker.available is distinct from true then
    raise exception 'Worker is not accepting new bookings';
  end if;
  if coalesce(v_worker.deleted,false)
     or coalesce(v_worker.suspended,false)
     or coalesce(v_worker.banned,false) then
    raise exception 'Worker account is not active';
  end if;
  if v_customer.user_id=p_worker_id then raise exception 'Cannot book yourself'; end if;
  v_has_specific_services:=exists(
    select 1 from public.worker_services service
    where service.worker_id=v_worker.user_id
  ) or (
    jsonb_typeof(v_worker.worker_skills)='array'
    and jsonb_array_length(v_worker.worker_skills)>0
  );
  v_service_ok:=exists(
    select 1 from public.worker_services service
    where service.worker_id=v_worker.user_id
      and lower(trim(service.service_name))=lower(v_service)
  ) or exists(
    select 1
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_worker.worker_skills)='array'
        then v_worker.worker_skills else '[]'::jsonb end
    ) skill(value)
    where lower(trim(skill.value))=lower(v_service)
  ) or (
    not v_has_specific_services
    and lower(trim(coalesce(v_worker.worker_occupation,'')))=lower(v_service)
  );
  if not v_service_ok then
    raise exception 'This Worker does not offer the selected service';
  end if;
  v_code:='WH-'||upper(substring(md5(gen_random_uuid()::text) from 1 for 8));
  insert into public.worker_bookings(
    booking_code,user_id,worker_id,service_type,description,address,
    scheduled_date,agreed_amount,wehouse_fee,worker_commission,
    worker_receives,status,customer_message,created_at,updated_at
  ) values(
    v_code,v_customer.user_id,v_worker.user_id,v_service,
    trim(p_description),trim(p_address),v_date,0,0,0,0,
    'booking_requested',nullif(trim(coalesce(p_customer_message,'')),''),
    now(),now()
  ) returning id into v_booking_id;
  insert into public.booking_conversations(
    booking_id,user_id,worker_id,status,created_at,updated_at
  ) values(
    v_booking_id,v_customer.user_id,v_worker.user_id,'active',now(),now()
  ) returning id into v_conversation_id;
  update public.worker_bookings
  set booking_conversation_id=v_conversation_id
  where id=v_booking_id;
  if nullif(trim(coalesce(p_customer_message,'')),'') is not null then
    insert into public.booking_messages(
      conversation_id,sender_id,content,created_at
    ) values(
      v_conversation_id,v_customer.user_id,trim(p_customer_message),now()
    );
  end if;
  return jsonb_build_object(
    'booking_id',v_booking_id,'conversation_id',v_conversation_id,
    'booking_code',v_code
  );
end
$$;

create or replace function public.set_my_worker_showcase_reaction(
  p_post_id uuid,
  p_emoji text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if actor.user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if not exists(
    select 1 from public.worker_showcase_posts
    where id=p_post_id and deleted_at is null and hidden_at is null
  ) then raise exception 'Work Post not found'; end if;
  if nullif(btrim(coalesce(p_emoji,'')),'') is null then
    delete from public.worker_showcase_reactions
    where post_id=p_post_id and user_id=actor.user_id;
  elsif public._valid_reaction(p_emoji) then
    insert into public.worker_showcase_reactions(post_id,user_id,emoji)
    values(p_post_id,actor.user_id,btrim(p_emoji))
    on conflict(post_id,user_id) do update
    set emoji=excluded.emoji,updated_at=now();
  else
    raise exception 'Choose a valid emoji reaction';
  end if;
  return coalesce((
    select jsonb_object_agg(emoji,reaction_count)
    from (
      select emoji,count(*)::integer reaction_count
      from public.worker_showcase_reactions
      where post_id=p_post_id group by emoji
    ) totals
  ),'{}'::jsonb);
end
$$;

-- Retire the older un-packaged Hotel insert from browser use. The rate-plan
-- command is the only current application write path.
revoke all on function public.create_my_hotel_booking(
  integer,integer,date,date,integer,text,text,text
) from public,anon,authenticated;
grant execute on function public.create_my_hotel_booking(
  integer,integer,date,date,integer,text,text,text
) to service_role;

revoke all on function public.enforce_hotel_booking_integrity()
from public,anon,authenticated;
grant execute on function public.enforce_hotel_booking_integrity()
to service_role;

revoke all on function public.create_my_hotel_booking_with_rate(
  integer,integer,integer,date,date,integer,text,text,text
) from public,anon;
revoke all on function public.create_hotel_booking_payment(integer)
from public,anon;
revoke all on function public.get_my_hotel_bookings()
from public,anon;
revoke all on function public.cancel_my_hotel_booking(integer)
from public,anon;
revoke all on function public.create_my_verified_hotel_review(integer,integer,text)
from public,anon;
revoke all on function public.request_my_apartment_move_in(text,timestamptz)
from public,anon;
revoke all on function public.create_booking_request(text,text,text,text,text,text)
from public,anon;
revoke all on function public.set_my_worker_showcase_reaction(uuid,text)
from public,anon;

grant execute on function public.create_my_hotel_booking_with_rate(
  integer,integer,integer,date,date,integer,text,text,text
) to authenticated,service_role;
grant execute on function public.create_hotel_booking_payment(integer)
to authenticated,service_role;
grant execute on function public.get_my_hotel_bookings()
to authenticated,service_role;
grant execute on function public.cancel_my_hotel_booking(integer)
to authenticated,service_role;
grant execute on function public.create_my_verified_hotel_review(integer,integer,text)
to authenticated,service_role;
grant execute on function public.request_my_apartment_move_in(text,timestamptz)
to authenticated,service_role;
grant execute on function public.create_booking_request(text,text,text,text,text,text)
to authenticated,service_role;
grant execute on function public.set_my_worker_showcase_reaction(uuid,text)
to authenticated,service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select
  procedure.oid::regprocedure::text,procedure.proname,
  case when procedure.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',procedure.oid,'execute'),
  has_function_privilege('anon',procedure.oid,'execute'),
  has_function_privilege('authenticated',procedure.oid,'execute'),
  has_function_privilege('service_role',procedure.oid,'execute'),
  case when procedure.proname in (
    'enforce_hotel_booking_integrity','create_my_hotel_booking'
  ) then 'approved_service_only' else 'approved_client_rpc' end,
  case when procedure.proname='enforce_hotel_booking_integrity'
    then 'Internal Hotel booking integrity trigger using permanent Personal authority'
    when procedure.proname='create_my_hotel_booking'
    then 'Retired browser overload; service-only compatibility function'
    else 'Actor-bound Personal booking, review, reaction or arrival action'
  end,
  now()
from pg_proc procedure
join pg_namespace namespace on namespace.oid=procedure.pronamespace
where namespace.nspname='public' and procedure.proname in(
  'enforce_hotel_booking_integrity','create_my_hotel_booking',
  'create_my_hotel_booking_with_rate','create_hotel_booking_payment',
  'get_my_hotel_bookings','cancel_my_hotel_booking',
  'create_my_verified_hotel_review','request_my_apartment_move_in',
  'create_booking_request','set_my_worker_showcase_reaction'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,
  security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,
  anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,
  rationale=excluded.rationale,
  captured_at=now();
