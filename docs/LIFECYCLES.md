# Lifecycles and State Machines

## Reading this document

The tables below are the proposed canonical transition contract grounded in the current implementation. “UI shown” names the domain action, not a specific button label. “Disappear” is mandatory after the transition. Invalid transitions must be rejected by the database/API even if a stale client displays them.

## PROPERTY

### CURRENT IMPLEMENTATION

Supply verification is primarily stored on `inspection_requests`. The current stages are `access_required`, `access_review`, `inspection_ready`, `inspection`, `awaiting_review`, `ready_to_prepare`, `listing_prepared`, `live`, `changes_requested`, and `rejected`. Submission batches/drafts are stored separately, but the inspection record also carries access evidence, field evidence, selected gallery data, draft listing/hotel links, and hotel program JSON.

`PropertyInspectionRequestPanel.tsx` creates a draft batch only after a meaningful field change, not merely when Add property is opened. It debounces a genuine changed draft for 700 ms, removes empty legacy batches on hydration, and calls `create_my_property_inspection_batch_v4` only after required data, photos, a current access challenge, and a private access recording are present. `PropertyPipelineWorkspace.tsx` drives `review_property_access_evidence`, field assignment/review, deliberate gallery preparation, listing preparation, and Admin/Creator publication.

Customer apartment occupancy is represented by `reservations` and listing-wide `status`/`availability_status`. Long stay and short stay share much of this model, although short stay also uses dates.

### Canonical transition table

| Current state | Event/action | Permitted actor | Resulting state | UI action shown | UI actions that must disappear | Activity generated | Conversation consequences | Payment consequences | Invalid transitions |
|---|---|---|---|---|---|---|---|---|---|
| Draft with meaningful progress | Save draft | Property Partner | Draft | Continue/edit/delete draft | “Saved” must not imply submitted or approved | None; draft saving is not Activity | None | None | Empty untouched form must not create a visible saved property |
| Draft complete | Submit property and private access evidence | Property Partner | `access_review` | View submission; correct only if requested | Submit same batch; public preview of private evidence | Property Operations receives access-review work | Create/open one property-operations case when needed | None | Missing/expired challenge, insufficient media, invalid authority/location |
| `access_review` | Accept private access evidence | Property Operations in scope | `inspection_ready` | Assign Field Operations | Accept/reject access again | Partner informed; assignment becomes actionable | Existing property case continues | None | Self-review by partner; expose private recording publicly |
| `access_review` | Request corrected access evidence | Property Operations | `changes_requested` / access correction required | Upload correction | Field assignment/publication | Partner gets exact correction request | Same case remains | None | Approval without valid evidence |
| `inspection_ready` | Assign visit | Property Operations in scope | `inspection` | Field assignee records visit/evidence | Assign duplicate active visit | Assignee and partner notified | Same case; no duplicate identity | None | Out-of-scope/unavailable assignee |
| `inspection` | Submit independent field evidence | Assigned Field Operations | `awaiting_review` | Operations reviews evidence | Submit second active evidence set unless correction requested | Operations review event | Same case | None | Partner submitting as field verifier; private evidence copied directly to public gallery |
| `awaiting_review` | Accept field evidence | Property Operations | `ready_to_prepare` | Select deliberate public gallery | Re-review as pending | Partner/oversight informed | Same case | None | Missing required evidence |
| `awaiting_review` | Request field correction | Property Operations | `inspection` / changes requested | Assigned officer corrects evidence | Prepare/publication | Assignee gets correction event | Same case | None | Treat correction as new public submission |
| `ready_to_prepare` | Select and publish approved derivatives | Property Operations | Gallery approved | Prepare listing/hotel record | Select unapproved private media; publish | Editorial preparation work | Same case | None | Any source not validated by `is_valid_inspection_public_image` or equivalent |
| Gallery approved | Prepare commercial record | Property Operations | `listing_prepared` | Admin/Creator reviews final record | Partner self-publication | Oversight review event | Same case | None | Missing pricing/type/capacity/public media |
| `listing_prepared` | Approve/publicize | Admin or Creator under approved governance | `live`; listing discoverable | View live record / operate availability | Publish, approve, or “continue setup” | Partner receives publication event; followed-search matches may fire | Property case becomes history/read-only unless reopened | None | Publication with unresolved verification or unapproved media |
| `live` + availability | Customer reserves | User | Reservation `payment_pending`; supply hold appropriate to product | Pay reservation fee; cancel if allowed | Reserve same unit/period again | User and operations receive reservation-created event | One reservation-operations case identity, opened on demand | Pending authoritative payment record | Overlapping dates/capacity; booking own supply; stale quote |
| Reservation fee verified | Server payment confirmation | Payment service/webhook | `reserved` or `inspection_pending` | Pay remaining required amount / request inspection | Pay the same fee; generic “reserve” | Payment-confirmed domain event | Same reservation case | Ledger entry; purpose marked paid | Client toast as authority; replay creates duplicate settlement |
| `reserved` | Request optional inspection (long-stay) | User | `inspection_pending` | Coordinate inspection | Request another active inspection | Field/Operations assignment event | Same reservation case | No automatic refund/settlement | Short-stay/hotel using this property-inspection path |
| Reserved/inspection complete | Pay rent/stay/deposit requirements | User + payment server | `ready_for_move_in` | Request handover/check-in at valid time | Pay completed obligation | Payment and readiness events | Same case; direct participant chat follows domain policy | Held/settled obligations recorded separately | Move-in before required money or verified inspection rule |
| `ready_for_move_in` | Verify handover/check-in | Assigned Operations with credential | `occupied` / active tenancy | View active stay/tenancy; report issue | Check in again; pre-move-in CTAs | Move-in/check-in event | Conversation remains available per relationship policy | Deposit/protected obligations remain held | Wrong/expired code, early handover, unrelated actor |
| `occupied` | Complete/terminate | Authorized Operations; cancellation/dispute rules may involve user/partner/finance | `completed`, `cancelled`, or review state | History, review, legitimate post-completion case | Original pay/move-in/check-in/complete request CTAs | Completion/termination and any refund-due events | Operational chat closes or becomes read-only; support history remains | Settle partner earning; return/hold deposit; refund if required | Deleting financial/evidence history; reopening via UI-only state |

