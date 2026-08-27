-- Legacy Worker rows can still contain retired external/government identity
-- values. Unrelated updates (such as saving a skill video) must not fail merely
-- because those old values already exist. New or changed retired values remain
-- blocked; the private WeHouse face-check flow is unaffected.
create or replace function public.guard_retired_worker_identity_fields()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    if nullif(btrim(coalesce(new.gov_id_type,'')),'') is not null
      or nullif(btrim(coalesce(new.gov_id_number,'')),'') is not null
      or nullif(btrim(coalesce(new.gov_id_photo_url,'')),'') is not null
      or nullif(btrim(coalesce(new.selfie_photo_url,'')),'') is not null
      or nullif(btrim(coalesce(new.identity_provider,'')),'') is not null
      or nullif(btrim(coalesce(new.identity_reference,'')),'') is not null
    then
      raise exception 'Government/external identity fields are retired. Use the private WeHouse automatic face check.';
    end if;
  elsif (new.gov_id_type,new.gov_id_number,new.gov_id_photo_url,new.selfie_photo_url,new.identity_provider,new.identity_reference)
        is distinct from
        (old.gov_id_type,old.gov_id_number,old.gov_id_photo_url,old.selfie_photo_url,old.identity_provider,old.identity_reference)
    and (
      nullif(btrim(coalesce(new.gov_id_type,'')),'') is not null
      or nullif(btrim(coalesce(new.gov_id_number,'')),'') is not null
      or nullif(btrim(coalesce(new.gov_id_photo_url,'')),'') is not null
      or nullif(btrim(coalesce(new.selfie_photo_url,'')),'') is not null
      or nullif(btrim(coalesce(new.identity_provider,'')),'') is not null
      or nullif(btrim(coalesce(new.identity_reference,'')),'') is not null
    )
  then
    raise exception 'Government/external identity fields are retired. Use the private WeHouse automatic face check.';
  end if;
  return new;
end;
$$;
