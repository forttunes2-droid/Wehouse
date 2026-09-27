begin;

-- Help record discovery is a read model, not an account reset. Preserve all
-- historical bookings and money records. Payment choices must represent an
-- actual payment/active attempt, rather than every cancelled booking.
create or replace function public.get_my_workspace_help_targets(p_workspace text)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $function$
declare
  actor text := public.current_profile_user_id();
  access jsonb := public.get_my_workspace_access();
  source jsonb;
  result jsonb;
  rows jsonb;
  list_key text;
begin
  if actor is null or not coalesce((access->>'personal_workspace')::boolean,false) then
    raise exception 'Active account required';
  end if;
  if p_workspace is null or p_workspace not in ('personal','worker','property_partner','hotel') then
    raise exception 'Unsupported help workspace';
  end if;
  if p_workspace <> 'personal' and not exists(
    select 1 from jsonb_array_elements(access->'privileged_workspaces') item
    where item->>'role'=p_workspace
  ) then raise exception 'Workspace access required'; end if;

  source := public.get_my_account_help_targets();
  result := jsonb_build_object('account',source->'account');
  if p_workspace='personal' then
    result := result || jsonb_build_object('reservations',source->'reservations','hotel_bookings',source->'hotel_bookings');
  elsif p_workspace='worker' then
    result := result || jsonb_build_object('worker_profile',
      case when jsonb_typeof(source->'worker_profile')='object'
        then source->'worker_profile' || jsonb_build_object('label','My Service Worker profile')
        else source->'worker_profile' end);
  elsif p_workspace='property_partner' then
    result := result || jsonb_build_object('property_requests',source->'property_requests',
      'properties',source->'properties','hotels',source->'hotels',
      'partner_reservations',source->'partner_reservations','partner_hotel_bookings',source->'partner_hotel_bookings');
  elsif p_workspace='hotel' then
    select coalesce(jsonb_agg(jsonb_build_object('subject_type','hotel',
      'subject_id',h.hotel_id::text,'context_type','hotel_property','label',h.name,
      'detail','Hotel Team') order by h.name),'[]'::jsonb) into rows
    from public.hotels h where exists(select 1 from public.hotel_team_members member
      where member.hotel_id=h.hotel_id and member.member_user_id=actor and member.status='active')
      and public.hotel_actor_has_capability(h.hotel_id,'stay.read');
    result := result || jsonb_build_object('hotels',rows);
  end if;
  if p_workspace in ('personal','worker') then
    select coalesce(jsonb_agg(item order by item->>'updated_at' desc),'[]'::jsonb) into rows
    from jsonb_array_elements(source->'worker_jobs') item
    join public.worker_bookings b on b.id::text=item->>'subject_id'
    where (p_workspace='personal' and b.user_id=actor) or (p_workspace='worker' and b.worker_id=actor);
    result := result || jsonb_build_object('worker_jobs',rows);
  end if;
  if p_workspace in ('worker','property_partner') then
    select coalesce(jsonb_agg(item order by item->>'updated_at' desc),'[]'::jsonb) into rows
    from jsonb_array_elements(source->'withdrawals') item
    join public.withdrawals wd on wd.id::text=item->>'subject_id'
    join public.wallets w on w.id=wd.wallet_id
    where w.owner_id=actor and w.owner_type=p_workspace;
    result := result || jsonb_build_object('withdrawals',rows);
  end if;

  -- Enrich only the already-authorized workspace candidates. Dates and these
  -- non-secret record references distinguish repeated bookings without exposing
  -- booking/check-in/handover codes or provider payment references.
  for list_key in select key from jsonb_each(result) where jsonb_typeof(value)='array' loop
    with candidates as (
      select item,r.id as reservation_id,hb.booking_id as hotel_booking_id,wb.id as worker_booking_id,
        r.payment_reference,r.rent_payment_reference,
        coalesce(r.created_at,hb.created_at,wb.created_at,nullif(item->>'updated_at','')::timestamptz) as record_date,
        coalesce(r.status,hb.status,wb.status) as record_status,
        r.stay_payment_protection_id,r.caution_payment_protection_id,
        hb.payment_protection_id as hotel_protection_id,wb.payment_protection_id as worker_protection_id
      from jsonb_array_elements(result->list_key) item
      left join public.reservations r on item->>'context_type'='apartment_reservation' and r.id=item->>'subject_id'
      left join public.hotel_bookings hb on item->>'context_type'='hotel_booking' and hb.booking_id::text=item->>'subject_id'
      left join public.worker_bookings wb on item->>'context_type'='worker_booking' and wb.id::text=item->>'subject_id'
    ), enriched as (
      select item || jsonb_build_object(
        'record_date',record_date,
        'record_reference','Record ' || left(md5(coalesce(item->>'context_type',item->>'subject_type') || ':' || (item->>'subject_id')),8),
        'status',coalesce(record_status,item->>'detail'),
        'payment_eligible',
          exists(select 1 from public.booking_payments p where (
            (reservation_id is not null and (p.payment_reference=c.payment_reference or p.paystack_reference=c.payment_reference
              or p.payment_reference=c.rent_payment_reference or p.paystack_reference=c.rent_payment_reference
              or p.metadata->>'reservation_id'=reservation_id))
            or (hotel_booking_id is not null and p.hotel_booking_id=c.hotel_booking_id)
            or (worker_booking_id is not null and p.worker_booking_id=c.worker_booking_id)
          ) and (p.verified_at is not null or p.paid_at is not null
            or coalesce(lower(p.status),'') not in ('cancelled','canceled','expired','abandoned')))
          or exists(select 1 from public.payment_protection_transactions p where
            p.id=c.stay_payment_protection_id or p.id=c.caution_payment_protection_id
            or p.id=c.hotel_protection_id or p.id=c.worker_protection_id
            or (c.reservation_id is not null and p.subject_id=c.reservation_id
              and p.subject_type in ('short_let','long_let','reservation','apartment_reservation')))
      ) as target
      from candidates c
    ) select coalesce(jsonb_agg(target order by target->>'record_date' desc nulls last,
      target->>'context_type',target->>'subject_id'),'[]'::jsonb) into rows from enriched;
    result := jsonb_set(result,array[list_key],rows);
  end loop;

  select coalesce(jsonb_agg(item order by item->>'record_date' desc nulls last,
    item->>'context_type',item->>'subject_id'),'[]'::jsonb) into rows
  from jsonb_each(result) source_list
  cross join lateral jsonb_array_elements(case when jsonb_typeof(source_list.value)='array'
    then source_list.value else '[]'::jsonb end) item
  where source_list.key in ('reservations','hotel_bookings','worker_jobs','partner_reservations','partner_hotel_bookings')
    and item->>'payment_eligible'='true';
  return result || jsonb_build_object('payment_targets',rows);
end
$function$;
revoke all on function public.get_my_workspace_help_targets(text) from public,anon;
grant execute on function public.get_my_workspace_help_targets(text) to authenticated,service_role;

commit;
