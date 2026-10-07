-- Production security, RLS, and trigger alignment after schema reconciliation.
-- The full private evidence guard is kept in the database definition; this migration
-- installs the verified test-schema behavior.
create or replace function private.guard_accommodation_no_show_evidence() returns trigger language plpgsql security definer set search_path to 'pg_catalog','public','storage','private' as $function$
declare v_path text; v_metadata jsonb; v_mime text; v_size numeric;
begin
 if public.current_profile_user_id() is distinct from new.requested_by or auth.uid() is null then raise exception 'No-show evidence must be submitted by its uploader' using errcode='42501'; end if;
 if cardinality(new.property_ready_evidence)<>cardinality(array(select distinct value from unnest(new.property_ready_evidence) value)) then raise exception 'Duplicate no-show evidence is not allowed' using errcode='22023'; end if;
 foreach v_path in array new.property_ready_evidence loop
  if v_path is null or length(v_path)>1024 or v_path ~ '[[:cntrl:]]' or position(chr(92) in v_path)>0 or v_path ~ '(^|/)\.\.(/|$)' or split_part(v_path,'/',1)<>auth.uid()::text or split_part(v_path,'/',2)<>'no-show' then raise exception 'Invalid no-show evidence path' using errcode='22023'; end if;
  select object.metadata into v_metadata from storage.objects object where object.bucket_id='accommodation-no-show-evidence' and object.name=v_path and object.owner_id=auth.uid()::text;
  if not found then raise exception 'A no-show evidence upload is incomplete' using errcode='22023'; end if;
  v_mime:=lower(btrim(split_part(coalesce(v_metadata->>'mimetype',''),';',1)));
  if v_mime<>all(array['image/jpeg','image/png','image/webp']) then raise exception 'No-show evidence must be a JPEG, PNG or WebP photo' using errcode='22023'; end if;
  begin v_size:=(v_metadata->>'size')::numeric; exception when others then raise exception 'No-show evidence size is invalid' using errcode='22023'; end;
  if v_size is null or v_size<=0 or v_size>6291456 or v_size::text in('NaN','Infinity','-Infinity') then raise exception 'No-show evidence size is invalid' using errcode='22023'; end if;
 end loop; return new;
end $function$;
grant execute on function private.guard_accommodation_no_show_evidence() to service_role;
alter table public.accommodation_no_show_reviews enable row level security;
alter table public.listing_reviews enable row level security;
alter table public.partner_pro_subscriptions enable row level security;
alter table public.property_change_requests enable row level security;
grant all on public.accommodation_no_show_reviews to service_role;
grant select on public.accommodation_no_show_reviews to authenticated;
grant all on public.listing_reviews to service_role;
grant all on public.partner_pro_subscriptions to service_role;
grant all on public.property_change_requests to service_role;
grant select on public.property_change_requests to authenticated;
drop policy if exists accommodation_no_show_authorized_read on public.accommodation_no_show_reviews;
create policy accommodation_no_show_authorized_read on public.accommodation_no_show_reviews for select to authenticated using (requested_by=public.current_profile_user_id() or (subject_type='short_let' and exists(select 1 from public.reservations reservation where reservation.id=subject_id and reservation.user_id=public.current_profile_user_id())) or (subject_type='hotel' and exists(select 1 from public.hotel_bookings booking where booking.booking_id::text=subject_id and booking.user_id=public.current_profile_user_id())) or (public.current_profile_role()=any(array['creator','admin','staff']::text[]) and (public.current_profile_role()<>'staff' or public.current_staff_has_permission('operations')) and (public.current_profile_role()='creator' or (subject_type='short_let' and exists(select 1 from public.reservations reservation join public.listings listing on ((listing.id)::text=reservation.listing_id or listing.listing_id=reservation.listing_id) where reservation.id=subject_id and public.current_actor_in_scope(listing.state,listing.city))) or (subject_type='hotel' and exists(select 1 from public.hotel_bookings booking join public.hotels hotel on hotel.hotel_id=booking.hotel_id where booking.booking_id::text=subject_id and public.current_actor_in_scope(hotel.state,hotel.city)))));
drop policy if exists property_change_requests_read_authorized on public.property_change_requests;
create policy property_change_requests_read_authorized on public.property_change_requests for select to authenticated using (requested_by=public.current_profile_user_id() or exists(select 1 from public.listings l where l.id=property_change_requests.listing_id and (public.current_actor_has_workspace('creator',null) or (public.current_actor_has_workspace('admin',l.state) and public.current_actor_in_scope(l.state,l.city)) or (public.current_actor_has_workspace('staff',null) and public.current_staff_has_permission('operations') and public.current_actor_in_scope(l.state,l.city))));
drop trigger if exists hotel_stay_party_guard on public.hotel_bookings;
create trigger hotel_stay_party_guard before insert or update on public.hotel_bookings for each row execute function public.validate_stay_party();
drop trigger if exists zz_hotel_booking_cancellation_snapshot on public.hotel_bookings;
create trigger zz_hotel_booking_cancellation_snapshot before insert or update on public.hotel_bookings for each row execute function public.snapshot_hotel_cancellation_policy();
drop trigger if exists zz_payment_protection_management_commission on public.payment_protection_transactions;
create trigger zz_payment_protection_management_commission before insert on public.payment_protection_transactions for each row execute function public.enforce_management_commission_on_protection();
drop trigger if exists reservation_stay_party_guard on public.reservations;
create trigger reservation_stay_party_guard before insert or update on public.reservations for each row execute function public.validate_stay_party();
drop trigger if exists reservations_short_let_listing_stay_rules_guard on public.reservations;
create trigger reservations_short_let_listing_stay_rules_guard before insert or update on public.reservations for each row execute function public.enforce_short_let_listing_stay_rules();
drop trigger if exists zz_reservation_short_let_rate_terms_snapshot on public.reservations;
create trigger zz_reservation_short_let_rate_terms_snapshot before insert or update on public.reservations for each row execute function public.snapshot_short_let_rate_terms();
drop trigger if exists zz_reservations_commission_snapshot on public.reservations;
create trigger zz_reservations_commission_snapshot before insert or update on public.reservations for each row execute function public.snapshot_apartment_commission_policy();
drop trigger if exists listings_non_refundable_policy_guard on public.listings;
create trigger listings_non_refundable_policy_guard before insert or update on public.listings for each row execute function public.enforce_listing_non_refundable_policy();
drop trigger if exists guard_accommodation_no_show_evidence on public.accommodation_no_show_reviews;
create trigger guard_accommodation_no_show_evidence before insert or update on public.accommodation_no_show_reviews for each row execute function private.guard_accommodation_no_show_evidence();
