-- Blocking is a communication safety boundary, not a discovery ban. The
-- relationship side is taken from the booking itself, never profiles.role.

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
  v_actor_side text;
  v_cancelled integer:=0;
  v_review integer:=0;
  v_case_id uuid;
  v_case_ids jsonb:='[]'::jsonb;
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Authentication required'; end if;
  select * into v_peer from public.profiles
  where user_id=p_user_id and not coalesce(deleted,false) limit 1;
  if v_peer.user_id is null then raise exception 'Person not found'; end if;
  if not exists(
    select 1 from public.worker_bookings booking
    where (booking.user_id=v_actor.user_id and booking.worker_id=v_peer.user_id)
       or (booking.user_id=v_peer.user_id and booking.worker_id=v_actor.user_id)
  ) then raise exception 'Worker booking relationship required'; end if;

  if not coalesce(p_blocked,false) then
    delete from public.worker_user_blocks
    where blocker_user_id=v_actor.user_id and blocked_user_id=v_peer.user_id;
    return jsonb_build_object(
      'blocked',false,'booking_action','none',
      'cancelled_bookings',0,'review_bookings',0
    );
  end if;

  insert into public.worker_user_blocks(blocker_user_id,blocked_user_id,reason)
  values(v_actor.user_id,v_peer.user_id,v_reason)
  on conflict(blocker_user_id,blocked_user_id) do update
  set reason=excluded.reason,created_at=now();

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
    v_actor_side:=case when v_booking.user_id=v_actor.user_id
      then 'user' else 'worker' end;
    if v_booking.status in ('approved_released','refunded') then continue; end if;
    if v_booking.has_secured_money
       or v_booking.status in (
         'confirmed','payment_protected','in_progress',
         'completed_pending_approval','disputed'
       ) then
      update public.booking_payments payment
      set status='review_required',updated_at=now()
      where payment.worker_booking_id=v_booking.id
        and (payment.status in ('paid','completed','review_required')
          or payment.verified_at is not null);
      update public.worker_bookings
      set status='disputed',
          dispute_reason=concat_ws(
            E'\n',nullif(dispute_reason,''),
            'Communication blocked; WeHouse payment review required.'
          ),
          updated_at=now()
      where id=v_booking.id;
      v_review:=v_review+1;
      select conversation.id into v_case_id
      from public.partner_support_conversations conversation
      where conversation.partner_id=v_actor.user_id
        and conversation.context_type='worker_booking'
        and conversation.context_id=v_booking.id::text
      order by conversation.created_at desc limit 1;
      if v_case_id is null then
        insert into public.partner_support_conversations(
          partner_id,requester_role,subject,status,category,context_type,
          context_id,context_snapshot,priority,channel_kind,created_at,updated_at
        ) values(
          v_actor.user_id,v_actor_side,
          'Service booking safety review · '
            ||coalesce(v_booking.booking_code,'Booking'),
          'open','safety','worker_booking',v_booking.id::text,
          jsonb_build_object(
            'source_type','worker_booking','booking_id',v_booking.id,
            'booking_code',v_booking.booking_code,
            'service_type',v_booking.service_type,
            'status','disputed','payment_status','review_required',
            'requester_relationship',v_actor_side
          ),
          'urgent','support_case',now(),now()
        ) returning id into v_case_id;
      else
        update public.partner_support_conversations
        set status=case when status in ('resolved','closed')
              then 'open' else status end,
            priority='urgent',
            context_snapshot=context_snapshot||jsonb_build_object(
              'status','disputed','payment_status','review_required',
              'requester_relationship',v_actor_side
            ),
            updated_at=now()
        where id=v_case_id;
      end if;
      insert into public.partner_support_messages(
        conversation_id,sender_id,sender_role,content,action_type,
        action_metadata,created_at
      ) values(
        v_case_id,v_actor.user_id,v_actor_side,
        'I blocked this booking participant. Please review the job and its protected payment.',
        'status_change',
        jsonb_build_object(
          'context_id',v_booking.id,'reason',v_reason,
          'requester_relationship',v_actor_side
        ),now()
      );
      v_case_ids:=v_case_ids||jsonb_build_array(v_case_id);
    elsif v_booking.status in (
      'booking_requested','negotiating','waiting_payment'
    ) then
      update public.worker_bookings
      set status='cancelled',cancelled_by=v_actor.user_id,
          cancellation_reason=coalesce(v_reason,'Participant blocked'),
          updated_at=now()
      where id=v_booking.id;
      update public.booking_payments
      set status='cancelled',updated_at=now()
      where worker_booking_id=v_booking.id and status='pending';
      v_cancelled:=v_cancelled+1;
    end if;
  end loop;
  return jsonb_build_object(
    'blocked',true,'cancelled_bookings',v_cancelled,
    'review_bookings',v_review,
    'booking_action',case
      when v_review>0 then 'review_required'
      when v_cancelled>0 then 'cancelled'
      else 'none' end,
    'support_conversation_id',v_case_id,
    'support_conversation_ids',v_case_ids
  );
