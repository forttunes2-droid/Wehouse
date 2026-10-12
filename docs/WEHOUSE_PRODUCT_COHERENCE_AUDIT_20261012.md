# WeHouse product coherence audit

**Audit date:** 12 October 2026  
**Source:** PR #118, branch `reconcile/readiness-baseline-20261012`, commit `e1cd31264475d4dad19dbfdbb3f8c903ccb693fd`; read-only production Supabase inspection  
**Purpose:** preserve one product and operating-model audit for R1–R11. This is a code/schema/config review, not a claim that all signed-in production journeys have been exercised.

## Readiness checkpoint

At the source commit above, the required PR checks observed in this run passed: browser interaction matrix, media-compression/FFmpeg check, structural regression, build, isolated mixed-journey preflight, consolidation validation (migration replay, tests/build, existing-account upgrade), and deployment previews. Vercel had a READY deployment for the exact source SHA; Netlify preview was also green. Keep the Vercel URL and status tied to that SHA when the PR changes.

Production and test Supabase projects were queried read-only. Both were healthy, and their migration histories still differ (712 versus 694 entries); do not reconcile by applying migrations until the existing read-only release plan explains every difference. No production writes were made.

## Product map verified

| Journey | Current source of truth | What exists |
|---|---|---|
| Long Let | `listings` + `reservations` | Annual price/status and reservation lifecycle; not hotel inventory. |
| Short Let | `listings.sub_type='short_let'` + `reservations` | Nightly amount, max guests, amenities, min/max nights, advance window, check-in/out and rate/cancellation snapshots. Server-side availability checks date blocks and active reservations. |
| Hotel | `hotels`, `hotel_rooms`, rate plans and daily inventory/bookings | Separate room/rate/inventory flow; hotel room model includes bed type, guest limit, amenities and inventory. |
| Service booking | `worker_services`, `worker_bookings`, coverage, protected-payment and policy records | Verified worker, coverage, booking request, negotiated amount/date, protected payment, start/completion, cancellation, refund and dispute states. |
| Support | Support conversation/case RPCs and in-app Help | Human support cases, contextual records, attachments, status/events, assignments, reopen/complete and server-authorized messaging. |
| Announcement | Announcement and recipient records | Official in-app broadcast by account type or selected people, with branch scope, history, recipient/read counts. |

## Findings to carry into R1–R11

### P1 — Owner lifecycle is incomplete across hosting modes

There is a safe pause/reopen control for published properties in **Host manages** mode; it is owner-authorized, blocks new reservations, and records a commercial-change event. Home date blocking supports Short Let date availability. A general owner-facing unlist/delete request is not present in the verified flow. The database's `creator_remove_listing` is a creator/admin action; it soft-deletes and closes a listing and refuses removal while active reservations exist.

**R2/R10 action:** define one lifecycle for every stay type: pause/unlist from discovery, preserve confirmed reservations and evidence, owner removal request, review/fraud hold, reinstatement, and final deletion/retention. Surface those actions to the correct owner/host role. Never delete a live booking's property record as a shortcut.

### P1 — Reporting has storage and moderation, but no public detail action

Production has `listing_reports`, authenticated insert/read/update policies, and a branch-scoped admin moderation queue. The repository helper `createReport` exists, but the inspected public `ListingDetailCore` has no report action and GitHub code search found no caller for that helper.

**R2/R6/R10 action:** add a visible Report listing action from every public property type (home, Short Let, hotel, and service provider where applicable), with reason/details, abuse-rate controls, confirmation and a report reference. Route to scoped operations review; define when safety reports immediately hide a listing and how the owner/booking team is notified.

### P1 — Short Let listing details split across two models

The normal Create Listing form collects Short Let amenities and max guests but does not collect a bed type. The live `listings` table has no `bed_type` column. The managed property inspection/room flow collects room-level bed type and amenities; hotels also have a distinct room model with bed type. This is a product-contract gap, not a reason to add a duplicate column without deciding whether a Short Let is one whole home or a bookable set of rooms.

**R1/R2/R9 action:** choose the Short Let unit model (whole home with sleeping arrangements versus separately bookable rooms), then use one canonical source for bed/sleeping type, room/bed count, occupancy, amenities, cleaning/check-in rules, and displayed booking facts. Avoid using the hotel inventory model for a Short Let unless the product rule explicitly says they share it.

