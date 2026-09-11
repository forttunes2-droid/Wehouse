# WeHouse Product Master

Status: proposed canonical product contract

Audit baseline: `baf8d529fb4ef659d4f0059f9d5d44cf6da9729c` on `main`

Audit date: 2026-09-11

This document is the entry point for the WeHouse product contract. It records what the repository and live Supabase schema do, where different product generations conflict, and the model future work should converge on. “Canonical” means proposed unless a decision is marked approved in [DECISION_LOG.md](./DECISION_LOG.md).

## Evidence and limits

The audit covered the application router and workspaces, all `src` pages/components and Supabase adapters, 407 active migration files, the current live migration history, live schema functions and RLS policies, and all 11 Edge Functions. Production was queried read-only. No customer, payment, booking, or property row was changed.

The live database contains all three access migrations introduced around commit `2d875578`:

- `repair_hotel_rls_recursion` (`20260911002626` in live migration history)
- `restore_public_hotel_discovery_after_rls_repair` (`20260911004927`)
- `split_public_and_internal_hotel_read_policies` (`20260911004957`)

That proves they were applied, not merely included in a successful Vercel frontend deployment. It does **not** prove the resulting policy contract is correct. Live inspection found that the anonymous/authenticated active-hotel table policy exposes the entire `hotels` row, which can bypass the safer field masking in the authenticated-only `get_public_hotel_detail` RPC. This was structural verification, not a mutation-based impersonation test for every actor; the role matrix and required role-contract tests are in [ROLES_AND_PERMISSIONS.md](./ROLES_AND_PERMISSIONS.md).

## Product definition

WeHouse is a multi-sided housing and services platform with one personal identity and several optional operating workspaces:

- People discover homes, hotels, roommates, and service workers; reserve or book; pay; communicate; and receive lifecycle updates.
- Property Partners submit apartments or hotels, prove access privately, operate approved inventory, communicate with guests or WeHouse, and receive earnings.
- Service Workers become verified, accept service work, agree price, receive protected payment, perform work, complete it, and withdraw earnings.
- Hotel teams operate stay policy, room types, physical rooms, dated inventory, rates, reservations, check-in/out, and guest communication.
- Field Operations verifies property access and physical condition.
- Worker Operations verifies and governs service workers.
- Admin governs scoped operations.
- Creator governs the platform globally and approves exceptional or final actions.

The product is not a collection of dashboards connected by cards. It is one domain with workspace-specific views over the same authoritative records. Navigation chooses a durable destination. Status describes a record. An Activity item describes a domain event. A conversation is a durable communication thread. None should substitute for another.

## Canonical system boundaries

| System | Owns | Must not own |
|---|---|---|
| Identity and access | Person, authentication, account health, workspace grants, geographic scope | Booking state or navigation |
| Property supply | Submission, private verification, public media, listing publication | Customer reservation status |
| Hotel supply | Hotel, room type, physical unit, daily inventory, rate plan, stay policy | A guest's payment state |
| Reservations | Customer commitment, dates, occupancy lifecycle, cancellation | Property publication approval |
| Worker jobs | Request, negotiation, execution, completion, dispute | Generic social matching |
| Roommate | Preferences, discovery, interest, match, shared-home relationship | Service or hotel conversations |
| Conversations | Participants, context, messages, calls, block/archive rules | Primary booking/payment state |
| Money | Payment intent, verification, protected funds, settlement, payout/refund/dispute | UI success inferred from a timeout |
| Activity | Immutable domain-event projection and action destination | Ordinary chat messages or a second workflow engine |

## CURRENT IMPLEMENTATION

The current application is a Vite/React single-page app. `src/App.tsx` implements a large page-key router using component state, URL hash/history, local storage, and several side-channel IDs. It normalizes some historical aliases (`chat`/`messages` to `conversation`, `my_bookings` to `my_reservations`) but still restores and renders legacy destinations.

Data is stored in Supabase Postgres with RLS, SECURITY DEFINER RPCs, Storage, Realtime, and Edge Functions. The database—not the Vercel deployment—is the authority for schema and policies. Payment initialization and verification use Edge Functions; most lifecycle transitions use RPCs. Several newer flows are substantially stronger than their predecessors:

