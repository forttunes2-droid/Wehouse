-- pgcrypto is installed in the extensions schema while this privileged function
-- intentionally uses a narrow search_path. Qualify the cryptographic function
-- so access-code creation works without weakening the search path.
create or replace function public.create_my_property_access_challenge() returns jsonb
language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor public.profiles; v_row public.property_access_challenges; v_code text;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  if not public.account_identity_is_current(v_actor.user_id) then raise exception 'Complete the private identity check before adding properties'; end if;
  v_code:=lpad(((('x'||substr(encode(extensions.gen_random_bytes(4),'hex'),1,8))::bit(32)::bigint % 1000000))::text,6,'0');
  insert into public.property_access_challenges(partner_id,code,expires_at)
  values(v_actor.user_id,v_code,now()+interval '1 hour') returning * into v_row;
  return jsonb_build_object('id',v_row.id,'code',v_row.code,'expires_at',v_row.expires_at);
end $$;

revoke all on function public.create_my_property_access_challenge() from public,anon;
grant execute on function public.create_my_property_access_challenge() to authenticated;
