# WeHouse Communication, Activity, Saved and Followed Search Contract

This is the single authoritative communication contract for WeHouse. It supersedes older communication notes, including any description of a separate top-level Conversation destination or the pre-PR-71 hotel thread-creation mismatch.

## 1. Customer navigation

Customer primary navigation is exactly:

`Explore · Bookings · Inbox · Account`

- **Inbox is the only top-level communication destination.**
- Inbox opens to the message/conversation list.
- Near the top is one compact **Activity** entry. It may show unread count and a short summary, but it must not dump Activity history above the messages.
- Tapping Activity opens the full Activity screen inside the Inbox flow. Back returns to Inbox and preserves the message-list context.
- `conversation`, `messages` and `chat` may continue to resolve old/deep links, but they are compatibility routes only and must never appear as extra primary navigation.
- Mobile and desktop use the same primary navigation contract.

### Proven on current production main

- Customer mobile navigation has one Inbox destination.
- Desktop customer navigation also has one Inbox destination; the older Conversation + Inbox duplication is stale documentation.
- `Chat.tsx` currently opens to messages and presents a compact Activity entry.
- `Activity.tsx` is a nested Activity screen that returns to Inbox.

## 2. Inbox thread families

The Inbox is visually one product while the server keeps domain-specific stores and rules.

| Thread kind | Backing store | When it exists | Writable window |
|---|---|---|---|
| Roommate | `conversations`, `messages` | Mutual roommate relationship; empty composer may exist before an Inbox row | Active matched relationship and no either-direction block |
| Service job | `booking_conversations`, `booking_messages` | Tied to one Worker booking | Booking lifecycle permits contact and neither participant has blocked the other |
| Hotel stay | `hotel_booking_conversations`, `hotel_booking_messages` | One deterministic conversation for a paid confirmed/live stay | Paid `confirmed` or `checked_in`; read-only after checkout |
| WeHouse case | `partner_support_conversations`, `partner_support_messages` | Only when a real support/operations case exists | Case state and assigned/scoped WeHouse permissions decide |

The backing tables are an implementation detail. A person should experience one Inbox, not four different chat products.

## 3. Thread presentation

Every Inbox row must answer three things without opening it:

1. **Who or what is this?** Person, hotel, or WeHouse case.
2. **What is it about?** Roommate match, service type/job, hotel room/stay dates, or support-case purpose.
3. **What happened most recently?** Last message/call and unread state.

Rules:

- Do not make every row look like an identical generic WeHouse sender.
- Hotel conversation identity is the **hotel/business context**, not a private staff identity. Authorized Front Desk/Manager staff may reply on behalf of the hotel.
- Worker identity opened from private service chat is contextual/private identity, not the full discovery profile with public reviews and Showcase.
- Roommate identity opened from chat omits school and matching-preference information that belongs only to discovery/matching.
- Booking/check-in/access/handover/recovery credentials are never titles, subtitles, previews, Activity text or push text.

## 4. Activity

Activity is not another top-level product.

- Inbox shows one compact Activity entry.
- Full Activity history appears only after tapping that entry.
- Activity contains meaningful state changes and actions: booking progress, payment/action needs, followed-search matches, account/security updates and relevant operations updates.
- A normal message belongs in the message list, not duplicated as Activity unless there is a distinct actionable system event.
- Followed-search matches appear in Activity only; followed searches do not become Inbox threads.

## 5. Saved, Followed Search and Showcase Like are separate intentions

### Saved

Saved is a private favourite state for homes and hotels.

- Homes use `saved_listings`.
- Hotels use `saved_hotels`.
- Customer control is a **heart** labelled/accessibility-described as Save/Saved.
- Saving does not create a booking, Activity thread or social reaction.

### Followed Search

Follow Search subscribes to search criteria.

- Follow/unfollow/resume is managed from the current Explore search.
- Canonical criteria identity prevents duplicate semantic searches.
- New matching homes/hotels create Inbox Activity.
- Followed Search is not a Saved item and has no separate primary destination.

### Showcase Like

Worker Showcase heart is a social Like/reaction on that media post.

- It uses Showcase reaction storage.
- Comments belong to the post.
- It never reads/writes `saved_listings` or `saved_hotels`.

## 6. Hotel communication

Current server contract after PR #71:

- Paid eligible hotel stays get one deterministic conversation row; the old rule where only the guest could create the thread is obsolete.
- Authorized guest/hotel actors open the same conversation idempotently.
- Sending is allowed only for paid `confirmed` / `checked_in` stays.
- Checkout/completion/cancellation makes the permitted history read-only.
- Thread context is hotel + room type + stay dates, not booking/check-in code.

### Genuine unresolved hotel communication issue

The current production read model still excludes a hotel conversation from the Inbox until at least one message exists. That means a paid confirmed stay can have a valid deterministic conversation but not yet appear in the Inbox list. The next hardening migration must return eligible zero-message hotel threads with a neutral preview such as `Stay conversation`.

## 7. Direct-chat privacy and encryption

