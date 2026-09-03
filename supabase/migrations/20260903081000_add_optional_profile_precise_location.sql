alter table public.profiles
  add column if not exists precise_latitude numeric,
  add column if not exists precise_longitude numeric,
  add column if not exists precise_address text,
  add column if not exists precise_location_accuracy_m numeric,
  add column if not exists precise_location_updated_at timestamptz;

create or replace function public.update_my_precise_location(p_latitude numeric,p_longitude numeric,p_address text default null,p_accuracy_m numeric default null)
returns public.profiles language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_profile public.profiles;
begin
  if (p_latitude is null) <> (p_longitude is null) then raise exception 'Latitude and longitude must be saved together'; end if;
  if p_latitude is not null and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180) then raise exception 'Invalid coordinates'; end if;
  if length(coalesce(p_address,''))>500 then raise exception 'Address is too long'; end if;
  update public.profiles set precise_latitude=p_latitude,precise_longitude=p_longitude,precise_address=case when p_latitude is null then null else nullif(btrim(p_address),'') end,precise_location_accuracy_m=case when p_latitude is null or p_accuracy_m<0 then null else p_accuracy_m end,precise_location_updated_at=case when p_latitude is null then null else now() end,updated_at=now()
  where auth_id=auth.uid()::text and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) returning * into v_profile;
  if v_profile is null then raise exception 'Active profile not found'; end if;
  return v_profile;
end $$;
revoke all on function public.update_my_precise_location(numeric,numeric,text,numeric) from public,anon;
grant execute on function public.update_my_precise_location(numeric,numeric,text,numeric) to authenticated,service_role;