### INCONSISTENCIES / LEGACY BEHAVIOUR

- `inspection_requests` is both workflow aggregate and storage for draft IDs, access evidence, field evidence, publication selection, and hotel program payload.
- `listings.status` and `listings.availability_status` duplicate overlapping values.
- A listing-wide `reserved`/`occupied` status conflicts with a short-let calendar that permits several non-overlapping future reservations.
- `user_inspection_requests` (customer inspection) and `inspection_requests` (partner verification) sound interchangeable but represent different domains.
- The property pipeline polls every 15 seconds even though it also has event/reload opportunities.
- Support remains available from some completed reservation views; whether that means “open a new issue” or “view history” is not explicit.

### PROPOSED CANONICAL MODEL

Split `property_submission`, `verification_case`, `private_evidence`, `public_media_selection`, `property`, `sellable_unit`, `availability_calendar`, and `reservation`. A property is never “reserved” globally when the sellable product is date-based; holds and occupancy belong to a unit/date interval. Publication and availability are orthogonal.

## HOTEL

### CURRENT IMPLEMENTATION

`hotels` has `draft/active/inactive`; `hotel_rooms` represents room types; `hotel_room_units` represents physical rooms with `ready/occupied/cleaning/maintenance/out_of_service`; `hotel_inventory_daily` and `hotel_rate_plans` control dated sale. `hotel_bookings` has `pending/confirmed/checked_in/checked_out/cancelled/completed/refunded/expired/payment_conflict` and a separate payment status. Migration `20260911120000_hotel_stay_policy_and_room_lifecycle.sql` adds real check-in/out times and units; `20260911131500_bind_hotel_sales_to_operational_rooms.sql` binds quotes to operational capacity.

### Canonical transition table

