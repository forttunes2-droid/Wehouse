create or replace function public.creator_update_listing(p_listing_id uuid, p_changes jsonb)
returns public.listings
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_row public.listings; v_images text[];
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_actor is null or v_actor.role not in ('creator','admin') or coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then
    raise exception 'Creator or Admin access required';
  end if;
  if p_changes ? 'images' then
    select coalesce(array_agg(value),array[]::text[]) into v_images
    from jsonb_array_elements_text(coalesce(p_changes->'images','[]'::jsonb));
  end if;
  update public.listings set
    title=case when p_changes ? 'title' then nullif(btrim(p_changes->>'title'),'') else title end,
    description=case when p_changes ? 'description' then nullif(btrim(p_changes->>'description'),'') else description end,
    price=case when p_changes ? 'price' then (p_changes->>'price')::numeric else price end,
    images=case when p_changes ? 'images' then v_images else images end,
    updated_at=now()
  where id=p_listing_id and deleted_at is null
  returning * into v_row;
  if v_row.id is null then raise exception 'Listing not found'; end if;
  if v_row.title is null or v_row.price<=0 then raise exception 'A title and valid price are required'; end if;
  return v_row;
end
$$;

create or replace function public.creator_remove_listing(p_listing_id uuid, p_reason text default null)
returns boolean
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_row public.listings;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_actor is null or v_actor.role not in ('creator','admin') or coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then
    raise exception 'Creator or Admin access required';
  end if;
  select * into v_row from public.listings where id=p_listing_id and deleted_at is null for update;
  if v_row.id is null then raise exception 'Listing not found'; end if;
  if exists(select 1 from public.reservations r where r.listing_id::text=p_listing_id::text and r.status in ('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')) then
    raise exception 'This property has an active reservation and cannot be removed. Resolve the reservation first.';
  end if;
  update public.listings set deleted_at=now(),status='closed',availability_status='unavailable',current_reservation_id=null,updated_at=now() where id=p_listing_id;
  return true;
end
$$;

revoke all on function public.creator_update_listing(uuid,jsonb) from public,anon;
revoke all on function public.creator_remove_listing(uuid,text) from public,anon;
grant execute on function public.creator_update_listing(uuid,jsonb) to authenticated;
grant execute on function public.creator_remove_listing(uuid,text) to authenticated;
