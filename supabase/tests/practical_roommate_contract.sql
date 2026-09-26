\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description; end if;end$$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,anon,service_role;
-- The same production comparison function is exercised in BOTH directions.
do $$
declare a jsonb; b jsonb; incompatible jsonb; result jsonb; patch jsonb;
begin
 a:='{"practical_preferences_version":2,"preferred_state":"Nasarawa","preferred_lga":"Lafia","preferred_area":"","budget_min":300000,"budget_max":500000,"profile_gender":"female","gender_preference":"no_preference","matching_school":"IMAP","school_match":false,"room_arrangement":"either","move_in_mode":"flexible","smoking_habit":"never","smoking_preference":"no"}';
 b:=a||'{"profile_gender":"male","gender_preference":"female","preferred_state":" NASARAWA ","preferred_lga":"LAFIA"}';
 result:=public._roommate_practical_compatibility(a,b,'2026-09-23');
 perform pg_temp.expect((result->>'eligible')::boolean,'Compatible practical requirements');
 perform pg_temp.expect(result->'score'='null'::jsonb and (result->>'compared_answers')::int=0,'No answers must not become 100% agreement');
 perform pg_temp.expect(public._roommate_practical_compatibility(b,a,'2026-09-23')->>'eligible'='true','Requirements are reciprocal');
 foreach patch in array array[
  '{"preferred_lga":"Keffi"}'::jsonb,'{"budget_min":600000,"budget_max":800000}'::jsonb,
  '{"gender_preference":"male"}'::jsonb,'{"practical_preferences_version":0}'::jsonb,
  '{"smoking_habit":"smokes"}'::jsonb,'{"school_match":true,"matching_school":"Other school"}'::jsonb
 ] loop
  incompatible:=b||patch;
  perform pg_temp.expect(public._roommate_practical_compatibility(a,incompatible,'2026-09-23')->>'eligible'='false','Mismatch cannot be hidden by ranking: '||patch::text);
  perform pg_temp.expect(public._roommate_practical_compatibility(incompatible,a,'2026-09-23')->>'eligible'='false','Reverse mismatch: '||patch::text);
 end loop;
 perform pg_temp.expect(public._roommate_practical_compatibility(a||'{"preferred_area":"A","room_arrangement":"shared_bedroom"}',b||'{"preferred_area":"B","room_arrangement":"separate_bedrooms"}','2026-09-23')->>'eligible'='false','Room and area are requirements');
 perform pg_temp.expect(public._roommate_practical_compatibility(a||'{"move_in_mode":"asap"}',b||'{"move_in_mode":"date","move_in_from":"2027-03-01","move_in_to":"2027-03-01"}','2026-09-23')->>'eligible'='false','ASAP does not match six months away');
 perform pg_temp.expect(public._roommate_practical_compatibility(a||'{"move_in_mode":"range","move_in_from":"2026-10-01","move_in_to":"2026-10-10"}',b||'{"move_in_mode":"date","move_in_from":"2026-10-10","move_in_to":"2026-10-10"}','2026-09-23')->>'eligible'='true','Inclusive date range endpoints match');
 result:=public._roommate_practical_compatibility(a||'{"cleanliness":"neat","overnight_visitors":"no"}',b||'{"cleanliness":"neat","overnight_visitors":"yes"}','2026-09-23');
 perform pg_temp.expect((result->>'score')::integer=50 and (result->>'compared_answers')::integer=2,'Only jointly answered preferences enter the denominator');
 perform pg_temp.expect(result->'discuss' @> '["Overnight visitors: different expectations."]','Explain differences');
end $$;

set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,username,role,profile_complete,account_kind,gender,school,state,city,local_government)
values ('91000000-0000-4000-8000-000000000001','rm-practical-a@example.invalid','rm-practical-a','rm-practical-a','user',true,'consumer','female','IMAP','FCT','Abuja','Abuja'),
('91000000-0000-4000-8000-000000000002','rm-practical-b@example.invalid','rm-practical-b','rm-practical-b','user',true,'consumer','male','IMAP','Lagos','Ikeja','Ikeja'),
('91000000-0000-4000-8000-000000000003','rm-practical-c@example.invalid','rm-practical-c','rm-practical-c','user',true,'consumer','male','Other school','Nasarawa','Lafia','Lafia');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.save_my_roommate_preferences_v2('{"gender":"male","user_id":"rm-practical-b","gender_preference":"no_preference","budget_min":300000,"budget_max":500000,"preferred_state":"Nasarawa","preferred_lga":"Lafia","preferred_area":"","move_in_mode":"flexible","room_arrangement":"either","smoking_habit":"never","smoking_preference":"no","school_match":true}');
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select public.save_my_roommate_preferences_v2('{"gender_preference":"female","budget_min":350000,"budget_max":600000,"preferred_state":"Nasarawa","preferred_lga":"Lafia","move_in_mode":"flexible","room_arrangement":"separate_bedrooms","smoking_habit":"never","smoking_preference":"no","school_match":false}');
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select public.save_my_roommate_preferences_v2('{"gender_preference":"female","budget_min":350000,"budget_max":600000,"preferred_state":"Nasarawa","preferred_lga":"Lafia","move_in_mode":"flexible","room_arrangement":"separate_bedrooms","smoking_habit":"never","smoking_preference":"no","school_match":false}');
reset role;
select pg_temp.expect((select gender='female' and preferred_lga='Lafia' and cleanliness is null and visitors is null from public.roommate_preferences where user_id='rm-practical-a'),'Authoritative gender and explicit preferred location; no default habits');
select pg_temp.expect((select state='FCT' from public.profiles where user_id='rm-practical-a'),'Preferred location never overwrites account location');
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.refresh_my_roommate_search();
do $$declare results jsonb;begin
 select jsonb_agg(row) into results from public.get_my_roommate_matches_page_v2() row;
 perform pg_temp.expect(jsonb_array_length(results)=1 and results->0->>'matched_user_id'='rm-practical-b','One-sided same school requirement excludes the wrong school');
 perform pg_temp.expect(results->0->'school'='null'::jsonb,'School is not disclosed when both did not opt into same-school');
 perform pg_temp.expect(results->0->>'city'='Lafia' and results->0->>'state'='Nasarawa','Moving location is projected instead of current address');
end$$;
reset role;
-- Existing accepted relationship remains even when both pause and future plans change.
set local session_replication_role=replica;
update public.roommate_search_results set status='accepted' where searcher_id='rm-practical-a';
insert into public.roommate_search_results(searcher_id,matched_user_id,match_score,status) values('rm-practical-b','rm-practical-a',0,'accepted');
insert into public.conversations(id,participant_a,participant_b,conversation_type,status) values('91000000-0000-4000-8000-000000000020','rm-practical-a','rm-practical-b','roommate','active');
update public.roommate_preferences set active=false,search_status='stopped',preferred_lga='Keffi' where user_id in('rm-practical-a','rm-practical-b');
set local session_replication_role=origin;
set local role authenticated;
select pg_temp.expect((select count(*)=1 from public.get_my_roommate_matches_page_v2()),'Pause keeps accepted conversation');
reset role;
insert into public.roommate_user_blocks(blocker_user_id,blocked_user_id) values('rm-practical-b','rm-practical-a');
set local role authenticated;
select pg_temp.expect((select count(*)=0 from public.get_my_roommate_matches_page_v2()),'Blocking overrides discovery and accepted profile access');
reset role;
rollback;