| Current state | Event/action | Permitted actor | Resulting state | UI action shown | UI actions that must disappear | Activity generated | Conversation consequences | Payment consequences | Invalid transitions |
|---|---|---|---|---|---|---|---|---|---|
| Submission verified | Prepare hotel | Property Operations | Hotel `draft` with room-type drafts | Complete room/rate/inventory/public media | Publish before complete | Oversight preparation event | Property-operations case continues | None | Private evidence as public media |
| Hotel `draft` | Configure stay policy, room types, units, rates | Owner/manager plus scoped Operations where approved | Operational draft | Preview and request publication | Booking/check-in | Configuration is not user Activity | Internal case only | None | Zero capacity, invalid times/rates, deleting allocated units |
| Hotel `draft` complete | Publish | Admin/Creator | Hotel `active` | Operate and discover | Publish/approve again | Partner + matching followed-search events | Operations case becomes history | None | Missing approved media or room/rate inventory |
| Active room type | Set dated inventory/rate/closure | Owner/manager/authorized staff | Availability row | Edit future dates | None after date passes; stale action not actionable | Usually no customer Activity until a matching availability event is intentionally supported | None | No payment | Quantity above physical operational capacity; past dates; negative price |
| Active, quoted availability | Create reservation | User | Booking `pending`, payment `unpaid/payment_pending`; interval held | Pay | Book same hold | Booking-created event | Hotel chat must not open yet; support on payment issue only | Pending hotel payment | Checkout ≤ check-in; overlap/capacity failure; stale price |
| Payment pending | Verify payment | Server/webhook | Booking `confirmed`, payment `paid` | Message hotel; view check-in details at correct stage | Pay/confirm again | Confirmation to guest and hotel | Exactly one stay conversation may be opened | Verified ledger/payment row | Browser redirect/toast alone confirms booking |
| `confirmed`, before local check-in time | Time passes | System | `confirmed` | Arrival details; chat | Check-in action until time is valid | Optional upcoming-arrival event | Chat remains writable | Paid remains | Early check-in unless explicit exception policy exists |
| `confirmed`, paid, valid window | Check in and allocate ready unit | Owner/front desk (manager decision open) | `checked_in`; unit `occupied` | Check out; stay support | Check in; pay; reserve | Check-in event | Guest chat remains writable | No settlement solely from check-in unless policy states it | No ready unit, wrong hotel, unpaid, after departure |
| `checked_in` | Stay | Guest/hotel team | `checked_in` | Message hotel; report issue | Booking/payment/check-in CTAs | Real stay events only | Writable guest↔hotel thread | Funds remain according to settlement schedule | Editing occupancy unit behind booking |
| `checked_in` | Check out | Owner/front desk | `checked_out`; unit `cleaning` | View history/review/support policy | Message hotel, check out, check in | Checkout and room-cleaning work event | Guest chat becomes read-only; history stays visible | Settlement/refund/deposit consequences emitted separately | Checkout from confirmed/unpaid booking |
| Unit `cleaning` | Mark room ready | Owner/manager/front desk | Unit `ready` | Assignable for next valid stay | Mark ready action | Internal room-readiness event only if operationally useful | None | None | Occupied unit changed; readiness without housekeeping policy if required |
| `checked_out` | Finalize | System/authorized Operations | `completed` | History/review | Stay actions and direct hotel message | Completion/review event | Read-only archive | Settle/refund final amounts | Reopening stay by changing client state |
| Pending/confirmed | Cancel/expire/refund | Actor allowed by cancellation policy | `cancelled`, `expired`, `refunded`, or `payment_conflict` | View resolution / required support | Pay, check in, message hotel when no longer valid | Cancellation/refund/conflict event | No new hotel chat; existing history read-only | Release inventory; void/refund/review payment | Cancel secured money without refund/review record |

### INCONSISTENCIES / LEGACY BEHAVIOUR

