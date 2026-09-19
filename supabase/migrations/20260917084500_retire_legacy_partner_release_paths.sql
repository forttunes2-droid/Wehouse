-- One authority for Property Partner earnings: canonical Payment Protection
-- release -> financial action outbox -> ledger -> available wallet.

-- Legacy hotel-completion wallet release must never race the canonical release.
drop trigger if exists hotel_booking_release_partner_earning on public.hotel_bookings;

create or replace function public.release_completed_hotel_partner_earning()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Compatibility no-op. Canonical Payment Protection owns release authority.
  return new;
end;
$$;

revoke all on function public.release_completed_hotel_partner_earning() from public, anon, authenticated;
grant execute on function public.release_completed_hotel_partner_earning() to service_role;

-- Older handover code still calls this helper for historical pending rows.
-- It must not credit money and must not abort an otherwise-valid handover.
create or replace function public.release_property_partner_earning(
  p_payment_id uuid,
  p_release_event text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform p_payment_id;
  perform p_release_event;
  return jsonb_build_object(
    'success', false,
    'legacy_disabled', true,
    'message', 'Canonical Payment Protection release owns supplier availability'
  );
end;
$$;

revoke all on function public.release_property_partner_earning(uuid,text) from public, anon, authenticated;
grant execute on function public.release_property_partner_earning(uuid,text) to service_role;

-- If a historical pending-earning row exists for the same payment, the
-- canonical projector's compatibility upsert can temporarily contain
-- old_pending + canonical_payee. Normalize it after the canonical projector
-- has run, and move only the historical portion out of pending_balance.
create or replace function public.normalize_canonical_partner_earning()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_receipt public.canonical_wallet_release_receipts;
  v_protection public.payment_protection_transactions;
  v_payment public.booking_payments;
  v_earning public.property_partner_earning_releases;
  v_wallet public.wallets;
  v_legacy_pending numeric(12,2);
begin
  if new.status <> 'completed'
     or coalesce(old.status,'') = 'completed'
     or new.action_type not like 'release_%' then
    return new;
  end if;

  select * into v_receipt
  from public.canonical_wallet_release_receipts
  where financial_action_id = new.financial_action_id;
  if v_receipt.financial_action_id is null then return new; end if;

  select * into v_protection
  from public.payment_protection_transactions
  where id = v_receipt.payment_protection_id;
  if v_protection.id is null or v_protection.subject_type = 'worker_booking' then
    return new;
  end if;

  select * into v_payment
  from public.booking_payments
  where paystack_reference = v_protection.paystack_reference
  order by created_at desc
  limit 1;
  if v_payment.id is null then return new; end if;

  select * into v_earning
  from public.property_partner_earning_releases
  where payment_id = v_payment.id
  for update;
  if v_earning.id is null
     or v_earning.release_event <> 'canonical_payment_protection_release' then
    return new;
  end if;

  v_legacy_pending := round(greatest(
    coalesce(v_earning.net_amount,0) - coalesce(v_receipt.payee_amount,0),
    0
  ),2);

  if v_legacy_pending > 0 then
    select * into v_wallet
    from public.wallets
    where owner_id = v_earning.partner_id
      and owner_type = 'property_partner'
    for update;
    if v_wallet.id is null
       or coalesce(v_wallet.pending_balance,0) < v_legacy_pending then
      raise exception 'Legacy Partner pending balance is inconsistent; canonical release requires Finance review';
    end if;
    update public.wallets
    set pending_balance = pending_balance - v_legacy_pending,
        updated_at = now()
    where id = v_wallet.id;
  end if;

  update public.property_partner_earning_releases
  set status = 'available',
      net_amount = v_receipt.payee_amount,
      release_event = 'canonical_payment_protection_release',
      released_by = 'finance_processor',
      released_at = coalesce(released_at,now()),
      updated_at = now()
  where id = v_earning.id;

  return new;
end;
$$;

revoke all on function public.normalize_canonical_partner_earning() from public, anon, authenticated;
grant execute on function public.normalize_canonical_partner_earning() to service_role;

drop trigger if exists zz_normalize_canonical_partner_earning on public.financial_action_outbox;
create trigger zz_normalize_canonical_partner_earning
after update of status on public.financial_action_outbox
for each row
when (new.status = 'completed' and old.status is distinct from new.status)
execute function public.normalize_canonical_partner_earning();

-- WeHouse Operations also follows the address-only human-location rule.
-- Technical visit coordinates stay in the underlying inspection record and
-- are not returned to the human-facing property pipeline projection.
create or replace function public.get_my_property_pipeline_v2(p_stage text default 'all')
returns jsonb
language sql
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(
    (
      item
      - 'gps_latitude'
      - 'gps_longitude'
      - 'location_accuracy_m'
      - 'latitude'
      - 'longitude'
      - 'accuracy'
    ) || jsonb_build_object(
      'property_display_name',ir.property_display_name,
      'submission_schema_version',ir.submission_schema_version,
      'submission_batch_id',ir.submission_batch_id,
      'hotel_program',coalesce(ir.hotel_program,'{}'::jsonb),
      'lifecycle_stage',ir.lifecycle_stage,
      'field_evidence_review_status',ir.field_evidence_review_status,
      'field_evidence_reviewed_by',ir.field_evidence_reviewed_by,
      'field_evidence_reviewed_at',ir.field_evidence_reviewed_at,
      'field_evidence_review_note',ir.field_evidence_review_note,
      'final_media_reviewed_at',ir.final_media_reviewed_at,
      'final_media_reviewed_by',ir.final_media_reviewed_by,
      'final_media_sources',ir.final_media_sources,
      'final_hotel_media_sources',ir.final_hotel_media_sources,
      'final_room_media_sources',ir.final_room_media_sources
    ) order by (item->>'created_at')::timestamptz desc
  ),'[]'::jsonb)
  from jsonb_array_elements(public.get_my_property_pipeline('all')) item
  join public.inspection_requests ir on ir.id=(item->>'id')::uuid
  where p_stage='all'
    or (p_stage='new' and ir.lifecycle_stage in ('access_required','access_review','inspection_ready'))
    or (p_stage='inspection' and ir.lifecycle_stage='inspection')
    or (p_stage='review' and ir.lifecycle_stage='awaiting_review')
    or (p_stage='ready' and ir.lifecycle_stage='ready_to_prepare')
    or (p_stage='preparing' and ir.lifecycle_stage='listing_prepared')
    or (p_stage='published' and ir.lifecycle_stage='live')
    or (p_stage='rejected' and ir.lifecycle_stage in ('changes_requested','rejected'));
$$;
