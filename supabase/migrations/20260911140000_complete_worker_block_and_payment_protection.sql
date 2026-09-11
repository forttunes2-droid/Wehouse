-- Make service-participant blocking one atomic safety operation regardless of
-- whether it starts from the conversation header or the participant profile.

alter table public.worker_user_blocks
  add column if not exists reason text;
alter table public.worker_user_blocks
  drop constraint if exists worker_user_blocks_reason_length;
alter table public.worker_user_blocks
  add constraint worker_user_blocks_reason_length
  check(char_length(coalesce(reason,''))<=500);

create or replace function public.set_my_worker_block(
  p_user_id text,
  p_blocked boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_peer public.profiles;
  v_booking record;
  v_cancelled integer := 0;
  v_review integer := 0;
  v_case_id uuid;
  v_case_ids jsonb := '[]'::jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Authentication required'; end if;

  select * into v_peer
  from public.profiles
  where user_id=p_user_id and not coalesce(deleted,false)
  limit 1;
  if v_peer.user_id is null then raise exception 'Person not found'; end if;
  if not ((v_actor.role='user' and v_peer.role='worker')
       or (v_actor.role='worker' and v_peer.role='user')) then
    raise exception 'Worker booking participants required';
  end if;
  if not exists(
    select 1 from public.worker_bookings booking
    where (booking.user_id=v_actor.user_id and booking.worker_id=v_peer.user_id)
       or (booking.user_id=v_peer.user_id and booking.worker_id=v_actor.user_id)
  ) then raise exception 'Worker booking relationship required'; end if;

  if not coalesce(p_blocked,false) then
    delete from public.worker_user_blocks
    where blocker_user_id=v_actor.user_id and blocked_user_id=v_peer.user_id;
    return jsonb_build_object(
      'blocked',false,
      'booking_action','none',
      'cancelled_bookings',0,
      'review_bookings',0
    );
  end if;

  insert into public.worker_user_blocks(blocker_user_id,blocked_user_id,reason)
  values(v_actor.user_id,v_peer.user_id,v_reason)
  on conflict(blocker_user_id,blocked_user_id) do update
  set reason=excluded.reason,created_at=now();

  -- Stop an already-ringing or connected call immediately on every service
  -- conversation between these two people.
  update public.private_calls call
  set status=case when call.status='ringing' then 'declined' else 'ended' end,
      ended_at=coalesce(call.ended_at,now())
  where call.context_type='worker_booking'
    and call.status in ('ringing','accepted')
    and ((call.caller_id=v_actor.user_id and call.callee_id=v_peer.user_id)
      or (call.caller_id=v_peer.user_id and call.callee_id=v_actor.user_id));

  for v_booking in
    select booking.*,
      exists(
        select 1 from public.booking_payments payment
        where payment.worker_booking_id=booking.id
          and (payment.status in ('paid','completed','review_required')
            or payment.verified_at is not null)
      ) or exists(
        select 1 from public.payment_protection_transactions protection
        where protection.booking_id=booking.id
          and protection.booking_type='worker_booking'
          and protection.status not in ('released','refunded','reversed')
      ) as has_secured_money
    from public.worker_bookings booking
    where (booking.user_id=v_actor.user_id and booking.worker_id=v_peer.user_id)
       or (booking.user_id=v_peer.user_id and booking.worker_id=v_actor.user_id)
    for update
  loop
    if v_booking.status in ('approved_released','refunded') then
      continue;
    end if;

    if v_booking.has_secured_money
       or v_booking.status in ('confirmed','payment_protected','in_progress','completed_pending_approval','disputed') then
      update public.booking_payments payment
      set status='review_required',updated_at=now()
      where payment.worker_booking_id=v_booking.id
        and (payment.status in ('paid','completed','review_required')
          or payment.verified_at is not null);

      update public.worker_bookings
      set status='disputed',
          dispute_reason=concat_ws(E'\n',nullif(dispute_reason,''),
            'Communication blocked; WeHouse payment review required.'),
          updated_at=now()
      where id=v_booking.id;
      v_review:=v_review+1;

      select conversation.id into v_case_id
      from public.partner_support_conversations conversation
      where conversation.partner_id=v_actor.user_id
        and conversation.context_type='worker_booking'
        and conversation.context_id=v_booking.id::text
      order by conversation.created_at desc
      limit 1;

      if v_case_id is null then
        insert into public.partner_support_conversations(
          partner_id,requester_role,subject,status,category,context_type,
          context_id,context_snapshot,priority,channel_kind,created_at,updated_at
        ) values(
          v_actor.user_id,v_actor.role,
          'Service booking safety review · '||coalesce(v_booking.booking_code,'Booking'),
          'open','safety','worker_booking',v_booking.id::text,
          jsonb_build_object(
            'source_type','worker_booking','booking_id',v_booking.id,
            'booking_code',v_booking.booking_code,
            'service_type',v_booking.service_type,
            'status','disputed','payment_status','review_required'
          ),
          'urgent','support_case',now(),now()
        ) returning id into v_case_id;
      else
        update public.partner_support_conversations
        set status=case when status in ('resolved','closed') then 'open' else status end,
            priority='urgent',
            context_snapshot=context_snapshot||jsonb_build_object(
              'status','disputed','payment_status','review_required'
            ),
            updated_at=now()
        where id=v_case_id;
      end if;

      insert into public.partner_support_messages(
        conversation_id,sender_id,sender_role,content,action_type,
        action_metadata,created_at
      ) values(
        v_case_id,v_actor.user_id,v_actor.role,
        'I blocked this booking participant. Please review the job and its protected payment.',
        'status_change',
        jsonb_build_object('context_id',v_booking.id,'reason',v_reason),now()
      );
      v_case_ids:=v_case_ids||jsonb_build_array(v_case_id);
    elsif v_booking.status in ('booking_requested','negotiating','waiting_payment') then
      update public.worker_bookings
      set status='cancelled',cancelled_by=v_actor.user_id,
          cancellation_reason=coalesce(v_reason,'Participant blocked'),updated_at=now()
      where id=v_booking.id;
      update public.booking_payments
      set status='cancelled',updated_at=now()
      where worker_booking_id=v_booking.id and status='pending';
      v_cancelled:=v_cancelled+1;
    end if;
  end loop;

  return jsonb_build_object(
    'blocked',true,
    'cancelled_bookings',v_cancelled,
    'review_bookings',v_review,
    'booking_action',case
      when v_review>0 then 'review_required'
      when v_cancelled>0 then 'cancelled'
      else 'none'
    end,
    'support_conversation_id',v_case_id,
    'support_conversation_ids',v_case_ids
  );
end;
$$;

-- Keep the legacy conversation-id entry point behaviorally identical.
create or replace function public.set_my_worker_block(
  p_conversation_id uuid,
  p_blocked boolean
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_me text:=public.current_profile_user_id();
  v_peer text;
begin
  if v_me is null then raise exception 'Authenticated profile required'; end if;
  select case when conversation.user_id=v_me then conversation.worker_id else conversation.user_id end
  into v_peer
  from public.booking_conversations conversation
  where conversation.id=p_conversation_id
    and v_me in (conversation.user_id,conversation.worker_id)
  limit 1;
  if v_peer is null or v_peer=v_me then raise exception 'Worker conversation unavailable'; end if;
  perform public.set_my_worker_block(v_peer,coalesce(p_blocked,false),null);
  return coalesce(p_blocked,false);
end;
$$;

-- Never advertise or create a service call after either participant blocks the
-- other. The trigger is the final backstop for every insertion path.
create or replace function public.get_private_call_capabilities(
  p_context_type text,
  p_context_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_me text:=public.current_profile_user_id();
  v_peer text;
  v_profile public.profiles;
  v_pref public.private_call_preferences;
begin
  if v_me is null then raise exception 'Authenticated profile required'; end if;
  if p_context_type='roommate' then
    select case when conversation.participant_a=v_me then conversation.participant_b else conversation.participant_a end
    into v_peer
    from public.conversations conversation
    where conversation.id=p_context_id
      and conversation.conversation_type='roommate'
      and coalesce(conversation.status,'active')='active'
      and v_me in (conversation.participant_a,conversation.participant_b)
    limit 1;
    if exists(
      select 1 from public.roommate_user_blocks block_row
      where (block_row.blocker_user_id=v_me and block_row.blocked_user_id=v_peer)
         or (block_row.blocker_user_id=v_peer and block_row.blocked_user_id=v_me)
    ) then raise exception 'This roommate connection is blocked'; end if;
  elsif p_context_type='worker_booking' then
    select case when conversation.user_id=v_me then conversation.worker_id else conversation.user_id end
    into v_peer
    from public.booking_conversations conversation
    join public.worker_bookings booking on booking.id=conversation.booking_id
    where conversation.id=p_context_id
      and v_me in (conversation.user_id,conversation.worker_id)
      and booking.status not in ('approved_released','cancelled','refunded')
    limit 1;
    if exists(
      select 1 from public.worker_user_blocks block_row
      where (block_row.blocker_user_id=v_me and block_row.blocked_user_id=v_peer)
         or (block_row.blocker_user_id=v_peer and block_row.blocked_user_id=v_me)
    ) then raise exception 'This service conversation is blocked'; end if;
  else
    raise exception 'Unsupported call context';
  end if;
  if v_peer is null then raise exception 'This job conversation is closed'; end if;
  select * into v_profile from public.profiles
  where user_id=v_peer and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if v_profile is null or not(v_profile.account_kind='consumer' or v_profile.role='worker') then
    raise exception 'This person cannot receive private calls';
  end if;
  select * into v_pref from public.private_call_preferences where user_id=v_peer;
  return jsonb_build_object(
    'peer_id',v_peer,
    'peer_name',coalesce(v_profile.full_name,v_profile.username,'WeHouse member'),
    'peer_avatar',v_profile.avatar_url,
    'allow_audio_calls',coalesce(v_pref.allow_audio_calls,true),
    'allow_video_calls',coalesce(v_pref.allow_video_calls,true)
  );
end;
$$;

create or replace function public.enforce_roommate_call_not_blocked()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user text;
  v_worker text;
begin
  if new.context_type='roommate' and exists(
    select 1 from public.roommate_user_blocks block_row
    where (block_row.blocker_user_id=new.caller_id and block_row.blocked_user_id=new.callee_id)
       or (block_row.blocker_user_id=new.callee_id and block_row.blocked_user_id=new.caller_id)
  ) then
    raise exception 'This roommate connection is blocked';
  elsif new.context_type='worker_booking' then
    select conversation.user_id,conversation.worker_id into v_user,v_worker
    from public.booking_conversations conversation
    where conversation.id=new.context_id;
    if v_user is null
       or not(new.caller_id in (v_user,v_worker) and new.callee_id in (v_user,v_worker)) then
      raise exception 'Worker call participants do not match the booking';
    end if;
    if exists(
      select 1 from public.worker_user_blocks block_row
      where (block_row.blocker_user_id=v_user and block_row.blocked_user_id=v_worker)
         or (block_row.blocker_user_id=v_worker and block_row.blocked_user_id=v_user)
    ) then raise exception 'This service conversation is blocked'; end if;
  end if;
  return new;
end;
$$;

-- Surface the same payment and block truth used by the actions in the chat UI.
create or replace function public.get_my_worker_booking_details(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_booking public.worker_bookings;
  v_customer public.profiles;
  v_worker public.profiles;
  v_payment_state text;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
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
  select payment.status into v_payment_state
  from public.booking_payments payment
  where payment.worker_booking_id=v_booking.id
  order by case payment.status
    when 'review_required' then 0 when 'paid' then 1 when 'completed' then 2 else 3 end,
    payment.created_at desc
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
    'payment_status',coalesce(v_payment_state,'not_started'),
    'payment_review_required',exists(
      select 1 from public.booking_payments payment
      where payment.worker_booking_id=v_booking.id and payment.status='review_required'
    ),
    'payment_protected',exists(
      select 1 from public.payment_protection_transactions protection
      where protection.booking_id=v_booking.id and protection.booking_type='worker_booking'
        and protection.status not in ('released','refunded','reversed')
    ),
    'blocked_by_me',exists(
      select 1 from public.worker_user_blocks block_row
      where block_row.blocker_user_id=v_actor.user_id
        and block_row.blocked_user_id=case when v_actor.user_id=v_booking.user_id then v_booking.worker_id else v_booking.user_id end
    ),
    'blocked_me',exists(
      select 1 from public.worker_user_blocks block_row
      where block_row.blocker_user_id=case when v_actor.user_id=v_booking.user_id then v_booking.worker_id else v_booking.user_id end
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

-- Resolve the payment/block race safely. If Paystack confirms after one party
-- blocked and the unpaid request was cancelled, record the verified money,
-- create Payment Protection, and move the booking into WeHouse review.
create or replace function public.confirm_worker_booking_payment(
  p_booking_id uuid,
  p_paystack_reference text,
  p_amount_verified numeric,
  p_currency text default 'NGN',
  p_transaction_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_booking public.worker_bookings;
  v_payment public.booking_payments;
  v_worker public.profiles;
  v_blocker public.profiles;
  v_rate numeric;
  v_commission numeric;
  v_receives numeric;
  v_case_id uuid;
begin
  if nullif(btrim(p_paystack_reference),'') is null then
    return jsonb_build_object('success',false,'error','Paystack reference is required');
  end if;
  if p_amount_verified is null or p_amount_verified<=0 then
    return jsonb_build_object('success',false,'error','Verified amount must be positive');
  end if;
  if p_currency<>'NGN' then
    return jsonb_build_object('success',false,'error','Only NGN currency is supported');
  end if;

  select * into v_payment from public.booking_payments
  where paystack_reference=p_paystack_reference for update;
  if v_payment.id is null
     or v_payment.purpose is distinct from 'worker_booking'
     or v_payment.worker_booking_id is null
     or v_payment.worker_booking_id<>p_booking_id then
    return jsonb_build_object('success',false,'error','Payment record mismatch');
  end if;
  if exists(
    select 1 from public.verified_paystack_references reference
    where reference.paystack_reference=p_paystack_reference
  ) or v_payment.status in ('paid','completed','review_required') then
    return jsonb_build_object(
      'success',true,
      'already_processed',true,
      'requires_review',v_payment.status='review_required'
    );
  end if;

  select * into v_booking from public.worker_bookings where id=p_booking_id for update;
  if v_booking.id is null then
    return jsonb_build_object('success',false,'error','Booking not found');
  end if;
  if v_payment.payer_user_id<>v_booking.user_id then
    return jsonb_build_object('success',false,'error','Payment payer does not match booking customer');
  end if;
  if round(coalesce(v_payment.amount_total,v_payment.amount,0)::numeric,2)
       <>round(p_amount_verified,2)
     or round(coalesce(v_booking.negotiated_amount,v_booking.agreed_amount,0)::numeric,2)
       <>round(p_amount_verified,2) then
    return jsonb_build_object('success',false,'error','Amount mismatch');
  end if;

  select nullif(btrim(setting.value),'')::numeric into v_rate
  from public.platform_settings setting
  where setting.key='worker_commission_rate' and setting.is_active=true;
  if v_rate is null or v_rate<0 or v_rate>50 then
    return jsonb_build_object('success',false,'error','Invalid commission rate');
  end if;
  v_commission:=round((p_amount_verified*v_rate/100)::numeric,2);
  v_receives:=round(p_amount_verified,2)-v_commission;

  if v_booking.status<>'waiting_payment' then
    select blocker_profile.* into v_blocker
    from public.worker_user_blocks block_row
    join public.profiles blocker_profile on blocker_profile.user_id=block_row.blocker_user_id
    where (block_row.blocker_user_id=v_booking.user_id and block_row.blocked_user_id=v_booking.worker_id)
       or (block_row.blocker_user_id=v_booking.worker_id and block_row.blocked_user_id=v_booking.user_id)
    order by block_row.created_at desc
    limit 1;
    if v_blocker.user_id is null or v_booking.status not in ('cancelled','disputed') then
      return jsonb_build_object('success',false,'error','Booking is not awaiting payment');
    end if;

    update public.worker_bookings
    set status='disputed',paystack_reference=p_paystack_reference,
        paystack_transaction_id=p_transaction_id,
        agreed_amount=round(p_amount_verified,2),wehouse_fee=v_commission,
        worker_commission=v_commission,worker_receives=v_receives,
        dispute_reason=concat_ws(E'\n',nullif(dispute_reason,''),
          'Payment completed after contact was blocked; WeHouse review required.'),
        updated_at=now()
    where id=p_booking_id;

    insert into public.payment_protection_transactions(
      booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
      amount_commission,amount_payee,commission_rate,status,paystack_reference,
      created_at,updated_at
    ) values(
      p_booking_id,'worker_booking',v_booking.user_id,v_booking.worker_id,
      round(p_amount_verified,2),v_commission,v_receives,v_rate,'protected',
      p_paystack_reference,now(),now()
    ) on conflict do nothing;

    update public.booking_payments
    set status='review_required',
        paystack_transaction_id=coalesce(p_transaction_id,paystack_transaction_id),
        verified_amount=round(p_amount_verified,2),verified_at=now(),
        verification_source='edge_function',paid_at=now(),
        webhook_processed=true,updated_at=now()
    where id=v_payment.id;
    insert into public.verified_paystack_references(
      paystack_reference,booking_payment_id,verified_amount,
      verification_source,verified_by
    ) values(
      p_paystack_reference,v_payment.id,round(p_amount_verified,2),
      'edge_function','paystack-verify'
    ) on conflict(paystack_reference) do nothing;

    select conversation.id into v_case_id
    from public.partner_support_conversations conversation
    where conversation.partner_id=v_blocker.user_id
      and conversation.context_type='worker_booking'
      and conversation.context_id=p_booking_id::text
    order by conversation.created_at desc limit 1;
    if v_case_id is null then
      insert into public.partner_support_conversations(
        partner_id,requester_role,subject,status,category,context_type,
        context_id,context_snapshot,priority,channel_kind,created_at,updated_at
      ) values(
        v_blocker.user_id,v_blocker.role,
        'Service booking payment review · '||coalesce(v_booking.booking_code,'Booking'),
        'open','payment','worker_booking',p_booking_id::text,
        jsonb_build_object(
          'source_type','worker_booking','booking_id',p_booking_id,
          'booking_code',v_booking.booking_code,'service_type',v_booking.service_type,
          'status','disputed','payment_status','review_required'
        ),
        'urgent','support_case',now(),now()
      ) returning id into v_case_id;
    else
      update public.partner_support_conversations
      set status=case when status in ('resolved','closed') then 'open' else status end,
          priority='urgent',
          context_snapshot=context_snapshot||jsonb_build_object(
            'status','disputed','payment_status','review_required'
          ),
          updated_at=now()
      where id=v_case_id;
    end if;
    insert into public.partner_support_messages(
      conversation_id,sender_id,sender_role,content,action_type,
      action_metadata,created_at
    ) values(
      v_case_id,v_blocker.user_id,v_blocker.role,
      'Paystack confirmed payment after contact was blocked. The money is protected and needs WeHouse review.',
      'status_change',jsonb_build_object('context_id',p_booking_id,'payment_status','review_required'),now()
    );
    return jsonb_build_object(
      'success',true,'requires_review',true,'payment_protected',true,
      'commission_rate',v_rate,'commission_amount',v_commission,
      'worker_receives',v_receives
    );
  end if;

  select * into v_worker from public.profiles
  where user_id=v_booking.worker_id and role='worker';
  if v_worker.user_id is null or v_worker.worker_status<>'verified'
     or v_worker.worker_verified is distinct from true
     or coalesce(v_worker.deleted,false) or coalesce(v_worker.suspended,false)
     or coalesce(v_worker.banned,false) then
    return jsonb_build_object('success',false,'error','Worker is no longer eligible for payment');
  end if;
  if exists(
    select 1 from public.payment_protection_transactions protection
    where protection.booking_id=p_booking_id and protection.booking_type='worker_booking'
  ) then
    return jsonb_build_object('success',false,'error','Payment Protection already exists for this booking');
  end if;
  update public.worker_bookings
  set status='confirmed',paystack_reference=p_paystack_reference,
      paystack_transaction_id=p_transaction_id,
      agreed_amount=round(p_amount_verified,2),wehouse_fee=v_commission,
      worker_commission=v_commission,worker_receives=v_receives,updated_at=now()
  where id=p_booking_id;
  insert into public.payment_protection_transactions(
    booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
    amount_commission,amount_payee,commission_rate,status,paystack_reference,
    created_at,updated_at
  ) values(
    p_booking_id,'worker_booking',v_booking.user_id,v_booking.worker_id,
    round(p_amount_verified,2),v_commission,v_receives,v_rate,'protected',
    p_paystack_reference,now(),now()
  );
  update public.booking_payments
  set status='paid',paystack_transaction_id=coalesce(p_transaction_id,paystack_transaction_id),
      verified_amount=round(p_amount_verified,2),verified_at=now(),
      verification_source='edge_function',paid_at=now(),
      webhook_processed=true,updated_at=now()
  where id=v_payment.id;
  insert into public.verified_paystack_references(
    paystack_reference,booking_payment_id,verified_amount,
    verification_source,verified_by
  ) values(
    p_paystack_reference,v_payment.id,round(p_amount_verified,2),
    'edge_function','paystack-verify'
  ) on conflict(paystack_reference) do nothing;
  return jsonb_build_object(
    'success',true,'commission_rate',v_rate,'commission_amount',v_commission,
    'worker_receives',v_receives
  );
end;
$$;

revoke all on function public.set_my_worker_block(text,boolean,text) from public,anon;
revoke all on function public.set_my_worker_block(uuid,boolean) from public,anon;
revoke all on function public.get_private_call_capabilities(text,uuid) from public,anon;
revoke all on function public.enforce_roommate_call_not_blocked() from public,anon,authenticated;
revoke all on function public.get_my_worker_booking_details(uuid) from public,anon;
grant execute on function public.set_my_worker_block(text,boolean,text) to authenticated,service_role;
grant execute on function public.set_my_worker_block(uuid,boolean) to authenticated,service_role;
grant execute on function public.get_private_call_capabilities(text,uuid) to authenticated,service_role;
grant execute on function public.enforce_roommate_call_not_blocked() to service_role;
grant execute on function public.get_my_worker_booking_details(uuid) to authenticated,service_role;
