begin;
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description;end if;end$$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$begin execute statement;return false;exception when others then return true;end$$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.rejects(text) to authenticated,anon;
create temp table space_booking_probe(id text,listing_id text,listing_title text default 'Contract home',status text,stay_type text,stay_check_in date,stay_check_out date,physical_space_id uuid,physical_unit_id uuid);
create trigger space_booking_probe_guard before insert or update on space_booking_probe for each row execute function private.guard_physical_space_occupancy();
grant select,insert,update on space_booking_probe to authenticated;
do $$
declare discount_receipt uuid; au uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();person text:='space-check-'||au;
 outsider uuid:=gen_random_uuid(); batch uuid:=gen_random_uuid();site uuid:=gen_random_uuid();unit_a uuid:=gen_random_uuid();unit_b uuid:=gen_random_uuid();room uuid:=gen_random_uuid();
 challenge uuid;items jsonb:='[]';item jsonb;receipt jsonb;spec jsonb;req uuid;listing uuid:=gen_random_uuid();i integer;revision bigint; booking_ids uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()]; doc_rule jsonb; booking jsonb; second_booking jsonb; guest_sid uuid:=gen_random_uuid();history_row public.reservations;history_ids text[]:=array[]::text[];h_i integer;field_auth uuid:=gen_random_uuid();field_sid uuid:=gen_random_uuid();field_person text;first_page jsonb;second_page jsonb;arrival_protection uuid:=gen_random_uuid();arrival_receipt public.reservations;arrival_started timestamptz;arrival_event uuid:=gen_random_uuid();arrival_ledger uuid:=gen_random_uuid();arrival_payment uuid:=gen_random_uuid();
