-- Optional Worker business tools. Jobs, visibility, booking and basic receipts
-- remain available independently of a paid subscription.
begin;

create table public.worker_pro_service_packages (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null references public.profiles(user_id) on delete cascade,
  title text not null check(length(btrim(title)) between 3 and 80),
  description text not null check(length(btrim(description)) between 10 and 500),
  price_ngn numeric(12,2) not null check(price_ngn>=0 and price_ngn<=10000000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index worker_pro_packages_owner on public.worker_pro_service_packages(worker_id,active,created_at desc);

create table public.worker_pro_reminders (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null references public.profiles(user_id) on delete cascade,
  booking_id uuid not null references public.worker_bookings(id) on delete cascade,
  due_at timestamptz not null,
  note text not null check(length(btrim(note)) between 3 and 240),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(worker_id,booking_id)
);
create index worker_pro_reminders_due on public.worker_pro_reminders(worker_id,done_at,due_at);

create table public.worker_pro_customer_notes (
  worker_id text not null references public.profiles(user_id) on delete cascade,
  customer_id text not null references public.profiles(user_id) on delete cascade,
  note text not null check(length(btrim(note)) between 1 and 1000),
  updated_at timestamptz not null default now(),
  primary key(worker_id,customer_id)
);
create table public.worker_pro_receipt_notes (
  worker_id text not null references public.profiles(user_id) on delete cascade,
  booking_id uuid not null references public.worker_bookings(id) on delete cascade,
  note text not null check(length(btrim(note)) between 1 and 600),
  updated_at timestamptz not null default now(),
  primary key(worker_id,booking_id)
);

alter table public.worker_pro_service_packages enable row level security;
alter table public.worker_pro_reminders enable row level security;
alter table public.worker_pro_customer_notes enable row level security;
alter table public.worker_pro_receipt_notes enable row level security;
revoke all on public.worker_pro_service_packages,public.worker_pro_reminders,
  public.worker_pro_customer_notes,public.worker_pro_receipt_notes from public,anon,authenticated;
grant all on public.worker_pro_service_packages,public.worker_pro_reminders,
  public.worker_pro_customer_notes,public.worker_pro_receipt_notes to service_role;

create or replace function public.worker_pro_current_actor()
returns text language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null or not public.current_actor_has_workspace('worker',null)
    or not public.worker_pro_is_active(v_actor) then
    raise exception 'An active paid Worker plan is required';
  end if;
  return v_actor;
end $$;
revoke all on function public.worker_pro_current_actor() from public,anon;
grant execute on function public.worker_pro_current_actor() to authenticated;

create or replace function public.get_my_worker_pro_business()
returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.worker_pro_current_actor();
begin
  return jsonb_build_object(
    'schedule',coalesce((select jsonb_agg(to_jsonb(j) order by j.scheduled_date,j.booking_code)
      from (select b.id,b.booking_code,b.service_type,b.scheduled_date,b.status,
        coalesce(nullif(customer.full_name,''),customer.username,'Customer') customer_name
        from public.worker_bookings b left join public.profiles customer on customer.user_id=b.user_id
        where b.worker_id=v_actor and b.scheduled_date between current_date-30 and current_date+365
          and b.status in ('confirmed','in_progress','completed_pending_approval')
        order by b.scheduled_date,b.created_at limit 150) j),'[]'::jsonb),
    'customers',coalesce((select jsonb_agg(to_jsonb(c) order by c.completed_jobs desc,c.last_job_at desc)
      from (select b.user_id customer_id,coalesce(nullif(p.full_name,''),p.username,'Customer') customer_name,
        count(*) completed_jobs,max(coalesce(b.completed_at,b.updated_at)) last_job_at,
        max(b.service_type) last_service,coalesce(n.note,'') note
        from public.worker_bookings b join public.profiles p on p.user_id=b.user_id
        left join public.worker_pro_customer_notes n on n.worker_id=v_actor and n.customer_id=b.user_id
        where b.worker_id=v_actor and b.status='approved_released'
        group by b.user_id,p.full_name,p.username,n.note
        order by count(*) desc,max(coalesce(b.completed_at,b.updated_at)) desc limit 100) c),'[]'::jsonb),
    'packages',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at)
      from (select id,title,description,price_ngn,active,created_at
        from public.worker_pro_service_packages where worker_id=v_actor
        order by created_at limit 20) p),'[]'::jsonb),
    'reminders',coalesce((select jsonb_agg(to_jsonb(r) order by r.due_at)
      from (select id,booking_id,due_at,note,done_at from public.worker_pro_reminders
        where worker_id=v_actor and (done_at is null or due_at>now()-interval '30 days')
        order by due_at limit 150) r),'[]'::jsonb),
    'receipts',coalesce((select jsonb_agg(to_jsonb(r) order by r.completed_at desc)
      from (select b.id booking_id,b.booking_code,b.service_type,b.user_id customer_id,
        coalesce(nullif(p.full_name,''),p.username,'Customer') customer_name,
        coalesce(b.negotiated_amount,b.agreed_amount) total_ngn,b.worker_receives worker_earnings_ngn,
        coalesce(b.completed_at,b.updated_at) completed_at,coalesce(n.note,'') note
        from public.worker_bookings b join public.profiles p on p.user_id=b.user_id
        left join public.worker_pro_receipt_notes n on n.worker_id=v_actor and n.booking_id=b.id
        where b.worker_id=v_actor and b.status='approved_released'
        order by coalesce(b.completed_at,b.updated_at) desc limit 100) r),'[]'::jsonb)
  );
