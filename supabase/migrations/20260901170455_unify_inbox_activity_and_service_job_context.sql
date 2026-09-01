-- Keep the service request canonical for both participants. The conversation,
-- Jobs view and user Bookings view all reopen this same worker_bookings row.
alter table public.worker_bookings
  add column if not exists request_attachments text[] not null default array[]::text[];

create index if not exists worker_bookings_participant_updated_idx
  on public.worker_bookings(user_id, worker_id, updated_at desc);

create or replace function public.get_my_worker_booking_details(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  booking public.worker_bookings;
  customer public.profiles;
  worker public.profiles;
  payment_state text;
begin
  select p.* into actor
  from public.profiles p
  where p.auth_id = (select auth.uid())::text
    and coalesce(p.deleted,false)=false
    and coalesce(p.suspended,false)=false
    and coalesce(p.banned,false)=false
  limit 1;
  if actor is null then raise exception 'Authentication required'; end if;

  select wb.* into booking from public.worker_bookings wb where wb.id=p_booking_id;
  if booking is null then return null; end if;
  if actor.user_id is distinct from booking.user_id and actor.user_id is distinct from booking.worker_id then
    raise exception 'Booking participant access required';
  end if;

  select p.* into customer from public.profiles p where p.user_id=booking.user_id limit 1;
  select p.* into worker from public.profiles p where p.user_id=booking.worker_id limit 1;
  select bp.status into payment_state
  from public.booking_payments bp
  where bp.worker_booking_id=booking.id
  order by bp.created_at desc
  limit 1;

  return jsonb_build_object(
    'id',booking.id,'booking_code',booking.booking_code,'status',booking.status,
    'service_type',booking.service_type,'description',booking.description,
    'customer_message',booking.customer_message,'request_attachments',booking.request_attachments,
    'address',booking.address,'scheduled_date',booking.scheduled_date,
    'negotiated_amount',booking.negotiated_amount,'agreed_amount',booking.agreed_amount,
    'wehouse_fee',booking.wehouse_fee,'worker_receives',booking.worker_receives,
    'payment_status',coalesce(payment_state,'not_started'),
    'created_at',booking.created_at,'updated_at',booking.updated_at,
    'user_id',booking.user_id,'worker_id',booking.worker_id,
    'user_name',coalesce(customer.full_name,customer.username,'Customer'),
    'customer_username',customer.username,'user_avatar',customer.avatar_url,
    'worker_name',coalesce(worker.full_name,worker.username,'Worker'),'worker_avatar',worker.avatar_url
  );
end
$$;

revoke all on function public.get_my_worker_booking_details(uuid) from public, anon;
grant execute on function public.get_my_worker_booking_details(uuid) to authenticated, service_role;

revoke insert, update, delete on public.worker_bookings from anon;
grant select on public.worker_bookings to authenticated;
