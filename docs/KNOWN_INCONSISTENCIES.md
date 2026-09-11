# Known Inconsistencies

## Severity definitions

- **High:** can expose unauthorized data, corrupt/duplicate money or state, strand a user, or make a core workflow materially wrong.
- **Medium:** creates contradictory behavior, stale actions, operational ambiguity, or costly migration risk without an immediate demonstrated loss.
- **Low:** naming, architecture or presentation debt that increases confusion and future defect probability.

## High severity

| ID | CURRENT IMPLEMENTATION | INCONSISTENCY / LEGACY BEHAVIOUR | PROPOSED CANONICAL MODEL | Evidence / decision |
|---|---|---|---|---|
| H-000 | `hotels_public_active_select` allows anonymous/authenticated direct SELECT of the full active hotel row; base-table grants include SELECT. `get_public_hotel_detail` masks exact/internal fields but is authenticated-only. | RLS filters rows, not columns. Direct table access bypasses address/coordinate/owner/internal-field masking; anonymous clients cannot use the intended detail RPC. | Revoke public base-table SELECT; grant anonymous/authenticated execution on an allowlisted public projection/RPC or expose a column-safe view. Paid/internal detail uses a separately authorized projection. | Live policy, table grants and `has_function_privilege`; immediate security/privacy repair |
| H-001 | Hotels/bookings use scoped helpers; `hotel_rooms` and `hotel_inventory_daily` direct policies allow any active Staff/Admin/Creator, while `hotel_room_units` permits only owner/manager/staff. | Adjacent hotel records have different geographic and role visibility. Operations/Admin/Creator can see too much in some tables and nothing in physical units. | One hotel action/access helper applied consistently by action and field projection. | Live `pg_policies`; `current_actor_can_read_hotel_record`; D-003/D-004 |
| H-002 | `hotel_bookings` customer UPDATE policy checks ownership but not legal columns/transitions. | A customer reaching the table directly has a broader write boundary than the product transition API suggests. | Revoke generic direct mutation; allow narrow RPCs or column-safe transition policy. | Live `hotel_bookings_customer_update_v2` |
| H-003 | Worker job database uses `payment_protected`; UI status map/open-thread set omits it. | A valid secured job can appear unknown or lose its conversation/action path, inviting unsafe workaround. | One typed job state vocabulary; money protection is explicit and UI-complete. | `20260911140000...sql`; `worker-bookings.ts`; D-009 |
| H-004 | Payout-account requests are wrapped in a client `Promise.race` timeout without abort/reconciliation. | During save, UI may report failure while the request succeeds later; retry can duplicate or confuse payout-account state. | `unknown/reconciling`, stable idempotency keys, read-after-timeout reconciliation. | `src/components/PayoutAccountManager.tsx` |
| H-005 | Short-let reservations use date overlap rules but listing-wide `status/availability_status` can become reserved/occupied. | One future/current stay can make the whole date-based property appear unavailable or conflict with other valid intervals. | Availability/occupancy belong to unit/date intervals; listing publication stays separate. | reservation migrations; listing status checks; D-006 |
| H-006 | Router is a page-key state machine with aliases, local IDs and several shell/back owners. Desktop also separates Conversation and Inbox. | Refresh/back/deep links and workspace continuity depend on entry path; duplicate destinations recreate the exact conflicting UI the owner rejected. | Stable route tree, one shell per workspace, one Inbox, route-derived back. | `src/App.tsx`, `src/lib/nav2.tsx`, shells; owner-confirmed C-001/C-002 |
| H-007 | Complex RLS/state/payment behavior has no meaningful automated test suite or `test` script. | Changes cannot prove actor visibility, invalid transitions, idempotency or CTA disappearance. | Policy contract, transition, ledger and browser regression suites required before consolidation. | `package.json`, repository test inventory |
| H-008 | Hotel operations shows “Message guest” without an existing thread, but `open_my_hotel_booking_conversation` is guest-only; its UI eligibility also includes checked-out/completed stays. | Authorized hotel staff cannot initiate the claimed action, and ended rows can keep an invalid creation CTA. | Create one deterministic stay thread at confirmation or allow either authorized side to idempotently open it; ended stays show View messages only when history exists. | `PartnerHotelOperations.tsx`, `HotelBookingChat.tsx`, live open RPC |

## Medium severity

