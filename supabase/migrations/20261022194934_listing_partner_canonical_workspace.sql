-- Property Partner is an additive workspace, not a mutually exclusive profile role.
create or replace function public.enforce_property_partner_listing_owner()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if nullif(btrim(new.partner_id),'') is not null then
  if not exists(select 1 from public.profiles where user_id=new.partner_id) then
   raise exception 'Assigned Property Partner profile was not found';
  end if;
  if tg_op='INSERT' then
   if not public.user_has_active_workspace(new.partner_id,'property_partner') then
    raise exception 'Assigned listing partner needs an active Property Partner workspace';
   end if;
  elsif new.partner_id is distinct from old.partner_id then
   if not public.user_has_active_workspace(new.partner_id,'property_partner') then
    raise exception 'Assigned listing partner needs an active Property Partner workspace';
   end if;
  end if;
  -- Existing bookings and records keep their owner after access is revoked.
  new.owner_id:=new.partner_id;
 end if;
 return new;
end; $$;
