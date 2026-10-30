begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table public.booking_payments
 add column commission_policy_version_id uuid references public.creator_policy_versions(policy_version_id),
 add column commission_frozen_at timestamptz,
 add constraint booking_payment_commission_snapshot_pair check((commission_policy_version_id is null)=(commission_frozen_at is null));
create index booking_payments_commission_policy_fk_idx on public.booking_payments(commission_policy_version_id);

-- Reuse the payment record's existing rate/commission/net columns. No second ledger.
-- This preserves the existing Service percentage formula; it introduces no new fee.
create function private.freeze_worker_checkout_commission() returns trigger
language plpgsql security definer set search_path='' as $$
declare b public.worker_bookings;p public.creator_policy_versions;gross numeric;rate numeric;
begin
 if tg_op='UPDATE' and old.commission_frozen_at is not null then
   if (new.purpose,new.worker_booking_id,new.user_id,new.payer_user_id,new.payee_user_id,new.currency,new.amount,new.amount_total,
       new.commission_rate,new.amount_commission,new.net_amount,new.commission_policy_version_id,new.commission_frozen_at)
    is distinct from
      (old.purpose,old.worker_booking_id,old.user_id,old.payer_user_id,old.payee_user_id,old.currency,old.amount,old.amount_total,
       old.commission_rate,old.amount_commission,old.net_amount,old.commission_policy_version_id,old.commission_frozen_at) then
     raise exception 'Accepted checkout terms cannot be changed; create a new reviewed checkout';
   end if;
   return new;
 end if;
 if new.purpose<>'worker_booking' then return new;end if;
 if new.status<>'pending' then return new;end if;
 select * into b from public.worker_bookings where id=new.worker_booking_id;
 gross:=round(coalesce(new.amount_total,new.amount),2);
 if b.id is null or b.status<>'waiting_payment' or b.user_id is distinct from coalesce(new.payer_user_id,new.user_id)
  or new.user_id is distinct from b.user_id or (new.payee_user_id is not null and new.payee_user_id<>b.worker_id)
  or new.currency is distinct from 'NGN' or gross is null or gross::text in ('NaN','Infinity','-Infinity') or gross<=0
  or gross is distinct from round(coalesce(b.negotiated_amount,b.agreed_amount),2)
  or (new.amount is not null and round(new.amount,2) is distinct from gross) then
   raise exception 'Service checkout identity, price or state is invalid';
 end if;
 select * into p from public.creator_policy_versions where policy_key='commission_worker'
  and scope_type='global' and scope_key='*' and status='active'
  and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
 rate:=(p.value->>'percent')::numeric;
 if p.policy_version_id is null or rate is null or rate::text in ('NaN','Infinity','-Infinity') or rate not between 0 and 50 then
   raise exception 'An active Creator Service commission is required before checkout';
 end if;
 new.amount:=coalesce(new.amount,gross);
 new.payee_user_id:=b.worker_id;
 new.commission_policy_version_id:=p.policy_version_id;new.commission_frozen_at:=now();
 new.commission_rate:=rate;new.amount_commission:=round(gross*rate/100,2);new.net_amount:=gross-new.amount_commission;
 return new;
end $$;
revoke all on function private.freeze_worker_checkout_commission() from public,anon,authenticated;
create trigger freeze_worker_checkout_commission before insert or update on public.booking_payments
 for each row execute function private.freeze_worker_checkout_commission();

-- Existing unpaid, valid checkouts freeze at cutover; settled history is untouched.
update public.booking_payments p set commission_rate=p.commission_rate
from public.worker_bookings b
where p.purpose='worker_booking' and p.status='pending' and p.worker_booking_id=b.id and b.status='waiting_payment'
 and p.commission_frozen_at is null and p.user_id=b.user_id and coalesce(p.payer_user_id,p.user_id)=b.user_id
 and (p.payee_user_id is null or p.payee_user_id=b.worker_id)
 and p.currency='NGN' and round(coalesce(p.amount_total,p.amount),2)>0
 and (p.amount is null or round(p.amount,2)=round(coalesce(p.amount_total,p.amount),2))
 and round(coalesce(p.amount_total,p.amount),2)=round(coalesce(b.negotiated_amount,b.agreed_amount),2)
 and exists(select 1 from public.creator_policy_versions cp where cp.policy_key='commission_worker' and cp.scope_type='global'
  and cp.scope_key='*' and cp.status='active' and cp.effective_from<=now() and (cp.effective_until is null or cp.effective_until>now()));