- Direct policies across hotel, room, inventory, rate, and unit tables disagree about scope and actor classes.
- Manager can update policy/units but `partner_transition_hotel_booking` permits owner or staff only.
- The hotel-team UI exposes Inbox based on staff membership, not a clear communication permission.
- Hotel operations shows “Message guest” for eligible rows even when no thread exists, but the current open-thread RPC is guest-only. Its predicate also includes ended stays, so a completed row without history can show an action the server rejects.
- `hotel_inventory_daily` capacity is bounded by operational unit count, but `cleaning` units still count as operational for future availability; same-day turnover rules are not modelled.
- Rate plans are not directly readable by anonymous clients even though the public detail SECURITY DEFINER RPC returns active plans. Both interfaces must be treated deliberately.
- Timezone is hard-coded to `Africa/Lagos`; no per-hotel timezone field exists.

### PROPOSED CANONICAL MODEL

Hotel publication, room-type sale, physical-unit operations, and booking occupancy are separate axes. Check-in/out times and timezone are hotel policy; date availability remains independent. A booking holds a room type/date interval and receives a physical unit only at check-in. Checkout frees the assignment into cleaning, not directly ready.

## SERVICE WORKER

### CURRENT IMPLEMENTATION

Worker activation spans profile fields, `worker_verifications`, identity checks and reviews. Marketplace and job UI are in `WorkerWorkspaceModern.tsx`, `WorkerDiscovery.tsx`, and `BookingNegotiationChat.tsx`. Worker bookings use free-text states including `booking_requested`, `negotiating`, `waiting_payment`, `confirmed`, `payment_protected`, `in_progress`, `completed_pending_approval`, `approved_released`, `disputed`, `cancelled`, and `refunded` across database generations.

Migration `20260911140000_complete_worker_block_and_payment_protection.sql` makes block enforcement server-side, terminates active private calls, cancels only unsecured pre-payment work, and routes secured/active work plus money to dispute/review.

### Canonical transition table

| Current state | Event/action | Permitted actor | Resulting state | UI action shown | UI actions that must disappear | Activity generated | Conversation consequences | Payment consequences | Invalid transitions |
|---|---|---|---|---|---|---|---|---|---|
| Onboarding draft | Submit KYC/profile/evidence | Worker | `pending` / `verification_paid` / `evidence_ready` | Complete missing requirement; view review | Resubmit unchanged completed step | Worker Operations review event | Support only for verification issue | Verification fee authoritative if required | Self-verification; activation from UI flag |
| Review ready | Approve/reject | Worker Operations in scope | `verified` or `rejected` | Marketplace/jobs or correction path | Approve again; access marketplace if rejected | Worker outcome event | Existing support history | No job funds | Legacy `approved` and `verified` meaning different things |
| `verified` | Customer requests service | User | `booking_requested` | Worker accept/decline; user view request | Duplicate request for same intent | New service-request event | One booking conversation | None | Blocked pair, unverified worker, invalid service |
| `booking_requested` | Accept/open negotiation | Worker | `negotiating` | Agree price/scope | Accept again | Negotiation event | Thread writable; private calls if allowed | None | Nonparticipant action; blocked pair |
| `negotiating` | Propose/accept price | Worker/user according to turn | `waiting_payment` | Customer pays | Re-propose accepted version without revision | Price-ready event | Thread writable | Authoritative pending payment | Worker marks paid manually |
| `waiting_payment` | Verify protected payment | Server/webhook | One canonical protected-ready state | Start/confirm work | Pay again/cancel as unsecured | Payment-protected event | Thread/calls remain allowed unless blocked | Create protected-funds record idempotently | Duplicate reference; client callback as authority |
| Protected-ready | Start work | Authorized participant per policy | `in_progress` | Mark work complete / report issue | Start again; cancel as unpaid | Work-started event | Thread/calls allowed | Funds remain protected | Start without protected funds when required |
| `in_progress` | Worker submits completion | Worker | `completed_pending_approval` | Customer approve or dispute | Complete again | Completion-review event | Thread remains writable | Funds still protected | Release on worker assertion alone |
| `completed_pending_approval` | Customer approves | User | `approved_released` | Review/history | Approve, pay, complete | Completion and earning event | Archive policy begins | Settle earning/wallet exactly once | Double release; participant mismatch |
| Any nonterminal pair | Block peer, no secured funds | Either participant with booking relationship | Pre-payment booking `cancelled` | Unblock/profile safety controls | Message/call/continue negotiation | Safety event, not public Activity unless useful | Messages and private calls blocked across pair | Pending unpaid attempt cancelled | Block with no booking relationship under current anti-abuse rule |
| Secured or active job | Block peer | Either participant | `disputed`; payment `review_required` | Open WeHouse review; unblock remains separate | Cancel/release/refund directly | Urgent Operations/finance review | Messages/calls blocked; support case created | Protected funds preserved | Silent cancellation or automatic release/refund |
| `disputed` | Resolve | Authorized Operations/Finance | Released, refunded, resumed, or terminated state | Resolution/history | Original dispute action | Resolution event to participants | Participant thread policy follows safety outcome; support case retained | Audited settlement/refund | Participant self-settlement |

