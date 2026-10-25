begin;
create function private.can_change_long_let_rent_offer(p_listing_id uuid) returns boolean
language sql stable security definer set search_path='' as $fn$
 select coalesce(public.current_actor_property_host_access_level(p_listing_id)='full_hosting'
  and exists(select 1 from public.listings l where l.id=p_listing_id and l.sub_type='long_stay' and l.deleted_at is null
   and (l.management_mode='host' or exists(select 1 from public.property_host_assignments a
    where a.listing_id=l.id and a.user_id=public.current_profile_user_id() and a.assignment_role='owner' and a.status='active'))),false);
$fn$;
revoke all on function private.can_change_long_let_rent_offer(uuid) from public,anon,authenticated;
do $patch$
declare signature text;definition text;needle text:='public.current_actor_can_change_property_commercials(p_listing_id)';
begin
 foreach signature in array array['public.get_my_long_let_rent_terms(uuid)','public.set_my_long_let_rent_terms(uuid,integer,integer[],boolean)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position(needle in definition)=0 then raise exception 'Inspect Long Let rent-offer authority before upgrading';end if;
  execute replace(definition,needle,'private.can_change_long_let_rent_offer(p_listing_id)');
 end loop;
end $patch$;
create function private.guard_long_let_offer_write() returns trigger
language plpgsql set search_path='' as $fn$
begin
 if current_user in('postgres','service_role') then return new;end if;
 if tg_op='INSERT' then
  if new.accepted_lease_terms_months<>array[12] or new.rent_terms_revision<>1 or coalesce(new.future_installments_allowed,false) then
   raise exception 'Save rental terms through the authorized property offer control' using errcode='42501';end if;
 elsif (new.accepted_lease_terms_months,new.rent_terms_revision,new.future_installments_allowed)
  is distinct from (old.accepted_lease_terms_months,old.rent_terms_revision,old.future_installments_allowed) then
  raise exception 'Save rental terms through the authorized property offer control' using errcode='42501';
 end if;
 return new;
end $fn$;
revoke all on function private.guard_long_let_offer_write() from public,anon,authenticated;
create trigger guard_long_let_offer_write before insert or update on public.listings for each row execute function private.guard_long_let_offer_write();
commit;
