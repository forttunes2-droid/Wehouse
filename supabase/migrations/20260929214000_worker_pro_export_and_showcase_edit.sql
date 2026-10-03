-- The paid report uses the same released-job definition as Work Insights.
create or replace function public.get_my_worker_pro_earnings_export(p_days integer default 365)
returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare v_worker text:=public.current_profile_user_id(); v_days integer;
begin
  if p_days not in (30,90,365) then raise exception 'Unsupported report period'; end if;
  if v_worker is null or not public.current_actor_has_workspace('worker',null)
    or not public.worker_pro_is_active(v_worker) then
    raise exception 'Active paid Worker plan required'; end if;
  v_days:=p_days;
  return coalesce((select jsonb_agg(to_jsonb(rows) order by rows.released_at desc) from (
    select b.booking_code,b.service_type,
      coalesce(b.completed_at,b.updated_at) released_at,
      coalesce(b.worker_receives,0) worker_earnings_ngn
    from public.worker_bookings b where b.worker_id=v_worker
      and b.status='approved_released'
      and coalesce(b.completed_at,b.updated_at)>=now()-make_interval(days=>v_days)
    order by coalesce(b.completed_at,b.updated_at) desc limit 2000
  ) rows),'[]'::jsonb);
end $$;
revoke all on function public.get_my_worker_pro_earnings_export(integer) from public,anon;
grant execute on function public.get_my_worker_pro_earnings_export(integer) to authenticated;

-- Editing descriptive text preserves the media, job confirmation and engagement.
create or replace function public.update_my_worker_showcase_caption(p_post_id uuid,p_caption text)
returns text language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_worker text:=public.current_profile_user_id(); v_caption text:=nullif(btrim(coalesce(p_caption,'')),'');
begin
  if v_worker is null or not public.current_actor_has_workspace('worker',null) then
    raise exception 'Worker workspace required'; end if;
  if length(coalesce(v_caption,''))>300 then raise exception 'Caption is too long'; end if;
  update public.worker_showcase_posts set caption=v_caption where id=p_post_id
    and worker_id=v_worker and kind='work_post' and deleted_at is null;
  if not found then raise exception 'Work post unavailable'; end if;
  return v_caption;
end $$;
revoke all on function public.update_my_worker_showcase_caption(uuid,text) from public,anon;
grant execute on function public.update_my_worker_showcase_caption(uuid,text) to authenticated;