### INCONSISTENCIES / LEGACY BEHAVIOUR

- `payment_protected` exists in database transitions but is missing from the primary UI status labels/open-conversation set.
- Payment protection can be represented by booking status, `booking_payments`, and `payment_protection_transactions`; these are not a single state contract.
- Worker records exist in legacy `workers`, profile worker fields, verification tables, and review summaries.
- The worker profile only offers block when the client finds a nonterminal booking, while the RPC permits any historical booking relationship.
- Blocking is pair-wide across every booking, not thread-specific; unblocking does not restore a cancelled/disputed booking.
- Service chat still displays a service booking code/reference in some presentation even though hotel guest chat no longer exposes the hotel booking code. Whether service references are credentials is undefined.

### PROPOSED CANONICAL MODEL

Adopt one job state vocabulary and model payment protection as a money state, not a second ambiguous booking status. Pair safety state gates all participant communication. Blocking never makes a money decision; it creates a review case when value or active work exists.

## ROOMMATE

### CURRENT IMPLEMENTATION

Roommate data spans `roommate_profiles`, `roommate_preferences`, `roommate_search_results`, `roommate_matches`, generic `conversations/messages`, blocks, and shared-housing groups. Current discovery results use `new/viewed/accepted/declined`; mutual acceptance enables a conversation, created lazily by `ensure_my_roommate_conversation` when Message is first used. Blocking removes discovery/match results, stops calls, and preserves paid shared housing for Creator review.

### Canonical transition table

| Current state | Event/action | Permitted actor | Resulting state | UI action shown | UI actions that must disappear | Activity generated | Conversation consequences | Payment consequences | Invalid transitions |
|---|---|---|---|---|---|---|---|---|---|
| Profile incomplete/ineligible | Complete profile/preferences/privacy requirements | User | Eligible profile | Start discovery | Match/message | Readiness event only if useful | None | None | Discover with hidden/incomplete required profile |
| Eligible | Start search | User | Search `active` | Review candidates; stop search | Start again | Match-result events only when useful | None | None | Duplicate active search |
| Candidate `new` | Express interest or pass | User | Outbound `accepted` or skipped state | Wait/cancel interest as policy allows | Repeat same interest | Recipient gets roommate-interest event | No thread until mutual match | None | Contact before eligibility; use `viewed` ambiguously for both viewed and pass |
| Interest pending | Recipient accepts/declines | Recipient | Mutual `match` or `declined` | Message matched person / continue discovery | Pending response | Match/decline event | One match conversation becomes available; created lazily on first message | None | Nonrecipient response; multiple conversation IDs |
| Matched | Message/call | Either participant | Matched relationship active | Continue chat; propose shared home; block/unmatch | Initial match CTA | Ordinary messages stay in Messages, not Activity | One writable private thread | None | Blocked pair, unmatched pair, duplicate thread |
| Matched | Create shared-home group/invite | Participant under group policy | `inviting` | Invite/accept/decline | Create duplicate group for same home/participants | Shared-home invite events | Existing roommate thread remains the social context | No funds yet | Hidden participant, group size outside 2–6, unrelated listing |
| `inviting` | All required participants accept | Invitees | `ready` | Pay equal share | Accept again | Group-ready/payment-required events | Same participant conversations; one group context | Payment intents per share | Unequal split under current policy; missing participant |
| `ready/payment_pending` | Verify all shares | Server/webhook | `paid` / housing relationship | Move-in/booking actions | Pay completed share | Share and group-paid events | Conversation remains | Create/attach authoritative reservation; preserve each contribution | Client declares another member paid; duplicate payment |
| Search active | Stop/expire search | User/system | `stopped/expired` | Restart search | Candidate actions from stale search | Usually no Activity | Existing matches/conversations remain | Existing shared housing unaffected | Deleting established matches/history |
| Matched, unpaid | Block/unmatch | Either participant | Relationship ended; unpaid group cancelled | Unblock/history as policy permits | Message/call/invite | Safety/cancellation event | Messaging/calls stop | Cancel pending unpaid intents | Silent deletion of history |
| Matched with paid/shared reservation | Block | Either participant | Safety block + review state | WeHouse review | Message/call/direct cancellation | Urgent review event | Participant contact stops; support path remains | Funds/property preserved pending review | Automatic refund/cancellation without review |

