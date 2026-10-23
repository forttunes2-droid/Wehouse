# Notifications, Activity, and Inbox

## Definitions

| Term | Canonical meaning |
|---|---|
| Domain event | Immutable fact that a business transition occurred |
| Activity item | Recipient/workspace projection of a domain event |
| Actionable item | Activity whose underlying domain obligation remains unresolved |
| Message | Content sent in a conversation; not an Activity event |
| Announcement | Authorized broadcast, not a participant-specific lifecycle fact |
| Inbox | One destination that contains Messages and Activity views |
| Unread | Recipient has not viewed the specific message/event; never means the business action is incomplete |

## CURRENT IMPLEMENTATION

### Native phone delivery and theme repair - 20 October 2026

The Android/iOS app now registers native push using Capacitor. Phone consent is per installation, separate from pref_push_notif (the existing foreground preference). The owned RPC requires a trusted, live sign-in, matching device ID and expected profile. Token refresh cannot silently enable an installation whose consent is off; delayed startup registration cannot undo a newer off decision. Tokens and queued deliveries are service-only with RLS and no browser grants. Device revocation disables delivery.

New canonical Activity audiences enqueue one job per installation/event/workspace. The worker rechecks eligibility, skips read/resolved or expired items, uses bounded leases/retries and requires provider acceptance receipts. Invalid registrations are disabled. Seven-day delivery history and ninety-day token retention are maintained. This queue is not proof that every chat writer emits a canonical event: channel-by-channel message coverage remains an explicit integration check. Worker Pro local reminders also remain separate from durable server reminders.

FCM uses scoped server OAuth and APNs uses signed provider tokens; neither requires users to sign in with Google/Apple. Lock-screen payloads contain a generic update and recipient/event/workspace identifiers, with no chat text, address or money details. A tap checks the current identity and available workspace before opening Inbox; it does not execute a payment or business action. Foreground native banners are disabled to avoid duplicating the existing in-app listener.

Test applies 20261020100711, 20261020101100 and 20261020101104. native-push version 1 validates signed-in status requests and a separate worker secret for dispatch. The every-minute cron job is installed; it performs no request without Vault configuration. Rollback SQL verifies registration, pending/revoked/cross-account denial, leases, receipt enforcement, delayed retries and off cancellation; fixtures leave no rows. Local signing/adapter and client-consent tests use controlled provider responses, not real delivery. The hosted HTTP probe did not run because its network approval was rejected. Production was not changed.

The shared popup now follows the app theme rather than a second theme provider. Switches use one accessible control with theme-specific off colours, 44 px targets and reduced-motion support. The select sheet uses theme text/border/overlay/shadow tokens, wraps options and supports Escape; privacy saves require the matching persisted value and recover after thrown requests.

See native-release.md for configuration and physical-device evidence still needed.

### Preference and read receipts - 20 October 2026

| Control | Confirmed behaviour |
|---|---|
| Followed-search alerts | Saves property filters; new matching publications create Inbox Activity. Pause stops future matching alerts; existing Activity remains. |
| In-app alerts | Controls ordinary foreground pop-ups and sounds across personal and operational workspaces. Off retains Messages, Activity, unread badges and security notices. |
| Email updates | Optional business-email delivery is not implemented; the nonfunctional toggle was removed. Account verification/recovery delivery is separate and awaits configured email service. |
| Closed-app phone notifications | Native device consent, private tokens, a durable canonical-Activity queue, FCM/APNs adapters and scheduled worker are implemented on Test. Delivery remains inactive without platform credentials and signed-device verification. The foreground preference is independent. |

Preference changes and followed-search pause/remove actions require the matching persisted receipt before showing success. Bounded requests retain the prior state on failure. Restoring filters fails visibly if browser storage is unavailable. Activity read receipts require a true result or valid count; bulk read only updates the rows captured when the request began. Incoming rows keep their unread state. Realtime refresh bursts are coalesced. Explicit action_required=false overrides legacy copy inference; reading does not resolve the underlying work.

Read-only Test inspection confirms the home matcher skips edits to already-available homes and runs on publication/availability transitions. Full criteria parity and edit-trigger coverage remain unfinished. Announcement read uses an older void RPC and still needs an authoritative receipt contract. This checkpoint does not close the entire notification architecture audit.

### New-device security notice (20 October 2026)

