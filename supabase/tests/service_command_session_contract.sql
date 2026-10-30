begin;
create function pg_temp.rejects_session(statement text) returns boolean language plpgsql as $$begin execute statement;return false;exception when others then return position('Active trusted session required' in sqlerrm)>0;end$$;
grant execute on function pg_temp.rejects_session(text) to authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'session_id',gen_random_uuid(),'role','authenticated')::text,true);
set local role authenticated;
do $$declare statement text;begin
 for statement in select unnest(array[
  $q$select public.worker_start_job('99999999-0000-4000-8000-000000000001')$q$,
  $q$select public.worker_mark_complete('99999999-0000-4000-8000-000000000001')$q$,
  $q$select public.customer_confirm_completion('99999999-0000-4000-8000-000000000001')$q$,
  $q$select public.worker_accept_booking('99999999-0000-4000-8000-000000000001',100,'2026-11-01')$q$,
  $q$select public.customer_raise_dispute('99999999-0000-4000-8000-000000000001','Review this job')$q$,
  $q$select public.cancel_booking('99999999-0000-4000-8000-000000000001','Cancel this request')$q$,
  $q$select public.cancel_my_worker_booking('99999999-0000-4000-8000-000000000001','Cancel this request')$q$,
  $q$select public.request_worker_refund_review('99999999-0000-4000-8000-000000000001','worker_no_show','Review this missing service')$q$,
  $q$select public.create_booking_request('missing-worker','Cleaning','Clean the room','Contract address','2026-11-01',null)$q$
 ])loop
  if not pg_temp.rejects_session(statement) then raise exception 'Command did not reject its inactive/untrusted session: %',statement;end if;
 end loop;
end $$;
reset role;
do $$begin
 if public.worker_booking_money_state('paid','release_eligible')<>'release_pending' then raise exception 'Eligible release was not shown as processing';end if;
 if public.worker_booking_money_state('paid','risk_held')<>'review' then raise exception 'Risk-held money was not shown as review';end if;
 if public.worker_booking_money_state('paid',null)<>'review' then raise exception 'Missing protection was presented as paid protection';end if;
 if position('user_approved' in pg_get_functiondef('public.get_my_worker_booking_details(uuid)'::regprocedure))=0 then raise exception 'Completion acknowledgement missing from participant details';end if;
end $$;
rollback;
select 'Nine interactive service commands reject inactive/untrusted Auth sessions; positive whole-job acceptance remains separate' as result;
