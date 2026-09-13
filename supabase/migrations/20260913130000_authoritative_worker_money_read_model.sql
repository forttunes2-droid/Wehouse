-- Worker job lifecycle and money lifecycle are independent. Every Worker
-- surface must read money state from booking_payments and
-- payment_protection_transactions; booking.status is never a money source.

create or replace function public.worker_booking_money_state(
  p_payment_status text,
  p_protection_status text
)
returns text
language sql
immutable
set search_path to 'pg_catalog','public'
as $$
  select case
    when lower(coalesce(p_protection_status,'')) in ('refunded','reversed') then 'refunded'
    when lower(coalesce(p_protection_status,'')) in ('released','paid_out') then 'released'
    when lower(coalesce(p_protection_status,'')) in ('release_pending','releasing') then 'release_pending'
    when lower(coalesce(p_protection_status,'')) in ('review','under_review','frozen','disputed') then 'review'
    when lower(coalesce(p_protection_status,'')) in ('protected','payment_protected','secured','held','holding') then 'protected'
    when lower(coalesce(p_payment_status,'')) in ('refunded','reversed') then 'refunded'
    when lower(coalesce(p_payment_status,'')) in ('review_required') then 'review'
    -- Verified money without the required protection record is an invariant
    -- failure which must be reviewed, never silently presented as protected.
    when lower(coalesce(p_payment_status,'')) in ('paid','completed') then 'review'
    when lower(coalesce(p_payment_status,'')) in ('pending','payment_pending','processing') then 'payment_pending'
    else 'unpaid'
  end
$$;

revoke all on function public.worker_booking_money_state(text,text) from public,anon;
grant execute on function public.worker_booking_money_state(text,text) to authenticated,service_role;

