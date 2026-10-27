-- Keep the existing versioned commission policies and financial ledger.
-- The managed policy stores the combined rate; the additional management share
-- is disclosed as combined minus the ordinary Host-managed rate.
do $repair$
declare definition text;needle text;
begin
 definition:=replace(pg_get_functiondef('public.creator_publish_booking_money_rules_v2(uuid,jsonb,timestamptz,text)'::regprocedure),chr(13),'');
 if strpos(definition,'jsonb_object_length(v_extra)')=0 then raise exception 'Inspect managed commission audit before repairing it';end if;
 definition:=replace(definition,'jsonb_object_length(v_extra)','(select count(*) from jsonb_object_keys(v_extra))');
 needle:='  -- The legacy bundle remains the single validator/publisher for every existing';
 if strpos(definition,needle)=0 then raise exception 'Inspect the managed commission validator before connecting extra rates';end if;
 execute replace(definition,needle,$new$  if (v_comm->>'short_let_wehouse_percent')::numeric<(v_comm->>'short_let_percent')::numeric
    or (v_comm->>'long_let_wehouse_percent')::numeric<(v_comm->>'long_let_percent')::numeric then
    raise exception 'Managed commission must include the base rate and a non-negative management addition';end if;
  -- The legacy bundle remains the single validator/publisher for every existing$new$);
end $repair$;

-- The fee editor must not reset unrelated metadata or the rent rollout. In
-- particular, a commission edit must never enable later-year rent collection.
do $base_bundle$
declare definition text;needle text;
begin
 definition:=replace(pg_get_functiondef('public.creator_publish_booking_money_rules(uuid,jsonb,timestamptz,text)'::regprocedure),chr(13),'');
 needle:='    if v_current is distinct from v_value then';
 if strpos(definition,needle)=0 then raise exception 'Inspect the money bundle comparison before preserving policy metadata';end if;
 definition:=replace(definition,needle,$new$    if v_key='future_long_let_installments' then continue;end if;
    v_value:=coalesce(v_current,'{}'::jsonb)||v_value;
    if v_current is distinct from v_value then$new$);
 execute definition;
end $base_bundle$;

do $rent_metadata$
declare policy public.creator_policy_versions;replacement jsonb;next_version integer;stamp timestamptz:=now();
begin
 lock table public.creator_policy_versions in share row exclusive mode;
 select * into policy from public.creator_policy_versions where policy_key='future_long_let_installments' and scope_type='global' and scope_key='*'
  and status='active' and effective_from<=stamp and (effective_until is null or effective_until>stamp) order by effective_from desc,version desc limit 1;
 if policy.policy_version_id is null then return;end if;
 replacement:=policy.value||jsonb_build_object('payment_protection_hold',false,'authorized_release_required',false,'tenant_settlement_consent_required',true,'verified_rent_credit_required',true);
 if replacement=policy.value then return;end if;
 select max(version)+1 into next_version from public.creator_policy_versions where policy_key=policy.policy_key and scope_type='global' and scope_key='*';
 update public.creator_policy_versions set status='retired',effective_until=stamp,retired_at=stamp where policy_version_id=policy.policy_version_id;
 insert into public.creator_policy_versions(policy_key,scope_type,scope_key,version,value,value_schema,status,effective_from,public_disclosure,disclosure_text,legal_review_state,reason,checksum,published_at)
 values(policy.policy_key,'global','*',next_version,replacement,policy.value_schema,'active',stamp,policy.public_disclosure,
  'Later-year monthly rent has no new protection hold. Require tenant acceptance, verified payment, disclosed fee, Partner settlement and gross rent-credit records. Initial upfront rent keeps its accepted protection.',
  policy.legal_review_state,'Owner-confirmed later-year direct settlement; preserve collection enablement and existing accepted agreements.',md5(policy.policy_key||'global'||'*'||next_version::text||replacement::text),stamp);
end $rent_metadata$;

