-- Return effective hotel capabilities with every assigned hotel. The client may
-- use role labels for explanation, but must use these capabilities for actions.

create or replace function public.get_my_hotel_operations()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'hotel_id',h.hotel_id,'name',h.name,'description',h.description,
    'state',h.state,'city',h.city,'area',h.area,'address',h.address,
    'images',h.images,'amenities',h.amenities,'owner_id',h.owner_id,
    'status',h.status,'rating',h.rating,'review_count',h.review_count,
    'featured',h.featured,'created_at',h.created_at,'updated_at',h.updated_at,
    'access_role',case when h.owner_id=p.user_id then 'owner' else tm.hotel_role end,
    'capabilities',case when h.owner_id=p.user_id
      then to_jsonb(public.hotel_default_capabilities('owner'))
      else to_jsonb(coalesce(tm.capabilities,array[]::text[])) end
  ) order by h.updated_at desc),'[]'::jsonb)
  from public.profiles p
  join public.hotels h on h.owner_id=p.user_id or exists(
    select 1 from public.hotel_team_members x
    where x.hotel_id=h.hotel_id and x.member_user_id=p.user_id
      and x.status='active'
  )
  left join public.hotel_team_members tm
    on tm.hotel_id=h.hotel_id and tm.member_user_id=p.user_id
      and tm.status='active'
  where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
$$;

revoke all on function public.get_my_hotel_operations() from public,anon;
grant execute on function public.get_my_hotel_operations()
to authenticated,service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select p.oid::regprocedure::text,p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  'approved_client_rpc','Returns only hotels assigned to the active Personal identity',now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='get_my_hotel_operations'
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,
  captured_at=excluded.captured_at;