- Property access evidence is private and deliberately separated from selected public gallery media.
- Hotels have check-in/check-out times, room types, physical room units, daily availability, rate plans, and a paid-stay chat window.
- Worker blocking has database enforcement and preserves/reviews protected funds instead of silently cancelling secured work.
- Followed searches have semantic identity, uniqueness, pause/resume/remove, and matching-listing notifications.
- Personal and partner Inbox surfaces combine Activity and conversations rather than forcing Activity into a separate top-level destination.

## INCONSISTENCIES / LEGACY BEHAVIOUR

The product currently contains parallel generations of identity, navigation, chat, money, activity, and operational records. High-impact examples are:

- `profiles.role`, `profiles.account_kind`, `workspace_role_assignments`, and `hotel_team_members` all encode access in different ways.
- Mobile user navigation has one Inbox; desktop navigation exposes both Conversation and Inbox even though both render `Chat`.
- `AccountShell`, `WorkspaceFrameV2`, full-screen page portals, and component-local back handling create incompatible page chrome.
- Support cases use tables still named `partner_support_*` although users, workers, hotel guests, staff, Admin, and Creator use them.
- Active hotel rows are publicly selectable with all columns despite a safer masked detail RPC; internal hotel/booking access is scoped while some room/inventory policies grant all Staff/Admin, and physical units exclude Operations/Admin/Creator.
- Worker booking status `payment_protected` exists in database logic but is missing from the primary UI status map and open-conversation rules.
- Apartment short-stay date reservations coexist with global `listings.status = reserved/occupied`, which cannot represent multiple future stays cleanly.
- Notifications are canonicalizing around `notifications`, but `user_activity`, multiple audit-log tables, client-side stale-event suppression, and legacy destinations remain.
- The payout-account client wraps Edge Function requests in `Promise.race`; it can report a timeout while an uncancelled request succeeds later.
- There is no meaningful automated test suite for the route, policy, state-machine, or payment surface.

The complete severity-ranked register is [KNOWN_INCONSISTENCIES.md](./KNOWN_INCONSISTENCIES.md).

## PROPOSED CANONICAL MODEL

1. A person has one durable identity. Consumer, worker, and partner capabilities are account capabilities; Staff, Admin, Creator, and hotel assignments are revocable workspace grants. Revocation never deletes the person.
2. Every workspace has one stable shell and route tree. Overview is the landing destination. Operations, Inbox, Finance, and Account are destinations. Statuses are filters or record facts, never tabs pretending to be destinations.
3. Each business object has one authoritative state machine, one transition service/RPC, and typed state values shared by database and UI.
4. A booking/job/match creates at most one conversation identity per communication purpose. Guest↔hotel, user↔worker, roommate↔roommate, and participant↔WeHouse are distinct purposes but appear in one Inbox.
5. Money is never inferred from browser completion. Webhook/server verification establishes payment; protected funds remain protected through block/dispute; all uncertain mutation outcomes are reconciled from the server.
6. Activity is a projection of real domain events with a stable event key, actor, object, workspace scope, destination, and resolution. Reading an event does not complete its action.
7. Public media and approximate locations are deliberately published projections. Private access evidence and exact operational data remain protected.

## A. Current WeHouse product map

| Actor/workspace | Primary capabilities | Current surfaces |
|---|---|---|
| User | Discover, follow searches, save listings, reserve/book, pay, roommate matching, worker booking, Inbox | Explore, Bookings, Inbox, Account in `src/App.tsx`; `Search.tsx`, `HotelsHome.tsx`, `MyReservations.tsx`, `Chat.tsx` |
| Service Worker | Activation, job inbox, negotiation, protected jobs, showcase, earnings | `src/pages/WorkerWorkspaceModern.tsx`, `BookingNegotiationChat.tsx` |
| Property Partner | Submit/track properties, operate hotels/stays, Inbox, finance | `PropertyOwnerDashboard.tsx`, `PartnerSubmittedRequests.tsx`, `PartnerHotelOperations.tsx`, `CommunicationInbox.tsx` |
| Hotel team | Assigned hotels, operations and (some roles) Inbox | `src/pages/HotelTeamDashboard.tsx`, `PartnerHotelOperations.tsx` |
| Field Operations | Assigned physical property verification | `StaffWorkspaceRepair.tsx`, `PropertyPipelineWorkspace.tsx` |
| Worker Operations | Worker verification and governance | `StaffWorkspaceRepair.tsx`, `WorkerOperationsWorkspace.tsx` |
| Admin | Scoped oversight of people, staff, properties, workers, bookings | `AdminDashboard.tsx`, `AdminOperationsHub.tsx` |
| Creator | Global platform oversight, finance, analytics, configuration | `CreatorDashboard.tsx`, `CreatorOperationsHub.tsx` |

