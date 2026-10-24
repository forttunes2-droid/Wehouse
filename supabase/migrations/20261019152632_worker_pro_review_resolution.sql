-- Revocation changes entitlement status while preserving the purchased period.
-- Truncating end to now() can equal start in one transaction and violates the
-- positive-period constraint; retaining the receipt also preserves audit facts.
create or replace function public.resolve_worker_pro_provider_review(
  p_payment_id uuid,p_restore boolean,p_reason text)
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_review public.worker_pro_provider_reviews;
begin
  if coalesce(nullif(auth.jwt()->>'role',''),current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'Service role required'; end if;
  if p_restore is null or length(btrim(coalesce(p_reason,'')))<12 then raise exception 'Finance reason required'; end if;
  select * into v_review from public.worker_pro_provider_reviews
    where payment_id=p_payment_id;
  if v_review.payment_id is null or v_review.resolved_at is not null then raise exception 'No open Worker Pro review'; end if;
  perform 1 from public.profiles where user_id=v_review.worker_id for update;
  select * into v_review from public.worker_pro_provider_reviews where payment_id=p_payment_id for update;
  if v_review.resolved_at is not null then raise exception 'No open Worker Pro review'; end if;
  if not p_restore then
    update public.worker_pro_subscriptions set status='revoked',
      auto_renews=false,updated_at=now()
      where worker_id=v_review.worker_id and provider='paystack';
  end if;
  update public.worker_pro_provider_reviews set resolved_at=now(),restored=p_restore,
    resolution_reason=btrim(p_reason) where payment_id=p_payment_id;
  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values('service_role','worker_pro_provider_review','worker_pro_subscription',v_review.worker_id,
    jsonb_build_object('payment_id',p_payment_id,'restored',p_restore,'reason',p_reason)::text,now());
  return true;
end $$;
revoke all on function public.resolve_worker_pro_provider_review(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.resolve_worker_pro_provider_review(uuid,boolean,text) to service_role;
