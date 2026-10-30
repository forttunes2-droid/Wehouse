# Payments and Money

## Payment market expansion

Display defaults and country catalogue rows do not grant payment support. The
shared Edge payment-market contract currently enables NG/NGN/Paystack only.
Checkout, explicit verification and charge webhooks use exact minor units and the payment's saved
currency. Unsupported or missing currency blocks these operations.

A new country needs a supported currency/precision, provider adapter and scoped
credentials; approved charge/settlement/refund/dispute/payout capabilities;
country-specific legal and operating gates; and complete failure/retry acceptance.
Booking obligations and ledger records must retain their original market/currency
when a viewer changes locale or the country configuration changes. Do not mix
currencies in wallet totals or silently convert money. Native digital purchases
remain a separate store-billing route. These are expansion requirements, not a
claim that every endpoint already implements the shared contract.

## Principles

### Refund provider reconciliation

The financial processor submits each queued refund once; uncertainty is not
permission to submit another refund. Known provider IDs receive bounded scheduled
GET checks. Finance can supply an unknown refund ID for verification against the
original transaction, original currency, exact amount and test/live environment.
Before submission, it also verifies the original successful provider charge,
its explicit NGN currency/environment and safe integer amount covering the refund.
Claims serialize by protected payment: the oldest due action locks the payment
and action; another unresolved effect blocks subsequent actions. A batch cannot
take two actions for the same payment. Provider calls are bounded to two existing
refund lookups and three new actions per processor run.
Provider lookups and signed webhooks carry different evidence fields while
sharing the existing canonical settlement and ledger routine. One provider refund
cannot satisfy two actions. Provider processed means processing was confirmed,
not that the customer's bank has already displayed the credit.

Scheduled Test dispatch uses Vault names `financial_processor_project_url` and
`financial_processor_worker_secret`; the latter must match Edge
`WEHOUSE_CRON_SECRET`. Missing configuration produces no dispatch. The processor
uses a private cron secret; the interactive reconciliation endpoint requires a
valid user token plus trusted-device, active Finance/Creator and coverage checks.

Money changes are server-authoritative, idempotent, append-only in their audit effects, and reconcilable. A toast, redirect, client status, or timeout is never proof that money moved or failed to move.

### Identity and Paystack capability boundary

Paystack's own Nigerian merchant compliance process verifies the business applying for a Paystack merchant account. It does not automatically verify each WeHouse user, Partner or Service Worker. WeHouse currently uses bank account resolution and transfer-recipient setup for payouts; resolving an account name is not a NIN lookup, government-ID check, proof of the app user's control of that account, or a complete recipient KYC decision.

