-- PostgreSQL regex strings should not receive a doubled slash here. POSIX
-- character classes keep this deterministic with standard_conforming_strings.
create or replace function public.wehouse_state_key(p_value text)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(p_value,''))), '[[:space:]]+state$', ''),
      '[^a-z0-9]+', '', 'g'
    ),
    ''
  )
$$;

create or replace function public.wehouse_lga_key(p_value text)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(p_value,''))), '[[:space:]]+(local government area|lga)$', ''),
      '[^a-z0-9]+', '', 'g'
    ),
    ''
  )
$$;

revoke all on function public.wehouse_state_key(text) from public,anon;
revoke all on function public.wehouse_lga_key(text) from public,anon;
grant execute on function public.wehouse_state_key(text) to authenticated,service_role;
grant execute on function public.wehouse_lga_key(text) to authenticated,service_role;

