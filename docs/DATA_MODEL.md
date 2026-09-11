# Data Model

## CURRENT IMPLEMENTATION

The current database is an incrementally evolved Supabase/Postgres schema. Newer RPCs and RLS helpers often provide a coherent boundary over older tables, but table names and columns still encode several generations of the product.

### Important entities and relationships

| Domain | Current important entities | Relationship/authority |
|---|---|---|
| Identity | `profiles`, auth users, account/device/session tables | Auth identity maps to `profiles.auth_id`; product actor ID is generally `profiles.user_id` |
| Workspace access | `workspace_role_assignments`, staff permissions/scope fields, `hotel_team_members` | Grants privileged workspace or per-hotel access without creating a new person |
| Partner submission | `property_submission_batches`, `property_submission_items`, access challenges, `inspection_requests` | Batch holds drafts; submitted items create verification cases |
| Property supply | `listings`, listing media/availability helpers | A verified apartment becomes a discoverable listing |
| Hotel supply | `hotels`, `hotel_rooms`, `hotel_room_units`, `hotel_rate_plans`, `hotel_inventory_daily`, `hotel_venues`, `hotel_team_members` | Hotel has room types; room type has physical units, dated inventory and rates |
| Apartment demand | `reservations`, `user_inspection_requests`, booking/rent-plan records | Reservation links user to listing, dates/money/handover |
| Hotel demand | `hotel_bookings` | Booking links guest, hotel, room type, rate plan, dates, payment, and assigned physical unit |
| Worker identity | legacy `workers`, profile worker columns, `worker_verifications`, `worker_identity_checks`, `worker_verification_reviews` | Verification gates marketplace capability |
| Worker jobs | `worker_bookings`, `booking_payments`, `payment_protection_transactions` | Job links user and worker; money is attached polymorphically |
| Roommate | `roommate_profiles`, `roommate_preferences`, `roommate_search_results`, legacy `roommate_matches`, block/shared-home tables | Discovery result becomes mutual relationship and potentially shared housing |
| Conversations | `conversations/messages`, `booking_conversations/booking_messages`, `hotel_booking_conversations/hotel_booking_messages`, `partner_support_conversations/partner_support_messages`, `private_calls` | Four thread families plus calls |
| Activity | `notifications`, `announcements`, legacy `user_activity` | Domain event projection, broadcast, and old activity/security records |
| Saves | legacy `favorites`, `saved_listings`, `saved_searches` | Listing saves and followed criteria are different intentions |
| Money | legacy `payments`, `booking_payments`, protection/refund/reversal tables, earnings, `wallets`, `wallet_balances`, `withdrawals`, `withdrawal_requests`, commission tables | Payment intent/verification, protected funds, earnings and payout are spread across aggregates |
| Audit | `activity_logs`, `admin_audit_log`, `admin_logs`, `audit_logs`, `financial_audit_log`, `financial_audit_logs` | Several overlapping audit histories |

### Current aggregate boundaries

`inspection_requests` is the most overloaded operational aggregate. It contains or references submission facts, ownership/authority relationship, private access challenge/evidence status, field evidence status, assignment, lifecycle stage, selected public media, hotel program JSON, draft listing/hotel IDs, publication data, notes, corrections, and rejection.

`reservations` is similarly broad: it represents long-stay and short-stay apartment demand, fee/rent/deposit state, inspection choice, dates, tenancy, booking code, and conflicts. `hotel_bookings` is a newer separate aggregate, while service bookings use `worker_bookings`.

`booking_payments` is a polymorphic money envelope whose nullable foreign keys and `purpose` determine whether it belongs to a property reservation, hotel stay, worker job, rent plan, or shared-housing share. Its status is not constrained by a single database enum/check.

### State columns currently in use

| Aggregate | Current values observed |
|---|---|
| Property verification | `access_required`, `access_review`, `inspection_ready`, `inspection`, `awaiting_review`, `ready_to_prepare`, `listing_prepared`, `live`, `changes_requested`, `rejected` |
| Listing publication/availability | Both `status` and `availability_status`: `pending_approval`, `available`, `reserved`, `occupied`, `maintenance`, `closed`, `rejected` |
| Apartment reservation | `payment_pending`, `reserved`, `inspection_pending`, `ready_for_move_in`, `occupied`, `completed`, `cancelled`, `expired`, `refunded`, `payment_conflict` |
| Hotel | `draft`, `active`, `inactive` |
| Hotel booking | `pending`, `confirmed`, `checked_in`, `checked_out`, `cancelled`, `completed`, `refunded`, `expired`, `payment_conflict` |
| Physical hotel room | `ready`, `occupied`, `cleaning`, `maintenance`, `out_of_service` |
| Worker verification | `draft`, `pending`, `verification_paid`, `evidence_ready`, `profile_under_review`, `verified`, `rejected`; legacy result also uses `approved` |
| Worker job | `booking_requested`, `negotiating`, `waiting_payment`, `confirmed`, `payment_protected`, `in_progress`, `completed_pending_approval`, `approved_released`, `disputed`, `cancelled`, `refunded` across generations |
| Support case | `open`, `assigned`, `in_progress`, `waiting_for_user`, `escalated`, `resolved`, `closed` |
| Roommate result/search | result `new/viewed/accepted/declined`; search `idle/active/expired/stopped` |
| Shared housing | group `inviting/ready/payment_pending/paid/cancelled/expired`; phase `reservation_fee/contract_rent/complete` |
| Withdrawal | `awaiting_review`, `processing`, `paid`, `rejected`, `failed`, `reversed` |

