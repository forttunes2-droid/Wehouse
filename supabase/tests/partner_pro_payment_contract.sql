\set ON_ERROR_STOP on
begin;
do $
declare v_overloads integer;
begin
  select count(*) into v_overloads
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='create_my_partner_pro_payment';
  if v_overloads <> 1 then
    raise exception 'Expected one canonical Partner Pro checkout RPC; found % overloads',v_overloads;
  end if;
end $;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete)
values ('76666666-0000-4000-8000-000000000003','pro-buyer@example.invalid','pro-buyer','property_partner',true);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status)
values ('pro-buyer','property_partner','global','active');
update public.platform_settings set value='5000' where key='partner_pro_monthly_price_ngn';
update public.platform_settings set value='45000' where key='partner_pro_yearly_price_ngn';
update public.platform_settings set value='payment-contract-v1' where key='partner_pro_terms_version';
update public.platform_settings set value=repeat('These prepaid tools are available for one month or one year and do not renew automatically. ',2)
where key='partner_pro_terms_content';
update public.platform_settings set value='true' where key='partner_pro_sales_enabled';
select set_config('request.jwt.claim.sub','76666666-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$
declare v jsonb;
begin
  if (public.get_my_partner_pro()->>'active')::boolean then raise exception 'Unpaid plan active'; end if;
  begin
    perform public.create_my_partner_pro_payment('monthly');
    raise exception 'Terms bypassed';
  exception when others then
    if sqlerrm='Terms bypassed' then raise; end if;
  end;
  if not public.accept_my_partner_pro_terms() then raise exception 'Terms acceptance failed'; end if;
  v:=public.create_my_partner_pro_payment('monthly');
  if (v->>'reference') !~ '^WHPP-' then raise exception 'Payment reference missing: %',v; end if;
  if (public.create_my_partner_pro_payment('monthly')->>'reference') is distinct from v->>'reference' then
    raise exception 'Pending checkout was duplicated'; end if;
end $$;
reset role;
do $$
declare p public.booking_payments; v jsonb; v_end timestamptz;
begin
  select * into p from public.booking_payments where user_id='pro-buyer' and purpose='partner_pro_access';
  if p.amount_total<>5000 or p.metadata->>'terms_version'<>'payment-contract-v1' then
    raise exception 'Price or terms snapshot missing'; end if;
  update public.booking_payments set metadata=metadata||'{"paystack_environment":"test"}'::jsonb where id=p.id;
  perform set_config('request.jwt.claim.role','service_role',true);
  v:=public.confirm_partner_pro_paystack_charge(p.paystack_reference,'test-provider-1001',500000,'test','edge_function');
  if not (v->>'success')::boolean then raise exception 'Verified charge did not grant access: %',v; end if;
  v_end:=(v->>'current_period_end')::timestamptz;
  v:=public.confirm_partner_pro_paystack_charge(p.paystack_reference,'test-provider-1001',500000,'test','webhook');
  if not (v->>'already_processed')::boolean then raise exception 'Webhook replay extended access'; end if;
  if (select current_period_end from public.partner_pro_entitlements where partner_id='pro-buyer') is distinct from v_end then
    raise exception 'Idempotent receipt changed the paid period'; end if;
end $$;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
begin
  if not (public.get_my_partner_pro()->>'active')::boolean then raise exception 'Paid access missing'; end if;
  if jsonb_array_length(public.get_my_partner_pro_overview()->'assets')<>0 then raise exception 'Unexpected portfolio data'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.role','service_role',true);
set local session_replication_role=origin;
do $$
declare p public.booking_payments; v jsonb; v_end timestamptz;
begin
  select * into p from public.booking_payments where user_id='pro-buyer' and purpose='partner_pro_access';
  v_end:=(select current_period_end from public.partner_pro_entitlements where partner_id='pro-buyer');
  if not public.pause_partner_pro_on_provider_event(p.paystack_reference,'refund.pending','test','refund:test-provider-1001') then
    raise exception 'Provider review did not find Partner payment'; end if;
  if public.partner_pro_is_active('pro-buyer') then raise exception 'Refund did not pause access'; end if;
  perform set_config('request.jwt.claim.role','authenticated',true);
  if not (public.get_my_partner_pro()->>'under_review')::boolean then raise exception 'Review is not visible to Partner'; end if;
  begin
    perform public.create_my_partner_pro_payment('monthly');
    raise exception 'Checkout bypassed payment review';
  exception when others then
    if sqlerrm='Checkout bypassed payment review' then raise; end if;
  end;
  perform set_config('request.jwt.claim.role','service_role',true);
  perform public.pause_partner_pro_on_provider_event(p.paystack_reference,'refund.pending','test','refund:test-provider-1001');
  if (select count(*) from public.partner_pro_provider_events where payment_id=p.id)<>1 then
    raise exception 'Provider event replay created a duplicate'; end if;
  if not public.resolve_partner_pro_provider_review('pro-buyer',true,'Provider confirmed dispute was cleared') then
    raise exception 'Review resolution failed'; end if;
  if (select review_started_at from public.partner_pro_entitlements where partner_id='pro-buyer') is not null then
    raise exception 'Review resolution left the pause in place'; end if;
  if (select current_period_end from public.partner_pro_entitlements where partner_id='pro-buyer') is distinct from v_end then
    raise exception 'Review restore changed the paid expiry'; end if;
end $$;
do $$
declare p public.booking_payments;
begin
  if not public.partner_pro_is_active('pro-buyer') then raise exception 'Resolved review did not restore access'; end if;
  select * into p from public.booking_payments where user_id='pro-buyer' and purpose='partner_pro_access';
  perform public.pause_partner_pro_on_provider_event(p.paystack_reference,'refund.processed','test','refund:processed:1001');
  perform public.resolve_partner_pro_provider_review('pro-buyer',false,'Provider processed full refund for purchase');
  if (select current_period_end from public.partner_pro_entitlements where partner_id='pro-buyer')>now() then
    raise exception 'Refund resolution left paid period'; end if;
end $$;
rollback;
