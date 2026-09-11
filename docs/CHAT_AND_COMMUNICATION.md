# Chat and Communication

## Product position

Conversation is not a separate product from Inbox. Inbox is the destination; a conversation is a detail within it. Activity is a sibling view inside the same destination. TikTok-style continuity means the person stays in one communication surface, opens a thread in place, and returns to the same scroll/filter state—not that every domain shares one untyped chat.

## CURRENT IMPLEMENTATION

### Communication families

| Product relationship | Current tables/components | Creation and access |
|---|---|---|
| Roommate | `conversations`, `messages`, `Chat.tsx` | Mutual match; `ensure_my_roommate_conversation` materializes lazily; participant RLS |
| Service job | `booking_conversations`, `booking_messages`, `BookingNegotiationChat.tsx` | Tied to `worker_bookings`; participants and privileged support rules |
| Hotel stay | `hotel_booking_conversations`, `hotel_booking_messages`, `HotelBookingChat.tsx` | Guest opens only for paid `confirmed/checked_in` stay; hotel actors use booking access helper |
| WeHouse case | `partner_support_conversations`, `partner_support_messages`, support components | Context-scoped case for reservation/property/field/support work; table name is legacy |
| Calls | `private_calls`, `PrivateCallCenter` and capability helpers | Context-linked; current state and block capability checked in database triggers/helpers |

`Chat.tsx` loads roommate, worker-job, hotel-stay, and WeHouse-support summaries into one personal message list and renders Activity in the same Inbox. `CommunicationInbox.tsx` does the same for Property Partner hotel/support communication. The backing stores remain separate, but that should be an implementation detail.

### Hotel conversation lifecycle

Current migration `20260911141000_close_hotel_chat_with_stay.sql` and the live RPCs enforce:

- `open_my_hotel_booking_conversation` requires the current guest, paid payment status, and booking status `confirmed` or `checked_in`;
- `send_hotel_booking_message` rechecks conversation access and the same paid/live stay states;
- after checkout/completion/cancellation the composer is read-only and no new chat may be opened;
- participant-authorized history remains readable;
- `HotelBookingChat.tsx` shows room/package and stay context, not the hotel booking code.

There is a current thread-creation mismatch: `PartnerHotelOperations.tsx` renders “Message guest” when a paid confirmed/checked-in booking has no conversation row, then `HotelBookingChat` calls the guest-only open RPC. The hotel actor cannot create that thread and receives an unavailable error. The same row predicate includes `checked_out/completed`; an existing thread opens read-only, but a completed stay without a thread still shows the invalid “Message guest” action.

The booking code remains on the booking detail only while it is a valid check-in credential. It is not a thread title, subtitle, preview, notification field, or general reference.

### Worker block and communication enforcement

`set_my_worker_block` now takes the peer user ID and applies pair-wide safety state after verifying a user↔worker booking relationship. It ends ringing/accepted private calls across their jobs. `guard_blocked_worker_contact` rejects new/updated job contact and message inserts. The call capability helper/trigger rejects either-direction blocks.

When no secured work exists, pre-payment bookings are cancelled. When a job has verified/protected money or is active, the booking becomes disputed, relevant payment becomes `review_required`, protected funds remain intact, and a WeHouse case is created. `BookingNegotiationChat.tsx` disables UI contact and the database is the final backstop. The same RPC is used from conversation and worker profile, although the profile currently exposes it only when the client finds a nonterminal booking.

### WeHouse cases

The generic support store uses channels such as reservation operations, property operations, field operations, and support case. `conversationPresentation` provides context-specific titles/operator names. `SupportEntryCard.tsx` displays case number, status and assignment, subscribes to Realtime, and also polls every 15 seconds.

In `151971.mp4`/`151972.mp4`, multiple property cases appear as the same “WeHouse Property Operations” person with the same avatar; only small secondary case/property text distinguishes them. A hotel guest thread appears beside those rows. A unified list is correct, but type, property/stay identity, current case purpose, and status need stronger presentation so separate cases do not look like duplicate support identities.

## INCONSISTENCIES / LEGACY BEHAVIOUR

1. Mobile has a unified Inbox while desktop navigation still offers both Conversation and Inbox.
2. Four message implementations duplicate attachments, unread, reactions, hiding, read receipts, pagination, and lifecycle gates.
3. WeHouse cases are named `partner_support_*` and allow legacy sender-role labels that no longer reflect all users.
4. Hotel team Inbox availability is derived from staff membership in UI; managers can operate the hotel but do not consistently receive the communication destination.
5. Worker job status `payment_protected` is not included in the primary UI's status labels/open-conversation states, so a valid protected job can look unknown or read-only.
6. Pair-wide worker blocking is stronger than blocking one job/thread, but the UI does not explain the scope.
7. Worker-profile block visibility is narrower than server eligibility; terminal-history relationships can call the RPC but may not get the profile action.
8. Service booking codes/references are shown in some service-chat presentation without a classification of credential versus harmless reference.
9. Support history and a CTA to contact WeHouse remain available after some completed/cancelled records with no explicit rule about reopen versus new case.
10. Each communication surface manages local back/full-screen state, causing header and back behavior to feel detached from Inbox navigation.
11. Case presentation emphasizes a generic WeHouse sender over the real domain context, which makes multiple legitimate cases appear conflicting.
12. Hotel staff can read an existing eligible stay conversation but cannot create one; the current hotel-operations button claims they can. Ended stays can also show “Message guest” when only history (if any) is valid.

