-- Repair the property draft handoff, keep property-inspection support with the
-- assigned Field Operations person, and extend participant blocking to Worker jobs.

create or replace function public.wehouse_state_key(p_value text)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(p_value,''))), '\\s+state$', ''),
      '[^a-z0-9]+', '', 'g'
    ),
    ''
  )
$$;

create or replace function public.wehouse_lga_key(p_value text)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(p_value,''))), '\\s+(local government area|lga)$', ''),
      '[^a-z0-9]+', '', 'g'
    ),
    ''
  )
$$;

create or replace function public.current_actor_in_scope(p_state text,p_lga text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then return false; end if;
  if v_actor.role='creator' then return true; end if;
  if v_actor.role not in ('admin','staff') then return false; end if;
  return public.wehouse_state_key(v_actor.assigned_state)=public.wehouse_state_key(p_state)
    and public.wehouse_lga_key(v_actor.assigned_lga)=public.wehouse_lga_key(p_lga)
    and public.wehouse_state_key(p_state) is not null
    and public.wehouse_lga_key(p_lga) is not null;
end;
$$;

create or replace function public.post_property_from_inspection(p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
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
  select * into v_caller from public.profiles where auth_id=(select auth.uid())::text limit 1;
  if v_caller.user_id is null or v_caller.role not in ('staff','admin','creator') then raise exception 'WeHouse operations access required'; end if;
  if v_caller.role='staff' and not public.current_staff_has_permission('operations') then raise exception 'Operations permission required'; end if;

  select * into v_ir from public.inspection_requests where id=(p_data->>'inspection_id')::uuid for update;
  if v_ir.id is null or v_ir.status not in ('completed','approved') then raise exception 'Inspection must be completed before listing preparation'; end if;
  if v_caller.role in ('admin','staff') and not public.current_actor_in_scope(v_ir.property_state,v_ir.property_city) then raise exception 'Property is outside your assigned branch'; end if;
  if v_ir.property_type='hotel' then raise exception 'Hotels use the hotel preparation workflow'; end if;
  -- A browser may lose the response after the transaction commits. Retrying must
  -- return the same private draft instead of turning success into an error.
  if v_ir.draft_listing_id is not null then
    if exists(select 1 from public.listings where id=v_ir.draft_listing_id and inspection_request_id=v_ir.id) then
      return v_ir.draft_listing_id;
    end if;
    raise exception 'The inspection points to a missing listing draft';
  end if;

  select * into v_partner from public.profiles where user_id=v_ir.owner_id and role='property_partner';
  if v_partner.user_id is null then raise exception 'Valid Property Partner owner required'; end if;
  if nullif(btrim(p_data->>'title'),'') is null or coalesce((p_data->>'price')::numeric,0)<=0 then raise exception 'Listing title and valid price are required'; end if;

  v_sub_type:=coalesce(nullif(btrim(p_data->>'sub_type'),''),v_ir.sub_type);
  if v_sub_type not in ('short_let','long_stay') then raise exception 'Choose Short Stay or Long Stay before preparing this apartment'; end if;
  v_deposit:=coalesce(nullif(p_data->>'security_deposit_amount','')::numeric,v_ir.security_deposit_amount);
  if v_sub_type='short_let' and coalesce(v_deposit,0)<=0 then raise exception 'Short Stay requires a refundable security deposit'; end if;
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
  ) values(
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
$$;

create or replace function public.admin_prepare_hotel_from_submission_v2(
  p_inspection_id uuid,
  p_name text default null,
  p_description text default null,
  p_images text[] default null
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_ir public.inspection_requests;
  v_program jsonb;
  v_rooms jsonb;
  v_room jsonb;
  v_hotel_id integer;
  v_name text;
  v_images text[];
  v_amenities text[];
begin
  select * into v_actor from public.profiles where auth_id=(select auth.uid())::text limit 1;
  if v_actor.user_id is null or v_actor.role not in ('admin','creator','staff') then raise exception 'WeHouse operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then raise exception 'Operations permission required'; end if;
  select * into v_ir from public.inspection_requests where id=p_inspection_id for update;
  if v_ir.id is null or v_ir.property_type<>'hotel' or v_ir.status not in ('completed','approved') then raise exception 'Completed hotel inspection required'; end if;
  if v_actor.role in ('admin','staff') and not public.current_actor_in_scope(v_ir.property_state,v_ir.property_city) then raise exception 'Hotel is outside your assigned branch'; end if;
  if v_ir.draft_hotel_id is not null then
    if exists(select 1 from public.hotels where hotel_id=v_ir.draft_hotel_id and inspection_request_id=v_ir.id) then
      return v_ir.draft_hotel_id;
    end if;
    raise exception 'The inspection points to a missing hotel draft';
  end if;

  v_program:=coalesce(v_ir.hotel_program,'{}'::jsonb);
  v_rooms:=coalesce(v_program->'room_types','[]'::jsonb);
  v_name:=coalesce(nullif(btrim(p_name),''),nullif(btrim(v_program->>'name'),''));
  if v_name is null then raise exception 'Hotel name is required'; end if;
  if jsonb_typeof(v_rooms)<>'array' or jsonb_array_length(v_rooms)=0 then raise exception 'At least one submitted room type is required'; end if;
  select coalesce(array_agg(value),array[]::text[]) into v_amenities
  from jsonb_array_elements_text(coalesce(v_program->'amenities','[]'::jsonb));
  v_images:=coalesce(p_images,v_ir.photo_urls,array[]::text[]);

  insert into public.hotels(
    name,description,state,city,address,images,amenities,owner_id,status,featured,
    gps_latitude,gps_longitude,inspection_request_id,created_at,updated_at
  ) values(
    v_name,coalesce(nullif(btrim(p_description),''),nullif(btrim(v_ir.description),'')),
    v_ir.property_state,v_ir.property_city,v_ir.property_address,v_images,v_amenities,v_ir.owner_id,
    'draft',false,v_ir.gps_latitude,v_ir.gps_longitude,v_ir.id,now(),now()
  ) returning hotel_id into v_hotel_id;

  for v_room in select value from jsonb_array_elements(v_rooms)
  loop
    if nullif(btrim(v_room->>'name'),'') is null or coalesce((v_room->>'nightly_rate')::integer,0)<=0 then raise exception 'Every room needs a name and valid nightly rate'; end if;
    insert into public.hotel_rooms(
      hotel_id,room_type,description,price_per_night,max_guests,bed_type,images,amenities,total_rooms,created_at,updated_at
    ) values(
      v_hotel_id,btrim(v_room->>'name'),nullif(btrim(v_room->>'description'),''),(v_room->>'nightly_rate')::integer,
      greatest(coalesce((v_room->>'guest_capacity')::integer,2),1),nullif(btrim(v_room->>'bed_type'),''),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_room->'media','[]'::jsonb))),array[]::text[]),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_room->'amenities','[]'::jsonb))),array[]::text[]),
      greatest(coalesce((v_room->>'inventory')::integer,1),1),now(),now()
    );
  end loop;
  update public.inspection_requests set draft_hotel_id=v_hotel_id,updated_at=now() where id=v_ir.id;
  return v_hotel_id;
