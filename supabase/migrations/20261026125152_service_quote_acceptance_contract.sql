begin;
set local lock_timeout='5s';
alter table public.worker_bookings
 add column service_quote jsonb,
 add column service_quote_revision integer not null default 0 check(service_quote_revision>=0),
 add column service_quote_accepted_revision integer,
 add column service_quote_accepted_at timestamptz,
 add constraint service_quote_acceptance_pair check(
  (service_quote_accepted_revision is null)=(service_quote_accepted_at is null)),
 add constraint service_quote_revision_pair check(
  (service_quote is null and service_quote_revision=0) or
  (jsonb_typeof(service_quote)='object' and service_quote_revision>0));

create function private.accepted_service_quote(p_booking_id uuid,p_require_future boolean default true)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.worker_bookings;q jsonb;
begin
 select * into b from public.worker_bookings where id=p_booking_id;q:=b.service_quote;
 if b.id is null or q is null or b.service_quote_accepted_at is null
  or b.service_quote_accepted_revision is distinct from b.service_quote_revision
  or (q->>'revision')::integer is distinct from b.service_quote_revision
  or q->>'booking_id' is distinct from b.id::text
  or q->>'customer_id' is distinct from b.user_id or q->>'provider_id' is distinct from b.worker_id
  or q->>'currency' is distinct from 'NGN'
  or (q->>'amount')::numeric is distinct from coalesce(b.negotiated_amount,b.agreed_amount)
  or q->'cancellation'->>'version' is distinct from 'service-standard-24h-v1'
  or (q->'cancellation'->>'full_refund_until')::timestamptz is distinct from
     (q->>'starts_at')::timestamptz-interval '24 hours'
  or q->'cancellation'->>'late_cancellation' is distinct from 'wehouse_review'
  or q->'cancellation'->>'provider_cancellation' is distinct from 'full_refund'
  or (q->>'customer_service_charge')::numeric is distinct from 0 then
  raise exception 'Review and accept the current Service quote and cancellation terms before payment';
 end if;
 if p_require_future and (q->>'starts_at')::timestamptz<=clock_timestamp() then
  raise exception 'The scheduled Service start has passed. Ask the provider for a new quote';
 end if;
 return q;
end $$;
revoke all on function private.accepted_service_quote(uuid,boolean) from public,anon,authenticated;

create function public.send_my_service_quote(p_booking_id uuid,p_amount numeric,p_starts_at timestamptz,p_timezone text,p_scope text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles;b public.worker_bookings;q jsonb;rev integer;
begin
 if not public._property_document_session_active() then raise exception 'Active trusted session required';end if;
 select * into actor from public.profiles where auth_id=(select auth.uid())::text
 and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false);
 if actor.user_id is null or not public.current_actor_has_workspace('worker',null)
  or actor.worker_status is distinct from 'verified' or actor.worker_verified is distinct from true
  or not public.worker_identity_is_current(actor.user_id) then raise exception 'Verified Service Provider access required';end if;
 if p_amount is null or p_amount::text in('NaN','Infinity','-Infinity') or p_amount<=0
  or p_amount<>round(p_amount,2) or p_amount*100>9007199254740991 then raise exception 'Enter a positive price with at most two decimal places';end if;
 if p_starts_at is null or not isfinite(p_starts_at) or p_starts_at<=clock_timestamp() then raise exception 'Choose a future Service start time';end if;
 if p_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'Choose a valid Service timezone';end if;
 if char_length(btrim(coalesce(p_scope,''))) not between 10 and 4000 then raise exception 'Describe the agreed work in 10 to 4000 characters';end if;
 select * into b from public.worker_bookings where id=p_booking_id for update;
 if b.id is null or b.worker_id is distinct from actor.user_id then raise exception 'Booking not found';end if;
 if b.status not in('booking_requested','negotiating','waiting_payment') or b.payment_protection_id is not null then raise exception 'This booking can no longer receive a new quote';end if;
 if nullif(btrim(b.address),'') is null then raise exception 'Confirm the Service location before sending a quote';end if;
 -- An uncertain send reuses the same quote even after the customer accepted it.
 if b.service_quote is not null and (b.service_quote->>'amount')::numeric=p_amount
  and (b.service_quote->>'starts_at')::timestamptz=p_starts_at and b.service_quote->>'timezone'=p_timezone
  and b.service_quote->>'scope'=btrim(p_scope) and b.service_quote->>'address'=b.address then return b.service_quote;end if;
 if exists(select 1 from public.booking_payments where worker_booking_id=b.id and status in('pending','processing','paid','completed','review_required')) then
  raise exception 'A payment is pending or confirmed. Resolve that payment before changing this quote';end if;
 rev:=b.service_quote_revision+1;
 q:=jsonb_build_object('revision',rev,'booking_id',b.id,'customer_id',b.user_id,'provider_id',b.worker_id,
  'amount',p_amount,'currency','NGN','customer_service_charge',0,'scope',btrim(p_scope),'address',b.address,
  'starts_at',p_starts_at,'timezone',p_timezone,'cancellation',jsonb_build_object('version','service-standard-24h-v1',
   'full_refund_until',p_starts_at-interval '24 hours','late_cancellation','wehouse_review','provider_cancellation','full_refund'));
 update public.worker_bookings set service_quote=q,service_quote_revision=rev,
  service_quote_accepted_revision=null,service_quote_accepted_at=null,status='waiting_payment',
  negotiated_amount=p_amount,agreed_amount=p_amount,scheduled_date=(p_starts_at at time zone p_timezone)::date,updated_at=now()
 where id=b.id;
 return q;
