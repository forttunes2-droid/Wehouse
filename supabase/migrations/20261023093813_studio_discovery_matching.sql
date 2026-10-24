-- Zero bedrooms means Studio / self-contained, never an unset minimum.
do $migration$
declare v_source text;
begin
 select pg_get_functiondef('public.search_discoverable_homes(text,text,text,text,numeric,numeric,integer,integer,timestamptz,uuid,integer)'::regprocedure) into v_source;
 if strpos(v_source,'($7 is null or l.bedrooms >= $7)')=0 then raise exception 'Home search predicate changed; review migration'; end if;
 v_source:=replace(v_source,'($7 is null or l.bedrooms >= $7)',
  '($7 is null or ($7=0 and l.bedrooms=0 and l.space_scope is distinct from ''private_room'') or ($7>0 and l.bedrooms >= $7))');
 execute v_source;
 select pg_get_functiondef('public.notify_matching_saved_home_searches()'::regprocedure) into v_source;
 if strpos(v_source,'new.bedrooms>=(search.criteria->>''bedrooms'')::integer')=0 then raise exception 'Saved home search predicate changed; review migration'; end if;
 v_source:=replace(v_source,'new.bedrooms>=(search.criteria->>''bedrooms'')::integer',
  'case when (search.criteria->>''bedrooms'')::integer=0 then new.bedrooms=0 and new.space_scope is distinct from ''private_room'' else new.bedrooms>=(search.criteria->>''bedrooms'')::integer end');
 execute v_source;
end
$migration$;
