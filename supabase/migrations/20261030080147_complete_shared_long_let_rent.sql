begin;

alter table public.shared_payment_members add column rent_agreement_snapshot jsonb;
alter table public.rent_plans add column shared_payment_member_id uuid references public.shared_payment_members(shared_payment_member_id);
drop index public.rent_plans_one_per_reservation;
create unique index rent_plans_one_per_reservation_payer on public.rent_plans(reservation_id,user_id)
 where reservation_id is not null and status<>'cancelled';

create function private.shared_long_let_actor(p_group_id uuid,p_creator_only boolean default false)
returns text language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();
begin
 if actor is null or not public._property_document_session_active()
  or public.user_has_active_workspace(actor,'personal') is distinct from true
  or not exists(select 1 from public.shared_housing_groups g join public.shared_housing_members m on m.group_id=g.id
   where g.id=p_group_id and g.product_type='long_let' and m.user_id=actor
    and (not p_creator_only or g.created_by=actor)) then
  raise exception 'Trusted shared tenancy access required' using errcode='42501';end if;
 return actor;
end $$;
revoke all on function private.shared_long_let_actor(uuid,boolean) from public,anon,authenticated;

-- The private calculator is common to individual and shared rent. Public
-- individual agreement endpoints retain their explicit individual-only guard.
do $$declare definition text:=pg_get_functiondef('private.long_let_booking_quote(text,integer,text)'::regprocedure);
 needle text:='or r.shared_payment_group_id is not null then raise exception ''Individual Long Let reservation required'';end if;';
begin
 if position(needle in definition)=0 then raise exception 'Inspect shared rent quote boundary before upgrading';end if;
 execute replace(definition,needle,'then raise exception ''Long Let reservation required'';end if;');
end $$;

