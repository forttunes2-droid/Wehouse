# Decision Log

## Status meanings

- **Confirmed direction:** explicitly stated by the product owner in the requests that led to this audit; implementation still requires migration/testing.
- **Repository-established:** current implementation is coherent enough to document as the baseline, subject to regression tests.
- **Open:** repository contains conflicting behavior or does not establish a trustworthy answer; owner approval is required.

## Confirmed directions

| ID | Decision | Status | Consequence |
|---|---|---|---|
| C-001 | Inbox is the single communication destination; Conversation is a thread detail and Activity is a sibling view, not a separate top-level product. | Confirmed direction | Remove duplicate desktop/mobile destinations through compatible routing; preserve one Inbox state/back path. |
| C-002 | Creator and Admin workspace landing pages are named Overview; duplicate/conflicting tabs must be removed. | Confirmed direction | Apply vocabulary consistently; statuses remain list filters, not navigation. |
| C-003 | Hotel chat must not expose the booking/check-in code. | Confirmed direction and currently implemented | Code appears only in the protected booking/check-in context while valid. |
| C-004 | Completed or no-longer-valid actions must disappear. | Confirmed direction | Every transition specifies CTA disappearance; Activity action resolves from domain state. |
| C-005 | Hotels define real check-in and checkout times while room/date availability remains independent. | Confirmed direction and substantially implemented | Preserve separate stay policy, date interval, room type and physical-unit states. |
| C-006 | Worker blocking stops messages/calls but must not corrupt an active job or lose protected payment. | Confirmed direction and substantially implemented | Pair safety gate; unsecured pre-work may cancel, secured/active work moves to WeHouse review. |
| C-007 | Followed searches must persist, deduplicate, detect Following, be manageable, and create matching future Activity. | Confirmed direction and substantially implemented | Complete round-trip reopen and universal discoverability-event matching. |
| C-008 | Do not add arbitrary timeouts as a fix for slow behavior. | Confirmed direction | Reads may be bounded; uncertain mutations reconcile instead of reporting false failure. |
| C-009 | Property Partner and privileged dashboards must be cohesive workspaces, not collections of disconnected cards and attached back buttons. | Confirmed direction | One route/shell/design hierarchy; module, entity, filter, status and action have distinct presentation. |
| C-010 | Hotel actions are authorized by explicit scoped capabilities; Owner, Manager and Front Desk labels are only default presets. | Confirmed direction | Enforce the locked contract in [D-002](./DECISION_D002_HOTEL_CAPABILITY_AUTHORITY_2026-09-12.md). |
| C-011 | Canonical money authority is `booking_payments`, protection/release records, `wallets`, append-style transactions, `withdrawals`, commission history and verified provider settlement. | Confirmed direction | Follow the no-bulk-rewrite consolidation in [D-010](./DECISION_D010_MONEY_AUTHORITY_2026-09-12.md). |
| C-012 | Partners control future commercial terms through narrow audited commands; verified property facts and approved public media return through review. | Confirmed direction | Enforce the locked boundary in [D-014](./DECISION_D014_POST_PUBLICATION_EDIT_BOUNDARY_2026-09-12.md). |
| C-013 | One Personal identity may keep normal consumer access while independently holding Worker or Property Partner workspaces. | Confirmed direction | Workspace context changes capability, not personhood; revocation does not delete the Personal account. |
| C-014 | Worker onboarding, professional review, Reviewed, Trusted, discovery and eligible jobs are free; only optional Pro software is paid monthly. | Confirmed direction | Gold is explicitly `PRO` and appears only for an active server-verified subscription; Pro never buys trust, ranking, safety or licensing. |
| C-015 | Hotel and Short Let money remains protected through a disclosed arrival-issue window after authorized check-in; check-in and checkout are not payout instructions. | Confirmed direction and implemented on preview | Default/minimum is 2 hours; a property or rate package may extend it to 4 hours; the booking snapshots the duration and deadline. |
| C-016 | A Short Let caution fee is refundable by default and cannot be used as a cancellation penalty. | Confirmed direction and implemented on preview | Partner has 24 hours after effective checkout for an itemized evidence-backed claim; notified guest has 48 hours to accept, counter or dispute; silence never awards the Partner and the undisputed remainder is refunded. |
| C-017 | Accommodation cancellations use Creator-approved Flexible, Standard or Non-refundable templates. | Confirmed direction; commercial values still gated | Exact percentages/deadlines require separate commercial and legal approval; provider inability or overbooking produces a full refund. |
| C-018 | Manual hotel operation is supported; connected PMS support is certified one named adapter at a time. | Confirmed direction and implemented fail-closed on preview | No provider is treated as certified by default and WeHouse must not claim universal PMS compatibility. |