### INCONSISTENCIES / LEGACY BEHAVIOUR

- `roommate_search_results` is the current flow while legacy `roommate_matches` is still queried by older activity code.
- `viewed` is presented as “skip for now” in places, conflating observation and rejection.
- Conversation creation is lazy, so “match has a conversation” is true as capability but not necessarily as a persisted row.
- Shared housing is attached after social matching but its housing/reservation boundary is not a mature aggregate.
- Blocking, unmatching, pausing search, and declining are separate concepts but presentation can make them look equivalent.

### PROPOSED CANONICAL MODEL

Use explicit `interest_state` (`pending/accepted/declined/withdrawn`) and `match_state` (`active/ended/blocked`). A match has one deterministic conversation identity whether materialized immediately or lazily. Shared housing is a separate agreement linked to the match participants and a real reservation/payment schedule.

## CONVERSATIONS

### CURRENT IMPLEMENTATION

There are distinct persistence families for roommate (`conversations/messages`), worker jobs (`booking_conversations/booking_messages`), hotel stays (`hotel_booking_conversations/hotel_booking_messages`), and WeHouse cases (`partner_support_conversations/partner_support_messages`). `Chat.tsx` composes personal Activity plus all four thread families into one Inbox. `CommunicationInbox.tsx` does the equivalent for partner hotel/support communication. Calls are stored separately in `private_calls` and capability-checked by context.

### Canonical transition table

| Current state | Event/action | Permitted actor | Resulting state | UI action shown | UI actions that must disappear | Activity generated | Conversation consequences | Payment consequences | Invalid transitions |
|---|---|---|---|---|---|---|---|---|---|
| No thread, valid domain relationship | Open/start conversation | Allowed participant | One thread for context+purpose | Compose message/call if capability allows | “Start” once thread exists | No generic Activity merely for empty thread | Create deterministically or lazily without duplicates | None | No relationship, unpaid hotel stay, blocked pair |
| Open/writable | Send message/attachment | Participant with current capability | Open/writable | Reply/react/remove-for-me | None unless relationship changes | Ordinary messages create unread Messages state, not Activity | Increment recipient unread; store sender/content securely | None | Empty body/files, invalid attachment path, nonparticipant, block, closed context |
| Open/writable | Start private call | Participant with call capability | Ringing/accepted/ended | Accept/decline/end | Start duplicate/ringing call | Missed-call item belongs in Messages | Call linked to same context; block ends active calls | None | Blocked/closed/no capability |
| Domain state ends write permission | Checkout/completion/cancellation/unmatch/closure | Domain transition actor | Read-only/archive or closed | View history; open appropriate WeHouse case if allowed | Composer, call, original action CTA | Domain completion event, not generic “chat closed” unless useful | History remains; unread semantics retained; no new participant messages | None | UI alone reopens thread |
| Open pair | Block | Either participant under relationship rules | Blocked | Unblock/report | Message/call | Safety/review event when appropriate | All pair communication denied server-side; calls ended | Secured money goes to review, never cancelled silently | Blocking only one screen while another still sends |
| Open WeHouse case | Resolve | Assigned/authorized WeHouse actor | `resolved`, then `closed` by policy | View resolution/reopen only if allowed | Reply if hard-closed; original task CTA | Resolution event | Case history retained | Any refund/settlement is a separate money action | Treating a message as the state transition |
| Any thread | Hide/archive for self | Participant | Hidden for that participant | Restore if supported | Row in active Inbox | None | Does not delete other participant history or domain record | None | Global deletion through “remove for me” |

