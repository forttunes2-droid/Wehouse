# Navigation

## Principle

Navigation answers “where am I?” A status answers “what condition is this record in?” An action answers “what can I do next?” Those three concepts must never be encoded as substitutes for one another.

## CURRENT IMPLEMENTATION

### Router

`src/App.tsx` is the current router. It uses `navPage`, local storage, hash/history, custom events, and separate state fields for listing, hotel, room, rate, reservation, conversation, worker, and roommate IDs. React Router is installed but is not the application routing authority.

Historical destinations remain restorable: `activity`, `notifications`, `chat`, `messages`, `my_bookings`, and `my_reservations`. Aliases normalize `messages`/`chat` to `conversation` and `my_bookings` to `my_reservations`. `activity` bridges into the unified Inbox/Activity surface. Both `conversation` and `notifications` can render `Chat`.

Back behavior is a mixture of browser history, an app-maintained history stack, fallback page IDs, component state, `wehouse:nested-screen` events, and page-specific headers. This explains why the back button can look and behave like a detached card rather than part of a coherent screen.

### Current workspace navigation

| Workspace | Current top-level destinations | Evidence |
|---|---|---|
| User mobile | Explore, Bookings, Inbox, Account | bottom navigation in `src/App.tsx` |
| User desktop | Explore and product links plus both Conversation and Inbox | `src/lib/nav2.tsx`; duplicate destination conflict |
| Property Partner | Properties, Inbox, Finance | `PropertyOwnerDashboard.tsx` / `CommunicationInbox.tsx` |
| Hotel team | Hotels, optional Inbox | `HotelTeamDashboard.tsx`; Inbox currently tied to staff access |
| Service Worker verified | Jobs, Inbox, Showcase, Earnings, Account | `WorkerWorkspaceModern.tsx` |
| Service Worker not active | Home/activation surface | `WorkerWorkspaceModern.tsx` |
| Staff | Home, one specialty work area, optional Bookings, Inbox | `StaffWorkspaceRepair.tsx` |
| Admin | Overview, Operations, Inbox | `AdminDashboard.tsx`, `AdminOperationsHub.tsx` |
| Creator | Overview, Operations, Inbox | `CreatorDashboard.tsx`, `CreatorOperationsHub.tsx` |

Operations hubs then use module selectors such as People, Team/Staff, Properties, Workers, Bookings, Finance, Analytics, Change history, and Settings. Property Partner “Properties” adds type filters (Apartment/Hotel) and lifecycle filters (All/In progress/Live/Needs changes). These are useful record filters, but visual treatment often makes them feel like another navigation hierarchy.

### Shells

- `WorkspaceFrameV2.tsx` provides the newer role workspace shell.
- `AccountShell` hosts personal and hotel-team experiences.
- Several full-screen components render their own fixed header/back control.
- `BackButton.tsx` is reused, but its surrounding chrome and history owner vary.
- Wrapper dashboards (`StaffDashboard`, `WorkerDashboard`, `PropertyPartnerDashboard`) preserve older naming and nesting.

### Recorded mobile evidence

The supplied recordings corroborate the code-level navigation findings:

- `151971.mp4` and `151972.mp4` show Property Partner Inbox correctly containing Messages and Activity, but opening a thread replaces the shell with a separate full-screen header/composer. Returning restores the bottom navigation, so the thread feels attached by an ad hoc back action rather than nested in the same route/shell.
- Several “WeHouse Property Operations” rows use the same title/avatar and distinguish different property cases only in tiny case/reference metadata. They are technically separate records but visually read as competing copies of one conversation.
- `151973.mp4` shows a hotel record as one long operations page. “Approved hotel → Rooms + packages → Live availability → Paid reservations → Stay check” is visually presented like a lifecycle navigator while room types, packages, daily pricing, venues, reservations and day-of-stay operations are stacked below. State summary, module navigation and editable entities are therefore mixed.
- `151968.mp4` shows the hotel purchase path as a succession of large stacked panels and a detached calendar sheet before another full-screen secure-booking form. The underlying steps are valid, but page ownership and progress/back semantics are not consistently expressed.

## INCONSISTENCIES / LEGACY BEHAVIOUR