`NewLoginAlert` is an account-security notice visible from another trusted signed-in device after a new device completes its own confirmation. It does not approve a pending login. The card shows device/browser/time, **This was me**, and **End this device's access**, using theme tokens and responsive touch controls. Reviews must return the matching session/decision receipt before dismissal; failures retain the notice. Subscriptions filter the recipient and coalesce bursts. The canonical liveness helper rejects explicitly inactive/rejected WeHouse device sessions, even before bearer expiry. Full deployed two-device/revoked-token denial across all RPC/Storage routes is still required; this is not a claim that every expired-JWT or direct-API case is audited.

This section records the earlier design baseline. The canonical Activity implementation now reads `activity_events` and recipient/workspace `activity_event_audiences`; legacy `notifications` remains a compatibility/delivery input. Database functions emit events for property, reservation, hotel, worker, roommate, payment, payout, followed-search, security and support transitions.

`Notifications.tsx` combines canonical Activity rows with `announcements`. `src/lib/activityFeed.ts` then:

- excludes transient types such as typing, seen, reactions, draft saves and sync notices;
- excludes ordinary message-like events so Messages owns them;
- infers actionability from event types and English copy regexes;
- normalizes legacy route names;
- chooses a destination ID based on event/context heuristics;
- deduplicates lifecycle rows by source and lane;
- applies different age windows for read/unread, finance, booking, roommate, account and announcements.

`Chat.tsx` presents Activity and the combined personal message list. `CommunicationInbox.tsx` presents the partner equivalent. Operations workspaces have related communication/activity surfaces. `activity` now acts mainly as a bridge to this unified destination; `notifications`, `conversation`, `chat`, and `messages` still exist as route generations.

Unread totals are not delivered by one canonical server read model. Feature hooks query their own conversation tables, notifications, and support data; several subscribe to Realtime while also polling at 15, 20, or 60 seconds. Some item-level adapters reduce a thread with several unread messages to a boolean/one-row count while badges elsewhere sum the actual number.

### Current followed-search activity

`Search.tsx` and `HotelsHome.tsx` normalize structured criteria, load `saved_searches`, detect active/paused current criteria, and call `save_my_property_search` to upsert/resume. `FollowedSearches.tsx` is the separate Account subpage to reopen, pause/resume or remove a followed search; `Saved.tsx` holds only hearted places. The database enforces a unique user+kind+criteria key and emits deduplicated personal Activity events for matching future homes/hotels.

The current home matcher primarily fires when a listing transitions into available. It may not notify when an already-live listing is edited later so that it newly matches. Hotel matching is invoked by publication/update paths rather than one visibly universal event trigger. Criteria normalization exists in both TypeScript and SQL and needs parity tests. Opening a followed search restores its criteria; location-radius results require the saved search's reference coordinates.

## INCONSISTENCIES / LEGACY BEHAVIOUR

1. Actionability is inferred from names/copy instead of stored as a domain-backed state.
2. Marking read and resolving work are independent in principle but the UI filtering can make read/old actions disappear.
3. Age-based client filtering can hide an unresolved event after 180 days.
4. `user_activity` remains in use for older social/security activity while product Activity uses `notifications`.
5. Ordinary message events can be classified by regex; a new event name may appear in both Activity and Messages or neither.
6. Legacy destination aliases require heuristics when both a conversation ID and booking/property ID are present.
7. Badge counts can differ by screen because they are composed from separate requests, caches, polls and interpretations.
8. Support cases and operational queues sometimes surface as Activity, messages, cards, or direct module navigation depending on origin.
9. Notification type names describe both real events and UI-era concepts; the repository does not have a registry with ownership and payload schema.
10. Followed-search delivery depends on the exact transition path that activates/updates a listing, not one canonical `listing_discoverability_changed` event.

## PROPOSED CANONICAL MODEL

### Domain event envelope

Every business transition writes one outbox/domain event in the same transaction:

| Field | Contract |
|---|---|
| `event_id` | Globally unique immutable ID |
| `event_type` | Versioned registry value such as `hotel.booking.checked_in.v1` |
| `occurred_at` | Server timestamp of committed transition |
| `actor_id` | Person/system/provider that caused it |
| `subject_type/id` | Authoritative aggregate that changed |
| `causation_id` | Request/idempotency/parent event |
| `workspace_scope` | Personal/worker/partner/hotel/staff/admin/creator recipient context |
| `payload` | Versioned minimum factual data; no secret credential in notification copy |

A notification projection adds recipient, read time, destination, presentation key, and action state. Copy is rendered from event facts, not stored as the source of actionability.

### Activity action state

| State | Meaning | UI behavior |
|---|---|---|
| `informational` | Historical fact; no obligation | Appears in recent/history; no primary CTA required |
| `actionable` | Underlying domain obligation is currently valid | Show one canonical action linked to authoritative record |
| `resolved` | Obligation completed, invalidated, cancelled or superseded | Original CTA disappears; item may remain as history/result |
| `expired` | Action window ended through a recorded domain transition | No original CTA; show reason/result where useful |

