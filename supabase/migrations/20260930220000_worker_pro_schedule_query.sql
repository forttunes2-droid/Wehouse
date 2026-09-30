-- Qualify booking columns after joining the customer profile.
CREATE OR REPLACE FUNCTION public.get_my_worker_pro_business()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
end $function$;
