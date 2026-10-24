-- Same versioned money authority; no separate Experience settings or wallet.
create function public.creator_get_experience_commission() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare policy public.creator_policy_versions;
begin
 if not public._property_document_session_active() or not public.current_actor_has_workspace('creator',null) then
  raise exception 'An active Creator workspace and trusted device are required' using errcode='42501';end if;
 select * into policy from public.creator_policy_versions where policy_key='commission_experience'
  and scope_type='global' and scope_key='*' and status='active' and effective_from<=now()
  and (effective_until is null or effective_until>now()) order by version desc limit 1;
 return jsonb_build_object('configured',policy.policy_version_id is not null,'policy',case when policy.policy_version_id is null then null else to_jsonb(policy) end);
end $$;
revoke all on function public.creator_get_experience_commission() from public,anon;
grant execute on function public.creator_get_experience_commission() to authenticated;

create function public.creator_publish_experience_commission(p_creator_elevation_id uuid,p_expected_version integer,p_percent numeric,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous public.creator_policy_versions; published public.creator_policy_versions;
begin
 if not public._property_document_session_active() or not public.current_actor_has_workspace('creator',null)
  or not public.creator_has_elevation(p_creator_elevation_id,'policy_publish') then
  raise exception 'Recent Creator policy authentication on a trusted device is required' using errcode='42501';end if;
 if p_percent is null or p_percent::text in ('NaN','Infinity','-Infinity') or p_percent<0 or p_percent>50
  or p_percent<>round(p_percent,2) or p_expected_version is null or p_expected_version<0
  or length(btrim(coalesce(p_reason,''))) not between 5 and 2000 then raise exception 'Choose a percentage from 0 to 50 with at most two decimal places and record a reason';end if;
 -- Also serialize generic policy publishers which use the same authority table.
 lock table public.creator_policy_versions in share row exclusive mode;
 if exists(select 1 from public.creator_policy_versions where policy_key='commission_experience'
  and scope_type='global' and scope_key='*' and (status='scheduled' or (status='active' and effective_from>now()))) then
  raise exception 'Resolve the scheduled Experience commission before publishing';end if;
 select * into previous from public.creator_policy_versions where policy_key='commission_experience'
  and scope_type='global' and scope_key='*' and status='active' and effective_from<=now()
  and (effective_until is null or effective_until>now()) order by version desc limit 1;
 if previous.version=p_expected_version+1 and previous.value=jsonb_build_object('percent',p_percent)
  and previous.reason=btrim(p_reason) and previous.created_by=public.current_profile_user_id() then
  return jsonb_build_object('configured',true,'policy',to_jsonb(previous));end if;
 if coalesce(previous.version,0)<>p_expected_version then raise exception 'Experience commission changed. Refresh before publishing';end if;
 select * into published from public.creator_publish_policy(p_creator_elevation_id,'commission_experience','global','*',
  jsonb_build_object('percent',p_percent),jsonb_build_object('type','percentage'),'now'::timestamptz,true,
  'WeHouse Experience commission. New bookings retain their accepted rate and policy version.','pending',btrim(p_reason));
 return jsonb_build_object('configured',true,'policy',to_jsonb(published));
end $$;
revoke all on function public.creator_publish_experience_commission(uuid,integer,numeric,text) from public,anon;
grant execute on function public.creator_publish_experience_commission(uuid,integer,numeric,text) to authenticated;