### Public and protected projections

Public discovery does not always use direct table SELECT. Examples:

- Active `hotels` and associated room/inventory rows have anonymous SELECT policies. Because table SELECT returns all granted columns, an anonymous or authenticated caller can bypass the field masking intended by `get_public_hotel_detail` and read exact/internal active-hotel columns when populated.
- `get_public_hotel_detail` removes owner/internal fields and blurs location until a paid stay, but live grants allow only authenticated execution. Active rate plans are returned by that RPC; direct `hotel_rate_plans` SELECT is authenticated-only.
- Apartment discovery uses a SECURITY DEFINER read model such as `get_discoverable_homes`; direct listing policies are more restrictive.
- Property access recordings live in private evidence paths. Public listing/hotel media is produced only after an explicit selected/approved derivative workflow (`prepare_inspected_public_gallery`, `prepare_inspected_hotel_media`).

### Schema and migration authority

The migration authority is `supabase/migrations`. The repository also contains `migrations/`, `supabase/migrations_legacy/`, and loose SQL scripts at root. `supabase/config.toml` names the local project `wehouse`, while the connected live project ref is `rkrhnkhppeihvmuwvsvn`. Live migration history, not a Vercel status, proves database application.

### Live database advisor snapshot

The Supabase advisors reported the following on 2026-09-11. These are triage signals, not proof that every item is exploitable or should be changed mechanically.

| Advisor | Count | Interpretation |
|---|---:|---|
| Authenticated-executable SECURITY DEFINER functions | 320 WARN | The RPC-first architecture intentionally uses many definer functions, but the exposed surface needs an explicit EXECUTE allowlist and internal authorization review. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) |
| RLS enabled with no policy | 1 INFO | `worker_showcase_comments` is denied by default and appears dead/partially migrated unless access is RPC-only. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) |
| Leaked-password protection disabled | 1 WARN | Auth does not currently reject passwords known to be compromised. [Auth guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) |
| Unindexed foreign keys | 14 INFO | Relationship mutations/joins may degrade as data grows; inspect workload before adding indexes. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) |
| Unused indexes | 75 INFO | Historical/schema churn may have left redundant indexes, but low usage/new indexes make immediate deletion unsafe. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) |
| Multiple permissive policies | 15 WARN | Overlapping policies increase evaluation cost and make effective authorization harder to reason about. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies) |

## INCONSISTENCIES / LEGACY BEHAVIOUR

### Duplicated concepts

| Concept | Competing representations | Risk |
|---|---|---|
| Person's authority | `profiles.role`, `account_kind`, workspace assignments, staff permission/scope, hotel membership | Revocation or scope can differ by code path |
| Saved property | `favorites` and `saved_listings` | Two counts/behaviors for the same user intent |
| Worker | `workers`, profile fields, verification/check/review tables | Activation state can drift |
| Roommate relationship | `roommate_search_results`, `roommate_matches`, `conversations` | Old Activity and new discovery can disagree |
| Activity/audit | `notifications`, `user_activity`, six audit-log families | Wrong audience or duplicated events |
| Support | Generic cases stored in tables named `partner_support_*` | New code must remember historical naming and sender aliases |
| Payment | `payments`, `booking_payments`, protection, purpose-specific fields | State and idempotency fragmented |
| Balance | `wallets` and `wallet_balances` | Available/reserved/paid totals can disagree |
| Withdrawal | `withdrawals` and `withdrawal_requests` | Parallel payout workflows |
| Listing state | `status`, `availability_status`, `current_reservation_id` | Publication, calendar availability and occupancy collapse together |
| Customer inspection vs supply verification | `user_inspection_requests` vs `inspection_requests` | Similar name, different privacy and actors |

### Overloaded/free-text data

- Important statuses are text with checks scattered through migrations, triggers, RPCs, and frontend maps rather than one contract.
- `hotel_program`, `draft_payload`, destination parameters, context snapshots, and other JSON blobs carry schema that TypeScript/SQL must interpret manually.
- `booking_payments` identifies its aggregate through nullable IDs and purpose strings.
- Support sender roles include both canonical and legacy aliases (`property_partner`/`partner`, `staff`/`support`/`field_officer`).
- `profiles` carries both identity and worker/role lifecycle fields.
- Timezone is implicit (`Africa/Lagos`) instead of attached to a property/hotel policy.

