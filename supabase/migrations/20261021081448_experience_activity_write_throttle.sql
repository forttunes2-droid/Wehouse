-- Reuse the existing per-user action budget; no parallel rate-limit table.
create function private.throttle_experience_activity_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare budget public.user_action_rate_limits;
begin
 insert into public.user_action_rate_limits as limits(user_key,action,window_started_at,attempt_count,updated_at)
 values(new.actor_user_id,'experience_activity_write',now(),1,now())
 on conflict(user_key,action) do update set
  window_started_at=case when limits.window_started_at<=now()-interval '1 minute' then now() else limits.window_started_at end,
  attempt_count=case when limits.window_started_at<=now()-interval '1 minute' then 1 else limits.attempt_count+1 end,
  updated_at=now()
 returning * into budget;
 if budget.attempt_count>30 then
  raise exception 'Too many activity changes. Wait a minute before trying again' using errcode='P0001';
 end if;
 return new;
end $$;
revoke all on function private.throttle_experience_activity_event() from public,anon,authenticated;
create trigger experience_activity_write_budget before insert on public.experience_activity_events
 for each row execute function private.throttle_experience_activity_event();
