-- Creator can see and stop the WeHouse-funded discounts they started.
create or replace function public.creator_list_wehouse_discounts()
returns table(id uuid,state_key text,listing_id uuid,percent numeric,ends_on date)
language plpgsql stable security definer set search_path to 'pg_catalog','public' as $$
begin
  if (public._admin_dashboard_actor()).role<>'creator' then raise exception 'Only the Creator can see WeHouse-funded discounts'; end if;
  return query select d.id,d.state_key,d.listing_id,d.percent,d.ends_on
    from public.listing_discounts d where d.funded_by='wehouse' and d.active order by d.created_at desc;
end $$;

create or replace function public.creator_stop_wehouse_discount(p_id uuid)
returns void language plpgsql security definer set search_path to 'pg_catalog','public' as $$
begin
  if (public._admin_dashboard_actor()).role<>'creator' then raise exception 'Only the Creator can stop a WeHouse-funded discount'; end if;
  update public.listing_discounts set active=false where id=p_id and funded_by='wehouse';
end $$;

revoke all on function public.creator_list_wehouse_discounts(),public.creator_stop_wehouse_discount(uuid) from public,anon;
grant execute on function public.creator_list_wehouse_discounts(),public.creator_stop_wehouse_discount(uuid) to authenticated,service_role;
