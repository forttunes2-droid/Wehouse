\set ON_ERROR_STOP on

begin;

-- Fixed synthetic records keep this contract independent of seed data. FK
-- triggers are suspended only while the isolated fixtures are inserted; the
-- authorization and reservation triggers run in normal mode below.
set local session_replication_role=replica;

insert into public.profiles(auth_id,email,user_id) values
  ('test-auth-user','test-user@example.invalid','test-user'),
  ('test-auth-peer','test-peer@example.invalid','test-peer'),
  ('test-auth-payee','test-payee@example.invalid','test-payee');

insert into public.ledger_transactions(
  ledger_transaction_id,idempotency_key,transaction_type,currency,
  reference_type,reference_id,provider_event_id,payload_checksum
) values
  ('10000000-0000-0000-0000-000000000001','test-ledger-direct','provider_charge','NGN','booking_payment','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  ('10000000-0000-0000-0000-000000000002','test-ledger-shared-1','provider_charge','NGN','booking_payment','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  ('10000000-0000-0000-0000-000000000003','test-ledger-shared-2','provider_charge','NGN','booking_payment','30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'),
  ('10000000-0000-0000-0000-000000000004','test-ledger-long','provider_charge','NGN','booking_payment','30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000004','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'),
  ('10000000-0000-0000-0000-000000000005','test-ledger-long-released','provider_charge','NGN','booking_payment','30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000005','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');

insert into public.verified_provider_events(
  provider_event_id,provider,provider_event_key,event_type,provider_reference,
  payload_sha256,signature_verified_at,processed_at,processing_status
) values
  ('20000000-0000-0000-0000-000000000001','paystack','charge.success:direct','charge.success','TEST-DIRECT','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',now(),now(),'processed'),
  ('20000000-0000-0000-0000-000000000002','paystack','charge.success:shared-1','charge.success','TEST-SHARED-1','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',now(),now(),'processed'),
  ('20000000-0000-0000-0000-000000000003','paystack','charge.success:shared-2','charge.success','TEST-SHARED-2','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',now(),now(),'processed'),
  ('20000000-0000-0000-0000-000000000004','paystack','charge.success:long','charge.success','TEST-LONG','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',now(),now(),'processed'),
  ('20000000-0000-0000-0000-000000000005','paystack','charge.success:long-released','charge.success','TEST-LONG-RELEASED','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',now(),now(),'processed');

insert into public.booking_payments(
  id,payment_reference,user_id,payer_user_id,amount,amount_total,currency,
  status,purpose,paystack_reference,listing_id,verified_amount,verified_at,
  verification_source,paid_at,webhook_processed,metadata
) values
  ('30000000-0000-0000-0000-000000000001','TEST-DIRECT','test-user','test-user',100,100,'NGN','paid','apartment_rent','TEST-DIRECT','test-listing',100,now(),'webhook',now(),true,'{"reservation_id":"test-short","listing_id":"test-listing","payment_component":"short_stay_rent"}'::jsonb),
  ('30000000-0000-0000-0000-000000000002','TEST-SHARED-1','test-user','test-user',50,50,'NGN','paid','shared_housing_share','TEST-SHARED-1','test-listing',50,now(),'webhook',now(),true,'{"canonical_shared_payment_group_id":"40000000-0000-0000-0000-000000000001","canonical_shared_payment_member_id":"50000000-0000-0000-0000-000000000001"}'::jsonb),
  ('30000000-0000-0000-0000-000000000003','TEST-SHARED-2','test-peer','test-peer',50,50,'NGN','paid','shared_housing_share','TEST-SHARED-2','test-listing',50,now(),'webhook',now(),true,'{"canonical_shared_payment_group_id":"40000000-0000-0000-0000-000000000001","canonical_shared_payment_member_id":"50000000-0000-0000-0000-000000000002"}'::jsonb),
  ('30000000-0000-0000-0000-000000000004','TEST-LONG','test-user','test-user',200,200,'NGN','paid','apartment_rent','TEST-LONG','test-long-listing',200,now(),'webhook',now(),true,'{"reservation_id":"test-long","listing_id":"test-long-listing","payment_component":"long_stay_rent"}'::jsonb),
  ('30000000-0000-0000-0000-000000000005','TEST-LONG-RELEASED','test-user','test-user',200,200,'NGN','paid','apartment_rent','TEST-LONG-RELEASED','test-long-released-listing',200,now(),'webhook',now(),true,'{"reservation_id":"test-long-released","listing_id":"test-long-released-listing","payment_component":"long_stay_rent"}'::jsonb);

insert into public.payment_protection_transactions(
  id,booking_type,payer_user_id,payee_user_id,amount_total,amount_commission,
  amount_payee,commission_rate,status,paystack_reference,protection_state,
  subject_type,subject_id,protected_ledger_transaction_id
) values
  ('60000000-0000-0000-0000-000000000001','short_let_stay','test-user','test-payee',100,10,90,10,'protected','TEST-DIRECT','protected','short_let_stay','test-short','10000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000002','short_let_stay','test-user','test-payee',50,5,45,10,'protected','TEST-SHARED-1','protected','short_let_stay','shared:50000000-0000-0000-0000-000000000001:stay:1','10000000-0000-0000-0000-000000000002'),
  ('60000000-0000-0000-0000-000000000003','short_let_stay','test-peer','test-payee',50,5,45,10,'protected','TEST-SHARED-2','protected','short_let_stay','shared:50000000-0000-0000-0000-000000000002:stay:1','10000000-0000-0000-0000-000000000003'),
  ('60000000-0000-0000-0000-000000000004','long_let_year_one','test-user','test-payee',200,20,180,10,'protected','TEST-LONG','protected','long_let_year_one','test-long','10000000-0000-0000-0000-000000000004'),
  ('60000000-0000-0000-0000-000000000005','long_let_year_one','test-user','test-payee',200,20,180,10,'released','TEST-LONG-RELEASED','released','long_let_year_one','test-long-released','10000000-0000-0000-0000-000000000005');

insert into public.shared_payment_groups(
  shared_payment_group_id,product_type,listing_id,reservation_id,created_by,
  total_amount,capacity,status
) values(
  '40000000-0000-0000-0000-000000000001','short_let','test-listing',
  'test-shared','test-user',100,2,'fully_paid'
);

insert into public.shared_payment_members(
  shared_payment_member_id,shared_payment_group_id,user_id,share_amount,
  invitation_state,payment_state,provider_reference
) values
  ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','test-user',50,'accepted','paid','TEST-SHARED-1'),
  ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','test-peer',50,'accepted','paid','TEST-SHARED-2');

insert into public.shared_payment_protection_components(
  shared_payment_group_id,shared_payment_member_id,payment_protection_id,
  component_type,amount,provider_reference
) values
  ('40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002','short_let_stay',50,'TEST-SHARED-1'),
  ('40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000003','short_let_stay',50,'TEST-SHARED-2');

set local session_replication_role=origin;

do $$
declare decision jsonb;
begin
  decision:=public.accommodation_access_authorization(
    'test-short','test-listing','test-user','short_let','ready_for_move_in','paid',now(),
    'paid',now(),'TEST-DIRECT','60000000-0000-0000-0000-000000000001',
    null,null,100,'handover'
  );
  if not coalesce((decision->>'authorized')::boolean,false) then
    raise exception 'Expected canonical direct payment to authorize: %',decision;
  end if;

  decision:=public.accommodation_access_authorization(
    'test-short','test-listing','test-user','short_let','ready_for_move_in','paid',now(),
    'paid',now(),'WRONG-REFERENCE','60000000-0000-0000-0000-000000000001',
    null,null,100,'handover'
  );
  if coalesce((decision->>'authorized')::boolean,false) then
    raise exception 'A mismatched payment reference authorized handover';
  end if;

  decision:=public.accommodation_access_authorization(
    'test-short','wrong-listing','test-user','short_let','ready_for_move_in','paid',now(),
    'paid',now(),'TEST-DIRECT','60000000-0000-0000-0000-000000000001',
    null,null,100,'handover'
  );
  if coalesce((decision->>'authorized')::boolean,false) then
    raise exception 'A payment for another listing authorized handover';
  end if;

  decision:=public.accommodation_access_authorization(
    'test-long','test-long-listing','test-user','long_stay','ready_for_move_in','paid',now(),
    'paid',now(),'TEST-LONG',null,
    '60000000-0000-0000-0000-000000000004',null,200,'handover'
  );
  if not coalesce((decision->>'authorized')::boolean,false) then
    raise exception 'Expected canonical Long Let payment to authorize: %',decision;
  end if;

  decision:=public.accommodation_access_authorization(
    'test-long-released','test-long-released-listing','test-user','long_stay',
    'occupied','paid',now(),'paid',now(),'TEST-LONG-RELEASED',null,
    '60000000-0000-0000-0000-000000000005',null,200,'location'
  );
  if not coalesce((decision->>'authorized')::boolean,false) then
    raise exception 'A valid occupied Long Let lost access after release: %',decision;
  end if;

  decision:=public.accommodation_access_authorization(
    'test-long-released','test-long-released-listing','test-user','long_stay',
    'ready_for_move_in','paid',now(),'paid',now(),'TEST-LONG-RELEASED',null,
    '60000000-0000-0000-0000-000000000005',null,200,'handover'
  );
  if coalesce((decision->>'authorized')::boolean,false) then
    raise exception 'Released funds authorized a new Long Let handover';
  end if;

  decision:=public.accommodation_access_authorization(
    'test-shared','test-listing','test-user','short_let','reserved','paid',now(),
    'paid',now(),null,null,null,
    '40000000-0000-0000-0000-000000000001',100,'handover'
  );
  if not coalesce((decision->>'authorized')::boolean,false) then
    raise exception 'Expected complete shared protection to authorize: %',decision;
  end if;

  update public.shared_payment_members set payment_state='not_started'
  where shared_payment_member_id='50000000-0000-0000-0000-000000000002';
  decision:=public.accommodation_access_authorization(
    'test-shared','test-listing','test-user','short_let','reserved','paid',now(),
    'paid',now(),null,null,null,
    '40000000-0000-0000-0000-000000000001',100,'handover'
  );
  if coalesce((decision->>'authorized')::boolean,false) then
    raise exception 'An accepted but unpaid shared member authorized handover';
  end if;
  update public.shared_payment_members set payment_state='paid'
  where shared_payment_member_id='50000000-0000-0000-0000-000000000002';
end;
$$;

create temp table accommodation_guard_probe(
  id text,
  listing_id text,
  user_id text,
  stay_type text,
  status text,
  canonical_state text,
  requested_move_in_at timestamptz,
  occupancy_started_at timestamptz,
  tenancy_start_date date,
  checked_in_at timestamptz,
  verified_handover_at timestamptz,
  handover_confirmed_by_customer_at timestamptz,
  manual_payment_status text,
  paid_at timestamptz,
  rent_payment_status text,
  rent_paid_at timestamptz,
  rent_payment_reference text,
  stay_payment_protection_id uuid,
  year_one_rent_protection_id uuid,
  shared_payment_group_id uuid,
  stay_rent_total numeric,
  upfront_rent_required numeric,
  annual_rent_snapshot numeric
);

create trigger accommodation_guard_probe_trigger
before insert or update on accommodation_guard_probe
for each row execute function public.enforce_protected_accommodation_handover();

insert into accommodation_guard_probe(
  id,listing_id,user_id,stay_type,status,requested_move_in_at,
  manual_payment_status,paid_at,rent_payment_status,rent_paid_at,
  rent_payment_reference,stay_payment_protection_id,stay_rent_total
) values(
  'test-short','test-listing','test-user','short_let','ready_for_move_in',now(),
  'paid',now(),'paid',now(),'TEST-DIRECT',
  '60000000-0000-0000-0000-000000000001',100
);

insert into accommodation_guard_probe(
  id,listing_id,user_id,stay_type,status,requested_move_in_at,
  manual_payment_status,paid_at,rent_payment_status,rent_paid_at,
  rent_payment_reference,year_one_rent_protection_id,upfront_rent_required
) values(
  'test-long','test-long-listing','test-user','long_stay','ready_for_move_in',now(),
  'paid',now(),'paid',now(),'TEST-LONG',
  '60000000-0000-0000-0000-000000000004',200
);

do $$
declare rejected boolean:=false;
begin
  begin
    update accommodation_guard_probe set listing_id='wrong-listing'
    where id='test-short';
  exception when others then
    rejected:=position('Current Payment Protection is required' in sqlerrm)>0;
  end;
  if not rejected then
    raise exception 'A protected reservation was moved to an unpaid listing';
  end if;

  rejected:=false;
  begin
    update accommodation_guard_probe set stay_rent_total=101
    where id='test-short';
  exception when others then
    rejected:=position('Current Payment Protection is required' in sqlerrm)>0;
  end;
  if not rejected then
    raise exception 'A protected Short Let amount changed after access began';
  end if;

  rejected:=false;
  begin
    insert into accommodation_guard_probe(
      id,listing_id,user_id,stay_type,status,canonical_state,checked_in_at,
      manual_payment_status,paid_at,rent_payment_status,rent_paid_at,
      rent_payment_reference,stay_rent_total
    ) values(
      'missing-protection','test-listing','test-user','short_let','reserved','checked_in',now(),
      'paid',now(),'paid',now(),'TEST-DIRECT',100
    );
  exception when others then
    rejected:=position('Current Payment Protection is required' in sqlerrm)>0;
  end;
  if not rejected then
    raise exception 'checked_in_at bypassed the Payment Protection guard';
  end if;

  rejected:=false;
  begin
    insert into accommodation_guard_probe(
      id,listing_id,user_id,stay_type,status,canonical_state,verified_handover_at,
      manual_payment_status,paid_at,rent_payment_status,rent_paid_at,
      rent_payment_reference,upfront_rent_required
    ) values(
      'missing-long-protection','test-long-listing','test-user','long_stay',
      'ready_for_move_in','handover_verified',now(),
      'paid',now(),'paid',now(),'TEST-LONG',200
    );
  exception when others then
    rejected:=position('Current Payment Protection is required' in sqlerrm)>0;
  end;
  if not rejected then
    raise exception 'verified_handover_at bypassed the Long Let Payment Protection guard';
  end if;

  rejected:=false;
  begin
    insert into accommodation_guard_probe(id,listing_id,user_id,stay_type,status,canonical_state)
    values('terminal-bypass','test-listing','test-user','short_let','completed','completed');
  exception when others then
    rejected:=position('cannot complete before recorded occupancy' in sqlerrm)>0;
  end;
  if not rejected then
    raise exception 'A terminal reservation was inserted without occupancy';
  end if;
end;
$$;

rollback;
