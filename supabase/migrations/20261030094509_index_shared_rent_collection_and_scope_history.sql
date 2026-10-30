begin;
create index rent_plans_shared_member_lookup on public.rent_plans(shared_payment_member_id) where shared_payment_member_id is not null;
create index rent_contributions_due_notices on public.rent_plan_contributions(due_date,id,rent_plan_id) where status in('scheduled','pending');
CREATE OR REPLACE FUNCTION public.get_my_later_rent_history(p_reservation_id text, p_after_sequence integer DEFAULT 0, p_limit integer DEFAULT 16, p_plan_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor text:=public.current_profile_user_id();r public.reservations;l public.listings;plan public.rent_plans;items jsonb;years jsonb;page_size integer:=least(greatest(coalesce(p_limit,16),1),32);is_customer boolean;collection_available boolean;q jsonb;
begin
 if actor is null or not public._property_document_session_active() or not exists(select 1 from public.profiles where user_id=actor and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)) then raise exception 'Trusted active account required' using errcode='42501';end if;
 select * into r from public.reservations where id=p_reservation_id;
 select * into l from public.listings where id::text=r.listing_id;
 is_customer:=r.user_id=actor or exists(select 1 from public.shared_payment_members member where member.shared_payment_group_id=r.shared_payment_group_id and member.user_id=actor and member.invitation_state='accepted' and member.payment_state='paid' and member.rent_agreement_snapshot->>'accepted_by'=actor);
 if r.id is null or not(coalesce(is_customer,false) or (actor=coalesce(l.partner_id,l.owner_id) and public.current_actor_has_workspace('property_partner',null))) then raise exception 'Rental history unavailable' using errcode='42501';end if;
 select * into plan from public.rent_plans where reservation_id=r.id and status<>'cancelled' and ((is_customer and user_id=actor and (p_plan_id is null or id=p_plan_id)) or (not is_customer and ((p_plan_id is not null and id=p_plan_id) or (p_plan_id is null and r.shared_payment_group_id is null and user_id=r.user_id)))) order by created_at desc limit 1;
 if plan.id is null then raise exception 'Choose the accepted tenant rent account';end if;q:=private.long_let_plan_agreement(plan.id);
 collection_available:=private.later_rent_collection_enabled() and private.long_let_settlement_account(l.id) is not null;
 with rows as (
  select c.id as contribution_id,c.agreement_sequence,c.target_year,c.due_date,c.amount,c.paystack_reference,
   coalesce(p.amount_commission,(q#>array['rent_schedule','payments',(c.agreement_sequence-1)::text]->>'wehouse_amount')::numeric) as amount_commission,
   coalesce(p.net_amount,(q#>array['rent_schedule','payments',(c.agreement_sequence-1)::text]->>'partner_net_amount')::numeric) as net_amount,p.paid_at,
   (c.status in('scheduled','pending') and c.due_date<(now() at time zone 'Africa/Lagos')::date and plan.status='active') as is_overdue,
   case when c.status in('paid','completed') and p.status in('paid','completed') and p.verified_at is not null
    and p.verified_amount=c.amount and exists(select 1 from public.verified_provider_events e where e.provider_reference=p.paystack_reference and e.processing_status='processed') then 'paid'
    when c.status in('paid','completed') or p.status in('failed','cancelled','refunded','partially_refunded','review_required') then 'review_required' else c.status end as payment_status,
   (collection_available and is_customer and r.status='occupied' and plan.status='active' and c.status in('scheduled','pending','payment_pending') and (p.id is null or p.status='pending') and coalesce(p.metadata->>'rent_automatic_debit','false')<>'true'
    and c.due_date<=(now() at time zone 'Africa/Lagos')::date and c.agreement_sequence=(select min(earlier.agreement_sequence) from public.rent_plan_contributions earlier where earlier.rent_plan_id=plan.id and earlier.status in('scheduled','pending','payment_pending'))) as can_pay,
   coalesce(p.metadata#>>'{rent_provider_settlement,status}','not_started') as settlement_status
  from public.rent_plan_contributions c left join public.booking_payments p on p.paystack_reference=c.paystack_reference and p.purpose='rent_plan_contribution'
   and p.metadata->>'contribution_id'=c.id::text where c.rent_plan_id=plan.id and c.agreement_sequence>greatest(coalesce(p_after_sequence,0),0)
  order by c.agreement_sequence limit page_size+1
 ) select coalesce(jsonb_agg(to_jsonb(rows) order by agreement_sequence),'[]') into items from rows;
 with sums as (
  select c.target_year,(q#>>'{rent_schedule,annual_rent}')::numeric annual,
   coalesce(sum(c.amount) filter(where c.status in('paid','completed') and p.status in('paid','completed') and p.verified_at is not null and p.verified_amount=c.amount
    and exists(select 1 from public.verified_provider_events e where e.provider_reference=p.paystack_reference and e.processing_status='processed')),0) paid
  from public.rent_plan_contributions c left join public.booking_payments p on p.paystack_reference=c.paystack_reference and p.purpose='rent_plan_contribution'
   and p.metadata->>'contribution_id'=c.id::text where c.rent_plan_id=plan.id group by c.target_year
 ), credit as(select *,least(12,greatest(0,floor(paid*12/nullif(annual,0))))::integer months from sums)
 select coalesce(jsonb_agg(jsonb_build_object('target_year',target_year,'annual_rent',annual,'gross_rent_paid',paid,'completed_months',months,
  'partial_month_credit',paid-ceil(annual*100*months/12)/100,
  'next_month_balance',case when months=12 then 0 else greatest(0,ceil(annual*100*(months+1)/12)/100-paid) end,
  'remaining_year_rent',greatest(0,annual-paid)) order by target_year),'[]') into years from credit;
 return jsonb_build_object('reservation_id',r.id,'plan_id',plan.id,'viewer',case when is_customer then 'customer' else 'partner' end,
  'currency',q->>'currency','agreement_digest',q->>'quote_digest','is_shared',r.shared_payment_group_id is not null,'payer_user_id',plan.user_id,'payer_name',(select full_name from public.profiles where user_id=plan.user_id),'plan_status',plan.status,'collection_available',collection_available,
  'settlement_consent',plan.settlement_consent,'years',years,'items',(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(items) with ordinality e(v,n) where n<=page_size),
  'has_more',jsonb_array_length(items)>page_size,'next_sequence',case when jsonb_array_length(items)>page_size then (items->(page_size-1)->>'agreement_sequence')::integer else null end);
end $function$;
commit;
