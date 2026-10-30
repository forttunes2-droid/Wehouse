-- A property's occupant capacity is not its number of paying participants.
-- Keep the approved three-payer limit without requiring every bed to have a payer.
do $patch$
declare definition text:=pg_get_functiondef('public.validate_shared_housing_checkout(uuid,text)'::regprocedure);
 needle text:='and g.member_limit between 2 and 3 and c.capacity=g.member_limit';
begin
 if position(needle in definition)=0 then raise exception 'Inspect the shared checkout capacity guard before upgrading';end if;
 definition:=replace(definition,needle,$new$and g.member_limit between 2 and 3 and c.capacity>=g.member_limit
   and payment.listing_id=g.listing_id::text and c.listing_id=payment.listing_id
   and c.legacy_group_id=g.id and cm.legacy_member_id=m.id
   and payment.metadata->>'canonical_product_type'=g.product_type
   and ((g.product_type='long_let' and g.payment_phase='reservation_fee')
     or (g.product_type='short_let' and g.payment_phase='short_stay'))
   and not exists(select 1 from public.shared_housing_members participant
     where participant.group_id=g.id and public.user_has_active_workspace(participant.user_id,'personal') is distinct from true)$new$);
 definition:=replace(definition,'between 2 and c.capacity','between 2 and least(3,g.member_limit,c.capacity)');
 execute definition;
end $patch$;

-- Reject an ineligible group before creating/reusing a provider reference too.
-- The existing constructor retains its current idempotency and money allocation.
alter function public.create_my_shared_housing_payment(uuid) set schema private;
alter function private.create_my_shared_housing_payment(uuid) rename to create_shared_housing_payment_recorded;
revoke all on function private.create_shared_housing_payment_recorded(uuid) from public,anon,authenticated;

create function public.create_my_shared_housing_payment(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();payment_group public.shared_housing_groups;
begin
 if actor is null or not public._property_document_session_active()
  or public.user_has_active_workspace(actor,'personal') is distinct from true then
  raise exception 'A trusted active Personal account is required' using errcode='42501';end if;
 select * into payment_group from public.shared_housing_groups where id=p_group_id for update;
 if payment_group.id is null or not exists(select 1 from public.shared_housing_members
   where group_id=p_group_id and user_id=actor) then raise exception 'Shared-payment access required' using errcode='42501';end if;
 if exists(select 1 from public.shared_housing_members member where member.group_id=p_group_id
   and public.user_has_active_workspace(member.user_id,'personal') is distinct from true) then
  raise exception 'A participant is no longer eligible for this shared payment';end if;
 if payment_group.product_type='long_let' and payment_group.payment_phase='contract_rent' then
  raise exception 'Review the shared Long Let rental agreement before starting rent payment';end if;
 return private.create_shared_housing_payment_recorded(p_group_id);
end $$;
revoke all on function public.create_my_shared_housing_payment(uuid) from public,anon;
grant execute on function public.create_my_shared_housing_payment(uuid) to authenticated,service_role;
