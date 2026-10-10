drop function public.save_my_worker_pro_job_cost(uuid,numeric,text);
create or replace function public.save_my_worker_pro_job_cost(p_booking_id uuid,p_cost_ngn numeric,p_note text default null::text)
returns boolean language plpgsql security definer set search_path to 'pg_catalog','public' as $function$
declare v_actor text:=public.worker_pro_current_actor();
begin
 if p_cost_ngn is null or p_cost_ngn<0 or p_cost_ngn>10000000 or length(coalesce(p_note,''))>300 then raise exception 'Invalid job cost'; end if;
 if not exists(select 1 from public.worker_bookings where id=p_booking_id and worker_id=v_actor and status='approved_released') then raise exception 'Released owned job required'; end if;
 insert into public.worker_pro_job_costs(worker_id,booking_id,cost_ngn,note) values(v_actor,p_booking_id,p_cost_ngn,nullif(btrim(p_note),''))
 on conflict(worker_id,booking_id) do update set cost_ngn=excluded.cost_ngn,note=excluded.note,updated_at=now();
 return true;
end $function$;
revoke all on function public.save_my_worker_pro_job_cost(uuid,numeric,text) from public,anon,authenticated,service_role;
grant execute on function public.save_my_worker_pro_job_cost(uuid,numeric,text) to service_role;
grant execute on function public.save_my_worker_pro_job_cost(uuid,numeric,text) to authenticated;
