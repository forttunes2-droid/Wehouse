-- Roommate "Cancel connection" follows the Companion rule: after cancelling, the same
-- person cannot restore it until companion_rerequest_wait() has passed (decision C-030).
create or replace function public.enforce_roommate_cancel_wait() returns trigger
language plpgsql set search_path to 'pg_catalog','public' as $$
begin
  if old.updated_at > now() - public.companion_rerequest_wait() then
    raise exception 'You can restore this connection after % days', ceil(extract(epoch from (old.updated_at + public.companion_rerequest_wait() - now())) / 86400)::int;
  end if;
  return old;
end $$;

drop trigger if exists roommate_cancel_wait on public.roommate_user_blocks;
create trigger roommate_cancel_wait before delete on public.roommate_user_blocks
  for each row execute function public.enforce_roommate_cancel_wait();
