-- Owner decision, 23 October: standard refundable accommodation deadline is 24h.
-- Publish new versions. Never rewrite accepted booking/quote snapshots.
do $$
declare previous public.creator_policy_versions; next_value jsonb; next_version integer;
 key_name text; rollout_at timestamptz:=now();
begin
 lock table public.creator_policy_versions in share row exclusive mode;
 foreach key_name in array array['short_let_cancellation','hotel_standard_cancellation'] loop
  select * into previous from public.creator_policy_versions
   where policy_key=key_name and scope_type='global' and scope_key='*'
    and status='active' and effective_from<=rollout_at
    and (effective_until is null or effective_until>rollout_at)
   order by effective_from desc,version desc limit 1;
  if previous.policy_version_id is null then raise exception 'Missing policy: %',key_name;end if;
  if exists(select 1 from public.creator_policy_versions where policy_key=key_name
   and scope_type='global' and scope_key='*' and status='active' and effective_from>rollout_at) then
   raise exception 'Review scheduled cancellation policy before rollout: %',key_name;
  end if;
  next_value:=previous.value||jsonb_build_object('full_refund_hours_before_check_in',24);
  if previous.value ? 'standard_full_refund_hours_before_check_in' then
   next_value:=next_value||jsonb_build_object('standard_full_refund_hours_before_check_in',24);
  end if;
  if next_value=previous.value then continue;end if;
  select coalesce(max(version),0)+1 into next_version from public.creator_policy_versions
   where policy_key=key_name and scope_type='global' and scope_key='*';
  update public.creator_policy_versions set status='retired',effective_until=rollout_at,retired_at=rollout_at
   where policy_version_id=previous.policy_version_id;
  insert into public.creator_policy_versions(policy_key,scope_type,scope_key,version,value,value_schema,status,
   effective_from,public_disclosure,disclosure_text,legal_review_state,reason,supersedes,checksum,published_at)
  values(key_name,'global','*',next_version,next_value,previous.value_schema,'active',rollout_at,
   previous.public_disclosure,
   'Standard refundable bookings: full refund until 24 hours before check-in. The booking displays its exact deadline and saved terms.',
   'pending','Owner approved the 24-hour standard on 23 October 2026. Existing booking snapshots remain unchanged.',
   previous.policy_version_id,md5(key_name||':'||next_version::text||':'||next_value::text),rollout_at);
 end loop;
end $$;
