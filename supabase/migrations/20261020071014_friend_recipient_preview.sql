begin;
create function public.preview_friend_recipient(p_username text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  actor text:=public.current_profile_user_id();
  attempts integer;
  target public.profiles;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  -- Use the existing per-account throttle ledger. Return rather than raise on
  -- limits/not-found so failed lookups cannot roll back their attempt count.
  insert into public.user_action_rate_limits as l(user_key,action)
  values(actor,'friend_recipient_preview')
  on conflict(user_key,action) do update set
    attempt_count=case when l.window_started_at<=now()-interval '1 minute' then 1 else least(l.attempt_count+1,1000) end,
    window_started_at=case when l.window_started_at<=now()-interval '1 minute' then now() else l.window_started_at end,
    updated_at=now()
  returning attempt_count into attempts;
  if attempts>20 then
    return jsonb_build_object('error','Too many lookups. Wait a minute and try again.');
  end if;
  if length(btrim(coalesce(p_username,''))) not between 1 and 40 then
    return jsonb_build_object('error','Enter an exact WeHouse username.');
  end if;
  select p.* into target from public.profiles p
  where lower(p.username)=lower(btrim(p_username)) and p.user_id<>actor
    and p.account_kind='consumer' and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
    and not exists(select 1 from public.friends f where f.user_low=least(actor,p.user_id)
      and f.user_high=greatest(actor,p.user_id) and f.status='blocked')
  limit 1;
  if target.user_id is null then
    return jsonb_build_object('error','That person cannot receive a Friend request.');
  end if;
  -- No email, phone, verification evidence, address or account-role projection.
  return jsonb_build_object('user_id',target.user_id,'username',target.username,'full_name',target.full_name);
end;
$$;
revoke all on function public.preview_friend_recipient(text) from public,anon;
grant execute on function public.preview_friend_recipient(text) to authenticated;
commit;
