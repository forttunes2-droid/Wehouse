-- WeHouse may fund a small part of its configured commission. The Host's
-- separate 5–50% offer range is unchanged.
do $extend$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.creator_set_experience_discount(text,text,integer,numeric,date,uuid,text)'::regprocedure);
 needle:='(p_percent<>0 and p_percent not between 5 and 50)';
 if strpos(definition,needle)=0 then raise exception 'Inspect Creator funded discount bounds';end if;
 definition:=replace(definition,needle,'(p_percent<>0 and p_percent not between 0.01 and 50)');
 definition:=replace(definition,'Choose 0 to stop or 5–50 percent','Choose 0 to stop or 0.01–50 percent');
 execute definition;
end $extend$;
