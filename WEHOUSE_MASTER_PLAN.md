# WeHouse Nigeria — Canonical Master Plan

Status: active integration contract  
Canonical product source: [`docs/PRODUCT_MASTER.md`](docs/PRODUCT_MASTER.md)  
Decision register: [`docs/DECISION_LOG.md`](docs/DECISION_LOG.md)

This file is the repository entry point for the current WeHouse master plan. It
replaces the July 2026 plan that described one permanent role per account,
paid Worker verification, a purchasable blue tick, browser-authoritative
payments and an `ULTIMATE_FIX.sql` deployment process. Those rules are retired
and must not be restored.

## Locked product rules

### Identity and workspaces

- One person has one durable Personal identity.
- Consumer access remains available to that person.
- Worker and Property Partner are independently granted professional
  workspaces; hotel membership, Staff, Admin and Creator authority are scoped,
  revocable grants.
- A workspace changes available capabilities. It does not create a second
  person or overwrite the Personal identity.

### Workers, trust and WeHouse Pro

- Worker registration, professional profile completion, evidence submission,
  WeHouse review, ordinary approved profile, eligible discovery and job access
  are free.
- `WeHouse Reviewed` means the professional profile/evidence passed the WeHouse
  review process. It is not sold.
- `WeHouse Trusted` is earned later from real WeHouse performance and safety
  signals. It is not sold.
- The gold tick is labelled `PRO`. It appears only while a server-verified paid
  WeHouse Pro entitlement is active.
- Pro never changes review, trust, ranking, discovery, job allocation, dispute
  treatment or licensing status.
- Cancelling or losing Pro removes only Pro software entitlements at the end of
  the paid period. It does not remove the Worker profile, Reviewed or Trusted.

### Pro billing authority

- Pro is an optional monthly software subscription with useful professional
  tools beyond the gold PRO mark.
- Web checkout uses a verified Paystack monthly plan. The Creator Dashboard
  controls the web price; price changes apply to new subscriptions and must not
  silently rewrite existing subscription contracts.
- iOS checkout uses an Apple auto-renewable in-app subscription and the price
  returned by the App Store.
- Android checkout uses a Google Play subscription and the price returned by
  Google Play.
- Native sales stay disabled until store products, server receipt verification,
  renewal/cancellation notifications and restore-purchase flows are deployed.
- A browser redirect never grants Pro. Only a verified provider event/receipt
  creates or changes the entitlement.

### Money

- The server, provider webhooks and canonical ledger are authoritative. The UI
  never infers payment, protection, release, refund or payout success.
- Worker job lifecycle is separate from Payment Protection state.
- Hotel and Short Let accommodation money remains protected after authorized
  check-in for the booking's disclosed arrival-issue window. Check-in alone and
  checkout are not payout instructions.
- The default and minimum arrival-issue window is two hours. A property or rate
  package may extend it up to four hours; the chosen duration is snapshotted on
  the booking and shown before payment.
- A timely formal arrival issue freezes only the affected accommodation money
  for review. Ordinary support chat does not silently create a financial
  dispute.
- A Short Let caution fee is refundable by default. A Partner has 24 hours
  after effective checkout to submit an itemized claim with evidence; after
  successful notice, the guest has 48 hours to accept, counter or dispute.
  Silence never awards the Partner, and any undisputed remainder is refunded.
- Cancellation uses Creator-approved Flexible, Standard or Non-refundable
  templates. Their exact percentages and deadlines remain a separately
  approved commercial/legal configuration; provider inability or overbooking
  produces a full refund, and a caution fee is never a cancellation penalty.
- The canonical current money authority is locked in
  [`docs/DECISION_D010_MONEY_AUTHORITY_2026-09-12.md`](docs/DECISION_D010_MONEY_AUTHORITY_2026-09-12.md).
- Legacy money tables remain compatibility/read candidates until writer
  inventory and parity evidence are complete. No speculative production data
  rewrite is allowed.

### Hotels and PMS

- Manual WeHouse hotel operations are a complete supported mode and remain the
  canonical fallback.
- Hotel actions are authorized by explicit capabilities, not guessed from a
  role label. The locked model is in
  [`docs/DECISION_D002_HOTEL_CAPABILITY_AUTHORITY_2026-09-12.md`](docs/DECISION_D002_HOTEL_CAPABILITY_AUTHORITY_2026-09-12.md).
- A generic “all PMS systems work perfectly” claim is prohibited. Each external
  PMS requires a named adapter, credentials, sandbox/partner certification,
  mapping rules, idempotent delivery, reconciliation, monitoring and rollback.
