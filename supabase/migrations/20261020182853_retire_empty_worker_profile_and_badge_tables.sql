-- Retire empty, unused predecessors only. Never discard historical records.
do $retire$
declare target text;relation regclass;has_rows boolean;
begin
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prokind='f'
   and (pg_get_functiondef(p.oid) ~* 'blue_badge_subscriptions'
    or pg_get_functiondef(p.oid) ~* '\m(from|join|update|into|table)[[:space:]]+(public[.])?workers\M')) then
  raise exception 'A database function still references a retired Worker table';
 end if;
 foreach target in array array['workers','blue_badge_subscriptions'] loop
  relation:=to_regclass(format('public.%I',target));
  if relation is null then continue;end if;
  execute format('lock table public.%I in access exclusive mode',target);
  execute format('select exists(select 1 from public.%I)',target) into has_rows;
  if has_rows then raise exception 'Table % contains historical rows; reviewed archival disposition required',target;end if;
  -- Catalog dependencies must be reviewed rather than removed with CASCADE.
  execute format('drop table public.%I restrict',target);
 end loop;
end $retire$;
