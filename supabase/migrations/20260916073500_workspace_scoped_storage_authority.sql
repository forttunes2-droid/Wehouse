begin;

-- Multi-workspace identities keep one Personal profile. Storage must therefore
-- authorize the active workspace/capability, not whichever compatibility value
-- happens to be stored in profiles.role.

-- Private face/liveness references: owner only, plus existing separately-scoped
-- oversight read policy. Either Service Provider or Property Partner may use the
-- identity-continuity flow when the policy gate is enabled.
drop policy if exists "account owners read private identity reference" on storage.objects;
drop policy if exists "account owners upload private identity reference" on storage.objects;
drop policy if exists "worker_identity_read_own" on storage.objects;
drop policy if exists "worker_identity_insert_own" on storage.objects;
drop policy if exists "worker_identity_delete_own" on storage.objects;

create policy "account_identity_owner_read"
on storage.objects for select to authenticated
using (
  bucket_id='worker-identity-private'
  and (storage.foldername(name))[1]=public.current_profile_user_id()
  and (
    public.current_actor_has_workspace('worker',null)
    or public.current_actor_has_workspace('property_partner',null)
  )
);

create policy "account_identity_owner_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id='worker-identity-private'
  and (storage.foldername(name))[1]=public.current_profile_user_id()
  and (
    public.current_actor_has_workspace('worker',null)
    or public.current_actor_has_workspace('property_partner',null)
  )
);

create policy "account_identity_owner_delete"
on storage.objects for delete to authenticated
using (
  bucket_id='worker-identity-private'
  and (storage.foldername(name))[1]=public.current_profile_user_id()
  and (
    public.current_actor_has_workspace('worker',null)
    or public.current_actor_has_workspace('property_partner',null)
  )
);

-- Service Provider professional evidence remains private. A Personal identity
-- with an active Service Provider workspace can manage only its own folder.
drop policy if exists "worker_private_read_own" on storage.objects;
drop policy if exists "worker_private_insert_own" on storage.objects;
drop policy if exists "worker_private_delete_own" on storage.objects;

create policy "service_provider_evidence_owner_read"
on storage.objects for select to authenticated
using (
  bucket_id=any(array['worker-certificates','worker-verification-videos']::text[])
  and public.current_actor_has_workspace('worker',null)
  and (storage.foldername(name))[1]=public.current_profile_user_id()
);

create policy "service_provider_evidence_owner_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id=any(array['worker-certificates','worker-verification-videos']::text[])
  and public.current_actor_has_workspace('worker',null)
  and (storage.foldername(name))[1]=public.current_profile_user_id()
);

create policy "service_provider_evidence_owner_delete"
on storage.objects for delete to authenticated
using (
  bucket_id=any(array['worker-certificates','worker-verification-videos']::text[])
  and public.current_actor_has_workspace('worker',null)
  and (storage.foldername(name))[1]=public.current_profile_user_id()
);

-- Service Provider showcase media is private storage exposed only through the
-- verified-post read model. Workspace access, not profiles.role, owns writes.
drop policy if exists "worker_showcase_object_read" on storage.objects;
drop policy if exists "worker_showcase_object_select" on storage.objects;
drop policy if exists "worker_showcase_object_insert" on storage.objects;
drop policy if exists "worker_showcase_object_delete" on storage.objects;

create policy "service_provider_showcase_owner_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id='worker-showcase'
  and (storage.foldername(name))[1]=public.current_profile_user_id()
  and public.current_actor_has_workspace('worker',null)
  and exists(
    select 1 from public.profiles p
    where p.user_id=public.current_profile_user_id()
      and p.worker_status='verified'
      and coalesce(p.worker_verified,false)
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
  )
);

create policy "service_provider_showcase_owner_delete"
on storage.objects for delete to authenticated
using (
  bucket_id='worker-showcase'
  and (storage.foldername(name))[1]=public.current_profile_user_id()
  and public.current_actor_has_workspace('worker',null)
);

create policy "service_provider_showcase_read"
on storage.objects for select to authenticated
using (
  bucket_id='worker-showcase'
  and (
    (
      (storage.foldername(name))[1]=public.current_profile_user_id()
      and public.current_actor_has_workspace('worker',null)
    )
    or exists(
      select 1 from public.worker_showcase_posts post
      where post.storage_path=storage.objects.name
        and post.deleted_at is null
        and post.hidden_at is null
        and post.kind='work_post'
        and private.is_public_verified_worker(post.worker_id)
    )
  )
);

-- Property access video is private evidence. A multi-role Partner must not lose
-- access merely because another compatibility role is projected on the profile.
drop policy if exists "property partners read own access evidence" on storage.objects;
drop policy if exists "property partners upload own access evidence" on storage.objects;
drop policy if exists "property partners delete failed access evidence" on storage.objects;

create policy "property_partner_access_evidence_read"
on storage.objects for select to authenticated
using (
  bucket_id='property-access-private'
  and public.current_actor_has_workspace('property_partner',null)
  and split_part(name,'/',1)=public.current_profile_user_id()
);

create policy "property_partner_access_evidence_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id='property-access-private'
  and public.current_actor_has_workspace('property_partner',null)
  and split_part(name,'/',1)=public.current_profile_user_id()
);

create policy "property_partner_access_evidence_delete"
on storage.objects for delete to authenticated
using (
  bucket_id='property-access-private'
  and public.current_actor_has_workspace('property_partner',null)
  and split_part(name,'/',1)=public.current_profile_user_id()
);

