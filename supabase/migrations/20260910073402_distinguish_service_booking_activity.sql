-- Service lifecycle updates are Activity, not chat messages. Distinct event
-- types let "Needs my action" remain truthful and give every role the right
-- workspace and booking destination.

create or replace function public.notify_worker_booking_lifecycle()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  conversation_id uuid;
  recipient text;
  event_type text;
  event_title text;
  event_message text;
  event_route text;
  event_scope text;
begin
  select id into conversation_id
  from public.booking_conversations
  where booking_id=new.id
  limit 1;

  if tg_op='INSERT' then
    recipient:=new.worker_id;
    event_type:='service_request_received';
    event_title:='New service request';
    event_message:='A customer requested '||coalesce(new.service_type,'your service')||'.';
    event_route:='worker_dashboard';
    event_scope:='worker';
  elsif new.status is distinct from old.status then
    if new.status='waiting_payment' then
      recipient:=new.user_id;
      event_type:='service_price_ready';
      event_title:='Price ready for approval';
      event_message:='The Worker entered an agreed price of ₦'||trim(to_char(new.negotiated_amount,'FM999,999,999,990'))||'.';
      event_route:='my_reservations';
      event_scope:='personal';
    elsif new.status='confirmed' then
      recipient:=new.worker_id;
      event_type:='service_payment_confirmed';
      event_title:='Service payment confirmed';
      event_message:='The customer secured payment for this job.';
      event_route:='worker_dashboard';
      event_scope:='worker';
    elsif new.status='in_progress' then
      recipient:=new.user_id;
      event_type:='service_work_started';
      event_title:='Work started';
      event_message:=coalesce(new.service_type,'Your service')||' is now in progress.';
      event_route:='my_reservations';
      event_scope:='personal';
    elsif new.status='completed_pending_approval' then
      recipient:=new.user_id;
      event_type:='service_completion_review_required';
      event_title:='Review completed work';
      event_message:='The Worker marked the job complete. Review it before releasing payment.';
      event_route:='my_reservations';
      event_scope:='personal';
    elsif new.status in ('approved_released','cancelled','refunded') then
      recipient:=new.user_id;
      event_type:='service_booking_updated';
      event_title:='Service booking updated';
      event_message:='Your '||coalesce(new.service_type,'service')||' booking is now '||replace(new.status,'_',' ')||'.';
      event_route:='my_reservations';
      event_scope:='personal';
    else
      return new;
    end if;
  else
    return new;
  end if;

  if recipient is null then return new; end if;

  insert into public.notifications(
    recipient_id,type,title,message,related_id,read,source_type,source_id,
    destination_route,destination_params,event_key,workspace_scope
  ) values (
    recipient,event_type,event_title,event_message,new.id::text,false,
    'worker_booking',new.id,event_route,
    jsonb_build_object('conversationId',conversation_id,'bookingId',new.id),
    'worker_booking:'||new.id::text||':'||new.status||':'||recipient,
    event_scope
  ) on conflict(recipient_id,event_key) where event_key is not null do nothing;
  return new;
end;
$$;

update public.notifications
set
  type=case title
    when 'New service request' then 'service_request_received'
    when 'Price ready for approval' then 'service_price_ready'
    when 'Service payment confirmed' then 'service_payment_confirmed'
    when 'Work started' then 'service_work_started'
    when 'Review completed work' then 'service_completion_review_required'
    else 'service_booking_updated'
  end,
  destination_route=case
    when title in ('New service request','Service payment confirmed') then 'worker_dashboard'
    else 'my_reservations'
  end,
  workspace_scope=case
    when title in ('New service request','Service payment confirmed') then 'worker'
    else 'personal'
  end,
  destination_params=coalesce(destination_params,'{}'::jsonb) ||
    jsonb_build_object(
      'bookingId',coalesce(destination_params->>'bookingId',related_id),
      'conversationId',destination_params->>'conversationId'
    )
where type='service_booking';

revoke all on function public.notify_worker_booking_lifecycle() from public,anon,authenticated;
grant execute on function public.notify_worker_booking_lifecycle() to service_role;
