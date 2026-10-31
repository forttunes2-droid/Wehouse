begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table public.shared_payment_members add column checkout_accepted_at timestamptz;
create function private.record_shared_hotel_consent() returns trigger
language plpgsql security definer set search_path='' as $$
declare hotel boolean;
begin
 select product_type='hotel' into hotel from public.shared_payment_groups where shared_payment_group_id=new.shared_payment_group_id;
 if hotel is distinct from true then return new;end if;
 if tg_op='UPDATE' and old.checkout_accepted_at is not null then
  if (new.shared_payment_group_id,new.user_id,new.share_amount,new.eligible_partner_share,new.legacy_member_id,new.checkout_accepted_at)
   is distinct from (old.shared_payment_group_id,old.user_id,old.share_amount,old.eligible_partner_share,old.legacy_member_id,old.checkout_accepted_at) then
   raise exception 'Accepted Hotel payer identity, amount and consent cannot be changed';end if;
 end if;
 if new.invitation_state='accepted' then new.checkout_accepted_at:=coalesce(new.checkout_accepted_at,now());end if;
 return new;
end $$;
revoke all on function private.record_shared_hotel_consent() from public,anon,authenticated;
create trigger record_shared_hotel_consent before insert or update on public.shared_payment_members for each row execute function private.record_shared_hotel_consent();

-- No historic Hotel share exists in Production. Any transitional Test checkout
-- without recorded consent is reviewed again rather than retrospectively signed.
do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('private.shared_hotel_payment_snapshot(uuid,text)'::regprocedure);
 needle:=$n$  'accepted_terms',q);$n$;
 replacement:=$r$  'accepted_at',(select checkout_accepted_at from public.shared_payment_members where shared_payment_member_id=m.canonical_member_id),
  'accepted_terms',q);$r$;
 if position(needle in definition)=0 then raise exception 'Inspect Hotel payer consent snapshot';end if;execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('private.create_shared_hotel_payment(uuid)'::regprocedure);
 needle:=$n$ q:=private.shared_hotel_payment_snapshot(g.id,actor);$n$;
 replacement:=$r$ q:=private.shared_hotel_payment_snapshot(g.id,actor);
 if q->>'accepted_at' is null then raise exception 'Your Hotel terms need recorded acceptance before checkout';end if;$r$;
 if position(needle in definition)=0 then raise exception 'Inspect Hotel consent checkout boundary';end if;execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('private.shared_hotel_payment_valid(public.booking_payments,text,boolean)'::regprocedure);
 needle:=$n$ if p_payment.metadata->'hotel_share_snapshot' is distinct from q$n$;
 if position(needle in definition)=0 then raise exception 'Inspect Hotel consent verification boundary';end if;
 execute replace(definition,needle,$r$ if q->>'accepted_at' is null or p_payment.metadata->'hotel_share_snapshot' is distinct from q$r$);

 definition:=pg_get_functiondef('public.get_my_payment_receipts(text,text,text)'::regprocedure);
 needle:=$n$'payer_name',coalesce(nullif(hb.guest_name,''),nullif(p.full_name,''),p.username,'WeHouse customer'),$n$;
 replacement:=$r$'payer_name',case when bp.purpose='shared_housing_share' then coalesce(nullif(p.full_name,''),p.username,'WeHouse customer')
          else coalesce(nullif(hb.guest_name,''),nullif(p.full_name,''),p.username,'WeHouse customer') end,$r$;
 if position(needle in definition)=0 then raise exception 'Inspect Hotel share payer receipt';end if;
 definition:=replace(definition,needle,replacement);
 needle:=$n$when bp.purpose='shared_housing_share' then 'Shared home contribution'$n$;
 if position(needle in definition)=0 then raise exception 'Inspect shared Hotel receipt description';end if;
 definition:=replace(definition,needle,$r$when bp.purpose='shared_housing_share' and bp.metadata->>'canonical_product_type'='hotel' then 'Your Hotel booking share'
          when bp.purpose='shared_housing_share' then 'Shared home contribution'$r$);
 needle:=$n$else hb.cancellation_snapshot end,$n$;
 if position(needle in definition)=0 then raise exception 'Inspect shared Hotel receipt refund amount';end if;
 definition:=replace(definition,needle,$r$when bp.purpose='shared_housing_share' and bp.metadata->>'canonical_product_type'='hotel' then
          jsonb_set(hb.cancellation_snapshot,'{refund_amount_ngn}',to_jsonb(bp.verified_amount)) else hb.cancellation_snapshot end,$r$);
 execute definition;

 definition:=pg_get_functiondef('private.shared_hotel_cancellation_preview(integer,text)'::regprocedure);
 needle:=$n$'deadline',least(b.payment_expires_at,coalesce((terms->>'deadline')::timestamptz,b.payment_expires_at)),$n$;
 replacement:=$r$'deadline',case when b.status='pending' then b.payment_expires_at else (terms->>'deadline')::timestamptz end,$r$;
 if position(needle in definition)=0 then raise exception 'Inspect funded Hotel cancellation deadline';end if;execute replace(definition,needle,replacement);

end $patch$;
commit;
