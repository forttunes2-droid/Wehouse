create or replace function public.creator_get_worker_refund_rules()
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog','public' as $$
declare v jsonb;
begin
  if not exists(select 1 from public.profiles
    where user_id=public.current_profile_user_id() and role='creator'
      and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)) then
    raise exception 'Creator access required';
  end if;
  select value into v from public.creator_policy_versions
  where policy_key='worker_refund_rules' and scope_type='global' and scope_key='*'
    and status='active' and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc limit 1;
  return coalesce(v,jsonb_build_object('before_start_refund_percent',100,'review_max_refund_percent',100));
end $$;
revoke all on function public.creator_get_worker_refund_rules() from public,anon;
grant execute on function public.creator_get_worker_refund_rules() to authenticated,service_role;

create or replace function public.list_worker_refund_reviews(p_status text default 'open')
returns table(review_id uuid, worker_booking_id uuid, kind text, reason text, status text, created_at timestamptz,
  amount_total numeric, released_amount numeric, refunded_amount numeric, refund_percent numeric, refund_amount numeric,
  max_refund_percent numeric)
language plpgsql stable security definer set search_path to 'pg_catalog','public' as $$
begin
  if not (public.current_staff_has_permission('operations')
     or exists(select 1 from public.profiles where user_id=public.current_profile_user_id() and role in('admin','creator')
       and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false))) then
    raise exception 'Operations access required';
  end if;
  return query
  select r.review_id,r.worker_booking_id,r.kind,r.reason,r.status,r.created_at,
    p.amount_total,p.released_amount,p.refunded_amount,r.refund_percent,r.refund_amount,
    private.worker_refund_rule('review_max_refund_percent')
  from public.worker_refund_reviews r
  join public.worker_bookings b on b.id=r.worker_booking_id
  left join public.payment_protection_transactions p on p.id=b.payment_protection_id
  where r.status=p_status
  order by r.created_at desc limit 100;
end $$;
revoke all on function public.list_worker_refund_reviews(text) from public,anon;
grant execute on function public.list_worker_refund_reviews(text) to authenticated,service_role;
