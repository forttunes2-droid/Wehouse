begin;
create table public.worker_pro_job_costs (
 worker_id text not null references public.profiles(user_id) on delete cascade,
 booking_id uuid not null references public.worker_bookings(id) on delete cascade,
 amount numeric(12,2) not null check(amount>=0 and amount<=10000000),
 note text not null default '' check(length(note)<=600),
 updated_at timestamptz not null default now(),
 primary key(worker_id,booking_id)
);
alter table public.worker_pro_job_costs enable row level security;
revoke all on public.worker_pro_job_costs from public,anon,authenticated;
grant all on public.worker_pro_job_costs to service_role;
create or replace function public.save_my_worker_pro_job_cost(p_booking_id uuid,p_amount numeric,p_note text default '')
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare actor text:=public.worker_pro_current_actor();
begin
 if p_amount is null or p_amount<0 or p_amount>10000000 or length(coalesce(p_note,''))>600 then raise exception 'Invalid job cost'; end if;
 if not exists(select 1 from public.worker_bookings where id=p_booking_id and worker_id=actor
   and status in ('confirmed','in_progress','completed_pending_approval','approved_released')) then raise exception 'Job unavailable'; end if;
 insert into public.worker_pro_job_costs(worker_id,booking_id,amount,note) values(actor,p_booking_id,round(p_amount,2),btrim(coalesce(p_note,'')))
 on conflict(worker_id,booking_id) do update set amount=excluded.amount,note=excluded.note,updated_at=now();
 return true;
end $$;
revoke all on function public.save_my_worker_pro_job_cost(uuid,numeric,text) from public,anon;
grant execute on function public.save_my_worker_pro_job_cost(uuid,numeric,text) to authenticated;
create or replace function public.get_my_worker_pro_job_costs()
returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare actor text:=public.worker_pro_current_actor();
begin
 return coalesce((select jsonb_agg(to_jsonb(j) order by j.scheduled_date desc) from (
 select b.id,b.booking_code,b.service_type,b.scheduled_date,b.status,
   case when b.status='approved_released' then coalesce(b.worker_receives,0) else null end released_earnings_ngn,
   c.amount cost_ngn,coalesce(c.note,'') note
 from public.worker_bookings b left join public.worker_pro_job_costs c on c.worker_id=actor and c.booking_id=b.id
 where b.worker_id=actor and b.status in ('confirmed','in_progress','completed_pending_approval','approved_released')
 order by b.scheduled_date desc,b.id limit 150
 ) j),'[]'::jsonb);
end $$;
revoke all on function public.get_my_worker_pro_job_costs() from public,anon;
grant execute on function public.get_my_worker_pro_job_costs() to authenticated;

alter table public.partner_pro_tasks add column repeat_days integer check(repeat_days between 1 and 365),
 add column previous_task_id uuid unique references public.partner_pro_tasks(id);
create or replace function public.create_my_partner_pro_recurring_task(p_kind text,p_asset_id text,p_title text,p_due_on date,p_repeat_days integer)
returns uuid language plpgsql security definer set search_path='pg_catalog','public' as $$
declare task_id uuid;
begin
 if p_repeat_days is not null and (p_repeat_days not between 1 and 365 or p_due_on is null) then raise exception 'Repeating tasks need a due date and a 1 to 365 day interval'; end if;
 task_id:=public.save_my_partner_pro_task(p_kind,p_asset_id,p_title,p_due_on,null,false);
 update public.partner_pro_tasks set repeat_days=p_repeat_days where id=task_id;
 return task_id;
