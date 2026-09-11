# Product Rules and Invariants

## Authority

These rules are the review checklist for future WeHouse changes. A proposed change that violates one needs an explicit approved decision and an update to this contract before implementation.

## CURRENT IMPLEMENTATION

The repository already enforces some of these rules in newer database functions: hotel chat closes at checkout, worker blocking preserves secured money, private property evidence is separated from public assets, followed searches have canonical keys, and physical hotel units cannot be edited while occupied. Other rules are enforced only in UI or applied inconsistently across domains.

## INCONSISTENCIES / LEGACY BEHAVIOUR

Rules currently live in SQL migrations, SECURITY DEFINER functions, RLS policies, Edge Functions, frontend status arrays, button conditions, route aliases, and copy. There is no shared registry or test generator, so the UI can omit a valid database state (`payment_protected`) or display an action whose RPC will reject it.

## PROPOSED CANONICAL MODEL

### Cross-system invariants

| ID | Rule |
|---|---|
| R-001 | A person has one durable identity. Workspace grants and role revocation never delete or recreate the personal account. |
| R-002 | Permissions depend on actor, active grant, action, relationship/assignment, and scope—not the screen or client role string. |
| R-003 | Status is not navigation. Statuses may filter a record list or label a record; they are never top-level destinations. |
| R-004 | A domain state has one canonical meaning across database, API, UI, Activity, and analytics. |
| R-005 | Every state change uses an explicit transition service/RPC that validates source state and actor and writes an audit event. Direct generic updates must not bypass it. |
| R-006 | A completed, cancelled, expired, blocked, or otherwise invalid action removes its original CTA on the next authoritative projection. |
| R-007 | Reading an Activity item never completes its underlying action. Completing the domain action resolves the item. |
| R-008 | A booking/job/match has at most one conversation identity for each declared purpose. Route aliases cannot create another thread. |
| R-009 | Inbox is the communication destination. Conversation and Activity are nested views/details, not competing top-level tabs. |
| R-010 | Every message and call rechecks participant capability at execution time. Opening a screen is not authorization. |
| R-011 | A block in either direction stops direct messages and calls everywhere. Blocking never makes an automatic decision about secured money. |
| R-012 | Private verification evidence never becomes public. Public media comes only from explicitly selected, approved derivatives with provenance. |
| R-013 | Public discovery projections reveal only deliberately allowlisted fields; exact location, identity, evidence and credentials follow relationship permissions. |
| R-014 | Booking/check-in/security codes are credentials, not labels. They never appear in chat headers, thread lists, notifications or general Activity. |
| R-015 | Publication, availability, reservation, payment, communication and occupancy are independent dimensions. One overloaded status must not represent them all. |
| R-016 | Hotel dates select an interval; hotel check-in/out times define local arrival/departure policy; physical room state controls operations. Changing one does not silently rewrite the others. |
| R-017 | A physical room can have at most one current occupant assignment, and `occupied` must agree with that assignment. Checkout moves it to cleaning, not ready. |
| R-018 | Sellable capacity cannot exceed valid physical/operational capacity or conflict with existing interval holds. |
| R-019 | Browser state, redirects and toasts never establish payment. Only idempotent server/provider verification can do so. |
| R-020 | A mutation timeout is `unknown/reconciling` unless cancellation is proven. It must not invite a duplicate payout/payment/profile mutation. |
| R-021 | Protected funds remain protected through block, dispute, connection loss and late webhook races until an authorized audited resolution. |
| R-022 | Settlements, refunds and reversals use immutable compensating records. Economic history is never deleted or silently overwritten. |
| R-023 | Notifications describe real domain facts. UI events such as draft saved, tab opened or message viewed are not product Activity. |
| R-024 | Ordinary chat messages belong to Messages unread, not Activity unread. Announcements remain distinct from both. |
| R-025 | One canonical event key prevents duplicate recipient Activity for one domain fact. |
| R-026 | A followed search has one semantic criteria identity per user/kind; following is idempotent and future match delivery is deduplicated. |
| R-027 | Stopping a roommate search does not destroy established matches, conversations, shared housing or money history. |
| R-028 | Unblocking restores only permitted contact. It never resurrects a cancelled/disputed job, stay or shared-housing agreement. |
| R-029 | Entity cards display entities. Module/navigation controls display destinations. Status pills display state. Primary buttons display the single next domain action. Their visual roles must not be interchangeable. |
| R-030 | Every screen belongs to one shell with one header/back contract; back returns to the prior location and preserved list state. |
| R-031 | Realtime invalidates canonical read models; focus/reconnect reconciliation and backoff are safety nets. Fixed polling is not the primary consistency model. |
| R-032 | UI labels come from product vocabulary: Overview for workspace landing, Inbox for communication, and actor/team names that match actual responsibility. |
| R-033 | Every privileged or economic override records actor, reason, previous state, resulting state and correlation ID. |
| R-034 | Compatibility aliases have an owner, telemetry and removal date; they do not become permanent alternate product concepts. |

