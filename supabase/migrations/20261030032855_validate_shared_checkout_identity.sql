-- The shared-member subject key is member:phase:attempt, not a member UUID.
-- Validate the immutable payment's real links in one indexed service command.
create function public.validate_shared_housing_checkout(p_payment_id uuid,p_customer_user_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare payment public.booking_payments;valid boolean:=false;group_id uuid;member_id uuid;canonical_group uuid;canonical_member uuid;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service authority required' using errcode='42501';end if;
 select * into payment from public.booking_payments where id=p_payment_id;
 if payment.id is null or payment.purpose<>'shared_housing_share' or payment.status<>'pending'
  or coalesce(payment.payer_user_id,payment.user_id) is distinct from p_customer_user_id
  or not public.user_has_active_workspace(p_customer_user_id,'personal') then return jsonb_build_object('valid',false);end if;
 begin
  group_id:=(payment.metadata->>'shared_group_id')::uuid;
  member_id:=(payment.metadata->>'legacy_shared_member_id')::uuid;
  canonical_group:=(payment.metadata->>'canonical_shared_payment_group_id')::uuid;
  canonical_member:=(payment.metadata->>'canonical_shared_payment_member_id')::uuid;
 exception when invalid_text_representation then return jsonb_build_object('valid',false);end;
 select exists(
  select 1 from public.shared_housing_groups g
  join public.shared_housing_members m on m.group_id=g.id and m.id=member_id
  join public.shared_payment_groups c on c.shared_payment_group_id=g.canonical_group_id and c.shared_payment_group_id=canonical_group
  join public.shared_payment_members cm on cm.shared_payment_group_id=c.shared_payment_group_id and cm.shared_payment_member_id=m.canonical_member_id and cm.shared_payment_member_id=canonical_member
  where g.id=group_id and g.status='payment_pending' and c.status='checkout_open'
   and g.product_type in('long_let','short_let') and c.product_type=g.product_type
   and m.user_id=p_customer_user_id and cm.user_id=m.user_id
   and m.invitation_status='accepted' and cm.invitation_state='accepted'
   and m.payment_status='pending' and cm.payment_state='provider_pending'
   and m.payment_reference=payment.paystack_reference and cm.provider_reference=payment.paystack_reference
   and m.share_amount=coalesce(payment.amount_total,payment.amount) and cm.share_amount=m.share_amount
   and payment.currency='NGN'
   and g.expires_at>now() and c.checkout_expires_at>now()
   and g.checkout_attempt=c.checkout_attempt and g.checkout_attempt::text=payment.metadata->>'checkout_attempt'
   and g.payment_phase=c.payment_phase and g.payment_phase=payment.metadata->>'payment_phase'
   and payment.metadata->>'shared_member_id'=m.id::text||':'||g.payment_phase||':'||g.checkout_attempt::text
   and g.member_limit between 2 and 3 and c.capacity=g.member_limit
   and not exists(select 1 from public.shared_housing_members other where other.group_id=g.id and other.invitation_status<>'accepted')
   and not exists(select 1 from public.shared_payment_members other where other.shared_payment_group_id=c.shared_payment_group_id and other.invitation_state<>'accepted')
   and (select count(*) from public.shared_housing_members other where other.group_id=g.id) between 2 and c.capacity
   and (select count(*) from public.shared_payment_members other where other.shared_payment_group_id=c.shared_payment_group_id)=(select count(*) from public.shared_housing_members other where other.group_id=g.id)
   and not exists(select 1 from public.shared_housing_members other left join public.shared_payment_members linked
    on linked.shared_payment_member_id=other.canonical_member_id and linked.shared_payment_group_id=c.shared_payment_group_id
    where other.group_id=g.id and (linked.shared_payment_member_id is null or linked.user_id<>other.user_id or linked.share_amount<>other.share_amount))
   and (select sum(other.share_amount) from public.shared_housing_members other where other.group_id=g.id)=c.total_amount
   and c.total_amount=g.total_amount
 ) into valid;
 return jsonb_build_object('valid',valid);
end $$;
revoke all on function public.validate_shared_housing_checkout(uuid,text) from public,anon,authenticated;
grant execute on function public.validate_shared_housing_checkout(uuid,text) to service_role;
