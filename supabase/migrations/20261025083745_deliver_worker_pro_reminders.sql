begin;
-- Persist scheduling state in the existing reminder record; Activity owns delivery.
alter table public.worker_pro_reminders add column delivery_revision bigint not null default 1,
 add column notified_at timestamptz;
create index worker_pro_reminders_pending_delivery_idx on public.worker_pro_reminders(due_at,id)
 where done_at is null and notified_at is null;

create function private.revise_worker_pro_reminder() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (new.due_at,new.note) is distinct from (old.due_at,old.note)
    or (old.done_at is not null and new.done_at is null) then
   new.delivery_revision:=old.delivery_revision+1;new.notified_at:=null;
 else
   new.delivery_revision:=old.delivery_revision;
 end if;
 return new;
end $$;
revoke all on function private.revise_worker_pro_reminder() from public,anon,authenticated;
create trigger worker_pro_reminder_revision before update on public.worker_pro_reminders
 for each row execute function private.revise_worker_pro_reminder();

create function private.resolve_worker_pro_reminder() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.delivery_revision<>old.delivery_revision or (new.done_at is not null and old.done_at is null) then
   perform private.resolve_subject_activity('worker_pro_reminder',new.id::text,'worker.reminder.due','services');
 end if;
 return new;
end $$;
revoke all on function private.resolve_worker_pro_reminder() from public,anon,authenticated;
create trigger worker_pro_reminder_resolution after update on public.worker_pro_reminders
 for each row execute function private.resolve_worker_pro_reminder();

create function private.deliver_worker_pro_reminders() returns integer
language plpgsql security definer set search_path='' as $$
declare r public.worker_pro_reminders;e uuid;delivered integer:=0;
begin
 for r in select reminder.* from public.worker_pro_reminders reminder
 join public.worker_bookings b on b.id=reminder.booking_id and b.worker_id=reminder.worker_id
 join public.profiles p on p.user_id=reminder.worker_id
 where reminder.done_at is null and reminder.notified_at is null and reminder.due_at<=now()
   and b.status in ('confirmed','in_progress','completed_pending_approval')
   and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
 order by reminder.due_at,reminder.id limit 200 for update of reminder skip locked
 loop
   e:=private.upsert_activity_event('worker_reminder:'||r.id::text||':'||r.delivery_revision::text,
    'worker.reminder.due','worker_pro_reminder',r.id::text,null,'Work reminder',r.note,
    'worker_paid_tools',jsonb_build_object('reminder_id',r.id,'booking_id',r.booking_id),r.due_at);
   perform private.add_activity_audience(e,r.worker_id,'worker','services',null,true);
   update public.worker_pro_reminders set notified_at=now() where id=r.id;
   delivered:=delivered+1;
 end loop;
 return delivered;
end $$;
revoke all on function private.deliver_worker_pro_reminders() from public,anon,authenticated;
grant execute on function private.deliver_worker_pro_reminders() to service_role;

create function private.finish_worker_booking_reminders() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status not in ('confirmed','in_progress','completed_pending_approval') and new.status is distinct from old.status then
   update public.worker_pro_reminders set done_at=coalesce(done_at,now()),updated_at=now()
    where booking_id=new.id and done_at is null;
 end if;
 return new;
end $$;
revoke all on function private.finish_worker_booking_reminders() from public,anon,authenticated;
create trigger worker_booking_reminder_completion after update of status on public.worker_bookings
 for each row execute function private.finish_worker_booking_reminders();
select cron.schedule('wehouse-worker-pro-reminders','* * * * *','select private.deliver_worker_pro_reminders()');
commit;