end;
$$;

-- A property-inspection case belongs to the assigned Field Operations person,
-- not to the general Property Operations queue.
create or replace function public.classify_conversation_channel()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
declare source_type text:=coalesce(new.context_snapshot->>'source_type','');
begin
  new.channel_kind:=case
    when (new.context_type='property_inspection' or source_type='property_inspection')
      and nullif(btrim(coalesce(new.assigned_field_officer_id,'')),'') is not null then 'field_operations'
    when new.context_type in ('apartment_reservation','apartment_payment','reservation','hotel_booking','property_listing','property_inspection','hotel_property','hotel_operations') then 'property_operations'
    when source_type in ('apartment_reservation','apartment_payment','reservation','hotel_booking','property_listing','property_inspection','hotel_property','hotel_operations') then 'property_operations'
    else 'support_case'
  end;
  if new.case_number is null then new.case_number:='WHC-'||upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 10)); end if;
  if new.status='open' and (new.assigned_staff_id is not null or new.assigned_field_officer_id is not null) then new.status:='assigned'; end if;
  return new;
end;
$$;

create or replace function public.normalize_support_case_update()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  if new.case_number is null then new.case_number:=coalesce(old.case_number,'WHC-'||upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 10))); end if;
  if new.status='open' and (new.assigned_staff_id is not null or new.assigned_field_officer_id is not null) then new.status:='assigned'; end if;
  return new;