| ID | CURRENT IMPLEMENTATION | INCONSISTENCY / LEGACY BEHAVIOUR | PROPOSED CANONICAL MODEL | Evidence / decision |
|---|---|---|---|---|
| M-001 | `profiles.role`, `account_kind`, workspace grants, staff scope and hotel membership coexist. | The same actor can be authorized differently by different helper/component generations. | Durable person plus capability grants; transitional domain helpers read one model. | `get_my_workspace_access`, RLS helpers; D-001 |
| M-002 | Hotel manager configures policy/units, but only owner/staff can check in/out; manager Inbox is not consistently exposed. | The manager/front-desk division is neither complete nor documented. | Explicit permission matrix and UI generated from it. | live hotel RPCs; `HotelTeamDashboard.tsx`; D-002 |
| M-003 | Four conversation/message table families and `private_calls` implement related features. | Unread, attachments, archive, block and closure semantics drift. | Canonical thread/read model/capability layer; migrate stores incrementally. | `Chat.tsx`, chat adapters |
| M-004 | Generic support cases remain `partner_support_*` and include legacy sender-role aliases. | Participants and developers cannot infer purpose/ownership from schema names. | Canonical `cases/case_messages` compatibility view/migration. | support schema/functions |
| M-005 | Activity actionability/retention/destination are partly inferred by client regex and aliases. | Real work can be hidden or routed incorrectly; new event naming can duplicate Messages. | Event registry plus explicit action state and canonical destination. | `src/lib/activityFeed.ts` |
| M-006 | Unread totals are composed by multiple hooks, Realtime subscriptions and 15/20/60-second polls. | Badges disagree; duplicate requests and wakeups create glitches. | One Inbox read model, Realtime invalidation, focus/backoff reconciliation. | `Chat.tsx`, `SupportEntryCard.tsx`, dashboard hooks |
| M-007 | Followed searches persist/dedupe and notify, but match invocation depends on publication/update path and saved criteria cannot fully reopen as search state. | An already-live edited listing may newly match without Activity; “view saved search” is incomplete. | Versioned discoverability event and round-trip criteria route. | saved-search UI/migrations |
| M-008 | `inspection_requests` contains multiple workflows and JSON payloads. | Private evidence, field evidence, publication and product preparation can be coupled accidentally. | Split submission, verification case, evidence, public selection and product. | property migrations and `PropertyPipelineWorkspace.tsx` |
| M-009 | Multiple payment, wallet, withdrawal, earning and financial-audit generations coexist. | Balance/state authority and deprecation path are unclear. | Obligation/protection/ledger/settlement/payout model with compatibility projections. | schema inventory; D-010 |
| M-010 | Roommate current flow uses search results; older code still queries `roommate_matches`; `viewed` can mean skip. | Interest/match/activity semantics disagree. | Explicit interest and match state models. | roommate adapters and legacy activity helper |
| M-011 | Some completed/cancelled records retain “Message WeHouse” entry points. | It is unclear whether history, reopen, or a new issue is intended; action can remain after lifecycle end. | Separate View case history from Open a new issue, with eligibility policy. | `MyReservations.tsx`, support entry; D-008 |
| M-012 | Property pipeline and support surfaces poll every 15 seconds alongside Realtime/manual reload. | Extra requests and racey presentation can create the timeout/glitch pattern the owner reported. | One invalidation owner and deduplicated reconciliation. | intervals in `PropertyPipelineWorkspace.tsx`, `SupportEntryCard.tsx` |
| M-013 | Physical rooms in `cleaning` count as operational capacity for future sale; no explicit turnover buffer. | Same-day readiness assumptions are implicit. | Hotel-defined turnover/ready-by policy or clear future-capacity rule. | `bind_hotel_sales_to_operational_rooms`; D-007 |
| M-014 | Direct table policies are sometimes broader/different than safer SECURITY DEFINER public projections. | A client can choose the less protective interface if fields are present on the table. | Explicit field-safe views/RPCs and least-privilege table grants. | hotel public-detail RPC vs table policies |
| M-015 | The live advisor reports 320 authenticated-executable SECURITY DEFINER functions. | Many are intended RPC boundaries, but helpers and legacy/admin functions share the exposed API surface; internal actor checks have no central allowlist proof. | Inventory every function as public endpoint/internal helper, revoke default EXECUTE, grant only intentional endpoints, and contract-test authorization. | [Supabase advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) |
| M-016 | `worker_showcase_comments` has RLS enabled and no policies. | The table is inaccessible by default or depends on an undocumented RPC-only path, indicating a partial/dead implementation. | Document RPC-only ownership or remove/migrate the dead table after caller tracing. | [Supabase advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) |
| M-017 | Leaked-password protection is disabled. | Password authentication accepts credentials known in breach corpora. | Enable after login/recovery regression testing and user communication. | [Supabase Auth guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) |
| M-018 | Property Operations threads share the same title/avatar and rely on tiny case metadata; hotel operations mixes a lifecycle strip with a long stack of editable modules. | Distinct cases look duplicated, and status/progress looks like navigation. | Present case context first, keep one WeHouse identity secondary, and give the hotel record stable entity subroutes/sections unrelated to status. | supplied `151971.mp4`, `151972.mp4`, `151973.mp4` |

## Low severity