The public [Verification API](https://paystack.com/docs/api/verification/) documents bank-account and card-BIN operations, not a general Nigerian NIN-verification API. Its account-validation identity fields do not establish Nigerian NIN support for WeHouse. [Nigeria merchant compliance](https://support.paystack.com/en/articles/2123970) lists accepted merchant documents; it is not the recipient-onboarding contract for this marketplace. Confirm the exact supported model with Paystack. Dedicated approved NIN verification still needs a provider-specific integration; no such adapter is enabled. No NIN is requested for ordinary customer signup or payment.

## CURRENT IMPLEMENTATION

### Payment path

1. A domain RPC creates or locates an authoritative pending payment for an exact subject, purpose and amount.
2. `supabase/functions/payment-init/index.ts` authenticates the actor, reloads authoritative data and initializes Paystack.
3. The browser returns through `PaymentReturn.tsx`, which calls `paystack-verify` and refreshes the domain result.
4. `paystack-webhook` independently verifies provider events and invokes domain confirmation logic.
5. Purpose-specific confirmation advances an apartment reservation, hotel booking, worker job/protection, rent plan or shared-housing share.

Current purposes include `apartment_reservation`, `apartment_rent`, `rent_plan_contribution`, `hotel_booking`, `worker_booking`, and `shared_housing_share`. Worker onboarding and review are free; the retired verification-payment endpoint refuses initialization.

### Protection and settlement

Worker payment confirmation creates/updates protected-payment state. Completion requires customer approval or a reviewed resolution before release. Migration `20260911140000_complete_worker_block_and_payment_protection.sql` handles the important race in which Paystack succeeds after a participant blocks or a pre-payment booking appears cancelled: verified value is recorded, protection is created, the job moves to dispute/review, and support/operations receives a case instead of losing the money.

Property Partner and worker earnings feed wallet/balance and withdrawal flows. Payout Edge Functions validate account/withdrawal state, claim a withdrawal, call Paystack transfer, and record transfer responses. Finance queues/RPCs mediate privileged review.

### Worker and Partner wallet authority (19 October)

Both workspaces use `wallets`, with a balance scoped to the owner and workspace type; they are not competing wallet products. Withdrawal creation uses the shared authenticated receipt command and a persistent client request identifier. Replaying the same request returns the original withdrawal; changed details are refused. Active verified owned bank accounts are required. Unknown network outcomes retain the identifier rather than creating another withdrawal. Test repairs restore wallet transaction attribution and financial throttling.

The activity feed displays canonical balance movements once. Protected or held earnings are lifecycle information, not an additional released credit. Existing legacy records are preserved pending a reviewed retirement plan. These source/Test changes do not prove actual Paystack transfer, settlement, refund or all-role finance journeys; Production remains unchanged.

### Current money stores

Partner Pro operating costs are manually entered business records in `partner_pro_operating_costs`; they do not debit wallets, initiate transfers, mark a bill paid or change Partner earnings. Recorded margin means released WeHouse income less recorded costs, with explicit NGN and UTC reporting and no combined total for mixed currencies. Void retains the original entry/reason; idempotent retries preserve one record. These operational reports are not bank payout receipts or tax-profit certification.

| Store | Current role |
|---|---|
| `booking_payments` | Cross-domain payment attempt/verification envelope |
| `payments` | Legacy payment records |
| `payment_protection_transactions` | Protected-fund lifecycle linked to its booking/subject, payer, payee, provider reference and ledger; domain coverage still needs acceptance |
| `payment_protection_transitions` | Protection state-change history, actor, reason/event and linked ledger transaction |
| `ledger_transactions`, `ledger_entries` | Canonical accounting transactions and their account entries; separate from a displayed wallet balance |
| `financial_action_outbox` | Durable release/refund obligations, attempts, provider references and reconciliation state |
| `verified_provider_events` | Provider event/lookup evidence, checksums, proof method and processing result |
| purpose-specific columns | Payment/fee/rent/deposit states on reservations/bookings/groups |
| partner/worker earning tables | Accrued/available/held/reversed earning records |
| `wallets` | Canonical current balance buckets for Worker and Property Partner |
| `wallet_transactions` | Append-style history for canonical balance movements |
| `withdrawals` | Canonical active payout request and settlement workflow |
| `wallet_balances`, `withdrawal_requests`, `payments` | Legacy compatibility tables; not active writers in the audited call graph |
| verified-reference/refund/reversal tables | Idempotency and exception history |
| financial audit tables | More than one generation of audit log |

### Timeout behavior

Some time bounds are legitimate: geolocation/reverse geocoding can be bounded, and stalled media uploads can be aborted with clear retry. Other current patterns are dangerous:

- Payout-account saves retain a request identifier and reconcile its server status. The 15-second notice is informational. A missing ledger does not prove an in-flight request stopped; the client retains the same request instead of clearing it after two minutes. The reference is persisted across browser restarts; checks run once a minute, within the shared request budget. Support opens with the request reference and originating workspace, and creates a case through the existing first-message flow. This navigation check does not establish actual case resolution. Bank replacement remains disabled until its sign-in verification is complete.
- Payment return performs bounded verification retries and a short redirect delay. Retries are valid only because verification is idempotent and the UI subsequently reloads authoritative state.

The loading-screen warning shown to users is not evidence that arbitrary timeouts fix network failures. A timeout can improve escape/retry UX, but it must not convert an uncertain mutation into a false failure.

## INCONSISTENCIES / LEGACY BEHAVIOUR

1. `booking_payments` is polymorphic and status is free text.
2. Domain state duplicates money state: `waiting_payment`, `payment_protected`, `payment_conflict`, and payment columns can disagree.
3. Worker “protected” meaning is split between job status, payment status and `payment_protection_transactions`.
4. Legacy wallet and withdrawal tables remain in the schema, as do singular/plural financial audit tables. Current application flows use `wallets` and `withdrawals`; do not describe the legacy tables as competing active projections. See [D-010](./DECISION_D010_MONEY_AUTHORITY_2026-09-12.md). Retirement still requires consumer inventory and parity evidence.
5. Payout-account false-failure timeout handling is corrected in the working tree. A support entry with request context is wired. Privileged provider reconciliation, actual support resolution, secure bank replacement and provider failure journeys remain release gates.
6. The earlier inline callback-URL finding is superseded: payment initialization uses the shared environment-aware return resolver. Hosted Test, preview and Production callback routing still need verification.
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

## Bank catalog and searchable payout picker - 20 October 2026

The payout-account endpoint previously stopped after 100 Paystack banks for both list and selected-code verification. Test version 6 uses cursor pagination, a shared 12-second lookup deadline, a 20-page safety bound, complete-result validation and a five-minute in-memory cache. Repeated cursors or missing completion evidence fail visibly; a bank beyond page one is included in both selection and verification. Retired/deleted institutions are excluded. The client supports normalized multiword/code search and explicit retry after failed or malformed list receipts. It never makes a provider request per typed character. Paystack catalog/payment verification remains NGN/Nigeria under the existing supported-market gate.

Source: https://paystack.com/docs/api/miscellaneous/ . Seven focused server tests include pagination, caching, shared deadline, incomplete catalog and recipient reconciliation; the bank UI passes ten focused browser scenarios. Live authenticated provider evidence remains required. Production was not changed.
