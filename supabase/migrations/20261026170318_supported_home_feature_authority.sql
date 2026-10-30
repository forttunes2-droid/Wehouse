-- Homes are organized by rental terms, space and bedroom layout. Penthouse is
-- the agreed optional feature; do not introduce a separate property catalogue.
create or replace function private.guard_home_style_submission()
returns trigger language plpgsql set search_path='' as $body$
begin
 if (tg_op='INSERT' and new.home_style is not null)
    or (tg_op='UPDATE' and new.home_style is distinct from old.home_style) then
  if current_setting('wehouse.home_style_command',true) is distinct from 'submission' then
   raise exception 'Home feature must come from the property submission';
  end if;
  if new.home_style is not null and new.home_style<>'penthouse' then
   raise exception 'Unsupported home feature';
  end if;
 end if;
 return new;
end;
$body$;
revoke all on function private.guard_home_style_submission() from public,anon,authenticated,service_role;

do $body$
declare source text; needle text:=E'begin\n  execute $query$';
begin
 source:=pg_get_functiondef('public.search_discoverable_homes(text,text,text,text,numeric,numeric,integer,integer,timestamptz,uuid,integer,text)'::regprocedure);
 if strpos(source,needle)=0 then raise exception 'Inspect Home search before retiring unsupported filters'; end if;
 execute replace(source,needle,E'begin\n  if nullif(btrim(p_home_style),\'\') is not null and p_home_style<>\'penthouse\' then raise exception \'Unsupported home feature filter\'; end if;\n  execute $query$');
end;
$body$;