## B. Contradiction report

- High: public hotel rows bypass field masking and adjacent hotel policies disagree; hotel staff are shown a guest-message action they cannot create; mutation timeouts can lie; worker protected state is not represented consistently; status/navigation and shell fragmentation make destinations ambiguous; short-stay availability conflicts with listing-wide occupancy; customer UPDATE policies are broader than the transition contract suggests. The live advisor also exposes a 320-function SECURITY DEFINER review surface that needs an explicit endpoint allowlist.
- Medium: parallel conversation and support table families; multiple money/wallet/audit models; saved-search match triggers do not cover every already-live edit; hotel manager/front-desk Inbox capability is inconsistent; stale Activity resolution is partly client-side; draft and operational records are overloaded.
- Low: legacy names, aliases, wrappers, reports, labels, duplicated styling, and hard-coded Nigeria timezone/return URL reduce clarity and portability.

## C. Canonical product specification

The normative specification is split by concern:

- [ROLES_AND_PERMISSIONS.md](./ROLES_AND_PERMISSIONS.md)
- [NAVIGATION.md](./NAVIGATION.md)
- [LIFECYCLES.md](./LIFECYCLES.md)
- [DATA_MODEL.md](./DATA_MODEL.md)
- [NOTIFICATIONS_AND_ACTIVITY.md](./NOTIFICATIONS_AND_ACTIVITY.md)
- [CHAT_AND_COMMUNICATION.md](./CHAT_AND_COMMUNICATION.md)
- [PAYMENTS_AND_MONEY.md](./PAYMENTS_AND_MONEY.md)
- [PRODUCT_RULES.md](./PRODUCT_RULES.md)

## D. Decisions requiring owner approval

Open decisions are recorded in [DECISION_LOG.md](./DECISION_LOG.md), including whether worker/partner capabilities can coexist with a personal consumer workspace, whether hotel managers communicate with guests, how short-let listing availability should be projected, the scope of blocking, retention of post-completion WeHouse support entry points, and the operational meaning of `payment_protected` versus `confirmed`.

## E. Migration plan

1. Freeze vocabulary and approve open decisions; publish typed state dictionaries.
2. Add contract tests around current policies, RPC transitions, money idempotency, and conversation identity before schema consolidation.
3. Repair authorization mismatches without changing visible IA; test every actor against public, owned, assigned, scoped, and unrelated records.
4. Introduce canonical read models for Inbox, Activity, navigation badges, and each workspace; keep compatibility adapters temporarily.
5. Unify route/shell semantics and remove duplicate destinations.
6. Migrate lifecycle states one domain at a time: hotel, worker, property/reservation, roommate, support.
7. Consolidate payment/wallet/audit tables behind a canonical ledger and compatibility views.
8. Remove legacy tables, route aliases, wrappers, status maps, and loose SQL only after telemetry proves no callers remain.

Detailed sequencing and dependencies are in [KNOWN_INCONSISTENCIES.md](./KNOWN_INCONSISTENCIES.md#safe-migration-order).

## F. Regression rules

At minimum, CI must enforce:

- a role×record access matrix for every protected entity;
- database and UI transition tests generated from the same state definitions;
- one current CTA per valid transition and no completed CTA after resolution;
- one conversation identity per context/purpose and no messaging/calling after closure or block;
- no booking code in chat-list or chat-header presentation;
- payment idempotency, late-success reconciliation, protected-funds invariants, and webhook replay tests;
- private-evidence/public-media separation tests;
- followed-search semantic uniqueness and match-event deduplication;
- canonical destination tests for every Activity event;
- no top-level navigation item whose value is a status;
- a build, type/lint check, migration-order check, and browser flow suite for each workspace.

The full invariant set is [PRODUCT_RULES.md](./PRODUCT_RULES.md).