| ID | CURRENT IMPLEMENTATION | INCONSISTENCY / LEGACY BEHAVIOUR | PROPOSED CANONICAL MODEL | Evidence |
|---|---|---|---|---|
| L-001 | Home/Overview, Chats/Messages/Inbox, verification/Worker Operations, field_officer/Field Operations labels coexist. | Vocabulary shifts by screen. | Approved product dictionary used by code and docs. | workspace components |
| L-002 | Dashboard wrapper components preserve old names and nesting. | Search results and ownership are harder to follow. | Remove after route/shell migration. | `StaffDashboard`, `WorkerDashboard`, `PropertyPartnerDashboard` |
| L-003 | Root contains old audit/master/phase reports and loose SQL; there are several migration directories. | Competing “truth” makes future work follow stale instructions. | `/docs` is product contract; one migration authority and archive policy. | repository root, migration directories |
| L-004 | Hotel timezone is hard-coded to Lagos. | Multi-timezone operation will calculate arrival incorrectly. | Per-hotel IANA timezone with Nigerian default. | hotel lifecycle migration |
| L-005 | Paystack return URL is hard-coded to production host. | Preview/custom-domain flows are brittle. | Validated environment-based return origin. | `payment-init` Edge Function |
| L-006 | Tailwind surfaces/buttons/cards are composed ad hoc across shells. | Same visual shape means module, entity, filter and action; dashboards feel like disconnected cards. | Shared semantic layout/components and interaction tokens. | workspace/page components |
| L-007 | `supabase/config.toml` local project name does not expose live project ref/application migration version. | Deployment status is easy to confuse with migration status. | Record app SHA and DB migration version independently. | config and live project metadata |
| L-008 | Advisor reports 14 unindexed foreign keys, 75 unused indexes and 15 multiple-permissive-policy cases. | Historical schema churn adds query/policy cost and makes authorization harder to inspect; unused-index statistics alone are not a deletion instruction. | Measure workloads, consolidate policies, add missing relationship indexes, and remove indexes only after production evidence. | [Supabase performance advisors](https://supabase.com/docs/guides/database/database-linter) |

## Safe migration order

### Phase 0 — Contract freeze

- Owner approves genuine decisions in [DECISION_LOG.md](./DECISION_LOG.md).
- Freeze vocabulary, state values, actor/actions and event registry.
- Declare `supabase/migrations` the only executable schema source; archive but do not delete historical material yet.

Exit gate: product, engineering and operations can describe each state/action identically.

### Phase 1 — Safety harness before refactor

- Add isolated Supabase policy tests for every actor/record relationship.
- Add transition tests for valid/invalid states and webhook replay.
- Add fixtures that contain unrelated, out-of-scope, revoked and suspended actors.
- Classify all exposed SECURITY DEFINER functions and restrict EXECUTE to an explicit endpoint allowlist.
- Add browser smoke flows for each workspace and CTA-disappearance assertions.

Exit gate: tests reproduce H-001 through H-007 and protect currently correct flows.

### Phase 2 — Authorization repair

- Centralize hotel access/action helpers and bring room/inventory/unit policies into scope agreement.
- Narrow direct customer and privileged writes to transition RPCs.
- Reconcile profile-role and workspace-grant reads without removing compatibility yet.

Exit gate: the full role matrix passes in database tests; anonymous public projection reveals no protected fields.

### Phase 3 — State and money safety

- Resolve job state vocabulary and represent protection as a money aggregate.
- Replace uncancelled mutation timeouts with idempotent reconciliation.
- Establish obligation/ledger authority and parity-check old wallets/withdrawals.
- Separate short-let interval availability from listing publication.

Exit gate: replay/race tests show one economic effect; all current database states render valid UI.

### Phase 4 — Canonical read models

- Build one Inbox/Activity/unread projection and domain capability payloads.
- Add discoverability-change events and saved-search match versioning.
- Add compatibility adapters for existing message/payment/entity stores.

Exit gate: old and new read models reconcile; no badge or destination mismatch in telemetry/tests.

### Phase 5 — Navigation and design system

- Introduce stable route tree and one shell/header/back contract.
- Remove duplicate Conversation/Inbox/Activity destinations through redirects.
- Standardize Overview and semantic controls (module, entity, filter, status, action).

Exit gate: direct link/refresh/back works for every detail; workspace switches preserve identity and valid destination.

### Phase 6 — Aggregate consolidation

- Split property submission/evidence/publication records.
- Consolidate threads/cases, roommate interest/match, worker verification, and money stores one domain at a time.
- Backfill, dual-read, compare, switch writes, then retire compatibility objects.

Exit gate: no old callers in telemetry; counts and state histories reconcile exactly.

### Phase 7 — Removal and governance

- Remove route aliases, wrappers, old status maps/tables/functions and redundant polling only after exit criteria.
- Archive outdated reports/SQL and document deprecations/removal commits.
- Require contract/test update for every product-state change.

## Do not do

- Do not rewrite the entire database/router/inbox in one release.
- Do not delete legacy tables before backfill and parity evidence.
- Do not “fix” visibility only in components while broad RLS remains.
- Do not translate old statuses opportunistically in each screen.
- Do not add more timeouts or polling loops as consistency architecture.
- Do not infer migration success from Vercel/GitHub deployment status.