### INCONSISTENCIES / LEGACY BEHAVIOUR

- Four message table families implement similar unread, attachment, reaction, and hide semantics independently.
- The generic WeHouse case store retains `partner_support_*` names and legacy sender-role aliases.
- Operations surfaces sometimes label “Chats” and “Activity” differently from the personal Inbox vocabulary.
- The same legacy route can open Inbox, a specific conversation, or an operations module depending on client normalization.
- Some context references and codes are shown in service/support presentation without a formal classification of public reference versus secret credential.

### PROPOSED CANONICAL MODEL

Keep one Inbox and one thread envelope (`thread_id`, `kind`, `context_type`, `context_id`, participants/capabilities, state). Domain-specific message stores may remain internally during migration, but a canonical read model and capability service must make them indistinguishable to navigation and unread logic.

## PAYMENTS

### CURRENT IMPLEMENTATION

The browser creates an authoritative pending record, `payment-init` validates it and initializes Paystack, `paystack-verify` verifies a callback, and `paystack-webhook` independently confirms server events. Purposes include apartment reservation/rent, rent-plan contribution, hotel booking, worker booking, and shared-housing share. Worker verification has a separate initializer. Money data spans `booking_payments`, legacy `payments`, payment-protection records, wallets/balances, withdrawals/withdrawal requests, earnings, refunds/reversals, and audit logs.

### Canonical transition table

| Current state | Event/action | Permitted actor | Resulting state | UI action shown | UI actions that must disappear | Activity generated | Conversation consequences | Payment consequences | Invalid transitions |
|---|---|---|---|---|---|---|---|---|---|
| Obligation due | Create payment intent | Owing participant | `initiated/pending` | Continue to provider; retry same intent safely | Create duplicate obligation | Optional payment-required event is created by domain, not button tap | None | One idempotent intent/reference tied to exact purpose/object/amount/currency | Client-supplied amount without authoritative quote |
| Pending | Provider initialization | Authenticated server function | `provider_pending` | Open provider checkout | “Paid” | None | None | Record provider reference/idempotency key | Initialize unrelated user's obligation |
| Provider pending | Webhook/server verify success | Payment server | `verified` | Domain's next valid action | Pay/verify again | Payment-confirmed event with domain destination | Domain thread may become available (for example hotel chat) | Append immutable verification; advance obligation once | Trust redirect query alone; duplicate settlement on replay |
| Provider pending | Failure/expiry | Payment server/system | `failed/expired` | Retry if domain still valid | Continue stale checkout | Failure event only when actionable | None/support on conflict | Release hold according to domain | Mark failed due only to browser timeout while provider may still succeed |
| Verified worker payment | Protect funds | Server transition | `protected` | Start job | Cancel as unpaid; release | Protected-payment event | Job chat remains | Create protection record exactly once | Direct payout before completion/approval |
| Protected | Completion approval | Authorized beneficiary counterparty or reviewed policy | `settlement_pending/settled` | View earning | Release again | Earning/settlement event | Thread moves toward archive | Credit ledger/wallet once | Worker releases own funds; replay double credits |
| Any verified/settled amount with issue | Dispute/block/conflict | Participant/system | `review_required` | Open/review case | Direct release/refund | Urgent review event | Participant communication follows safety policy; WeHouse case open | Freeze/protect value | Silent cancellation or destructive overwrite |
| Review required | Refund/release/split decision | Authorized Finance/Operations per policy | `refunded/settled/partially_settled` | View resolution | Original action | Resolution event | Case retains audit trail | Immutable reversal/settlement entries | Editing original transaction to erase history |
| Available earning | Request withdrawal | Beneficiary | `awaiting_review` | View status | Request duplicate amount | Payout-review event | None/support on failure | Reserve available balance | Negative/over-balance/self-review |
| Awaiting review | Approve and transfer | Independent Finance actor/server | `processing/paid` or `failed/reversed` | History/retry only when safe | Approve/transfer after paid | Payout result event | None | Provider transfer response and ledger reconciliation | Client timeout treated as definitive failure; duplicate transfer |

