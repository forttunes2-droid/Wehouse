-- A completed booking does not itself grant permission to build a customer file.
begin;
create table public.worker_customer_record_consents (
  worker_id text not null references public.profiles(user_id) on delete cascade,
  customer_id text not null references public.profiles(user_id) on delete cascade,
  consented_at timestamptz not null default now(),
  primary key(worker_id,customer_id)
);
alter table public.worker_customer_record_consents enable row level security;
revoke all on public.worker_customer_record_consents from public,anon,authenticated;
grant all on public.worker_customer_record_consents to service_role;

create or replace function public.get_my_worker_customer_record_consent(p_worker_id text)
returns boolean language sql stable security definer set search_path='pg_catalog','public' as $$
  select public.current_profile_user_id() is not null and exists(
    select 1 from public.worker_customer_record_consents c
      where c.customer_id=public.current_profile_user_id() and c.worker_id=p_worker_id)
$$;
revoke all on function public.get_my_worker_customer_record_consent(text) from public,anon;
grant execute on function public.get_my_worker_customer_record_consent(text) to authenticated;

create or replace function public.set_my_worker_customer_record_consent(p_worker_id text,p_consent boolean)
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null or not exists(select 1 from public.worker_bookings
      where user_id=v_actor and worker_id=p_worker_id and status='approved_released') then
    raise exception 'A completed job with this Worker is required'; end if;
  if coalesce(p_consent,false) then
    insert into public.worker_customer_record_consents(worker_id,customer_id) values(p_worker_id,v_actor)
    on conflict do nothing;
  else
    delete from public.worker_customer_record_consents where worker_id=p_worker_id and customer_id=v_actor;
    delete from public.worker_pro_customer_notes where worker_id=p_worker_id and customer_id=v_actor;
  end if;
  return coalesce(p_consent,false);
end $$;
revoke all on function public.set_my_worker_customer_record_consent(text,boolean) from public,anon;
grant execute on function public.set_my_worker_customer_record_consent(text,boolean) to authenticated;

create or replace function public.save_my_worker_pro_customer_note(p_customer_id text,p_note text)
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.worker_pro_current_actor();
begin
  if not exists(select 1 from public.worker_bookings b
    join public.worker_customer_record_consents c on c.worker_id=b.worker_id and c.customer_id=b.user_id
    where b.worker_id=v_actor and b.user_id=p_customer_id and b.status='approved_released') then
    raise exception 'Customer has not consented to a record'; end if;
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
        join public.worker_customer_record_consents consent on consent.worker_id=b.worker_id and consent.customer_id=b.user_id
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
commit;