end $$;
revoke all on function public.get_my_worker_pro_business() from public,anon;
grant execute on function public.get_my_worker_pro_business() to authenticated;

create or replace function public.save_my_worker_pro_package(
  p_id uuid,p_title text,p_description text,p_price_ngn numeric,p_active boolean default true)
returns uuid language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.worker_pro_current_actor(); v_id uuid;
begin
  if length(btrim(coalesce(p_title,''))) not between 3 and 80
    or length(btrim(coalesce(p_description,''))) not between 10 and 500
    or p_price_ngn is null or p_price_ngn<0 or p_price_ngn>10000000 then
    raise exception 'Enter a valid package, description and price'; end if;
  if p_id is null then
    perform 1 from public.profiles where user_id=v_actor for update;
    if (select count(*) from public.worker_pro_service_packages where worker_id=v_actor)>=20 then
      raise exception 'At most twenty saved packages are available'; end if;
    if coalesce(p_active,true) and (select count(*) from public.worker_pro_service_packages where worker_id=v_actor and active)>=6 then
      raise exception 'At most six active service packages are available'; end if;
    insert into public.worker_pro_service_packages(worker_id,title,description,price_ngn,active)
    values(v_actor,btrim(p_title),btrim(p_description),p_price_ngn,coalesce(p_active,true))
    returning id into v_id;
  else
    perform 1 from public.profiles where user_id=v_actor for update;
    if coalesce(p_active,true) and exists(select 1 from public.worker_pro_service_packages
      where id=p_id and worker_id=v_actor and not active)
      and (select count(*) from public.worker_pro_service_packages where worker_id=v_actor and active)>=6 then
      raise exception 'At most six active service packages are available'; end if;
    update public.worker_pro_service_packages set title=btrim(p_title),
      description=btrim(p_description),price_ngn=p_price_ngn,active=coalesce(p_active,true),updated_at=now()
      where id=p_id and worker_id=v_actor returning id into v_id;
    if v_id is null then raise exception 'Package unavailable'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.save_my_worker_pro_package(uuid,text,text,numeric,boolean) from public,anon;
grant execute on function public.save_my_worker_pro_package(uuid,text,text,numeric,boolean) to authenticated;

create or replace function public.save_my_worker_pro_reminder(
  p_booking_id uuid,p_due_at timestamptz,p_note text,p_done boolean default false)
