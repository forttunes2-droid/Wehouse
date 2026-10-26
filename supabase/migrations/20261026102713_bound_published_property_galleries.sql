begin;
create or replace function private.limit_property_gallery()
returns trigger language plpgsql set search_path='' as $$
declare media jsonb:=to_jsonb(new)->'images';
begin
 if tg_op='UPDATE' and media is not distinct from (to_jsonb(old)->'images') then return new;end if;
 if media is null or media='null'::jsonb then return new;end if;
 if jsonb_typeof(media) is distinct from 'array' then raise exception 'Choose uploaded property photos';end if;
 if jsonb_array_length(media)>12 then raise exception 'Keep up to 12 photos in each property or room gallery';end if;
 return new;
end $$;
revoke all on function private.limit_property_gallery() from public,anon,authenticated;
create trigger property_gallery_limit before insert or update of images on public.listings for each row execute function private.limit_property_gallery();
create trigger hotel_gallery_limit before insert or update of images on public.hotels for each row execute function private.limit_property_gallery();
create trigger hotel_room_gallery_limit before insert or update of images on public.hotel_rooms for each row execute function private.limit_property_gallery();
commit;
