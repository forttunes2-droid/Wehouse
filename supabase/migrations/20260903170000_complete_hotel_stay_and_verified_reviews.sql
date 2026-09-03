create or replace function public.partner_transition_hotel_booking(p_booking_id integer,p_status text)
returns public.hotel_bookings language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_booking public.hotel_bookings; v_role text;
begin
  select * into v_booking from public.hotel_bookings where booking_id=p_booking_id for update;
  if v_booking is null then raise exception 'Hotel booking not found'; end if;
  v_role:=public.current_actor_hotel_role(v_booking.hotel_id);
  if v_role not in('owner','manager','staff') then raise exception 'Hotel operations access required'; end if;
  if p_status='checked_in' and not(v_booking.status='confirmed' and v_booking.payment_status='paid' and v_booking.check_in<=current_date) then raise exception 'Only a paid confirmed arrival can be checked in';
  elsif p_status='completed' and not(v_booking.status='checked_in' and v_booking.payment_status='paid' and v_booking.check_out<=current_date) then raise exception 'Only a paid checked-in stay reaching departure can be completed';
  elsif p_status not in('checked_in','completed') then raise exception 'Unsupported hotel booking transition'; end if;
  update public.hotel_bookings set status=p_status,updated_at=now() where booking_id=p_booking_id returning * into v_booking;
  return v_booking;
end $$;
revoke all on function public.partner_transition_hotel_booking(integer,text) from public,anon;
grant execute on function public.partner_transition_hotel_booking(integer,text) to authenticated;

create unique index if not exists hotel_reviews_one_per_guest_hotel on public.hotel_reviews(hotel_id,user_id);
drop policy if exists hotel_reviews_user_insert_canonical on public.hotel_reviews;
create or replace function public.create_my_verified_hotel_review(p_hotel_id integer,p_rating integer,p_comment text default null)
returns public.hotel_reviews language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_user text; v_review public.hotel_reviews;
begin
  select user_id into v_user from public.profiles where auth_id=auth.uid()::text and role='user' and coalesce(deleted,false)=false and coalesce(suspended,false)=false and coalesce(banned,false)=false limit 1;
  if v_user is null then raise exception 'Active User account required'; end if;
  if p_rating not between 1 and 5 then raise exception 'Rating must be between 1 and 5'; end if;
  if not exists(select 1 from public.hotel_bookings where hotel_id=p_hotel_id and user_id=v_user and payment_status='paid' and status in('checked_out','completed')) then raise exception 'A completed paid stay is required before reviewing this hotel'; end if;
  insert into public.hotel_reviews(hotel_id,user_id,rating,comment) values(p_hotel_id,v_user,p_rating,nullif(btrim(coalesce(p_comment,'')),''))
  on conflict(hotel_id,user_id) do update set rating=excluded.rating,comment=excluded.comment,created_at=now() returning * into v_review;
  update public.hotels h set rating=(select round(avg(r.rating)::numeric,1) from public.hotel_reviews r where r.hotel_id=p_hotel_id),review_count=(select count(*) from public.hotel_reviews r where r.hotel_id=p_hotel_id),updated_at=now() where h.hotel_id=p_hotel_id;
  return v_review;
end $$;
revoke all on function public.create_my_verified_hotel_review(integer,integer,text) from public,anon;
grant execute on function public.create_my_verified_hotel_review(integer,integer,text) to authenticated;
