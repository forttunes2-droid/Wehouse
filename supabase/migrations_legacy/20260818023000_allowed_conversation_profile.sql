create or replace function public.get_allowed_conversation_profile(p_context_type text, p_context_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor text;
  v_peer text;
  v_profile public.profiles;
  v_roommate public.roommate_profiles;
begin
  select user_id into v_actor
  from public.profiles
  where auth_id = (select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Authentication required'; end if;

  if p_context_type = 'roommate' then
    select case when participant_a=v_actor then participant_b else participant_a end into v_peer
    from public.conversations
    where id=p_context_id and conversation_type='roommate' and v_actor in (participant_a,participant_b);
  elsif p_context_type = 'worker_booking' then
    select case when user_id=v_actor then worker_id else user_id end into v_peer
    from public.worker_bookings
    where id=p_context_id and v_actor in (user_id,worker_id);
  else
    raise exception 'Unsupported conversation type';
  end if;
  if v_peer is null then raise exception 'Conversation access denied'; end if;

  select * into v_profile from public.profiles where user_id=v_peer limit 1;
  if v_profile.user_id is null then raise exception 'Profile unavailable'; end if;
  if p_context_type='roommate' then
    select * into v_roommate from public.roommate_profiles where user_id=v_peer limit 1;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'user_id',v_profile.user_id,'role',v_profile.role,'full_name',v_profile.full_name,'username',v_profile.username,
    'avatar_url',v_profile.avatar_url,'bio',v_profile.bio,'school',v_profile.school,'gender',v_profile.gender,
    'state',v_profile.state,'lga',coalesce(v_profile.local_government,v_profile.city),
    'worker_occupation',v_profile.worker_occupation,'worker_bio',v_profile.worker_bio,'worker_skills',v_profile.worker_skills,
    'worker_verified',v_profile.worker_verified,'worker_price',v_profile.worker_price,'worker_experience',v_profile.worker_experience,
    'rating',v_profile.rating,'review_count',v_profile.review_count,
    'roommate',case when p_context_type='roommate' then jsonb_strip_nulls(jsonb_build_object(
      'age',v_roommate.age,'budget_min',v_roommate.budget_min,'budget_max',v_roommate.budget_max,'area',v_roommate.area,
      'city',v_roommate.city,'personality_type',v_roommate.personality_type,'stay_duration',v_roommate.stay_duration
    )) else null end
  ));
end
$function$;

revoke all on function public.get_allowed_conversation_profile(text,uuid) from public, anon;
grant execute on function public.get_allowed_conversation_profile(text,uuid) to authenticated;