- Certified connected mode may become the inventory authority for that hotel;
  unconnected hotels continue in manual WeHouse mode.
- The certification and launch checklist is maintained in
  [`docs/HOTEL_PMS_CERTIFICATION_AND_LAUNCH.md`](docs/HOTEL_PMS_CERTIFICATION_AND_LAUNCH.md).

### Property publication

- Verified physical, identity, access, location, capacity and approved-public-
  media facts return through review when changed.
- Authorized Partners may change future commercial/operational terms through
  narrow audited commands. Existing booking snapshots never change.
- The locked boundary is in
  [`docs/DECISION_D014_POST_PUBLICATION_EDIT_BOUNDARY_2026-09-12.md`](docs/DECISION_D014_POST_PUBLICATION_EDIT_BOUNDARY_2026-09-12.md).

### Legal and safety gates

- Nigeria-only v1 is the current product scope unless a later recorded decision
  changes it.
- The Worker marketplace launch stays off until the required labour/recruiter
  classification, contracts and operational approvals are recorded.
- Private biometric/identity checks stay off until lawful basis, DPIA,
  processor and cross-border terms, retention/deletion, security, a manual
  alternative and an appeal path are approved.
- Paid Pro is software access, never proof of identity, professional licensing,
  safety or endorsement.
- This repository records product controls and evidence requirements; qualified
  Nigerian counsel must approve the legal conclusions and launch gates.
- The cross-product issue and evidence matrix is maintained in
  [`docs/LEGAL_LAUNCH_REGISTER_NIGERIA_2026-09-13.md`](docs/LEGAL_LAUNCH_REGISTER_NIGERIA_2026-09-13.md).
  A Creator toggle alone cannot authorize a regulated launch.

## Integration order

1. Freeze source heads and repair clean migration replay.
2. Remove paid Worker onboarding and separate Reviewed, Trusted and Pro.
3. Lock Creator-controlled Pro price, exact terms consent and provider-verified
   subscription state.
4. Reconcile Worker jobs, Payment Protection, wallets, refunds and payouts to
   the locked money authority.
5. Move access to one Personal identity plus independently granted workspaces.
6. Apply biometric/legal gates, support availability and security hardening.
7. Apply hotel capability authority and preserve manual operations.
8. Certify one named PMS adapter end to end before advertising connected PMS
   support; add other vendors one adapter at a time.
9. Run migration replay, role/access matrices, lifecycle and money invariants,
   webhook replay tests, production build, browser journeys and preview checks.
10. Merge only after the evidence above passes; deploy production migrations and
    functions separately with rollback and reconciliation monitoring.

## Current integration status — 2026-09-13

- Complete locally and on the isolated preview database: free Worker
  onboarding/review; Reviewed/Trusted/Pro separation; server entitlement
  ledger; exact Pro-terms receipts; Paystack monthly initialization, renewal,
  failure, cancellation and management paths; Creator web-price/plan sync;
  authoritative Worker payment/protection reads; idempotent payout-account
  change reconciliation; one Personal identity with independently activatable
  Worker and Property Partner workspace grants.
- Complete locally and on preview: canonical hotel capability enforcement,
  manual hotel operations, fail-closed named PMS certification/runtime gates,
  two-to-four-hour snapshotted accommodation arrival protection, and a formal
  arrival-issue action that freezes the affected money. Short Let caution
  claims enforce the 24-hour Partner evidence window, 48-hour guest response
  window, refund of the undisputed remainder and no award from silence.
- Recovered into this branch: the exact canonical policy, ledger, lifecycle,
  case, activity, staff, shared-payment and security migrations that had
  previously existed only in preview migration history.
- Fail-closed: Worker marketplace launch, private identity checks, Pro sales and
  native store sales default off.
- Legal register complete: Worker/recruitment, identity/biometric, payments,
  subscriptions, properties, hotels/PMS, public trust claims, communications,
  staff/field operations, corporate/tax and insurance dependencies now have
  explicit evidence requirements. Regulated Worker marketplace and private
  identity settings additionally require a current recorded approval.
- In progress before merge: reconcile the outstanding application branch,
  perform clean migration replay, close material security findings, verify
  ledger writer/parity and webhook invariants, and run full browser journeys.

The detailed system boundaries, inconsistencies, specifications and regression
rules remain in [`docs/PRODUCT_MASTER.md`](docs/PRODUCT_MASTER.md) and its linked
documents. If a historical phase report conflicts with those documents or this
file, this current contract wins.