### INCONSISTENCIES / LEGACY BEHAVIOUR

- `booking_payments.status` is free text and acts as a polymorphic envelope across unrelated domains.
- Booking status sometimes duplicates money status (`waiting_payment`, `payment_protected`, `payment_conflict`).
- `wallets` and `wallet_balances`, `withdrawals` and `withdrawal_requests`, singular/plural financial audit tables, and legacy `payments` coexist.
- Profile and payout mutation timeouts use `Promise.race` without cancelling the underlying request; the UI can report failure before a late success.
- Paystack return URL is hard-coded to the production domain.

### PROPOSED CANONICAL MODEL

Use immutable ledger entries plus typed payment intent, obligation, protection, settlement, refund, and payout aggregates. Domain state advances from a server-confirmed money event. A network timeout produces **unknown/reconciling**, never failed, for a mutation that may still commit.

## NOTIFICATIONS / ACTIVITY / INBOX

### CURRENT IMPLEMENTATION

`notifications` is the emerging domain-event envelope (`type`, source, destination, parameters, workspace scope, event key, read state). `Notifications.tsx` merges it with announcements and `activityFeed.ts` filters transient/ordinary message events, computes actionability from type/copy, normalizes legacy routes, and expires old rows client-side. `Chat.tsx` and partner/operations inboxes combine Activity and Messages. Unread counts are assembled by several hooks, Realtime subscriptions, and periodic polling.

### Canonical transition table

| Current state | Event/action | Permitted actor | Resulting state | UI action shown | UI actions that must disappear | Activity generated | Conversation consequences | Payment consequences | Invalid transitions |
|---|---|---|---|---|---|---|---|---|---|
| Domain transition commits | Emit event | Transactional domain service | Unread Activity event | Open authoritative object/action | None until action resolves | One deduplicated event with stable event key | Message event only if the domain transition also creates a real message | Money event points to immutable payment/obligation |
| New ordinary message | Deliver message | Conversation service | Unread Messages count | Open thread | None | No duplicate Activity card | Increment exact thread/message unread | None | Counting one message in Activity and Messages |
| Unread event | Mark read | Recipient | Read history | Open related record if still relevant | Unread badge only | No new event | None | None | Read action completes domain work |
| Actionable event | Complete underlying domain action | Authorized domain actor | Event resolved/history | View result | Original CTA | Optional resolution event | Thread follows domain policy | Money follows domain transition | Hiding event client-side while work remains unresolved |
| Announcement published | Broadcast | Authorized platform actor | Announcement unread/read | View announcement | Unread badge after read | Announcement, not domain lifecycle event | Does not create conversation automatically | None | Using announcement for participant-specific protected data |
| Event ages | Retention/archive | System | Archived history | History search if retained | Active/actionable placement only after actual resolution | None | None | Financial audit retained per policy | Client age filter erases unresolved action |

### INCONSISTENCIES / LEGACY BEHAVIOUR

- Actionability is inferred partly from regexes over event type and English copy.
- Client-side retention can hide unresolved events after a time window.
- `user_activity` remains for security/session and old social activity while product Activity uses `notifications`.
- Multiple polling intervals and per-feature hooks can disagree about unread totals.
- Destination aliases preserve old navigation and can resolve the same event differently.

### PROPOSED CANONICAL MODEL

Activity is a server-maintained projection of domain events with explicit `action_state` (`informational/actionable/resolved`), `workspace_scope`, and canonical destination. Messages unread is calculated from message read cursors. Inbox totals are delivered by one read model; Realtime invalidates it, and focus/backoff reconciliation replaces unconditional polling.
