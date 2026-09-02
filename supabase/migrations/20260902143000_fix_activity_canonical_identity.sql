create or replace function public.mark_my_notification_read(p_notification_id uuid)
returns boolean
language sql
security invoker
set search_path=public
as $$
  update public.notifications
  set read=true,read_at=coalesce(read_at,now())
  where id=p_notification_id
    and recipient_id=public.current_profile_user_id()
  returning true;
$$;

create or replace function public.mark_all_my_notifications_read()
returns integer
language plpgsql
security invoker
set search_path=public
as $$
declare affected integer;
begin
  update public.notifications
  set read=true,read_at=coalesce(read_at,now())
  where recipient_id=public.current_profile_user_id() and not read;
  get diagnostics affected=row_count;
  return affected;
end
$$;

revoke all on function public.mark_my_notification_read(uuid),public.mark_all_my_notifications_read() from public,anon;
grant execute on function public.mark_my_notification_read(uuid),public.mark_all_my_notifications_read() to authenticated;
