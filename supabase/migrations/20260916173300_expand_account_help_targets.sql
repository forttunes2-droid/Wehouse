-- Expand Account > Help targets so the shared identity can link records from
-- Personal, Service Provider and Property Partner workspaces without creating
-- workspace-specific Help products.
create or replace function public.get_my_account_help_targets()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  return jsonb_build_object(
    'account',jsonb_build_object('subject_type','account','subject_id',v_actor,'label','My WeHouse account'),
    'worker_profile',case when public.current_actor_has_workspace('worker',null) then
      jsonb_build_object('subject_type','worker','subject_id',v_actor,'context_type','contextual_help',
        'label','My Service Provider profile','detail','Profile, review or professional setup')
      else null end,
    'worker_jobs',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','worker_job','subject_id',x.id::text,'context_type','worker_booking',
        'label',coalesce(x.service_type,'Service job'),'detail',replace(coalesce(x.status,'job'),'_',' '),
        'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (select id,service_type,status,updated_at from public.worker_bookings
        where user_id=v_actor or worker_id=v_actor order by updated_at desc limit 50) x
    ),'[]'::jsonb),
    'withdrawals',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','payout','subject_id',x.id::text,'context_type','contextual_help',
        'label','Withdrawal · ₦'||trim(to_char(x.amount,'FM999G999G999G990D00')),
        'detail',replace(coalesce(x.status,'withdrawal'),'_',' '),'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (select wd.id,wd.amount,wd.status,wd.updated_at from public.withdrawals wd
        join public.wallets w on w.id=wd.wallet_id where w.owner_id=v_actor
        order by wd.updated_at desc limit 50) x
    ),'[]'::jsonb),
    'reservations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type',case when x.stay_type='short_let' then 'short_let' else 'long_let' end,
        'subject_id',x.id,'context_type','apartment_reservation','label',coalesce(x.listing_title,
          case when x.stay_type='short_let' then 'Short Let' else 'Long Let' end),
        'detail',replace(coalesce(x.status,'reservation'),'_',' '),'stay_type',x.stay_type,'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (select id,listing_title,stay_type,status,updated_at from public.reservations
        where user_id=v_actor order by updated_at desc limit 50) x
    ),'[]'::jsonb),
    'hotel_bookings',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','hotel','subject_id',x.booking_id::text,'context_type','hotel_booking',
        'label',coalesce(x.hotel_name,'Hotel stay'),'detail',replace(coalesce(x.status,'booking'),'_',' '),
        'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (select hb.booking_id,hb.status,hb.updated_at,h.name hotel_name from public.hotel_bookings hb
        join public.hotels h on h.hotel_id=hb.hotel_id where hb.user_id=v_actor
        order by hb.updated_at desc limit 50) x
    ),'[]'::jsonb),
    'property_requests',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','inspection','subject_id',x.id::text,'context_type','property_inspection',
        'label',coalesce(x.property_display_name,x.property_address,
          case when x.property_type='hotel' then 'Hotel submission' else 'Apartment submission' end),
        'detail',replace(coalesce(x.lifecycle_stage,x.status,'property request'),'_',' '),
        'request_code',x.request_code,'property_type',x.property_type,'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (select id,request_code,property_display_name,property_address,property_type,status,lifecycle_stage,updated_at
        from public.inspection_requests where owner_id=v_actor order by updated_at desc limit 50) x
    ),'[]'::jsonb),
    'properties',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','listing','subject_id',x.listing_id,'context_type','property_listing',
        'label',coalesce(x.title,'Apartment'),'detail',replace(coalesce(x.status,'property'),'_',' '),
        'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (select l.listing_id,l.title,l.status,l.updated_at from public.listings l
        where coalesce(l.partner_id,l.owner_id)=v_actor order by l.updated_at desc limit 50) x
    ),'[]'::jsonb),
    'hotels',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','hotel','subject_id',x.hotel_id::text,'context_type','hotel_property',
        'label',coalesce(x.name,'Hotel'),'detail',replace(coalesce(x.status,'hotel'),'_',' '),
        'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (select h.hotel_id,h.name,h.status,h.updated_at from public.hotels h
        where h.owner_id=v_actor order by h.updated_at desc limit 50) x
    ),'[]'::jsonb),
    'partner_reservations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type',case when x.stay_type='short_let' then 'short_let' else 'long_let' end,
        'subject_id',x.id,'context_type','apartment_reservation','label',coalesce(x.listing_title,'Guest reservation'),
        'detail','Guest · '||replace(coalesce(x.status,'reservation'),'_',' '),'stay_type',x.stay_type,'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (
        select r.id,r.listing_title,r.stay_type,r.status,r.updated_at
        from public.reservations r join public.listings l on l.id::text=r.listing_id or l.listing_id=r.listing_id
        where coalesce(l.partner_id,l.owner_id)=v_actor order by r.updated_at desc limit 50
      ) x
    ),'[]'::jsonb),
    'partner_hotel_bookings',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','hotel','subject_id',x.booking_id::text,'context_type','hotel_booking',
        'label',coalesce(x.hotel_name,'Hotel guest booking'),'detail','Guest · '||replace(coalesce(x.status,'booking'),'_',' '),
        'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (
        select hb.booking_id,hb.status,hb.updated_at,h.name hotel_name
        from public.hotel_bookings hb join public.hotels h on h.hotel_id=hb.hotel_id
        where h.owner_id=v_actor order by hb.updated_at desc limit 50
      ) x
    ),'[]'::jsonb)
  );
end
$$;

revoke all on function public.get_my_account_help_targets() from public,anon;
grant execute on function public.get_my_account_help_targets() to authenticated,service_role;