### Integrity gaps or uneven boundaries

- Public direct hotel access defeats the safer masked RPC projection, and adjacent hotel tables use different role/scope RLS predicates.
- Some direct customer UPDATE policies constrain ownership but not changed columns or legal state transition.
- Physical hotel unit occupancy has a useful invariant (`occupied` iff assigned booking), but rate/inventory readiness and same-day cleaning are not fully expressed.
- Several compatibility functions and overloaded RPC signatures remain callable.
- The exposed API includes 320 authenticated-executable SECURITY DEFINER functions; many are intentional transition/read-model RPCs, but grants are not a documented allowlist.
- A 407-migration chain plus loose SQL copies makes it difficult to know whether an old object is intentionally retained.

## PROPOSED CANONICAL MODEL

### Canonical entities

| Entity | Core responsibility | Key relationships |
|---|---|---|
| `person` | Stable identity and account health | Has capability grants, preferences, workspaces |
| `capability_grant` | Role/capability, status, scope and validity | Belongs to person; optionally assigned to hotel/branch/case |
| `property_submission` | Partner intent and draft/submission boundary | Produces one verification case per property |
| `verification_case` | Private access and field-verification workflow | References evidence; produces approved public-media selection |
| `private_evidence` | Restricted source evidence with provenance | Never directly public |
| `public_media_asset` | Deliberately approved derivative | Belongs to published property/hotel/room type |
| `property` | Durable place/supply identity | Has sellable products/units and publication state |
| `hotel` | Hotel-specific policy and venue metadata | Has room types/team |
| `room_type` | Customer-facing hotel product | Has rates, daily inventory, physical units |
| `physical_unit` | Operational room/home unit | Has readiness and current occupancy assignment |
| `availability_interval` | Sellable capacity and closure by date/range | Orthogonal to publication and occupancy |
| `rate` | Price/cancellation/meal policy by product/date | Used to create immutable quote snapshot |
| `reservation` | Customer commitment to product and interval | Has participants, quote, obligations, occupancy |
| `job` | Customer↔worker service contract | Has negotiation, conversation, obligations, evidence |
| `roommate_interest/match` | Social intent and mutual relationship | May create conversation/shared-housing agreement |
| `thread` | One communication identity by context and purpose | Has participants, messages, call capabilities, state |
| `case` | Participant↔WeHouse operational/support communication | Linked to one domain object and work queue |
| `obligation` | Who owes what, when, and why | Has one or more idempotent payment attempts |
| `payment_attempt` | Provider interaction and verification | Creates immutable ledger entries |
| `fund_protection` | Held amount and release/refund authority | Linked to job/reservation obligation |
| `ledger_entry` | Immutable debit/credit/reserve/reversal | Projects wallet/balance and settlements |
| `domain_event` | Immutable fact emitted with transaction | Projects Activity, work queues and notifications |
| `saved_search` | Canonical normalized criteria and delivery policy | Matches future publication/availability events |

### State modelling rules

1. Use database types/checks from one migration-owned dictionary and generate/share frontend types.
2. Separate publication, availability, payment, communication, and occupancy state; never pack them into one status.
3. Transitions occur only through transactional functions/services that validate actor, source state, invariant, and idempotency key.
4. Store immutable transition/event history; current state is a projection, not the only evidence.
5. Replace polymorphic nullable-FK payment rows with `obligation_id` and explicit typed subject linkage.
6. Replace parallel read tables only after backfill, parity checks, dual-read telemetry, and compatibility views.
7. Every public projection explicitly allowlists fields. Table policy access must not accidentally widen a safer RPC projection.

### Relationship invariants

- One active person per auth identity; one durable product user ID.
- One active grant for the same person/capability/scope.
- One conversation per context+purpose; participant changes are audited.
- One active reservation per exclusive unit/time interval; room-type capacity never exceeds operational physical capacity.
- One physical unit has at most one current occupancy assignment.
- One payment reference verifies once; one settlement/refund effect per obligation version.
- One saved search per user+kind+canonical criteria.
- One public asset points to approved source provenance; private source remains inaccessible to public roles.

## Migration discipline

- Establish a migration manifest and deprecations table describing every compatibility object and removal condition.
- Move loose SQL and old audits outside the executable migration path; never ask operators to run root SQL manually without a tracked migration.
- Run migration replay from a clean database and compare schema fingerprints with production.
- Add policy tests and function-signature checks before squashing or baselining the historical chain.
- Record live migration version and application SHA in an internal deployment record so frontend deploy and database apply are independently visible.
