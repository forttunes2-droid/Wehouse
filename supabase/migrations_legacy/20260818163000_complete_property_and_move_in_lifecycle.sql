create or replace function public.creator_reject_property_submission(
  p_inspection_id uuid,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_actor is null or v_actor.role not in ('creator','admin')
     or coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then
    raise exception 'Creator or Admin access required';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'A rejection reason is required'; end if;

  select * into v_request from public.inspection_requests where id=p_inspection_id for update;
  if v_request.id is null then raise exception 'Property submission not found'; end if;
  if v_request.published_at is not null then raise exception 'A published property must be handled from Published listings'; end if;
  if v_actor.role='admin' and (v_request.property_state is distinct from v_actor.assigned_state or v_request.property_city is distinct from v_actor.assigned_lga) then
    raise exception 'Property is outside your assigned branch';
  end if;
  if v_request.draft_listing_id is not null and exists(
    select 1 from public.reservations r where r.listing_id=v_request.draft_listing_id::text
      and r.status in ('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
  ) then raise exception 'This draft has an active reservation and cannot be rejected'; end if;

  if v_request.draft_listing_id is not null then
    update public.listings set deleted_at=now(),status='closed',availability_status='unavailable',updated_at=now()
    where id=v_request.draft_listing_id and deleted_at is null;
  end if;
  if v_request.draft_hotel_id is not null then
    update public.hotels set status='rejected',updated_at=now() where hotel_id=v_request.draft_hotel_id;
  end if;
  update public.inspection_requests
  set status='rejected',rejection_reason=btrim(p_reason),assigned_to=null,assigned_field_officer_id=null,
      field_officer_id=null,scheduled_date=null,updated_at=now()
  where id=p_inspection_id;

  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  values('PROPERTY_SUBMISSION_REJECTED','inspection_requests',p_inspection_id::text,
    jsonb_build_object('reason',btrim(p_reason),'request_code',v_request.request_code)::text,v_actor.user_id,v_actor.email);
  return true;
end $$;

revoke all on function public.creator_reject_property_submission(uuid,text) from public,anon;
grant execute on function public.creator_reject_property_submission(uuid,text) to authenticated;

create or replace function public.confirm_my_move_in(p_reservation_id text)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_reservation public.reservations;
  v_start date:=current_date;
  v_end date;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role='user' limit 1;
  if v_actor is null or coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then
    raise exception 'Active user account required';
  end if;
  select * into v_reservation from public.reservations
  where id=p_reservation_id and user_id=v_actor.user_id for update;
  if v_reservation.id is null then raise exception 'Reservation not found'; end if;
  if v_reservation.status='occupied' then
    return jsonb_build_object('success',true,'already_confirmed',true,'status','occupied','tenancy_start_date',v_reservation.tenancy_start_date,'tenancy_end_date',v_reservation.tenancy_end_date);
  end if;
  if v_reservation.status<>'ready_for_move_in' then raise exception 'This home is not ready for move-in confirmation'; end if;
  if v_reservation.rent_payment_status not in ('paid','upfront_paid') then raise exception 'Rent payment must be confirmed first'; end if;

  if v_reservation.stay_type='short_let' then
    v_start:=greatest(current_date,coalesce(v_reservation.stay_check_in,current_date));
    v_end:=coalesce(v_reservation.stay_check_out,v_start+1);
  else
    v_end:=(v_start + make_interval(years=>greatest(1,coalesce(v_reservation.rental_plan_years,1))))::date;
  end if;

  update public.reservations set status='occupied',tenancy_start_date=v_start,tenancy_end_date=v_end,
    occupancy_started_at=now(),updated_at=now() where id=v_reservation.id;
  update public.listings set status='occupied',availability_status='unavailable',updated_at=now()
    where id::text=v_reservation.listing_id;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  values('USER_MOVE_IN_CONFIRMED','reservations',v_reservation.id,
    jsonb_build_object('booking_code',v_reservation.booking_code,'tenancy_start_date',v_start,'tenancy_end_date',v_end)::text,v_actor.user_id,v_actor.email);
  return jsonb_build_object('success',true,'status','occupied','tenancy_start_date',v_start,'tenancy_end_date',v_end);
end $$;

revoke all on function public.confirm_my_move_in(text) from public,anon;
grant execute on function public.confirm_my_move_in(text) to authenticated;