### P1 — Worker fulfillment assumes a customer-provided address

`create_booking_request` rejects a missing job address. Booking data stores address and location-source coordinates, but the checked service contract has no fulfillment mode for customer home, worker venue, agreed meeting point, or remote service. Worker service packages are shown as “example starting prices”; booking still follows the normal request/negotiation flow and does not select or snapshot a package.

**R1/R2/R9/R10 action:** model fulfillment mode and required location fields per service category; allow remote/worker-venue/customer-site bookings where appropriate. Let a chosen package define its deliverables, price, duration, exclusions, cancellation/refund terms and booking snapshot. Keep negotiation as an explicit alternate path.

### P2 — Bottom navigation is route-aware in the checked source

The fixed mobile navigation is hidden for `detail`, `hotel_detail`, and `hotel_booking`; listing and hotel detail also emit a nested-screen event. The tabs remain expected on top-level Explore/search and hotel discovery. The checked route code does not explain a persistent bottom bar on those exact detail routes. If still reproducible on device, record which page/modal is open and whether it is a brief opening transition; test nested room, share, review, and booking overlays on phone widths.

### Implemented foundations — retain, do not rebuild

- Short Let availability is date-aware on the server: validates date order, current date, booking window, min/max nights, host blocks, active reservations, publication and host-paused state.
- Hotel date availability is room/rate-plan inventory, separate from home/Short Let availability.
- Age and legal acceptance are structural. Signup setup asks for DOB, enforces 18+ in the form and saves it through `set_my_date_of_birth`; terms/privacy require review of current published versions and are saved with acceptance time/version. DOB lives in `profile_age_eligibility`, apart from general profile data.
- Support is a human case workflow, not an active Anthropic/Claude auto-responder in the inspected application. Repository search found no Anthropic/Claude integration. Gmail account/API sending is not part of this connected project/session. Legacy documents mention OpenAI chat and a server-side Edge Function refactor; treat those as historical debt, not proof that AI support is shipped.
- Announcements are a staff/operations feature for in-app official updates. They are not email campaigns or user-to-support chat.

## Security and performance evidence for R6/R8

All targeted lifecycle tables had RLS enabled. `listing_reports` policies restrict reporter rows and scope operational updates to authorized roles/regions. Relevant security-advisor output on production (12 Oct): 39 RLS-enabled/no-policy INFO findings; 15 anonymous-executable SECURITY DEFINER WARN findings; 506 authenticated-executable SECURITY DEFINER WARN findings; one leaked-password-protection WARN. The counts are not counts of confirmed vulnerabilities: classify each RPC by intended audience and inspect its body, authorization checks, grants, and abuse controls. RLS-enabled tables with no policies are blocked by default for direct roles, but verify whether controlled RPC/service paths are intentional.

Performance advisor: 16 unindexed foreign keys, 17 multiple-permissive-policy warnings, 198 unused-index INFO findings. Prioritize hot-path foreign-key and policy review with query evidence; do not drop unused indexes from this snapshot alone. Supabase Auth leaked-password protection is an admin configuration follow-up.

## Delivery order — avoid duplicate R1–R11 work

1. **R1:** confirm the product rules above and assign one canonical owner per domain (property, hotel, services, support, legal).
2. **R2:** close report action and owner lifecycle first; then resolve Short Let sleeping model and worker fulfillment/package contract.
3. **R4/R5:** finish read-only production/test migration reconciliation before any DDL; add only the selected contract changes as reviewed migrations.
4. **R6/R7:** audit the security-advisor RPCs and Edge Functions with negative and cross-account cases; enable leaked-password protection after configuration owner review.
5. **R9:** route/UI implementation should consume canonical models and make report, pause, request-removal, fulfillment mode, and package selection discoverable.
6. **R10/R11:** verify each end-to-end role/device journey, including reports, active-booking removal protection, hotel inventory, Short Let availability, worker fulfillment variants, support and announcement behavior. Keep browser check results tied to exact SHA.

Do not call R1–R11 complete until each gap has a named decision, implementation commit, role-specific verification, and evidence linked from the release roadmap.
