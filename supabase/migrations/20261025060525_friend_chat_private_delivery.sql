-- Recipient-owned private signals; encrypted messages stay behind existing RPCs.
-- No message table grant, public topic, client publish policy or new inbox table.
create policy "Friend chat signals belong to the signed-in recipient"
on realtime.messages for select to authenticated
using (extension = 'broadcast' and topic = 'wehouse:friend:' || (select auth.uid())::text);

create or replace function public.broadcast_friend_chat_change()
returns trigger language plpgsql security definer
set search_path = 'pg_catalog' as $$
declare destination text; change_kind text;
begin
  if tg_op = 'UPDATE' and new.reactions is not distinct from old.reactions then return null; end if;
  change_kind := case when tg_op = 'INSERT' then 'message' else 'reaction' end;
  for destination in
    select distinct p.auth_id from public.friends f
    join public.profiles p on p.user_id in (f.user_low,f.user_high)
    where f.id = new.friend_id and f.status = 'accepted'
      and p.auth_id is not null and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
  loop
    perform realtime.send(
      jsonb_build_object('friend_id',new.friend_id,'message_id',new.id,'kind',change_kind),
      'friend_chat_changed','wehouse:friend:' || destination,true);
  end loop;
  return null;
end $$;
revoke all on function public.broadcast_friend_chat_change() from public,anon,authenticated,service_role;

create trigger friend_chat_private_change
after insert or update of reactions on public.friend_messages
for each row execute function public.broadcast_friend_chat_change();