begin
 insert into auth.users(id,aud,role,email,created_at,updated_at) values(au,'authenticated','authenticated',au||'@example.invalid',now(),now()),(outsider,'authenticated','authenticated',outsider||'@example.invalid',now(),now());
 insert into public.profiles(auth_id,email,user_id,role,profile_complete,full_name,state,city)
 values(au,au||'@example.invalid',person,'user',true,'Space contract','Nasarawa','Lafia'),
 (outsider,outsider||'@example.invalid','space-outsider-'||outsider,'user',true,'Space outsider','Nasarawa','Lafia');
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,au,now(),now());
 insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status) values(person,au,sid,'space-'||sid,'Browser',true,'trusted');
 insert into public.workspace_role_assignments(user_id,workspace_role,scope_type) values(person,'property_partner','global');
 insert into public.property_submission_batches(id,partner_user_id) values(batch,au::text);
 for i in 1..4 loop
  challenge:=gen_random_uuid();
  insert into public.property_access_challenges(id,partner_id,code,expires_at,status,video_path,submitted_at)
  values(challenge,person,'A0000'||i,now()+interval '20 minutes','submitted','contract-video-'||challenge,now());
  spec:=jsonb_build_object('site_id',site,'site_label','Contract compound','unit_id',case when i in(1,4)then unit_a else unit_b end,
   'unit_label',case when i in(1,4)then 'Home A' else 'Home B' end,'scope',case when i=3 then 'private_room' else 'entire_unit' end,
   'space_id',case when i=3 then room when i in(1,4)then unit_a else unit_b end,'space_label',case when i=3 then 'Room 1' else '' end,
   'layout_name',case when i in(1,4)then 'Self-contained' else 'Duplex' end,'shared_areas',case when i=3 then '["Kitchen","Entrance"]'::jsonb else '[]'::jsonb end);
  item:=jsonb_build_object('property_type','apartment','home_style',case when i in(1,4) then null else 'penthouse' end,'property_address','Contract address','property_city','Lafia','property_state','Nasarawa',
   'sub_type',case when i=1 then 'long_stay' else 'short_let' end,'bedrooms',case when i in(1,4)then 0 when i=2 then 3 else 1 end,
   'bathrooms',1,'expected_rent',600000,'max_guests',2,'property_display_name','Contract homes','management_mode','host','authority_relationship','owner',
   'access_challenge_id',challenge,'photo_urls','["contract-1","contract-2","contract-3","contract-4"]'::jsonb,'physical_space',spec);
  items:=items||jsonb_build_array(item);
  insert into public.property_submission_items(batch_id,position,property_type) values(batch,i-1,'apartment');
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',au,'session_id',sid,'role','authenticated')::text,true);
 for i in 0..3 loop
  items:=jsonb_set(items,array[i::text,'provider_fee_digest'],to_jsonb(public.get_provider_fee_disclosure(items->i->>'sub_type','host')->>'digest'));
 end loop;
 execute 'set local role authenticated';
 perform pg_temp.expect(pg_temp.rejects(format('select public.create_my_property_inspection_batch_v4(%L,%L::jsonb)',batch,jsonb_set(items,'{0,home_style}','"bungalow"'::jsonb)::text)),'removed property catalogue cannot enter through the submission API');
 receipt:=public.create_my_property_inspection_batch_v4(batch,items);
 perform pg_temp.expect(receipt->>'batch_id'=batch::text and (receipt->>'count')::integer=4,'one existing batch submits mixed layouts and terms');
 perform pg_temp.expect((public.get_my_property_submission_receipt(batch,items)->>'count')::integer=4,'a lost submission response can recover its existing receipt');
 perform pg_temp.expect((public.create_my_property_inspection_batch_v4(batch,items)->>'count')::integer=4,'same-payload retry returns the existing batch after evidence is consumed');
 perform pg_temp.expect(pg_temp.rejects(format('select public.get_my_property_submission_receipt(%L,%L::jsonb)',batch,(items||jsonb_build_array(items->0))::text)),'recovery cannot confirm changed property details');
 perform pg_temp.expect(pg_temp.rejects(format('update public.property_submission_batches set submitted_payload_sha256=%L where id=%L',repeat('a',64),batch)),'browser cannot replace server payload proof');
 perform pg_temp.expect(jsonb_array_length(public.get_my_property_space_options(null,null))=1,'owned compound can be reused in a later submission');
 perform pg_temp.expect(jsonb_array_length(public.get_my_property_space_options(site,null))=2,'owned home options do not duplicate the same unit across offers');
 perform pg_temp.expect(jsonb_array_length(public.get_my_property_space_options(unit_b,null))=1,'existing private room can be reused across offer terms');
 perform pg_temp.expect(pg_temp.rejects('select * from public.property_spaces'),'browser cannot read the private registry directly');
 perform pg_temp.expect(pg_temp.rejects(format('select private.ensure_submission_space(%L,%L,null,%L,%L,null,%L,%L,%L,%L)',person,gen_random_uuid(),'site','Injected','{}','Elsewhere','Lafia','Nasarawa')),'browser cannot invoke private registry writer');
 execute 'reset role';
 perform pg_temp.expect((select count(*)=2 from public.inspection_requests where submission_batch_id=batch and home_style='penthouse'),'home type survives authenticated submission into review');
 perform pg_temp.expect((select count(*)=4 from public.property_spaces where owner_user_id=person),'one compound, two independent homes and one private room without duplicate inventory');
 perform pg_temp.expect((select count(*)=2 from public.inspection_requests where submission_batch_id=batch and physical_space_id=unit_a),'Long Let and Short Let offers retain one physical unit');
 perform pg_temp.expect((select shared_areas=array['Kitchen','Entrance'] from public.inspection_requests where submission_batch_id=batch and physical_space_id=room),'private-room shared areas reach review');
 req:=(receipt->'requests'->0->>'id')::uuid;
 insert into public.listings(id,listing_id,title,price,sub_type,state,city,status,availability_status,inspection_request_id,partner_id)
 values(listing,listing::text,'Contract home',600000,'long_stay','Nasarawa','Lafia','pending_approval','pending_approval',req,person);
 perform pg_temp.expect((select home_style is null from public.listings where id=listing),'ordinary home does not acquire an invented catalogue type');
 update public.listings set home_style='penthouse' where id=listing;
 perform pg_temp.expect((select home_style is null from public.listings where id=listing),'listing cannot invent a feature outside its submission');
 perform pg_temp.expect((select owner_id=person and partner_id=person from public.listings where id=listing),'canonical Partner grant works while the main profile role is Personal');
 perform pg_temp.expect(pg_temp.rejects(format('update public.listings set partner_id=%L where id=%L','space-outsider-'||outsider,listing)),'a person without the Partner workspace cannot be assigned a listing');
 perform pg_temp.expect((select physical_space_id=unit_a and space_scope='entire_unit' and space_label='Home A' from public.listings where id=listing),'draft publication receives the reviewed physical identity');
 perform pg_temp.expect(pg_temp.rejects(format('update public.listings set physical_space_id=%L where id=%L',unit_b,listing)),'listing cannot switch to another physical unit');
 insert into space_booking_probe(id,listing_id,status,stay_type)values('probe',listing::text,'payment_pending','long_stay');
 perform pg_temp.expect((select physical_space_id=unit_a and physical_unit_id=unit_a from space_booking_probe where id='probe'),'real occupancy trigger binds the physical unit');
 perform pg_temp.expect((select listing_title='Contract home · Home A' from space_booking_probe where id='probe'),'booking snapshot identifies the selected physical home');
 select availability_revision into revision from public.property_spaces where id=unit_a;
 update space_booking_probe set status='cancelled' where id='probe';
 perform pg_temp.expect((select availability_revision=revision+1 from public.property_spaces where id=unit_a),'cancellation serializes availability changes');
 perform pg_temp.expect(private.property_spaces_overlap(unit_b,unit_b,room,'short_let','short_let',current_date,current_date+2,current_date+1,current_date+3),'whole home conflicts with contained room');
 perform pg_temp.expect(private.property_spaces_overlap(unit_b,room,unit_b,'short_let','short_let',current_date,current_date+2,current_date+1,current_date+3),'contained room conflicts with whole home');
 perform pg_temp.expect(not private.property_spaces_overlap(unit_b,room,gen_random_uuid(),'short_let','short_let',current_date,current_date+2,current_date+1,current_date+3),'independent sibling rooms remain independent');
 perform pg_temp.expect(not private.property_spaces_overlap(unit_b,room,room,'short_let','short_let',current_date,current_date+2,current_date+2,current_date+3),'checkout boundary permits next stay');
 perform pg_temp.expect(private.property_spaces_overlap(unit_a,unit_a,unit_a,'long_stay','short_let',null,null,current_date,current_date+2),'undated Long Let conservatively blocks conflicting Short Let');
 perform pg_temp.expect(pg_temp.rejects(format('select private.ensure_submission_space(%L,%L,%L,%L,%L,null,%L)','space-outsider-'||outsider,gen_random_uuid(),site,'unit','Injected','{}')),'another owner cannot attach a unit to this compound');

 -- Seed independently reviewed document/publication state; this contract tests customer booking,
 -- not the upload or Admin publication UI. No RLS or triggers are disabled.
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform set_config('wehouse.property_document_command','configure',true);
 for i in 2..4 loop
  req:=(receipt->'requests'->(i-1)->>'id')::uuid;
  update public.inspection_requests set status='completed',field_photo_urls=array['field-1','field-2','field-3','field-4'],
   document_requirements=public._default_property_document_requirements(property_type,sub_type),
   document_requirements_revision=1,document_requirements_set_by='space-outsider-'||outsider,
   document_requirements_set_at=now() where id=req;
  for doc_rule in select value from public.inspection_requests r,jsonb_array_elements(r.document_requirements) where r.id=req loop
   insert into public.property_submission_documents(request_id,requirement_code,requirements_revision,version,request_key,submitted_by,original_name,mime_type,byte_size,object_path,status,submitted_at,reviewed_at,reviewed_by,expires_at)
   values(req,doc_rule->>'code',1,1,gen_random_uuid(),person,'contract.pdf','application/pdf',10,'contract/'||gen_random_uuid(),'approved',now(),now(),'space-outsider-'||outsider,now()+interval '1 year');
  end loop;
  insert into public.listings(id,listing_id,title,price,sub_type,state,city,address,status,availability_status,inspection_request_id,partner_id,management_mode,management_host_user_id,management_updated_at,approved_by,approved_at,bedrooms,bathrooms,max_guests,amenities)
  values(booking_ids[i-1],booking_ids[i-1]::text,'Contract stay',10000,'short_let','Nasarawa','Lafia','Contract address','available','available',req,person,'host',person,now(),'space-outsider-'||outsider,now(),1,1,2,array['Furnished']);
 end loop;

 -- Publish the existing Long Let fixture for public cross-offer availability checks.
 req:=(receipt->'requests'->0->>'id')::uuid;
 update public.inspection_requests set status='completed',field_photo_urls=array['field-1','field-2','field-3','field-4'],
  document_requirements=public._default_property_document_requirements(property_type,sub_type),document_requirements_revision=1,
  document_requirements_set_by='space-outsider-'||outsider,document_requirements_set_at=now() where id=req;
 for doc_rule in select value from public.inspection_requests r,jsonb_array_elements(r.document_requirements) where r.id=req loop
  insert into public.property_submission_documents(request_id,requirement_code,requirements_revision,version,request_key,submitted_by,original_name,mime_type,byte_size,object_path,status,submitted_at,reviewed_at,reviewed_by,expires_at)
  values(req,doc_rule->>'code',1,1,gen_random_uuid(),person,'contract.pdf','application/pdf',10,'contract/'||gen_random_uuid(),'approved',now(),now(),'space-outsider-'||outsider,now()+interval '1 year');
 end loop;
 perform set_config('wehouse.management_rpc','allowed',true);
 update public.listings set title='Physical Long Let '||au,status='available',availability_status='available',approved_by='space-outsider-'||outsider,
  approved_at=now(),management_mode='host',management_host_user_id=person,management_updated_at=now(),bedrooms=0,bathrooms=1 where id=listing;
 perform set_config('wehouse.management_rpc','',true);
 perform set_config('wehouse.property_document_command','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',au,'session_id',sid,'role','authenticated')::text,true);
 execute 'set local role authenticated';

 execute 'reset role';
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
 execute 'set local role anon';
 first_page:=public.get_property_site_offers(listing);
 perform pg_temp.expect((first_page->>'grouped')::boolean and jsonb_array_length(first_page->'items')=3,'anonymous customer sees three other published offers in the same compound');
 perform pg_temp.expect(not(first_page->'items'->0?'address') and not(first_page->'items'->0?'host_user_id'),'grouped public offers omit private address and host identifiers');
 perform pg_temp.expect(jsonb_array_length(public.get_property_site_offers(listing,'short_let')->'items')=3,'Short Let filter uses rental terms rather than physical unit type');
 perform pg_temp.expect(pg_temp.rejects(format('select public.get_property_site_offers(%L,null,current_date,current_date+91)',listing)),'grouped offers reject more than 90 nights');
 perform pg_temp.expect(jsonb_array_length(public.get_property_site_offers(listing,'long_stay')->'items')=0,'current offer is excluded instead of duplicated by rental filtering');
 perform pg_temp.expect(jsonb_array_length(public.get_property_site_offers(booking_ids[1],'long_stay')->'items')=1,'a Short Let customer can discover the separate Long Let offer in the same compound');
 perform pg_temp.expect((public.get_property_site_offers(gen_random_uuid())->>'grouped')::boolean=false,'unknown source cannot enumerate another site');
 perform pg_temp.expect(pg_temp.rejects(format('select public.get_property_site_offers(%L,%L)',listing,'hotel')),'unknown rental filters are rejected');
 perform pg_temp.expect(pg_temp.rejects(format('select public.get_property_site_offers(%L,null,current_date,null)',listing)),'partial dates cannot silently bypass availability');
 second_page:=public.get_property_site_offers(listing,null,null,null,(first_page->'items'->0->>'id')::uuid);
 perform pg_temp.expect(jsonb_array_length(second_page->'items')=2 and not exists(select 1 from jsonb_array_elements(second_page->'items') x where x->>'id'=first_page->'items'->0->>'id'),'public keyset cursor does not repeat earlier offers');

 execute 'reset role';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',au,'session_id',sid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 first_page:=public.block_my_property_dates(booking_ids[1],current_date+100,current_date+102);
 perform pg_temp.expect(not exists(select 1 from jsonb_array_elements(public.get_property_site_offers(listing,'short_let',current_date+100,current_date+101)->'items') x where x->>'id'=booking_ids[1]::text),'grouped dated availability hides host closures');
 second_page:=public.block_my_property_dates(booking_ids[1],current_date+100,current_date+102);
 perform pg_temp.expect(first_page->'date_blocks'=second_page->'date_blocks' and jsonb_array_length(second_page->'date_blocks')=1,'identical close-date retry returns one block');
 perform public.unblock_my_property_dates((first_page->'date_blocks'->0->>'block_id')::uuid);
 second_page:=public.unblock_my_property_dates((first_page->'date_blocks'->0->>'block_id')::uuid);
 perform pg_temp.expect(jsonb_array_length(second_page->'date_blocks')=0,'reopening the same block twice is safe');
 perform pg_temp.expect(pg_temp.rejects(format('select public.set_my_property_future_price(%L,%L::numeric)',booking_ids[1],'NaN')),'non-finite price is rejected');
 first_page:=public.get_my_property_site_schedule(site,current_date,current_date+31);
 perform pg_temp.expect(jsonb_array_length(first_page->'items')=4 and first_page->>'site_id'=site::text,'building schedule contains all four authorized mixed-term offers');
 perform pg_temp.expect(not(first_page->'items'->0?'owner_email'),'building schedule does not project identity contact details');
 perform pg_temp.expect(pg_temp.rejects(format('select public.get_my_property_site_schedule(%L,current_date,current_date+90)',site)),'building schedule rejects unbounded date windows');
 first_page:=public.create_property_cohost_invitation(listing,null,'link','operations');
 perform pg_temp.expect(first_page->>'status'='pending','Long Let supports property Team invitations');
 second_page:=public.create_property_cohost_invitation(booking_ids[1],null,'link','full_hosting');
 perform pg_temp.expect(second_page->>'status'='pending','Short Let supports property Team invitations');
 discount_receipt:=public.set_my_listing_discount(booking_ids[1],10,current_date+5);
 perform pg_temp.expect(public.set_my_listing_discount(booking_ids[1],10,current_date+5)=discount_receipt,'identical discount retry returns the same saved receipt');
 perform pg_temp.expect(pg_temp.rejects(format('select public.set_my_listing_discount(%L,10,current_date-1)',booking_ids[1])),'expired discount is rejected');
 perform public.clear_my_listing_discount(booking_ids[1]);
 perform public.clear_my_listing_discount(booking_ids[1]);
 perform pg_temp.expect((public.listing_discount_breakdown(booking_ids[1])->>'host_percent')::numeric=0,'repeated discount removal leaves no active host discount');
 perform pg_temp.expect(jsonb_array_length(public.get_my_property_assets_page('property_partner',51))=4,'existing scoped Partner dashboard returns the four published physical offers');
 perform pg_temp.expect((public.get_my_property_assets_page('property_partner',1,null,null,booking_ids[2]::text)->0->>'space_label')='Home B / Room 1','Partner dashboard receives reviewed private-room label');
 perform pg_temp.expect((public.get_my_property_assets_page('property_partner',1,null,null,booking_ids[2]::text)->0->>'site_label')='Contract compound','Partner dashboard receives the containing compound without direct registry access');
 execute 'reset role';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
 select 'accommodation_arrival_issue_window',99011,'{"default_hours":2,"minimum_hours":1,"maximum_hours":6}'::jsonb,'active',now()-interval '1 minute','reviewed','Rollback-only physical-space booking contract','space-arrival'
 where not exists(select 1 from public.creator_policy_versions where policy_key='accommodation_arrival_issue_window' and scope_type='global' and scope_key='*' and status='active');
 insert into auth.sessions(id,user_id,created_at,updated_at) values(guest_sid,outsider,now(),now());
 insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
 values('space-outsider-'||outsider,outsider,guest_sid,'guest-'||guest_sid,'Browser',true,'trusted');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'session_id',guest_sid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 perform pg_temp.expect(pg_temp.rejects(format('select public.get_my_property_site_schedule(%L,current_date,current_date+31)',site)),'outsider cannot read the building schedule');
 perform pg_temp.expect(pg_temp.rejects(format('select public.clear_my_listing_discount(%L)',booking_ids[1])),'outsider discount removal rejects rather than silently succeeding');
 perform pg_temp.expect((public.get_public_listing_detail(listing::text)->>'status')='available','available Long Let exposes the same unit before another offer is held');
 perform pg_temp.expect((public.get_public_listing_detail(listing::text)->>'home_style') is null,'public detail keeps an ordinary home without an invented class');
 perform pg_temp.expect(pg_temp.rejects('select public.search_discoverable_homes(p_home_style=>''apartment'')'),'retired property catalogue filters are not an alternate API');
 perform pg_temp.expect(jsonb_array_length(public.search_discoverable_homes(p_query=>'Physical Long Let '||au,p_home_style=>'penthouse')->'items')=0,'Penthouse filter excludes a classified ordinary apartment');
 perform pg_temp.expect(exists(select 1 from jsonb_array_elements(public.search_discoverable_homes(p_query=>'Contract stay',p_home_style=>'penthouse')->'items') as matched_home(value) where matched_home.value->>'id'=booking_ids[1]::text),'Penthouse search returns the published reviewed unit');
 perform pg_temp.expect(jsonb_array_length(public.search_discoverable_homes(p_query=>'Physical Long Let '||au,p_stay_type=>'long_stay')->'items')=1,'public search includes a free Long Let physical home');
 booking:=public.create_short_stay_reservation_idem(gen_random_uuid(),booking_ids[2]::text,current_date+10,current_date+12,1);
 perform pg_temp.expect(booking->>'physical_space_id'=room::text and booking->>'physical_unit_id'=unit_b::text,'real customer checkout binds private room to its parent home');
 perform pg_temp.expect(booking->>'listing_title' like '%Home B / Room 1','real checkout receipt identifies the private room');
 execute 'reset role';
 perform pg_temp.expect(exists(select 1 from public.reservations r join public.listings l on l.id::text=r.listing_id where r.id=booking->>'id' and r.provider_fee_snapshot=l.provider_fee_snapshot and r.provider_fee_snapshot->>'accepted_by'=person),'real booking freezes the accepted Partner fee breakdown');
 perform pg_temp.expect(pg_temp.rejects(format('update public.reservations set provider_fee_snapshot=%L::jsonb where id=%L','{}',booking->>'id')),'accepted booking fee snapshot is immutable');
 execute 'set local role authenticated';
 perform pg_temp.expect(not exists(select 1 from jsonb_array_elements(public.get_property_site_offers(booking_ids[3],'short_let',current_date+10,current_date+12)->'items') x where x->>'id' in (booking_ids[1]::text,booking_ids[2]::text)),'grouped availability excludes both held private room and overlapping whole-home offer');
 perform pg_temp.expect(pg_temp.rejects(format('select public.create_short_stay_reservation(%L,current_date+10,current_date+12,1)',booking_ids[1])),'whole home cannot be held over an existing private-room checkout');
 second_booking:=public.create_short_stay_reservation_idem(gen_random_uuid(),booking_ids[3]::text,current_date+10,current_date+12,1);
 perform pg_temp.expect(second_booking->>'physical_unit_id'=unit_a::text,'independent home in the compound remains bookable for the same dates');
 perform pg_temp.expect((public.get_public_listing_detail(listing::text)->>'status')='unavailable','public Long Let detail does not offer a physical home held under Short Let');
 perform pg_temp.expect(jsonb_array_length(public.search_discoverable_homes(p_query=>'Physical Long Let '||au,p_stay_type=>'long_stay')->'items')=0,'Long Let search excludes the same physical home held under Short Let');

 execute 'reset role';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',au,'session_id',sid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 perform pg_temp.expect(pg_temp.rejects(format('select private.activate_short_stay(%L,current_date)',booking->>'id')),'host cannot call the private activation implementation');
 begin
  perform public.activate_short_stay(booking->>'id',current_date);
  raise exception 'Host bypassed guest code through staff activation';
 exception when raise_exception then
  if sqlerrm<>'Active WeHouse Team account required' then raise;end if;
 end;
 begin
  perform public.activate_apartment_tenancy(booking->>'id',current_date);
  raise exception 'Host bypassed guest code through Long Let staff activation';
 exception when raise_exception then
  if sqlerrm<>'Active WeHouse Team account required' then raise;end if;
 end;
 begin
  perform public.host_confirm_short_stay_check_in('NASWH78291',p_reservation_id=>second_booking->>'id');
  raise exception 'Wrong-reservation code was accepted';
 exception when raise_exception then
  if sqlerrm<>'The booking code does not match this assigned reservation' then raise;end if;
 end;
 begin
  perform public.host_confirm_short_stay_check_in('NASWH78291',p_reservation_id=>booking->>'id');
  raise exception 'Unpaid stay was checked in';
 exception when raise_exception then
  if sqlerrm<>'The booking code does not match this assigned reservation' then raise;end if;
 end;
 perform pg_temp.expect(pg_temp.rejects(format('select public.host_confirm_short_stay_check_in(%L)','NASWH78291')),'a code without the current reservation cannot record arrival');
 execute 'reset role';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'session_id',guest_sid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 perform public.cancel_my_apartment_reservation(booking->>'id');
 booking:=to_jsonb(public.create_short_stay_reservation(booking_ids[1]::text,current_date+10,current_date+12,1));
 perform pg_temp.expect(booking->>'physical_space_id'=unit_b::text,'customer cancellation releases the contained room so the whole home can be held');
 perform pg_temp.expect(pg_temp.rejects(format('select public.create_short_stay_reservation(%L,current_date+10,current_date+12,1)',booking_ids[2])),'private room cannot be held over an existing whole-home checkout');
 perform public.cancel_my_apartment_reservation(booking->>'id');
 perform public.cancel_my_apartment_reservation(second_booking->>'id');
 perform pg_temp.expect((public.get_public_listing_detail(listing::text)->>'status')='available','cancellation restores cross-offer Long Let detail availability');
 perform pg_temp.expect(jsonb_array_length(public.search_discoverable_homes(p_query=>'Physical Long Let '||au,p_stay_type=>'long_stay')->'items')=1,'cancellation restores the Long Let public search result');
 execute 'reset role';

 -- Seed three verified reservation-fee receipts at the provider boundary, keeping real customer booking guards active.
 for h_i in 1..3 loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'session_id',guest_sid,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  history_row:=public.create_short_stay_reservation(booking_ids[3]::text,current_date+200+h_i*2,current_date+201+h_i*2,1);
  history_ids:=array_append(history_ids,history_row.id);
  execute 'reset role';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  update public.booking_payments set status='paid',verified_amount=amount_total,verified_at=now(),paid_at=now(),webhook_processed=true,
   verification_source='webhook',paystack_transaction_id='SPACE-HISTORY-'||h_i where paystack_reference=history_row.payment_reference;
 end loop;
 -- A missing historical creation date stays NULL; only its private paging cursor has a sort value.
 update public.reservations set created_at=null where id=history_ids[3];
 perform set_config('request.jwt.claims',jsonb_build_object('sub',au,'session_id',sid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 first_page:=public.get_my_property_partner_stays(p_listing_id=>booking_ids[3]::text,p_limit=>2);
 perform pg_temp.expect(jsonb_array_length(first_page)=2,'Partner history has a bounded first page of real paid-fee reservations');
 second_page:=public.get_my_property_partner_stays(p_listing_id=>booking_ids[3]::text,p_before_created_at=>(first_page->1->>'page_created_at')::timestamptz,p_before_id=>first_page->1->>'reservation_id',p_limit=>2);
 perform pg_temp.expect(jsonb_array_length(second_page)=1 and second_page->0->>'reservation_id'=history_ids[3],'equal-timestamp cursor reaches the remaining undated record without skipping');
 perform pg_temp.expect(second_page->0->'created_at'='null'::jsonb,'history does not invent a missing creation timestamp');
 perform pg_temp.expect((public.get_my_property_partner_stays(p_listing_id=>booking_ids[3]::text,p_reservation_id=>history_ids[3],p_limit=>1)->0->>'reservation_id')=history_ids[3],'older booking link uses the same scoped exact lookup');
 perform pg_temp.expect(jsonb_array_length(public.get_my_property_partner_stays(p_listing_id=>booking_ids[2]::text,p_reservation_id=>history_ids[3],p_limit=>1))=0,'exact target cannot cross the selected property');
 perform pg_temp.expect(pg_temp.rejects(format('select public.get_my_property_partner_stays(p_listing_id=>%L,p_limit=>52)',booking_ids[3])),'history refuses an oversized page');
 perform pg_temp.expect(pg_temp.rejects(format('select public.get_my_property_partner_stays(p_listing_id=>%L,p_before_id=>%L)',booking_ids[3],history_ids[1])),'history refuses an incomplete cursor');
 execute 'reset role';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',au,'session_id',sid,'role','authenticated')::text,true);

 execute 'set local role authenticated';
 perform pg_temp.expect(pg_temp.rejects('select public.get_my_property_pipeline_v2(''all'')'),'Partner grant alone cannot open the publication pipeline');
 execute 'reset role';

 -- Real customer checkout plus a protected-money fixture boundary, then actual Host arrival commands.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'session_id',guest_sid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 history_row:=public.create_short_stay_reservation(booking_ids[1]::text,timezone('Africa/Lagos',now())::date,timezone('Africa/Lagos',now())::date+2,1);
 execute 'reset role';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 -- Verified provider/Protection state is seeded, not a live charge or settlement.
 update public.reservations set rent_payment_reference='SPACE-ARRIVAL-'||au where id=history_row.id;
 insert into public.verified_provider_events(provider_event_id,provider,provider_event_key,event_type,provider_reference,payload_sha256,signature_verified_at,processed_at,processing_status)
 values(arrival_event,'paystack','space-arrival:'||au,'charge.success','SPACE-ARRIVAL-'||au,repeat('b',64),now(),now(),'processed');
 insert into public.booking_payments(id,payment_reference,paystack_reference,user_id,payer_user_id,listing_id,amount,amount_total,verified_amount,currency,status,purpose,verified_at,paid_at,paystack_transaction_id,verification_source,webhook_processed,metadata)
 values(arrival_payment,'SPACE-ARRIVAL-'||au,'SPACE-ARRIVAL-'||au,'space-outsider-'||outsider,'space-outsider-'||outsider,history_row.listing_id,history_row.stay_rent_total,history_row.stay_rent_total,history_row.stay_rent_total,'NGN','paid','apartment_rent',now(),now(),'SPACE-ARRIVAL-TX-'||au,'webhook',true,jsonb_build_object('reservation_id',history_row.id,'listing_id',history_row.listing_id,'payment_component','short_stay_rent','check_in',history_row.stay_check_in,'check_out',history_row.stay_check_out,'nights',history_row.stay_nights,'guest_count',history_row.guest_count,'nightly_rate',history_row.nightly_rate_snapshot,'stay_rent_total',history_row.stay_rent_total,'security_deposit_amount',coalesce(history_row.security_deposit_snapshot,0)));
 insert into public.ledger_transactions(ledger_transaction_id,idempotency_key,transaction_type,currency,reference_type,reference_id,provider_event_id,payload_checksum)
 values(arrival_ledger,'space-arrival:'||au,'provider_charge','NGN','booking_payment',arrival_payment::text,arrival_event,repeat('b',64));
 insert into public.payment_protection_transactions(id,booking_type,payer_user_id,payee_user_id,amount_total,amount_commission,amount_payee,commission_rate,status,protection_state,subject_type,subject_id,paystack_reference,protected_ledger_transaction_id)
 values(arrival_protection,'short_let_stay','space-outsider-'||outsider,person,history_row.stay_rent_total,round(history_row.stay_rent_total*0.12,2),history_row.stay_rent_total-round(history_row.stay_rent_total*0.12,2),12,'protected','protected','short_let_stay',history_row.id,'SPACE-ARRIVAL-'||au,arrival_ledger);
 update public.reservations set status='ready_for_move_in',manual_payment_status='paid',paid_at=now(),reservation_fee_status='paid',rent_payment_status='paid',rent_paid_at=now(),stay_payment_protection_id=arrival_protection where id=history_row.id returning * into history_row;
 perform pg_temp.expect(history_row.booking_code is not null,'eligible paid fixture receives a customer booking code');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',au,'session_id',sid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 begin
  perform public.host_confirm_short_stay_check_in(history_row.booking_code,p_reservation_id=>history_ids[1]);
  raise exception 'Paid guest code checked in a different reservation';
 exception when raise_exception then
  if sqlerrm<>'The booking code does not match this assigned reservation' then raise;end if;
 end;
 arrival_receipt:=public.host_confirm_short_stay_check_in(history_row.booking_code,p_reservation_id=>history_row.id);
 perform pg_temp.expect(arrival_receipt.id=history_row.id and arrival_receipt.status='occupied' and arrival_receipt.physical_unit_id=unit_b and arrival_receipt.checked_in_at is not null,'Host check-in occupies the exact protected physical home');
 arrival_started:=arrival_receipt.occupancy_started_at;
 arrival_receipt:=public.host_confirm_short_stay_check_in(history_row.booking_code,p_reservation_id=>history_row.id);
 perform pg_temp.expect(arrival_receipt.occupancy_started_at=arrival_started,'lost-response retry returns the committed arrival without a second transition');
 first_page:=public.get_my_property_partner_stays(p_listing_id=>booking_ids[1]::text,p_reservation_id=>history_row.id,p_limit=>1);
 perform pg_temp.expect(first_page->0->>'status'='occupied' and not(first_page->0?'booking_code'),'Partner history projects arrival without disclosing the guest code');
 execute 'reset role';
 perform pg_temp.expect((select count(*)=1 from public.obligation_policy_snapshots where subject_type='short_let' and subject_id=history_row.id),'arrival policy snapshot is not duplicated on retry');


 -- Reviews are bound to verified bookings, not public listing availability.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'session_id',guest_sid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 perform pg_temp.expect(not(public.get_my_property_booking_review(history_row.id)->>'eligible')::boolean,'ongoing Short Let does not open reviews before checkout');
 execute 'reset role';
 update public.reservations set checked_out_at=now() where id=history_row.id;
 execute 'set local role authenticated';
 perform pg_temp.expect((public.get_my_property_booking_review(history_row.id)->>'eligible')::boolean,'paid verified checked-out guest can review from booking');
 first_page:=to_jsonb(public.submit_my_property_booking_review(history_row.id,4,'Verified stay review fixture'));
 second_page:=to_jsonb(public.submit_my_property_booking_review(history_row.id,4,'Verified stay review fixture'));
 perform pg_temp.expect(first_page=second_page,'lost review response does not create a duplicate');
 perform pg_temp.expect(public.get_my_property_booking_review(history_row.id)->'review'->>'review_id'=first_page->>'review_id','booking returns its saved review');
 perform pg_temp.expect(pg_temp.rejects(format('select public.submit_my_property_booking_review(%L,5,%L)',history_row.id,'Different payload')),'existing booking review cannot be silently replaced');
 execute 'reset role';
 perform pg_temp.expect(private.property_review_eligible(jsonb_populate_record(null::public.reservations,'{"stay_type":"long_stay","status":"occupied","rent_payment_status":"upfront_paid","verified_handover_at":"2026-10-01T10:00:00Z"}'::jsonb)),'Long Let review opens after paid verified handover without waiting for tenancy end');
 perform pg_temp.expect(not private.property_review_eligible(jsonb_populate_record(null::public.reservations,'{"stay_type":"long_stay","status":"occupied","rent_payment_status":"upfront_paid"}'::jsonb)),'payment without verified occupancy does not qualify a tenant');
 perform pg_temp.expect(not private.property_review_eligible(jsonb_populate_record(null::public.reservations,'{"stay_type":"long_stay","status":"occupied","rent_payment_status":"unpaid","occupancy_started_at":"2026-10-01T10:00:00Z"}'::jsonb)),'unpaid occupancy does not qualify under saved rental rules');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',au,'session_id',sid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 perform pg_temp.expect(pg_temp.rejects(format('select public.get_my_property_booking_review(%L)',history_row.id)),'host cannot read customer private review control');
 perform pg_temp.expect(pg_temp.rejects(format('select public.submit_my_property_booking_review(%L,5,null)',history_row.id)),'host cannot submit customer review');
 execute 'reset role';
 -- New physical facts must reach assigned Field staff and scoped publication reviewers.
 field_person:='space-field-'||field_auth;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 insert into auth.users(id,aud,role,email,created_at,updated_at)values(field_auth,'authenticated','authenticated',field_auth||'@example.invalid',now(),now());
 insert into public.profiles(auth_id,email,user_id,role,profile_complete,full_name,state,city)
 values(field_auth,field_auth||'@example.invalid',field_person,'user',true,'Field scope contract','Nasarawa','Lafia');
 insert into auth.sessions(id,user_id,created_at,updated_at)values(field_sid,field_auth,now(),now());
 insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)values(field_person,field_auth,field_sid,'field-'||field_sid,'Browser',true,'trusted');
 insert into public.workspace_role_assignments(user_id,workspace_role,scope_type)values(field_person,'staff','global'),(field_person,'field_operations','global');
 req:=(receipt->'requests'->2->>'id')::uuid;
 insert into public.workspace_role_assignments(user_id,workspace_role,scope_type)values('space-outsider-'||outsider,'creator','global');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'session_id',guest_sid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 perform public.review_property_access_evidence(req,'accept','Fixture reviewer inspected the submitted private access recording');
 execute 'reset role';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 update public.inspection_requests set assigned_field_officer_id=field_person where id=req;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',field_auth,'session_id',field_sid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into first_page from public.get_my_inspections(field_person)x;
 perform pg_temp.expect(jsonb_array_length(first_page)=1,'only the assigned non-owned inspection reaches canonical Field staff');
 perform pg_temp.expect(first_page->0->>'home_style'='penthouse' and first_page->0->>'space_scope'='private_room' and first_page->0->>'space_label'='Home B / Room 1' and first_page->0->'shared_areas'='["Kitchen","Entrance"]'::jsonb,'Field visit receives the actual room and shared areas');
 perform pg_temp.expect(pg_temp.rejects(format('select public.get_my_inspections(%L)',person)),'Field staff cannot request another officer identity');
 execute 'reset role';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 update public.workspace_role_assignments set status='revoked',revoked_at=now() where user_id=field_person and workspace_role='field_operations';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',field_auth,'session_id',field_sid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 perform pg_temp.expect(pg_temp.rejects(format('select public.get_my_inspections(%L)',field_person)),'revoked Field permission cannot read assigned physical facts');
 execute 'reset role';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);

 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'session_id',guest_sid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 first_page:=public.get_my_property_pipeline_v2('all');
 perform pg_temp.expect(exists(select 1 from jsonb_array_elements(first_page)r where r->>'id'=req::text and r->>'home_style'='penthouse' and r->>'space_scope'='private_room' and r->>'space_label'='Home B / Room 1' and r->'shared_areas'='["Kitchen","Entrance"]'::jsonb),'canonical Creator review receives the same room scope before publication');
 execute 'reset role';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 update public.workspace_role_assignments set status='revoked',revoked_at=now() where user_id='space-outsider-'||outsider and workspace_role='creator';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'session_id',guest_sid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 perform pg_temp.expect(pg_temp.rejects('select public.get_my_property_pipeline_v2(''all'')'),'revoked Creator grant cannot read the publication pipeline');
 execute 'reset role';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',au,'session_id',sid,'role','authenticated')::text,true);
 update public.user_sessions set is_active=false where user_id=person;
 execute 'set local role authenticated';
 perform pg_temp.expect(pg_temp.rejects(format('select public.host_confirm_short_stay_check_in(%L,p_reservation_id=>%L)','NASWH78291',history_ids[1])),'revoked host device cannot confirm arrival');
 perform pg_temp.expect(pg_temp.rejects(format('select public.get_my_property_site_schedule(%L,current_date,current_date+31)',site)),'revoked device cannot read building schedule');
 perform pg_temp.expect(pg_temp.rejects(format('select public.create_property_cohost_invitation(%L,null,%L,%L)',listing,'link','operations')),'revoked device cannot invite property Team members');
 perform pg_temp.expect(pg_temp.rejects(format('select public.set_my_property_future_price(%L,15000)',booking_ids[1])),'revoked device cannot change price');
 perform pg_temp.expect(pg_temp.rejects(format('select public.set_my_property_booking_availability(%L,false)',booking_ids[1])),'revoked device cannot pause bookings');
 perform pg_temp.expect(pg_temp.rejects(format('select public.block_my_property_dates(%L,current_date+100,current_date+102)',booking_ids[1])),'revoked device cannot close dates');
 perform pg_temp.expect(pg_temp.rejects(format('select public.set_my_listing_discount(%L,10,null)',booking_ids[1])),'revoked device cannot change discounts');
 perform pg_temp.expect(pg_temp.rejects(format('select public.clear_my_listing_discount(%L)',booking_ids[1])),'revoked device cannot remove discounts');
 perform pg_temp.expect(pg_temp.rejects(format('select public.create_my_property_inspection_batch_v4(%L,%L::jsonb)',batch,items::text)),'revoked device cannot submit property identities');
 execute 'reset role';
end $$;
rollback;
select 'Physical-space submission, ownership, customer checkout conflicts, cancellation release, public availability, scoped Partner history, audited Field assignment and canonical publication review and protected Short Let arrival/retry passed; fixtures rolled back. Simultaneous booking concurrency and provider payments remain separate gates.' as result;