end;
$$;

drop trigger if exists partner_support_normalize_update on public.partner_support_conversations;
create trigger partner_support_normalize_update
before update on public.partner_support_conversations
for each row execute function public.normalize_support_case_update();

create or replace function public.notify_support_case_message()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_case public.partner_support_conversations;
  v_recipient text;
  v_sender_is_requester boolean;
begin
  select * into v_case from public.partner_support_conversations where id=new.conversation_id;
  if v_case.id is null then return new; end if;
  v_sender_is_requester:=new.sender_id=v_case.partner_id;
  if not v_sender_is_requester then
    update public.partner_support_conversations
    set status=case when status in ('resolved','closed') then status else 'in_progress' end,updated_at=now()
    where id=v_case.id;
  end if;
  v_recipient:=case
    when v_sender_is_requester then coalesce(v_case.assigned_field_officer_id,v_case.assigned_staff_id)
    else v_case.partner_id
  end;
  if v_recipient is not null and v_recipient<>new.sender_id then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key
    ) values(
      v_recipient,'support_case_message',
      case when v_sender_is_requester then 'Case reply needs attention' else 'WeHouse replied to your case' end,
      coalesce(nullif(btrim(new.content),''),'New attachment'),v_case.id::text,'wehouse_case',v_case.id::text,'conversation',
      jsonb_build_object('conversation_id',v_case.id,'context_type',v_case.context_type,'context_id',v_case.context_id),
      'support-message:'||new.id::text
    ) on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists partner_support_notify_message on public.partner_support_messages;
create trigger partner_support_notify_message
after insert on public.partner_support_messages
for each row execute function public.notify_support_case_message();

update public.partner_support_conversations conversation
set
  channel_kind=case when conversation.context_type='property_inspection' and conversation.assigned_field_officer_id is not null then 'field_operations' else conversation.channel_kind end,
  status=case when conversation.status='open' and (conversation.assigned_field_officer_id is not null or conversation.assigned_staff_id is not null) then 'assigned' else conversation.status end,
  case_number=coalesce(conversation.case_number,'WHC-'||upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 10))),
  updated_at=now()
where conversation.case_number is null
   or (conversation.status='open' and (conversation.assigned_field_officer_id is not null or conversation.assigned_staff_id is not null))
   or (conversation.context_type='property_inspection' and conversation.assigned_field_officer_id is not null and conversation.channel_kind<>'field_operations');

