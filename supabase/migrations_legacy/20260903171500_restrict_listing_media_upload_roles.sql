-- Generic Operations members prepare listing text and pricing; they do not
-- upload property media. Property Partners submit source images, while an
-- assigned Field Operations member may upload only that inspection's evidence.

drop policy if exists listing_media_insert_authorized on storage.objects;
create policy listing_media_insert_authorized
on storage.objects
for insert
to authenticated
with check (
  bucket_id in ('listing-images', 'listing-videos', 'listings')
  and exists (
    select 1
    from public.profiles actor
    where actor.auth_id = auth.uid()::text
      and not coalesce(actor.deleted, false)
      and not coalesce(actor.suspended, false)
      and not coalesce(actor.banned, false)
      and (
        actor.role in ('admin', 'creator')
        or (actor.role = 'property_partner' and bucket_id = 'listing-images')
        or (
          actor.role = 'staff'
          and bucket_id in ('listing-images', 'listing-videos')
          and public.current_staff_has_permission('field_officer')
          and exists (
            select 1
            from public.inspection_requests request
            where coalesce(request.assigned_field_officer_id, request.field_officer_id, request.assigned_to) = actor.user_id
              and (storage.foldername(name))[1] = 'listings'
              and (storage.foldername(name))[2] = 'field-inspection-' || request.id::text
              and request.lifecycle_stage = 'inspection'
              and request.status in ('scheduled', 'in_progress')
          )
        )
      )
  )
);

drop policy if exists listing_images_ops_insert on storage.objects;
create policy listing_images_ops_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'listing-images'
  and (storage.foldername(name))[1] = 'listings'
  and (storage.foldername(name))[2] like ('draft-' || public.current_profile_user_id() || '-%')
  and public.current_profile_role() in ('admin', 'creator')
);

drop policy if exists listing_videos_ops_insert on storage.objects;
create policy listing_videos_ops_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'listing-videos'
  and (storage.foldername(name))[1] = 'listings'
  and (storage.foldername(name))[2] like ('draft-' || public.current_profile_user_id() || '-%')
  and public.current_profile_role() in ('admin', 'creator')
);

drop policy if exists listings_storage_ops_insert on storage.objects;
create policy listings_storage_ops_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'listings'
  and public.current_profile_role() in ('admin', 'creator')
);

-- Existing source media is immutable to Operations accounts after upload.
-- Field evidence uses new UUID object names and is submitted through the
-- assignment-scoped RPC, so it does not need generic update/delete access.
drop policy if exists listing_media_update_owner on storage.objects;
create policy listing_media_update_owner
on storage.objects
for update
to authenticated
using (
  bucket_id in ('listing-images', 'listing-videos', 'listings')
  and owner_id = auth.uid()::text
  and public.current_profile_role() in ('property_partner', 'admin', 'creator')
)
with check (
  bucket_id in ('listing-images', 'listing-videos', 'listings')
  and owner_id = auth.uid()::text
  and public.current_profile_role() in ('property_partner', 'admin', 'creator')
);

drop policy if exists listing_media_delete_owner_or_creator on storage.objects;
create policy listing_media_delete_owner_or_creator
on storage.objects
for delete
to authenticated
using (
  bucket_id in ('listing-images', 'listing-videos', 'listings')
  and (
    public.current_profile_role() = 'creator'
    or (owner_id = auth.uid()::text and public.current_profile_role() in ('property_partner', 'admin'))
  )
);

drop policy if exists listing_images_ops_update on storage.objects;
create policy listing_images_ops_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'listing-images'
  and (storage.foldername(name))[1] = 'listings'
  and (storage.foldername(name))[2] like ('draft-' || public.current_profile_user_id() || '-%')
  and public.current_profile_role() in ('admin', 'creator')
)
with check (
  bucket_id = 'listing-images'
  and (storage.foldername(name))[1] = 'listings'
  and (storage.foldername(name))[2] like ('draft-' || public.current_profile_user_id() || '-%')
  and public.current_profile_role() in ('admin', 'creator')
);

drop policy if exists listing_images_ops_delete on storage.objects;
create policy listing_images_ops_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'listing-images'
  and (storage.foldername(name))[1] = 'listings'
  and (storage.foldername(name))[2] like ('draft-' || public.current_profile_user_id() || '-%')
  and public.current_profile_role() in ('admin', 'creator')
);

drop policy if exists listing_videos_ops_update on storage.objects;
create policy listing_videos_ops_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'listing-videos'
  and (storage.foldername(name))[1] = 'listings'
  and (storage.foldername(name))[2] like ('draft-' || public.current_profile_user_id() || '-%')
  and public.current_profile_role() in ('admin', 'creator')
)
with check (
  bucket_id = 'listing-videos'
  and (storage.foldername(name))[1] = 'listings'
  and (storage.foldername(name))[2] like ('draft-' || public.current_profile_user_id() || '-%')
  and public.current_profile_role() in ('admin', 'creator')
);

drop policy if exists listing_videos_ops_delete on storage.objects;
create policy listing_videos_ops_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'listing-videos'
  and (storage.foldername(name))[1] = 'listings'
  and (storage.foldername(name))[2] like ('draft-' || public.current_profile_user_id() || '-%')
  and public.current_profile_role() in ('admin', 'creator')
);

drop policy if exists listings_storage_ops_update on storage.objects;
create policy listings_storage_ops_update
on storage.objects
for update
to authenticated
using (bucket_id = 'listings' and public.current_profile_role() in ('admin', 'creator'))
with check (bucket_id = 'listings' and public.current_profile_role() in ('admin', 'creator'));

drop policy if exists listings_storage_ops_delete on storage.objects;
create policy listings_storage_ops_delete
on storage.objects
for delete
to authenticated
using (bucket_id = 'listings' and public.current_profile_role() in ('admin', 'creator'));
