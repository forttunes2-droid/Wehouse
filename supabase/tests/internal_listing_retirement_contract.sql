begin;
do $$
begin
  if to_regprocedure('public.create_internal_listing_idem(uuid,jsonb)') is not null
     or to_regprocedure('public.create_internal_listing(jsonb)') is not null then
    raise exception 'The retired direct-publication RPC is still present';
  end if;
  if to_regprocedure('public.create_my_property_inspection_batch_v4(uuid,jsonb)') is null then
    raise exception 'Canonical property submission is missing';
  end if;
  if to_regclass('public.listings') is null or to_regclass('public.hotels') is null
     or to_regclass('public.hotel_rooms') is null then
    raise exception 'Retirement must preserve listing and Hotel inventory tables';
  end if;
end;
$$;
rollback;
