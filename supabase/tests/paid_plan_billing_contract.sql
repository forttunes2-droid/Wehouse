begin;
set local session_replication_role=replica;
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('99800000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','billing-'||n||'@example.invalid',now(),now() from generate_series(1,2)n;
insert into public.profiles(auth_id,email,user_id,role,profile_complete)
select '99800000-0000-4000-8000-00000000000'||n,'billing-'||n||'@example.invalid','billing-'||n,'user',true from generate_series(1,2)n;
insert into auth.sessions(id,user_id,created_at,updated_at)
select auth_id::uuid,auth_id::uuid,now(),now() from public.profiles where user_id in('billing-1','billing-2');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select user_id,auth_id,auth_id,'billing-'||user_id,'Synthetic trusted browser',true,'trusted' from public.profiles where user_id in('billing-1','billing-2');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values('billing-1','worker','global','active');
insert into public.worker_pro_subscriptions(worker_id,provider,product_id,provider_subscription_id,status,current_period_start,current_period_end,price_amount,currency,environment,last_verified_at,last_provider_event_at)
values('billing-1','paystack','PLN_fixture','SUB_fixture_private_reference','active',now(),now()+interval '1 month',4200,'NGN','sandbox',now(),now());
insert into public.booking_payments(id,payment_reference,user_id,type,purpose,status,amount,currency)
values('99800000-1000-4000-8000-000000000001','BILLING-PREPAID-FIXTURE','billing-1','apartment','partner_pro_access','paid',4200,'NGN');
insert into public.partner_pro_entitlements(partner_id,current_period_end,last_payment_id) values('billing-1',now()+interval '1 month','99800000-1000-4000-8000-000000000001');
insert into private.workspace_restrictions(user_id,workspace,restricted,public_reason,changed_by) values('billing-1','worker',true,'Synthetic Services-only restriction','billing-2');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"99800000-0000-4000-8000-000000000001","session_id":"99800000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare r jsonb;begin
 r:=public.get_my_paid_plan_billing();
 if r->>'user_id'<>'billing-1' or jsonb_array_length(r->'plans')<>2 or r#>>'{plans,0,provider}'<>'paystack' or r#>>'{plans,0,can_manage}'<>'true'
  or r#>>'{plans,0,workspace_access}'<>'false' or r#>>'{plans,0,status}'<>'active' or r#>>'{plans,1,auto_renews}'<>'false' then raise exception 'Restricted workspace lost owner billing or changed prepaid contract';end if;
 if r::text like '%SUB_fixture%' or r::text like '%99800000%' then raise exception 'Private provider reference or Auth identity exposed';end if;
 begin perform public.get_my_worker_pro();raise exception 'FAIL: billing access restored Worker tools';exception when raise_exception then if sqlerrm<>'Active Worker workspace required' then raise;end if;end;
 if has_function_privilege('anon','public.get_my_paid_plan_billing()','EXECUTE') then raise exception 'Anonymous billing exposed';end if;
end $$;
reset role;
do $$begin
 if not exists(select 1 from private.workspace_restrictions where user_id='billing-1' and workspace='worker' and restricted)
 or not exists(select 1 from public.worker_pro_subscriptions where worker_id='billing-1' and status='active') then raise exception 'Billing read mutated access or subscription';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"99800000-0000-4000-8000-000000000002","session_id":"99800000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$declare r jsonb;begin r:=public.get_my_paid_plan_billing();if r->>'user_id'<>'billing-2' or r->'plans'<>'[]'::jsonb then raise exception 'Another person read owner subscriptions';end if;end $$;
reset role;
update public.user_sessions set is_active=false where user_id='billing-2';
set local role authenticated;
do $$begin begin perform public.get_my_paid_plan_billing();raise exception 'FAIL: ended device read billing';exception when insufficient_privilege then null;end;end $$;
reset role;
rollback;
select 'Existing owner billing remains separate from restricted tools; private references and ended/unrelated sessions denied; fixtures rolled back' result;
