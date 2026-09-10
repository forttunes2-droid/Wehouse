-- Previous versions explicitly granted some RPCs to anon. Revoking PUBLIC is
-- not enough to remove those role-specific grants, so enforce the signed-in
-- lifecycle boundary directly.
revoke execute on function public.get_discoverable_hotels() from anon;
revoke execute on function public.get_public_hotel_detail(integer) from anon;
revoke execute on function public.get_discoverable_listings() from anon;
revoke execute on function public.get_public_listing_detail(text) from anon;
revoke execute on function public.get_my_hotel_bookings() from anon;
revoke execute on function public.quote_hotel_room_rate(integer,integer,integer,date,date) from anon;
revoke execute on function public.create_my_hotel_booking_with_rate(integer,integer,integer,date,date,integer,text,text,text) from anon;
revoke execute on function public.partner_create_hotel_room(integer,text,text,integer,integer,text,integer,text[],text[]) from anon;
revoke execute on function public.partner_save_hotel_rate_plan(integer,integer,text,text,text,text,boolean,integer,integer,text[],boolean) from anon;
revoke execute on function public.partner_save_hotel_venue(integer,integer,text,text,text,text,text,boolean) from anon;