## PROPOSED CANONICAL MODEL

### One Inbox, typed threads

Expose a canonical thread envelope even while old stores remain:

| Field | Meaning |
|---|---|
| `thread_id` | Stable global ID used by route and unread read model |
| `kind` | `roommate`, `service_job`, `hotel_stay`, or `wehouse_case` |
| `context_type/id` | Authoritative match/job/booking/case subject |
| `purpose` | Participant chat versus WeHouse operational case |
| `participants` | People/workspace memberships and display-safe identity |
| `state` | `writable`, `read_only`, `closed`, `blocked`, `hidden_for_me` |
| `capabilities` | Server-computed send/call/attach/react/report/archive permissions |
| `last_item/unread` | Read-model projection, not client-assembled guess |

Routes use `/inbox` and `/inbox/:threadId`. Opening a thread is nested navigation within Inbox. Back returns to the preserved Inbox state. “Conversation” must not remain a second top-level destination.

### Context rules

| Thread kind | Allowed participants | Writable window | Closure/block rule |
|---|---|---|---|
| Roommate | Active mutual match participants | Active match and no either-direction block | End/unmatch makes read-only; block denies send/call immediately |
| Service job | Booking user and worker; authorized WeHouse actor through case, not impersonated participant | Request through approved close/dispute policy, unless blocked | Pair block denies private contact; secured job opens WeHouse review |
| Hotel stay | Paid guest and assigned hotel team roles permitted to communicate | `confirmed` through `checked_in`; closes at checkout | History retained; cancellation/expiry before stay prevents opening |
| WeHouse case | Requester plus assigned/scoped authorized work roles | Case open/in progress/waiting; resolved may allow defined reopen window | Closed is read-only; create a new linked case when a new issue is materially distinct |

### Presentation and privacy

- Thread title is the participant/business name; subtitle is useful context such as room type and stay dates or service type and job stage.
- Booking/check-in/security codes are never titles, subtitles, previews, Activity copy, push text, or attachment paths.
- A non-secret customer support reference may be shown only if explicitly classified and rotated independently from any action credential.
- Direct participant chat must clearly say who receives it. WeHouse case communication must clearly name the responsible team; generic “Message WeHouse Property Operations” disappears when that action is no longer valid.
- Thread state is visible: active, read-only after stay, blocked, or case resolved. Do not leave a dead composer that fails after send.

### Block safety contract

1. Block is enforced by server capability checks for message inserts, conversation creation, booking contact, and calls.
2. Block scope is declared in UI before confirmation.
3. Existing active calls end; future calls/messages fail atomically.
4. Blocking never releases, refunds, or destroys value. It moves secured work/shared housing to review.
5. Unblocking restores communication capability only; it never resurrects cancelled/disputed work automatically.
6. Safety actors can still reach WeHouse through a case without contacting the blocked peer.

## Regression contract

- Exactly one thread is returned for a given context+purpose.
- Same Inbox/thread URL works from Activity, booking detail, profile, push notification, and workspace.
- Every sender is reauthorized on send/call, not just when opening UI.
- Block in either direction stops every relevant UI and database/API path.
- Hotel chat accepts messages only for paid confirmed/checked-in stays.
- Payment confirmation creates one deterministic stay thread or both guest and authorized hotel team can idempotently open the same thread; neither side depends on the other visiting chat first.
- Completed/closed context removes composer and calls but retains permitted history.
- No credential appears in headers, summaries, logs intended for users, or notifications.
- Unread totals are identical in the bottom nav, desktop shell, Inbox tabs, and thread list.

## Evidence

- `src/pages/Chat.tsx`
- `src/components/CommunicationInbox.tsx`
- `src/components/BookingNegotiationChat.tsx`
- `src/components/HotelBookingChat.tsx`
- `src/components/SupportEntryCard.tsx`
- `src/lib/supabase/chat.ts`, `worker-bookings.ts`, `hotel-chat.ts`, `support.ts`
- `supabase/migrations/20260911140000_complete_worker_block_and_payment_protection.sql`
- `supabase/migrations/20260911141000_close_hotel_chat_with_stay.sql`
- live functions `open_my_hotel_booking_conversation`, `send_hotel_booking_message`, and block/call guards
