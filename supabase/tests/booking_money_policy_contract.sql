\set ON_ERROR_STOP on
begin;

set local session_replication_role=replica;
insert into auth.users(id,email,email_confirmed_at,aud,role)
values(
  '77777777-9999-4999-8999-000000000001',
  'creator-money-policy@example.invalid',
  now(),'authenticated','authenticated'
);
insert into public.profiles(
  auth_id,email,user_id,role,profile_complete,account_kind
) values(
  '77777777-9999-4999-8999-000000000001',
  'creator-money-policy@example.invalid',
  'creator-money-policy','creator',true,'consumer'
);
insert into public.workspace_role_assignments(
  user_id,workspace_role,scope_type,status
) values(
  'creator-money-policy','creator','global','active'
);
insert into public.creator_elevation_grants(
  creator_elevation_id,creator_user_id,auth_user_id,auth_session_id,
  action_classes,issued_at,expires_at,verification_method
) values(
  '77777777-9999-4999-8999-000000000099',
  'creator-money-policy',
  '77777777-9999-4999-8999-000000000001',
  'creator-money-policy-session',
  array['policy_publish']::text[],
  now(),now()+interval '10 minutes','password'
);
set local session_replication_role=origin;

select set_config(
  'request.jwt.claims',
  '{"sub":"77777777-9999-4999-8999-000000000001","role":"authenticated","session_id":"creator-money-policy-session"}',
  true
);
set local role authenticated;

do $$
declare
  rules jsonb;
begin
  rules:=public.creator_get_booking_money_rules();
  if rules->>'source_of_truth'<>'creator_policy_versions'
     or coalesce((rules->>'finance_is_read_only')::boolean,false) is distinct from true then
    raise exception 'Creator money rules exposed a second authority';
  end if;
  if rules#>>'{active,short_let_reservation_hold,value,minutes}'<>'30' then
    raise exception 'Short Let reserve-date hold is not 30 minutes';
  end if;
  if rules#>>'{active,long_let_reservation_fee,value,amount}'<>'10000' then
    raise exception 'Long Let reservation amount is not NGN 10,000';
  end if;
  if rules#>>'{active,short_let_caution_cap,value,maximum_nights}'<>'1' then
    raise exception 'Short Let refundable security deposit is not capped at one night';
  end if;
  if rules#>>'{active,future_long_let_installments,value,enabled}'<>'false' then
    raise exception 'Long Let installments are enabled at launch';
  end if;
  if rules#>>'{active,commission_short_let,value,percent}'<>'10'
     or rules#>>'{active,commission_long_let,value,percent}'<>'5'
     or rules#>>'{active,commission_hotel,value,percent}'<>'12'
     or rules#>>'{active,commission_worker,value,percent}'<>'8' then
    raise exception 'Canonical commission bundle is inconsistent';
  end if;

  if public.calculate_commission(10000,'short_let')<>1000
     or public.calculate_commission(10000,'long_let')<>500
     or public.calculate_commission(10000,'hotel')<>1200
     or public.calculate_commission(10000,'service_worker')<>800 then
    raise exception 'Commission calculator ignored canonical product policies';
  end if;

  begin
    perform public.calculate_commission(10000,'property');
    raise exception 'FAIL: ambiguous apartment commission remained valid';
  exception when others then
    if sqlerrm like 'FAIL:%'
       or sqlerrm not like '%Commission type must be%' then
      raise;
    end if;
  end;
end
$$;

select public.creator_publish_booking_money_rules(
  '77777777-9999-4999-8999-000000000099',
  jsonb_build_object(
    'short_let',jsonb_build_object(
      'reservation_hold_minutes',30,
      'full_refund_hours_before_check_in',48,
      'late_cancel_max_nights',1,
      'no_show_max_nights',1,
      'security_deposit_enabled',true,
      'security_deposit_max_nights',1,
      'partner_claim_hours',24,
      'guest_response_hours',48,
      'arrival_issue_hours',2
    ),
    'long_let',jsonb_build_object(
      'reservation_amount',10000,
      'payment_hold_minutes',30,
      'hold_hours',72,
      'full_refund_hours',24,
      'installments_enabled',false,
      'security_deposit_enabled',false
    ),
    'commissions',jsonb_build_object(
      'short_let_percent',10,
      'long_let_percent',5,
      'hotel_percent',12,
      'service_worker_percent',8
    ),
    'service_worker',jsonb_build_object(
      'completion_reminder_hours',12,
      'release_eligible_hours',24
    )
  ),
  now(),
  'Rollback-only canonical policy contract'
);

do $$
begin
  if exists(
    select 1 from public.platform_settings
    where key in(
      'reservation_fee','apartment_payment_hold_minutes',
      'worker_commission_rate','commission_hotel',
      'commission_apartment','commission_rate_listing',
      'property_commission','commission_rate_partner',
      'partner_commission_rate','commission_worker',
      'commission_rate_worker','hotel_commission','commission_rate_hotel',
      'apartment_reservation_fee'
    )
    and coalesce(editable,true)
  ) then
    raise exception 'Legacy money setting remained Creator-editable';
  end if;
end
$$;

reset role;

-- Ordinary authenticated accounts never get Creator policy controls.
set local session_replication_role=replica;
insert into auth.users(id,email,email_confirmed_at,aud,role)
values(
  '77777777-9999-4999-8999-000000000002',
  'ordinary-money-policy@example.invalid',
  now(),'authenticated','authenticated'
);
insert into public.profiles(
  auth_id,email,user_id,role,profile_complete,account_kind
) values(
  '77777777-9999-4999-8999-000000000002',
  'ordinary-money-policy@example.invalid',
  'ordinary-money-policy','user',true,'consumer'
);
set local session_replication_role=origin;

select set_config(
  'request.jwt.claims',
  '{"sub":"77777777-9999-4999-8999-000000000002","role":"authenticated","session_id":"ordinary-money-policy-session"}',
  true
);
set local role authenticated;

do $$
declare denied boolean:=false;
begin
  begin
    perform public.creator_get_booking_money_rules();
  exception when others then
    denied:=sqlerrm='Active Creator workspace required';
  end;
  if not denied then raise exception 'Ordinary account read Creator money rules'; end if;

  if has_function_privilege('anon','public.creator_get_booking_money_rules()','execute')
     or has_function_privilege(
       'anon',
       'public.creator_publish_booking_money_rules(uuid,jsonb,timestamptz,text)',
       'execute'
     ) then
    raise exception 'Anonymous Creator money policy access exists';
  end if;
end
$$;

rollback;
