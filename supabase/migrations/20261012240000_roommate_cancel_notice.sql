-- The other person is told, neutrally, when a Roommate connection is cancelled. The reason is never shared.
create or replace function public._notify_roommate_cancelled()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_name text;
begin
  select coalesce(nullif(p.full_name,''),'A roommate') into v_name from public.profiles p where p.user_id=new.blocker_user_id;
  insert into public.notifications(recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key,workspace_scope,read,created_at)
  values(new.blocked_user_id,'roommate_connection_cancelled','Roommate connection ended',
    coalesce(v_name,'A roommate')||' ended your Roommate connection. Matching, messages and calls are off.',
    new.blocker_user_id,'roommate_connection',new.blocker_user_id,'roommate',jsonb_build_object('id',new.blocker_user_id),
    'roommate_cancelled:'||new.blocker_user_id||':'||new.blocked_user_id||':'||extract(epoch from new.created_at)::bigint::text,'personal',false,now())
  on conflict(recipient_id,event_key) where event_key is not null do nothing;
  return new;
exception when others then
  return new; -- a failed notice must never block the cancellation itself
end $$;
revoke all on function public._notify_roommate_cancelled() from public,anon,authenticated;
drop trigger if exists roommate_cancel_notice on public.roommate_user_blocks;
create trigger roommate_cancel_notice after insert on public.roommate_user_blocks for each row execute function public._notify_roommate_cancelled();