create function private.require_rent_policy_settlement_consent() returns trigger language plpgsql set search_path='' as $$
begin
 if new.policy_key='future_long_let_installments' and new.status in('active','scheduled')
  and (new.value->>'payment_protection_hold' is distinct from 'false' or new.value->>'authorized_release_required' is distinct from 'false'
   or new.value->>'tenant_settlement_consent_required' is distinct from 'true' or new.value->>'verified_rent_credit_required' is distinct from 'true') then
  raise exception 'Later-year rent requires explicit direct-settlement consent and verified rent-credit records';end if;
 return new;
end $$;
revoke all on function private.require_rent_policy_settlement_consent() from public,anon,authenticated,service_role;
create trigger require_rent_policy_settlement_consent before insert or update of value,status on public.creator_policy_versions for each row execute function private.require_rent_policy_settlement_consent();

-- Keep collection paused while the approved direct-settlement path is verified.
-- Correct the old pause explanation without enabling a charge or changing an
-- already accepted payment agreement.
create or replace function public.create_rent_plan_contribution_payment(p_contribution_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 raise exception 'Later-year rent collection is paused until tenant consent, direct settlement and verified rent-credit tracking are connected and verified';
end $$;
revoke all on function public.create_rent_plan_contribution_payment(uuid) from public,anon,service_role;
grant execute on function public.create_rent_plan_contribution_payment(uuid) to authenticated;

create function public.creator_get_booking_money_rules_v4() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare receipt jsonb;actor text:=public.current_profile_user_id();
begin
 if actor is null or not public._property_document_session_active() or not public.current_actor_has_workspace('creator',null)
  or not exists(select 1 from public.profiles where user_id=actor and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)) then
  raise exception 'Active Creator account and trusted session required' using errcode='42501';end if;
 receipt:=public.creator_get_booking_money_rules_v2();
 return receipt||jsonb_build_object('etag',encode(pg_catalog.sha256(convert_to(
  jsonb_build_object('active',receipt->'active','scheduled',receipt->'scheduled')::text,'UTF8')),'hex'));
end $$;
revoke all on function public.creator_get_booking_money_rules_v4() from public,anon;
grant execute on function public.creator_get_booking_money_rules_v4() to authenticated;

create function public.creator_publish_booking_money_rules_v4(p_creator_elevation_id uuid,p_rules jsonb,p_effective_from timestamptz,p_reason text,p_expected_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();receipt jsonb;c jsonb:=p_rules->'commissions';item jsonb;current_value jsonb;desired jsonb;published public.creator_policy_versions;
 result jsonb:='{}';changed integer:=0;effective timestamptz:=coalesce(p_effective_from,now());
begin
 if actor is null or not public._property_document_session_active() or not public.current_actor_has_workspace('creator',null)
  or not exists(select 1 from public.profiles where user_id=actor and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false))
  or not public.creator_has_elevation(p_creator_elevation_id,'policy_publish') then raise exception 'Fresh Creator policy confirmation is required' using errcode='42501';end if;
 if length(btrim(coalesce(p_reason,''))) not between 5 and 2000 or effective<now()-interval '5 minutes' or effective>now()+interval '366 days' then raise exception 'Choose a valid effective time and record a reason';end if;
 if c is null or jsonb_typeof(c)<>'object' or exists(select 1 from jsonb_each(c) rate where case when jsonb_typeof(rate.value)='number' then
  (rate.value::text)::numeric not between 0 and 50 or (rate.value::text)::numeric<>round((rate.value::text)::numeric,2) else true end) then
  raise exception 'Commission rates must be numbers from 0 to 50 with at most two decimal places';end if;
 if not(c ?& array['short_let_percent','long_let_percent','hotel_percent','service_worker_percent','short_let_wehouse_percent','long_let_wehouse_percent'])
  or (c->>'short_let_wehouse_percent')::numeric<(c->>'short_let_percent')::numeric or (c->>'long_let_wehouse_percent')::numeric<(c->>'long_let_percent')::numeric then
  raise exception 'Choose all commission rates; managed totals include the base rate and a non-negative management percentage';end if;
 lock table public.creator_policy_versions in share row exclusive mode;
 receipt:=public.creator_get_booking_money_rules_v4();
 if p_expected_digest is distinct from receipt->>'etag' then raise exception 'Money rules changed. Refresh before publishing';end if;
 for item in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('key','commission_short_let','percent',c->'short_let_percent'),jsonb_build_object('key','commission_long_let','percent',c->'long_let_percent'),
  jsonb_build_object('key','commission_hotel','percent',c->'hotel_percent'),jsonb_build_object('key','commission_worker','percent',c->'service_worker_percent'),
  jsonb_build_object('key','commission_short_let_wehouse_managed','percent',c->'short_let_wehouse_percent'),jsonb_build_object('key','commission_long_let_wehouse_managed','percent',c->'long_let_wehouse_percent'))) loop
  select value into current_value from public.creator_policy_versions where policy_key=item->>'key' and scope_type='global' and scope_key='*'
   and status=case when effective>now() then 'scheduled' else 'active' end order by effective_from desc,version desc limit 1;
  desired:=coalesce(current_value,'{}')||jsonb_build_object('percent',item->'percent');
  if desired is distinct from current_value then
   select * into published from public.creator_publish_policy(p_creator_elevation_id,item->>'key','global','*',desired,jsonb_build_object('type','percentage'),effective,true,
    'Commission is deducted from eligible Provider earnings under the accepted protection or later-year direct-settlement arrangement. Managed Home commission includes the base rate and additional management share.','pending',btrim(p_reason));
   result:=result||jsonb_build_object(item->>'key',jsonb_build_object('policy_version_id',published.policy_version_id,'version',published.version,'status',published.status,'effective_from',published.effective_from));changed:=changed+1;
  end if;
 end loop;
 return jsonb_build_object('changed_policy_count',changed,'published',result);