returns uuid language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.worker_pro_current_actor(); v_id uuid;
begin
  if not exists(select 1 from public.worker_bookings where id=p_booking_id and worker_id=v_actor
    and (status in ('confirmed','in_progress','completed_pending_approval')
      or (p_done and exists(select 1 from public.worker_pro_reminders
        where booking_id=p_booking_id and worker_id=v_actor)))) then raise exception 'Job unavailable'; end if;
  if p_due_at is null or p_due_at<now()-interval '30 days' or p_due_at>now()+interval '1 year'
    or length(btrim(coalesce(p_note,''))) not between 3 and 240 then raise exception 'Invalid reminder'; end if;
  insert into public.worker_pro_reminders(worker_id,booking_id,due_at,note,done_at)
    values(v_actor,p_booking_id,p_due_at,btrim(p_note),case when p_done then now() else null end)
  on conflict(worker_id,booking_id) do update set due_at=excluded.due_at,note=excluded.note,
    done_at=excluded.done_at,updated_at=now()
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.save_my_worker_pro_reminder(uuid,timestamptz,text,boolean) from public,anon;
grant execute on function public.save_my_worker_pro_reminder(uuid,timestamptz,text,boolean) to authenticated;

create or replace function public.save_my_worker_pro_customer_note(p_customer_id text,p_note text)
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.worker_pro_current_actor();
begin
  if not exists(select 1 from public.worker_bookings
    where worker_id=v_actor and user_id=p_customer_id and status='approved_released') then
    raise exception 'Completed customer record unavailable'; end if;
  if length(btrim(coalesce(p_note,'')))>1000 then raise exception 'Note is too long'; end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null then
    delete from public.worker_pro_customer_notes where worker_id=v_actor and customer_id=p_customer_id;
  else
    insert into public.worker_pro_customer_notes(worker_id,customer_id,note)
      values(v_actor,p_customer_id,btrim(p_note))
    on conflict(worker_id,customer_id) do update set note=excluded.note,updated_at=now();
  end if;
  return true;
end $$;
revoke all on function public.save_my_worker_pro_customer_note(text,text) from public,anon;
grant execute on function public.save_my_worker_pro_customer_note(text,text) to authenticated;

create or replace function public.save_my_worker_pro_receipt_note(p_booking_id uuid,p_note text)
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.worker_pro_current_actor();
begin
  if not exists(select 1 from public.worker_bookings
    where id=p_booking_id and worker_id=v_actor and status='approved_released') then
    raise exception 'Released job unavailable'; end if;
  if length(btrim(coalesce(p_note,'')))>600 then raise exception 'Note is too long'; end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null then
    delete from public.worker_pro_receipt_notes where worker_id=v_actor and booking_id=p_booking_id;
  else
    insert into public.worker_pro_receipt_notes(worker_id,booking_id,note)
      values(v_actor,p_booking_id,btrim(p_note))
    on conflict(worker_id,booking_id) do update set note=excluded.note,updated_at=now();
  end if;
  return true;
end $$;
revoke all on function public.save_my_worker_pro_receipt_note(uuid,text) from public,anon;
grant execute on function public.save_my_worker_pro_receipt_note(uuid,text) to authenticated;

create or replace function public.get_worker_pro_service_packages(p_worker_id text)
returns jsonb language sql stable security definer set search_path='pg_catalog','public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',pkg.id,'title',pkg.title,
    'description',pkg.description,'price_ngn',pkg.price_ngn) order by pkg.created_at),'[]'::jsonb)
  from public.worker_pro_service_packages pkg
  join public.profiles p on p.user_id=pkg.worker_id
  where pkg.worker_id=p_worker_id and pkg.active
    and p.worker_status='verified' and coalesce(p.worker_verified,false)
    and not coalesce(p.deleted,false) and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false) and public.worker_pro_is_active(pkg.worker_id)
    and (coalesce((public._worker_publication_state(pkg.worker_id)->>'publicly_visible')::boolean,false)
      or pkg.worker_id=public.current_profile_user_id()
      or public.current_actor_has_workspace('creator',null))
$$;
revoke all on function public.get_worker_pro_service_packages(text) from public,anon;
grant execute on function public.get_worker_pro_service_packages(text) to authenticated;
commit;
