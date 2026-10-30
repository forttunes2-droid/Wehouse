-- Synthetic consent and policy decisions. No external payment; all rows roll back.
begin;
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description;end if;end$$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$begin execute statement;return false;exception when others then return true;end$$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.rejects(text) to authenticated;
do $$
declare creator uuid:=gen_random_uuid();partner uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();
 cs uuid:=gen_random_uuid();ps uuid:=gen_random_uuid();os uuid:=gen_random_uuid();elevation uuid:=gen_random_uuid();
 cid text:='fee-check-'||creator;pid text:='fee-check-'||partner;oid text:='fee-check-'||outsider;
 request_id uuid:=gen_random_uuid();receipt jsonb;initial_rules jsonb;rules jsonb;active jsonb;fee jsonb;saved jsonb;command_result jsonb;policy_count integer;
begin
 insert into auth.users(id,aud,role,email,created_at,updated_at) values
 (creator,'authenticated','authenticated',creator||'@example.invalid',now(),now()),(partner,'authenticated','authenticated',partner||'@example.invalid',now(),now()),(outsider,'authenticated','authenticated',outsider||'@example.invalid',now(),now());
 insert into public.profiles(auth_id,email,user_id,role,profile_complete,full_name,state,city) values
 (creator,creator||'@example.invalid',cid,'user',true,'Fee contract Creator','Nasarawa','Lafia'),(partner,partner||'@example.invalid',pid,'user',true,'Fee contract Partner','Nasarawa','Lafia'),(outsider,outsider||'@example.invalid',oid,'user',true,'Fee contract outsider','Nasarawa','Lafia');
 insert into auth.sessions(id,user_id,created_at,updated_at) values(cs,creator,now(),now()),(ps,partner,now(),now()),(os,outsider,now(),now());
 insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status) values
 (cid,creator,cs,'fee-'||creator,'Browser',true,'trusted'),(pid,partner,ps,'fee-'||partner,'Browser',true,'trusted'),(oid,outsider,os,'fee-'||outsider,'Browser',true,'trusted');
 insert into public.workspace_role_assignments(user_id,workspace_role,scope_type) values(cid,'creator','global'),(pid,'property_partner','global'),(oid,'property_partner','global');
 insert into public.creator_elevation_grants(creator_elevation_id,creator_user_id,auth_user_id,auth_session_id,action_classes,expires_at,verification_method)
 values(elevation,cid,creator,cs::text,array['policy_publish'],now()+interval '5 minutes','password');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',creator,'session_id',cs,'role','authenticated')::text,true);
 initial_rules:=public.creator_get_booking_money_rules_v4();active:=initial_rules->'active';
 perform pg_temp.expect(initial_rules#>>'{active,future_long_let_installments,value,payment_protection_hold}'='false' and initial_rules#>>'{active,future_long_let_installments,value,tenant_settlement_consent_required}'='true','later-year direct settlement requires tenant consent without activating collection');
 perform pg_temp.expect(length(initial_rules->>'etag')=64,'Creator rules have a complete version digest');
 rules:=jsonb_build_object(
  'commissions',jsonb_build_object('short_let_percent',active#>'{commission_short_let,value,percent}','long_let_percent',active#>'{commission_long_let,value,percent}',
   'hotel_percent',active#>'{commission_hotel,value,percent}','service_worker_percent',active#>'{commission_worker,value,percent}',
   'short_let_wehouse_percent',(active#>>'{commission_short_let,value,percent}')::numeric+3,'long_let_wehouse_percent',(active#>>'{commission_long_let,value,percent}')::numeric+2));
 command_result:=public.creator_publish_booking_money_rules_v4(elevation,rules,now(),'Synthetic managed fee decision; all changes roll back',initial_rules->>'etag');
 perform pg_temp.expect((command_result->>'changed_policy_count')::integer>=2,'existing publisher records both managed rates without a second authority');
 receipt:=public.creator_get_booking_money_rules_v4();
 perform pg_temp.expect(receipt#>'{active,commission_hotel}'=initial_rules#>'{active,commission_hotel}','unrelated Hotel commission is preserved');
 perform pg_temp.expect(receipt#>'{active,future_long_let_installments,value}'=initial_rules#>'{active,future_long_let_installments,value}','fee edits preserve the existing later-year collection rollout');
 perform pg_temp.expect(pg_temp.rejects(format('select public.creator_publish_booking_money_rules_v4(%L,%L::jsonb,now(),%L,%L)',elevation,rules::text,'Stale Creator tab must be rejected',initial_rules->>'etag')),'stale policy tab cannot overwrite rates');
 fee:=public.get_provider_fee_disclosure('short_let','wehouse');
 perform pg_temp.expect((fee->>'management_percent')::numeric=3 and (fee->>'total_percent')::numeric=(fee->>'base_percent')::numeric+3,'combined rate is base plus extra, not two combined deductions');
 perform pg_temp.expect((public.get_provider_fee_disclosure('short_let','host')->>'management_percent')::numeric=0,'Host-managed home has no management addition');
 select count(*) into policy_count from public.creator_policy_versions;
 perform pg_temp.expect(pg_temp.rejects(format('select public.creator_publish_booking_money_rules_v4(%L,%L::jsonb,now(),%L,%L)',elevation,jsonb_set(rules,'{commissions,short_let_wehouse_percent}','0')::text,'Invalid combined rate must be rejected',receipt->>'etag')),'managed total below base is rejected atomically');
 perform pg_temp.expect((select count(*)=policy_count from public.creator_policy_versions),'invalid combined rate creates no policy versions');
 insert into public.inspection_requests(id,request_code,owner_id,owner_email,property_address,property_city,property_state,property_type,sub_type,status,requested_management_mode)
 values(request_id,'FEE-'||left(request_id::text,8),pid,partner||'@example.invalid','Synthetic address','Lafia','Nasarawa','apartment','short_let','pending','wehouse');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',partner,'session_id',ps,'role','authenticated')::text,true);
 perform pg_temp.expect(pg_temp.rejects('select public.creator_get_booking_money_rules_v4()'),'Partner cannot read Creator controls');
 receipt:=public.get_my_property_fee_terms(request_id,null);
 perform pg_temp.expect(not(receipt->>'accepted')::boolean,'a pending request never invents prior acceptance');
 saved:=public.accept_my_property_fees(fee->>'digest',request_id,null);
 perform pg_temp.expect(saved->>'accepted_by'=pid and (saved->>'management_percent')::numeric=3,'only owner accepts the actual current rate');
 perform pg_temp.expect(public.accept_my_property_fees(fee->>'digest',request_id,null)=saved,'lost acceptance response returns its original record');
 perform pg_temp.expect((select count(*)=1 from public.audit_logs where action='PROPERTY_FEES_ACCEPTED' and target_id=request_id::text),'acceptance retry creates one audit receipt');
 execute 'set local role authenticated';
 begin execute format('update public.inspection_requests set provider_fee_snapshot=%L::jsonb where id=%L','{}',request_id);exception when others then null;end;
 execute 'reset role';
 perform pg_temp.expect((select provider_fee_snapshot=saved from public.inspection_requests where id=request_id),'direct browser update cannot forge acceptance');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'session_id',os,'role','authenticated')::text,true);
 perform pg_temp.expect(pg_temp.rejects(format('select public.accept_my_property_fees(%L,%L,null)',fee->>'digest',request_id)),'another Partner cannot accept for this owner');
 perform pg_temp.expect(pg_temp.rejects(format('select public.get_my_property_fee_terms(%L,null)',request_id)),'another Partner cannot read this private acceptance');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',creator,'session_id',cs,'role','authenticated')::text,true);
 receipt:=public.creator_get_booking_money_rules_v4();rules:=jsonb_set(rules,'{commissions,short_let_wehouse_percent}',to_jsonb((fee->>'total_percent')::numeric+1));
 perform public.creator_publish_booking_money_rules_v4(elevation,rules,now(),'Second synthetic rate to exercise stale acceptance',receipt->>'etag');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',partner,'session_id',ps,'role','authenticated')::text,true);
 perform pg_temp.expect(not(public.get_my_property_fee_terms(request_id,null)->>'accepted')::boolean,'new rates require a fresh owner acceptance');
 perform pg_temp.expect(pg_temp.rejects(format('select public.accept_my_property_fees(%L,%L,null)',fee->>'digest',request_id)),'old disclosure cannot accept changed rates');
 update public.user_sessions set is_active=false where user_id=pid;
 perform pg_temp.expect(pg_temp.rejects(format('select public.get_my_property_fee_terms(%L,null)',request_id)),'revoked device cannot read or accept fees');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',creator,'session_id',cs,'role','authenticated')::text,true);
 update public.profiles set suspended=true where user_id=cid;
 perform pg_temp.expect(pg_temp.rejects('select public.creator_get_booking_money_rules_v4()'),'suspended Creator cannot use policy controls');
end $$;
rollback;
select 'Managed fee configuration, disclosure, ownership, stale updates and acceptance replay passed; fixtures rolled back' as result;
