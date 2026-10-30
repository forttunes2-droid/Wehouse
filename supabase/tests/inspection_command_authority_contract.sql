begin;
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description;end if;end$$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$begin execute statement;return false;exception when others then return true;end$$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.rejects(text) to authenticated;
do $$
declare actors jsonb:='{}'; actor jsonb; kind text; au uuid; sess uuid; person text;
 request_id uuid:=gen_random_uuid(); user_request uuid:=gen_random_uuid(); listing uuid:=gen_random_uuid();
 photos text[]; completed_time timestamptz;
begin
 for kind in select unnest(array['owner','field','colleague','admin','reviewer']) loop
  au:=gen_random_uuid();sess:=gen_random_uuid();person:='inspection-check-'||au;
  insert into auth.users(id,aud,role,email,created_at,updated_at) values(au,'authenticated','authenticated',au||'@example.invalid',now(),now());
  insert into public.profiles(auth_id,email,user_id,role,profile_complete,full_name,state,city,local_government)
   values(au,au||'@example.invalid',person,'user',true,'Inspection check','Nasarawa','Lafia','Lafia');
  insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),au,'totp','verified',now(),now());
  insert into auth.sessions(id,user_id,created_at,updated_at) values(sess,au,now(),now());
  insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
   values(person,au,sess,'check-'||au,'Browser',true,'trusted');
  if kind in ('field','colleague','reviewer') then
   insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga)
    values(person,'staff','branch','Nasarawa','Lafia'),(person,case when kind='reviewer' then 'property_operations' else 'field_operations' end,'branch','Nasarawa','Lafia');
  elsif kind='admin' then
   insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga) values(person,'admin','branch','Nasarawa','Karu');
  elsif kind='owner' then
   insert into public.workspace_role_assignments(user_id,workspace_role,scope_type) values(person,'creator','global');
  end if;
  actors:=actors||jsonb_build_object(kind,jsonb_build_object('auth',au,'session',sess,'person',person));
 end loop;
 photos:=array(select 'field/'||request_id||'/'||n||'.jpg' from generate_series(1,4)n);
 insert into public.inspection_requests(id,request_code,owner_id,owner_email,property_address,property_city,property_state,status,assigned_field_officer_id,access_evidence_status)
 values(request_id,'CHECK-'||request_id,actors->'owner'->>'person','check@example.invalid','Contract property','Lafia','Nasarawa','scheduled',actors->'field'->>'person','verified');
 insert into public.listings(id,listing_id,title,price,sub_type,state,city,status,availability_status,max_guests)
 values(listing,listing::text,'Contract property',10000,'short_let','Nasarawa','Lafia','pending_approval','pending_approval',2);
 insert into public.user_inspection_requests(id,listing_id,user_id,field_officer_id,status)
 values(user_request,listing::text,actors->'owner'->>'person',actors->'field'->>'person','scheduled');
 actor:=actors->'field';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor->>'auth','session_id',actor->>'session','role','authenticated','aal','aal2')::text,true);
 execute 'set local role authenticated';
 perform pg_temp.expect((select count(*)=2 from public.get_my_inspections(actor->>'person')),'both assigned inspection sources load');
 perform pg_temp.expect(pg_temp.rejects(format('select public.update_inspection_status(%L,%L,%L,%L)',request_id,'completed','partner','Report')),'cannot skip starting an inspection');
 perform pg_temp.expect(public.update_inspection_status(request_id,'in_progress','partner'),'assigned field can start');
 perform pg_temp.expect(public.update_inspection_status(request_id,'in_progress','partner'),'start retry confirms same state');
 perform pg_temp.expect(pg_temp.rejects(format('select public.field_officer_update_inspection_location(%L,null,8)',request_id)),'null latitude denied');
 perform pg_temp.expect(pg_temp.rejects(format('select public.field_officer_update_inspection_location(%L,%L,8)',request_id,'NaN')),'nonfinite location denied');
 perform pg_temp.expect(public.field_officer_update_inspection_location(request_id,8.5,8.5,10),'valid location saved');
 perform pg_temp.expect(pg_temp.rejects(format('select public.field_officer_add_inspection_media(%L,%L::text[])',request_id,photos)),'unuploaded evidence paths denied');
 execute 'reset role';
 perform public.reserve_my_media_upload('listing-candidates',path) from unnest(photos)path;
 insert into storage.objects(bucket_id,name,metadata,version) select 'listing-candidates',path,'{"size":12,"mimetype":"image/jpeg"}'::jsonb,gen_random_uuid()::text from unnest(photos)path;
 execute 'set local role authenticated';
 perform pg_temp.expect(public.field_officer_add_inspection_media(request_id,photos),'uploaded evidence registered');
 perform pg_temp.expect(public.update_inspection_status(request_id,'completed','partner','Verified inspection report'),'report submitted');
 perform pg_temp.expect(public.update_inspection_status(request_id,'completed','partner','Verified inspection report'),'report retry is confirmed');
 perform pg_temp.expect(public.field_officer_add_inspection_media(request_id,photos),'registration retry after submission is confirmed');
 perform pg_temp.expect(pg_temp.rejects(format('select public.update_inspection_status(%L,%L,%L,%L)',request_id,'completed','partner','Replaced report')),'submitted report cannot be overwritten');
 perform pg_temp.expect(pg_temp.rejects(format('select public.update_inspection_status(%L,%L,%L)',request_id,'in_progress','partner')),'completed report cannot be reopened by its author');
 perform pg_temp.expect(pg_temp.rejects(format('select public.field_officer_update_inspection_location(%L,9,9)',request_id)),'submitted location is immutable');
 perform pg_temp.expect(public.update_inspection_status(user_request,'in_progress','user'),'customer visit can start');
 perform pg_temp.expect(public.update_inspection_status(user_request,'completed','user','Visit report','Good'),'customer visit can complete');
 perform pg_temp.expect(public.update_inspection_status(user_request,'completed','user','Visit report','Good'),'customer report retry confirmed');
 perform pg_temp.expect((select notes='Visit report' and completed_at is not null from public.get_my_inspections(actor->>'person') where id=user_request),'completed visit dashboard shows submitted report and timestamp');
 execute 'reset role';
 completed_time:=(select completed_at from public.inspection_requests where id=request_id);
 actor:=actors->'reviewer';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor->>'auth','session_id',actor->>'session','role','authenticated','aal','aal2')::text,true);
 execute 'set local role authenticated';
 perform pg_temp.expect(public.review_field_inspection_evidence(request_id,'request_changes','Add clearer entrance evidence.'),'Property Operations can request a correction');
 perform pg_temp.expect(public.review_field_inspection_evidence(request_id,'request_changes','Add clearer entrance evidence.'),'correction retry is confirmed without another notification');
 execute 'reset role';
 perform pg_temp.expect((select count(*)=1 from public.notifications where recipient_id=actors->'field'->>'person' and type='field_evidence_changes_requested' and related_id=request_id::text),'correction request notifies the assigned Staff member once');
 actor:=actors->'field';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor->>'auth','session_id',actor->>'session','role','authenticated','aal','aal2')::text,true);
 execute 'set local role authenticated';
 perform pg_temp.expect(public.update_inspection_status(request_id,'completed','partner','Corrected inspection report'),'assigned Staff can resubmit after a real correction request');
 execute 'reset role';
 actor:=actors->'reviewer';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor->>'auth','session_id',actor->>'session','role','authenticated','aal','aal2')::text,true);
 execute 'set local role authenticated';
 perform pg_temp.expect(public.review_field_inspection_evidence(request_id,'accept','Evidence reviewed.'),'Property Operations accepts submitted evidence');
 perform pg_temp.expect(public.review_field_inspection_evidence(request_id,'accept','Evidence reviewed.'),'review retry is confirmed');
 execute 'reset role';
 actor:=actors->'field';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor->>'auth','session_id',actor->>'session','role','authenticated','aal','aal2')::text,true);
 execute 'set local role authenticated';
 perform pg_temp.expect(public.update_inspection_status(request_id,'completed','partner','Corrected inspection report'),'retry after review still confirms without resetting review');
 execute 'reset role';
 perform pg_temp.expect((select field_evidence_review_status='accepted' and completed_at=completed_time and cardinality(field_photo_urls)=4 from public.inspection_requests where id=request_id),'retries preserve accepted review, completion time and four distinct photos');
 insert into public.workspace_role_assignments(user_id,workspace_role,scope_type) values(actor->>'person','creator','global');
 execute 'set local role authenticated';
 perform pg_temp.expect((select count(*)=2 from public.get_my_inspections(actor->>'person')),'explicit Field Operations grants remain usable alongside Creator access');
 perform pg_temp.expect(public.field_officer_add_inspection_media(request_id,photos),'additive role preserves the assigned evidence receipt');
 perform pg_temp.expect(pg_temp.rejects(format('select public.review_field_inspection_evidence(%L,%L,%L)',request_id,'accept','Evidence reviewed.')),'a Creator who is also the assigned inspector still cannot approve their own evidence');
 execute 'reset role';
 update public.workspace_role_assignments set status='revoked',revoked_at=now() where user_id=actor->>'person' and workspace_role='creator';
 update public.inspection_requests set access_evidence_status='rejected' where id=request_id;
 execute 'set local role authenticated';
 perform pg_temp.expect(pg_temp.rejects(format('select public.field_officer_add_inspection_media(%L,%L::text[])',request_id,photos)),'withdrawn property access approval blocks even an old assignment');
 execute 'reset role';
 update public.inspection_requests set access_evidence_status='verified' where id=request_id;
 for kind in select unnest(array['owner','colleague','admin']) loop
  actor:=actors->kind;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor->>'auth','session_id',actor->>'session','role','authenticated','aal','aal2')::text,true);
  execute 'set local role authenticated';
  perform pg_temp.expect(pg_temp.rejects(format('select public.update_inspection_status(%L,%L,%L,%L)',request_id,'completed','partner','Verified inspection report')),'unassigned person or out-of-scope Admin cannot submit field evidence');
  perform pg_temp.expect(pg_temp.rejects(format('select public.review_field_inspection_evidence(%L,%L,%L)',request_id,'accept','Evidence reviewed.')),'owner, field-only colleague and out-of-scope Admin cannot review evidence');
  execute 'reset role';
 end loop;
 actor:=actors->'field';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor->>'auth','session_id',actor->>'session','role','authenticated','aal','aal2')::text,true);
 update public.workspace_role_assignments set scope_lga='Karu' where user_id=actor->>'person' and workspace_role='field_operations';
 execute 'set local role authenticated';
 perform pg_temp.expect((select count(*)=0 from public.get_my_inspections(actor->>'person')),'coverage change removes old assigned inspections');
 perform pg_temp.expect(pg_temp.rejects(format('select public.update_inspection_status(%L,%L,%L)',request_id,'in_progress','partner')),'stale assignment cannot bypass changed coverage');
 execute 'reset role';
 update public.workspace_role_assignments set scope_lga='Lafia' where user_id=actor->>'person' and workspace_role='field_operations';
 update public.user_sessions set is_active=false where user_id=actor->>'person';
 execute 'set local role authenticated';
 perform pg_temp.expect(pg_temp.rejects(format('select public.get_my_inspections(%L)',actor->>'person')),'revoked device cannot load inspections');
 perform pg_temp.expect(pg_temp.rejects(format('select public.field_officer_add_inspection_media(%L,%L::text[])',request_id,photos)),'revoked device cannot register evidence');
 execute 'reset role';
end $$;
rollback;
select 'Inspection assignment, scope, sessions, uploads, lifecycle and retry checks passed; fixtures rolled back' as result;
