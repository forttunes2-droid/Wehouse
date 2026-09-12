# D-010 — Worker and Property Partner money authority

Status: **source-of-truth decision locked; no production data migration in this change**  
Baseline: `main` after PR #71 (`e79b2dc2`)

## Finding

WeHouse still has several generations of money tables. Table names alone are misleading. The live RPC/Edge Function call graph establishes the active authority more clearly than the schema inventory.

## Canonical active authority

| Concern | Canonical source of truth now | Notes |
|---|---|---|
| Payment attempt / verified booking payment | `booking_payments` | Paystack `charge.success` looks up this table by `paystack_reference`; worker payments use `confirm_worker_booking_payment`, other supported purposes use `confirm_booking_payment`. |
| Worker protected value | `payment_protection_transactions` | Tracks protected/released/refunded/review state. Release/refund commands own economic transition. |
| Property Partner earning release gate | `property_partner_earning_releases` | Separates verified customer payment from when Partner money becomes available. |
| Current balance buckets | `wallets` | Active Worker and Partner withdrawal/release functions move `pending_balance`, `available_balance`, `frozen_balance`, and `total_withdrawn` atomically. |
| Money movement history | `wallet_transactions` | Append-style record written alongside active wallet transitions. |
| Withdrawal workflow | `withdrawals` | `awaiting_review → processing → paid/failed/reversed/rejected`; this is the payout workflow used by the active Edge Function. |
| Commission calculation/history | `commission_ledger` | Records platform/partner split produced by verified Partner payments. |
| Paystack transfer initiation/reconciliation | `payout-withdrawal` Edge Function + payout RPCs | Finance actor claims withdrawal, starts Paystack transfer, records the response and can reconcile an inconclusive transfer. |
| Paystack transfer final settlement | `paystack-webhook` → `settle_withdrawal_transfer_event` | Signed Paystack transfer webhook is the final external settlement signal; success consumes frozen funds and increments withdrawn, failure/reversal restores held money. |
| Customer refund/reversal | purpose-specific refund/protection RPCs plus `booking_payments`/protection records | Refund must update the obligation/protection state and ledger movement; never infer refund from UI state alone. |

## Active payout chain

1. Worker: `request_worker_withdrawal`; Property Partner: `request_my_property_partner_withdrawal`.
2. Request validates verified payout recipient/bank details, moves `wallets.available_balance → frozen_balance`, inserts `withdrawals(awaiting_review)`, records wallet/audit history.
3. Finance review calls `payout-withdrawal`.
4. Approval calls `claim_withdrawal_for_payout`, which atomically claims the request and creates/returns the deterministic transfer reference.
5. Edge Function calls Paystack `/transfer`.
6. `record_withdrawal_transfer_response` stores transfer code/status/response. An inconclusive network/provider result remains held; it is not safe to retry blindly.
7. Paystack `transfer.success`, `transfer.failed`, or `transfer.reversed` is HMAC verified by `paystack-webhook` and passed to `settle_withdrawal_transfer_event`.
8. Reconciliation can query Paystack by the deterministic reference and feed the same settlement command. Final-state/idempotency checks prevent a second economic effect.

## Worker money

A verified Worker service payment belongs to `booking_payments`; protected value belongs to `payment_protection_transactions`. A release command credits the Worker `wallets` balance and writes `wallet_transactions`. Blocking/dispute must never silently release or destroy protected value; it stays protected/reviewable until a valid release, refund or reviewed resolution.

## Property Partner money

A verified apartment/hotel payment is not immediately withdrawable Partner money. `settle_verified_property_partner_payment` records the commercial split/commission and adds the Partner portion to `wallets.pending_balance`. `property_partner_earning_releases` records the lifecycle release gate. `release_property_partner_earning` moves eligible value from pending to available only after the required property/stay lifecycle event. A reversal/refund before release reverses pending value rather than fabricating a payout.

## Legacy/compatibility generations

The following must **not** be treated as a second writer without proven active consumers:

- `payments`
- `wallet_balances`
- `withdrawal_requests`

They remain compatibility/read/report candidates until consumer inventory and parity evidence are complete. Do not delete, backfill or bulk-copy production rows merely to make the schema look cleaner.

## Smallest safe consolidation

1. Declare `booking_payments`, `payment_protection_transactions`, `property_partner_earning_releases`, `wallets`, `wallet_transactions`, `withdrawals`, and `commission_ledger` as the canonical active model.
2. Inventory every application/RPC/Edge Function/read-model consumer of `payments`, `wallet_balances`, and `withdrawal_requests`.
3. Stop any remaining legacy **writes** first by routing them through canonical commands; preserve reads.
4. Build dual-read parity reports for balances, pending releases, withdrawals, refunds and final Paystack status.
5. Require exact parity for a defined observation window before switching each legacy read.
6. Only then mark legacy tables read-only/archival and later retire them with a separate migration.

No production data rewrite is part of D-010.

## Required regression evidence

- Duplicate `charge.success` causes one economic effect.
- Late Paystack success after an earlier client timeout settles the same payment once.
- Duplicate payout approval cannot start a second withdrawal economic effect/reference.
- Inconclusive transfer response keeps funds frozen and forces reconciliation rather than blind retry.
- `transfer.success` and later duplicate success are idempotent.
- `transfer.failed/reversed` restores held funds exactly once.
- Worker release/refund/dispute paths reconcile protection + wallet transaction history.
- Partner payment → pending earning → lifecycle release → available balance → withdrawal → Paystack settlement reconciles end to end.
- Refund before Partner release reverses pending value; refund after settlement uses the reviewed reversal/refund path and never edits historical ledger facts.