### UI action to domain action map

| UI intent | Underlying domain action | Required authoritative result | CTA after success |
|---|---|---|---|
| Add property | Begin/edit a meaningful `property_submission` draft | Draft exists only after real progress | Continue draft; do not say property submitted |
| Send property | Submit batch and private access evidence | Verification case in `access_review` | View submission; Send disappears |
| Accept access evidence | Verify private evidence | Case advances to field assignment | Accept/reject disappear |
| Select gallery | Approve public derivative sources | Public-media selection recorded with provenance | Selection action becomes view/edit only until publication boundary |
| Publish property/hotel | Approve discoverability | Published product becomes live and match event emitted | Publish disappears |
| Follow search | Idempotently persist normalized criteria | Saved search returned with active state and stable key | Shows Following; duplicate follow disabled |
| Resume alerts | Reactivate same saved search | State active, no duplicate row | Shows Following/Pause |
| Unfollow | Delete/disable saved-search subscription | Server confirms no active subscription | Follow becomes available |
| Reserve/book | Create authoritative reservation and hold | Server returns booking/quote snapshot | Pay/view booking; Book disappears for same intent |
| Pay | Initialize exact obligation | Provider pending reference | Checking/continue payment, never Paid before verify |
| Message hotel | Open existing/one stay thread | Paid confirmed/checked-in capability | Opens thread; after checkout action disappears |
| Check in | Validate paid booking, local time and ready room; allocate unit | Booking checked in + unit occupied atomically | Check out; Check in disappears |
| Check out | End occupancy and release unit to cleaning | Booking checked out + unit cleaning atomically | History/review; Message hotel and Check out disappear |
| Block worker | Set pair safety block and classify all nonterminal jobs | Contact stopped; unsecured cancelled; secured disputed/review | Unblock/report; send/call/continue-job CTAs disappear |
| Approve completed service | Authorize protected-fund settlement | Job released and ledger credited once | Review/history; Approve disappears |
| Mark room ready | Complete operational cleaning/maintenance state | Physical unit ready and unassigned | Ready status; Mark ready disappears |
| Mark Activity read | Advance recipient read cursor | Read timestamp only | Unread badge disappears; domain CTA remains if unresolved |
| Resolve case | Complete the case work state | Case resolved with resolution event | Reply/reopen according to policy; original operational CTA disappears |
| Request withdrawal | Reserve available earnings and create payout request | Awaiting review with stable transfer reference | View status; duplicate request disappears |

### Action visibility algorithm

The server/read model should return capabilities, or the UI should derive them from the exact same generated transition contract:

1. Load authoritative record and actor grant.
2. List transitions whose source state, actor permission, scope, temporal rule, money prerequisite, block rule and capacity invariant are satisfied.
3. Show no more than one primary action; secondary actions must be genuinely distinct domains such as Help or Cancel.
4. On success or external event, invalidate/reload the record and Activity projection.
5. Remove the source action. Never keep it as a harmless disabled decoration when the action is finished.

### Timeouts and consistency

- A timeout is a transport observation, not a domain state.
- Client timers may stop spinners or abandon reads. Mutation APIs require idempotency, cancellation where real, and reconciliation where cancellation cannot be proven.
- Do not add timeout races to “fix” a slow call. Measure latency, surface progress, allow navigation where safe, and make operations durable.
- Avoid parallel polling loops for the same aggregate. Use a single invalidation owner and deduplicated request/cache.

### Design and shell rules

- Use one page background/chrome hierarchy per workspace, not a card containing another pseudo-page.
- Back belongs in the screen header and has a route-derived destination.
- Tabs switch peer views of the same scope. Modules navigate. Filters refine a list. Pills label state.
- Keep mobile continuity: opening a conversation or record preserves the parent list and returns to it.
- A dashboard Overview summarizes work and next actions; it must not duplicate every navigation destination as a collection of oversized buttons/cards.

## Enforcement

These invariants should become database constraints/RPC tests where possible, TypeScript types/read-model capability tests in UI, and end-to-end browser scenarios for visibility. Code review should cite rule IDs when accepting a deliberate exception.
