alter table public.roommate_user_blocks
  add column if not exists reason text,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_my_roommate_block_v2(
  p_user_id text,
  p_blocked boolean,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare
  actor public.profiles;
  conversation_id uuid;
  group_row public.shared_housing_groups;
  cancellation_state text:='none';
  has_paid_member boolean:=false;
begin
  actor:=public._current_comm_actor();
  if actor is null or not public.current_actor_has_personal_workspace() or actor.user_id=p_user_id then
    raise exception 'Invalid roommate block request';
  end if;
  select c.id into conversation_id
  from public.conversations c
  where c.conversation_type='roommate' and actor.user_id in(c.participant_a,c.participant_b) and p_user_id in(c.participant_a,c.participant_b)
  order by c.created_at desc limit 1;
  if conversation_id is null then raise exception 'Roommate connection unavailable'; end if;

  if p_blocked then
    insert into public.roommate_user_blocks(blocker_user_id,blocked_user_id,reason,created_at,updated_at)
    values(actor.user_id,p_user_id,nullif(left(btrim(coalesce(p_reason,'')),500),''),now(),now())
    on conflict(blocker_user_id,blocked_user_id) do update
      set reason=excluded.reason,updated_at=now();
    delete from public.roommate_search_results
    where (searcher_id=actor.user_id and matched_user_id=p_user_id) or (searcher_id=p_user_id and matched_user_id=actor.user_id);
    update public.private_calls
    set status=case when status='ringing' then 'declined' else 'ended' end,ended_at=coalesce(ended_at,now())
    where context_type='roommate' and status in('ringing','accepted')
      and ((caller_id=actor.user_id and callee_id=p_user_id) or (caller_id=p_user_id and callee_id=actor.user_id));

    for group_row in
      select g.* from public.shared_housing_groups g
      where g.conversation_id=conversation_id and g.status in('inviting','ready','payment_pending','paid')
      for update
    loop
      select exists(select 1 from public.shared_housing_members m where m.group_id=group_row.id and m.payment_status='paid') into has_paid_member;
      if has_paid_member or group_row.reservation_id is not null then
        cancellation_state:='review';
        insert into public.notifications(
          recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key,workspace_scope,read,created_at
        )
        select p.user_id,'roommate_shared_booking_cancellation','Shared booking cancellation needs review',
          'A roommate was blocked after payment. Review cancellation and any refund before releasing the property.',
          coalesce(group_row.reservation_id,group_row.id::text),'shared_housing',group_row.id::text,'operations_bookings',
          jsonb_build_object('shared_group_id',group_row.id::text,'reservation_id',group_row.reservation_id,'conversation_id',conversation_id::text),
          'roommate_block_cancellation:'||group_row.id::text,'creator',false,now()
        from public.profiles p
        where p.role='creator' and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
          and not exists(select 1 from public.notifications n where n.recipient_id=p.user_id and n.event_key='roommate_block_cancellation:'||group_row.id::text);
        insert into public.notifications(
          recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key,workspace_scope,read,created_at
        ) values(
          actor.user_id,'roommate_shared_booking_cancellation','Shared booking cancellation sent to WeHouse',
          'Your block is active. WeHouse must review the paid shared booking before money or property status changes.',
          coalesce(group_row.reservation_id,group_row.id::text),'shared_housing',group_row.id::text,'my_reservations',
          jsonb_build_object('shared_group_id',group_row.id::text,'reservation_id',group_row.reservation_id),
          'my_roommate_block_cancellation:'||group_row.id::text,'personal',false,now())
        on conflict do nothing;
      else
        cancellation_state:='cancelled';
        update public.shared_housing_groups set status='cancelled',updated_at=now() where id=group_row.id;
        update public.shared_housing_members set payment_status=case when payment_status='pending' then 'failed' else payment_status end,updated_at=now() where group_id=group_row.id;
        update public.booking_payments set status='cancelled',updated_at=now()
        where purpose='shared_housing_share' and status='pending' and metadata->>'shared_group_id'=group_row.id::text;
      end if;
    end loop;
  else
    delete from public.roommate_user_blocks where blocker_user_id=actor.user_id and blocked_user_id=p_user_id;
  end if;
  return jsonb_build_object('blocked',p_blocked,'cancellation_state',cancellation_state);
end;
$$;

revoke all on function public.set_my_roommate_block_v2(text,boolean,text) from public,anon;
grant execute on function public.set_my_roommate_block_v2(text,boolean,text) to authenticated,service_role;