create function public.get_my_shared_long_let_terms(p_group_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.shared_long_let_actor(p_group_id);g public.shared_housing_groups;r public.reservations;l public.listings;mine jsonb;
begin
 select * into g from public.shared_housing_groups where id=p_group_id;
 select * into r from public.reservations where id=g.reservation_id;
 select * into l from public.listings where id=g.listing_id;
 select rent_agreement_snapshot into mine from public.shared_payment_members where shared_payment_group_id=g.canonical_group_id and user_id=actor;
 return jsonb_build_object('group_id',g.id,'reservation_id',r.id,'checkout_attempt',g.checkout_attempt,
  'accepted_terms_months',l.accepted_lease_terms_months,'monthly_accepted',coalesce(l.future_installments_allowed,false),
  'monthly_ready',private.long_let_settlement_account(l.id) is not null and private.later_rent_collection_enabled(),
  'editable',g.created_by=actor and g.payment_phase='reservation_fee' and g.status='paid'
   and r.status in('reserved','ready_for_move_in') and r.rent_payment_status='not_started',
  'agreement',mine,'tenancy_agreement',r.rent_terms_snapshot);
end $$;
revoke all on function public.get_my_shared_long_let_terms(uuid) from public,anon;
grant execute on function public.get_my_shared_long_let_terms(uuid) to authenticated;

create function public.preview_my_shared_long_let_agreement(p_group_id uuid,p_term_months integer,p_payment_choice text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.shared_long_let_actor(p_group_id,true);g public.shared_housing_groups;r public.reservations;q jsonb;people text[];
begin
 select * into g from public.shared_housing_groups where id=p_group_id for update;
 select * into r from public.reservations where id=g.reservation_id for share;
 if g.payment_phase<>'reservation_fee' or g.status<>'paid' or r.status not in('reserved','ready_for_move_in')
  or r.manual_payment_status not in('paid','completed') or r.paid_at is null
  or r.rent_payment_status<>'not_started' then raise exception 'The shared reservation is not ready for a rental agreement';end if;
 select array_agg(m.user_id order by m.created_at,m.id) into people from public.shared_housing_members m where m.group_id=g.id;
 if cardinality(people) not between 2 and 3 or exists(select 1 from unnest(people) person
  where public.user_has_active_workspace(person,'personal') is distinct from true) then raise exception 'Every shared payer needs active Personal access';end if;
 q:=private.long_let_booking_quote(r.id,p_term_months,p_payment_choice)-'quote_digest';
 q:=q||jsonb_build_object('shared_payment_group_id',g.canonical_group_id,'payer_user_ids',people,
  'partner_user_id',(select coalesce(partner_id,owner_id) from public.listings where id=g.listing_id));
 q:=q||jsonb_build_object('quote_digest',md5(q::text));
 return jsonb_build_object('group_id',g.id,'checkout_attempt',g.checkout_attempt,'agreement',q,
  'payer_agreements',private.shared_long_let_payer_agreements(q,people));
end $$;
revoke all on function public.preview_my_shared_long_let_agreement(uuid,integer,text) from public,anon;
grant execute on function public.preview_my_shared_long_let_agreement(uuid,integer,text) to authenticated;

drop function public.start_my_shared_contract_split(uuid);
create function public.start_my_shared_contract_split(p_group_id uuid,p_term_months integer,p_payment_choice text,p_quote_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.shared_long_let_actor(p_group_id,true);g public.shared_housing_groups;r public.reservations;
 preview jsonb;q jsonb;own jsonb;member public.shared_housing_members;i integer:=0;amount numeric;deadline timestamptz;
begin
 select * into g from public.shared_housing_groups where id=p_group_id for update;
 select * into r from public.reservations where id=g.reservation_id for update;
 if g.payment_phase='contract_rent' and r.rent_terms_snapshot->>'quote_digest'=p_quote_digest
  and r.lease_term_months=p_term_months and r.rent_payment_choice=p_payment_choice then return public.get_my_shared_housing_group(g.id);end if;
 preview:=public.preview_my_shared_long_let_agreement(g.id,p_term_months,p_payment_choice);q:=preview->'agreement';
 if p_quote_digest is null or q->>'quote_digest' is distinct from p_quote_digest then raise exception 'Rental terms changed. Review the shared agreement again';end if;
 deadline:=least(coalesce(r.hold_expires_at,now()+interval '72 hours'),now()+interval '72 hours');
 if deadline<=now() then raise exception 'The reservation window ended. Contact WeHouse before paying rent';end if;
 update public.reservations set rent_terms_snapshot=q||jsonb_build_object('accepted_by',actor,'accepted_at',now()),
  lease_term_months=p_term_months,rent_payment_choice=p_payment_choice,rental_plan_years=ceil(p_term_months/12.0)::integer,
  rental_plan_selected_at=now(),annual_rent_snapshot=(q#>>'{rent_schedule,annual_rent}')::numeric,
  contract_rent_total=(q#>>'{rent_schedule,contract_total}')::numeric,upfront_rent_required=(q#>>'{rent_schedule,due_before_handover}')::numeric,
  installment_balance=(q#>>'{rent_schedule,future_balance}')::numeric,installment_count=jsonb_array_length(q#>'{rent_schedule,payments}')-1,
  commission_policy_version_id=(q->>'commission_policy_version_id')::uuid,
  year_one_partner_rent_snapshot=(q#>>'{partner_schedule,payments,0,amount}')::numeric,
  year_one_discount_percent_snapshot=(q->>'discount_percent')::numeric,year_one_wehouse_discount_percent_snapshot=(q->>'wehouse_discount_percent')::numeric,
  rent_payment_status='payment_pending',rent_payment_reference=null,updated_at=now() where id=r.id;
 update public.shared_housing_groups set payment_phase='contract_rent',status='inviting',
  total_amount=(q#>>'{rent_schedule,due_before_handover}')::numeric,contract_total=(q#>>'{rent_schedule,contract_total}')::numeric,
  checkout_attempt=checkout_attempt+1,expires_at=deadline,updated_at=now() where id=g.id returning * into g;
 update public.shared_payment_groups set payment_phase='contract_rent',status='inviting',total_amount=g.total_amount,
  checkout_attempt=g.checkout_attempt,checkout_expires_at=deadline,policy_version_id=(q->>'commission_policy_version_id')::uuid,updated_at=now()
  where shared_payment_group_id=g.canonical_group_id;
 for member in select * from public.shared_housing_members where group_id=g.id order by created_at,id loop
  own:=preview->'payer_agreements'->i;i:=i+1;amount:=(own#>>'{rent_schedule,due_before_handover}')::numeric;
  if own->>'payer_user_id' is distinct from member.user_id then raise exception 'Shared payer order changed';end if;
  if member.user_id=actor then own:=own||jsonb_build_object('accepted_by',actor,'accepted_at',now());end if;
  update public.shared_housing_members set invitation_status=case when user_id=actor then 'accepted' else 'invited' end,
   share_amount=amount,eligible_partner_share=amount,refundable_share=0,payment_status='not_started',payment_reference=null,paid_at=null,updated_at=now() where id=member.id;
  update public.shared_payment_members set invitation_state=case when user_id=actor then 'accepted' else 'invited' end,
   share_amount=amount,eligible_partner_share=amount,refundable_share=0,payment_state='not_started',provider_reference=null,paid_at=null,
   rent_agreement_snapshot=own,updated_at=now() where shared_payment_member_id=member.canonical_member_id;
 end loop;
 insert into public.audit_logs(action,target_type,target_id,admin_id,details) values('SHARED_RENT_AGREEMENT_STARTED','shared_payment',g.canonical_group_id::text,actor,
  jsonb_build_object('agreement',q,'checkout_attempt',g.checkout_attempt)::text);
 return public.get_my_shared_housing_group(g.id);
end $$;
revoke all on function public.start_my_shared_contract_split(uuid,integer,text,text) from public,anon;
grant execute on function public.start_my_shared_contract_split(uuid,integer,text,text) to authenticated;

alter function public.respond_to_shared_housing_invite(uuid,boolean) set schema private;
alter function private.respond_to_shared_housing_invite(uuid,boolean) rename to respond_to_shared_housing_invite_recorded;
revoke all on function private.respond_to_shared_housing_invite_recorded(uuid,boolean) from public,anon,authenticated;
create function public.respond_to_shared_housing_invite(p_group_id uuid,p_accept boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if public.current_profile_user_id() is null or not public._property_document_session_active()
  or not exists(select 1 from public.shared_housing_members where group_id=p_group_id and user_id=public.current_profile_user_id()) then
  raise exception 'Trusted shared-payment access required' using errcode='42501';end if;
 if exists(select 1 from public.shared_housing_groups where id=p_group_id and product_type='long_let' and payment_phase='contract_rent') then
  raise exception 'Review your rental agreement and share before accepting';end if;
 return private.respond_to_shared_housing_invite_recorded(p_group_id,p_accept);
end $$;
revoke all on function public.respond_to_shared_housing_invite(uuid,boolean) from public,anon;
grant execute on function public.respond_to_shared_housing_invite(uuid,boolean) to authenticated;

create function public.respond_to_shared_rent_agreement(p_group_id uuid,p_accept boolean,p_quote_digest text,p_checkout_attempt integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.shared_long_let_actor(p_group_id);g public.shared_housing_groups;m public.shared_payment_members;receipt jsonb;
begin
 select * into g from public.shared_housing_groups where id=p_group_id for update;
 select * into m from public.shared_payment_members where shared_payment_group_id=g.canonical_group_id and user_id=actor for update;
 if g.payment_phase<>'contract_rent' or p_accept is null or p_checkout_attempt is distinct from g.checkout_attempt
  or p_quote_digest is null or m.rent_agreement_snapshot->>'quote_digest' is distinct from p_quote_digest then
  raise exception 'The rental agreement or checkout attempt changed. Refresh before deciding';end if;
 if p_accept and m.invitation_state='accepted' and m.rent_agreement_snapshot->>'accepted_by'=actor then return public.get_my_shared_housing_group(g.id);end if;
 if not p_accept and m.invitation_state='declined' then return public.get_my_shared_housing_group(g.id);end if;
 if p_accept then
  receipt:=m.rent_agreement_snapshot||jsonb_build_object('accepted_by',actor,'accepted_at',now());
  update public.shared_payment_members set rent_agreement_snapshot=receipt,updated_at=now() where shared_payment_member_id=m.shared_payment_member_id;
 end if;
 receipt:=private.respond_to_shared_housing_invite_recorded(g.id,p_accept);
 insert into public.audit_logs(action,target_type,target_id,admin_id,details) values(case when p_accept then 'SHARED_RENT_ACCEPTED' else 'SHARED_RENT_DECLINED' end,
  'shared_payment',g.canonical_group_id::text,actor,jsonb_build_object('quote_digest',p_quote_digest,'checkout_attempt',g.checkout_attempt)::text);
 return receipt;
end $$;
revoke all on function public.respond_to_shared_rent_agreement(uuid,boolean,text,integer) from public,anon;
grant execute on function public.respond_to_shared_rent_agreement(uuid,boolean,text,integer) to authenticated;

create function private.shared_long_let_initial_rent_confirmed(p_reservation_id text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare r public.reservations;decision jsonb;
begin
 select * into r from public.reservations where id=p_reservation_id;
 if r.id is null or r.shared_payment_group_id is null or r.stay_type is distinct from 'long_stay' then return false;end if;
 decision:=public.accommodation_access_authorization(r.id,r.listing_id,r.user_id,r.stay_type,r.status,
  r.manual_payment_status,r.paid_at,r.rent_payment_status,r.rent_paid_at,r.rent_payment_reference,
  r.stay_payment_protection_id,r.year_one_rent_protection_id,r.shared_payment_group_id,r.upfront_rent_required,'location');
 return coalesce((decision->>'authorized')::boolean,false);
end $$;
revoke all on function private.shared_long_let_initial_rent_confirmed(text) from public,anon,authenticated;

create function private.long_let_plan_agreement(p_plan_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare plan public.rent_plans;r public.reservations;m public.shared_payment_members;q jsonb;
begin
 select * into plan from public.rent_plans where id=p_plan_id;
 select * into r from public.reservations where id=plan.reservation_id;
 if plan.id is null or r.id is null then raise exception 'Accepted rental plan is unavailable';end if;
 if r.shared_payment_group_id is null then
  if plan.user_id is distinct from r.user_id or plan.accepted_terms::jsonb->>'quote_digest' is distinct from r.rent_terms_snapshot->>'quote_digest' then
   raise exception 'Rental plan no longer matches its accepted tenancy';end if;
  return r.rent_terms_snapshot;
 end if;
 select * into m from public.shared_payment_members where shared_payment_member_id=plan.shared_payment_member_id
  and shared_payment_group_id=r.shared_payment_group_id and user_id=plan.user_id;
 q:=plan.accepted_terms::jsonb;
 if m.shared_payment_member_id is null or m.invitation_state is distinct from 'accepted' or m.payment_state is distinct from 'paid'
  or q-'initial_payment_reference' is distinct from m.rent_agreement_snapshot
  or q->>'accepted_by' is distinct from plan.user_id or q->>'payer_user_id' is distinct from plan.user_id
  or q->>'parent_agreement_digest' is distinct from r.rent_terms_snapshot->>'quote_digest'
  or q->>'initial_payment_reference' is distinct from m.provider_reference then
  raise exception 'The payer plan no longer matches their accepted shared tenancy';end if;
 return q;
end $$;
revoke all on function private.long_let_plan_agreement(uuid) from public,anon,authenticated;

create function private.sync_shared_long_let_plans(p_reservation_id text,p_start_date date default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.reservations;m public.shared_payment_members;plan public.rent_plans;q jsonb;entry jsonb;existing public.rent_plan_contributions;
 first_id uuid;idx integer;due date;part integer;future numeric;total numeric;upfront numeric;
begin
 select * into r from public.reservations where id=p_reservation_id for update;
 if r.shared_payment_group_id is null or r.rent_terms_snapshot is null then raise exception 'Accepted shared tenancy required';end if;
 if coalesce((r.rent_terms_snapshot#>>'{rent_schedule,future_balance}')::numeric,0)=0 then return null;end if;
 if not private.shared_long_let_initial_rent_confirmed(r.id) then raise exception 'Every initial rent share needs verified Payment Protection';end if;
 for m in select * from public.shared_payment_members where shared_payment_group_id=r.shared_payment_group_id order by shared_payment_member_id loop
  q:=m.rent_agreement_snapshot||jsonb_build_object('initial_payment_reference',m.provider_reference);
  if q->>'accepted_by' is distinct from m.user_id or q->>'parent_agreement_digest' is distinct from r.rent_terms_snapshot->>'quote_digest'
   or q#>>'{rent_schedule,payment_choice}' is distinct from 'monthly' then raise exception 'Every payer must accept the recorded monthly rental agreement';end if;
  future:=(q#>>'{rent_schedule,future_balance}')::numeric;total:=(q#>>'{rent_schedule,contract_total}')::numeric;upfront:=(q#>>'{rent_schedule,due_before_handover}')::numeric;
  select * into plan from public.rent_plans where reservation_id=r.id and user_id=m.user_id and status<>'cancelled' for update;
  if plan.id is null then
   insert into public.rent_plans(user_id,listing_id,reservation_id,shared_payment_member_id,target_amount,start_after_months,
    cancellation_fee_percent,accepted_terms,status,total_contract_rent,upfront_percent,upfront_amount,installment_count,installment_amount,installment_balance,paid_installments)
   values(m.user_id,r.listing_id::uuid,r.id,m.shared_payment_member_id,future,4,0,q::text,'active',total,
    round(upfront/total*100,2),upfront,jsonb_array_length(q#>'{rent_schedule,payments}')-1,
    (q#>>'{rent_schedule,payments,1,amount}')::numeric,future,0) returning * into plan;
  elsif plan.accepted_terms::jsonb is distinct from q or plan.shared_payment_member_id is distinct from m.shared_payment_member_id then
   raise exception 'Existing payer obligations belong to a different accepted agreement';
  end if;
  perform private.long_let_plan_agreement(plan.id);
  if first_id is null then first_id:=plan.id;end if;
  if p_start_date is not null and plan.tenancy_start_date is not null and plan.tenancy_start_date<>p_start_date then
   raise exception 'A shared tenancy start date cannot be silently changed';end if;
  for idx in 1..jsonb_array_length(q#>'{rent_schedule,payments}')-1 loop
   entry:=q#>array['rent_schedule','payments',idx::text];part:=((idx-1)%8)+1;
   due:=case when p_start_date is null then null else (p_start_date+make_interval(months=>(entry->>'month_offset')::integer))::date end;
   insert into public.rent_plan_contributions(rent_plan_id,reservation_id,amount,status,target_year,installment_number,due_date,agreement_sequence)
    values(plan.id,r.id,(entry->>'amount')::numeric,'scheduled',(entry->>'target_year')::integer,part,due,idx+1)
    on conflict(rent_plan_id,target_year,installment_number) do nothing;
   select * into existing from public.rent_plan_contributions where rent_plan_id=plan.id and target_year=(entry->>'target_year')::integer and installment_number=part for update;
   if existing.amount is distinct from (entry->>'amount')::numeric or existing.agreement_sequence is distinct from idx+1
    or (existing.due_date is not null and due is not null and existing.due_date<>due) then raise exception 'The payer schedule changed after acceptance';end if;
   if existing.due_date is null and due is not null then update public.rent_plan_contributions set due_date=due,updated_at=now() where id=existing.id;end if;
  end loop;
  update public.rent_plans set tenancy_start_date=coalesce(tenancy_start_date,p_start_date),
   next_rent_due_date=(select min(due_date) from public.rent_plan_contributions where rent_plan_id=plan.id and status in('scheduled','pending','payment_pending')),updated_at=now() where id=plan.id;
 end loop;
 return first_id;
end $$;
revoke all on function private.sync_shared_long_let_plans(text,date) from public,anon,authenticated;

alter function private.sync_agreed_long_let_schedule(text,date) rename to sync_individual_long_let_schedule;
revoke all on function private.sync_individual_long_let_schedule(text,date) from public,anon,authenticated;
create function private.sync_agreed_long_let_schedule(p_reservation_id text,p_start_date date default null)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.reservations where id=p_reservation_id and shared_payment_group_id is not null) then
  return private.sync_shared_long_let_plans(p_reservation_id,p_start_date);end if;
 return private.sync_individual_long_let_schedule(p_reservation_id,p_start_date);
end $$;
revoke all on function private.sync_agreed_long_let_schedule(text,date) from public,anon,authenticated;

create or replace function private.require_long_let_customer(p_reservation_id text) returns text
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();
begin
 if actor is null or not public._property_document_session_active() or not exists(select 1 from public.profiles
  where user_id=actor and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false))
  or not exists(select 1 from public.reservations r where r.id=p_reservation_id and (r.user_id=actor or exists(
   select 1 from public.shared_payment_members m join public.shared_payment_groups g using(shared_payment_group_id)
   where g.shared_payment_group_id=r.shared_payment_group_id and g.reservation_id=r.id and g.product_type='long_let'
    and m.user_id=actor and m.invitation_state='accepted' and m.payment_state='paid' and m.rent_agreement_snapshot->>'accepted_by'=actor))) then
  raise exception 'Trusted tenant access required' using errcode='42501';end if;
 return actor;
end $$;

create function private.capture_shared_rent_checkout(p_payment_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.booking_payments;m public.shared_payment_members;g public.shared_payment_groups;r public.reservations;q jsonb;net numeric;fee numeric;payee text;
begin
 select * into p from public.booking_payments where id=p_payment_id for update;
 select * into m from public.shared_payment_members where shared_payment_member_id=(p.metadata->>'canonical_shared_payment_member_id')::uuid for share;
 select * into g from public.shared_payment_groups where shared_payment_group_id=m.shared_payment_group_id for share;
 select * into r from public.reservations where id=g.reservation_id for share;
 q:=m.rent_agreement_snapshot;net:=(q#>>'{rent_schedule,payments,0,partner_net_amount}')::numeric;fee:=(q#>>'{rent_schedule,payments,0,wehouse_amount}')::numeric;
 payee:=q->>'partner_user_id';
 if payee is null then select coalesce(partner_id,owner_id) into payee from public.listings where id::text=r.listing_id;end if;
 if p.purpose is distinct from 'shared_housing_share' or p.status is distinct from 'pending' or g.product_type is distinct from 'long_let'
  or g.payment_phase is distinct from 'contract_rent' or r.id is null or payee is null
  or q->>'accepted_by' is distinct from p.user_id or q->>'accepted_at' is null or m.user_id is distinct from p.user_id
  or payee is distinct from (select coalesce(partner_id,owner_id) from public.listings where id::text=r.listing_id)
  or q->>'parent_agreement_digest' is distinct from r.rent_terms_snapshot->>'quote_digest'
  or (q#>>'{rent_schedule,due_before_handover}')::numeric is distinct from p.amount_total
  or net is null or fee is null or net<0 or fee<0 or net+fee is distinct from p.amount_total
  or exists(select 1 from public.shared_payment_members other where other.shared_payment_group_id=g.shared_payment_group_id
    and (other.invitation_state is distinct from 'accepted' or other.rent_agreement_snapshot->>'accepted_by' is distinct from other.user_id
     or other.rent_agreement_snapshot->>'parent_agreement_digest' is distinct from r.rent_terms_snapshot->>'quote_digest')) then
  raise exception 'Every payer must accept the same rental agreement and their exact share';end if;
 if p.metadata->'rent_agreement_snapshot' is not null then
  if p.metadata->'rent_agreement_snapshot' is distinct from q or p.net_amount is distinct from net or p.amount_commission is distinct from fee
   or p.payee_user_id is distinct from payee then raise exception 'The saved rent checkout no longer matches the accepted share';end if;
  return;
 end if;
 if p.metadata->>'paystack_authorization_url' is not null then raise exception 'An earlier rent checkout needs reconciliation before another is prepared';end if;
 update public.booking_payments set payee_user_id=payee,net_amount=net,amount_commission=fee,
  commission_rate=(q->>'commission_rate')::numeric,commission_policy_version_id=(q->>'commission_policy_version_id')::uuid,
  commission_frozen_at=now(),metadata=metadata||jsonb_build_object('rent_agreement_snapshot',q),updated_at=now() where id=p.id;
end $$;
revoke all on function private.capture_shared_rent_checkout(uuid) from public,anon,authenticated;

create or replace function public.create_my_shared_housing_payment(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();g public.shared_housing_groups;result jsonb;payment_id uuid;
begin
 if actor is null or not public._property_document_session_active() or public.user_has_active_workspace(actor,'personal') is distinct from true then
  raise exception 'A trusted active Personal account is required' using errcode='42501';end if;
 select * into g from public.shared_housing_groups where id=p_group_id for update;
 if g.id is null or not exists(select 1 from public.shared_housing_members where group_id=p_group_id and user_id=actor) then
  raise exception 'Shared-payment access required' using errcode='42501';end if;
 if exists(select 1 from public.shared_housing_members member where member.group_id=p_group_id
  and public.user_has_active_workspace(member.user_id,'personal') is distinct from true) then raise exception 'A participant is no longer eligible for this shared payment';end if;
 result:=private.create_shared_housing_payment_recorded(p_group_id);
 if g.product_type='long_let' and g.payment_phase='contract_rent' and result->>'reference' is not null then
  select id into payment_id from public.booking_payments where paystack_reference=result->>'reference';
  perform private.capture_shared_rent_checkout(payment_id);
 end if;
 return result;
end $$;

create function private.guard_shared_rent_payment_snapshot() returns trigger
language plpgsql security definer set search_path='' as $$
declare key text;
begin
 if old.purpose='shared_housing_share' and old.metadata->'rent_agreement_snapshot' is not null then
  foreach key in array array['shared_group_id','shared_member_id','legacy_shared_member_id','canonical_shared_payment_group_id',
   'canonical_shared_payment_member_id','canonical_product_type','payment_phase','checkout_attempt','eligible_partner_amount','refundable_amount','reservation_id','rent_agreement_snapshot'] loop
   if new.metadata->key is distinct from old.metadata->key then raise exception 'Accepted shared rent payment identity and agreement are immutable';end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function private.guard_shared_rent_payment_snapshot() from public,anon,authenticated;
create trigger shared_rent_payment_snapshot before update on public.booking_payments for each row execute function private.guard_shared_rent_payment_snapshot();

create function private.create_shared_long_let_protection(p_payment_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.booking_payments;q jsonb;protection public.payment_protection_transactions;subject text;group_id uuid;member_id uuid;
begin
 select * into p from public.booking_payments where id=p_payment_id;
 q:=p.metadata->'rent_agreement_snapshot';group_id:=(p.metadata->>'canonical_shared_payment_group_id')::uuid;member_id:=(p.metadata->>'canonical_shared_payment_member_id')::uuid;
 if p.purpose is distinct from 'shared_housing_share' or p.metadata->>'payment_phase' is distinct from 'contract_rent'
  or p.metadata->>'canonical_product_type' is distinct from 'long_let' or p.status not in('paid','completed')
  or p.commission_frozen_at is null or p.commission_policy_version_id is null or p.payee_user_id is null
  or q->>'accepted_by' is distinct from p.user_id or p.verified_amount is distinct from p.amount_total
  or p.amount_total is distinct from (q#>>'{rent_schedule,payments,0,amount}')::numeric
  or p.net_amount is distinct from (q#>>'{rent_schedule,payments,0,partner_net_amount}')::numeric
  or p.amount_commission is distinct from (q#>>'{rent_schedule,payments,0,wehouse_amount}')::numeric
  or p.net_amount+p.amount_commission is distinct from p.amount_total then raise exception 'Shared rent has no accepted verified allocation';end if;
 subject:='shared:'||member_id::text||':rent:'||(p.metadata->>'checkout_attempt');
 insert into public.payment_protection_transactions(booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
  amount_commission,amount_payee,commission_rate,status,paystack_reference,protection_state,subject_type,subject_id)
 values(null,'long_let_payment',p.user_id,p.payee_user_id,p.amount_total,p.amount_commission,p.net_amount,p.commission_rate,
  'protected',p.paystack_reference,'awaiting_funds','long_let_payment',subject)
 on conflict(subject_type,subject_id) do nothing;
 select * into protection from public.payment_protection_transactions where subject_type='long_let_payment' and subject_id=subject;
 if protection.paystack_reference is distinct from p.paystack_reference or protection.payer_user_id is distinct from p.user_id
  or protection.payee_user_id is distinct from p.payee_user_id or protection.amount_total is distinct from p.amount_total
  or protection.amount_commission is distinct from p.amount_commission or protection.amount_payee is distinct from p.net_amount then
  raise exception 'Shared rent protection belongs to another accepted payment';end if;
 insert into public.shared_payment_protection_components(shared_payment_group_id,shared_payment_member_id,payment_protection_id,component_type,amount,provider_reference)
 values(group_id,member_id,protection.id,'long_let_payment',p.amount_total,p.paystack_reference) on conflict(payment_protection_id) do nothing;
 return protection.id;
end $$;
revoke all on function private.create_shared_long_let_protection(uuid) from public,anon,authenticated;

-- Public shared receipts carry the person's current agreement, never an invented
-- aggregate provider charge. The existing individual payment path stays separate.
do $$declare definition text:=pg_get_functiondef('public.get_my_shared_housing_group(uuid)'::regprocedure);
 needle text:='''payment_phase'',g.payment_phase,''expires_at'',g.expires_at,';
begin
 if position(needle in definition)=0 then raise exception 'Inspect shared receipt projection before upgrading';end if;
 execute replace(definition,needle,$new$'payment_phase',g.payment_phase,'expires_at',g.expires_at,'checkout_attempt',g.checkout_attempt,'canonical_group_id',g.canonical_group_id,
    'rent_agreement',(select member.rent_agreement_snapshot from public.shared_payment_members member where member.shared_payment_group_id=g.canonical_group_id and member.user_id=v_actor),
    'tenancy_agreement',(select reservation.rent_terms_snapshot from public.reservations reservation where reservation.id=g.reservation_id),$new$);
end $$;

alter function public.create_apartment_rent_payment(text) set schema private;
alter function private.create_apartment_rent_payment(text) rename to create_individual_apartment_rent_payment;
revoke all on function private.create_individual_apartment_rent_payment(text) from public,anon,authenticated;
create function public.create_apartment_rent_payment(p_reservation_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.require_long_let_customer(p_reservation_id);
begin
 if exists(select 1 from public.reservations where id=p_reservation_id and shared_payment_group_id is not null) then
  raise exception 'Complete your accepted share from the shared booking';end if;
 return private.create_individual_apartment_rent_payment(p_reservation_id);
end $$;
revoke all on function public.create_apartment_rent_payment(text) from public,anon;
grant execute on function public.create_apartment_rent_payment(text) to authenticated,service_role;

do $patch$
declare definition text:=pg_get_functiondef('private.create_later_rent_payment(uuid,text)'::regprocedure);
begin
 if position($before$where id=c.reservation_id and user_id=actor for share;$before$ in definition)=0 then raise exception 'Inspect shared rent integration: private.create_later_rent_payment(uuid,text) step 1';end if;
 definition:=replace(definition,$before$where id=c.reservation_id and user_id=actor for share;$before$,$after$where id=c.reservation_id for share;$after$);
 if position($before$q:=r.rent_terms_snapshot;$before$ in definition)=0 then raise exception 'Inspect shared rent integration: private.create_later_rent_payment(uuid,text) step 2';end if;
 definition:=replace(definition,$before$q:=r.rent_terms_snapshot;$before$,$after$q:=private.long_let_plan_agreement(plan.id);$after$);
 if position($before$ if not exists(select 1 from public.booking_payments initial where initial.paystack_reference=r.rent_payment_reference
  and initial.purpose='apartment_rent' and initial.status in('paid','completed')
  and coalesce(initial.amount_total,initial.amount)=(q->'rent_schedule'->>'due_before_handover')::numeric)
  or (q->'rent_schedule'->>'due_before_handover')::numeric is distinct from (q->'rent_schedule'->>'first_year_rent')::numeric then
  raise exception 'Year 1 must have been paid in full before monthly collection';end if;
$before$ in definition)=0 then raise exception 'Inspect shared rent integration: private.create_later_rent_payment(uuid,text) step 3';end if;
 definition:=replace(definition,$before$ if not exists(select 1 from public.booking_payments initial where initial.paystack_reference=r.rent_payment_reference
  and initial.purpose='apartment_rent' and initial.status in('paid','completed')
  and coalesce(initial.amount_total,initial.amount)=(q->'rent_schedule'->>'due_before_handover')::numeric)
  or (q->'rent_schedule'->>'due_before_handover')::numeric is distinct from (q->'rent_schedule'->>'first_year_rent')::numeric then
  raise exception 'Year 1 must have been paid in full before monthly collection';end if;
$before$,$after$ if r.shared_payment_group_id is null then
 if not exists(select 1 from public.booking_payments initial where initial.paystack_reference=r.rent_payment_reference
  and initial.purpose='apartment_rent' and initial.status in('paid','completed')
  and coalesce(initial.amount_total,initial.amount)=(q->'rent_schedule'->>'due_before_handover')::numeric)
  or (q->'rent_schedule'->>'due_before_handover')::numeric is distinct from (q->'rent_schedule'->>'first_year_rent')::numeric then
  raise exception 'Year 1 must have been paid in full before monthly collection';end if;
 else
  if not private.shared_long_let_initial_rent_confirmed(r.id)
   or (q#>>'{rent_schedule,due_before_handover}')::numeric is distinct from (q#>>'{rent_schedule,first_year_rent}')::numeric then
   raise exception 'Every payer must complete Year 1 before later-year collection';end if;
 end if;
$after$);
 execute definition;
end $patch$;
do $patch$
declare definition text:=pg_get_functiondef('validate_later_rent_checkout(uuid,text)'::regprocedure);
begin
 if position($before$r.rent_terms_snapshot->>'quote_digest'$before$ in definition)=0 then raise exception 'Inspect shared rent integration: validate_later_rent_checkout(uuid,text) step 1';end if;
 definition:=replace(definition,$before$r.rent_terms_snapshot->>'quote_digest'$before$,$after$private.long_let_plan_agreement(plan.id)->>'quote_digest'$after$);
 execute definition;
end $patch$;
do $patch$
declare definition text:=pg_get_functiondef('private.validate_later_rent_receipt(uuid,text,bigint)'::regprocedure);
begin
 if position($before$part:=r.rent_terms_snapshot#>array['rent_schedule','payments',(c.agreement_sequence-1)::text];$before$ in definition)=0 then raise exception 'Inspect shared rent integration: private.validate_later_rent_receipt(uuid,text,bigint) step 1';end if;
 definition:=replace(definition,$before$part:=r.rent_terms_snapshot#>array['rent_schedule','payments',(c.agreement_sequence-1)::text];$before$,$after$part:=private.long_let_plan_agreement(plan.id)#>array['rent_schedule','payments',(c.agreement_sequence-1)::text];$after$);
 if position($before$r.rent_terms_snapshot->>'quote_digest'$before$ in definition)=0 then raise exception 'Inspect shared rent integration: private.validate_later_rent_receipt(uuid,text,bigint) step 2';end if;
 definition:=replace(definition,$before$r.rent_terms_snapshot->>'quote_digest'$before$,$after$private.long_let_plan_agreement(plan.id)->>'quote_digest'$after$);
 execute definition;
end $patch$;
do $patch$
declare definition text:=pg_get_functiondef('prepare_my_later_rent_debit(text,text,boolean)'::regprocedure);
begin
 if position($before$or (bp.purpose='rent_plan_contribution' and bp.metadata->>'rent_plan_id'=plan.id::text))$before$ in definition)=0 then raise exception 'Inspect shared rent integration: prepare_my_later_rent_debit(text,text,boolean) step 1';end if;
 definition:=replace(definition,$before$or (bp.purpose='rent_plan_contribution' and bp.metadata->>'rent_plan_id'=plan.id::text))$before$,$after$or (bp.purpose='rent_plan_contribution' and bp.metadata->>'rent_plan_id'=plan.id::text)
    or (bp.purpose='shared_housing_share' and bp.paystack_reference=plan.accepted_terms::jsonb->>'initial_payment_reference'
      and bp.metadata->>'payment_phase'='contract_rent' and bp.metadata->>'canonical_product_type'='long_let'))$after$);
 execute definition;
end $patch$;
do $patch$
declare definition text:=pg_get_functiondef('process_verified_paystack_charge(text,text,text,text,timestamp with time zone,bigint,text,text)'::regprocedure);
begin
 if position($before$    elsif v_payment.purpose='shared_housing_share'
      and coalesce(v_payment.metadata->>'payment_phase','')<>'reservation_fee' then$before$ in definition)=0 then raise exception 'Inspect shared rent integration: process_verified_paystack_charge(text,text,text,text,timestamp with time zone,bigint,text,text) step 1';end if;
 definition:=replace(definition,$before$    elsif v_payment.purpose='shared_housing_share'
      and coalesce(v_payment.metadata->>'payment_phase','')<>'reservation_fee' then$before$,$after$    elsif v_payment.purpose='shared_housing_share' and v_payment.metadata->>'canonical_product_type'='long_let'
      and v_payment.metadata->>'payment_phase'='contract_rent' then
      perform private.create_shared_long_let_protection(v_payment.id);
    elsif v_payment.purpose='shared_housing_share'
      and coalesce(v_payment.metadata->>'payment_phase','')<>'reservation_fee' then$after$);
 if position($before$'long_let_year_one','short_let_stay'$before$ in definition)=0 then raise exception 'Inspect shared rent integration: process_verified_paystack_charge(text,text,text,text,timestamp with time zone,bigint,text,text) step 2';end if;
 definition:=replace(definition,$before$'long_let_year_one','short_let_stay'$before$,$after$'long_let_year_one','long_let_payment','short_let_stay'$after$);
 if position($before$    return jsonb_build_object(
      'success',true,'provider_event_id',v_event.provider_event_id,$before$ in definition)=0 then raise exception 'Inspect shared rent integration: process_verified_paystack_charge(text,text,text,text,timestamp with time zone,bigint,text,text) step 3';end if;
 definition:=replace(definition,$before$    return jsonb_build_object(
      'success',true,'provider_event_id',v_event.provider_event_id,$before$,$after$    if v_payment.purpose='shared_housing_share' and v_payment.metadata->>'canonical_product_type'='long_let'
      and v_payment.metadata->>'payment_phase'='contract_rent' and exists(select 1 from public.shared_payment_groups
       where shared_payment_group_id=(v_payment.metadata->>'canonical_shared_payment_group_id')::uuid and status='fully_paid') then
      perform private.sync_shared_long_let_plans(v_payment.metadata->>'reservation_id',null);
    end if;
    if v_payment.purpose='shared_housing_share' and coalesce((v_result->>'refund_required')::boolean,false) then
      perform public.expire_shared_payment_checkout_from_service((v_payment.metadata->>'shared_group_id')::uuid);
    end if;
    return jsonb_build_object(
      'success',true,'provider_event_id',v_event.provider_event_id,$after$);
 execute definition;
end $patch$;
do $patch$
declare definition text:=pg_get_functiondef('confirm_shared_housing_payment(text,text,numeric)'::regprocedure);
begin
 if position($before$      v_reservation_id:=gen_random_uuid()::text;$before$ in definition)=0 then raise exception 'Inspect shared rent integration: confirm_shared_housing_payment(text,text,numeric) step 1';end if;
 definition:=replace(definition,$before$      v_reservation_id:=gen_random_uuid()::text;$before$,$after$      if v_listing.status is distinct from 'available' or v_listing.availability_status is distinct from 'available' then
        update public.shared_housing_groups set status='refunding',expires_at=now(),updated_at=now() where id=v_group.id;
        update public.shared_payment_groups set status='refunding',checkout_expires_at=now(),updated_at=now() where shared_payment_group_id=v_group.canonical_group_id;
        return jsonb_build_object('success',true,'group_id',v_group.id,'refund_required',true,'conflict',true);
      end if;
      v_reservation_id:=gen_random_uuid()::text;$after$);
 if position($before$      update public.reservations set rent_payment_status='paid',rent_paid_at=now(),updated_at=now()
      where id=v_group.reservation_id;$before$ in definition)=0 then raise exception 'Inspect shared rent integration: confirm_shared_housing_payment(text,text,numeric) step 2';end if;
 definition:=replace(definition,$before$      update public.reservations set rent_payment_status='paid',rent_paid_at=now(),updated_at=now()
      where id=v_group.reservation_id;$before$,$after$      if v_group.product_type<>'long_let' or v_group.payment_phase<>'contract_rent'
        or v_payment.metadata->'rent_agreement_snapshot' is null then raise exception 'Accepted shared rent contract is missing';end if;
      update public.reservations set rent_payment_status=case when installment_balance>0 then 'upfront_paid' else 'paid' end,
        rent_paid_at=now(),status='ready_for_move_in',updated_at=now() where id=v_group.reservation_id;$after$);
 execute definition;
end $patch$;

drop function public.get_my_later_rent_history(text,integer,integer);
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
 select * into plan from public.rent_plans where reservation_id=r.id and status<>'cancelled' and ((is_customer and user_id=actor) or (not is_customer and ((p_plan_id is not null and id=p_plan_id) or (p_plan_id is null and r.shared_payment_group_id is null and user_id=r.user_id)))) order by created_at desc limit 1;
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

revoke all on function public.get_my_later_rent_history(text,integer,integer,uuid) from public,anon;
grant execute on function public.get_my_later_rent_history(text,integer,integer,uuid) to authenticated;

do $patch$
declare definition text:=pg_get_functiondef('validate_paid_accommodation_snapshot()'::regprocedure);
begin
 if position($before$  if v_group.product_type='short_let' then$before$ in definition)=0 then raise exception 'Inspect shared financial integration: step 1 validate_paid_accommodation_snapshot()';end if;
 definition:=replace(definition,$before$  if v_group.product_type='short_let' then$before$,$after$  if v_group.product_type='long_let' and v_group.payment_phase='contract_rent' then
    select * into v_reservation from public.reservations where id=v_group.reservation_id for share;
    if v_reservation.id is null or v_reservation.shared_payment_group_id is distinct from v_group.shared_payment_group_id
      or new.metadata->'rent_agreement_snapshot' is distinct from v_member.rent_agreement_snapshot
      or v_member.rent_agreement_snapshot->>'accepted_by' is distinct from v_member.user_id
      or v_member.rent_agreement_snapshot->>'parent_agreement_digest' is distinct from v_reservation.rent_terms_snapshot->>'quote_digest'
      or new.commission_frozen_at is null or new.commission_policy_version_id is null
      or new.amount_total is distinct from (v_member.rent_agreement_snapshot#>>'{rent_schedule,payments,0,amount}')::numeric
      or new.net_amount is distinct from (v_member.rent_agreement_snapshot#>>'{rent_schedule,payments,0,partner_net_amount}')::numeric
      or new.amount_commission is distinct from (v_member.rent_agreement_snapshot#>>'{rent_schedule,payments,0,wehouse_amount}')::numeric
      or new.amount_commission+new.net_amount is distinct from new.amount_total then
      raise exception 'Shared rent does not match the payer accepted agreement';end if;
  end if;
  if v_group.product_type='short_let' then$after$);
 execute definition;
end $patch$;
do $patch$
declare definition text:=pg_get_functiondef('enqueue_due_canonical_financial_actions(integer)'::regprocedure);
begin
 if position($before$  v_silent integer:=0;$before$ in definition)=0 then raise exception 'Inspect shared financial integration: step 1 enqueue_due_canonical_financial_actions(integer)';end if;
 definition:=replace(definition,$before$  v_silent integer:=0;$before$,$after$  v_silent integer:=0;v_shared_suffix text;$after$);
 if position($before$r.stay_type='short_let' and r.caution_payment_protection_id is not null$before$ in definition)=0 then raise exception 'Inspect shared financial integration: step 2 enqueue_due_canonical_financial_actions(integer)';end if;
 definition:=replace(definition,$before$r.stay_type='short_let' and r.caution_payment_protection_id is not null$before$,$after$r.stay_type='short_let' and (r.caution_payment_protection_id is not null or exists(select 1 from public.shared_payment_protection_components component where component.shared_payment_group_id=r.shared_payment_group_id and component.component_type='short_let_caution'))$after$);
 if position($before$where a.idempotency_key='caution-unclaimed-refund:'||r.id)$before$ in definition)=0 then raise exception 'Inspect shared financial integration: step 3 enqueue_due_canonical_financial_actions(integer)';end if;
 definition:=replace(definition,$before$where a.idempotency_key='caution-unclaimed-refund:'||r.id)$before$,$after$where a.idempotency_key='caution-unclaimed-refund:'||r.id or a.idempotency_key like 'caution-unclaimed-refund:'||r.id||':%')$after$);
 if position($before$    union all
    select 'release_short_let_stay','short_let',r.id,r.stay_payment_protection_id$before$ in definition)=0 then raise exception 'Inspect shared financial integration: step 4 enqueue_due_canonical_financial_actions(integer)';end if;
 definition:=replace(definition,$before$    union all
    select 'release_short_let_stay','short_let',r.id,r.stay_payment_protection_id$before$,$after$    union all
    select 'release_long_let_payment','long_let',r.id,component.payment_protection_id
    from public.reservations r join public.shared_payment_groups shared on shared.shared_payment_group_id=r.shared_payment_group_id
    join public.shared_payment_members member on member.shared_payment_group_id=shared.shared_payment_group_id
    join public.shared_payment_protection_components component on component.shared_payment_member_id=member.shared_payment_member_id
      and component.component_type='long_let_payment' and component.provider_reference=member.provider_reference
    join public.payment_protection_transactions protection on protection.id=component.payment_protection_id
    where shared.status='fully_paid' and r.verified_handover_at is not null and r.verified_handover_at+interval '24 hours'<=now()
      and protection.protection_state in('protected','release_eligible')
      and not exists(select 1 from public.operational_cases c where c.subject_type='long_let' and c.subject_id=r.id and c.status not in('resolved','closed'))
    union all
    select 'release_short_let_stay','short_let',r.id,component.payment_protection_id
    from public.reservations r join public.shared_payment_groups shared on shared.shared_payment_group_id=r.shared_payment_group_id
    join public.shared_payment_members member on member.shared_payment_group_id=shared.shared_payment_group_id
    join public.shared_payment_protection_components component on component.shared_payment_member_id=member.shared_payment_member_id
      and component.component_type='short_let_stay' and component.provider_reference=member.provider_reference
    join public.payment_protection_transactions protection on protection.id=component.payment_protection_id
    where shared.status='fully_paid' and r.checked_in_at is not null and protection.protection_state in('protected','release_eligible')
      and not exists(select 1 from public.operational_cases c where c.subject_type='short_let' and c.subject_id=r.id and c.status not in('resolved','closed'))
    union all
    select 'release_short_let_stay','short_let',r.id,r.stay_payment_protection_id$after$);
 if position($before$  loop
    if (select protection_state from public.payment_protection_transactions$before$ in definition)=0 then raise exception 'Inspect shared financial integration: step 5 enqueue_due_canonical_financial_actions(integer)';end if;
 definition:=replace(definition,$before$  loop
    if (select protection_state from public.payment_protection_transactions$before$,$after$  loop
    v_shared_suffix:=case when exists(select 1 from public.shared_payment_protection_components where payment_protection_id=v_row.protection_id) then ':'||v_row.protection_id::text else '' end;
    if (select protection_state from public.payment_protection_transactions$after$);
 if position($before$'release-eligible:'||v_row.action_type||':'||v_row.subject_id,$before$ in definition)=0 then raise exception 'Inspect shared financial integration: step 6 enqueue_due_canonical_financial_actions(integer)';end if;
 definition:=replace(definition,$before$'release-eligible:'||v_row.action_type||':'||v_row.subject_id,$before$,$after$'release-eligible:'||v_row.action_type||':'||v_row.subject_id||v_shared_suffix,$after$);
 if position($before$v_row.action_type||':'||v_row.subject_id
$before$ in definition)=0 then raise exception 'Inspect shared financial integration: step 7 enqueue_due_canonical_financial_actions(integer)';end if;
 definition:=replace(definition,$before$v_row.action_type||':'||v_row.subject_id
$before$,$after$v_row.action_type||':'||v_row.subject_id||v_shared_suffix
$after$);
 execute definition;
end $patch$;
do $patch$
declare definition text:=pg_get_functiondef('complete_internal_release_action(uuid)'::regprocedure);
begin
 if position($before$case when v_protection.subject_type='experience_booking' then v_protection.amount_commission/nullif(v_protection.amount_total,0)$before$ in definition)=0 then raise exception 'Inspect shared financial integration: step 1 complete_internal_release_action(uuid)';end if;
 definition:=replace(definition,$before$case when v_protection.subject_type='experience_booking' then v_protection.amount_commission/nullif(v_protection.amount_total,0)$before$,$after$case when v_protection.subject_type in('experience_booking','long_let_payment') then v_protection.amount_commission/nullif(v_protection.amount_total,0)$after$);
 execute definition;
end $patch$;

do $$declare definition text:=pg_get_functiondef('public.validate_shared_housing_checkout(uuid,text)'::regprocedure);
 needle text:='g.product_type=''long_let'' and g.payment_phase=''reservation_fee''';
begin
 if position(needle in definition)=0 then raise exception 'Inspect shared rent provider boundary before upgrading';end if;
 definition:=replace(definition,needle,'g.product_type=''long_let'' and g.payment_phase in(''reservation_fee'',''contract_rent'')');
 needle:='and c.total_amount=g.total_amount';
 if position(needle in definition)=0 then raise exception 'Inspect shared rent provider total guard';end if;
 definition:=replace(definition,needle,$new$and c.total_amount=g.total_amount
   and (g.payment_phase<>'contract_rent' or exists(select 1 from public.reservations reservation
    where reservation.id=g.reservation_id and reservation.shared_payment_group_id=c.shared_payment_group_id
     and payment.metadata->'rent_agreement_snapshot'=cm.rent_agreement_snapshot
     and cm.rent_agreement_snapshot->>'accepted_by'=cm.user_id and cm.rent_agreement_snapshot->>'accepted_at' is not null
     and payment.payee_user_id=reservation.rent_terms_snapshot->>'partner_user_id'
     and exists(select 1 from public.listings listing where listing.id=g.listing_id and coalesce(listing.partner_id,listing.owner_id)=payment.payee_user_id)
     and cm.rent_agreement_snapshot->>'parent_agreement_digest'=reservation.rent_terms_snapshot->>'quote_digest'
     and payment.commission_frozen_at is not null and payment.commission_policy_version_id is not null
     and payment.net_amount+payment.amount_commission=payment.amount_total
     and not exists(select 1 from public.shared_payment_members participant where participant.shared_payment_group_id=c.shared_payment_group_id
      and (participant.rent_agreement_snapshot->>'accepted_by' is distinct from participant.user_id
       or participant.rent_agreement_snapshot->>'parent_agreement_digest' is distinct from reservation.rent_terms_snapshot->>'quote_digest'))))$new$);
 execute definition;
end $$;

CREATE OR REPLACE FUNCTION public.fulfill_rent_plan_contribution_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_contribution public.rent_plan_contributions;
  v_plan public.rent_plans;
  v_paid_total numeric;
  v_paid_count integer;
  v_remaining integer;
  v_next_due date;
BEGIN
  IF NEW.purpose<>'rent_plan_contribution' OR NEW.status NOT IN ('paid','completed') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('paid','completed') THEN RETURN NEW; END IF;

  SELECT * INTO v_contribution
  FROM public.rent_plan_contributions
  WHERE id=(NEW.metadata->>'contribution_id')::uuid
  FOR UPDATE;
  IF v_contribution.id IS NULL THEN RAISE EXCEPTION 'Rent contribution payment has no schedule row'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('rent-settlement:'||v_contribution.reservation_id,0));
  IF v_contribution.paystack_reference IS DISTINCT FROM NEW.paystack_reference THEN RAISE EXCEPTION 'Rent contribution reference mismatch'; END IF;
  IF round(v_contribution.amount,2)<>round(COALESCE(NEW.amount_total,NEW.amount),2) THEN RAISE EXCEPTION 'Rent contribution amount mismatch'; END IF;

  UPDATE public.rent_plan_contributions
  SET status='paid',paid_at=COALESCE(paid_at,now()),completed_at=COALESCE(completed_at,now()),updated_at=now()
  WHERE id=v_contribution.id;

  SELECT * INTO v_plan
  FROM public.rent_plans
  WHERE id=v_contribution.rent_plan_id
  FOR UPDATE;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'Rent plan not found'; END IF;

  SELECT COALESCE(sum(amount),0),count(*)::integer
  INTO v_paid_total,v_paid_count
  FROM public.rent_plan_contributions
  WHERE rent_plan_id=v_plan.id AND status IN ('paid','completed');

  SELECT count(*)::integer,min(due_date)
  INTO v_remaining,v_next_due
  FROM public.rent_plan_contributions
  WHERE rent_plan_id=v_plan.id AND status IN ('scheduled','payment_pending','pending');

  UPDATE public.rent_plans
  SET total_contributed=v_paid_total,
      paid_installments=v_paid_count,
      installment_balance=GREATEST(COALESCE(target_amount,0)-v_paid_total,0),
      last_contribution_at=now(),
      next_rent_due_date=v_next_due,
      status=CASE WHEN v_remaining=0 THEN 'completed' ELSE 'active' END,
      updated_at=now()
  WHERE id=v_plan.id;

  IF v_remaining=0 AND NOT EXISTS(SELECT 1 FROM public.rent_plans other_plan
    JOIN public.rent_plan_contributions other_payment ON other_payment.rent_plan_id=other_plan.id
    WHERE other_plan.reservation_id=v_plan.reservation_id AND other_plan.status<>'cancelled'
      AND other_payment.status NOT IN('paid','completed')) THEN
    UPDATE public.reservations
    SET rent_payment_status='paid',updated_at=now()
    WHERE id=v_plan.reservation_id;
  END IF;
  RETURN NEW;
END;
$function$;

create unique index rent_plans_one_individual_per_reservation on public.rent_plans(reservation_id)
 where reservation_id is not null and shared_payment_member_id is null and status<>'cancelled';
create function private.guard_shared_rent_plan_identity() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.reservations;m public.shared_payment_members;
begin
 select * into r from public.reservations where id=new.reservation_id;
 if new.reservation_id is null then return new;end if;
 if r.id is null or new.listing_id::text is distinct from r.listing_id then raise exception 'Rent plan reservation unavailable';end if;
 if r.shared_payment_group_id is null then
  if new.shared_payment_member_id is not null or new.user_id is distinct from r.user_id then raise exception 'Individual rent plan identity mismatch';end if;
 else
  select * into m from public.shared_payment_members where shared_payment_member_id=new.shared_payment_member_id
   and shared_payment_group_id=r.shared_payment_group_id and user_id=new.user_id;
  if m.shared_payment_member_id is null or m.rent_agreement_snapshot->>'accepted_by' is distinct from new.user_id
   or new.accepted_terms::jsonb is distinct from m.rent_agreement_snapshot||jsonb_build_object('initial_payment_reference',m.provider_reference) then
   raise exception 'Shared rent plan must contain only the named payer accepted obligation';end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_shared_rent_plan_identity() from public,anon,authenticated;
create trigger shared_rent_plan_identity before insert or update of user_id,listing_id,reservation_id,shared_payment_member_id,accepted_terms
 on public.rent_plans for each row execute function private.guard_shared_rent_plan_identity();

do $$declare definition text:=pg_get_functiondef('public.complete_internal_release_action(uuid)'::regprocedure);
 needle text:='  if v_protection.protection_state not in(';
begin
 if position(needle in definition)=0 then raise exception 'Inspect current release boundary before upgrading';end if;
 definition:=replace(definition,needle,$new$  if v_action.action_type in('release_long_let_payment','release_short_let_stay') then
    if v_protection.protection_state is distinct from 'release_eligible' then raise exception 'The accommodation payment is no longer eligible for automatic release';end if;
    if exists(select 1 from public.reservations reservation join public.operational_cases issue
      on ((issue.subject_type in('long_let','short_let') and issue.subject_id=reservation.id)
       or (issue.subject_type='shared_payment' and issue.subject_id=reservation.shared_payment_group_id::text))
      where reservation.id=v_action.subject_id and issue.status not in('resolved','closed')) then
      raise exception 'An open booking or shared-payment case blocks release';end if;
  end if;
  if v_protection.protection_state not in($new$);
 execute definition;
end $$;

create function private.enqueue_later_rent_payment_notices(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare item record;kind text;key text;event_id uuid;counted integer:=0;subject text;subject_id text;
begin
 for item in select c.id,c.reservation_id,c.target_year,c.due_date,plan.user_id,r.shared_payment_group_id,
   r.listing_id,l.title,coalesce(l.partner_id,l.owner_id) owner_id,l.state
  from public.rent_plan_contributions c join public.rent_plans plan on plan.id=c.rent_plan_id
  join public.reservations r on r.id=plan.reservation_id join public.listings l on l.id::text=r.listing_id
  where c.status in('scheduled','pending') and plan.status='active' and r.status='occupied'
   and r.rent_terms_snapshot->>'schema_version'='1' and c.due_date<=(now() at time zone 'Africa/Lagos')::date
   and not exists(select 1 from public.rent_plan_contributions earlier where earlier.rent_plan_id=plan.id
    and earlier.agreement_sequence<c.agreement_sequence and earlier.status not in('paid','completed'))
   and not exists(select 1 from public.activity_events e where e.event_key='rent-notice:'||c.id::text||':'||
    case when c.due_date<(now() at time zone 'Africa/Lagos')::date then 'overdue' else 'due' end||':personal')
  order by c.due_date,c.id limit least(greatest(coalesce(p_limit,100),1),100)
 loop
  kind:=case when item.due_date<(now() at time zone 'Africa/Lagos')::date then 'overdue' else 'due' end;
  subject:=case when item.shared_payment_group_id is null then 'reservation' else 'shared_payment' end;
  subject_id:=coalesce(item.shared_payment_group_id::text,item.reservation_id);
  key:='rent-notice:'||item.id||':'||kind;
  event_id:=private.upsert_activity_event(key||':personal','rent.payment_'||case when kind='due' then 'required' else 'overdue' end,
   subject,subject_id,null,case when kind='due' then 'Your scheduled rent contribution is due' else 'Your rent contribution is overdue' end,
   'This contribution funds Year '||item.target_year||'. Review your agreed share, payment status and rent credit. Earlier verified payments are retained.',
   'my_reservations',jsonb_build_object('reservation_id',item.reservation_id,'contribution_id',item.id),now());
  perform private.add_activity_audience(event_id,item.user_id,'personal','property',item.state,true);
  if kind='overdue' and item.owner_id is not null then
   event_id:=private.upsert_activity_event(key||':partner','rent.partner_payment_overdue','listing',item.listing_id,null,
    'A later-rent contribution is overdue',coalesce(item.title,'Home')||' · Review the recorded payer balances. No other payer is automatically charged.',
    'property_partner',jsonb_build_object('listing_id',item.listing_id),now());
   perform private.add_activity_audience(event_id,item.owner_id,'partner','property',item.state,true);
  end if;
  counted:=counted+1;
 end loop;
 return counted;
end $$;
revoke all on function private.enqueue_later_rent_payment_notices(integer) from public,anon,authenticated;

create function private.notify_later_rent_payment_received() returns trigger
language plpgsql security definer set search_path='' as $$
declare plan public.rent_plans;r public.reservations;l public.listings;event_id uuid;
begin
 if new.status not in('paid','completed') or old.status in('paid','completed') then return new;end if;
 select * into plan from public.rent_plans where id=new.rent_plan_id;
 select * into r from public.reservations where id=plan.reservation_id;
 select * into l from public.listings where id::text=r.listing_id;
 update public.activity_event_audiences audience set resolved_at=coalesce(resolved_at,now()) from public.activity_events event
  where event.activity_event_id=audience.activity_event_id and event.event_key in(
   'rent-notice:'||new.id||':due:personal','rent-notice:'||new.id||':overdue:personal','rent-notice:'||new.id||':overdue:partner');
 event_id:=private.upsert_activity_event('rent-received:'||new.id||':personal','rent.payment_received',
  case when r.shared_payment_group_id is null then 'reservation' else 'shared_payment' end,
  coalesce(r.shared_payment_group_id::text,r.id),null,'Your scheduled rent payment is confirmed',
  'Your verified gross payment funds the accepted target year. Partner settlement is tracked separately.',
  'my_reservations',jsonb_build_object('reservation_id',r.id,'contribution_id',new.id),now());
 perform private.add_activity_audience(event_id,plan.user_id,'personal','property',l.state,false);
 if coalesce(l.partner_id,l.owner_id) is not null then
  event_id:=private.upsert_activity_event('rent-received:'||new.id||':partner','rent.partner_payment_received','listing',r.listing_id,null,
   'A scheduled rent payment is confirmed',coalesce(l.title,'Home')||' · Open rent accounts for the payer receipt, combined rent and settlement status.',
   'property_partner',jsonb_build_object('listing_id',r.listing_id),now());
  perform private.add_activity_audience(event_id,coalesce(l.partner_id,l.owner_id),'partner','property',l.state,false);
 end if;
 return new;
end $$;
revoke all on function private.notify_later_rent_payment_received() from public,anon,authenticated;
create trigger later_rent_payment_received after update of status on public.rent_plan_contributions
 for each row execute function private.notify_later_rent_payment_received();

do $$declare definition text:=pg_get_functiondef('public.enqueue_due_canonical_financial_actions(integer)'::regprocedure);
 needle text:='  perform public.activate_due_creator_policy_versions();';
begin
 if position(needle in definition)=0 then raise exception 'Inspect existing scheduler before attaching rent notices';end if;
 execute replace(definition,needle,needle||chr(10)||'  perform private.enqueue_later_rent_payment_notices(p_limit);');
end $$;

create function private.shared_later_rent_summary(p_reservation_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 with recorded as (
  select c.amount,c.status,c.due_date,plan.shared_payment_member_id,
   (c.status in('paid','completed') and payment.status in('paid','completed') and payment.verified_at is not null
    and payment.verified_amount=c.amount and payment.user_id=plan.user_id
    and exists(select 1 from public.verified_provider_events event where event.provider='paystack' and event.event_type='charge.success'
     and event.provider_reference=payment.paystack_reference and event.processing_status='processed')) as verified
  from public.rent_plans plan join public.rent_plan_contributions c on c.rent_plan_id=plan.id
  left join public.booking_payments payment on payment.paystack_reference=c.paystack_reference and payment.purpose='rent_plan_contribution'
   and payment.metadata->>'contribution_id'=c.id::text
  where plan.reservation_id=p_reservation_id and plan.shared_payment_member_id is not null
 ) select jsonb_build_object('group_id',reservation.shared_payment_group_id,'currency','NGN',
   'payer_count',(select count(distinct shared_payment_member_id) from recorded),
   'total_received',(select coalesce(sum(amount) filter(where verified),0) from recorded),
   'remaining_scheduled_rent',(select coalesce(sum(amount) filter(where not coalesce(verified,false)),0) from recorded),
   'overdue_amount',(select coalesce(sum(amount) filter(where status in('scheduled','pending') and due_date<(now() at time zone 'Africa/Lagos')::date),0) from recorded))
 from public.reservations reservation where reservation.id=p_reservation_id and reservation.shared_payment_group_id is not null;
$$;
revoke all on function private.shared_later_rent_summary(text) from public,anon,authenticated;
do $$declare definition text:=pg_get_functiondef('public.get_my_property_later_rent_accounts(uuid,uuid,integer)'::regprocedure);
 needle text:='coalesce(p.full_name,''Tenant'') tenant_name,plan.status';
begin
 if position(needle in definition)=0 then raise exception 'Inspect Partner rent account projection before upgrading';end if;
 execute replace(definition,needle,needle||',private.shared_later_rent_summary(plan.reservation_id) shared_summary');
end $$;

create function private.notify_shared_rent_invitation() returns trigger
language plpgsql security definer set search_path='' as $$
declare g public.shared_payment_groups;event_id uuid;event_key text;
begin
 select * into g from public.shared_payment_groups where shared_payment_group_id=new.shared_payment_group_id;
 if g.product_type<>'long_let' then return new;end if;
 event_key:='shared-rent-invite:'||new.shared_payment_member_id||':'||g.checkout_attempt;
 if new.invitation_state='invited' and (tg_op='INSERT' or old.invitation_state is distinct from new.invitation_state) then
  event_id:=private.upsert_activity_event(event_key,'shared.rent_invitation','shared_payment',g.shared_payment_group_id::text,g.created_by,
   case when g.payment_phase='contract_rent' then 'Review your shared rental agreement' else 'You have a shared Long Let invitation' end,
   'Review the property, accepted term and your own share. An invitation does not start payment or automatic debit.',
   'my_reservations',jsonb_build_object('booking_id',coalesce(g.legacy_group_id,g.shared_payment_group_id)::text),now());
  perform private.add_activity_audience(event_id,new.user_id,'personal','property',null,true);
 elsif new.invitation_state in('accepted','declined','removed') then
  update public.activity_event_audiences audience set resolved_at=coalesce(audience.resolved_at,now()) from public.activity_events event
   where event.activity_event_id=audience.activity_event_id and event.event_key=event_key;
 end if;
 return new;
end $$;
revoke all on function private.notify_shared_rent_invitation() from public,anon,authenticated;
create trigger shared_rent_invitation after insert or update of invitation_state on public.shared_payment_members
 for each row execute function private.notify_shared_rent_invitation();

create function private.resolve_shared_rent_invitations() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status in('expired','cancelled','refunding','refunded','fully_paid') then
  perform private.resolve_subject_activity('shared_payment',new.shared_payment_group_id::text,'shared.rent_invitation',null);
 end if;
 return new;
end $$;
revoke all on function private.resolve_shared_rent_invitations() from public,anon,authenticated;
create trigger shared_rent_invitations_resolved after update of status on public.shared_payment_groups
 for each row execute function private.resolve_shared_rent_invitations();

commit;