- Roommate direct chat uses the private E2EE message/attachment path.
- Service-job direct chat uses the private E2EE message/attachment path.
- WeHouse support cases are operational support records and are **not** presented as E2EE participant chat.
- Hotel chat is business/operational hotel communication; current implementation is not the roommate/service E2EE path.
- Encryption readiness must never make the composer visually jump, disappear under the keyboard, or send an unintended message from the mobile Enter key.

## 8. Blocking and Payment Protection

For Worker/service communication:

- Either-direction block stops new private service messages and calls at the server boundary.
- Existing ringing/connected private calls end.
- Pre-payment work may cancel under booking policy.
- Verified/protected value is never destroyed, auto-released or silently refunded because somebody blocked the other person; the booking/payment moves to WeHouse review.
- Unblocking restores communication permission only and does not resurrect cancelled/disputed work.

Roommate blocking follows the same safety principle for communication and any paid shared-housing state.

## 9. WeHouse support / `Message WeHouse`

`Message WeHouse` is an exception/help action, not a routine booking step.

It should appear only where the person genuinely needs WeHouse intervention, for example:

- payment charged/verification conflict;
- cancellation/refund dispute;
- protected Worker payment dispute;
- property/handover/access problem requiring Operations;
- hotel booking/payment problem that the hotel itself cannot resolve;
- safety/report case.

It should **not** appear as a generic CTA on normal discovery, normal payment success, ordinary confirmed booking, ordinary hotel arrival, or every completed record.

Opening it creates/reuses a context-scoped WeHouse case. The user must see the case purpose and responsible WeHouse team; WeHouse staff must see the linked booking/property/job context without receiving secret check-in/handover credentials.

## 10. Genuine unresolved items on current main

These are current work, not stale historical inconsistencies:

1. **Property Partner Inbox parity:** `CommunicationInbox.tsx` still uses Activity/Messages tabs and can default to Activity. Canonical behavior is messages-first with one compact Activity entry.
2. **Workspace Inbox parity:** Worker, Hotel team, Staff, Admin and Creator need the same messages-first/compact-Activity interaction verified independently; do not assume one component fixes every dashboard.
3. **Empty hotel thread visibility:** deterministic zero-message hotel conversations are not yet returned by the production Inbox read model.
4. **Multiple chat implementations:** roommate, service-job, hotel and support surfaces still duplicate composer/layout/reaction/read-state behavior. They must share interaction rules even if domain storage stays separate.
5. **Mobile keyboard/viewport:** current production CSS targets historical z-index-specific chat roots and does not reliably track the visual viewport. The hardening branch replaces this with visual-viewport sizing and mobile Enter-as-newline behavior; it still requires device verification before production.
6. **Service status vocabulary:** `payment_protected` is still missing from the primary `BOOKING_STATUS_LABELS` map and can render as unknown/inconsistent state.
7. **Support-entry audit:** every `Message WeHouse`/`Get help` entry point still needs a complete route/context audit so routine journeys do not create unnecessary cases.
8. **Back/navigation continuity:** nested chat/profile/detail screens still have several independently owned headers/back controls; duplicate/detached back UI remains a regression target.
9. **Hotel team capabilities:** hotel communication/operations must finish moving from Manager/Front Desk label assumptions to effective capabilities.
10. **Release evidence:** two-device E2EE, block/message enforcement, Android keyboard/reactions, TURN audio/video calls, deep links/back state and multi-device visual QA remain release-gate tests rather than assumed facts.

## 11. Regression contract

A release may call communication complete only when all of the following pass:

1. Exactly one visible customer Inbox destination on mobile and desktop.
2. Inbox opens messages first; Activity is one compact entry and full Activity requires a tap.
3. Back from Activity/thread/profile returns to the previous Inbox/discovery context without duplicate back controls.
4. One context+purpose maps to one canonical thread.
5. Paid confirmed hotel stay is visible in Inbox even before the first message.
6. Hotel composer disappears/read-only state is explicit immediately after checkout/closure.
7. Every message/call send is reauthorized server-side.
8. Block in either direction stops every relevant UI/API/database path.
9. E2EE roommate/service message works between two real users on two devices and recovery/PIN behavior is verified.
10. Android/iOS keyboard never covers the composer, unexpectedly sends on Enter, or causes the chat viewport to jump.
11. Audio/video private calls are tested through TURN fallback, not only same-network direct connectivity.
12. `Message WeHouse` appears only for defined support/exception cases and opens the correct context-scoped case.
13. No booking/check-in/handover credential leaks into Inbox, Activity, support previews or notifications.
14. Unread totals agree between navigation badge, Inbox entry and thread rows.

## Evidence used for this contract

Current main implementation evidence includes:

- `src/App.tsx`
- `src/lib/nav2.tsx`
- `src/pages/Chat.tsx`
- `src/pages/Activity.tsx`
- `src/pages/ChatCore.tsx`
- `src/components/CommunicationInbox.tsx`
- `src/components/BookingNegotiationChat.tsx`
- `src/components/HotelBookingChat.tsx`
- `src/components/SupportChat.tsx`
- `src/lib/supabase/chat.ts`
- `src/lib/supabase/worker-bookings.ts`
- `src/lib/supabase/hotel-chat.ts`
- `src/lib/supabase/support.ts`
- PR #71 hotel-thread, blocking and communication migrations.
