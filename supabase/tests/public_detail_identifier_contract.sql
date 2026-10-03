\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into public.listings(id,listing_id,title,price,property_type,status,availability_status,inspection_request_id,approved_at)
values
('f1000000-0000-0000-0000-000000000001','capacity-detail-contract-public','Public fixture',100,'apartment','available','available',gen_random_uuid(),now()),
('f1000000-0000-0000-0000-000000000002','capacity-detail-contract-hidden','Unapproved fixture',100,'apartment','available','available',gen_random_uuid(),null);
insert into public.profiles(auth_id,email,user_id,role,profile_complete)
values('capacity-price-contract-auth','capacity-price-contract-owner@example.invalid','capacity-price-contract-owner','user',true);
insert into public.hotels(hotel_id,name,state,city,address,owner_id,status,approved_at,published_at)
values(-19000001,'Capacity price contract A','Nasarawa','Capacity contract','Synthetic','capacity-price-contract-owner','active',now(),now()),
(-19000002,'Capacity price contract B','Nasarawa','Capacity contract','Synthetic','capacity-price-contract-owner','active',now(),now());
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms)
values(-19100001,-19000001,'Synthetic',100,10),(-19100002,-19000002,'Synthetic',100,10);
insert into public.hotel_rate_plans(rate_plan_id,hotel_id,room_id,name,meal_plan,payment_timing,refundable,price_per_night,active)
values(-19200001,-19000001,-19100001,'Synthetic price override','room_only','pay_now',false,200,true);
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$
declare by_text jsonb; by_uuid jsonb; hotel_price jsonb;
begin
 by_text:=public.get_public_listing_detail('capacity-detail-contract-public');
 by_uuid:=public.get_public_listing_detail('f1000000-0000-0000-0000-000000000001');
 if by_text is null or by_uuid is null or by_text is distinct from by_uuid then raise exception 'Both public identifiers must resolve the same approved listing'; end if;
 if by_text->>'listing_id'<>'capacity-detail-contract-public' or (by_text->>'location_exact')::boolean or by_text->>'gps_latitude' is not null then raise exception 'Public identity or location projection changed'; end if;
 if public.get_public_listing_detail('not-a-uuid-or-listing') is not null then raise exception 'Unknown text lookup must return null'; end if;
 if public.get_public_listing_detail('capacity-detail-contract-hidden') is not null or public.get_public_listing_detail('f1000000-0000-0000-0000-000000000002') is not null then raise exception 'Unapproved listing exposed by identifier lookup'; end if;
 hotel_price:=public.search_discoverable_hotels(p_query=>'Capacity price contract',p_min_price=>150,p_max_price=>250);
 if jsonb_array_length(hotel_price->'items')<>1 or hotel_price->'items'->0->>'hotel_id'<>'-19000001' then raise exception 'Hotel range must use active rate-plan price, not room base price'; end if;
 if jsonb_array_length(public.search_discoverable_hotels(p_query=>'Capacity price contract',p_min_price=>50,p_max_price=>150)->'items')<>1 then raise exception 'Hotel without active rate plan must use room base price'; end if;
 if jsonb_array_length(public.search_discoverable_hotels(p_query=>'Capacity price contract',p_min_price=>250,p_max_price=>300)->'items')<>0 then raise exception 'Hotel price range returned an out-of-range hotel'; end if;
 if public.search_discoverable_hotels(p_limit=>999)->'items' is null then raise exception 'Hotel search response shape changed'; end if;
end $$;
rollback;
