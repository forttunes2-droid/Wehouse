\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAILED: %', description; end if; end $$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end $$;
select public._validate_property_submission_facts('[{"property_type":"apartment","bedrooms":0,"bathrooms":1}]');
select public._validate_property_submission_facts('[{"property_type":"hotel","hotel_program":{"room_types":[{"guest_capacity":2,"inventory":1}]}}]');
select pg_temp.expect(pg_temp.rejects($q$select public._validate_property_submission_facts('[{"property_type":"apartment","bathrooms":1}]')$q$),'missing bedroom count rejected');
select pg_temp.expect(pg_temp.rejects($q$select public._validate_property_submission_facts('[{"property_type":"apartment","bedrooms":1,"bathrooms":-1}]')$q$),'negative bathroom count rejected');
select pg_temp.expect(pg_temp.rejects($q$select public._validate_property_submission_facts('[{"property_type":"hotel","hotel_program":{"room_types":[{"guest_capacity":0,"inventory":1}]}}]')$q$),'zero Hotel guest capacity rejected');
select pg_temp.expect(pg_temp.rejects($q$select public._validate_property_submission_facts('[{"property_type":"hotel","hotel_program":{"room_types":[{"guest_capacity":2,"inventory":1.5}]}}]')$q$),'fractional inventory rejected');
select pg_temp.expect(pg_temp.rejects($q$select public._validate_property_submission_facts('[{"property_type":"hotel","hotel_program":{"room_types":[{"inventory":1}]}}]')$q$),'missing guest capacity rejected rather than defaulting to one');
select pg_temp.expect(pg_temp.rejects($q$select public._validate_property_submission_facts('[{"property_type":"hotel","hotel_program":{"room_types":[]}}]')$q$),'empty Hotel program rejected');
select pg_temp.expect(pg_temp.rejects($q$select public._validate_property_submission_facts('{}')$q$),'malformed submission list rejected');
select pg_temp.expect(pg_temp.rejects($q$select public._validate_property_submission_facts('[{"property_type":"apartment","bedrooms":999999999999,"bathrooms":1}]')$q$),'unsupported integer range rejected');
select pg_temp.expect(not has_function_privilege('authenticated','public._validate_property_submission_facts(jsonb)','execute'),'validation helper is not a client API');
select pg_temp.expect(not has_function_privilege('anon','public.create_my_property_inspection_batch_v4(uuid,jsonb)','execute'),'anonymous submission denied');
select pg_temp.expect(position('perform public._validate_property_submission_facts(p_items);' in pg_get_functiondef('public.create_my_property_inspection_batch_v4(uuid,jsonb)'::regprocedure))>0,'submission command invokes validation');
select 'property_submission_facts_contract_ok' as result;
rollback;
