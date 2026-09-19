\set ON_ERROR_STOP on
begin;

-- Isolated fixtures only. The transaction rolls back without publishing terms.
set local session_replication_role=replica;
update public.creator_policy_versions set status='retired'
where policy_key in ('legal_privacy','legal_terms') and status='active';
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind)
values('77777777-7777-4777-8777-777777777777','legal-fixture@example.invalid','legal-fixture','user',false,'consumer');
insert into public.profile_age_eligibility(user_id,date_of_birth,verified_at,updated_at) values('legal-fixture','2000-01-01',now(),now());
set local session_replication_role=origin;

do $$ begin
  if not (public.require_reviewed_legal_signup('{"user":{}}')->'error'->>'message' like 'Registration is unavailable%') then
    raise exception 'Unpublished legal documents must block identity creation';
  end if;
  begin
    update public.profiles set profile_complete=true where user_id='legal-fixture';
    raise exception 'FAIL: profile completed without documents';
  exception when others then
    if sqlerrm like 'FAIL:%' or sqlerrm not like 'Review and confirm both%' then raise; end if;
  end;
end $$;

set local session_replication_role=replica;
insert into public.creator_policy_versions(policy_version_id,policy_key,version,value,status,effective_from,public_disclosure,legal_review_state,reason,checksum)
values
('77777777-1111-4111-8111-777777777777','legal_privacy',999001,'{"title":"Test policy","body":"Synthetic test fixture; not a legal policy","locale":"en-NG","review_reference":"rollback-fixture"}','active',now()-interval '1 hour',true,'reviewed','Rollback-only test','privacy-checksum'),
('77777777-2222-4222-8222-777777777777','legal_terms',999001,'{"title":"Test terms","body":"Synthetic test fixture; not legal terms","locale":"en-NG","review_reference":"rollback-fixture"}','active',now()-interval '1 hour',true,'reviewed','Rollback-only test','terms-checksum');
set local session_replication_role=origin;

-- Exercise the same database role as the hosted Auth hook.
set local role supabase_auth_admin;
do $$ declare event jsonb; begin
  if public.require_reviewed_legal_signup('{"user":{"app_metadata":{"provider":"google"}}}')->'error' is null then
    raise exception 'Direct OAuth account creation must not skip legal review';
  end if;
  event := jsonb_build_object('user',jsonb_build_object('user_metadata',jsonb_build_object('legal_review',jsonb_build_object(
    'privacy',jsonb_build_object('policy_version_id','77777777-1111-4111-8111-777777777777','checksum','privacy-checksum'),
    'terms',jsonb_build_object('policy_version_id','77777777-2222-4222-8222-777777777777','checksum','terms-checksum')))));
  if public.require_reviewed_legal_signup(event) <> '{}'::jsonb then raise exception 'Current declarations must pass signup hook'; end if;
  event := jsonb_set(event,'{user,user_metadata,legal_review,terms,checksum}','"stale"');
  if public.require_reviewed_legal_signup(event)->'error' is null then raise exception 'Stale declaration passed signup hook'; end if;
end $$;
reset role;

select set_config('request.jwt.claims','{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  if has_function_privilege(current_user,'public.accept_current_legal(text)','execute') then raise exception 'Blind legacy acceptance still callable'; end if;
  if has_function_privilege(current_user,'public.require_reviewed_legal_signup(jsonb)','execute') then raise exception 'Auth hook exposed as client RPC'; end if;
  begin
    perform public.accept_reviewed_legal('privacy','77777777-1111-4111-8111-777777777777','wrong-checksum');
    raise exception 'FAIL: wrong checksum accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' or sqlerrm not like 'Review the current%' then raise; end if;
  end;
  begin
    perform public.accept_reviewed_legal('privacy',null,null);
    raise exception 'FAIL: null document accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' or sqlerrm not like 'Review the current%' then raise; end if;
  end;
  perform public.accept_reviewed_legal('privacy','77777777-1111-4111-8111-777777777777','privacy-checksum');
  begin
    update public.profiles set profile_complete=true where user_id='legal-fixture';
    raise exception 'FAIL: profile completed with only one receipt';
  exception when others then
    if sqlerrm like 'FAIL:%' or sqlerrm not like 'Review and confirm both%' then raise; end if;
  end;
  perform public.accept_reviewed_legal('terms','77777777-2222-4222-8222-777777777777','terms-checksum');
  perform public.accept_reviewed_legal('terms','77777777-2222-4222-8222-777777777777','terms-checksum');
  if (select count(*) from public.policy_acceptance_receipts where user_id='legal-fixture') <> 2 then raise exception 'Receipt retry was not idempotent'; end if;
  update public.profiles set profile_complete=true where user_id='legal-fixture';
  if not (select profile_complete from public.profiles where user_id='legal-fixture') then raise exception 'Valid setup failed'; end if;
end $$;
reset role;
rollback;
