create or replace function public.sync_inspection_request_canonical_media()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.inspection_request_id is not null then
    update public.inspection_requests
       set photo_urls = coalesce(new.images, array[]::text[]),
           video_urls = coalesce(new.videos, array[]::text[]),
           updated_at = now()
     where id = new.inspection_request_id
       and (photo_urls is distinct from coalesce(new.images, array[]::text[])
         or video_urls is distinct from coalesce(new.videos, array[]::text[]));
  end if;
  return new;
end;
$$;

revoke all on function public.sync_inspection_request_canonical_media() from public, anon, authenticated;

drop trigger if exists listings_sync_canonical_media on public.listings;
create trigger listings_sync_canonical_media
after insert or update of images, videos on public.listings
for each row execute function public.sync_inspection_request_canonical_media();

create or replace function public.sync_hotel_inspection_canonical_media()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.inspection_request_id is not null then
    update public.inspection_requests
       set photo_urls = coalesce(new.images, array[]::text[]),
           updated_at = now()
     where id = new.inspection_request_id
       and photo_urls is distinct from coalesce(new.images, array[]::text[]);
  end if;
  return new;
end;
$$;

revoke all on function public.sync_hotel_inspection_canonical_media() from public, anon, authenticated;

drop trigger if exists hotels_sync_canonical_media on public.hotels;
create trigger hotels_sync_canonical_media
after insert or update of images on public.hotels
for each row execute function public.sync_hotel_inspection_canonical_media();
