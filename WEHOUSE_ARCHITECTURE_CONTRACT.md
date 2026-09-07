# WeHouse Architecture Contract

This document is the repository-level product contract. UI labels may be shared across roles, but ownership, records, actions, and routes must follow the rules below. A change is incomplete if it only makes screens look alike while breaking these boundaries.

## 1. Canonical language

| Context | Required term | Meaning |
| --- | --- | --- |
| Customer discovery, Saved, reservation, tenancy | **Apartment / Apartments** | A customer-facing apartment inventory item. |
| Customer hotel discovery and booking | **Hotel / Hotels** | A hotel and its independently bookable room types. |
| Partner, Creator, Admin, Property Operations | **Property / Properties** | The operational umbrella containing apartments and hotels. |
| Worker marketplace | **Service / Worker** | A professional service and the verified person providing it. |

Internal table, function, and route names may retain `listing`, `property`, and `homes`. Internal identifiers must not leak into customer copy.

## 2. Workspace and navigation ownership

Every authenticated role has one workspace shell, one account surface, and one authoritative destination for each record. A detail opens within its owning workspace and returns to the exact originating list/filter.

| Role | Primary navigation | Owns | Must not receive |
| --- | --- | --- | --- |
| User | Explore, Bookings, Inbox, Account | Personal discovery, apartment/hotel/service bookings, roommate relationships, personal messages and personal Activity | Staff queues, another user's actions, internal review states |
| Worker | Home, Jobs, Inbox, Account | Onboarding, availability, service jobs, customer conversations, reviews, wallet/payout state | Property review, unrelated reservations, branch operations |
| Property Partner | Properties, Inbox, Finance, Account | Submitted apartment/hotel records, correction requests, partner support, eligible earnings | Publishing authority, customer-private messages, unrelated bookings |
| Property Operations | Home, Properties, Inbox, Account | Assigned property intake, evidence review, field assignment, publication preparation | Worker review, finance, unrelated customer Activity |
| Field Operations | Home, Inspections, Account | Assigned visits, GPS/address confirmation, independent evidence and report submission | Partner access-video approval, publishing, unrelated Inbox/Activity |
| Worker Operations | Home, Workers, Account | Paid worker onboarding review and professional evidence decisions | Property publication, customer conversations |
| Support | Home, Conversations, Inbox | Assigned support lifecycle and replies | Marketplace approvals or unrelated operational events |
| Finance | Home, Finance Work, Account | Assigned payments, refunds, payouts and settlement exceptions | Content review and customer chat outside a financial case |
| Security Operations | Home, Security Signals, Account | Assigned authentication/session signals and escalation | General Activity, content review, customer booking control |
| Admin | Home, Operations, Inbox, Account | One assigned branch: people, team capacity, properties, workers, bookings, issues | Other branches or global Creator settings |
| Creator | Home, Operations, Inbox, Account | Global oversight, platform configuration, escalations and audit | A duplicate copy of staff work queues or users' self-generated notices |

`Inbox` contains conversations. `Activity` is a read-only subview inside Inbox only for roles and domains that have meaningful recipient-owned events; it is not a second work queue.

## 3. Routing invariants

1. Role resolution happens before rendering a protected route.
2. An unauthorized route is denied or redirected to the role root; hiding a tab is insufficient.
3. A role switch, logout, or invalidated session clears protected navigation state and cached private records.
4. OAuth logout returns to the normal signed-out entry. Device verification appears only when a server-side session policy requires it.
5. Conversation routes always resolve to the canonical conversation record. Starting a roommate or Worker conversation must open that thread inside Inbox, not a second inbox-like page.
6. Back navigation returns to the originating workspace and preserves its list/filter state.
7. Fixed headers, bottom navigation, sheets, keyboards, and media viewers respect `100dvh`, `env(safe-area-inset-top)`, and `env(safe-area-inset-bottom)`.

## 4. Inbox and Activity

- Chat is two-way communication; Activity is one-way awareness.
- Activity is recipient-scoped by actor, role, branch, ownership, and authoritative record.
- A user's own reversible action, such as abandoning/cancelling an unpaid reservation attempt, stays in Bookings and does not create an Activity item.
- Privileged roles do not receive customer reservation noise. They receive only work assigned to them, an action they must take, a material exception, or an escalation they own.
- Every Activity row deep-links to its authoritative record. It never becomes a second editable copy of that record.
- `read` means the recipient saw an item; it does not mean the underlying action is resolved. Action-required and exception events survive ordinary read pruning until a resolving lifecycle event or the protected retention limit.
- Deduplication is per source and domain lane (for example payment, inspection, housing, hotel, Worker, roommate), never per source alone. A payment update cannot erase an inspection action for the same booking.
- Security, money, support, apartment, hotel, roommate, and Worker events retain their domain and audience; category labels do not broaden access.
- Timestamps come from persisted server timestamps and display in the viewer's locale. Optimistic client time is not authoritative.