end $$;
revoke all on function public.create_my_partner_pro_recurring_task(text,text,text,date,integer) from public,anon;
grant execute on function public.create_my_partner_pro_recurring_task(text,text,text,date,integer) to authenticated;
create or replace function public.advance_partner_pro_recurring_task()
returns trigger language plpgsql security definer set search_path='pg_catalog','public' as $$
begin
 if old.status='done' and new.status='open' and exists(select 1 from public.partner_pro_tasks where previous_task_id=old.id) then
   raise exception 'This repeating task already has a next occurrence';
 end if;
 if old.status='open' and new.status='done' and old.repeat_days is not null and old.due_on is not null then
   insert into public.partner_pro_tasks(owner_id,asset_kind,asset_id,title,due_on,repeat_days,previous_task_id)
   values(old.owner_id,old.asset_kind,old.asset_id,old.title,greatest(old.due_on,current_date)+old.repeat_days,old.repeat_days,old.id)
   on conflict(previous_task_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function public.advance_partner_pro_recurring_task() from public,anon,authenticated;
create trigger advance_partner_pro_recurring_task before update of status on public.partner_pro_tasks
 for each row execute function public.advance_partner_pro_recurring_task();
CREATE OR REPLACE FUNCTION public.get_my_partner_pro_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_assets jsonb; v_stays jsonb;
  v_income jsonb; v_tasks jsonb;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null)
    or not public.partner_pro_is_active(v_actor) then raise exception 'Active Property Partner Pro required'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.title),'[]'::jsonb) into v_assets from (
    select 'home'::text kind,l.id::text id,l.title from public.property_host_assignments a
      join public.listings l on l.id=a.listing_id
      where a.user_id=v_actor and a.assignment_role='owner' and a.status='active' and l.deleted_at is null
    union all
    select 'hotel',h.hotel_id::text,h.name from public.hotels h where h.owner_id=v_actor
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.check_in,x.asset_title),'[]'::jsonb) into v_stays from (
    select 'home'::text kind,l.id::text asset_id,l.title asset_title,r.id::text booking_id,
      r.stay_check_in::date check_in,r.stay_check_out::date check_out,r.status
    from public.reservations r join public.listings l on r.listing_id in (l.id::text,l.listing_id)
    join public.property_host_assignments a on a.listing_id=l.id and a.user_id=v_actor
      and a.assignment_role='owner' and a.status='active'
    where l.deleted_at is null and r.stay_check_in>=current_date-30
      and r.stay_check_in<current_date+180 and r.status not in ('cancelled','expired','refunded')
      and (r.rent_payment_status='paid' or r.manual_payment_status in ('paid','completed') or r.status in ('occupied','completed'))
    union all
    select 'hotel',h.hotel_id::text,h.name,b.booking_id::text,b.check_in,b.check_out,b.status
    from public.hotel_bookings b join public.hotels h on h.hotel_id=b.hotel_id
    where h.owner_id=v_actor and b.check_in>=current_date-30 and b.check_in<current_date+180
      and b.status not in ('cancelled','expired','refunded','payment_conflict')
      and (b.payment_status='paid' or b.status in ('confirmed','checked_in','checked_out','completed'))
    order by check_in limit 1000
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.month_key),'[]'::jsonb) into v_income from (
    select to_char(date_trunc('month',coalesce(released_at,created_at)),'YYYY-MM') as month_key,
      sum(net_amount) net_amount,count(*) earnings
    from public.property_partner_earning_releases
    where partner_id=v_actor and status='available'
      and coalesce(released_at,created_at)>=date_trunc('month',now())-interval '11 months'
    group by 1
  ) x;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.due_on nulls last,t.created_at desc),'[]'::jsonb)
  into v_tasks from (
    select id,asset_kind,asset_id,title,due_on,status,created_at,repeat_days,previous_task_id from public.partner_pro_tasks
    where owner_id=v_actor and public.partner_pro_owns_asset(asset_kind,asset_id)
    order by due_on nulls last,created_at desc limit 200
  ) t;
  return jsonb_build_object('assets',v_assets,'stays',v_stays,'income',v_income,
    'tasks',v_tasks,'stays_limited',jsonb_array_length(v_stays)=1000,
    'tasks_limited',jsonb_array_length(v_tasks)=200);
end $function$;
commit;