end $$;
revoke all on function public.send_my_service_quote(uuid,numeric,timestamptz,text,text) from public,anon;
grant execute on function public.send_my_service_quote(uuid,numeric,timestamptz,text,text) to authenticated;

create function public.accept_my_service_quote(p_booking_id uuid,p_revision integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare b public.worker_bookings;actor public.profiles;
begin
 if not public._property_document_session_active() then raise exception 'Active trusted session required';end if;
 select * into actor from public.profiles where auth_id=(select auth.uid())::text
 and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false);
 select * into b from public.worker_bookings where id=p_booking_id for update;
 if actor.user_id is null or b.id is null or b.user_id is distinct from actor.user_id then raise exception 'Booking not found';end if;
 if b.status<>'waiting_payment' or b.service_quote is null or p_revision is distinct from b.service_quote_revision then
  raise exception 'The quote changed. Review its current schedule, work and price before accepting';end if;
 if (b.service_quote->>'starts_at')::timestamptz<=clock_timestamp() then raise exception 'The scheduled start has passed. Ask for a new quote';end if;
 if not coalesce((public._worker_publication_state(b.worker_id)->>'eligible')::boolean,false) then raise exception 'This provider is not currently eligible for new bookings';end if;
 if exists(select 1 from public.worker_user_blocks where
  (blocker_user_id=b.user_id and blocked_user_id=b.worker_id) or (blocker_user_id=b.worker_id and blocked_user_id=b.user_id)) then raise exception 'This conversation is blocked';end if;
 if b.service_quote_accepted_revision is distinct from p_revision or b.service_quote_accepted_at is null then
  update public.worker_bookings set service_quote_accepted_revision=p_revision,service_quote_accepted_at=now(),updated_at=now()
  where id=b.id returning * into b;
 end if;
 return jsonb_build_object('accepted',true,'revision',p_revision,'accepted_at',b.service_quote_accepted_at);
end $$;
revoke all on function public.accept_my_service_quote(uuid,integer) from public,anon;
grant execute on function public.accept_my_service_quote(uuid,integer) to authenticated;