1. Desktop exposes Conversation and Inbox as separate destinations even though both resolve to the same unified `Chat` product.
2. `notifications` and `activity` survive as routes after Activity moved into Inbox.
3. “Home” and “Overview” coexist for equivalent workspace landing pages. Admin/Creator use Overview, Staff and activation surfaces still use Home.
4. Workspace-local component state prevents durable deep links and makes refresh/back behavior dependent on the path taken.
5. Multiple shells and local full-screen portals duplicate headers, spacing, tabs, and back behavior.
6. Operations modules are rendered like dashboard cards that navigate into isolated mini-apps. Entity cards, module navigation, status filters, and CTAs share the same visual language.
7. Property Partner and hotel-team information architecture use different shells even though one person can own and staff hotels.
8. Mobile navigation limits `WorkspaceFrameV2` to five visible slots and moves additional destinations into More, while other workspaces invent different overflow rules.
9. Badges are assembled from multiple hooks/polls, so the same Inbox destination can show inconsistent counts across shells.
10. Hotel lifecycle step labels are used as a pseudo-navigation/progress strip inside the operations record, violating the separation between state and destination.
11. Property Operations cases use nearly identical thread presentation, making distinct case identities look like duplicate conversations.

## PROPOSED CANONICAL MODEL

### Route contract

Use a real route tree with stable URLs and typed parameters. A suggested shape is:

| Scope | Canonical route examples |
|---|---|
| Personal | `/explore`, `/bookings`, `/inbox`, `/saved`, `/account` |
| Record detail | `/homes/:id`, `/hotels/:id`, `/bookings/:kind/:id`, `/inbox/:threadId` |
| Worker | `/work/worker/overview`, `/work/worker/jobs`, `/work/worker/inbox`, `/work/worker/earnings`, `/work/worker/showcase` |
| Partner | `/work/partner/overview`, `/work/partner/properties`, `/work/partner/bookings`, `/work/partner/inbox`, `/work/partner/finance` |
| Hotel team | `/work/hotel/overview`, `/work/hotel/:hotelId/operations`, `/work/hotel/inbox` |
| Staff | `/work/staff/overview`, `/work/staff/:specialty`, `/work/staff/inbox` |
| Admin | `/work/admin/overview`, `/work/admin/operations/:module`, `/work/admin/inbox` |
| Creator | `/work/creator/overview`, `/work/creator/operations/:module`, `/work/creator/inbox` |

This is a product contract, not an instruction to change the router in one large release. Compatibility redirects should remain until telemetry shows old links are unused.

### Canonical workspace navigation

| Workspace | Primary destinations | Secondary views/filters (not top-level navigation) |
|---|---|---|
| Personal | Explore, Bookings, Inbox, Saved, Account | Home/Hotel/Worker category; active/history booking state |
| Worker | Overview, Jobs, Inbox, Earnings, Showcase, Account | Available/negotiating/protected/in progress/history |
| Property Partner | Overview, Properties, Bookings, Inbox, Finance, Account | Apartment/Hotel; in review/live/needs changes |
| Hotel team | Overview, Hotels, Reservations, Inbox, Account | Arrivals/in-house/departures; room readiness; date ranges |
| Field Operations | Overview, Assignments, Inbox, Account | Due today/evidence needed/completed |
| Worker Operations | Overview, Workers, Inbox, Account | Review status and risk filters |
| Admin | Overview, Operations, Inbox, Account | Modules and scoped queues |
| Creator | Overview, Operations, Inbox, Account | Modules and global queues |

If space is constrained, overflow may hide destinations visually but may not rename or duplicate them. Every workspace landing page is named **Overview**.

### Page composition rules

- One application shell owns header, bottom/top navigation, safe area, and back behavior.
- Back is part of the page header. It returns to the parent route, not an arbitrary fallback selected by the child component.
- A module row navigates; an entity row opens an entity; a status chip filters or describes; a primary button performs a domain action. Their visual treatments must be distinct.
- A nested record retains workspace context and a stable URL.
- Inbox is one destination with Activity and Messages views. A conversation is a detail route within Inbox, not a separate product.
- Completed/history filters remain available, but invalid CTAs are removed from each record.

## Route migration safeguards

1. Inventory every current page key and incoming notification destination.
2. Introduce a typed route adapter that accepts old keys and produces canonical URLs.
3. Migrate notification destinations and deep links before deleting aliases.
4. Move one workspace at a time to the shared shell.
5. Add browser tests for direct load, refresh, browser back, workspace switch, nested conversation close, and notification deep link.
6. Remove old route keys only after logs show no current events or external links produce them.

## Decisions requiring approval

See D-005 and D-006 in [DECISION_LOG.md](./DECISION_LOG.md): final primary destinations and whether Saved belongs in the primary personal navigation on all form factors.
