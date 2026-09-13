-- Apartment alerts must honor every persisted structured filter.

create or replace function public.notify_matching_saved_home_searches()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if new.deleted_at is not null
     or new.status<>'available'
     or new.availability_status<>'available' then
    return new;
  end if;
  if tg_op='UPDATE'
     and old.status='available'
     and old.availability_status='available' then
    return new;
  end if;

  with matching as materialized (
    select search.id,search.user_id
    from public.saved_searches search
    where search.search_kind='homes'
      and search.notifications_enabled
      and (
        coalesce(search.criteria->>'state','')=''
        or lower(search.criteria->>'state')=lower(coalesce(new.state,''))
      )
      and (
        coalesce(search.criteria->>'city','')=''
        or lower(search.criteria->>'city')=lower(coalesce(new.city,''))
      )
      and coalesce((search.criteria->>'min_price')::numeric,0)<=new.price
      and (
        nullif(search.criteria->>'max_price','') is null
        or new.price<=(search.criteria->>'max_price')::numeric
      )
      and (
        nullif(search.criteria->>'bedrooms','') is null
        or new.bedrooms>=(search.criteria->>'bedrooms')::integer
      )
      and (
        nullif(search.criteria->>'bathrooms','') is null
        or new.bathrooms>=(search.criteria->>'bathrooms')::integer
      )
      and (
        coalesce(search.criteria->>'sub_type','')=''
        or search.criteria->>'sub_type'=coalesce(new.sub_type,'')
      )
  ), inserted as (
    insert into public.notifications(
      recipient_id,type,title,message,related_id,source_type,source_id,
      destination_route,destination_params,event_key
    )
    select
      matching.user_id,
      'saved_search_match',
      'A new home matches your search',
      new.title,
      new.id::text,
      'listing',
      new.id::text,
      'detail',
      jsonb_build_object('listingId',new.id,'listing_id',new.id),
      concat('saved-search:',matching.id,':listing:',new.id)
    from matching
    on conflict(recipient_id,event_key) where event_key is not null do nothing
    returning recipient_id
  )
  update public.saved_searches search
  set last_notified_at=now(),updated_at=now()
  from matching
  where search.id=matching.id;
  return new;
end;
$$;

revoke all on function public.notify_matching_saved_home_searches()
  from public,anon,authenticated;
grant execute on function public.notify_matching_saved_home_searches()
  to service_role;
