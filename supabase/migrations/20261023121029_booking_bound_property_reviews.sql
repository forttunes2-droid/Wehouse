create function private.property_review_eligible(r public.reservations) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(case when r.stay_type='short_let' then
  r.checked_in_at is not null and (r.checked_out_at is not null or r.status in ('completed','cancelled','refunded')) and r.rent_payment_status='paid'
 else coalesce(r.stay_type,'long_stay')='long_stay'
  and (r.verified_handover_at is not null or r.occupancy_started_at is not null)
  and r.status in ('occupied','completed','cancelled','refunded') and r.rent_payment_status in ('upfront_paid','paid') end,false)
$$;
revoke all on function private.property_review_eligible(public.reservations) from public,anon,authenticated;

create function public.get_my_property_booking_review(p_reservation_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id(); booking public.reservations; review public.listing_reviews; allowed boolean;
begin
 if actor is null or not public.current_actor_has_personal_workspace() or not public._property_document_session_active() then raise exception 'Sign in on a trusted device to view your review' using errcode='42501';end if;
 select * into booking from public.reservations where id=p_reservation_id and user_id=actor;
 if booking.id is null then raise exception 'Booking unavailable' using errcode='42501';end if;
 select * into review from public.listing_reviews where reservation_id=booking.id and user_id=actor;
 allowed:=private.property_review_eligible(booking) and exists(select 1 from public.listings l where l.id::text=booking.listing_id
  and actor is distinct from l.owner_id and actor is distinct from l.partner_id and actor is distinct from l.management_host_user_id);
 return jsonb_build_object('reservation_id',booking.id,'stay_type',coalesce(booking.stay_type,'long_stay'),
  'eligible',allowed and review.review_id is null,'review',case when review.review_id is null then null else to_jsonb(review) end);
end $$;
revoke all on function public.get_my_property_booking_review(text) from public,anon;
grant execute on function public.get_my_property_booking_review(text) to authenticated;

create function public.submit_my_property_booking_review(p_reservation_id text,p_rating integer,p_comment text default null)
returns public.listing_reviews language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id(); booking public.reservations; listing public.listings; review public.listing_reviews;
 comment_text text:=nullif(btrim(coalesce(p_comment,'')),'');
begin
 if actor is null or not public.current_actor_has_personal_workspace() or not public._property_document_session_active() then raise exception 'Sign in on a trusted device to write your review' using errcode='42501';end if;
 if p_rating is null or p_rating not between 1 and 5 or length(coalesce(comment_text,''))>2000 then raise exception 'Choose a rating from 1 to 5 and a review of at most 2000 characters';end if;
 select * into booking from public.reservations where id=p_reservation_id and user_id=actor;
 if booking.id is null then raise exception 'Booking unavailable' using errcode='42501';end if;
 -- Serialize the aggregate with all review writers before locking this booking.
 select * into listing from public.listings where id::text=booking.listing_id for update;
 if listing.id is null or actor in (listing.owner_id,listing.partner_id,listing.management_host_user_id) then raise exception 'You cannot review your own property';end if;
 select * into booking from public.reservations where id=p_reservation_id and user_id=actor for update;
 select * into review from public.listing_reviews where reservation_id=booking.id;
 if review.review_id is not null then
  if review.user_id=actor and review.rating=p_rating and review.comment is not distinct from comment_text then return review;end if;
  raise exception 'This booking already has a review. Refresh to see the saved review';
 end if;
 if not private.property_review_eligible(booking) then raise exception 'Verified occupancy or a completed verified stay is required before reviewing this home';end if;
 insert into public.listing_reviews(listing_id,reservation_id,user_id,rating,comment)
 values(listing.id,booking.id,actor,p_rating,comment_text) returning * into review;
 update public.listings l set rating=(select round(avg(r.rating)::numeric,2) from public.listing_reviews r where r.listing_id=listing.id),
 review_count=(select count(*)::integer from public.listing_reviews r where r.listing_id=listing.id),updated_at=now() where l.id=listing.id;
 return review;
end $$;
revoke all on function public.submit_my_property_booking_review(text,integer,text) from public,anon;
grant execute on function public.submit_my_property_booking_review(text,integer,text) to authenticated;

-- Retain the existing listing entry point, with one canonical write authority.
create or replace function public.create_my_verified_listing_review(p_listing_id text,p_rating integer,p_comment text default null)
returns public.listing_reviews language plpgsql security definer set search_path='' as $$
declare booking_id text; actor text:=public.current_profile_user_id();
begin
 select r.id into booking_id from public.reservations r join public.listings l on l.id::text=r.listing_id
 where (l.id::text=p_listing_id or l.listing_id=p_listing_id) and r.user_id=actor
 and private.property_review_eligible(r) and not exists(select 1 from public.listing_reviews v where v.reservation_id=r.id)
 order by coalesce(r.checked_out_at,r.completed_at,r.processed_at,r.updated_at) desc limit 1;
 if booking_id is null then raise exception 'Open your booking to view its saved review or check review eligibility';end if;
 return public.submit_my_property_booking_review(booking_id,p_rating,p_comment);
end $$;
