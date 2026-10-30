-- Use the same commercial authority as future-price controls and preserve retry receipts.
create or replace function public.set_my_listing_discount(p_listing_id uuid,p_percent numeric,p_ends_on date default null)
returns uuid language plpgsql security definer set search_path='pg_catalog','public' as $body$
declare v_actor text; v_existing uuid;
begin
 if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
 v_actor:=public.current_profile_user_id();
 if not public.current_actor_can_change_property_commercials(p_listing_id) then raise exception 'Full hosting access is required to change discounts'; end if;
 if p_percent is null or p_percent::text in ('NaN','Infinity','-Infinity') or p_percent<5 or p_percent>50 then raise exception 'A discount must be between 5%% and 50%%'; end if;
 if p_ends_on<current_date then raise exception 'Discount end date cannot be in the past'; end if;
 perform 1 from public.listings where id=p_listing_id and deleted_at is null and approved_at is not null and inspection_request_id is not null for update;
 if not found then raise exception 'Published property not found'; end if;
 select d.id into v_existing from public.listing_discounts d where d.listing_id=p_listing_id and d.funded_by='host' and d.active and d.percent=p_percent and d.ends_on is not distinct from p_ends_on and d.starts_on<=current_date order by d.created_at desc limit 1;
 if v_existing is not null and (select count(*) from public.listing_discounts where listing_id=p_listing_id and funded_by='host' and active)=1 then return v_existing; end if;
 update public.listing_discounts set active=false where listing_id=p_listing_id and funded_by='host' and active;
 insert into public.listing_discounts(listing_id,funded_by,percent,ends_on,created_by) values(p_listing_id,'host',p_percent,p_ends_on,v_actor) returning id into v_existing;
 return v_existing;
end;$body$;
create or replace function public.clear_my_listing_discount(p_listing_id uuid)
returns void language plpgsql security definer set search_path='pg_catalog','public' as $body$
begin
 if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
 if not public.current_actor_can_change_property_commercials(p_listing_id) then raise exception 'Full hosting access is required to change discounts'; end if;
 perform 1 from public.listings where id=p_listing_id and deleted_at is null for update;
 if not found then raise exception 'Property not found'; end if;
 update public.listing_discounts set active=false where listing_id=p_listing_id and funded_by='host' and active;
end;$body$;
revoke all on function public.set_my_listing_discount(uuid,numeric,date),public.clear_my_listing_discount(uuid) from public,anon;
grant execute on function public.set_my_listing_discount(uuid,numeric,date),public.clear_my_listing_discount(uuid) to authenticated,service_role;
