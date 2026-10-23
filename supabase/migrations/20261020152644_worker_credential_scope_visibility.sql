-- Preserve function identities and grants while tightening evidence review scope.
do $upgrade$
declare
 definition text := pg_get_functiondef('public.can_access_worker_credentials(text,boolean)'::regprocedure);
 needle text := 'return public.current_staff_can_review_worker(p_worker_id) or public.current_oversight_can_review_worker(p_worker_id);';
begin
 if position(needle in definition)=0 then raise exception 'Worker credential access definition changed'; end if;
 execute replace(definition,needle,'return (public.current_staff_can_review_worker(p_worker_id) or public.current_oversight_can_review_worker(p_worker_id)) and not exists (select 1 from public.worker_service_coverage c where c.worker_id=p_worker_id and not public.current_actor_in_scope(c.state,c.lga));');
 definition := pg_get_functiondef('public.get_worker_credential_review(text)'::regprocedure);
 needle := 'return jsonb_build_object(''configured''';
 if position(needle in definition)=0 then raise exception 'Worker credential receipt definition changed'; end if;
 execute replace(definition,needle,'return jsonb_build_object(''service_context'',private.worker_credential_context(p_worker_id),''requirements_context'',v.credential_context,''configured''');
end $upgrade$;
