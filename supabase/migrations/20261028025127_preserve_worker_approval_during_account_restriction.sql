-- Account restrictions and professional review are distinct state machines.
-- Keep approved/rejected/pending work status and all private evidence intact.
do $preserve_professional_state$
declare definition text; suspend_line text; restore_line text;
begin
 definition:=replace(pg_get_functiondef('public._set_account_suspension(text,text,boolean,text)'::regprocedure),chr(13),'');
 suspend_line:=$line$worker_status=case when role='worker' then 'suspended' else worker_status end,$line$;
 restore_line:=$line$worker_status=case when role='worker' then 'pending' else worker_status end,$line$;
 if strpos(definition,suspend_line)=0 or strpos(definition,restore_line)=0 then
  raise exception 'Inspect account restriction helper before preserving professional state';
 end if;
 execute replace(replace(definition,suspend_line,''),restore_line,'');
end $preserve_professional_state$;
-- Existing legacy professional restrictions are not silently converted to approved.
-- Their earlier professional state cannot be inferred from an account restore.