-- Private property/hotel submission candidates are the Partner's onboarding
-- upload lane. Field Operations may upload only to an assigned live inspection.
drop policy if exists "listing_candidates_insert_source" on storage.objects;
create policy "listing_candidates_insert_source"
on storage.objects for insert to authenticated
with check (
  bucket_id='listing-candidates'
  and (
    (
      public.current_actor_has_workspace('property_partner',null)
      and (storage.foldername(name))[1]='partner'
      and (storage.foldername(name))[2]=public.current_profile_user_id()
    )
    or (
      public.current_staff_has_permission('field_officer')
      and (storage.foldername(name))[1]='field'
      and exists(
        select 1 from public.inspection_requests request
        where request.id::text=(storage.foldername(name))[2]
          and coalesce(
            request.assigned_field_officer_id,
            request.field_officer_id,
            request.assigned_to
          )=public.current_profile_user_id()
          and request.lifecycle_stage='inspection'
          and request.status=any(array['scheduled','in_progress']::text[])
      )
    )
  )
);

-- Retire the generic rule that let a Partner workspace write arbitrary public
-- listing objects. Public housing media is prepared by WeHouse Operations from
-- private candidates. The only Partner direct-public exception retained is an
-- already-active hotel, scoped to that exact owned hotel path, for operational
-- hotel/room image maintenance.
drop policy if exists "listing_media_insert_authorized" on storage.objects;
create policy "listing_media_insert_authorized"
on storage.objects for insert to authenticated
with check (
  bucket_id=any(array['listing-images','listing-videos','listings']::text[])
  and (
    public.current_actor_has_workspace('creator',null)
    or public.current_actor_has_workspace('admin',null)
    or (
      bucket_id=any(array['listing-images','listing-videos']::text[])
      and public.current_staff_has_permission('field_officer')
      and (storage.foldername(name))[1]='listings'
      and exists(
        select 1 from public.inspection_requests request
        where (storage.foldername(name))[2]='field-inspection-'||request.id::text
          and coalesce(
            request.assigned_field_officer_id,
            request.field_officer_id,
            request.assigned_to
          )=public.current_profile_user_id()
          and request.lifecycle_stage='inspection'
          and request.status=any(array['scheduled','in_progress']::text[])
      )
    )
    or (
      bucket_id='listing-images'
      and public.current_actor_has_workspace('property_partner',null)
      and (storage.foldername(name))[1]='hotels'
      and (storage.foldername(name))[2] ~ '^[0-9]+$'
      and exists(
        select 1 from public.hotels hotel
        where hotel.hotel_id=(storage.foldername(name))[2]::integer
          and hotel.owner_id=public.current_profile_user_id()
          and hotel.status='active'
      )
    )
  )
);

-- Generic mutation of already-public media follows the same owner/authority
-- boundary. Specific Operations policies remain in place for final galleries.
drop policy if exists "listing_media_update_owner" on storage.objects;
create policy "listing_media_update_owner"
on storage.objects for update to authenticated
using (
  bucket_id=any(array['listing-images','listing-videos','listings']::text[])
  and (
    public.current_actor_has_workspace('creator',null)
    or public.current_actor_has_workspace('admin',null)
    or (
      bucket_id='listing-images'
      and owner_id=(select auth.uid())::text
      and public.current_actor_has_workspace('property_partner',null)
      and (storage.foldername(name))[1]='hotels'
      and (storage.foldername(name))[2] ~ '^[0-9]+$'
      and exists(
        select 1 from public.hotels hotel
        where hotel.hotel_id=(storage.foldername(name))[2]::integer
          and hotel.owner_id=public.current_profile_user_id()
          and hotel.status='active'
      )
    )
  )
)
with check (
  bucket_id=any(array['listing-images','listing-videos','listings']::text[])
  and (
    public.current_actor_has_workspace('creator',null)
    or public.current_actor_has_workspace('admin',null)
    or (
      bucket_id='listing-images'
      and owner_id=(select auth.uid())::text
      and public.current_actor_has_workspace('property_partner',null)
      and (storage.foldername(name))[1]='hotels'
      and (storage.foldername(name))[2] ~ '^[0-9]+$'
      and exists(
        select 1 from public.hotels hotel
        where hotel.hotel_id=(storage.foldername(name))[2]::integer
          and hotel.owner_id=public.current_profile_user_id()
          and hotel.status='active'
      )
    )
  )
);

drop policy if exists "listing_media_delete_owner_or_creator" on storage.objects;
create policy "listing_media_delete_owner_or_creator"
on storage.objects for delete to authenticated
using (
  bucket_id=any(array['listing-images','listing-videos','listings']::text[])
  and (
    public.current_actor_has_workspace('creator',null)
    or public.current_actor_has_workspace('admin',null)
    or (
      bucket_id='listing-images'
      and owner_id=(select auth.uid())::text
      and public.current_actor_has_workspace('property_partner',null)
      and (storage.foldername(name))[1]='hotels'
      and (storage.foldername(name))[2] ~ '^[0-9]+$'
      and exists(
        select 1 from public.hotels hotel
        where hotel.hotel_id=(storage.foldername(name))[2]::integer
          and hotel.owner_id=public.current_profile_user_id()
          and hotel.status='active'
      )
    )
  )
);

commit;
