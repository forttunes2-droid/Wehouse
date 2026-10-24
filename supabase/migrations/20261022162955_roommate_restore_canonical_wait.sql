-- Preserve the established Roommate restore waiting period after Friend naming migration.
create or replace function public.enforce_roommate_cancel_wait()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if old.updated_at>now()-public.friend_rerequest_wait() then
 raise exception 'You can restore this connection after % days',ceil(extract(epoch from(old.updated_at+public.friend_rerequest_wait()-now()))/86400)::int;
 end if;
 return old;
end; $$;
revoke all on function public.enforce_roommate_cancel_wait() from public,anon,authenticated;
