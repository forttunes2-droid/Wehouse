begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- One checkout snapshot on the existing payment record. A WeHouse-funded offer
-- spends the platform's commission; it must not reduce the Hotel's agreed net.
create function private.hotel_checkout_fee_snapshot(p_booking_id integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.hotel_bookings; d public.hotel_booking_discounts;
 p public.creator_policy_versions; payee text; gross numeric; basis numeric;
 rate numeric; net numeric; fee numeric;
begin
 select * into b from public.hotel_bookings where booking_id=p_booking_id for share;
 select owner_id into payee from public.hotels where hotel_id=b.hotel_id;
 if b.booking_id is null or payee is null then raise exception 'Hotel checkout has no booking or Partner';end if;
 select * into p from public.creator_policy_versions where policy_key='commission_hotel'
  and scope_type='global' and scope_key='*' and status='active'
  and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
 rate:=(p.value->>'percent')::numeric;gross:=round(b.total_price,2);
 if p.policy_version_id is null or rate is null or rate::text in('NaN','Infinity','-Infinity')
  or rate not between 0 and 50 or gross is null or gross<=0 then
  raise exception 'An active Creator Hotel commission is required before checkout';end if;
 select * into d from public.hotel_booking_discounts where booking_id=b.booking_id;
 basis:=case when d.booking_id is null then gross else d.partner_total end;
 if basis is null or basis::text in('NaN','Infinity','-Infinity') or basis<gross then
  raise exception 'Hotel offer needs pricing review before checkout';end if;
 net:=round(basis*(1-rate/100),2);fee:=gross-net;
 if net<0 or fee<0 or fee>gross then
  raise exception 'The saved WeHouse offer exceeds the available Hotel commission. Review the room price before paying';end if;
 return jsonb_build_object('version',1,'booking_id',b.booking_id,'hotel_id',b.hotel_id,
  'payer_user_id',b.user_id,'payee_user_id',payee,'currency','NGN',
  'gross_amount',gross,'partner_basis',basis,'wehouse_discount_amount',basis-gross,
  'commission_policy_version_id',p.policy_version_id,'commission_percent',rate,
  'commission_amount',fee,'partner_net_amount',net);
end $$;
revoke all on function private.hotel_checkout_fee_snapshot(integer) from public,anon,authenticated;

create function private.freeze_hotel_checkout_commission() returns trigger
language plpgsql security definer set search_path='' as $$
declare b public.hotel_bookings; q jsonb; gross numeric;
begin
 if tg_op='UPDATE' and old.purpose='hotel_booking' and old.commission_frozen_at is not null then
  if new.hotel_booking_id is distinct from old.hotel_booking_id
   or new.metadata->'hotel_fee_snapshot' is distinct from old.metadata->'hotel_fee_snapshot' then
   raise exception 'Accepted Hotel checkout identity and earnings cannot be changed';end if;
  -- The common frozen-checkout trigger also protects payer, payee and money fields.
  return new;
 end if;
 if new.purpose<>'hotel_booking' or new.status<>'pending' then return new;end if;
 select * into b from public.hotel_bookings where booking_id=new.hotel_booking_id for share;
 gross:=round(coalesce(new.amount_total,new.amount),2);
 if b.booking_id is null or b.status<>'pending' or b.payment_expires_at is null or b.payment_expires_at<=now()
  or new.user_id is distinct from b.user_id or coalesce(new.payer_user_id,new.user_id) is distinct from b.user_id
  or new.currency is distinct from 'NGN' or gross is null or gross::text in('NaN','Infinity','-Infinity')
  or gross is distinct from round(b.total_price,2)
  or (new.amount is not null and round(new.amount,2) is distinct from gross) then
  raise exception 'Hotel checkout identity, price or state is invalid';end if;
 q:=private.hotel_checkout_fee_snapshot(b.booking_id);
 if new.payee_user_id is not null and new.payee_user_id is distinct from q->>'payee_user_id' then
  raise exception 'Hotel checkout Partner does not match';end if;
 new.payee_user_id:=q->>'payee_user_id';new.amount:=coalesce(new.amount,gross);
 new.commission_policy_version_id:=(q->>'commission_policy_version_id')::uuid;
 new.commission_frozen_at:=now();new.commission_rate:=(q->>'commission_percent')::numeric;
 new.amount_commission:=(q->>'commission_amount')::numeric;new.net_amount:=(q->>'partner_net_amount')::numeric;
 new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('hotel_fee_snapshot',q);
 return new;
end $$;
revoke all on function private.freeze_hotel_checkout_commission() from public,anon,authenticated;
create trigger freeze_hotel_checkout_commission before insert or update on public.booking_payments
 for each row execute function private.freeze_hotel_checkout_commission();

-- Reused unpaid references acquire a snapshot before they can reach the provider.
-- Settled payments and their historic terms are never rewritten by this migration.
do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.create_hotel_booking_payment(integer)'::regprocedure);
 needle:=$needle$  if v_pending.id is not null then
    update public.hotel_bookings$needle$;
 replacement:=$replacement$  if v_pending.id is not null then
    update public.booking_payments set commission_rate=commission_rate where id=v_pending.id returning * into v_pending;
    update public.hotel_bookings$replacement$;
 if position(needle in definition)=0 then raise exception 'Inspect Hotel checkout reuse before upgrading';end if;
 execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.process_verified_paystack_charge(text,text,text,text,timestamptz,bigint,text,text)'::regprocedure);
 needle:=$needle$      select (p.value->>'percent')::numeric,p.policy_version_id
      into v_rate,v_policy_id from public.creator_policy_versions p
      where p.policy_key='commission_hotel' and p.scope_type='global'
        and p.scope_key='*' and p.status='active'
        and p.effective_from<=now()
        and (p.effective_until is null or p.effective_until>now())
      order by p.effective_from desc limit 1;
      if v_rate is null or v_rate<0 or v_rate>50 then
        raise exception 'Active Creator Hotel commission is required';
      end if;$needle$;
 replacement:=$replacement$      v_rate:=v_payment.commission_rate;v_policy_id:=v_payment.commission_policy_version_id;
      if v_payment.commission_frozen_at is null or v_policy_id is null or v_rate is null
        or v_rate::text in('NaN','Infinity','-Infinity') or v_rate not between 0 and 50
        or v_payment.payee_user_id is distinct from v_payee
        or v_payment.net_amount is null or v_payment.amount_commission is null
        or v_payment.amount_commission<0 or v_payment.net_amount<0
        or v_payment.net_amount+v_payment.amount_commission is distinct from v_amount
        or v_payment.metadata->'hotel_fee_snapshot' is null
        or (v_payment.metadata#>>'{hotel_fee_snapshot,booking_id}')::integer is distinct from v_hotel_booking.booking_id
        or (v_payment.metadata#>>'{hotel_fee_snapshot,gross_amount}')::numeric is distinct from v_amount
        or (v_payment.metadata#>>'{hotel_fee_snapshot,commission_amount}')::numeric is distinct from v_payment.amount_commission
        or (v_payment.metadata#>>'{hotel_fee_snapshot,partner_net_amount}')::numeric is distinct from v_payment.net_amount then
        raise exception 'Saved Hotel checkout earnings are missing or need Finance review';
      end if;$replacement$;
 if position(needle in definition)=0 then raise exception 'Inspect Hotel provider fee selection before upgrading';end if;
 definition:=replace(definition,needle,replacement);
 needle:=$needle$        null,'hotel_stay',v_payer,v_payee,v_amount,
        round(v_amount*v_rate/100,2),v_amount-round(v_amount*v_rate/100,2),$needle$;
 replacement:=$replacement$        null,'hotel_stay',v_payer,v_payee,v_amount,
        v_payment.amount_commission,v_payment.net_amount,$replacement$;
 if position(needle in definition)=0 then raise exception 'Inspect Hotel protection allocation before upgrading';end if;
 execute replace(definition,needle,replacement);

 -- Partial releases use the saved effective fee, including funded discounts.
 definition:=pg_get_functiondef('public.complete_internal_release_action(uuid)'::regprocedure);
 needle:=$needle$case when v_protection.subject_type in('experience_booking','long_let_payment') then$needle$;
 if position(needle in definition)=0 then raise exception 'Inspect Hotel release allocation before upgrading';end if;
 execute replace(definition,needle,$replacement$case when v_protection.subject_type in('experience_booking','long_let_payment','hotel_stay') then$replacement$);
end $patch$;

create or replace function public.apply_hotel_partner_payout() returns trigger
language plpgsql security definer set search_path='' as $$
declare d public.hotel_booking_discounts;p public.booking_payments;fee numeric;
begin
 if new.subject_type is distinct from 'hotel_stay' then return new;end if;
 select * into p from public.booking_payments where purpose='hotel_booking'
  and hotel_booking_id::text=new.subject_id and paystack_reference=new.paystack_reference;
 if p.id is not null and p.commission_frozen_at is not null then
  if p.metadata->'hotel_fee_snapshot' is null or p.payee_user_id is distinct from new.payee_user_id
   or coalesce(p.payer_user_id,p.user_id) is distinct from new.payer_user_id
   or p.amount_total is distinct from new.amount_total or p.commission_rate is distinct from new.commission_rate
   or p.amount_commission+p.net_amount is distinct from new.amount_total then
   raise exception 'Hotel protection must match the accepted checkout';end if;
  new.amount_commission:=p.amount_commission;new.amount_payee:=p.net_amount;return new;
 end if;
 -- Existing settled history keeps its original discount treatment.
 select * into d from public.hotel_booking_discounts where booking_id::text=new.subject_id;
 if d.booking_id is null or d.partner_total<=new.amount_total then return new;end if;
 fee:=greatest(0,new.amount_total-round(d.partner_total*(1-new.commission_rate/100),2));
 new.amount_commission:=fee;new.amount_payee:=new.amount_total-fee;return new;
end $$;
revoke all on function public.apply_hotel_partner_payout() from public,anon,authenticated;
commit;
