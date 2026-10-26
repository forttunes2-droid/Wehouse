-- Preserve publication, location, price, occupancy and cursor authority. Only the
-- text predicate changes: words may match different public fields in any order.
create function private.discovery_text_matches(p_text text,p_query text)
returns boolean language sql immutable parallel safe set search_path='' as $body$
 select not exists (
   select 1 from pg_catalog.regexp_split_to_table(pg_catalog.lower(pg_catalog.left(pg_catalog.btrim(coalesce(p_query,'')),80)),E'\\s+') word
   where word<>'' and pg_catalog.strpos(pg_catalog.lower(coalesce(p_text,'')),word)=0
 );
$body$;
revoke all on function private.discovery_text_matches(text,text) from public,anon,authenticated,service_role;

-- Assert the known function bodies before replacing the exact predicate. A drift
-- fails migration replay rather than silently retaining mismatched search rules.
do $body$
declare source text; prior text; replacement text;
begin
 source:=pg_get_functiondef('public.search_discoverable_homes(text,text,text,text,numeric,numeric,integer,integer,timestamptz,uuid,integer,text)'::regprocedure);
 prior:=$old$(nullif(btrim($1),'') is null or
        strpos(lower(coalesce(l.title,'')),lower(left(btrim($1),80))) > 0 or
        strpos(lower(coalesce(l.address,'')),lower(left(btrim($1),80))) > 0 or
        strpos(lower(coalesce(l.city,'')),lower(left(btrim($1),80))) > 0 or
        strpos(lower(coalesce(l.state,'')),lower(left(btrim($1),80))) > 0)$old$;
 replacement:=$new$private.discovery_text_matches(concat_ws(' ',l.title,l.address,l.city,l.state,l.home_style,
        case when l.bedrooms is not null then l.bedrooms::text||' bedroom '||l.bedrooms::text||' bed' else '' end,
        case when l.bedrooms=0 and l.space_scope is distinct from 'private_room' then 'studio self-contained self contained' else '' end,
        case when l.sub_type='short_let' then 'short let shortlet' when l.sub_type='long_stay' then 'long let longlet' else '' end),$1)$new$;
 if strpos(source,prior)=0 then raise exception 'Home search predicate changed; inspect before updating'; end if;
 execute replace(source,prior,replacement);

 source:=pg_get_functiondef('public.search_discoverable_hotels(text,text,text,text[],numeric,numeric,double precision,double precision,numeric,boolean,timestamptz,integer,integer)'::regprocedure);
 prior:=$old$(nullif(btrim($1),'') is null or
        strpos(lower(h.name),lower(left(btrim($1),80))) > 0)$old$;
 replacement:=$new$private.discovery_text_matches(concat_ws(' ',h.name,h.city,h.state),$1)$new$;
 if strpos(source,prior)=0 then raise exception 'Hotel search predicate changed; inspect before updating'; end if;
 execute replace(source,prior,replacement);
end;
$body$;
