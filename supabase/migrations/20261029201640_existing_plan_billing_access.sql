-- Billing is an account responsibility, not a grant to use restricted paid tools.
-- Project existing records; no second entitlement or subscription ledger.
create function public.get_my_paid_plan_billing() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();plans jsonb:='[]'::jsonb;work public.worker_pro_subscriptions;property public.partner_pro_entitlements;
begin
 if actor is null or not public._property_document_session_active() or not exists(select 1 from public.profiles p
  where p.user_id=actor and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)) then
  raise exception 'A trusted active account is required to view billing' using errcode='42501';end if;
 select * into work from public.worker_pro_subscriptions where worker_id=actor;
 if work.id is not null then
  plans:=plans||jsonb_build_array(jsonb_build_object('kind','worker','name',coalesce((select nullif(btrim(value),'') from public.platform_settings where key='worker_pro_product_name' and is_active limit 1),'WeHouse Pro · Work tools'),
   'status',work.status,'provider',work.provider,'period_end',work.current_period_end,'billing_period',work.billing_period,
   'price',work.price_amount,'currency',work.currency,'auto_renews',work.auto_renews,'cancel_at_period_end',work.cancel_at_period_end,
   'last_verified_at',work.last_verified_at,'can_manage',work.provider in('apple','google') or work.provider='paystack' and nullif(work.provider_subscription_id,'') is not null,
   'workspace_access',public.user_has_active_workspace(actor,'worker')));
 end if;
 select * into property from public.partner_pro_entitlements where partner_id=actor;
 if property.partner_id is not null then
  plans:=plans||jsonb_build_array(jsonb_build_object('kind','property_partner','name','WeHouse Pro · Property tools',
   'status',case when property.review_started_at is not null then 'under_review' when property.current_period_end>now() then 'active' else 'expired' end,
   'provider','prepaid','period_end',property.current_period_end,'billing_period',null,'price',null,'currency',null,
   'auto_renews',false,'cancel_at_period_end',false,'last_verified_at',null,'can_manage',false,
   'workspace_access',public.user_has_active_workspace(actor,'property_partner')));
 end if;
 return jsonb_build_object('user_id',actor,'plans',plans);
end $$;
revoke all on function public.get_my_paid_plan_billing() from public,anon;
grant execute on function public.get_my_paid_plan_billing() to authenticated;
insert into public.case_reason_registry(reason_code,label,owning_domain,allowed_subject_types,requires_evidence,customer_description)
values('paid_plan_billing','Paid plan billing','finance_operations',array['account'],false,'Ask WeHouse to review an existing paid plan, renewal or billing record.');
