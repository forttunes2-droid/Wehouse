-- Property Host chat media: photos/videos only, booking-scoped access.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'property-host-chat-files','property-host-chat-files',false,26214400,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.property_host_chat_storage_access(p_name text)
returns boolean language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare v_first text; v_id uuid;
begin
  v_first:=split_part(coalesce(p_name,''),'/',1);
  if v_first !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then return false; end if;
  v_id:=v_first::uuid;
  return public.property_host_conversation_access(v_id);
end
$$;
revoke all on function public.property_host_chat_storage_access(text) from public,anon;
grant execute on function public.property_host_chat_storage_access(text) to authenticated,service_role;

drop policy if exists property_host_chat_read on storage.objects;
create policy property_host_chat_read on storage.objects
for select to authenticated
using(
  bucket_id='property-host-chat-files'
  and public.property_host_chat_storage_access(name)
);

drop policy if exists property_host_chat_insert on storage.objects;
create policy property_host_chat_insert on storage.objects
for insert to authenticated
with check(
  bucket_id='property-host-chat-files'
  and public.property_host_chat_storage_access(name)
  and split_part(name,'/',2)=public.current_profile_user_id()
);

drop policy if exists property_host_chat_delete_own on storage.objects;
create policy property_host_chat_delete_own on storage.objects
for delete to authenticated
using(
  bucket_id='property-host-chat-files'
  and public.property_host_chat_storage_access(name)
  and split_part(name,'/',2)=public.current_profile_user_id()
);
