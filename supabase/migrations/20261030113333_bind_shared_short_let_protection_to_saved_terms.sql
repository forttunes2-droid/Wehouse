begin;
-- Bind each shared Short Let receipt to the existing reservation and its saved
-- price/management policy. No extra booking, wallet or parent protection record.
create function private.shared_short_let_allocation(p_payment_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.booking_payments;m public.shared_housing_members;g public.shared_housing_groups;
 r public.reservations;l public.listings;policy record;stay numeric;caution numeric;total_stay numeric;
 partner_base numeric;partner_net numeric;prior_stay numeric;through_stay numeric;net numeric;fee numeric;members integer;
begin
 select * into p from public.booking_payments where id=p_payment_id;
 select * into m from public.shared_housing_members where id::text=p.metadata->>'legacy_shared_member_id';
 select * into g from public.shared_housing_groups where id=m.group_id;
 select * into r from public.reservations where id=g.reservation_id;
 select * into l from public.listings where id=g.listing_id;
 stay:=m.eligible_partner_share;caution:=m.refundable_share;
 if p.id is null or p.purpose is distinct from 'shared_housing_share' or g.product_type is distinct from 'short_let'
  or p.metadata->>'canonical_product_type' is distinct from 'short_let' or p.metadata->>'payment_phase' is distinct from 'short_stay'
  or p.metadata->>'shared_group_id' is distinct from g.id::text or p.metadata->>'reservation_id' is distinct from r.id
  or p.metadata->>'canonical_shared_payment_group_id' is distinct from g.canonical_group_id::text
  or p.metadata->>'canonical_shared_payment_member_id' is distinct from m.canonical_member_id::text
  or p.metadata->>'checkout_attempt' is distinct from g.checkout_attempt::text
  or p.metadata->>'shared_member_id' is distinct from m.id::text||':short_stay:'||g.checkout_attempt
  or p.paystack_reference is distinct from m.payment_reference or m.invitation_status is distinct from 'accepted'
  or coalesce(p.payer_user_id,p.user_id) is distinct from m.user_id or p.user_id is distinct from m.user_id
  or r.id is null or r.stay_type is distinct from 'short_let' or r.commission_policy_version_id is null
  or l.id is null or l.id::text is distinct from r.listing_id or coalesce(l.partner_id,l.owner_id) is null
  or stay is null or stay<=0 or caution is null or caution<0 or stay+caution is distinct from p.amount_total
  or (p.metadata->>'eligible_partner_amount')::numeric is distinct from stay
  or (p.metadata->>'refundable_amount')::numeric is distinct from caution
  or not exists(select 1 from public.shared_payment_groups cg join public.shared_payment_members cm using(shared_payment_group_id)
    where cg.shared_payment_group_id=g.canonical_group_id and cg.reservation_id=r.id and cg.product_type='short_let'
      and cm.shared_payment_member_id=m.canonical_member_id and cm.user_id=m.user_id and cm.invitation_state='accepted')
 then raise exception 'Shared Short Let checkout does not match its accepted booking and payer';end if;
 select count(*),sum(eligible_partner_share),
  coalesce(sum(eligible_partner_share) filter(where id<m.id),0),
  sum(eligible_partner_share) filter(where id<=m.id)
 into members,total_stay,prior_stay,through_stay from public.shared_housing_members where group_id=g.id;
 if members not between 2 and 3 or total_stay is distinct from r.stay_rent_total
  or exists(select 1 from public.shared_housing_members where group_id=g.id and invitation_status<>'accepted')
 then raise exception 'Shared stay allocations no longer match the booking total';end if;
 select * into policy from private.resolve_apartment_commission_policy('short_let',coalesce(r.management_mode_snapshot,l.management_mode,'wehouse'),r.commission_policy_version_id);
 if policy.policy_version_id is distinct from r.commission_policy_version_id or policy.percent is null or policy.percent not between 0 and 50
 then raise exception 'Saved Short Let management commission is missing';end if;
 partner_base:=coalesce(r.short_stay_partner_rent_snapshot,total_stay);
 partner_net:=partner_base-round(partner_base*policy.percent/100,2);
 if partner_net<0 or partner_net>total_stay then raise exception 'Short Let discount exceeds the saved platform fee';end if;
 -- Cumulative minor-unit apportionment conserves the complete accepted Partner
 -- net across two or three unequal shares, including a final rounding remainder.
 net:=round(partner_net*through_stay/total_stay,2)-round(partner_net*prior_stay/total_stay,2);
 fee:=stay-net;
 return jsonb_build_object('version',1,'reservation_id',r.id,'member_id',m.canonical_member_id,
  'group_id',g.canonical_group_id,'checkout_attempt',g.checkout_attempt,'payer_user_id',m.user_id,
  'payee_user_id',coalesce(l.partner_id,l.owner_id),'stay_amount',stay,'caution_amount',caution,
  'stay_partner_net',net,'wehouse_amount',fee,'commission_rate',policy.percent,
  'commission_policy_version_id',policy.policy_version_id,'management_mode',r.management_mode_snapshot);
end $$;
revoke all on function private.shared_short_let_allocation(uuid) from public,anon,authenticated;

create function private.capture_shared_short_let_checkout(p_payment_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.booking_payments;q jsonb;
begin
 select * into p from public.booking_payments where id=p_payment_id for update;
 q:=private.shared_short_let_allocation(p.id);
 if p.status is distinct from 'pending' then raise exception 'Only an unpaid shared stay can be prepared';end if;
 if p.metadata->'short_let_allocation' is not null then
  if p.metadata->'short_let_allocation' is distinct from q then raise exception 'The saved shared stay price changed; review is required';end if;
  return;
 end if;
 if p.metadata->>'paystack_authorization_url' is not null then raise exception 'An earlier shared checkout needs reconciliation';end if;
 update public.booking_payments set payee_user_id=q->>'payee_user_id',
  amount_commission=(q->>'wehouse_amount')::numeric,net_amount=amount_total-(q->>'wehouse_amount')::numeric,
  commission_rate=(q->>'commission_rate')::numeric,commission_policy_version_id=(q->>'commission_policy_version_id')::uuid,
  commission_frozen_at=now(),metadata=metadata||jsonb_build_object('short_let_allocation',q),updated_at=now() where id=p.id;
end $$;
revoke all on function private.capture_shared_short_let_checkout(uuid) from public,anon,authenticated;

do $patch$
declare definition text:=pg_get_functiondef('public.create_my_shared_housing_payment(uuid)'::regprocedure);
 needle text:=$needle$  perform private.capture_shared_rent_checkout(payment_id);
 end if;$needle$;
begin
 if position(needle in definition)=0 then raise exception 'Inspect shared checkout snapshot integration';end if;
 execute replace(definition,needle,$replacement$  perform private.capture_shared_rent_checkout(payment_id);
 elsif g.product_type='short_let' and result->>'reference' is not null then
  select id into payment_id from public.booking_payments where paystack_reference=result->>'reference';
  perform private.capture_shared_short_let_checkout(payment_id);
 end if;$replacement$);
end $patch$;

do $patch$
declare definition text:=pg_get_functiondef('public.process_verified_paystack_charge(text,text,text,text,timestamp with time zone,bigint,text,text)'::regprocedure);
 needle text:=$needle$      if v_listing.sub_type='short_let' then
        select (p.value->>'percent')::numeric,p.policy_version_id
        into v_rate,v_policy_id from public.creator_policy_versions p
        where p.policy_key='commission_short_let' and p.scope_type='global'
          and p.scope_key='*' and p.status='active'
          and p.effective_from<=now()
          and (p.effective_until is null or p.effective_until>now())
        order by p.effective_from desc limit 1;
        if v_rate is null or v_rate<0 or v_rate>50 then
          raise exception 'Active Creator Short Let commission is required';
        end if;
      else$needle$;
begin
 if position(needle in definition)=0 then raise exception 'Inspect shared verified-charge commission integration';end if;
 execute replace(definition,needle,$replacement$      if v_listing.sub_type='short_let' then
        v_rate:=v_payment.commission_rate;v_policy_id:=v_payment.commission_policy_version_id;
        if v_rate is null or v_rate not between 0 and 50 or v_policy_id is null
          or v_payment.commission_frozen_at is null or v_payment.metadata->'short_let_allocation' is null then
          raise exception 'Saved shared Short Let commission is required';
        end if;
      else$replacement$);
end $patch$;

do $patch$
declare definition text:=pg_get_functiondef('public.split_shared_short_let_protection()'::regprocedure);
 needle text;replacement text;
begin
 needle:=$needle$  select (p.value->>'percent')::numeric into v_rate
  from public.creator_policy_versions p
  where p.policy_key='commission_short_let' and p.scope_type='global'
    and p.scope_key='*' and p.status='active' and p.effective_from<=now()
    and (p.effective_until is null or p.effective_until>now())
  order by p.effective_from desc limit 1;
  if v_rate is null or v_rate<0 or v_rate>50 then
    raise exception 'Active Creator Short Let commission is required'; end if;$needle$;
 replacement:=$replacement$  if v_payment.metadata->'short_let_allocation' is distinct from private.shared_short_let_allocation(v_payment.id)
    or v_payment.commission_frozen_at is null or v_payment.payee_user_id is distinct from new.payee_user_id
    or v_payment.payer_user_id is distinct from new.payer_user_id or v_payment.verified_amount is distinct from new.amount_total
    or v_payment.net_amount+v_payment.amount_commission is distinct from new.amount_total then
    raise exception 'Verified shared Short Let allocation is missing or changed';end if;
  v_rate:=v_payment.commission_rate;$replacement$;
 if position(needle in definition)=0 then raise exception 'Inspect shared protection snapshot integration';end if;
 execute replace(definition,needle,replacement);
end $patch$;

do $patch$
declare definition text:=pg_get_functiondef('public.enforce_management_commission_on_protection()'::regprocedure);
 needle text:=$needle$  if new.subject_type='shared_housing_share' then$needle$;
begin
 if position(needle in definition)=0 then raise exception 'Inspect shared protection component identity integration';end if;
 definition:=replace(definition,$needle$  v_group public.shared_housing_groups;$needle$,$replacement$  v_group public.shared_housing_groups;
  v_payment public.booking_payments;
  v_allocation jsonb;$replacement$);
 definition:=replace(definition,needle,$replacement$  if new.subject_type='short_let_stay' and new.subject_id like 'shared:%' then
    select * into v_payment from public.booking_payments where paystack_reference=new.paystack_reference and purpose='shared_housing_share';
    v_allocation:=v_payment.metadata->'short_let_allocation';
    if v_allocation is null or v_allocation is distinct from private.shared_short_let_allocation(v_payment.id)
      or new.subject_id is distinct from 'shared:'||(v_allocation->>'member_id')||':stay:'||(v_allocation->>'checkout_attempt')
      or new.payer_user_id is distinct from v_allocation->>'payer_user_id'
      or new.payee_user_id is distinct from v_allocation->>'payee_user_id'
      or new.amount_total is distinct from (v_allocation->>'stay_amount')::numeric then
      raise exception 'Shared Short Let protection does not match the verified payer and stay';end if;
    new.commission_rate:=(v_allocation->>'commission_rate')::numeric;
    new.amount_commission:=(v_allocation->>'wehouse_amount')::numeric;
    new.amount_payee:=(v_allocation->>'stay_partner_net')::numeric;
    return new;
  end if;
  if new.subject_type='shared_housing_share' then$replacement$);
 execute definition;
end $patch$;

do $patch$
declare definition text:=pg_get_functiondef('private.guard_shared_rent_payment_snapshot()'::regprocedure);
 needle text:=$needle$ return new;$needle$;
begin
 if position(needle in definition)=0 then raise exception 'Inspect shared payment snapshot immutability integration';end if;
 execute replace(definition,needle,$replacement$ if old.metadata->'short_let_allocation' is not null then
  foreach key in array array['shared_group_id','shared_member_id','legacy_shared_member_id','canonical_shared_payment_group_id',
   'canonical_shared_payment_member_id','canonical_product_type','payment_phase','checkout_attempt','eligible_partner_amount','refundable_amount','reservation_id','short_let_allocation'] loop
   if new.metadata->key is distinct from old.metadata->key then raise exception 'Shared stay payment identity and allocation are immutable';end if;
  end loop;
  if new.amount_total is distinct from old.amount_total or new.payer_user_id is distinct from old.payer_user_id
    or new.payee_user_id is distinct from old.payee_user_id or new.amount_commission is distinct from old.amount_commission
    or new.net_amount is distinct from old.net_amount or new.commission_rate is distinct from old.commission_rate
    or new.commission_policy_version_id is distinct from old.commission_policy_version_id
    or new.commission_frozen_at is distinct from old.commission_frozen_at then
    raise exception 'Shared stay accepted payment amounts are immutable';end if;
 end if;
 return new;$replacement$);
end $patch$;
commit;
