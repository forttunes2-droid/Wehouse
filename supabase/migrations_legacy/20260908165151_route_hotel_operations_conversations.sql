-- Hotel owners and assigned hotel teams contact WeHouse from the hotel or stay
-- they are working in. Keep those conversations in Property Operations.
create or replace function public.classify_conversation_channel()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  source_type text := coalesce(new.context_snapshot->>'source_type','');
begin
  new.channel_kind:=case
    when new.context_type in (
      'apartment_reservation','apartment_payment','reservation','hotel_booking',
      'property_listing','property_inspection','hotel_property','hotel_operations'
    ) then 'property_operations'
    when source_type in (
      'apartment_reservation','apartment_payment','reservation','hotel_booking',
      'property_listing','property_inspection','hotel_property','hotel_operations'
    ) then 'property_operations'
    else 'support_case'
  end;
  if new.channel_kind='support_case' and new.case_number is null then
    new.case_number:='WHC-'||upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 10));
  end if;
  return new;
end;
$$;

revoke all on function public.classify_conversation_channel() from public, anon, authenticated;
grant execute on function public.classify_conversation_channel() to service_role;

update public.partner_support_conversations
set channel_kind='property_operations', updated_at=now()
where context_type in ('hotel_property','hotel_operations')
   or coalesce(context_snapshot->>'source_type','') in ('hotel_property','hotel_operations');