create or replace function public.get_my_support_conversations()
returns table(
  conversation_id uuid,subject text,status text,category text,context_type text,context_id text,
  context_snapshot jsonb,priority text,assigned_staff_name text,last_message text,
  last_message_time timestamptz,unread_count bigint,created_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false) and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Authentication required'; end if;
  return query
  select c.id,coalesce(nullif(btrim(c.subject),''),'WeHouse Help')::text,c.status,c.category,c.context_type,c.context_id,
    c.context_snapshot||jsonb_build_object('case_number',c.case_number),c.priority,coalesce(s.full_name,s.username),
    (select case when nullif(btrim(m.content),'') is not null then m.content when coalesce(cardinality(m.attachments),0)>0 then 'Attachment' else '' end from public.partner_support_messages m where m.conversation_id=c.id order by m.created_at desc limit 1),
    (select m.created_at from public.partner_support_messages m where m.conversation_id=c.id order by m.created_at desc limit 1),
    (select count(*) from public.partner_support_messages m where m.conversation_id=c.id and not coalesce(m.is_read,false) and m.sender_id<>v_actor.user_id),c.created_at
  from public.partner_support_conversations c
  left join public.profiles s on s.user_id=coalesce(c.assigned_field_officer_id,c.assigned_staff_id)
  where c.partner_id=v_actor.user_id and exists(select 1 from public.partner_support_messages first_message where first_message.conversation_id=c.id)
  order by coalesce((select max(latest.created_at) from public.partner_support_messages latest where latest.conversation_id=c.id),c.created_at) desc;
end;
$$;

