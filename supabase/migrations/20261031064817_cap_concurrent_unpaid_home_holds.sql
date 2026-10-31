begin;
set local search_path='';
insert into public.platform_settings(key,value,category,label,description,data_type,editable,is_active)
values('active_unpaid_home_hold_limit','3','bookings','Unpaid home reservations per person',
 'Maximum simultaneous unexpired unpaid Long Let or Short Let reservation checkouts. Paid bookings are excluded.','number',false,true)
on conflict(key) do nothing;

create index reservations_live_unpaid_owner on public.reservations(user_id,payment_expires_at)
where status='payment_pending' and reservation_fee_paid_at is null;

create function private.unpaid_home_hold_limit() returns integer
language plpgsql stable security definer set search_path='' as $$
declare configured text;
begin
 select value into configured from public.platform_settings where key='active_unpaid_home_hold_limit' and is_active;
 if configured is null or configured !~ '^[0-9]{1,2}$' or configured::integer not between 1 and 20 then
  raise exception 'Reservation limits are unavailable. Try again later';end if;
 return configured::integer;
end $$;
revoke all on function private.unpaid_home_hold_limit() from public,anon,authenticated,service_role;

create function private.enforce_unpaid_home_hold_limit() returns trigger
language plpgsql security definer set search_path='' as $$
declare maximum integer; held integer;
begin
 if new.status<>'payment_pending' or new.reservation_type is distinct from 'apartment'
  or new.reservation_fee_paid_at is not null or coalesce(new.reservation_fee_status,'') in('paid','completed')
  or coalesce(new.manual_payment_status,'') in('paid','completed') or coalesce(new.payment_expires_at,'-infinity')<=now() then return new;end if;
 -- A retry/metadata update to an already counted live checkout uses no new slot.
 -- Extending an expired checkout or moving ownership must acquire a slot again.
 if tg_op='UPDATE' then
  if old.user_id=new.user_id and old.status='payment_pending' and old.reservation_type='apartment'
   and old.reservation_fee_paid_at is null and coalesce(old.reservation_fee_status,'') not in('paid','completed')
   and coalesce(old.manual_payment_status,'') not in('paid','completed') and old.payment_expires_at>now() then return new;end if;
 end if;
 if new.user_id is null then raise exception 'A reservation requires its customer';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('unpaid-home-holds:'||new.user_id,0));
 maximum:=private.unpaid_home_hold_limit();
 select count(*) into held from public.reservations r where r.user_id=new.user_id and r.status='payment_pending'
 and r.reservation_type='apartment' and r.reservation_fee_paid_at is null
 and coalesce(r.reservation_fee_status,'') not in('paid','completed') and coalesce(r.manual_payment_status,'') not in('paid','completed')
 and r.payment_expires_at>now() and r.id is distinct from new.id;
 if held>=maximum then raise exception 'You already have % unpaid property reservations. Complete a payment, cancel a reservation or wait for a hold to expire before reserving another home',maximum using errcode='53400';end if;
 return new;
end $$;
revoke all on function private.enforce_unpaid_home_hold_limit() from public,anon,authenticated,service_role;
create trigger aa0_reservation_unpaid_hold_limit before insert or update of user_id,status,reservation_type,payment_expires_at,reservation_fee_paid_at,reservation_fee_status,manual_payment_status
on public.reservations for each row execute function private.enforce_unpaid_home_hold_limit();

create function public.creator_get_unpaid_home_hold_limit() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare changed_at timestamptz;
begin
 if not public.current_actor_has_workspace('creator',null) then raise exception 'Active Creator workspace required';end if;
 select updated_at into changed_at from public.platform_settings where key='active_unpaid_home_hold_limit' and is_active;
 return jsonb_build_object('limit',private.unpaid_home_hold_limit(),'updated_at',changed_at);
end $$;
revoke all on function public.creator_get_unpaid_home_hold_limit() from public,anon,authenticated,service_role;
grant execute on function public.creator_get_unpaid_home_hold_limit() to authenticated;

create function public.creator_set_unpaid_home_hold_limit(p_limit integer,p_expected_updated_at timestamptz,p_creator_elevation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare setting public.platform_settings;
begin
 if not public.current_actor_has_workspace('creator',null) or not public.creator_has_elevation(p_creator_elevation_id,'policy_publish') then
  raise exception 'Recent Creator policy authentication required';end if;
 if p_limit is null or p_limit not between 1 and 20 then raise exception 'Choose 1 to 20 unpaid reservations per person';end if;
 select * into setting from public.platform_settings where key='active_unpaid_home_hold_limit' and is_active for update;
 if setting.id is null then raise exception 'Reservation limits are unavailable';end if;
 -- A lost save response can be retried without another write or audit entry.
 if setting.value=p_limit::text then return public.creator_get_unpaid_home_hold_limit();end if;
 if p_expected_updated_at is null or setting.updated_at is distinct from p_expected_updated_at then
  raise exception 'Reservation limits changed. Reload before saving';end if;
 update public.platform_settings set value=p_limit::text,updated_at=clock_timestamp() where id=setting.id;
 insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
 values(public.current_profile_user_id(),'unpaid_home_hold_limit_updated','platform_settings',setting.key,
 jsonb_build_object('before',setting.value,'after',p_limit,'existing_holds_cancelled',false)::text,now());
 return public.creator_get_unpaid_home_hold_limit();
end $$;
revoke all on function public.creator_set_unpaid_home_hold_limit(integer,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.creator_set_unpaid_home_hold_limit(integer,timestamptz,uuid) to authenticated;
commit;
