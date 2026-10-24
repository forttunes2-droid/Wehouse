-- WeHouse verifies an email through a Google identity whose email matches. A Google account can be
-- created on any address (Yahoo, Outlook, company mail), so this covers more than Gmail.
-- The user links that Google identity to their WeHouse account, then calls this function. It checks
-- that Google confirmed exactly that address during a recent sign-in, then moves the account to it.
create or replace function public.change_my_email_to_verified_identity(p_new_email text)
returns text language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare
  v_uid uuid:=auth.uid();
  v_new text:=lower(btrim(coalesce(p_new_email,'')));
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if v_new !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid email address'; end if;
  if not exists(
    select 1 from auth.identities i
    where i.user_id=v_uid and i.provider='google'
      and lower(i.identity_data->>'email')=v_new
      and coalesce((i.identity_data->>'email_verified')::boolean,false)
      and coalesce(i.last_sign_in_at,i.created_at)>now()-interval '15 minutes') then
    raise exception 'Google has not confirmed this address for your account. Try again with that Google account.';
  end if;
  if exists(select 1 from auth.users u where lower(u.email)=v_new and u.id<>v_uid)
     or exists(select 1 from public.profiles p where lower(p.email)=v_new and p.auth_id<>v_uid::text) then
    raise exception 'That email is already used by another WeHouse account';
  end if;
  update auth.users set email=v_new,email_confirmed_at=coalesce(email_confirmed_at,now()),updated_at=now() where id=v_uid;
  update auth.identities set identity_data=jsonb_set(identity_data,'{email}',to_jsonb(v_new)),updated_at=now()
  where user_id=v_uid and provider='email';
  return v_new;
end $$;
revoke all on function public.change_my_email_to_verified_identity(text) from public,anon;
grant execute on function public.change_my_email_to_verified_identity(text) to authenticated;