## Repository-established decisions

| ID | Decision | Status | Evidence |
|---|---|---|---|
| R-001 | Private partner access evidence is not public media; Operations deliberately selects approved public derivatives. | Repository-established | property evidence/gallery RPCs and Storage workflow |
| R-002 | A hotel booking receives a physical room unit at check-in; checkout moves the unit to cleaning. | Repository-established | `partner_transition_hotel_booking` |
| R-003 | Hotel direct participant chat is available only for paid confirmed/checked-in stays; history remains readable after closure. | Repository-established | live open/send RPCs |
| R-004 | Roommate conversation creation may be lazy so empty composers do not clutter Inbox, but identity must remain deterministic. | Repository-established | `ensure_my_roommate_conversation` flow |
| R-005 | Exact duplicate followed searches are idempotent and semantically keyed. | Repository-established | canonical saved-search migration/RPC |
| R-006 | Reading Activity is independent from completing its business action. | Repository-established direction, incompletely enforced | `activityFeed.ts` comments/logic and notification model |

## Decisions requiring owner approval

| ID | Product decision | Conflicting evidence/options | Recommended default |
|---|---|---|---|
| D-003 | Is Admin globally privileged or geographically scoped? | Many helpers scope Admin; some direct room/inventory policies are global. | Admin is scoped by default; Creator is global. Exceptional cross-scope Admin access requires a separate audited grant. |
| D-004 | After the public base-table privacy defect is fixed, should a completed paid guest retain exact address/location access to an inactive hotel forever? | `get_public_hotel_detail` treats paid `checked_out/completed` as exact-location eligible. | Retain address in the guest's booking receipt/history, but do not grant perpetual broader internal hotel-record access. |
| D-005 | What is the canonical non-financial lifecycle for a hotel booking after `checked_out`: immediate completion or a later system completion? | Both `checked_out` and `completed` exist; current transition stops at checked_out. Accommodation payment release is now independently governed by the snapshotted arrival-issue deadline and any open case. | Keep `checked_out` for a short service/review window, then system-complete; never use checkout itself as a payout signal. |
| D-006 | How should apartment short-let supply represent simultaneous future stays and current occupancy? | Date overlap logic exists, but listing-wide reserved/occupied state conflicts. | Use per-unit/date holds and occupancy; listing remains published/available when other dates are sellable. |
| D-007 | Do hotel cleaning/turnover times reduce same-day/future sellable capacity? | Cleaning units count as operational capacity for quote bounds; no turnover buffer exists. | Add hotel-defined turnover/readiness policy; only same-day assignment needs real ready capacity, future sale uses forecast capacity. |
| D-008 | After completion/cancellation, should users be able to message an old WeHouse case, open a new issue, or only view history? | Some booking pages keep Message WeHouse; hotel direct chat closes. | Old case becomes read-only; a separately labelled “Report an issue” creates a new linked case within policy/retention window. |
| D-009 | Is `payment_protected` a worker job state or only a money state, and when does the job become `confirmed`? | Migrations/UI use both; current payment confirmation may set `confirmed` while protection row says protected. | Protection is a money state; job uses `confirmed/ready_to_start`, derived only when required protection is active. |
| D-011 | Is Worker block pair-wide across all historical/current jobs or specific to one relationship/thread? | Current RPC applies pair-wide; UI entry can look thread-specific. | Pair-wide for personal safety, with explicit warning and separate per-job dispute resolution. |
| D-012 | What does roommate “skip” mean? | Current `viewed` can mean seen/skip; `declined` exists elsewhere. | Distinguish `viewed`, `passed`, `interest_sent`, `interest_declined`, and `withdrawn`. |
| D-013 | Can a user resume a paused followed search and receive matches published while paused? | Current model resumes without a stated replay contract. | No automatic replay; show current matching results on open and notify only for new match versions after resume. |
| D-015 | Is Nigeria/Lagos the permanent product jurisdiction? | Scope concepts and hard-coded timezone/domain point to Nigeria, but model is not explicit. | Declare Nigeria-only v1; still store IANA timezone per hotel to avoid hidden assumptions. |

## Decision process

For each open item, record the selected option, owner, date, rationale, affected rules/lifecycles, rollout/migration, and tests. Do not treat implementation order or an existing legacy branch as approval. Once approved, move the decision to Confirmed, update the canonical sections, and reference the enforcing migration/commit.
