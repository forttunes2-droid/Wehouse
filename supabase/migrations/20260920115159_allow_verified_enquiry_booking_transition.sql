begin;
-- Permit only the authenticated customer's canonical enquiry -> owned booking
-- transition. Keep reassignment to another person/property/workspace blocked.
create or replace function public.enforce_conversation_context_ownership()
returns trigger language plpgsql
set search_path to 'pg_catalog','public'
as $$
declare allowed_transition boolean:=false;
begin
  if old.partner_id is distinct from new.partner_id then
    raise exception 'Conversation ownership cannot be reassigned';
  end if;
  if old.context_type is distinct from new.context_type
    or old.context_id is distinct from new.context_id then
    -- The protected RPC runs with its function owner's database role. A caller
    -- cannot opt into this path through JSON metadata or a session setting.
    if current_user=(select pg_get_userbyid(proowner) from pg_proc
        where oid='public.open_my_reservation_conversation(text,text)'::regprocedure)
      and old.partner_id=public.current_profile_user_id()
      and old.channel_kind='property_operations' and new.channel_kind='property_operations'
      and coalesce(old.context_snapshot->>'requester_workspace','personal')='personal'
      and old.canonical_thread_id is not null
      and new.canonical_thread_id=old.canonical_thread_id then
      if old.context_type in ('hotel_property','hotel_operations') and new.context_type='hotel_booking' then
        select exists(
          select 1 from public.hotel_bookings b
          join public.canonical_threads t on t.thread_id=new.canonical_thread_id
          where b.booking_id::text=new.context_id and b.hotel_id::text=old.context_id
            and b.user_id=old.partner_id and t.thread_type='hotel'
            and t.subject_type='hotel' and t.subject_id=b.booking_id::text
        ) into allowed_transition;
      elsif old.context_type in ('property_listing','listing') and new.context_type='apartment_reservation' then
        select exists(
          select 1 from public.reservations r
          join public.listings l on l.listing_id=r.listing_id or l.id::text=r.listing_id
          join public.canonical_threads t on t.thread_id=new.canonical_thread_id
          where r.id=new.context_id and r.user_id=old.partner_id
            and old.context_id in (l.listing_id,l.id::text)
            and t.thread_type in ('short_let','long_let')
            and t.subject_type=t.thread_type and t.subject_id=r.id
        ) into allowed_transition;
      end if;
    end if;
    if not allowed_transition then
      raise exception 'Conversation ownership cannot be reassigned';
    end if;
  end if;
  if old.channel_kind is distinct from new.channel_kind
    and not (
      old.context_type='property_inspection'
      and old.channel_kind='property_operations'
      and new.channel_kind='field_operations'
      and nullif(btrim(coalesce(new.assigned_field_officer_id,'')),'') is not null
    ) then raise exception 'Conversation ownership cannot be reassigned'; end if;
  return new;
end;
$$;
revoke all on function public.enforce_conversation_context_ownership() from public,anon,authenticated;
grant execute on function public.enforce_conversation_context_ownership() to service_role;
commit;
