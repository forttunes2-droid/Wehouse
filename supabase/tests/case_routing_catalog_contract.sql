begin;
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description;end if;end$$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$begin execute statement;return false;exception when others then return true;end$$;
grant execute on function pg_temp.expect(boolean,text) to authenticated;
grant execute on function pg_temp.rejects(text) to authenticated;
do $$
declare u uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); us uuid:=gen_random_uuid(); cs uuid:=gen_random_uuid();
 uid text:='routing-check-'||u; cid text:='routing-check-'||c;
 wallet uuid:=gen_random_uuid(); withdrawal uuid:=gen_random_uuid(); reason record; receipt jsonb; draft uuid;
 staff_auth uuid; staff_session uuid; staff_id text; staff_domain text; staff_actors jsonb:='{}'; staff_actor jsonb; outside_actor jsonb;
 field_case uuid:=gen_random_uuid(); field_conversation uuid:=gen_random_uuid(); field_actor jsonb;
 topic text; target_subject_id text; conversation uuid; previous uuid; expected_count integer;
begin
 insert into auth.users(id,aud,role,email,created_at,updated_at) values
 (u,'authenticated','authenticated',u||'@example.invalid',now(),now()),(c,'authenticated','authenticated',c||'@example.invalid',now(),now());
 insert into public.profiles(auth_id,email,user_id,role,profile_complete,full_name,state,city,local_government) values
 (u,u||'@example.invalid',uid,'user',true,'Routing requester','Nasarawa','Lafia','Lafia'),(c,c||'@example.invalid',cid,'user',true,'Routing reviewer','Nasarawa','Lafia','Lafia');
 insert into auth.sessions(id,user_id,created_at,updated_at) values(us,u,now(),now()),(cs,c,now(),now());
 insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status) values
 (uid,u,us,'check-'||u,'Browser',true,'trusted'),(cid,c,cs,'check-'||c,'Browser',true,'trusted');
 insert into public.workspace_role_assignments(user_id,workspace_role,scope_type) values(uid,'worker','global'),(cid,'creator','global');
 insert into public.wallets(id,owner_id,owner_type,available_balance,pending_balance,frozen_balance,total_withdrawn) values(wallet,uid,'worker',0,0,0,0);
 insert into public.withdrawals(id,wallet_id,amount,status) values(withdrawal,wallet,100,'awaiting_review');
 for staff_domain in select unnest(array['support','worker_operations','finance_operations','security_operations','outside_finance','field_operations','other_field','outside_field']) loop
  staff_auth:=gen_random_uuid();staff_session:=gen_random_uuid();staff_id:='routing-staff-'||staff_auth;
  insert into auth.users(id,aud,role,email,created_at,updated_at) values(staff_auth,'authenticated','authenticated',staff_auth||'@example.invalid',now(),now());
  insert into public.profiles(auth_id,email,user_id,role,profile_complete,full_name,state,city,local_government) values(staff_auth,staff_auth||'@example.invalid',staff_id,'user',true,'Scoped routing team','Nasarawa','Lafia','Lafia');
  insert into auth.sessions(id,user_id,created_at,updated_at) values(staff_session,staff_auth,now(),now());
  insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status) values(staff_id,staff_auth,staff_session,'check-'||staff_auth,'Browser',true,'trusted');
  insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga) values
   (staff_id,'staff','branch','Nasarawa',case when staff_domain in ('outside_finance','outside_field') then 'Karu' else 'Lafia' end),
   (staff_id,case when staff_domain='outside_finance' then 'finance_operations' when staff_domain in ('other_field','outside_field') then 'field_operations' else staff_domain end,'branch','Nasarawa',case when staff_domain in ('outside_finance','outside_field') then 'Karu' else 'Lafia' end);
  staff_actors:=staff_actors||jsonb_build_object(staff_domain,jsonb_build_object('auth',staff_auth,'session',staff_session,'person',staff_id));
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',us,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 perform pg_temp.expect(pg_temp.rejects(format('insert into public.workspace_role_assignments(user_id,workspace_role,scope_type) values(%L,%L,%L)',uid,'staff','global')),'ordinary user cannot grant themselves Staff through direct database access');
 perform pg_temp.expect(pg_temp.rejects(format('select public.manage_staff_permission(%L,%L,true)',uid,'finance_operations')),'ordinary user cannot assign themselves an operational department');
 perform pg_temp.expect(pg_temp.rejects(format('select public.creator_set_team_role(%L,%L,%L,%L,%L,null::uuid)',uid,'staff','Nasarawa','Lafia','field_operations')),'ordinary user cannot use the Creator Team endpoint to become Field Operations Staff');
 execute 'reset role';
 perform pg_temp.expect((select count(*)=11 from public.case_reason_registry where active and reason_code in ('app_help','account_access','worker_verification','worker_job_issue','payment_issue','payout_issue','account_compromise','safety_threat','arrival_issue','field_visit','property_submission_help')),'all required routing configuration exists');
 for reason in select * from (values ('app_help','support','account'),('account_access','support','account'),('worker_verification','worker_operations','worker'),('payout_issue','finance_operations','payout'),('account_compromise','security_operations','account'),('safety_threat','security_operations','account')) r(code,domain,subject_type)
 loop
  target_subject_id:=case when reason.subject_type='payout' then withdrawal::text else uid end;
  draft:=public.create_my_support_message_draft();
  receipt:=public.send_my_first_contextual_help_message(draft,reason.code,reason.subject_type,target_subject_id,'Routing contract','{"requester_workspace":"personal"}','Please review this linked record.');
  conversation:=(receipt->>'conversation_id')::uuid;
  perform pg_temp.expect(conversation is not null and receipt->>'message_id' is not null,'real first-send returns conversation and message receipts');
  perform pg_temp.expect(exists(select 1 from public.partner_support_conversations t join public.operational_cases o on o.operational_case_id=t.operational_case_id where t.id=conversation and o.owning_domain=reason.domain and coalesce(o.owning_domain,public.canonical_operational_domain(t.channel_kind))=reason.domain and o.requester_user_id=uid and o.subject_id=target_subject_id),format('case and conversation retain server-owned domain and subject: reason=%s actual=%s',reason.code,(select jsonb_build_object('domain',o.owning_domain,'channel',t.channel_kind,'mapped',public.canonical_operational_domain(t.channel_kind),'subject',o.subject_id) from public.partner_support_conversations t join public.operational_cases o on o.operational_case_id=t.operational_case_id where t.id=conversation)));
  previous:=(public.send_my_first_contextual_help_message(draft,reason.code,reason.subject_type,target_subject_id,'Routing contract','{"requester_workspace":"personal"}','Please review this linked record.')->>'conversation_id')::uuid;
  perform pg_temp.expect(previous=conversation,'same draft retry retains its routed conversation');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',c,'session_id',cs,'role','authenticated')::text,true);
  perform pg_temp.expect(exists(select 1 from public.support_inbox(reason.domain) item where item.conversation_id=conversation),'owning operational queue receives the actual case');
  if reason.domain<>'support' then perform pg_temp.expect(not exists(select 1 from public.support_inbox('support') item where item.conversation_id=conversation),'specialist case is not dumped into general Support');end if;
  staff_actor:=staff_actors->reason.domain;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_actor->>'auth','session_id',staff_actor->>'session','role','authenticated')::text,true);
  execute 'set local role authenticated';
  perform pg_temp.expect(pg_temp.rejects(format('select public.manage_staff_permission(%L,%L,true)',staff_actor->>'person','field_operations')),'existing Staff cannot change their own department');
  perform pg_temp.expect(exists(select 1 from public.workspace_role_assignments where user_id=staff_actor->>'person' and workspace_role='staff' and status='active' and revoked_at is null),'Staff can read its own base dashboard grant through RLS');
  perform pg_temp.expect(exists(select 1 from public.workspace_role_assignments where user_id=staff_actor->>'person' and workspace_role=reason.domain and status='active' and revoked_at is null),'Staff can read its own operational dashboard grant through RLS');
  perform pg_temp.expect(not exists(select 1 from public.workspace_role_assignments where user_id=cid),'Staff cannot read another persons grants through RLS');
  execute 'reset role';
  perform pg_temp.expect(exists(select 1 from public.support_inbox(reason.domain) item where item.conversation_id=conversation),'matching branch staff receives its domain case');
  perform pg_temp.expect(public.current_actor_can_access_operational_conversation(conversation,false),'matching branch staff can open the delivered case');
  perform pg_temp.expect(public.claim_my_communication_case(conversation),'matching branch staff can claim the actual case');
  perform pg_temp.expect(public.send_support_message_v2(gen_random_uuid(),conversation,'We are reviewing your linked request.') is not null,'assigned staff can send a confirmed customer reply');
  perform pg_temp.expect(pg_temp.rejects(format('select public.support_inbox(%L)',case when reason.domain='support' then 'finance_operations' else 'support' end)),'staff cannot open a different operational domain queue');
  if reason.domain='finance_operations' then
   outside_actor:=staff_actors->'outside_finance';
   perform set_config('request.jwt.claims',jsonb_build_object('sub',outside_actor->>'auth','session_id',outside_actor->>'session','role','authenticated')::text,true);
   perform pg_temp.expect(not exists(select 1 from public.support_inbox('finance_operations') item where item.conversation_id=conversation),'other-branch finance staff cannot receive the case');
   perform pg_temp.expect(not public.current_actor_can_access_operational_conversation(conversation,false),'other-branch finance staff cannot open the case');
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',us,'role','authenticated')::text,true);
 end loop;
 -- Assigned Field Operations Staff participates in one property case without taking ownership.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',c,'session_id',cs,'role','authenticated')::text,true);
 field_actor:=staff_actors->'field_operations';
 insert into public.operational_cases(operational_case_id,reason_code,owning_domain,subject_type,subject_id,requester_user_id,state_scope,status,priority)
 values(field_case,'field_visit','property_operations','inspection',gen_random_uuid()::text,uid,'Nasarawa','open','normal');
 insert into public.partner_support_conversations(id,partner_id,subject,status,context_type,context_id,operational_case_id,assigned_field_officer_id,property_state,property_city)
 values(field_conversation,uid,'Assigned field participation','open','operational_case',field_case::text,field_case,field_actor->>'person','Nasarawa','Lafia');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',us,'role','authenticated')::text,true);
 perform public.send_support_message_v2(gen_random_uuid(),field_conversation,'Please coordinate the assigned visit.');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',field_actor->>'auth','session_id',field_actor->>'session','role','authenticated')::text,true);
 perform pg_temp.expect(public.current_actor_can_access_operational_conversation(field_conversation,false),'assigned scoped Field Operations Staff can read the existing property case');
 perform pg_temp.expect(not public.current_actor_can_access_operational_conversation(field_conversation,true),'field participation does not grant property-case management');
 perform pg_temp.expect(exists(select 1 from public.support_inbox('field_operations') item where item.conversation_id=field_conversation and item.context_snapshot->>'field_assignee_id'=field_actor->>'person'),'assigned field case reaches Field Operations with server-owned participation metadata');
 perform pg_temp.expect(public.send_support_message_v2(gen_random_uuid(),field_conversation,'I will coordinate the assigned inspection.') is not null,'assigned Field Operations Staff can contribute a confirmed reply');
 perform pg_temp.expect(pg_temp.rejects(format('select public.claim_my_communication_case(%L)',field_conversation)),'field participant cannot claim unassigned Property Operations ownership');
 perform pg_temp.expect(pg_temp.rejects(format('select public.transition_my_support_case(%L,%L,%L)',field_conversation,'resolve','Trying to resolve')),'field participant cannot resolve the property case');
 staff_actor:=staff_actors->'other_field';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_actor->>'auth','session_id',staff_actor->>'session','role','authenticated')::text,true);
 perform pg_temp.expect(not public.current_actor_can_access_operational_conversation(field_conversation,false),'unassigned Field Operations Staff cannot open another persons task');
 perform pg_temp.expect(not exists(select 1 from public.support_inbox('field_operations') item where item.conversation_id=field_conversation),'unassigned field colleague does not receive the case');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',c,'session_id',cs,'role','authenticated')::text,true);
 perform pg_temp.expect(public.claim_my_communication_case(field_conversation),'primary case owner can claim while a Field Operations specialist is assigned');
 perform pg_temp.expect((select assigned_staff_id=cid and assigned_field_officer_id=field_actor->>'person' from public.partner_support_conversations where id=field_conversation),'primary assignment preserves the Field Operations specialist');
 staff_actor:=staff_actors->'outside_field';
 update public.partner_support_conversations set assigned_field_officer_id=staff_actor->>'person' where id=field_conversation;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_actor->>'auth','session_id',staff_actor->>'session','role','authenticated')::text,true);
 perform pg_temp.expect(not public.current_actor_can_access_operational_conversation(field_conversation,false),'an assignment pointer cannot bypass Field Operations branch coverage');
 perform pg_temp.expect(not exists(select 1 from public.support_inbox('field_operations') item where item.conversation_id=field_conversation),'out-of-branch assigned field member cannot receive the property case');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',c,'session_id',cs,'role','authenticated')::text,true);
 update public.partner_support_conversations set assigned_field_officer_id=field_actor->>'person' where id=field_conversation;
 update public.workspace_role_assignments set status='revoked',revoked_at=now() where user_id=field_actor->>'person' and workspace_role='field_operations';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',field_actor->>'auth','session_id',field_actor->>'session','role','authenticated')::text,true);
 perform pg_temp.expect(not public.current_actor_can_access_operational_conversation(field_conversation,false),'revoked Field Operations grant removes participation despite remaining assignment pointer');
 perform pg_temp.expect(pg_temp.rejects(format('select public.send_support_message_v2(gen_random_uuid(),%L,%L)',field_conversation,'Revoked reply')),'revoked field participant cannot reply');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',us,'role','authenticated')::text,true);
 perform pg_temp.expect(pg_temp.rejects(format('select public.open_contextual_case_conversation(%L,%L,%L)', 'app_help','payout',withdrawal)),'wrong subject type cannot change routing');
 perform pg_temp.expect(pg_temp.rejects(format('select public.open_contextual_case_conversation(%L,%L,%L)', 'account_compromise','account',cid)),'unrelated account cannot be used as a help target');
end $$;
rollback;
select 'Required routing configuration, six real first-send paths, owning queues, retries and subject rejection passed; fixtures rolled back' as result;
