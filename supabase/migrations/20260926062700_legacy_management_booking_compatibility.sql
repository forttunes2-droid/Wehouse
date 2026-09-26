-- Compatibility bridge for properties published before the owner has explicitly
-- chosen Host-managed or WeHouse-managed responsibility.
-- Once management_updated_at is set, explicit approval rules remain mandatory.

create or replace function public.snapshot_property_management_on_reservation()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_listing public.listings;
begin
  select * into v_listing from public.listings
  where id::text=new.listing_id or listing_id=new.listing_id
  limit 1;
  if v_listing.id is null then return new; end if;

  if v_listing.management_mode='host' then
    if v_listing.management_host_user_id is null
       or not exists(
         select 1 from public.property_host_assignments a
         where a.listing_id=v_listing.id
           and a.user_id=v_listing.management_host_user_id
           and a.status='active'
       ) then
      raise exception 'This Host-managed property has no active responsible host';
    end if;
    new.management_mode_snapshot:='host';
    new.responsible_host_user_id:=v_listing.management_host_user_id;
  else
    if v_listing.wehouse_management_status<>'approved'
       and v_listing.management_updated_at is not null then
      raise exception 'WeHouse management is not yet approved for this property';
    end if;
    -- management_updated_at NULL means the listing predates an explicit choice
    -- (or the legacy publishing path has not exposed the new control yet).
    -- Preserve the old WeHouse-managed behavior only for that unconfigured state.
    new.management_mode_snapshot:='wehouse';
    new.responsible_host_user_id:=null;
  end if;
  return new;
end
$$;
