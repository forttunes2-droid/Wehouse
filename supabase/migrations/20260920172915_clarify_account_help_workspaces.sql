-- Help follows the selected context on the same authenticated identity.
create or replace function public.get_my_workspace_help_targets(p_workspace text)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public' as $$
declare
  actor text:=public.current_profile_user_id();
  access jsonb:=public.get_my_workspace_access();
  source jsonb;
  result jsonb;
  rows jsonb;
begin
  if actor is null or not coalesce((access->>'personal_workspace')::boolean,false) then
    raise exception 'Active account required';
  end if;
  if p_workspace is null or p_workspace not in ('personal','worker','property_partner','hotel') then
    raise exception 'Unsupported help workspace';
  end if;
  if p_workspace<>'personal' and not exists(
    select 1 from jsonb_array_elements(access->'privileged_workspaces') item
    where item->>'role'=p_workspace
  ) then raise exception 'Workspace access required'; end if;
  source:=public.get_my_account_help_targets();
  result:=jsonb_build_object('account',source->'account');
  if p_workspace='personal' then
    result:=result||jsonb_build_object('reservations',source->'reservations','hotel_bookings',source->'hotel_bookings');
  elsif p_workspace='worker' then
    result:=result||jsonb_build_object('worker_profile',source->'worker_profile');
  elsif p_workspace='property_partner' then
    result:=result||jsonb_build_object('property_requests',source->'property_requests',
      'properties',source->'properties','hotels',source->'hotels',
      'partner_reservations',source->'partner_reservations','partner_hotel_bookings',source->'partner_hotel_bookings');
  elsif p_workspace='hotel' then
    select coalesce(jsonb_agg(jsonb_build_object('subject_type','hotel',
      'subject_id',h.hotel_id::text,'context_type','hotel_property','label',h.name,
      'detail','Hotel Team') order by h.name),'[]'::jsonb) into rows
    from public.hotels h where exists(select 1 from public.hotel_team_members member
      where member.hotel_id=h.hotel_id and member.member_user_id=actor and member.status='active')
      and public.hotel_actor_has_capability(h.hotel_id,'stay.read');
    result:=result||jsonb_build_object('hotels',rows);
  end if;
  if p_workspace in ('personal','worker') then
    select coalesce(jsonb_agg(item order by item->>'updated_at' desc),'[]'::jsonb) into rows
    from jsonb_array_elements(source->'worker_jobs') item
    join public.worker_bookings b on b.id::text=item->>'subject_id'
    where (p_workspace='personal' and b.user_id=actor) or (p_workspace='worker' and b.worker_id=actor);
    result:=result||jsonb_build_object('worker_jobs',rows);
  end if;
  if p_workspace in ('worker','property_partner') then
    select coalesce(jsonb_agg(item order by item->>'updated_at' desc),'[]'::jsonb) into rows
    from jsonb_array_elements(source->'withdrawals') item
    join public.withdrawals wd on wd.id::text=item->>'subject_id'
    join public.wallets w on w.id=wd.wallet_id
    where w.owner_id=actor and w.owner_type=p_workspace;
    result:=result||jsonb_build_object('withdrawals',rows);
  end if;
  return result;
end $$;
revoke all on function public.get_my_workspace_help_targets(text) from public,anon;
grant execute on function public.get_my_workspace_help_targets(text) to authenticated,service_role;