create table if not exists public.worker_user_blocks(
  blocker_user_id text not null references public.profiles(user_id) on delete cascade,
  blocked_user_id text not null references public.profiles(user_id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key(blocker_user_id,blocked_user_id),
  constraint worker_user_blocks_no_self check(blocker_user_id<>blocked_user_id),
  constraint worker_user_blocks_reason_length check(char_length(coalesce(reason,''))<=500)
);
alter table public.worker_user_blocks enable row level security;
revoke all on table public.worker_user_blocks from public,anon,authenticated;
grant all on table public.worker_user_blocks to service_role;

create or replace function public.get_my_worker_block_state(p_user_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.worker_bookings b where (b.user_id=v_actor and b.worker_id=p_user_id) or (b.user_id=p_user_id and b.worker_id=v_actor)) then raise exception 'Worker booking relationship required'; end if;
  return jsonb_build_object(
    'blocked_by_me',exists(select 1 from public.worker_user_blocks where blocker_user_id=v_actor and blocked_user_id=p_user_id),
    'blocked_me',exists(select 1 from public.worker_user_blocks where blocker_user_id=p_user_id and blocked_user_id=v_actor)
  );
end;
$$;

create or replace function public.set_my_worker_block(p_user_id text,p_blocked boolean,p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_peer public.profiles;
  v_cancelled integer:=0;
  v_review integer:=0;
  v_booking public.worker_bookings;
  v_case_id uuid;
begin
  select * into v_actor from public.profiles where auth_id=(select auth.uid())::text and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Authentication required'; end if;
  select * into v_peer from public.profiles where user_id=p_user_id and not coalesce(deleted,false) limit 1;
  if v_peer.user_id is null then raise exception 'Person not found'; end if;
  if not exists(select 1 from public.worker_bookings b where (b.user_id=v_actor.user_id and b.worker_id=v_peer.user_id) or (b.user_id=v_peer.user_id and b.worker_id=v_actor.user_id)) then raise exception 'Worker booking relationship required'; end if;
  if not ((v_actor.role='user' and v_peer.role='worker') or (v_actor.role='worker' and v_peer.role='user')) then raise exception 'Worker booking participants required'; end if;

  if not p_blocked then
    delete from public.worker_user_blocks where blocker_user_id=v_actor.user_id and blocked_user_id=v_peer.user_id;
    return jsonb_build_object('blocked',false,'booking_action','none');
  end if;
  insert into public.worker_user_blocks(blocker_user_id,blocked_user_id,reason)
  values(v_actor.user_id,v_peer.user_id,nullif(btrim(coalesce(p_reason,'')),''))
  on conflict(blocker_user_id,blocked_user_id) do update set reason=excluded.reason,created_at=now();

  update public.worker_bookings
  set status='cancelled',cancelled_by=v_actor.user_id,cancellation_reason=coalesce(nullif(btrim(coalesce(p_reason,'')),''),'Participant blocked'),updated_at=now()
  where ((user_id=v_actor.user_id and worker_id=v_peer.user_id) or (user_id=v_peer.user_id and worker_id=v_actor.user_id))
    and status in ('booking_requested','negotiating','waiting_payment');
  get diagnostics v_cancelled=row_count;

  update public.worker_bookings
  set status='disputed',dispute_reason=coalesce(nullif(dispute_reason||E'\n',''), '')||'Communication blocked; WeHouse payment review required.',updated_at=now()
  where ((user_id=v_actor.user_id and worker_id=v_peer.user_id) or (user_id=v_peer.user_id and worker_id=v_actor.user_id))
    and status in ('confirmed','in_progress','completed_pending_approval');
  get diagnostics v_review=row_count;

  if v_review>0 then
    select * into v_booking from public.worker_bookings
    where ((user_id=v_actor.user_id and worker_id=v_peer.user_id) or (user_id=v_peer.user_id and worker_id=v_actor.user_id))
      and status='disputed'
    order by updated_at desc
    limit 1;
  end if;
  if v_review>0 and v_booking.id is not null then
    select id into v_case_id from public.partner_support_conversations
    where partner_id=v_actor.user_id and context_type='worker_booking' and context_id=v_booking.id::text limit 1;
    if v_case_id is null then
      insert into public.partner_support_conversations(
        partner_id,requester_role,subject,status,category,context_type,context_id,context_snapshot,priority,channel_kind,created_at,updated_at
      ) values(
        v_actor.user_id,v_actor.role,'Worker booking safety review · '||coalesce(v_booking.booking_code,'Booking'),'open','safety','worker_booking',v_booking.id::text,
        jsonb_build_object('booking_id',v_booking.id,'booking_code',v_booking.booking_code,'service_type',v_booking.service_type),'urgent','support_case',now(),now()
      ) returning id into v_case_id;
    end if;
    insert into public.partner_support_messages(conversation_id,sender_id,sender_role,content,action_type,action_metadata,created_at)
    values(v_case_id,v_actor.user_id,v_actor.role,'I blocked this booking participant. Please review the booking and any secured payment.',
      'status_change',jsonb_build_object('context_id',v_booking.id,'reason',nullif(btrim(coalesce(p_reason,'')),'')),now());
  end if;
  return jsonb_build_object(
    'blocked',true,
    'cancelled_bookings',v_cancelled,
    'review_bookings',v_review,
    'booking_action',case when v_review>0 then 'review_required' when v_cancelled>0 then 'cancelled' else 'none' end,
    'support_conversation_id',v_case_id
  );
end;
$$;

create or replace function public.guard_blocked_worker_contact()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_user text;v_worker text;
begin
  if tg_table_name='worker_bookings' then v_user:=new.user_id;v_worker:=new.worker_id;
  else
    select c.user_id,c.worker_id into v_user,v_worker from public.booking_conversations c where c.id=new.conversation_id;
  end if;
  if exists(select 1 from public.worker_user_blocks b where (b.blocker_user_id=v_user and b.blocked_user_id=v_worker) or (b.blocker_user_id=v_worker and b.blocked_user_id=v_user)) then
    raise exception 'This person is blocked. The Worker conversation cannot continue.';
  end if;
  return new;
end;
$$;

drop trigger if exists worker_booking_block_guard on public.worker_bookings;
create trigger worker_booking_block_guard
before insert or update of user_id,worker_id on public.worker_bookings
for each row execute function public.guard_blocked_worker_contact();

drop trigger if exists booking_message_block_guard on public.booking_messages;
create trigger booking_message_block_guard
before insert on public.booking_messages
for each row execute function public.guard_blocked_worker_contact();

create or replace function public.get_public_workers(
  p_state text default null,p_city text default null,p_occupation text default null
)
returns table(
  user_id text,full_name text,username text,avatar_url text,bio text,state text,city text,local_government text,area text,
  worker_occupation text,worker_skills jsonb,worker_price integer,worker_bio text,worker_experience text,rating numeric,
  review_count integer,is_online boolean,last_seen timestamptz,services jsonb,coverage jsonb
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id();
begin
  return query
  select profile.user_id,profile.full_name,profile.username,profile.avatar_url,profile.bio,profile.state,profile.city,
    profile.local_government,profile.area,profile.worker_occupation,profile.worker_skills,profile.worker_price,profile.worker_bio,
    profile.worker_experience,profile.rating,profile.review_count,profile.is_online,profile.last_seen,
    coalesce((select jsonb_agg(jsonb_build_object('name',service.service_name,'price',service.price,'price_type',service.price_type)) from public.worker_services service where service.worker_id=profile.user_id),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('state',coverage_row.state,'lga',coverage_row.lga,'areas',coverage_row.areas)) from public.worker_service_coverage coverage_row where coverage_row.worker_id=profile.user_id),'[]'::jsonb)
  from public.profiles profile
  where profile.role='worker' and profile.worker_status='verified' and profile.worker_verified=true and profile.available=true
    and not profile.deleted and not profile.suspended and not profile.banned and public.worker_identity_is_current(profile.user_id)
    and (p_state is null or public.wehouse_state_key(profile.state)=public.wehouse_state_key(p_state))
    and (p_city is null or profile.city ilike p_city or profile.local_government ilike p_city)
    and (p_occupation is null or profile.worker_occupation ilike p_occupation)
    and not exists(
      select 1 from public.worker_user_blocks block_row
      where v_actor is not null and (
        (block_row.blocker_user_id=v_actor and block_row.blocked_user_id=profile.user_id)
        or (block_row.blocker_user_id=profile.user_id and block_row.blocked_user_id=v_actor)
      )
    )
  order by profile.rating desc nulls last,profile.review_count desc nulls last;
end;
$$;

revoke all on function public.wehouse_state_key(text) from public,anon;
revoke all on function public.wehouse_lga_key(text) from public,anon;
revoke all on function public.current_actor_in_scope(text,text) from public,anon;
revoke all on function public.post_property_from_inspection(jsonb) from public,anon;
revoke all on function public.admin_prepare_hotel_from_submission_v2(uuid,text,text,text[]) from public,anon;
revoke all on function public.classify_conversation_channel() from public,anon,authenticated;
revoke all on function public.normalize_support_case_update() from public,anon,authenticated;
revoke all on function public.notify_support_case_message() from public,anon,authenticated;
revoke all on function public.get_my_support_conversations() from public,anon;
revoke all on function public.get_my_worker_block_state(text) from public,anon;
revoke all on function public.set_my_worker_block(text,boolean,text) from public,anon;
revoke all on function public.guard_blocked_worker_contact() from public,anon,authenticated;
revoke all on function public.get_public_workers(text,text,text) from public,anon;

grant execute on function public.wehouse_state_key(text) to authenticated,service_role;
grant execute on function public.wehouse_lga_key(text) to authenticated,service_role;
grant execute on function public.current_actor_in_scope(text,text) to authenticated,service_role;
grant execute on function public.post_property_from_inspection(jsonb) to authenticated,service_role;
grant execute on function public.admin_prepare_hotel_from_submission_v2(uuid,text,text,text[]) to authenticated,service_role;
grant execute on function public.classify_conversation_channel() to service_role;
grant execute on function public.normalize_support_case_update() to service_role;
grant execute on function public.notify_support_case_message() to service_role;
grant execute on function public.get_my_support_conversations() to authenticated,service_role;
grant execute on function public.get_my_worker_block_state(text) to authenticated,service_role;
grant execute on function public.set_my_worker_block(text,boolean,text) to authenticated,service_role;
grant execute on function public.guard_blocked_worker_contact() to service_role;
grant execute on function public.get_public_workers(text,text,text) to authenticated,service_role;