create or replace function public.get_my_booking_conversations_v3(p_user_id text)
returns table(
  conversation_id uuid,
  booking_id uuid,
  booking_code text,
  booking_status text,
  service_type text,
  negotiated_amount numeric,
  other_person_id text,
  other_person_name text,
  other_person_avatar text,
  last_message text,
  last_message_time timestamptz,
  unread_count bigint,
  updated_at timestamptz,
  payment_status text,
  protection_status text,
  payment_protected boolean,
  money_state text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
begin
  select profile.* into v_actor
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;

  if v_actor.user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_user_id is distinct from v_actor.user_id then
    raise exception 'User identity mismatch';
  end if;

  return query
  select
    conversation.id,
    conversation.booking_id,
    booking.booking_code,
    booking.status,
    booking.service_type,
    booking.negotiated_amount,
    case when conversation.user_id=v_actor.user_id then conversation.worker_id else conversation.user_id end,
    coalesce(other_profile.full_name,other_profile.username,'WeHouse member'),
    other_profile.avatar_url,
    case
      when nullif(btrim(coalesce(latest_message.content,'')),'') is not null then latest_message.content
      when coalesce(cardinality(latest_message.attachments),0)>0
        and latest_message.attachments[1] ~* '\.(webm|m4a|mp3|wav|ogg)(\?|$)' then 'Voice message'
      when coalesce(cardinality(latest_message.attachments),0)>0
        and latest_message.attachments[1] ~* '\.(jpg|jpeg|png|gif|webp)(\?|$)' then 'Photo'
      when coalesce(cardinality(latest_message.attachments),0)>0 then 'Attachment'
      else null
    end,
    latest_message.created_at,
    coalesce(unread.count,0),
    greatest(conversation.updated_at,coalesce(latest_message.created_at,conversation.updated_at)),
    coalesce(current_payment.status,'not_started'),
    current_protection.status,
    lower(coalesce(current_protection.status,'')) in ('protected','payment_protected','secured','held','holding'),
    public.worker_booking_money_state(current_payment.status,current_protection.status)
  from public.booking_conversations conversation
  join public.worker_bookings booking on booking.id=conversation.booking_id
  join public.profiles other_profile on other_profile.user_id=
    case when conversation.user_id=v_actor.user_id then conversation.worker_id else conversation.user_id end
  left join lateral (
    select message.content,message.attachments,message.created_at
    from public.booking_messages message
    where message.conversation_id=conversation.id
    order by message.created_at desc,message.id desc
    limit 1
  ) latest_message on true
  left join lateral (
    select count(*)::bigint as count
    from public.booking_messages message
    where message.conversation_id=conversation.id
      and coalesce(message.is_read,false)=false
      and message.sender_id<>v_actor.user_id
  ) unread on true
  left join lateral (
    select payment.status
    from public.booking_payments payment
    where payment.worker_booking_id=booking.id
      and payment.purpose='worker_booking'
    order by case payment.status
      when 'review_required' then 0
      when 'refunded' then 1
      when 'reversed' then 1
      when 'paid' then 2
      when 'completed' then 2
      when 'pending' then 3
      when 'processing' then 3
      else 4
    end,
    payment.updated_at desc nulls last,
    payment.created_at desc nulls last,
    payment.id desc
    limit 1
  ) current_payment on true
  left join lateral (
    select protection.status
    from public.payment_protection_transactions protection
    where protection.booking_id=booking.id
      and protection.booking_type='worker_booking'
    order by protection.updated_at desc,protection.created_at desc,protection.id desc
    limit 1
  ) current_protection on true
  where (conversation.user_id=v_actor.user_id or conversation.worker_id=v_actor.user_id)
    and (
      (conversation.user_id=v_actor.user_id
        and (conversation.hidden_at_user is null or latest_message.created_at>conversation.hidden_at_user))
      or
      (conversation.worker_id=v_actor.user_id
        and (conversation.hidden_at_worker is null or latest_message.created_at>conversation.hidden_at_worker))
    )
  order by greatest(conversation.updated_at,coalesce(latest_message.created_at,conversation.updated_at)) desc;
end;
$$;

revoke all on function public.get_my_booking_conversations_v3(text) from public,anon;
grant execute on function public.get_my_booking_conversations_v3(text) to authenticated,service_role;

create or replace function public.get_my_worker_booking_details(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_booking public.worker_bookings;
  v_customer public.profiles;
  v_worker public.profiles;
  v_payment_status text;
  v_protection_status text;
begin
  select profile.* into v_actor
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Authentication required'; end if;

  select * into v_booking from public.worker_bookings where id=p_booking_id;
  if v_booking.id is null then return null; end if;
  if v_actor.user_id is distinct from v_booking.user_id
     and v_actor.user_id is distinct from v_booking.worker_id then
    raise exception 'Booking participant access required';
  end if;

  select * into v_customer from public.profiles where user_id=v_booking.user_id limit 1;
  select * into v_worker from public.profiles where user_id=v_booking.worker_id limit 1;

  select payment.status into v_payment_status
  from public.booking_payments payment
  where payment.worker_booking_id=v_booking.id
    and payment.purpose='worker_booking'
  order by case payment.status
    when 'review_required' then 0
    when 'refunded' then 1
    when 'reversed' then 1
    when 'paid' then 2
    when 'completed' then 2
    when 'pending' then 3
    when 'processing' then 3
    else 4
  end,
  payment.updated_at desc nulls last,
  payment.created_at desc nulls last,
  payment.id desc
  limit 1;

  select protection.status into v_protection_status
  from public.payment_protection_transactions protection
  where protection.booking_id=v_booking.id
    and protection.booking_type='worker_booking'
  order by protection.updated_at desc,protection.created_at desc,protection.id desc
  limit 1;

  return jsonb_build_object(
    'id',v_booking.id,'booking_code',v_booking.booking_code,'status',v_booking.status,
    'service_type',v_booking.service_type,'description',v_booking.description,
    'customer_message',v_booking.customer_message,'request_attachments',v_booking.request_attachments,
    'address',v_booking.address,'service_latitude',v_booking.service_latitude,
    'service_longitude',v_booking.service_longitude,
    'service_location_accuracy_m',v_booking.service_location_accuracy_m,
    'service_location_source',v_booking.service_location_source,
    'scheduled_date',v_booking.scheduled_date,'negotiated_amount',v_booking.negotiated_amount,
    'agreed_amount',v_booking.agreed_amount,'wehouse_fee',v_booking.wehouse_fee,
    'worker_receives',v_booking.worker_receives,
    'payment_status',coalesce(v_payment_status,'not_started'),
    'protection_status',v_protection_status,
    'money_state',public.worker_booking_money_state(v_payment_status,v_protection_status),
    'payment_review_required',coalesce(v_payment_status='review_required',false),
    'payment_protected',lower(coalesce(v_protection_status,'')) in
      ('protected','payment_protected','secured','held','holding'),
    'blocked_by_me',exists(
      select 1 from public.worker_user_blocks block_row
      where block_row.blocker_user_id=v_actor.user_id
        and block_row.blocked_user_id=case
          when v_actor.user_id=v_booking.user_id then v_booking.worker_id else v_booking.user_id end
    ),
    'blocked_me',exists(
      select 1 from public.worker_user_blocks block_row
      where block_row.blocker_user_id=case
          when v_actor.user_id=v_booking.user_id then v_booking.worker_id else v_booking.user_id end
        and block_row.blocked_user_id=v_actor.user_id
    ),
    'created_at',v_booking.created_at,'updated_at',v_booking.updated_at,
    'user_id',v_booking.user_id,'worker_id',v_booking.worker_id,
    'user_name',coalesce(v_customer.full_name,v_customer.username,'Customer'),
    'customer_username',v_customer.username,'user_avatar',v_customer.avatar_url,
    'worker_name',coalesce(v_worker.full_name,v_worker.username,'Worker'),
    'worker_avatar',v_worker.avatar_url
  );
end;
$$;

revoke all on function public.get_my_worker_booking_details(uuid) from public,anon;
grant execute on function public.get_my_worker_booking_details(uuid) to authenticated,service_role;
