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

`notifications` is the current primary event table. Rows can contain a type, source type/ID, destination route/parameters, workspace scope, event key, created/read state, title, and message. Database functions emit notifications for property, reservation, hotel, worker, roommate, payment, payout, followed-search, security, and support transitions.

`Notifications.tsx` combines notification rows with `announcements`. `src/lib/activityFeed.ts` then:

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

`Search.tsx` and `HotelsHome.tsx` normalize structured criteria, load `saved_searches`, detect active/paused current criteria, and call `save_my_property_search` to upsert/resume. `Saved.tsx` lists, pauses/resumes, and removes followed searches. The database enforces a unique user+kind+criteria key and emits deduplicated notification events for matching future homes/hotels.

The current home matcher primarily fires when a listing transitions into available. It may not notify when an already-live listing is edited later so that it newly matches. Hotel matching is invoked by publication/update paths rather than one visibly universal event trigger. Criteria normalization exists in both TypeScript and SQL and needs parity tests. The saved list can be viewed and unfollowed, but there is no complete “open this saved search and reapply every criterion” route contract.

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

- Every registered event has a payload schema, owner, recipients, destination, action resolver, and privacy review.
- A domain transition produces at most one event per recipient/event key.
- Reading never resolves; resolving always removes the old CTA on next projection.
- Ordinary messages never appear as Activity.
- An unresolved action is not hidden by time alone.
- Badge total equals the read model and is identical in every shell.
- A followed search can be round-tripped: search → follow → reload → detect Following → open saved criteria → pause/resume → remove.
