-- When Supabase Auth confirms a new email address, the WeHouse profile follows it.
create or replace function private.sync_profile_email_from_auth()
returns trigger language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare v_uid text;
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.profiles set email = lower(btrim(new.email)) where auth_id = new.id::text returning user_id into v_uid;
    if v_uid is not null then
      insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
      values (v_uid,'account_email_changed','profile',v_uid,'Email changed after the new address was confirmed',now());
    end if;
  end if;
  return new;
end $$;

revoke all on function private.sync_profile_email_from_auth() from public, anon, authenticated;

drop trigger if exists wh_sync_profile_email on auth.users;
create trigger wh_sync_profile_email after update of email on auth.users
for each row execute function private.sync_profile_email_from_auth();