An event read cursor affects only unread presentation. Action state is recomputed/projected from the domain transition, not from the user opening the row.

### Inbox read model

One server read model returns:

- `messages_unread_total` and thread summaries across roommate, worker, hotel, and WeHouse case stores;
- `activity_unread_total` and actionable count;
- canonical thread/event IDs, context, state, presentation-safe summary, and destination;
- workspace-specific visibility from the same permission helpers as detail reads.

Realtime should invalidate/reload this read model. A focus/reconnect reconciliation with exponential backoff is a safety net. Frequent unconditional polling is not the state architecture.

### Event ownership examples

| Domain transition | Activity event | Message effect | Original CTA resolution |
|---|---|---|---|
| Property access accepted | `property.access_verified` to partner/queue | Existing operations case may receive a system timeline note | Upload-correction CTA disappears |
| Hotel payment verified | `hotel.booking.confirmed` | Stay conversation becomes available | Pay CTA disappears |
| Hotel checkout | `hotel.booking.checked_out` | Stay thread becomes read-only | Message hotel/check-out disappear |
| Worker completion submitted | `service.completion_review_required` to customer | Job thread remains writable | Worker complete CTA disappears; customer review appears |
| Worker block with protected funds | `service.payment_review_required` to participants/operations | Participant messages/calls stop; WeHouse case opens | Cancel/release CTAs disappear |
| Roommate mutual interest | `roommate.match_created` | One conversation capability becomes available | Accept/decline interest disappears |
| Followed-search match | `saved_search.match_found` | No conversation | Opens matching listing/search result, not Follow again |

### Followed-search contract

- Canonical criteria are normalized once in shared SQL semantics; clients may preview the key but the server is authoritative.
- Follow is an idempotent upsert. Exact duplicate active follows are impossible.
- Paused searches receive no matches; resuming does not replay old matches unless explicitly chosen.
- Every saved row is viewable, re-openable as a populated search, pausable/resumable, and removable.
- A listing emits a discoverability/version event whenever the public attributes relevant to matching change, not only on first publication.
- Match delivery has a unique `(saved_search_id, listing_id, listing_match_version)` key and produces one Activity item.
- Exact address/private coordinates are never copied into a match event for an actor who lacks access.

## Evidence

- `src/pages/Notifications.tsx`
- `src/pages/Chat.tsx`
- `src/components/CommunicationInbox.tsx`
- `src/lib/activityFeed.ts`
- unread aggregation in `src/App.tsx` and the feature summary hooks under `src/hooks`
- `src/pages/Search.tsx`, `src/pages/HotelsHome.tsx`, `src/pages/Saved.tsx`
- `src/lib/supabase/saved-searches.ts`
- `supabase/migrations/20260911124500_saved_search_identity.sql`
- `supabase/migrations/20260911142000_canonical_followed_search_lifecycle.sql`

## Regression contract

Service credential requirements and decisions use the existing Worker onboarding destination and `services` audience domain; review work uses `worker_operations`. Property expiry uses the Partner property destination in `housing` plus the scoped `property_operations` queue. Current approval resolves superseded attention/expiry work. Workspace names must not be passed as domain filters to `resolve_subject_activity`: that mismatch leaves completed work actionable. These events enter canonical Activity and the configured native delivery queue; real device delivery still needs provider/signing configuration and verification.

- Every registered event has a payload schema, owner, recipients, destination, action resolver, and privacy review.

Experience applications use the same canonical Activity pipeline. A submitted
revision creates `experience.application.submitted` for independent active Creators
and a host acknowledgement. Correction and decline decisions reach the owning
Service Worker workspace; only corrections require host action. Destinations are
`experience_review` and `experience_application`, with an exact application UUID in
`context_id`. Creator links require fresh private-evidence confirmation. They never
grant another applicant access or expose unsent/edited drafts. Withdrawal, archival,
resubmission and decisions resolve earlier actions for the subject; retained review
history is independent of unread status. Pre-service-review applicants can access
these updates and support through their existing Inbox. This database delivery does
not prove physical-device push delivery.
- A domain transition produces at most one event per recipient/event key.
- Reading never resolves; resolving always removes the old CTA on next projection.
- Ordinary messages never appear as Activity.
- An unresolved action is not hidden by time alone.
- Badge total equals the read model and is identical in every shell.
- A followed search can be round-tripped: search → follow → reload → detect Following → open saved criteria → pause/resume → remove.
