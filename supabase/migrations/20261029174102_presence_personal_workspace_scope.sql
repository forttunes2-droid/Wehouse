-- Personal access comes from the consumer identity, not a professional role
-- named "personal". Keep one shared workspace authority and its restriction gate.
do $$declare definition text;needle text:='when p_workspace_role=''hosting'' then exists(';begin
 definition:=pg_get_functiondef('private.unrestricted_workspace_grant(text,text)'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'Inspect the existing workspace authority';end if;
 execute replace(definition,needle,$personal$
 when p_workspace_role='personal' then exists(
  select 1 from public.profiles profile where profile.user_id=p_user_id and profile.account_kind='consumer'
   and not coalesce(profile.deleted,false) and not coalesce(profile.suspended,false) and not coalesce(profile.banned,false)
 )
 when p_workspace_role='hosting' then exists(
$personal$);
end $$;
create or replace function public.current_actor_has_personal_workspace() returns boolean
language sql stable security definer set search_path='' as $$
 select public.user_has_active_workspace(public.current_profile_user_id(),'personal');
$$;
revoke all on function public.current_actor_has_personal_workspace() from public,anon;
grant execute on function public.current_actor_has_personal_workspace() to authenticated;
notify pgrst,'reload schema';
