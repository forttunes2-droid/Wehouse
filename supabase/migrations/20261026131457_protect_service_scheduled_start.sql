begin;
do $guard$
declare definition text;anchor text:=$a$  v_from:=coalesce(v_booking.canonical_job_state,'confirmed');$a$;
begin
 definition:=pg_get_functiondef('public.worker_start_job(uuid)'::regprocedure);
 if position(anchor in definition)=0 then raise exception 'Inspect Service start authority before upgrading';end if;
 execute replace(definition,anchor,E'  IF v_booking.service_quote IS NOT NULL AND clock_timestamp()<(v_booking.service_quote->>''starts_at'')::timestamptz THEN\n    RAISE EXCEPTION ''This Service cannot start before its accepted start time'';\n  END IF;\n'||anchor);
end $guard$;
commit;
