-- Optional price reductions stay on the existing session and versioned Creator
-- policy authorities. Quotes freeze funding, earnings and the accepted total.
alter table public.experience_sessions
 add column discount_percent numeric(5,2) not null default 0 check(discount_percent=0 or discount_percent between 5 and 50),
 add column discount_ends_on date check(discount_ends_on is null or isfinite(discount_ends_on)),
 add column discount_revision integer not null default 0 check(discount_revision>=0);

create function private.experience_discount_scope(p_kind text,p_target text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.experience_activities;key text;
begin
 if p_kind='activity' then
  select * into a from public.experience_activities where id::text=p_target and details->>'country_code'='NG';
  if a.id is null then raise exception 'Choose a Nigerian activity';end if;
  return jsonb_build_object('type','product','key','NG:activity:'||a.id::text);
 elsif p_kind='state' then
  key:=public.wehouse_state_key(p_target);
  if key is null or not exists(select 1 from public.experience_activities where details->>'country_code'='NG' and public.wehouse_state_key(details->>'state')=key) then raise exception 'Choose a state with an activity';end if;
  return jsonb_build_object('type','state','key','NG:'||key);
 end if;
 raise exception 'Choose an activity or state';
end $$;

create function public.creator_get_experience_discount(p_kind text,p_target text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare scope jsonb;policy public.creator_policy_versions;commission jsonb;
begin
 if not public._property_document_session_active() or not public.current_actor_has_workspace('creator',null) then raise exception 'Creator access required' using errcode='42501';end if;
 scope:=private.experience_discount_scope(p_kind,p_target);
 select * into policy from public.creator_policy_versions where policy_key='discount_experience' and scope_type=scope->>'type' and scope_key=scope->>'key' order by version desc limit 1;
 commission:=public.creator_get_experience_commission();
 return jsonb_build_object('kind',p_kind,'target',p_target,'version',coalesce(policy.version,0),
  'percent',coalesce((policy.value->>'percent')::numeric,0),'ends_on',policy.value->>'ends_on',
  'commission_percent',case when (commission->>'configured')::boolean then (commission->'policy'->'value'->>'percent')::numeric else null end);
end $$;

create function public.creator_set_experience_discount(p_kind text,p_target text,p_expected_version integer,p_percent numeric,p_ends_on date,p_creator_elevation_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare scope jsonb;previous public.creator_policy_versions;published public.creator_policy_versions;commission jsonb;value jsonb;
begin
 if not public._property_document_session_active() or not public.current_actor_has_workspace('creator',null) or not public.creator_has_elevation(p_creator_elevation_id,'policy_publish') then raise exception 'Recent Creator policy authentication is required' using errcode='42501';end if;
 scope:=private.experience_discount_scope(p_kind,p_target);commission:=public.creator_get_experience_commission();
 if p_percent is null or p_percent::text in('NaN','Infinity','-Infinity') or p_percent<>round(p_percent,2) or (p_percent<>0 and p_percent not between 5 and 50)
  or p_expected_version is null or p_expected_version<0 or length(btrim(coalesce(p_reason,''))) not between 5 and 2000
  or (p_ends_on is not null and (not isfinite(p_ends_on) or p_ends_on<(now() at time zone 'Africa/Lagos')::date)) then raise exception 'Choose 0 to stop or 5–50 percent, a current end date and a reason';end if;
 if p_percent>0 and (not coalesce((commission->>'configured')::boolean,false) or p_percent>(commission->'policy'->'value'->>'percent')::numeric) then raise exception 'A funded discount cannot exceed the configured Experience commission';end if;
 lock table public.creator_policy_versions in share row exclusive mode;
 select * into previous from public.creator_policy_versions where policy_key='discount_experience' and scope_type=scope->>'type' and scope_key=scope->>'key' order by version desc limit 1;
 value:=jsonb_build_object('percent',p_percent,'ends_on',p_ends_on,'country_code','NG');
 if previous.version=p_expected_version+1 and previous.value=value and previous.reason=btrim(p_reason) and previous.created_by=public.current_profile_user_id() then return public.creator_get_experience_discount(p_kind,p_target);end if;
 if coalesce(previous.version,0)<>p_expected_version then raise exception 'This discount changed. Refresh before publishing';end if;
 select * into published from public.creator_publish_policy(p_creator_elevation_id,'discount_experience',scope->>'type',scope->>'key',value,
  '{"type":"commission_funded_discount"}'::jsonb,now(),true,'Optional WeHouse-funded activity offer; host earnings are unchanged.','pending',btrim(p_reason));
 insert into public.audit_logs(action,target_type,target_id,admin_id,details) values('EXPERIENCE_DISCOUNT_PUBLISHED','creator_policy',published.policy_version_id::text,public.current_profile_user_id(),jsonb_build_object('scope',scope,'value',value)::text);
 return public.creator_get_experience_discount(p_kind,p_target);
end $$;

create function public.creator_experience_discount_targets(p_before uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public._property_document_session_active() or not public.current_actor_has_workspace('creator',null) then raise exception 'Creator access required' using errcode='42501';end if;
 return jsonb_build_object('activities',(select coalesce(jsonb_agg(to_jsonb(page) order by id desc),'[]'::jsonb) from (
  select id,details->>'title' title,details->>'state' state from public.experience_activities where details->>'country_code'='NG' and (p_before is null or id<p_before) order by id desc limit 51) page),
  'states',(select coalesce(jsonb_agg(state order by state),'[]'::jsonb) from (select distinct details->>'state' state from public.experience_activities where details->>'country_code'='NG' and details->>'state' is not null order by state limit 100) states));
end $$;

create function public.get_my_experience_session_discount(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_host_actor();s public.experience_sessions;
begin
 select session.* into s from public.experience_sessions session join public.experience_activities a on a.id=session.activity_id where session.id=p_session_id and a.host_user_id=actor;
 if s.id is null then raise exception 'Session unavailable' using errcode='42501';end if;
 return jsonb_build_object('session_id',s.id,'revision',s.discount_revision,'percent',s.discount_percent,'ends_on',s.discount_ends_on,'base_price_minor',s.price_minor,'currency',s.currency);
end $$;

create function public.set_my_experience_session_discount(p_session_id uuid,p_expected_revision integer,p_percent numeric,p_ends_on date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_host_actor();s public.experience_sessions;a public.experience_activities;
begin
 select activity.* into a from public.experience_activities activity join public.experience_sessions session on session.activity_id=activity.id where session.id=p_session_id and activity.host_user_id=actor for update of activity;
 select * into s from public.experience_sessions where id=p_session_id for update;
 if a.id is null or a.status<>'approved' or s.status<>'draft' or s.starts_at<=now() then raise exception 'Choose a future session of your approved activity';end if;
 if p_percent is null or p_percent::text in('NaN','Infinity','-Infinity') or p_percent<>round(p_percent,2) or (p_percent<>0 and p_percent not between 5 and 50)
  or p_expected_revision is null or p_expected_revision<0 or p_ends_on is not null and (not isfinite(p_ends_on) or p_ends_on<(now() at time zone s.timezone)::date) then raise exception 'Choose 0 to remove or 5–50 percent and a current end date';end if;
 if s.discount_revision=p_expected_revision+1 and s.discount_percent=p_percent and s.discount_ends_on is not distinct from p_ends_on then return public.get_my_experience_session_discount(s.id);end if;
 if s.discount_revision<>p_expected_revision then raise exception 'This discount changed. Refresh before saving';end if;
 update public.experience_sessions set discount_percent=p_percent,discount_ends_on=p_ends_on,discount_revision=discount_revision+1 where id=s.id;
 insert into public.audit_logs(action,target_type,target_id,admin_id,details) values('EXPERIENCE_SESSION_DISCOUNT_CHANGED','experience_session',s.id::text,actor,jsonb_build_object('percent',p_percent,'ends_on',p_ends_on,'revision',s.discount_revision+1)::text);
 return public.get_my_experience_session_discount(s.id);
end $$;

create function private.experience_session_price(p_session_id uuid,p_participants integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.experience_sessions;a public.experience_activities;policy public.creator_policy_versions;fund public.creator_policy_versions;
 rate numeric;host_percent numeric:=0;fund_percent numeric:=0;host_unit bigint;fund_unit bigint;original_total bigint;base_total bigint;gross_fee bigint;
begin
 select * into s from public.experience_sessions where id=p_session_id;select * into a from public.experience_activities where id=s.activity_id;
 if s.id is null or p_participants is null or p_participants not between 1 and 100 then raise exception 'Invalid activity price request';end if;
 select * into policy from public.creator_policy_versions p where p.policy_key='commission_experience' and p.scope_type='global' and p.scope_key='*' and p.status='active' and p.effective_from<=now() and (p.effective_until is null or p.effective_until>now()) order by p.version desc limit 1;
 rate:=(policy.value->>'percent')::numeric;
 if policy.policy_version_id is null or jsonb_typeof(policy.value->'percent') is distinct from 'number' or rate::text in('NaN','Infinity','-Infinity') or rate not between 0 and 50 then raise exception 'A valid Experience commission is required';end if;
 if s.discount_ends_on is null or s.discount_ends_on>=(s.starts_at at time zone s.timezone)::date then host_percent:=s.discount_percent;end if;
 select * into fund from public.creator_policy_versions p where p.policy_key='discount_experience' and p.status='active' and p.effective_from<=now() and (p.effective_until is null or p.effective_until>now())
  and ((p.scope_type='product' and p.scope_key='NG:activity:'||a.id::text) or (p.scope_type='state' and p.scope_key='NG:'||public.wehouse_state_key(a.details->>'state')))
  and p.value->>'country_code'=a.details->>'country_code'
  and (p.value->>'ends_on' is null or (p.value->>'ends_on')::date>=(s.starts_at at time zone s.timezone)::date)
  order by (p.scope_type='product') desc,p.version desc limit 1;
 if fund.policy_version_id is not null and jsonb_typeof(fund.value->'percent')='number' and (fund.value->>'percent')::numeric between 0 and 50 then fund_percent:=least((fund.value->>'percent')::numeric,rate);end if;
 host_unit:=greatest(1,round(s.price_minor*(1-host_percent/100)));
 -- Per-person rounding keeps the advertised unit price × group size exact.
 -- Funding is capped by commission and the existing combined 50% offer ceiling.
 fund_unit:=least(floor(host_unit*rate/100),round(host_unit*fund_percent/100),greatest(0,host_unit-ceil(s.price_minor/2.0)));
 original_total:=s.price_minor*p_participants;base_total:=host_unit*p_participants;gross_fee:=round(base_total*rate/100);
 return jsonb_build_object('original_price_per_participant_minor',s.price_minor,'original_total_minor',original_total,
  'price_per_participant_minor',host_unit-fund_unit,'total_minor',(host_unit-fund_unit)*p_participants,
  'host_discount_percent',host_percent,'host_discount_minor',original_total-base_total,'discount_revision',s.discount_revision,
  'wehouse_discount_percent',fund_percent,'wehouse_discount_minor',fund_unit*p_participants,'discount_policy_version_id',fund.policy_version_id,
  'commission_base_minor',base_total,'commission_gross_minor',gross_fee,'commission_minor',gross_fee-fund_unit*p_participants,
  'host_receives_minor',base_total-gross_fee,'commission_policy_version_id',policy.policy_version_id,'commission_percent',rate);
end $$;

create function private.experience_price_snapshot_valid(q jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(case when q ? 'original_total_minor' then
  (q->>'original_total_minor')::numeric=(q->>'original_price_per_participant_minor')::numeric*(q->>'participants')::numeric
  and (q->>'original_total_minor')::numeric-(q->>'host_discount_minor')::numeric=(q->>'commission_base_minor')::numeric
  and (q->>'commission_gross_minor')::numeric=round((q->>'commission_base_minor')::numeric*(q->>'commission_percent')::numeric/100)
  and (q->>'commission_minor')::numeric=(q->>'commission_gross_minor')::numeric-(q->>'wehouse_discount_minor')::numeric
  and (q->>'total_minor')::numeric=(q->>'commission_base_minor')::numeric-(q->>'wehouse_discount_minor')::numeric
  and (q->>'host_receives_minor')::numeric=(q->>'total_minor')::numeric-(q->>'commission_minor')::numeric
  and (q->>'total_minor')::numeric=(q->>'price_per_participant_minor')::numeric*(q->>'participants')::numeric
  and (q->>'commission_minor')::numeric>=0 and (q->>'host_discount_minor')::numeric>=0 and (q->>'wehouse_discount_minor')::numeric>=0
 else (q->>'commission_minor')::numeric=round((q->>'total_minor')::numeric*(q->>'commission_percent')::numeric/100) end,false)
$$;

-- Extend the current quote and public session projection; accepted holds and
-- payments keep their existing immutable contract, hash and reference.
do $extend$declare definition text;needle text;begin
 definition:=pg_get_functiondef('private.experience_quote(uuid,integer)'::regprocedure);
 needle:=' return result;';
 if strpos(definition,needle)=0 then raise exception 'Inspect current Experience quote';end if;
 execute replace(definition,needle,' return result||private.experience_session_price(s.id,p_participants);');
 definition:=pg_get_functiondef('private.experience_public_projection(uuid)'::regprocedure);
 needle:='''price_minor'',s.price_minor,';
 if strpos(definition,needle)=0 then raise exception 'Inspect activity discovery price';end if;
 execute replace(definition,needle,'''price_minor'',(private.experience_session_price(s.id,1)->>''total_minor'')::bigint,''original_price_minor'',s.price_minor,');
 definition:=pg_get_functiondef('public.get_published_experience_sessions(uuid,timestamp with time zone,uuid)'::regprocedure);
 needle:='s.capacity,s.price_minor,s.currency';
 if strpos(definition,needle)=0 then raise exception 'Inspect public session price';end if;
 execute replace(definition,needle,'s.capacity,(private.experience_session_price(s.id,1)->>''total_minor'')::bigint as price_minor,s.price_minor as original_price_minor,s.currency');
 definition:=pg_get_functiondef('public.create_experience_checkout(uuid)'::regprocedure);
 needle:='fee<>round(total*rate/100,2)';
 if strpos(definition,needle)=0 then raise exception 'Inspect accepted commission verification';end if;
 execute replace(definition,needle,'not private.experience_price_snapshot_valid(b.contract)');
 definition:=pg_get_functiondef('public.process_verified_paystack_charge(text,text,text,text,timestamp with time zone,bigint,text,text)'::regprocedure);
 needle:='or v_payment.amount_commission is distinct from round(v_amount*v_rate/100,2)';
 if strpos(definition,needle)=0 then raise exception 'Inspect shared provider charge snapshot checks';end if;
 execute replace(definition,needle,$verify$or (case when v_payment.purpose='experience_booking' then not exists(
       select 1 from public.experience_bookings b where b.id=v_payment.experience_booking_id
        and private.experience_price_snapshot_valid(b.contract)
        and (b.contract->>'total_minor')::numeric=v_amount*100
        and (b.contract->>'commission_minor')::numeric=v_payment.amount_commission*100
        and (b.contract->>'commission_percent')::numeric=v_rate
        and b.contract=v_payment.metadata->'contract')
      else v_payment.amount_commission is distinct from round(v_amount*v_rate/100,2) end)$verify$);
 definition:=pg_get_functiondef('public.complete_internal_release_action(uuid)'::regprocedure);
 needle:='round((v_protection.released_amount+v_action.amount)*v_protection.commission_rate/100,2)';
 if strpos(definition,needle)=0 then raise exception 'Inspect shared release commission calculation';end if;
 execute replace(definition,needle,$release$round((v_protection.released_amount+v_action.amount)*
      case when v_protection.subject_type='experience_booking' then v_protection.amount_commission/nullif(v_protection.amount_total,0)
      else v_protection.commission_rate/100 end,2)$release$);
end $extend$;

revoke all on function private.experience_discount_scope(text,text),private.experience_session_price(uuid,integer),private.experience_price_snapshot_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.creator_get_experience_discount(text,text),public.creator_set_experience_discount(text,text,integer,numeric,date,uuid,text),public.creator_experience_discount_targets(uuid),public.get_my_experience_session_discount(uuid),public.set_my_experience_session_discount(uuid,integer,numeric,date) from public,anon;
grant execute on function public.creator_get_experience_discount(text,text),public.creator_set_experience_discount(text,text,integer,numeric,date,uuid,text),public.creator_experience_discount_targets(uuid),public.get_my_experience_session_discount(uuid),public.set_my_experience_session_discount(uuid,integer,numeric,date) to authenticated;