end
$$;

create or replace function public.get_public_workers(
  p_state text default null,
  p_city text default null,
  p_occupation text default null
)
returns table(
  user_id text,full_name text,username text,avatar_url text,bio text,
  state text,city text,local_government text,area text,
  worker_occupation text,worker_skills jsonb,worker_price integer,
  worker_bio text,worker_experience text,rating numeric,review_count integer,
  is_online boolean,last_seen timestamptz,services jsonb,coverage jsonb
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  return query
  select
    profile.user_id,profile.full_name,profile.username,profile.avatar_url,
    profile.bio,profile.state,profile.city,profile.local_government,
    profile.area,profile.worker_occupation,profile.worker_skills,
    profile.worker_price,profile.worker_bio,profile.worker_experience,
    profile.rating,profile.review_count,profile.is_online,profile.last_seen,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name',service.service_name,'price',service.price,
        'price_type',service.price_type
      )) from public.worker_services service
      where service.worker_id=profile.user_id
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'state',coverage.state,'lga',coverage.lga,'areas',coverage.areas
      )) from public.worker_service_coverage coverage
      where coverage.worker_id=profile.user_id
    ),'[]'::jsonb)
  from public.profiles profile
  where public.user_has_active_workspace(profile.user_id,'worker')
    and profile.worker_status='verified'
    and profile.worker_verified=true
    and profile.available=true
    and not profile.deleted and not profile.suspended and not profile.banned
    and public.worker_identity_is_current(profile.user_id)
    and (p_state is null
      or public.wehouse_state_key(profile.state)=public.wehouse_state_key(p_state))
    and (p_city is null or profile.city ilike p_city
      or profile.local_government ilike p_city)
    and (p_occupation is null
      or profile.worker_occupation ilike p_occupation)
  order by profile.rating desc nulls last,
    profile.review_count desc nulls last;
end
$$;

revoke all on function public.set_my_worker_block(text,boolean,text)
from public,anon;
grant execute on function public.set_my_worker_block(text,boolean,text)
to authenticated,service_role;
revoke all on function public.get_public_workers(text,text,text)
from public;
grant execute on function public.get_public_workers(text,text,text)
to anon,authenticated,service_role;

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
  case when procedure.proname='get_public_workers'
    then 'approved_public_projection' else 'approved_client_rpc' end,
  case when procedure.proname='get_public_workers'
    then 'Field-limited public discovery; communication blocks do not hide profiles'
    else 'Relationship-bound contact block preserving secured obligations and relationship persona'
  end,
  now()
from pg_proc procedure
join pg_namespace namespace on namespace.oid=procedure.pronamespace
where namespace.nspname='public'
  and procedure.oid in(
    'public.set_my_worker_block(text,boolean,text)'::regprocedure,
    'public.get_public_workers(text,text,text)'::regprocedure
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