do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.create_worker_booking_payment(uuid)'::regprocedure);
 needle:=$needle$      RETURN jsonb_build_object('success',true,'reference',existing.paystack_reference,'amount',amt,'existing',true);$needle$;
 if position(needle in definition)=0 then raise exception 'Inspect Service checkout reuse before upgrading';end if;
 execute replace(definition,needle,E'      UPDATE public.booking_payments SET commission_rate=commission_rate WHERE id=existing.id RETURNING * INTO existing;\n'||needle);

 definition:=pg_get_functiondef('public.confirm_worker_booking_payment(uuid,text,numeric,text,text)'::regprocedure);
 needle:=$needle$  select nullif(btrim(setting.value),'')::numeric into v_rate
  from public.platform_settings setting
  where setting.key='worker_commission_rate' and setting.is_active=true;
  if v_rate is null or v_rate<0 or v_rate>50 then
    return jsonb_build_object('success',false,'error','Invalid commission rate');
  end if;
  v_commission:=round((p_amount_verified*v_rate/100)::numeric,2);
  v_receives:=round(p_amount_verified,2)-v_commission;$needle$;
 replacement:=$replacement$  v_rate:=v_payment.commission_rate;
  if v_payment.commission_frozen_at is null or v_payment.commission_policy_version_id is null
    or v_rate is null or v_rate not between 0 and 50
    or v_payment.amount_commission is distinct from round(p_amount_verified*v_rate/100,2)
    or v_payment.net_amount is distinct from round(p_amount_verified,2)-v_payment.amount_commission then
    return jsonb_build_object('success',false,'error','Checkout commission snapshot needs Finance review');
  end if;
  v_commission:=v_payment.amount_commission;
  v_receives:=v_payment.net_amount;$replacement$;
 if position(needle in definition)=0 then raise exception 'Inspect Service confirmation commission before upgrading';end if;
 execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.process_verified_paystack_charge(text,text,text,text,timestamptz,bigint,text,text)'::regprocedure);
 needle:=$needle$  if v_payment.purpose='worker_booking' then
    select (p.value->>'percent')::numeric,p.policy_version_id
    into v_rate,v_policy_id from public.creator_policy_versions p
    where p.policy_key='commission_worker' and p.scope_type='global'
      and p.scope_key='*' and p.status='active'
      and p.effective_from<=now()
      and (p.effective_until is null or p.effective_until>now())
    order by p.effective_from desc limit 1;
    if v_rate is null or v_rate<0 or v_rate>50 then
      raise exception 'Active Creator Worker commission is required';
    end if;
    update public.platform_settings
    set value=v_rate::text,editable=false,is_active=true,updated_at=now()
    where key='worker_commission_rate';
  end if;
$needle$;
 replacement:=$replacement$  if v_payment.purpose='worker_booking' then
    v_rate:=v_payment.commission_rate;v_policy_id:=v_payment.commission_policy_version_id;
    if v_payment.commission_frozen_at is null or v_policy_id is null or v_rate is null or v_rate not between 0 and 50
      or v_payment.amount_commission is distinct from round(v_amount*v_rate/100,2)
      or v_payment.net_amount is distinct from v_amount-v_payment.amount_commission then
      raise exception 'Service checkout commission snapshot is missing or invalid';
    end if;
  end if;$replacement$;
 if position(needle in definition)=0 then raise exception 'Inspect verified Service dispatch commission before upgrading';end if;
 execute replace(definition,needle,replacement);
end $patch$;
commit;
