-- Canonical legal acceptance + announcement hardening.
insert into public.platform_settings(key,value,label,description,category,data_type,is_active,updated_at)
values('legal_version',extract(epoch from now())::bigint::text,'Legal version','Automatically changes when Privacy Policy or Terms & Conditions change.','platform','text',true,now())
on conflict (key) do nothing;

create or replace function public.bump_legal_version()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.key in ('privacy_policy','terms_of_service') and (tg_op='INSERT' or new.value is distinct from old.value) then
    insert into public.platform_settings(key,value,label,description,category,data_type,is_active,updated_at)
    values('legal_version',extract(epoch from clock_timestamp())::bigint::text,'Legal version','Automatically changes when Privacy Policy or Terms & Conditions change.','platform','text',true,now())
    on conflict (key) do update set value=excluded.value,updated_at=excluded.updated_at,is_active=true;
  end if;
  return new;
end $$;

drop trigger if exists platform_legal_version_bump on public.platform_settings;
create trigger platform_legal_version_bump after insert or update of value on public.platform_settings for each row execute function public.bump_legal_version();

create or replace function public.get_my_legal_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.profiles; privacy_changed timestamptz; terms_changed timestamptz; version text;
begin
  select * into p from public.profiles where auth_id=auth.uid()::text limit 1;
  if p.user_id is null then raise exception 'Profile not found'; end if;
  select updated_at into privacy_changed from public.platform_settings where key='privacy_policy' and is_active=true limit 1;
  select updated_at into terms_changed from public.platform_settings where key='terms_of_service' and is_active=true limit 1;
  select value into version from public.platform_settings where key='legal_version' and is_active=true limit 1;
  return jsonb_build_object('privacy_accepted',p.privacy_accepted_at is not null and (privacy_changed is null or p.privacy_accepted_at>=privacy_changed),'terms_accepted',p.terms_accepted_at is not null and (terms_changed is null or p.terms_accepted_at>=terms_changed),'privacy_accepted_at',p.privacy_accepted_at,'terms_accepted_at',p.terms_accepted_at,'legal_version',version);
end $$;

create or replace function public.accept_current_legal(p_document text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid text; privacy_changed timestamptz; terms_changed timestamptz; privacy_at timestamptz; terms_at timestamptz; version text;
begin
  select user_id into uid from public.profiles where auth_id=auth.uid()::text limit 1;
  if uid is null then raise exception 'Profile not found'; end if;
  if p_document not in ('privacy','terms') then raise exception 'Invalid legal document'; end if;
  if p_document='privacy' then update public.profiles set privacy_accepted_at=now(),updated_at=now() where user_id=uid returning privacy_accepted_at,terms_accepted_at into privacy_at,terms_at;
  else update public.profiles set terms_accepted_at=now(),updated_at=now() where user_id=uid returning privacy_accepted_at,terms_accepted_at into privacy_at,terms_at; end if;
  select updated_at into privacy_changed from public.platform_settings where key='privacy_policy' and is_active=true limit 1;
  select updated_at into terms_changed from public.platform_settings where key='terms_of_service' and is_active=true limit 1;
  select value into version from public.platform_settings where key='legal_version' and is_active=true limit 1;
  if privacy_at is not null and terms_at is not null and (privacy_changed is null or privacy_at>=privacy_changed) and (terms_changed is null or terms_at>=terms_changed) then update public.profiles set legal_accepted_version=version where user_id=uid; end if;
  return public.get_my_legal_status();
end $$;

revoke all on function public.get_my_legal_status() from public, anon;
revoke all on function public.accept_current_legal(text) from public, anon;
grant execute on function public.get_my_legal_status() to authenticated;
grant execute on function public.accept_current_legal(text) to authenticated;
revoke insert,update,delete,truncate,references,trigger on public.announcements from anon;
revoke insert,update,delete,truncate,references,trigger on public.announcement_recipients from anon;
drop policy if exists announcements_creator_update on public.announcements;
create policy announcements_creator_update on public.announcements for update to authenticated using (public.current_profile_role()='creator' and sender_id=public.current_profile_user_id()) with check (public.current_profile_role()='creator' and sender_id=public.current_profile_user_id());