end $$;
revoke all on function public.creator_publish_booking_money_rules_v4(uuid,jsonb,timestamptz,text,text) from public,anon;
grant execute on function public.creator_publish_booking_money_rules_v4(uuid,jsonb,timestamptz,text,text) to authenticated;

-- Operating-rule edits cannot reprice commissions from an old browser tab.
create function public.creator_publish_operating_money_rules(p_creator_elevation_id uuid,p_rules jsonb,p_effective_from timestamptz,p_reason text,p_expected_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();receipt jsonb;active jsonb;
begin
 if actor is null or not public._property_document_session_active() or not public.current_actor_has_workspace('creator',null)
  or not exists(select 1 from public.profiles where user_id=actor and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false))
  or not public.creator_has_elevation(p_creator_elevation_id,'policy_publish') then raise exception 'Fresh Creator policy confirmation is required' using errcode='42501';end if;
 lock table public.creator_policy_versions in share row exclusive mode;
 receipt:=public.creator_get_booking_money_rules_v4();active:=receipt->'active';
 if p_expected_digest is distinct from receipt->>'etag' then raise exception 'Money rules changed. Refresh before publishing';end if;
 p_rules:=jsonb_set(p_rules,'{commissions}',jsonb_build_object('short_let_percent',active#>'{commission_short_let,value,percent}',
  'long_let_percent',active#>'{commission_long_let,value,percent}','hotel_percent',active#>'{commission_hotel,value,percent}','service_worker_percent',active#>'{commission_worker,value,percent}'));
 return public.creator_publish_booking_money_rules(p_creator_elevation_id,p_rules,p_effective_from,p_reason);
end $$;
revoke all on function public.creator_publish_operating_money_rules(uuid,jsonb,timestamptz,text,text) from public,anon;
grant execute on function public.creator_publish_operating_money_rules(uuid,jsonb,timestamptz,text,text) to authenticated;

create function private.provider_fee_disclosure(p_product text,p_management_mode text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base public.creator_policy_versions;managed public.creator_policy_versions;key text;payload jsonb;
begin
 key:=case p_product when 'short_let' then 'commission_short_let' when 'long_stay' then 'commission_long_let'
  when 'hotel' then 'commission_hotel' when 'service' then 'commission_worker' when 'experience' then 'commission_experience' end;
 if key is null or p_management_mode is null or p_management_mode not in('host','wehouse')
  or (p_management_mode='wehouse' and p_product not in('short_let','long_stay')) then raise exception 'Choose a supported offering and management option';end if;
 select * into base from public.creator_policy_versions where policy_key=key and scope_type='global' and scope_key='*'
  and status='active' and effective_from<=now() and (effective_until is null or effective_until>now()) order by effective_from desc,version desc limit 1;
 if base.policy_version_id is null then return jsonb_build_object('available',false,'product',p_product,'management_mode',p_management_mode);end if;
 managed:=base;
 if p_management_mode='wehouse' then
  select * into managed from public.creator_policy_versions where policy_key=key||'_wehouse_managed' and scope_type='global' and scope_key='*'
   and status='active' and effective_from<=now() and (effective_until is null or effective_until>now()) order by effective_from desc,version desc limit 1;
 end if;
 if managed.policy_version_id is null or (base.value->>'percent')::numeric is null or (managed.value->>'percent')::numeric is null
  or (base.value->>'percent')::numeric not between 0 and 50 or (managed.value->>'percent')::numeric not between (base.value->>'percent')::numeric and 50 then
  return jsonb_build_object('available',false,'product',p_product,'management_mode',p_management_mode);end if;
 payload:=jsonb_build_object('available',true,'product',p_product,'management_mode',p_management_mode,
  'base_policy_version_id',base.policy_version_id,'policy_version_id',managed.policy_version_id,
  'base_percent',(base.value->>'percent')::numeric,
  'management_percent',(managed.value->>'percent')::numeric-(base.value->>'percent')::numeric,
  'total_percent',(managed.value->>'percent')::numeric,'deducted_from','provider_earnings',
  'basis',case when p_product='long_stay' then 'eligible_rent' when p_product in('short_let','hotel') then 'accommodation_value' else 'agreed_booking_value' end);
 return payload||jsonb_build_object('digest',encode(pg_catalog.sha256(convert_to(payload::text,'UTF8')),'hex'));
end $$;
revoke all on function private.provider_fee_disclosure(text,text) from public,anon,authenticated,service_role;

create function public.get_provider_fee_disclosure(p_product text,p_management_mode text default 'host') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();
begin
 if actor is null or not public._property_document_session_active() or not exists(select 1 from public.profiles where user_id=actor
  and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)) then raise exception 'Active trusted account required' using errcode='42501';end if;
 return private.provider_fee_disclosure(p_product,p_management_mode);
end $$;
revoke all on function public.get_provider_fee_disclosure(text,text) from public,anon;
grant execute on function public.get_provider_fee_disclosure(text,text) to authenticated;

alter table public.inspection_requests add column provider_fee_snapshot jsonb;
alter table public.listings add column provider_fee_snapshot jsonb;
alter table public.reservations add column provider_fee_snapshot jsonb;

-- Acceptance is recorded on the existing property request/listing, never on a
-- competing payment or wallet record. The current policy remains the authority.
create function public.accept_my_property_fees(p_digest text,p_request_id uuid default null,p_listing_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();r public.inspection_requests;l public.listings;receipt jsonb;previous text;
begin
 if actor is null or not public._property_document_session_active() or not public.current_actor_has_workspace('property_partner',null)
  or not exists(select 1 from public.profiles where user_id=actor and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false))
  or (p_request_id is null)=(p_listing_id is null) then raise exception 'Choose your own property on a trusted Partner account' using errcode='42501';end if;
 if p_request_id is not null then
  select * into r from public.inspection_requests where id=p_request_id and owner_id=actor for update;
  if r.id is null or r.property_type<>'apartment' then raise exception 'Home submission unavailable' using errcode='42501';end if;
  receipt:=private.provider_fee_disclosure(r.sub_type,r.requested_management_mode);
 else
  select * into l from public.listings where id=p_listing_id and coalesce(partner_id,owner_id)=actor and deleted_at is null for update;
  if l.id is null then raise exception 'Home unavailable' using errcode='42501';end if;
  receipt:=private.provider_fee_disclosure(l.sub_type,l.management_mode);
 end if;
 if receipt->>'available' is distinct from 'true' or p_digest is distinct from receipt->>'digest' then raise exception 'Fees changed or are unavailable. Review the current rates before accepting';end if;
 if r.id is not null and r.provider_fee_snapshot->>'digest'=p_digest and r.provider_fee_snapshot->>'accepted_by'=actor then return r.provider_fee_snapshot;end if;
 if l.id is not null and l.provider_fee_snapshot->>'digest'=p_digest and l.provider_fee_snapshot->>'accepted_by'=actor then return l.provider_fee_snapshot;end if;
 receipt:=receipt||jsonb_build_object('accepted_by',actor,'accepted_at',now());
 previous:=current_setting('wehouse.provider_fee_acceptance',true);
 perform set_config('wehouse.provider_fee_acceptance','confirmed',true);
 if r.id is not null then
  update public.inspection_requests set provider_fee_snapshot=receipt,updated_at=now() where id=r.id;
  if r.draft_listing_id is not null then
   update public.listings set provider_fee_snapshot=receipt,updated_at=now()
    where id=r.draft_listing_id and partner_id=actor and management_mode=r.requested_management_mode;
  end if;
 else update public.listings set provider_fee_snapshot=receipt,updated_at=now() where id=l.id;
 end if;
 perform set_config('wehouse.provider_fee_acceptance',coalesce(previous,''),true);
 insert into public.audit_logs(action,target_type,target_id,admin_id,details)
 values('PROPERTY_FEES_ACCEPTED',case when r.id is null then 'listing' else 'inspection_request' end,
  coalesce(r.id,l.id)::text,actor,receipt::text);
 return receipt;
end $$;
revoke all on function public.accept_my_property_fees(text,uuid,uuid) from public,anon,service_role;
grant execute on function public.accept_my_property_fees(text,uuid,uuid) to authenticated;

create function public.get_my_property_fee_terms(p_request_id uuid default null,p_listing_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();r public.inspection_requests;l public.listings;fee jsonb;snapshot jsonb;
begin
 if actor is null or not public._property_document_session_active() or not public.current_actor_has_workspace('property_partner',null)
  or not exists(select 1 from public.profiles where user_id=actor and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false))
  or (p_request_id is null)=(p_listing_id is null) then raise exception 'Choose your own property on a trusted Partner account' using errcode='42501';end if;
 if p_request_id is not null then
  select * into r from public.inspection_requests where id=p_request_id and owner_id=actor;
  if r.id is null or r.property_type<>'apartment' then raise exception 'Home submission unavailable' using errcode='42501';end if;
  fee:=private.provider_fee_disclosure(r.sub_type,r.requested_management_mode);snapshot:=r.provider_fee_snapshot;
 else
  select * into l from public.listings where id=p_listing_id and coalesce(partner_id,owner_id)=actor and deleted_at is null;
  if l.id is null then raise exception 'Home unavailable' using errcode='42501';end if;
  fee:=private.provider_fee_disclosure(l.sub_type,l.management_mode);snapshot:=l.provider_fee_snapshot;
 end if;
 return jsonb_build_object('current',fee,'accepted',coalesce(fee->>'available'='true' and snapshot->>'digest'=fee->>'digest' and snapshot->>'accepted_by'=actor,false));
end $$;
revoke all on function public.get_my_property_fee_terms(uuid,uuid) from public,anon,service_role;
grant execute on function public.get_my_property_fee_terms(uuid,uuid) to authenticated;

create function private.guard_property_fee_acceptance() returns trigger language plpgsql set search_path='' as $$
begin
 if new.provider_fee_snapshot is not null and (tg_op='INSERT' or new.provider_fee_snapshot is distinct from old.provider_fee_snapshot)
  and current_setting('wehouse.provider_fee_acceptance',true) is distinct from 'confirmed' then raise exception 'Use the reviewed Partner fee-acceptance command';end if;
 return new;
end $$;
revoke all on function private.guard_property_fee_acceptance() from public,anon,authenticated,service_role;
create trigger guard_property_fee_acceptance before insert or update of provider_fee_snapshot on public.inspection_requests for each row execute function private.guard_property_fee_acceptance();
create trigger guard_property_fee_acceptance before insert or update of provider_fee_snapshot on public.listings for each row execute function private.guard_property_fee_acceptance();

do $submission$
declare definition text;needle text;
begin
 definition:=replace(pg_get_functiondef('public.create_my_property_inspection_batch_v4(uuid,jsonb)'::regprocedure),chr(13),'');
 needle:='  v_result:=public.create_my_property_inspection_batch_v3(p_items);';
 if strpos(definition,needle)=0 then raise exception 'Inspect canonical submission before adding fee consent';end if;
 definition:=replace(definition,needle,$new$  for v_item in select value from jsonb_array_elements(p_items) loop
    if v_item->>'property_type'='apartment' then
      if v_item->>'provider_fee_digest' is null or v_item->>'provider_fee_digest' is distinct from
        private.provider_fee_disclosure(v_item->>'sub_type',v_item->>'management_mode')->>'digest' then
        raise exception 'Review and accept the current fees for each home before submission';end if;
    end if;
  end loop;
  v_result:=public.create_my_property_inspection_batch_v3(p_items);$new$);
 needle:='    perform private.link_submission_space(v_request_id,v_item,v_actor);';
 if strpos(definition,needle)=0 then raise exception 'Inspect submitted property receipt before recording acceptance';end if;
 definition:=replace(definition,needle,$new$    if v_item->>'property_type'='apartment' then
      perform public.accept_my_property_fees(v_item->>'provider_fee_digest',v_request_id,null);
    end if;
    perform private.link_submission_space(v_request_id,v_item,v_actor);$new$);
 execute definition;
end $submission$;

create function private.require_property_fee_acceptance() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.inspection_requests;current_fee jsonb;
begin
 if new.approved_at is null or (tg_op='UPDATE' and old.approved_at is not null) then return new;end if;
 -- Preserve existing imported/legacy records; browser listing bypasses remain retired.
 -- Every canonical Partner submission must carry its explicit fee agreement.
 if new.inspection_request_id is null or new.partner_id is null then return new;end if;
 select * into r from public.inspection_requests where id=new.inspection_request_id and owner_id=new.partner_id;
 current_fee:=private.provider_fee_disclosure(new.sub_type,new.management_mode);
 if current_fee->>'available' is distinct from 'true' or r.provider_fee_snapshot->>'digest' is distinct from current_fee->>'digest'
  or r.provider_fee_snapshot->>'accepted_by' is distinct from new.partner_id then raise exception 'The Partner must accept the current fees before publication';end if;
 new.provider_fee_snapshot:=r.provider_fee_snapshot;
 return new;
end $$;
revoke all on function private.require_property_fee_acceptance() from public,anon,authenticated,service_role;
create trigger listings_provider_fee_before_publication before insert or update of approved_at on public.listings for each row execute function private.require_property_fee_acceptance();

create function private.require_booking_fee_acceptance() returns trigger language plpgsql security definer set search_path='' as $$
declare l public.listings;fee jsonb;
begin
 select * into l from public.listings where id::text=new.listing_id or listing_id=new.listing_id limit 1;
 if l.id is null then return new;end if;
 fee:=private.provider_fee_disclosure(l.sub_type,l.management_mode);
 if fee->>'available' is distinct from 'true' or l.provider_fee_snapshot->>'digest' is distinct from fee->>'digest'
  or l.provider_fee_snapshot->>'accepted_by' is distinct from coalesce(l.partner_id,l.owner_id) then
  raise exception 'The Partner is reviewing updated property fees. New bookings are temporarily unavailable';end if;
 new.provider_fee_snapshot:=l.provider_fee_snapshot;
 return new;
end $$;
revoke all on function private.require_booking_fee_acceptance() from public,anon,authenticated,service_role;
create trigger reservations_fee_acceptance before insert on public.reservations for each row execute function private.require_booking_fee_acceptance();

create function private.keep_reservation_fee_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
 if new.provider_fee_snapshot is distinct from old.provider_fee_snapshot then raise exception 'Accepted booking fee terms cannot change';end if;
 return new;
end $$;
revoke all on function private.keep_reservation_fee_snapshot() from public,anon,authenticated,service_role;
create trigger keep_reservation_fee_snapshot before update of provider_fee_snapshot on public.reservations for each row execute function private.keep_reservation_fee_snapshot();
