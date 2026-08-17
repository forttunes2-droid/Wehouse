CREATE OR REPLACE FUNCTION public.creator_get_platform_analytics(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_days integer := LEAST(90, GREATEST(7, COALESCE(p_days,30)));
  v_start date;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor.user_id IS NULL OR v_actor.role<>'creator' OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN
    RAISE EXCEPTION 'Creator access required';
  END IF;
  v_start := CURRENT_DATE-(v_days-1);

  RETURN jsonb_build_object(
    'days',v_days,
    'period_start',v_start,
    'period_end',CURRENT_DATE,
    'summary',jsonb_build_object(
      'new_users',(SELECT count(*) FROM public.profiles WHERE role='user' AND created_at>=v_start AND deleted_at IS NULL),
      'new_workers',(SELECT count(*) FROM public.profiles WHERE role='worker' AND created_at>=v_start AND deleted_at IS NULL),
      'new_partners',(SELECT count(*) FROM public.profiles WHERE role='property_partner' AND created_at>=v_start AND deleted_at IS NULL),
      'published_listings',(SELECT count(*) FROM public.listings WHERE deleted_at IS NULL AND approved_at>=v_start AND status IN ('available','reserved','closed')),
      'worker_bookings',(SELECT count(*) FROM public.worker_bookings WHERE created_at>=v_start),
      'verified_payments',(SELECT count(*) FROM public.booking_payments WHERE verified_at>=v_start),
      'verified_payment_volume',(SELECT COALESCE(sum(COALESCE(amount_total,amount,0)),0) FROM public.booking_payments WHERE verified_at>=v_start),
      'commission_earned',(SELECT COALESCE(sum(commission_amount),0) FROM public.commission_ledger WHERE created_at>=v_start)
    ),
    'daily',(
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date',d::date,
        'signups',(SELECT count(*) FROM public.profiles p WHERE p.created_at>=d AND p.created_at<d+interval '1 day' AND p.deleted_at IS NULL),
        'published_listings',(SELECT count(*) FROM public.listings l WHERE l.approved_at>=d AND l.approved_at<d+interval '1 day' AND l.deleted_at IS NULL AND l.status IN ('available','reserved','closed')),
        'worker_bookings',(SELECT count(*) FROM public.worker_bookings w WHERE w.created_at>=d AND w.created_at<d+interval '1 day'),
        'verified_payments',(SELECT count(*) FROM public.booking_payments bp WHERE bp.verified_at>=d AND bp.verified_at<d+interval '1 day')
      ) ORDER BY d),'[]'::jsonb)
      FROM generate_series(v_start::timestamp,CURRENT_DATE::timestamp,interval '1 day') d
    ),
    'listing_pipeline',(
      SELECT COALESCE(jsonb_object_agg(status,cnt),'{}'::jsonb)
      FROM (SELECT COALESCE(status,'unknown') status,count(*) cnt FROM public.listings WHERE deleted_at IS NULL GROUP BY status) s
    ),
    'worker_pipeline',(
      SELECT COALESCE(jsonb_object_agg(worker_status,cnt),'{}'::jsonb)
      FROM (SELECT COALESCE(worker_status,'unknown') worker_status,count(*) cnt FROM public.profiles WHERE role='worker' AND deleted_at IS NULL GROUP BY worker_status) s
    ),
    'top_markets',(
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.available_listings DESC,x.state,x.lga),'[]'::jsonb)
      FROM (
        SELECT COALESCE(state,'Unknown') state,COALESCE(city,'Unknown') lga,count(*) available_listings
        FROM public.listings
        WHERE deleted_at IS NULL AND status='available'
        GROUP BY state,city
        ORDER BY count(*) DESC,state,city
        LIMIT 8
      ) x
    ),
    'activity',(
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]'::jsonb)
      FROM (
        SELECT a.id,a.action,a.target_type,a.target_id,a.details,a.created_at,a.admin_id,p.username AS actor_username,p.role AS actor_role
        FROM public.audit_logs a
        LEFT JOIN public.profiles p ON p.user_id=a.admin_id
        ORDER BY a.created_at DESC
        LIMIT 40
      ) x
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.creator_get_platform_analytics(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_get_platform_analytics(integer) TO authenticated;