create function private.freeze_service_checkout_contract()
returns trigger language plpgsql security definer set search_path='' as $$
declare q jsonb;accepted_at timestamptz;
begin
 if tg_op='UPDATE' and old.metadata->'service_quote' is not null then
  if new.metadata->'service_quote' is distinct from old.metadata->'service_quote'
   or new.metadata->'service_quote_accepted_at' is distinct from old.metadata->'service_quote_accepted_at' then
   raise exception 'The accepted Service checkout contract cannot be rewritten';end if;
  return new;
 end if;
 if new.purpose<>'worker_booking' or new.status<>'pending' then return new;end if;
 -- Preserve pre-cutover historical fixtures/receipts. Only the authenticated
 -- constructor can prepare a new checkout, and it requires accepted terms.
 if not exists(select 1 from public.worker_bookings where id=new.worker_booking_id and service_quote is not null) then return new;end if;
 q:=private.accepted_service_quote(new.worker_booking_id,true);
 select service_quote_accepted_at into accepted_at from public.worker_bookings where id=new.worker_booking_id;
 new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('service_quote',q,'service_quote_accepted_at',accepted_at);
 return new;
end $$;
revoke all on function private.freeze_service_checkout_contract() from public,anon,authenticated;
create trigger bind_service_checkout_contract before insert or update on public.booking_payments
for each row execute function private.freeze_service_checkout_contract();

do $patch$
declare definition text;anchor text;
begin
 definition:=pg_get_functiondef('public.create_worker_booking_payment(uuid)'::regprocedure);
 anchor:=$a$  IF b.status<>'waiting_payment' THEN RETURN jsonb_build_object('success',false,'error','Booking is not waiting for payment'); END IF;$a$;
 if position(anchor in definition)=0 then raise exception 'Inspect Service constructor before upgrading';end if;
 execute replace(definition,anchor,anchor||E'\n  IF NOT public._property_document_session_active() THEN RAISE EXCEPTION ''Active trusted session required''; END IF;\n  PERFORM private.accepted_service_quote(p_booking_id,true);');
 definition:=pg_get_functiondef('public.get_my_worker_booking_details(uuid)'::regprocedure);
 anchor:=$a$    'id',v_booking.id,'booking_code',v_booking.booking_code,'status',v_booking.status,$a$;
 if position(anchor in definition)=0 then raise exception 'Inspect Service detail projection before upgrading';end if;
 execute replace(definition,anchor,anchor||E'\n    ''service_quote'',v_booking.service_quote,''service_quote_revision'',v_booking.service_quote_revision,\n    ''service_quote_accepted_revision'',v_booking.service_quote_accepted_revision,''service_quote_accepted_at'',v_booking.service_quote_accepted_at,');
 definition:=pg_get_functiondef('public.confirm_worker_booking_payment(uuid,text,numeric,text,text)'::regprocedure);
 anchor:=$a$  v_rate:=v_payment.commission_rate;$a$;
 if position(anchor in definition)=0 then raise exception 'Inspect Service confirmation before upgrading';end if;
 execute replace(definition,anchor,E'  IF v_booking.service_quote IS NOT NULL THEN\n    IF v_payment.metadata->''service_quote'' IS DISTINCT FROM private.accepted_service_quote(p_booking_id,false)\n      OR v_payment.metadata->>''service_quote_accepted_at'' IS DISTINCT FROM to_jsonb(v_booking.service_quote_accepted_at)#>>''{}'' THEN\n      RETURN jsonb_build_object(''success'',false,''error'',''Accepted Service contract does not match this payment; Finance review required'');\n    END IF;\n  END IF;\n'||anchor);
 -- New quotes use the approved 24-hour deadline. Legacy paid bookings retain
 -- their existing rule. Late cancellations require review; no deduction invented.
 definition:=pg_get_functiondef('public.cancel_my_worker_booking(uuid,text)'::regprocedure);
 anchor:=$a$      v_pct:=private.worker_refund_rule('before_start_refund_percent');$a$;
 if position(anchor in definition)=0 then raise exception 'Inspect Service cancellation before upgrading';end if;
 execute replace(definition,anchor,E'      IF v_booking.service_quote IS NOT NULL THEN\n        IF clock_timestamp()>(v_booking.service_quote->''cancellation''->>''full_refund_until'')::timestamptz THEN\n          RAISE EXCEPTION ''The free-cancellation deadline has passed. Ask WeHouse for a cancellation and refund review'';\n        END IF;\n        v_pct:=100;\n      ELSE\n'||anchor||E'\n      END IF;');
end $patch$;
commit;
