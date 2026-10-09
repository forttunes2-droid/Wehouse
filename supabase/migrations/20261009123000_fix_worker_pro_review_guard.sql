-- The production-schema reconciliation migration is later than the original
-- provider-review migration and redefines this function without the review
-- guard. Reassert the full business rule after reconciliation so a valid
-- subscription cannot bypass an unresolved refund/dispute review.
create or replace function public.worker_pro_is_active(p_worker_id text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
  select exists (
    select 1
    from public.worker_pro_subscriptions subscription
    where subscription.worker_id = p_worker_id
      and subscription.status in ('active','grace_period')
      and subscription.current_period_end > now()
  )
  and not exists (
    select 1
    from public.worker_pro_provider_reviews review
    where review.worker_id = p_worker_id
      and review.resolved_at is null
  );
$function$;

revoke all on function public.worker_pro_is_active(text)
  from public, anon, authenticated, service_role;
grant execute on function public.worker_pro_is_active(text)
  to service_role, authenticated;
