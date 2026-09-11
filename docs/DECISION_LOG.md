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
| D-001 | Can a verified Worker or Property Partner also enter a normal personal consumer workspace under the same identity? | `get_my_workspace_access` enables personal only for `account_kind=consumer`; the desired identity/grant model suggests multiple capabilities. | Yes: one person can hold consumer plus work capabilities; workspace switch changes authority context, not identity. |
| D-002 | May hotel managers check guests in/out and use guest Inbox, or is that strictly owner/front desk? | Manager can set policy/edit rooms; transition RPC excludes manager; UI Inbox favors staff. | Let owner explicitly grant `guest_communication` and `stay_transition`; default manager yes, front desk yes. |
| D-003 | Is Admin globally privileged or geographically scoped? | Many helpers scope Admin; some direct room/inventory policies are global. | Admin is scoped by default; Creator is global. Exceptional cross-scope Admin access requires a separate audited grant. |
| D-004 | After the public base-table privacy defect is fixed, should a completed paid guest retain exact address/location access to an inactive hotel forever? | `get_public_hotel_detail` treats paid `checked_out/completed` as exact-location eligible. | Retain address in the guest's booking receipt/history, but do not grant perpetual broader internal hotel-record access. |
| D-005 | What is the canonical lifecycle for a hotel booking after `checked_out`: immediate completion or a review/settlement window? | Both `checked_out` and `completed` exist; current transition stops at checked_out. | Keep `checked_out` for a short settlement/incident window, then system-complete. |
| D-006 | How should apartment short-let supply represent simultaneous future stays and current occupancy? | Date overlap logic exists, but listing-wide reserved/occupied state conflicts. | Use per-unit/date holds and occupancy; listing remains published/available when other dates are sellable. |
| D-007 | Do hotel cleaning/turnover times reduce same-day/future sellable capacity? | Cleaning units count as operational capacity for quote bounds; no turnover buffer exists. | Add hotel-defined turnover/readiness policy; only same-day assignment needs real ready capacity, future sale uses forecast capacity. |
| D-008 | After completion/cancellation, should users be able to message an old WeHouse case, open a new issue, or only view history? | Some booking pages keep Message WeHouse; hotel direct chat closes. | Old case becomes read-only; a separately labelled “Report an issue” creates a new linked case within policy/retention window. |
| D-009 | Is `payment_protected` a worker job state or only a money state, and when does the job become `confirmed`? | Migrations/UI use both; current payment confirmation may set `confirmed` while protection row says protected. | Protection is a money state; job uses `confirmed/ready_to_start`, derived only when required protection is active. |
| D-010 | Which wallet/withdrawal/payment tables are authoritative during consolidation? | Multiple live generations exist and repository naming is insufficient to prove operational source for every path. | Trace live writers/readers and balances; choose immutable ledger as authority, keep old stores as reconciled projections until parity. |
| D-011 | Is Worker block pair-wide across all historical/current jobs or specific to one relationship/thread? | Current RPC applies pair-wide; UI entry can look thread-specific. | Pair-wide for personal safety, with explicit warning and separate per-job dispute resolution. |
| D-012 | What does roommate “skip” mean? | Current `viewed` can mean seen/skip; `declined` exists elsewhere. | Distinguish `viewed`, `passed`, `interest_sent`, `interest_declined`, and `withdrawn`. |
| D-013 | Can a user resume a paused followed search and receive matches published while paused? | Current model resumes without a stated replay contract. | No automatic replay; show current matching results on open and notify only for new match versions after resume. |
| D-014 | What are the exact post-publication edit rights for Property Partner versus Operations/Admin? | Partner can operate hotel details through specific RPCs; publication records and direct table policies are uneven. | Partner controls commercial/operational fields; changes to identity, verified location, capacity provenance or approved public media require scoped review. |
| D-015 | Is Nigeria/Lagos the permanent product jurisdiction? | Scope concepts and hard-coded timezone/domain point to Nigeria, but model is not explicit. | Declare Nigeria-only v1; still store IANA timezone per hotel to avoid hidden assumptions. |

## Decision process

For each open item, record the selected option, owner, date, rationale, affected rules/lifecycles, rollout/migration, and tests. Do not treat implementation order or an existing legacy branch as approval. Once approved, move the decision to Confirmed, update the canonical sections, and reference the enforcing migration/commit.
