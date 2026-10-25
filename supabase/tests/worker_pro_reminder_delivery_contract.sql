begin;
set local session_replication_role=replica;
insert into public.profiles(user_id,auth_id,email,role,profile_complete,worker_status,worker_verified) values
 ('reminder-worker','b7666666-0000-4000-8000-000000000001','reminder-worker@example.invalid','worker',true,'verified',true),
 ('reminder-customer','b7666666-0000-4000-8000-000000000002','reminder-customer@example.invalid','user',true,null,false);
insert into public.worker_bookings(id,user_id,worker_id,service_type,scheduled_date,status) values
 ('b7666666-0000-4000-8000-000000000011','reminder-customer','reminder-worker','Cleaning',current_date,'confirmed'),
 ('b7666666-0000-4000-8000-000000000012','reminder-customer','reminder-worker','Cleaning',current_date,'confirmed'),
 ('b7666666-0000-4000-8000-000000000013','reminder-customer','reminder-worker','Cleaning',current_date,'confirmed');
insert into public.worker_pro_reminders(id,worker_id,booking_id,due_at,note,done_at) values
 ('b7666666-0000-4000-8000-000000000021','reminder-worker','b7666666-0000-4000-8000-000000000011',now()-interval '1 minute','Bring the supplies',null),
 ('b7666666-0000-4000-8000-000000000022','reminder-worker','b7666666-0000-4000-8000-000000000012',now()+interval '1 day','Future reminder',null),
 ('b7666666-0000-4000-8000-000000000023','reminder-worker','b7666666-0000-4000-8000-000000000013',now()-interval '1 minute','Already done',now());
set local session_replication_role=origin;
do $$
declare event_id uuid;
begin
 if has_function_privilege('authenticated','private.deliver_worker_pro_reminders()','EXECUTE')
 or has_function_privilege('anon','private.deliver_worker_pro_reminders()','EXECUTE') then raise exception 'Reminder dispatcher exposed to clients';end if;
 perform private.deliver_worker_pro_reminders();
 perform private.deliver_worker_pro_reminders();
 if (select count(*) from public.activity_events where subject_type='worker_pro_reminder' and subject_id='b7666666-0000-4000-8000-000000000021')<>1 then raise exception 'Reminder not delivered once';end if;
 select activity_event_id into event_id from public.activity_events where event_key='worker_reminder:b7666666-0000-4000-8000-000000000021:1';
 if not exists(select 1 from public.activity_event_audiences where activity_event_id=event_id and recipient_user_id='reminder-worker' and workspace='worker' and action_required and resolved_at is null)
 or exists(select 1 from public.activity_event_audiences where activity_event_id=event_id and recipient_user_id<>'reminder-worker') then raise exception 'Reminder audience is wrong';end if;
 if exists(select 1 from public.activity_events where subject_type='worker_pro_reminder' and subject_id in ('b7666666-0000-4000-8000-000000000022','b7666666-0000-4000-8000-000000000023')) then raise exception 'Future/done reminder delivered';end if;
 -- An identical retry must preserve the delivery revision and notification state.
 update public.worker_pro_reminders set note=note,updated_at=now() where id='b7666666-0000-4000-8000-000000000021';
 perform private.deliver_worker_pro_reminders();
 if (select delivery_revision from public.worker_pro_reminders where id='b7666666-0000-4000-8000-000000000021')<>1 then raise exception 'Retry changed reminder revision';end if;
 -- Changing the schedule resolves the former alert and creates one new delivery.
 update public.worker_pro_reminders set due_at=now()-interval '2 minutes' where id='b7666666-0000-4000-8000-000000000021';
 if exists(select 1 from public.activity_event_audiences where activity_event_id=event_id and resolved_at is null) then raise exception 'Old reminder remains actionable';end if;
 perform private.deliver_worker_pro_reminders();perform private.deliver_worker_pro_reminders();
 if (select count(*) from public.activity_events where subject_type='worker_pro_reminder' and subject_id='b7666666-0000-4000-8000-000000000021')<>2 then raise exception 'Reschedule delivery is not idempotent';end if;
 update public.worker_pro_reminders set done_at=now() where id='b7666666-0000-4000-8000-000000000021';
 if exists(select 1 from public.activity_event_audiences a join public.activity_events e using(activity_event_id) where e.subject_type='worker_pro_reminder' and e.subject_id='b7666666-0000-4000-8000-000000000021' and a.resolved_at is null) then raise exception 'Done reminder remains actionable';end if;
 update public.worker_bookings set status='cancelled' where id='b7666666-0000-4000-8000-000000000012';
 if exists(select 1 from public.worker_pro_reminders where booking_id='b7666666-0000-4000-8000-000000000012' and done_at is null) then raise exception 'Cancelled job retains a pending reminder';end if;
 if (select count(*) from cron.job where jobname='wehouse-worker-pro-reminders' and active and schedule='* * * * *')<>1 then raise exception 'Reminder schedule missing or duplicated';end if;
end $$;
rollback;
