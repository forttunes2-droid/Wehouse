-- One wallet may have one payout awaiting Finance or Paystack at a time.
-- The wallet row is locked by the request RPCs. This index is the durable
-- backstop for concurrent devices, lost responses and legacy RPC callers.
-- Finalized payouts do not block a later request.
create unique index if not exists withdrawals_one_open_per_wallet
  on public.withdrawals (wallet_id)
  where status in ('awaiting_review', 'processing');

-- A profile can own both a Worker wallet and a Property Partner wallet.
-- Attribute each movement to its actual wallet so workspace history never
-- depends on the profile alone. Existing movements retain their provenance.
alter table public.wallet_transactions add column if not exists wallet_id uuid
  references public.wallets(id);

create or replace function public.attribute_wallet_transaction() returns trigger
language plpgsql set search_path = public as $$
declare
  v_owner text;
  v_type text;
  v_protection_id uuid;
begin
  if new.wallet_id is null and new.metadata->>'wallet_id' ~* '^[0-9a-f-]{36}$' then
    new.wallet_id := (new.metadata->>'wallet_id')::uuid;
  end if;

  if new.wallet_id is null and new.reference_type = 'withdrawal'
      and new.reference_id ~* '^[0-9a-f-]{36}$' then
    select wallet_id into new.wallet_id from public.withdrawals
    where id = new.reference_id::uuid;
  end if;

  if new.wallet_id is null then
    if new.transaction_type = 'canonical_protected_release' then
      v_protection_id := (new.metadata->>'payment_protection_id')::uuid;
      select case when subject_type = 'worker_booking' then 'worker'
        else 'property_partner' end into v_type
      from public.payment_protection_transactions where id = v_protection_id;
    elsif new.transaction_type in ('canonical_installment_settlement',
      'property_earning_pending', 'property_earning_released',
      'property_earning_reversed') then
      v_type := 'property_partner';
    end if;
    if v_type is not null then
      select id into new.wallet_id from public.wallets
      where owner_id = new.user_id and owner_type = v_type;
    end if;
  end if;

  if new.wallet_id is null then
    raise exception 'Wallet attribution is required for transaction %', new.transaction_type;
  end if;
  select owner_id into v_owner from public.wallets where id = new.wallet_id;
  if v_owner is distinct from new.user_id then
    raise exception 'Wallet transaction owner mismatch';
  end if;
  return new;
end $$;

drop trigger if exists attribute_wallet_transaction on public.wallet_transactions;
create trigger attribute_wallet_transaction before insert or update of wallet_id
  on public.wallet_transactions for each row
  execute function public.attribute_wallet_transaction();

-- Backfill from durable receipts and withdrawal references first. The type
-- fallback covers earlier property movements created before receipt tables.
with attributed as (
select t.id, coalesce(
  (select r.wallet_id from public.canonical_wallet_release_receipts r
    where r.wallet_transaction_id = t.id),
  (select r.wallet_id from public.canonical_unprotected_settlement_receipts r
    where r.wallet_transaction_id = t.id),
  (select w.wallet_id from public.withdrawals w
    where t.reference_type = 'withdrawal' and t.reference_id = w.id::text),
  (select w.id from public.wallets w
    where w.id::text = t.metadata->>'wallet_id' and w.owner_id = t.user_id),
  (select w.id from public.wallets w
    where w.owner_id = t.user_id and w.owner_type = 'property_partner'
      and t.transaction_type in ('canonical_installment_settlement',
        'property_earning_pending', 'property_earning_released',
        'property_earning_reversed'))
) as wallet_id from public.wallet_transactions t where t.wallet_id is null
)
update public.wallet_transactions t set wallet_id = a.wallet_id
from attributed a where t.id = a.id and a.wallet_id is not null;

create index if not exists wallet_transactions_wallet_recent
  on public.wallet_transactions(wallet_id, created_at desc);
