do $$
declare
  table_oid oid := to_regclass('public.saved_service_providers');
  policy_count integer;
  fn text;
begin
  if table_oid is null then raise exception 'saved service provider table missing'; end if;
  if not (select relrowsecurity from pg_class where oid=table_oid) then
    raise exception 'saved service providers must have row level security enabled';
  end if;
  if not has_table_privilege('authenticated','public.saved_service_providers','select')
     or has_table_privilege('anon','public.saved_service_providers','select') then
    raise exception 'saved service provider table grants are not least privilege';
  end if;
  select count(*) into policy_count from pg_policies
    where schemaname='public' and tablename='saved_service_providers'
      and policyname='saved_service_providers_select_own'
      and roles @> array['authenticated']::name[]
      and qual like '%current_profile_user_id%';
  if policy_count <> 1 then raise exception 'owner-scoped select policy missing'; end if;
  if exists(select 1 from pg_policies where schemaname='public'
      and tablename='saved_service_providers' and cmd in ('INSERT','UPDATE','DELETE')) then
    raise exception 'clients must use the validated save and remove functions';
  end if;
  if not has_function_privilege('authenticated','public.save_my_service_provider(text)','execute')
     or has_function_privilege('anon','public.save_my_service_provider(text)','execute') then
    raise exception 'save function grants are not least privilege';
  end if;
  fn := pg_get_functiondef('public.save_my_service_provider(text)'::regprocedure);
  if fn not like '%get_public_workers%' then
    raise exception 'saving must require a currently public service provider';
  end if;
  fn := pg_get_functiondef('public.get_public_saved_service_providers(text[])'::regprocedure);
  if fn not like '%saved_service_providers%' or fn not like '%current_profile_user_id%' then
    raise exception 'saved profile lookup must remain owner scoped';
  end if;
end $$;
