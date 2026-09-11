# Payments and Money

## Principles

Money changes are server-authoritative, idempotent, append-only in their audit effects, and reconcilable. A toast, redirect, client status, or timeout is never proof that money moved or failed to move.

## CURRENT IMPLEMENTATION

### Payment path

1. A domain RPC creates or locates an authoritative pending payment for an exact subject, purpose and amount.
2. `supabase/functions/payment-init/index.ts` authenticates the actor, reloads authoritative data and initializes Paystack.
3. The browser returns through `PaymentReturn.tsx`, which calls `paystack-verify` and refreshes the domain result.
4. `paystack-webhook` independently verifies provider events and invokes domain confirmation logic.
5. Purpose-specific confirmation advances an apartment reservation, hotel booking, worker job/protection, rent plan or shared-housing share.

Current purposes include `apartment_reservation`, `apartment_rent`, `rent_plan_contribution`, `hotel_booking`, `worker_booking`, and `shared_housing_share`. Worker verification payment is initialized by a separate function.

### Protection and settlement

Worker payment confirmation creates/updates protected-payment state. Completion requires customer approval or a reviewed resolution before release. Migration `20260911140000_complete_worker_block_and_payment_protection.sql` handles the important race in which Paystack succeeds after a participant blocks or a pre-payment booking appears cancelled: verified value is recorded, protection is created, the job moves to dispute/review, and support/operations receives a case instead of losing the money.

Property Partner and worker earnings feed wallet/balance and withdrawal flows. Payout Edge Functions validate account/withdrawal state, claim a withdrawal, call Paystack transfer, and record transfer responses. Finance queues/RPCs mediate privileged review.

### Current money stores

| Store | Current role |
|---|---|
| `booking_payments` | Cross-domain payment attempt/verification envelope |
| `payments` | Legacy payment records |
| `payment_protection_transactions` | Worker protected-fund lifecycle |
| purpose-specific columns | Payment/fee/rent/deposit states on reservations/bookings/groups |
| partner/worker earning tables | Accrued/available/held/reversed earning records |
| `wallets`, `wallet_balances` | Competing balance projections |
| `withdrawals`, `withdrawal_requests` | Competing payout requests/workflow |
| verified-reference/refund/reversal tables | Idempotency and exception history |
| financial audit tables | More than one generation of audit log |

### Timeout behavior

Some time bounds are legitimate: geolocation/reverse geocoding can be bounded, and stalled media uploads can be aborted with clear retry. Other current patterns are dangerous:

- Payout-account requests use `Promise.race` around a roughly 15-second UI timeout without cancelling the underlying Edge Function. During the save action, the account may be created after the UI reports a timeout.
- Payment return performs bounded verification retries and a short redirect delay. Retries are valid only because verification is idempotent and the UI subsequently reloads authoritative state.

The loading-screen warning shown to users is not evidence that arbitrary timeouts fix network failures. A timeout can improve escape/retry UX, but it must not convert an uncertain mutation into a false failure.

## INCONSISTENCIES / LEGACY BEHAVIOUR

1. `booking_payments` is polymorphic and status is free text.
2. Domain state duplicates money state: `waiting_payment`, `payment_protected`, `payment_conflict`, and payment columns can disagree.
3. Worker “protected” meaning is split between job status, payment status and `payment_protection_transactions`.
4. Wallet and withdrawal generations coexist, as do singular/plural financial audit tables.
5. The payout-account UI timeout can lie about a save outcome and invite duplicate retry.
6. The payment return URL is hard-coded to `https://www.wehouse.com.ng/#payment-return` rather than environment/domain configuration.
7. Provider callbacks, webhook replay, client retries and block/cancel races require one explicit idempotency contract, but enforcement is distributed across functions/tables.
8. Direct RLS access and finance SECURITY DEFINER queues do not use an obviously uniform permission model.
9. Reservation fee, rent, deposit, protection, earning, settlement and payout are sometimes stored as columns rather than linked obligations/ledger entries.

## PROPOSED CANONICAL MODEL

### Money aggregates

| Aggregate | Responsibility |
|---|---|
| Obligation | Subject, debtor, beneficiary, purpose, amount/currency, due/cancellable rules and current satisfaction |
| Payment attempt | One provider/reference attempt, initialization and verification result |
| Protection | Amount held, reason, release/refund authority and review state |
| Ledger entry | Immutable reserve, debit, credit, release, refund, fee and reversal |
| Settlement | Application of verified/protected money to beneficiary/fees |
| Payout | Withdrawal request and external transfer reconciliation |
| Dispute | Case that freezes/restricts settlement without destroying history |

Booking/job state may say “awaiting payment” as a derived readiness fact, but the payment state remains owned by the obligation. `payment_protected` should not compete with `confirmed`; see D-009 in [DECISION_LOG.md](./DECISION_LOG.md).

### Authoritative state sequence

`required → intent_created → provider_pending → verified → protected/settlement_pending → settled`, with branches to `failed/expired`, `review_required`, `refunded`, or `reversed`. Every branch is an explicit server transition with an audit event.

### Timeout/retry contract

- Read: may time out and retry with cancellation/backoff.
- Idempotent verification: may retry with the same reference/idempotency key.
- Mutation that may commit: timeout becomes `unknown/reconciling`; disable blind duplicate submission; poll/subscription/read-after-timeout until authoritative state is known.
- Provider transfer: store request before send, reuse transfer reference, reconcile provider status after timeout, and never issue a second transfer solely because the first response was late.
- UI: say “Still checking” or “We could not confirm yet,” never “Failed” unless the server/provider records failure.

### Money permissions

| Action | Permitted actor |
|---|---|
| Create obligation | Domain transition service |
| Initiate payment | Debtor/current authenticated participant |
| Verify provider payment | Webhook/verification service only |
| Protect funds | Server rule for eligible domain |
| Approve work completion | Authorized counterparty; not payee alone |
| Resolve dispute/refund/release | Scoped Operations/Finance according to explicit separation of duty |
| Request payout | Beneficiary of available ledger balance |
| Approve/transfer payout | Independent Finance actor/service; never requester reviewing self |
| Override | Creator only where policy explicitly permits; reason and immutable audit required |

## Required tests

- Same provider reference/webhook replay has exactly one economic effect.
- Block before payment, during provider checkout, after verification, and during work preserves correct value/state.
- Browser closes before callback; webhook alone completes the domain.
- Callback arrives before webhook and vice versa with identical result.
- Payout provider timeout reconciles before another transfer can be issued.
- Refund/reversal produces compensating entries, never edits/deletes settled history.
- Every balance equals the sum of canonical ledger projections.
- Actor and scope matrix protects customer amount details and finance actions.
- Completed/failed/review states expose only valid CTAs.

## Evidence

- `supabase/functions/payment-init/index.ts`
- `supabase/functions/paystack-verify/index.ts`
- `supabase/functions/paystack-webhook/index.ts`
- `supabase/functions/payout-account/index.ts`
- `supabase/functions/payout-withdrawal/index.ts`
- `src/pages/PaymentReturn.tsx`
- `src/lib/supabase/housing-payments.ts`, `paystack.ts`, `payment-verify.ts`, and purpose-specific adapters
- `supabase/migrations/20260909155010_payment_protection_and_paystack_payouts.sql`
- `supabase/migrations/20260911140000_complete_worker_block_and_payment_protection.sql`
