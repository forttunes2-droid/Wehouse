begin;
set local search_path='';
-- Count fulfilled session IDs, not draft activities or the number of guests.
create index experience_host_completed_sessions on public.experience_bookings(host_user_id,session_id)
 where attendance_confirmed_at is not null and host_finished_at is not null and customer_completed_at is not null;
do $totals$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.get_worker_marketplace_trust(text)'::regprocedure);
 needle:='  v_completed integer:=0;';
 if strpos(definition,needle)=0 then raise exception 'Inspect Provider completion declaration';end if;
 definition:=replace(definition,needle,'  v_activity_sessions integer:=0; v_reviews record;'||E'\n'||needle);
 needle:='  v_pro:=public.worker_pro_is_active(p_worker_id);';
 if strpos(definition,needle)=0 then raise exception 'Inspect Provider review projection';end if;
 definition:=replace(definition,needle,$counts$  select count(distinct b.session_id) into v_activity_sessions from public.experience_bookings b
    where b.host_user_id=p_worker_id and b.attendance_confirmed_at is not null and b.host_finished_at is not null and b.customer_completed_at is not null and private.experience_review_earned(b);
  select count(*)::integer total,coalesce(round(avg(r.rating)::numeric,2),0) rating,
    count(*) filter(where r.rating=1)::integer one,count(*) filter(where r.rating=2)::integer two,
    count(*) filter(where r.rating=3)::integer three,count(*) filter(where r.rating=4)::integer four,
    count(*) filter(where r.rating=5)::integer five
  into v_reviews from public.worker_booking_reviews r where r.worker_id=p_worker_id and private.provider_review_earned(r);
  v_pro:=public.worker_pro_is_active(p_worker_id);$counts$);
 needle:='''completed_jobs'',v_completed,''rating'',coalesce(v_worker.rating,0),''review_count'',coalesce(v_worker.review_count,0),';
 if strpos(definition,needle)=0 then raise exception 'Inspect Provider totals response';end if;
 definition:=replace(definition,needle,$projection$'completed_jobs',v_completed,'completed_activity_sessions',v_activity_sessions,
    'rating',v_reviews.rating,'review_count',v_reviews.total,
    'rating_counts',jsonb_build_array(v_reviews.one,v_reviews.two,v_reviews.three,v_reviews.four,v_reviews.five),$projection$);
 execute definition;
end $totals$;
commit;
