-- Temporary production compatibility while the matching frontend commit awaits GitHub deployment.
-- New submissions still require their one-use recording. Existing deployed reviewers may assign
-- after opening submitted evidence; the stricter explicit review RPC is used by commit c678531.
create or replace function public.enforce_property_access_before_assignment() returns trigger
language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor public.profiles;
begin
  if new.authority_relationship is not null
     and coalesce(new.assigned_field_officer_id,new.field_officer_id,new.assigned_to)
       is distinct from coalesce(old.assigned_field_officer_id,old.field_officer_id,old.assigned_to) then
    if new.access_evidence_status not in ('submitted','verified') then
      raise exception 'Review the private property access recording before assigning a field visit';
    end if;
    if new.access_evidence_status='submitted' then
      select * into v_actor from public.profiles where auth_id=auth.uid()::text and role in ('creator','admin') limit 1;
      if v_actor is null then raise exception 'Authorized property reviewer required'; end if;
      new.access_evidence_status:='verified';
      new.access_evidence_verified_at:=now();
      new.access_evidence_verified_by:=v_actor.user_id;
    end if;
  end if;
  return new;
end $$;
