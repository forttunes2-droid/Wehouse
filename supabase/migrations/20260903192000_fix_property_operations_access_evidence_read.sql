drop policy if exists "authorized operations read property access evidence"
on storage.objects;

create policy "authorized property operations read access evidence"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'property-access-private'
  and (
    exists (
      select 1
      from public.profiles actor
      where actor.auth_id = auth.uid()::text
        and actor.role in ('creator', 'admin')
        and not coalesce(actor.deleted, false)
        and not coalesce(actor.suspended, false)
        and not coalesce(actor.banned, false)
    )
    or (
      public.current_staff_has_permission('operations')
      and exists (
        select 1
        from public.inspection_requests request
        where request.access_evidence_video_path = storage.objects.name
          and public.current_actor_in_scope(
            request.property_state,
            request.property_city
          )
      )
    )
  )
);

comment on policy "authorized property operations read access evidence"
on storage.objects is
'Creator and Admin retain oversight; assigned Property Operations staff may read private access evidence only inside their branch scope.';
