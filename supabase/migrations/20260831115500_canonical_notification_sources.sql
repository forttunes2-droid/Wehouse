create or replace function public.mark_my_notification_read(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path=public
as $$
begin
  update public.notifications
  set read=true,read_at=coalesce(read_at,now())
  where id=p_notification_id and recipient_id=public.current_profile_user_id();
  return found;
end;
$$;

create or replace function public.mark_all_my_notifications_read()
returns integer language plpgsql security definer set search_path=public
as $$
declare changed integer;
begin
  update public.notifications set read=true,read_at=coalesce(read_at,now())
  where recipient_id=public.current_profile_user_id() and not read;
  get diagnostics changed=row_count;
  return changed;
end;
$$;

create or replace function public.normalize_notification_context()
returns trigger language plpgsql set search_path=public
as $$
begin
  if new.type='roommate_interest' then
    new.source_type:=coalesce(new.source_type,'roommate_interest');
    new.source_id:=coalesce(new.source_id,nullif(new.related_id,'')::uuid);
    new.destination_route:=coalesce(new.destination_route,'roommate');
    new.destination_params:=coalesce(new.destination_params,'{}'::jsonb)||jsonb_build_object('interestId',new.related_id);
  elsif new.type='roommate_match' then
    new.source_type:=coalesce(new.source_type,'roommate_conversation');
    new.source_id:=coalesce(new.source_id,nullif(new.related_id,'')::uuid);
    new.destination_route:=coalesce(new.destination_route,'messages');
    new.destination_params:=coalesce(new.destination_params,'{}'::jsonb)||jsonb_build_object('conversationId',new.related_id);
  elsif new.type in ('announcement','official_announcement') then
    new.source_type:=coalesce(new.source_type,'announcement');
    new.destination_route:=coalesce(new.destination_route,'notifications');
    new.destination_params:=coalesce(new.destination_params,'{}'::jsonb)||jsonb_build_object('announcementId',new.related_id);
  end if;
  return new;
exception when invalid_text_representation then
  return new;
end;
$$;

drop trigger if exists notifications_normalize_context on public.notifications;
create trigger notifications_normalize_context
before insert or update of type,related_id,destination_route,destination_params
on public.notifications for each row execute function public.normalize_notification_context();

create or replace function public.notify_worker_booking_lifecycle()
returns trigger language plpgsql security definer set search_path=public
as $$
declare conversation_id uuid; recipient text; event_title text; event_message text;
begin
  select id into conversation_id from public.booking_conversations where booking_id=new.id limit 1;
  if tg_op='INSERT' then
    recipient:=new.worker_id;
    event_title:='New service request';
    event_message:='A customer requested '||coalesce(new.service_type,'your service')||'.';
  elsif new.status is distinct from old.status then
    if new.status='waiting_payment' then recipient:=new.user_id;event_title:='Price ready for approval';event_message:='The Worker entered an agreed price of ₦'||trim(to_char(new.negotiated_amount,'FM999,999,999,990'))||'.';
    elsif new.status='confirmed' then recipient:=new.worker_id;event_title:='Service payment confirmed';event_message:='The customer secured payment for this job.';
    elsif new.status='in_progress' then recipient:=new.user_id;event_title:='Work started';event_message:=coalesce(new.service_type,'Your service')||' is now in progress.';
    elsif new.status='completed_pending_approval' then recipient:=new.user_id;event_title:='Review completed work';event_message:='The Worker marked the job complete. Review it before releasing payment.';
    elsif new.status in ('approved_released','cancelled','refunded') then recipient:=new.user_id;event_title:='Service booking updated';event_message:='Your '||coalesce(new.service_type,'service')||' booking is now '||replace(new.status,'_',' ')||'.';
    else return new; end if;
  else return new; end if;
  if recipient is null then return new; end if;
  insert into public.notifications(
    recipient_id,type,title,message,related_id,read,source_type,source_id,
    destination_route,destination_params,event_key
  ) values (
    recipient,'service_booking',event_title,event_message,new.id::text,false,
    'worker_booking',new.id,'messages',
    jsonb_build_object('conversationId',conversation_id,'bookingId',new.id),
    'worker_booking:'||new.id::text||':'||new.status||':'||recipient
  ) on conflict(recipient_id,event_key) where event_key is not null do nothing;
  return new;
end;
$$;

drop trigger if exists worker_booking_activity on public.worker_bookings;
create trigger worker_booking_activity
after insert or update of status on public.worker_bookings
for each row execute function public.notify_worker_booking_lifecycle();

revoke all on function public.normalize_notification_context(),public.notify_worker_booking_lifecycle() from public,anon,authenticated;
grant execute on function public.normalize_notification_context(),public.notify_worker_booking_lifecycle() to service_role;
revoke all on function public.mark_my_notification_read(uuid),public.mark_all_my_notifications_read() from public,anon;
grant execute on function public.mark_my_notification_read(uuid),public.mark_all_my_notifications_read() to authenticated,service_role;
