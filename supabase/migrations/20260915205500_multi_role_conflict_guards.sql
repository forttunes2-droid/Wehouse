begin;

-- The old launch experiment that limited a Personal identity to one marketplace
-- workspace is no longer part of the product contract. Retire the enforcing
-- trigger first, then remove its helper function. This ordering is required on a
-- fresh migration replay where the historical trigger is still present.
drop trigger if exists workspace_one_marketplace_role_guard
on public.workspace_role_assignments;
drop function if exists public.enforce_one_marketplace_workspace();

-- One person may legitimately be a Service Provider, Property Partner, hotel
-- team member and WeHouse team member. That does not permit the WeHouse-team
-- side of the identity to review or approve records that benefit the same person.
create or replace function public.prevent_privileged_self_review()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  actor text:=public.current_profile_user_id();
  v_new jsonb:=to_jsonb(new);
  v_old jsonb:=to_jsonb(old);
begin
  if actor is null then return new; end if;

  if tg_table_name='listings'
     and (
       v_new->>'approved_by' is distinct from v_old->>'approved_by'
       or (
         v_old->>'status' is distinct from v_new->>'status'
         and v_new->>'status' in('available','rejected')
       )
     )
     and actor in(coalesce(v_new->>'owner_id',''),coalesce(v_new->>'partner_id','')) then
    raise exception 'Another authorized person must review your listing';

  elsif tg_table_name='profiles'
     and (
       v_new->>'worker_status' in('verified','rejected')
       or coalesce((v_new->>'worker_verified')::boolean,false)
     )
     and (
       v_new->>'worker_status' is distinct from v_old->>'worker_status'
       or v_new->>'worker_verified' is distinct from v_old->>'worker_verified'
     )
     and actor=v_new->>'user_id' then
    raise exception 'Another authorized person must review your Service Provider verification';

  elsif tg_table_name='reservations'
     and v_new->>'status'='refunded'
     and v_old->>'status' is distinct from v_new->>'status'
     and actor=v_new->>'user_id' then
    raise exception 'Another authorized person must process your refund';

  elsif tg_table_name='inspection_requests' then
    if v_new->>'access_evidence_status' in('verified','rejected')
       and v_old->>'access_evidence_status' is distinct from v_new->>'access_evidence_status'
       and actor=v_new->>'owner_id' then
      raise exception 'Another authorized person must review your property evidence';
    end if;

    if (
         v_new->>'final_media_reviewed_at' is distinct from v_old->>'final_media_reviewed_at'
         or v_new->>'final_media_reviewed_by' is distinct from v_old->>'final_media_reviewed_by'
       )
       and nullif(v_new->>'final_media_reviewed_at','') is not null
       and actor=v_new->>'owner_id' then
      raise exception 'Another authorized person must review your final public property media';
    end if;

    if v_new->>'status'='approved'
       and v_old->>'status' is distinct from v_new->>'status'
       and actor=v_new->>'owner_id' then
      raise exception 'Another authorized person must approve your property';
    end if;

  elsif tg_table_name='hotels'
     and (
       v_new->>'approved_by' is distinct from v_old->>'approved_by'
       or (
         v_new->>'status'='active'
         and v_old->>'status' is distinct from v_new->>'status'
       )
     )
     and actor=v_new->>'owner_id' then
    raise exception 'Another authorized person must review and publish your hotel';

  elsif tg_table_name='user_inspection_requests' then
    if nullif(v_new->>'field_officer_id','') is not null
       and v_new->>'field_officer_id'=v_new->>'user_id'
       and v_new->>'field_officer_id' is distinct from v_old->>'field_officer_id' then
      raise exception 'A Field Operations team member cannot be assigned to their own customer inspection';
    end if;

    if actor=v_new->>'user_id'
       and v_new->>'status' in('in_progress','completed')
       and v_old->>'status' is distinct from v_new->>'status' then
      raise exception 'Another Field Operations team member must handle your customer inspection';
    end if;
  end if;

  return new;
end;
$$;

-- Existing triggers remain for listings, profiles, refunds and access evidence.
-- Add the multi-role conflict points that were previously uncovered.
drop trigger if exists inspection_final_review_no_self_review on public.inspection_requests;
create trigger inspection_final_review_no_self_review
before update of final_media_reviewed_at,final_media_reviewed_by,status,approved_by
on public.inspection_requests
for each row execute function public.prevent_privileged_self_review();

drop trigger if exists hotels_no_self_review on public.hotels;
create trigger hotels_no_self_review
before update of status,approved_by
on public.hotels
for each row execute function public.prevent_privileged_self_review();

drop trigger if exists customer_inspection_no_self_assignment on public.user_inspection_requests;
create trigger customer_inspection_no_self_assignment
before update of field_officer_id,status
on public.user_inspection_requests
for each row execute function public.prevent_privileged_self_review();

comment on function public.prevent_privileged_self_review() is
  'Conflict-of-interest guard for identities holding both customer/provider and privileged WeHouse workspaces. Prevents self-review, self-publication, self-refund and self-inspection while preserving legitimate multi-workspace access.';

commit;