create function private.guard_unit_home_style_consistency()
returns trigger language plpgsql security definer set search_path='' as $body$
declare v_root uuid;
begin
 if new.home_style is null or new.physical_space_id is null then return new; end if;
 select s.root_unit_id into v_root from public.property_spaces s where s.id=new.physical_space_id;
 if v_root is null then raise exception 'Physical home identity is missing'; end if;
 perform 1 from public.property_spaces where id=v_root for update;
 if exists(select 1 from public.inspection_requests r join public.property_spaces s on s.id=r.physical_space_id
  where s.root_unit_id=v_root and r.id<>new.id and r.home_style is not null and r.home_style<>new.home_style)
 then raise exception 'This physical home already has a different home type. Request a review before changing its classification'; end if;
 return new;
end;
$body$;
revoke all on function private.guard_unit_home_style_consistency() from public,anon,authenticated,service_role;
create trigger inspection_unit_home_style_consistency after insert or update of home_style,physical_space_id on public.inspection_requests
for each row execute function private.guard_unit_home_style_consistency();
