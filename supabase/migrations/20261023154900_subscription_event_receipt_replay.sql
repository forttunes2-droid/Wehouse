-- Strengthen the existing subscription event authority without creating a
-- competing event store or changing provider-specific entitlement logic.
do $migration$
declare definition text; updated text; block_start integer; block_end integer; old_block text;
begin
 select pg_get_functiondef(p.oid) into definition from pg_proc p
 where p.pronamespace='public'::regnamespace and p.proname='record_worker_pro_subscription_event';
 if definition is null then raise exception 'Canonical subscription event function is missing';end if;
 updated:=replace(definition,'v_locked_worker_id text;','v_locked_worker_id text; v_existing_event public.worker_pro_subscription_events;');
 if updated=definition then raise exception 'Subscription event declaration boundary changed; review migration';end if;
 definition:=updated;
 block_start:=strpos(definition,'if v_event_id is null then');
 if block_start=0 then raise exception 'Subscription replay branch is missing';end if;
 block_end:=strpos(substr(definition,block_start),'end if;');
 old_block:=substr(definition,block_start,block_end+length('end if;')-1);
 if block_end=0 or old_block not like '%''duplicate'',true%' then raise exception 'Subscription replay branch changed; review migration';end if;
 definition:=substr(definition,1,block_start-1)||$replacement$
if v_event_id is null then
  select * into v_existing_event from public.worker_pro_subscription_events
  where provider=p_provider and provider_event_id=btrim(p_provider_event_id) for update;
  if v_existing_event.id is null
    or v_existing_event.worker_id is distinct from p_worker_id
    or v_existing_event.payload_sha256 is distinct from p_payload_sha256
    or v_existing_event.event_type is distinct from btrim(p_event_type)
    or v_existing_event.event_time is distinct from p_event_time
    or v_existing_event.valid_until is distinct from p_period_end then
    raise exception 'Subscription event replay differs from the original verified receipt';
  end if;
  -- A repeated conflict/rejection must not turn into a successful paid plan.
  return jsonb_build_object(
    'success',v_existing_event.result in ('accepted','ignored'),
    'duplicate',true,'ignored',v_existing_event.result='ignored',
    'conflict',v_existing_event.result='conflict',
    'requires_review',v_existing_event.result in ('conflict','rejected'),
    'subscription_id',v_existing_event.subscription_id,
    'status',v_subscription.status
  );
end if;
$replacement$||substr(definition,block_start+block_end+length('end if;')-1);
 execute definition;
end $migration$;

revoke all on function public.record_worker_pro_subscription_event(text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,boolean,boolean,numeric,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_worker_pro_subscription_event(text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,boolean,boolean,numeric,text,text,text,jsonb) to service_role;
