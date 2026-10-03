-- Partner pilot tools are available without a subscription. Selling Partner Pro
-- requires a separate entitlement, terms and channel-aware billing migration.
create table public.partner_pro_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  asset_kind text not null check (asset_kind in ('home','hotel')),
  asset_id text not null,
  title text not null check (length(btrim(title)) between 3 and 160),
  due_on date,
  status text not null default 'open' check (status in ('open','done')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index partner_pro_tasks_owner_due on public.partner_pro_tasks(owner_id,status,due_on);
alter table public.partner_pro_tasks enable row level security;
revoke all on public.partner_pro_tasks from public,anon,authenticated;

create or replace function public.partner_pro_owns_asset(p_kind text,p_id text)
returns boolean language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  select public.current_actor_has_workspace('property_partner',null) and (
    (p_kind='home' and exists (
      select 1 from public.property_host_assignments a
      join public.listings l on l.id=a.listing_id
      where l.id::text=p_id and a.user_id=public.current_profile_user_id()
        and a.assignment_role='owner' and a.status='active' and l.deleted_at is null
    )) or (p_kind='hotel' and exists (
      select 1 from public.hotels h where h.hotel_id::text=p_id
        and h.owner_id=public.current_profile_user_id()
    ))
  )
$$;
revoke all on function public.partner_pro_owns_asset(text,text) from public,anon;
grant execute on function public.partner_pro_owns_asset(text,text) to authenticated,service_role;

create or replace function public.save_my_partner_pro_task(
  p_kind text,p_asset_id text,p_title text default null,p_due_on date default null,
  p_task_id uuid default null,p_done boolean default false
) returns uuid language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_task public.partner_pro_tasks; v_id uuid;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  if p_task_id is not null then
    select * into v_task from public.partner_pro_tasks
    where id=p_task_id and owner_id=v_actor for update;
    if not found or v_task.asset_kind<>p_kind or v_task.asset_id<>p_asset_id
      or not public.partner_pro_owns_asset(v_task.asset_kind,v_task.asset_id) then
      raise exception 'Task unavailable';
    end if;
    update public.partner_pro_tasks set status=case when p_done then 'done' else 'open' end,
      completed_at=case when p_done then now() else null end where id=p_task_id;
    return p_task_id;
  end if;
  if not public.partner_pro_owns_asset(p_kind,p_asset_id) then raise exception 'Property unavailable'; end if;
  if length(btrim(coalesce(p_title,''))) not between 3 and 160 then raise exception 'Task title must be 3 to 160 characters'; end if;
  if p_due_on is not null and (p_due_on<current_date-365 or p_due_on>current_date+730)
    then raise exception 'Task date outside supported range'; end if;
  insert into public.partner_pro_tasks(owner_id,asset_kind,asset_id,title,due_on)
  values(v_actor,p_kind,p_asset_id,btrim(p_title),p_due_on) returning id into v_id;
  return v_id;
end
$$;
revoke all on function public.save_my_partner_pro_task(text,text,text,date,uuid,boolean) from public,anon;
grant execute on function public.save_my_partner_pro_task(text,text,text,date,uuid,boolean) to authenticated,service_role;

create or replace function public.get_my_partner_pro_overview()
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_assets jsonb; v_stays jsonb;
  v_income jsonb; v_tasks jsonb;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
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
    select id,asset_kind,asset_id,title,due_on,status,created_at from public.partner_pro_tasks
    where owner_id=v_actor and public.partner_pro_owns_asset(asset_kind,asset_id)
    order by due_on nulls last,created_at desc limit 200
  ) t;
  return jsonb_build_object('assets',v_assets,'stays',v_stays,'income',v_income,
    'tasks',v_tasks,'stays_limited',jsonb_array_length(v_stays)=1000,
    'tasks_limited',jsonb_array_length(v_tasks)=200);
end
$$;
revoke all on function public.get_my_partner_pro_overview() from public,anon;
grant execute on function public.get_my_partner_pro_overview() to authenticated,service_role;
