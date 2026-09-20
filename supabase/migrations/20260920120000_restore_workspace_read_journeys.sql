-- Restore the authenticated journeys without reopening direct hotel table access.
create or replace function public.get_my_hotel_operation_snapshot(p_hotel_id integer)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public' as $$
declare
  v_caps text[];
  v_date date;
begin
  if public.current_actor_hotel_role(p_hotel_id) is null then
    raise exception 'Active hotel ownership or team membership required';
  end if;
  v_caps:=coalesce(public.current_actor_hotel_capabilities(p_hotel_id),array[]::text[]);
  select (now() at time zone coalesce(h.timezone,'Africa/Lagos'))::date into v_date
  from public.hotels h where h.hotel_id=p_hotel_id;
  return jsonb_build_object(
    'capabilities',to_jsonb(v_caps),
    'rooms',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object(
      'rate_plans',coalesce((select jsonb_agg(to_jsonb(plan) order by plan.price_per_night)
      from public.hotel_rate_plans plan where plan.room_id=r.room_id),'[]'::jsonb)
    ) order by r.price_per_night) from public.hotel_rooms r where r.hotel_id=p_hotel_id),'[]'::jsonb),
    'bookings',case when 'stay.read'=any(v_caps) then coalesce((select jsonb_agg(row_data order by created_at desc) from (
      select b.created_at,jsonb_build_object(
        'booking_id',b.booking_id,'room_id',b.room_id,'rate_plan_id',b.rate_plan_id,
        'rate_plan_name',b.rate_plan_name,'check_in',b.check_in,'check_out',b.check_out,
        'guest_count',b.guest_count,'guest_name',b.guest_name,'booking_code',b.booking_code,
        'status',b.status,'payment_status',b.payment_status,'payment_expires_at',b.payment_expires_at,
        'total_price',b.total_price,'special_requests',b.special_requests,
        'assigned_room_unit_id',b.assigned_room_unit_id,
        'profiles',jsonb_build_object('username',p.username),
        'hotel_rooms',jsonb_build_object('room_type',r.room_type)
      ) row_data from public.hotel_bookings b
      left join public.profiles p on p.user_id=b.user_id
      left join public.hotel_rooms r on r.room_id=b.room_id
      where b.hotel_id=p_hotel_id order by b.created_at desc limit 200
    ) records),'[]'::jsonb) else '[]'::jsonb end,
    'inventory',coalesce((select jsonb_agg(jsonb_build_object(
      'room_id',i.room_id,'inventory_date',i.inventory_date,'available_quantity',i.available_quantity,
      'rate_override',i.rate_override,'closed',i.closed,'note',i.note
    )) from public.hotel_inventory_daily i where i.hotel_id=p_hotel_id and i.inventory_date=v_date),'[]'::jsonb),
    'room_units',coalesce((select jsonb_agg(to_jsonb(u) order by u.unit_label)
      from public.hotel_room_units u where u.hotel_id=p_hotel_id),'[]'::jsonb),
    'venues',coalesce((select jsonb_agg(to_jsonb(v) order by v.kind,v.name)
      from public.hotel_venues v where v.hotel_id=p_hotel_id),'[]'::jsonb)
  );
end $$;
revoke all on function public.get_my_hotel_operation_snapshot(integer) from public,anon;
grant execute on function public.get_my_hotel_operation_snapshot(integer) to authenticated,service_role;

create or replace function public.get_hotel_review_summary(p_hotel_id integer)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public' as $$
begin
  if public.get_public_hotel_detail(p_hotel_id) is null then return null; end if;
  return jsonb_build_object(
    'reviews',coalesce((select jsonb_agg(review order by created_at desc) from (
      select r.created_at,jsonb_build_object('review_id',r.review_id,'hotel_id',r.hotel_id,
        'rating',r.rating,'comment',r.comment,'created_at',r.created_at,
        'profiles',jsonb_build_object('username',p.username,'avatar_url',p.avatar_url)) review
      from public.hotel_reviews r left join public.profiles p on p.user_id=r.user_id
      where r.hotel_id=p_hotel_id order by r.created_at desc limit 100
    ) rows),'[]'::jsonb),
    'eligible',exists(select 1 from public.hotel_bookings b where b.hotel_id=p_hotel_id
      and b.user_id=public.current_profile_user_id() and b.payment_status='paid'
      and b.status in ('checked_out','completed'))
  );
end $$;
revoke all on function public.get_hotel_review_summary(integer) from public;
grant execute on function public.get_hotel_review_summary(integer) to anon,authenticated,service_role;

-- A notice is about a different device, not just a different login session.
-- This read never approves a login or marks a security notification read.
create or replace function public.get_my_pending_device_login_alert()
returns jsonb language sql stable security definer
set search_path to 'pg_catalog','public' as $$
  select jsonb_build_object('notificationId',n.id,'sessionId',target.id,
    'device',target.device,'os',target.os,'browser',target.browser,'loginTime',target.login_time)
  from public.user_sessions current_session
  join public.user_sessions target on target.user_id=current_session.user_id
    and target.auth_id=current_session.auth_id and target.is_active
    and target.trust_status='trusted'
    and target.id<>current_session.id
    and target.auth_session_id is distinct from current_session.auth_session_id
    and target.device_id is distinct from current_session.device_id
  join public.notifications n on n.recipient_id=target.user_id and n.source_id=target.id::text
    and n.type='new_device_login' and not coalesce(n.read,false)
    and n.destination_params->>'decision' in ('unreviewed','verified_with_google')
  where current_session.user_id=public.current_profile_user_id()
    and current_session.auth_id=(select auth.uid())::text
    and current_session.auth_session_id=(select auth.jwt()->>'session_id')
    and current_session.is_active and current_session.trust_status='trusted'
    and n.created_at>=now()-interval '30 days'
  order by target.login_time desc,n.created_at desc limit 1
$$;
revoke all on function public.get_my_pending_device_login_alert() from public,anon;
grant execute on function public.get_my_pending_device_login_alert() to authenticated,service_role;

-- Qualify the table key: id is also a RETURNS TABLE output variable.
CREATE OR REPLACE FUNCTION public.get_support_messages(p_conversation_id uuid) RETURNS TABLE(id uuid, sender_id text, sender_name text, sender_role text, content text, attachments text[], attachment_types text[], action_type text, action_metadata jsonb, visibility text, is_read boolean, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_actor public.profiles;
  v_conversation public.partner_support_conversations;
  v_team boolean;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Authentication required'; end if;
  select * into v_conversation from public.partner_support_conversations c
  where c.id=p_conversation_id;
  if v_conversation.id is null then raise exception 'Conversation not found'; end if;
  if not public.current_actor_can_access_operational_conversation(
    p_conversation_id,false
  ) then raise exception 'Not authorised'; end if;
  v_team:=v_actor.user_id<>v_conversation.partner_id;

  return query
  select m.id,m.sender_id,coalesce(p.full_name,p.username,'WeHouse'),
    m.sender_role,m.content,m.attachments,m.attachment_types,m.action_type,
    coalesce(m.action_metadata,'{}'::jsonb),m.visibility,m.is_read,m.created_at
  from public.partner_support_messages m
  left join public.profiles p on p.user_id=m.sender_id
  where m.conversation_id=p_conversation_id
    and (m.visibility='customer' or v_team)
  order by m.created_at;
end
$$;