## 5. Lifecycle boundaries

### Apartments

Partner submission → access evidence → Property Operations review → Field Operations assignment → independent visit evidence → approval/publication → customer reservation → reservation payment → inspection → rent agreement/payment → handover/move-in → tenancy/checkout.

- Partner evidence and Field Operations evidence are different records.
- Reviewing access evidence does not replace the independent field visit.
- Customers see **Apartments**, customer-safe statuses, and only an approximate area until reservation payment is confirmed and the exact destination is permitted.

### Hotels

Partner hotel submission → hotel/common-area evidence + room-type inventory → access evidence → Property Operations review → Field Operations visit → hotel approval/publication → room/date selection → reservation/payment → check-in → checkout → deposit/refund where applicable.

- A hotel is not rendered as an apartment listing.
- Room type, rate, capacity, amenities, photos, and inventory remain attached to the hotel program.
- Hotel review may share operational gates with apartments but retains hotel-specific inventory and booking states.
- Creating or abandoning an unpaid room hold never creates a customer booking code. One globally unique code is allocated only after verified payment confirms the stay, and check-in accepts it only while that exact paid booking is valid for arrival.
- Cancellation, expiry, refund, completion, or a payment conflict cannot be used to revive or check in a booking. A previously paid code may remain on the internal audit record while customer and staff actions are disabled.

### Workers

Account → mandatory onboarding details → mandatory onboarding fee → identity/liveness → professional evidence → Worker Operations review → verified marketplace publication → request → negotiation → secured payment → job → completion approval/dispute → review → payout.

- **WeHouse Service Worker** is the canonical marketplace identity. The **Gold Tick** is its visual reviewed-status mark and requires the complete server-confirmed trust chain, including the required onboarding payment.
- **WeHouse Trusted** is an optional earned performance tier above a reviewed Gold Tick worker; it is not a competing identity or alternate verification system. Ratings and counts come only from completed WeHouse jobs.
- Legacy accounts do not bypass missing gates. Rollback returns the worker to the earliest incomplete gate and removes marketplace visibility.
- Creator/Admin oversight can suspend access or handle exceptions; it does not duplicate Worker Operations review.

### Support

Contact → thread creation → branch/category assignment → reply → escalation when required → resolution → reopening on a new customer reply.

- One issue has one support thread linked to its authoritative context.
- The requester and assigned support scope are the only normal readers; escalation explicitly adds oversight.

### Private conversations

- Roommate and Worker private messages use per-conversation keys. Users never choose or share the same PIN/password.
- A PIN unlocks one user's local encrypted key material; it is not a shared conversation secret and is never displayed as message content.
- Setup, recovery, reinstall, blocking, media, and multi-device behavior must preserve authorization and message ordering.

## 6. Status and filtering rules

1. Store canonical machine statuses; map them to role-appropriate labels at presentation time.
2. A filter changes only the visible set. It must not create, mutate, or duplicate lifecycle state.
3. Counts and badges use the same scope and predicate as the destination list.
4. `All` is a real union of the permitted statuses, not a separate backend state.
5. Terminal records stay in their authoritative history where legally or financially required, but do not remain in active-work counts.
6. Draft or unpaid abandoned attempts may be retained for payment/audit safety without being presented as completed history or Activity.
7. Apartment and hotel filters never merge records merely because both are properties operationally.

## 7. Media and performance invariants

- Images and videos open inline or in the shared WeHouse full-screen viewer; normal media viewing must not launch a browser tab.
- Image selection shows a local preview immediately and revokes blob URLs when removed/unmounted.
- New listing/work images are resized and compressed before upload; raw multi-megabyte phone photos are not retained merely for display quality.
- Upload UI reports real byte progress, supports failure/retry, and limits parallel transfers on mobile connections.
- Private media signed URLs are batched, cached only within their expiry, and never persisted as authoritative references.
- Video elements use `playsInline` and `preload="metadata"`. Production-grade long video requires a transcoding/streaming pipeline with poster images and adaptive delivery; raw object storage alone is not considered excellent.
- First visible media may load eagerly; off-screen galleries use lazy loading and async decoding.

## 8. Evidence required for “excellent”

Green build, lint, migration, and preview checks prove a deployable structural implementation only. “Excellent” additionally requires live evidence for RLS, unauthorized routing, every lifecycle above, two-user/two-device encryption, supported call networks including TURN, phone/tablet/desktop interaction, upload/view performance, console/network cleanliness, and triaged security warnings.

Any intentional exception must name its owner, scope, reason, risk, expiry/review date, and test evidence.
