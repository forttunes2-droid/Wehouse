-- A shared Short Let has several original Paystack charges. Caution decisions
-- must therefore distribute across those protected components without a wallet,
-- without commission, and without paying before the 48-hour appeal window.

alter table public.caution_claims
  alter column payment_protection_id drop not null,
  add column if not exists shared_payment_group_id uuid
    references public.shared_payment_groups(shared_payment_group_id) on delete restrict;
alter table public.caution_claims
  drop constraint if exists caution_claims_exactly_one_protection_source;
alter table public.caution_claims
  add constraint caution_claims_exactly_one_protection_source check(
    (payment_protection_id is not null)::integer+
    (shared_payment_group_id is not null)::integer=1
  ) not valid;
alter table public.caution_claims
  validate constraint caution_claims_exactly_one_protection_source;

create or replace function public.enqueue_shared_caution_distribution(
  p_shared_payment_group_id uuid,
  p_action_type text,
  p_subject_type text,
  p_subject_id text,
  p_amount numeric,
  p_idempotency_prefix text,
  p_available_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_component record;
  v_total_available numeric(12,2);
  v_remaining numeric(12,2):=round(coalesce(p_amount,0),2);
  v_allocated numeric(12,2);
  v_count integer:=0;
  v_index integer:=0;
  v_component_count integer;
begin
  if p_action_type not in(
    'refund_caution_undisputed','refund_caution_balance',
    'release_caution_award','refund_unclaimed_caution'
  ) then raise exception 'Invalid shared Caution action'; end if;
  if v_remaining<=0 then return 0; end if;

  select round(coalesce(sum(available_amount),0),2),count(*)
  into v_total_available,v_component_count
  from(
    select greatest(protection.amount_total-protection.released_amount-
      protection.refunded_amount-coalesce((select sum(action.amount)
        from public.financial_action_outbox action
        where action.payment_protection_id=protection.id
          and action.status in('pending','processing','provider_pending','provider_attention')),0),0)
      available_amount
    from public.shared_payment_protection_components component
    join public.payment_protection_transactions protection
      on protection.id=component.payment_protection_id
    where component.shared_payment_group_id=p_shared_payment_group_id
      and component.component_type='short_let_caution'
  ) available where available_amount>0;
  if v_remaining>v_total_available then
    raise exception 'Shared Caution distribution exceeds the protected balance'; end if;

  for v_component in
    select component.payment_protection_id,component.shared_payment_member_id,
      greatest(protection.amount_total-protection.released_amount-
        protection.refunded_amount-coalesce((select sum(action.amount)
          from public.financial_action_outbox action
          where action.payment_protection_id=protection.id
            and action.status in('pending','processing','provider_pending','provider_attention')),0),0)
        available_amount
    from public.shared_payment_protection_components component
    join public.payment_protection_transactions protection
      on protection.id=component.payment_protection_id
    where component.shared_payment_group_id=p_shared_payment_group_id
      and component.component_type='short_let_caution'
    order by component.shared_payment_member_id
  loop
    continue when v_component.available_amount<=0 or v_remaining<=0;
    v_index:=v_index+1;
    v_allocated:=least(v_remaining,
      case when v_index=v_component_count then v_remaining
        else round(p_amount*v_component.available_amount/v_total_available,2) end,
      v_component.available_amount);
    if v_allocated<=0 then continue; end if;
    insert into public.financial_action_outbox(
      action_type,subject_type,subject_id,payment_protection_id,amount,
      idempotency_key,available_at,metadata
    ) values(
      p_action_type,p_subject_type,p_subject_id,v_component.payment_protection_id,
      v_allocated,p_idempotency_prefix||':'||v_component.payment_protection_id,
      coalesce(p_available_at,now()),jsonb_build_object(
        'shared_payment_group_id',p_shared_payment_group_id,
        'shared_payment_member_id',v_component.shared_payment_member_id,
        'refund_destination',case when p_action_type like 'refund_%'
          then 'original_payment' else null end
      )
    ) on conflict(idempotency_key) do nothing;
    if found then v_count:=v_count+1; end if;
    v_remaining:=v_remaining-v_allocated;
  end loop;
  if v_remaining<>0 then
    raise exception 'Shared Caution distribution did not allocate exactly'; end if;
  return v_count;
end
$$;

create or replace function public.partner_raise_caution_claim(
  p_reservation_id text,p_claimed_amount numeric,p_reason text,p_evidence_paths text[]
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_res public.reservations;
  v_listing public.listings;
  v_id uuid;
  v_path text;
  v_deposit numeric(12,2);
begin
  select * into v_res from public.reservations
  where id=p_reservation_id and stay_type='short_let'
    and canonical_state in('checked_out','completed') for update;
  if v_res.id is null then raise exception 'Completed Short Let required'; end if;
  select * into v_listing from public.listings
  where listing_id=v_res.listing_id or id::text=v_res.listing_id;
  if v_actor is null or v_actor not in(v_listing.owner_id,v_listing.partner_id) then
    raise exception 'Property Partner access required'; end if;
  if v_res.completed_at is null or now()>v_res.completed_at+interval '24 hours' then
    raise exception 'Caution claim window closed'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'Explain the claimed damage'; end if;
  if coalesce(cardinality(p_evidence_paths),0)=0 then
    raise exception 'Damage evidence is required'; end if;

  if v_res.shared_payment_group_id is not null then
    select round(coalesce(sum(component.amount),0),2) into v_deposit
    from public.shared_payment_protection_components component
    where component.shared_payment_group_id=v_res.shared_payment_group_id
      and component.component_type='short_let_caution';
  else
    v_deposit:=round(coalesce(v_res.security_deposit_snapshot,0),2);
  end if;
  if v_deposit<=0 then raise exception 'This Short Let has no Caution fee'; end if;
  if coalesce(p_claimed_amount,0)<=0 or p_claimed_amount>v_deposit then
    raise exception 'Claim must be within the Caution fee'; end if;

  insert into public.caution_claims(
    reservation_id,payment_protection_id,shared_payment_group_id,
    deposit_amount,claimed_amount,disputed_amount,undisputed_refund_amount,
    reason,guest_response_due_at
  ) values(
    v_res.id,case when v_res.shared_payment_group_id is null
      then v_res.caution_payment_protection_id else null end,
    v_res.shared_payment_group_id,v_deposit,p_claimed_amount,p_claimed_amount,
    v_deposit-p_claimed_amount,btrim(p_reason),now()+interval '48 hours'
  ) returning caution_claim_id into v_id;
  foreach v_path in array p_evidence_paths loop
    insert into public.caution_evidence(
      reservation_id,caution_claim_id,submitted_by,evidence_type,object_path
    ) values(v_res.id,v_id,v_actor,'partner_damage_claim',v_path);
  end loop;
  if v_deposit-p_claimed_amount>0 then
    if v_res.shared_payment_group_id is not null then
      perform public.enqueue_shared_caution_distribution(
        v_res.shared_payment_group_id,'refund_caution_undisputed','caution_claim',
        v_id::text,v_deposit-p_claimed_amount,'caution-undisputed-refund:'||v_id,now()
      );
    else
      insert into public.financial_action_outbox(
        action_type,subject_type,subject_id,payment_protection_id,amount,
        idempotency_key,metadata
      ) values(
        'refund_caution_undisputed','caution_claim',v_id::text,
        v_res.caution_payment_protection_id,v_deposit-p_claimed_amount,
        'caution-undisputed-refund:'||v_id,
        jsonb_build_object('refund_destination','original_payment')
      );
    end if;
  end if;
  return v_id;
end
$$;

create or replace function public.resolve_caution_finance(
  p_caution_claim_id uuid,p_partner_award numeric,p_resolution text
)
returns public.caution_claims
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_claim public.caution_claims;
  v_refund numeric(12,2);
  v_refund_balance numeric(12,2);
  v_available_at timestamptz;
  v_final_appeal boolean;
  v_suffix text;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if not(v_actor.role='creator' or public.current_actor_has_workspace('finance_operations',null)) then
    raise exception 'Finance Operations access required'; end if;
  select * into v_claim from public.caution_claims
  where caution_claim_id=p_caution_claim_id for update;
  if v_claim.caution_claim_id is null or v_claim.status not in('finance_review','appealed') then
    raise exception 'Claim is not ready for Finance Operations'; end if;
  if nullif(btrim(coalesce(p_resolution,'')),'') is null then
    raise exception 'A written Finance resolution is required'; end if;
  if p_partner_award<0 or p_partner_award>v_claim.disputed_amount then
    raise exception 'Award cannot exceed the Property Operations supported amount'; end if;
  v_final_appeal:=v_claim.status='appealed';
  v_available_at:=case when v_final_appeal then now() else now()+interval '48 hours' end;
  v_suffix:=case when v_final_appeal then ':appeal-final' else ':initial' end;
  v_refund:=v_claim.deposit_amount-p_partner_award;
  v_refund_balance:=greatest(v_refund-v_claim.undisputed_refund_amount,0);
  update public.caution_claims set
    partner_award=p_partner_award,customer_refund=v_refund,
    finance_resolved_by=v_actor.user_id,finance_resolved_at=now(),
    guest_response=concat_ws(E'\n',guest_response,
      case when v_final_appeal then 'Final appeal decision: ' else 'Finance resolution: ' end||btrim(p_resolution)),
    appeal_due_at=case when v_final_appeal then null else v_available_at end,
    status='resolved',updated_at=now()
  where caution_claim_id=p_caution_claim_id returning * into v_claim;

  if v_claim.shared_payment_group_id is not null then
    if p_partner_award>0 then perform public.enqueue_shared_caution_distribution(
      v_claim.shared_payment_group_id,'release_caution_award','caution_claim',
      p_caution_claim_id::text,p_partner_award,
      'caution-award:'||p_caution_claim_id||v_suffix,v_available_at); end if;
    if v_refund_balance>0 then perform public.enqueue_shared_caution_distribution(
      v_claim.shared_payment_group_id,'refund_caution_balance','caution_claim',
      p_caution_claim_id::text,v_refund_balance,
      'caution-balance-refund:'||p_caution_claim_id||v_suffix,v_available_at); end if;
  else
    if p_partner_award>0 then
      insert into public.financial_action_outbox(
        action_type,subject_type,subject_id,payment_protection_id,amount,
        idempotency_key,available_at
      ) values(
        'release_caution_award','caution_claim',p_caution_claim_id::text,
        v_claim.payment_protection_id,p_partner_award,
        'caution-award:'||p_caution_claim_id||v_suffix,v_available_at
      );
    end if;
    if v_refund_balance>0 then
      insert into public.financial_action_outbox(
        action_type,subject_type,subject_id,payment_protection_id,amount,
        idempotency_key,available_at,metadata
      ) values(
        'refund_caution_balance','caution_claim',p_caution_claim_id::text,
        v_claim.payment_protection_id,v_refund_balance,
        'caution-balance-refund:'||p_caution_claim_id||v_suffix,v_available_at,
        jsonb_build_object('refund_destination','original_payment')
      );
    end if;
  end if;
  return v_claim;
end
$$;

create or replace function public.appeal_caution_resolution(
  p_caution_claim_id uuid,p_reason text,p_evidence_paths text[] default '{}'
)
returns public.caution_claims
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_claim public.caution_claims; v_path text;
begin
  select c.* into v_claim
  from public.caution_claims c
  join public.reservations r on r.id=c.reservation_id
  join public.listings l on l.listing_id=r.listing_id or l.id::text=r.listing_id
  where c.caution_claim_id=p_caution_claim_id
    and v_actor in(r.user_id,l.owner_id,l.partner_id) for update of c;
  if v_claim.caution_claim_id is null then raise exception 'Caution claim not found'; end if;
  if v_claim.status<>'resolved' or v_claim.appeal_due_at is null
    or v_claim.appeal_due_at<now() then raise exception 'The 48-hour appeal window is closed'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Appeal reason required'; end if;
  foreach v_path in array coalesce(p_evidence_paths,'{}'::text[]) loop
    insert into public.caution_evidence(
      reservation_id,caution_claim_id,submitted_by,evidence_type,object_path,description
    ) values(v_claim.reservation_id,v_claim.caution_claim_id,v_actor,'appeal',v_path,btrim(p_reason));
  end loop;
  update public.financial_action_outbox set status='manual_review',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'superseded_by_appeal',true,'superseded_amount',amount
    ),amount=0,last_error='Superseded by an in-window Caution appeal',updated_at=now()
  where subject_type='caution_claim' and subject_id=p_caution_claim_id::text
    and status='pending' and available_at>now();
  update public.caution_claims set status='appealed',updated_at=now()
  where caution_claim_id=p_caution_claim_id returning * into v_claim;
  return v_claim;
end
$$;

create or replace function public.release_unclaimed_caution_from_service(p_reservation_id text)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_res public.reservations; v_action uuid;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  select * into v_res from public.reservations
  where id=p_reservation_id and stay_type='short_let' for update;
  if v_res.id is null then raise exception 'Short Let not found'; end if;
  if coalesce(v_res.security_deposit_snapshot,0)<=0 then
    raise exception 'This Short Let has no Caution fee'; end if;
  if v_res.completed_at is null or v_res.completed_at+interval '24 hours'>now() then
    raise exception 'Partner claim window is still open'; end if;
  if exists(select 1 from public.caution_claims where reservation_id=v_res.id) then
    raise exception 'Caution claim exists'; end if;
  if v_res.shared_payment_group_id is not null then
    perform public.enqueue_shared_caution_distribution(
      v_res.shared_payment_group_id,'refund_unclaimed_caution','short_let',v_res.id,
      v_res.security_deposit_snapshot,'caution-unclaimed-refund:'||v_res.id,now()
    );
    select financial_action_id into v_action from public.financial_action_outbox
    where idempotency_key like 'caution-unclaimed-refund:'||v_res.id||':%'
    order by created_at limit 1;
  else
    insert into public.financial_action_outbox(
      action_type,subject_type,subject_id,payment_protection_id,amount,
      idempotency_key,metadata
    ) values(
      'refund_unclaimed_caution','short_let',v_res.id,
      v_res.caution_payment_protection_id,v_res.security_deposit_snapshot,
      'caution-unclaimed-refund:'||v_res.id,
      jsonb_build_object('refund_destination','original_payment')
    ) on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key
    returning financial_action_id into v_action;
  end if;
  return v_action;
end
$$;

-- The compatibility service entry point must not reopen the old three-day
-- shared checkout. The Long Let reservation itself gets the separate three-day
-- hold only after the atomic reservation-charge checkout succeeds.
create or replace function public.open_shared_payment_checkout(
  p_group_id uuid,p_event_key text
)
returns public.shared_payment_groups
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_group public.shared_payment_groups; v_member_count integer;
  v_accepted_count integer; v_share_total numeric;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  perform p_event_key;
  select * into v_group from public.shared_payment_groups
  where shared_payment_group_id=p_group_id for update;
  if v_group.shared_payment_group_id is null then raise exception 'Shared payment not found'; end if;
  if v_group.product_type not in('long_let','short_let') then
    raise exception 'Hotel shared payment is not allowed'; end if;
  select count(*),count(*) filter(where invitation_state='accepted'),
    coalesce(sum(share_amount) filter(where invitation_state='accepted'),0)
  into v_member_count,v_accepted_count,v_share_total
  from public.shared_payment_members where shared_payment_group_id=p_group_id;
  if v_member_count>v_group.capacity or v_accepted_count>v_group.capacity then
    raise exception 'Property capacity exceeded'; end if;
  if v_accepted_count<2 or v_share_total<>v_group.total_amount then
    raise exception 'Accepted share amounts must equal the checkout total'; end if;
  update public.shared_payment_groups set status='checkout_open',
    checkout_expires_at=now()+interval '30 minutes',updated_at=now()
  where shared_payment_group_id=p_group_id returning * into v_group;
  update public.shared_housing_groups set status='payment_pending',
    expires_at=v_group.checkout_expires_at,updated_at=now()
  where canonical_group_id=p_group_id;
  return v_group;
end
$$;

revoke all on function public.enqueue_shared_caution_distribution(
  uuid,text,text,text,numeric,text,timestamptz
) from public,anon,authenticated;
grant execute on function public.enqueue_shared_caution_distribution(
  uuid,text,text,text,numeric,text,timestamptz
) to service_role;
revoke all on function public.partner_raise_caution_claim(text,numeric,text,text[])
from public,anon;
grant execute on function public.partner_raise_caution_claim(text,numeric,text,text[])
to authenticated,service_role;
revoke all on function public.resolve_caution_finance(uuid,numeric,text)
from public,anon;
grant execute on function public.resolve_caution_finance(uuid,numeric,text)
to authenticated,service_role;
revoke all on function public.appeal_caution_resolution(uuid,text,text[])
from public,anon;
grant execute on function public.appeal_caution_resolution(uuid,text,text[])
to authenticated,service_role;
revoke all on function public.release_unclaimed_caution_from_service(text)
from public,anon,authenticated;
grant execute on function public.release_unclaimed_caution_from_service(text)
to service_role;
revoke all on function public.open_shared_payment_checkout(uuid,text)
from public,anon,authenticated;
grant execute on function public.open_shared_payment_checkout(uuid,text)
to service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select p.oid::regprocedure::text,p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  case when has_function_privilege('authenticated',p.oid,'execute')
    then 'approved_client_rpc' else 'approved_service_only' end,
  case when has_function_privilege('authenticated',p.oid,'execute')
    then 'Actor- and role-bound Short Let Caution action'
    else 'Shared Caution distribution or protected release helper' end,now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'enqueue_shared_caution_distribution','partner_raise_caution_claim',
  'resolve_caution_finance','appeal_caution_resolution',
  'release_unclaimed_caution_from_service','open_shared_payment_checkout'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,captured_at=now();

comment on function public.enqueue_shared_caution_distribution(
  uuid,text,text,text,numeric,text,timestamptz
) is 'Distributes a shared Short Let Caution outcome across original protected Paystack charges.';
