create or replace function public.create_rent_plan(p_user_id text, p_listing_id uuid, p_target_amount numeric)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public','extensions' as $$
declare v_plan_id uuid; v_start_months integer; v_cancel_percent numeric; v_actor text;
begin
  select user_id into v_actor from public.profiles where auth_id=auth.uid()::text and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null or v_actor<>p_user_id then raise exception 'Authenticated user mismatch'; end if;
  select coalesce(nullif(value,'')::integer,4) into v_start_months from public.platform_settings where key='rent_plan_start_after_months';
  select coalesce(nullif(value,'')::numeric,10) into v_cancel_percent from public.platform_settings where key='rent_plan_cancellation_fee_percent';
  insert into public.rent_plans(user_id,listing_id,target_amount,start_after_months,cancellation_fee_percent,accepted_terms,status,tenancy_start_date)
  values(p_user_id,p_listing_id,p_target_amount,v_start_months,v_cancel_percent,jsonb_build_object('start_after_months',v_start_months,'cancellation_fee_percent',v_cancel_percent,'snapshot_at',now())::text,'active',current_date)
  returning id into v_plan_id;
  return v_plan_id;
end $$;

create or replace function public.create_worker_booking_v2(p_user_id text,p_worker_id text,p_agreed_price numeric,p_service_type text default null,p_address text default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public','extensions' as $$
declare v_booking_id uuid; v_commission_percent numeric; v_wehouse_fee numeric; v_actor text;
begin
  select user_id into v_actor from public.profiles where auth_id=auth.uid()::text and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null or v_actor<>p_user_id then raise exception 'Authenticated user mismatch'; end if;
  if p_agreed_price is null or p_agreed_price<=0 then raise exception 'Agreed price must be greater than zero'; end if;
  select coalesce(nullif(value,'')::numeric,15) into v_commission_percent from public.platform_settings where key='commission_worker';
  v_wehouse_fee:=round(p_agreed_price*v_commission_percent/100,2);
  insert into public.worker_bookings(user_id,worker_id,service_type,agreed_amount,worker_receives,status,address,notes)
  values(p_user_id,p_worker_id,p_service_type,p_agreed_price,p_agreed_price-v_wehouse_fee,'pending',p_address,p_notes) returning id into v_booking_id;
  return v_booking_id;
end $$;

create or replace function public.staff_branch_analytics(p_staff_user_id text)
returns table(metric text,value integer) language plpgsql security definer set search_path to 'public' as $$
declare v_staff record; v_permission text; v_actor text;
begin
  select user_id into v_actor from public.profiles where auth_id=auth.uid()::text and role='staff' and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null or v_actor<>p_staff_user_id then raise exception 'Staff account required'; end if;
  select assigned_state,assigned_lga,scope into v_staff from public.profiles where user_id=p_staff_user_id and role='staff';
  if v_staff.assigned_state is null or v_staff.assigned_lga is null then metric:='unassigned'; value:=1; return next; return; end if;
  select permission into v_permission from public.staff_permissions where staff_id=p_staff_user_id and is_active=true limit 1;
  if v_permission='field_officer' then metric:='inspections'; select count(*)::integer into value from public.user_inspection_requests uir join public.listings l on l.id=uir.listing_id where l.state=v_staff.assigned_state and coalesce(l.city,l.local_government)=v_staff.assigned_lga and uir.field_officer_id=p_staff_user_id and uir.status in ('scheduled','in_progress'); return next; end if;
  if v_permission='support' then metric:='open_conversations'; select count(*)::integer into value from public.partner_support_conversations c join public.profiles p on p.user_id=c.partner_id where c.status not in ('resolved','closed') and p.state=v_staff.assigned_state and coalesce(nullif(p.local_government,''),p.city)=v_staff.assigned_lga; return next; end if;
  if v_permission='operations' then metric:='pending_listings'; select count(*)::integer into value from public.listings where status='pending_approval' and state=v_staff.assigned_state and coalesce(city,local_government)=v_staff.assigned_lga; return next; end if;
  if v_permission='verification' then metric:='pending_workers'; select count(*)::integer into value from public.profiles where role='worker' and worker_status='pending' and state=v_staff.assigned_state and coalesce(local_government,city)=v_staff.assigned_lga; return next; end if;
  if v_permission='finance' then metric:='pending_withdrawals'; select count(*)::integer into value from public.withdrawals w join public.wallets wl on wl.id=w.wallet_id join public.profiles p on p.user_id=wl.owner_id where w.status='pending' and p.state=v_staff.assigned_state and coalesce(p.local_government,p.city)=v_staff.assigned_lga; return next; end if;
end $$;

create or replace function public.approve_withdrawal_v2(p_withdrawal_id uuid,p_approved_by text)
returns boolean language plpgsql security definer set search_path to 'pg_catalog','public','extensions' as $$
declare v_withdrawal record; v_wallet record; v_actor public.profiles; v_finance_staff boolean;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  select exists(select 1 from public.staff_permissions where staff_id=v_actor.user_id and permission='finance' and is_active=true) into v_finance_staff;
  if v_actor is null or v_actor.user_id<>p_approved_by or (v_actor.role not in ('creator','admin') and not (v_actor.role='staff' and v_finance_staff)) then raise exception 'Finance approval access required'; end if;
  select * into v_withdrawal from public.withdrawals where id=p_withdrawal_id for update;
  if not found then raise exception 'Withdrawal not found'; end if;
  if v_withdrawal.status not in ('pending','processing') then raise exception 'Cannot be approved'; end if;
  select * into v_wallet from public.wallets where id=v_withdrawal.wallet_id for update;
  if v_wallet.owner_id=p_approved_by then raise exception 'Cannot approve own withdrawal'; end if;
  update public.wallets set frozen_balance=greatest(0,frozen_balance-v_withdrawal.amount),total_withdrawn=total_withdrawn+v_withdrawal.amount,updated_at=now() where id=v_withdrawal.wallet_id;
  update public.withdrawals set status='successful',processed_at=now(),updated_at=now() where id=p_withdrawal_id;
  return true;
end $$;
