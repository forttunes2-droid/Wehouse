-- Inbox counters and in-app lifecycle pop-ups subscribe to this table. RLS
-- continues to limit each signed-in client to its own notification rows.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
