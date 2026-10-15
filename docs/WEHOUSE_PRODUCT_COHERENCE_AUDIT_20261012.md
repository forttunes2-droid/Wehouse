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

## 15 October follow-up — service, Showcase and paid tools

This follow-up is a targeted code read at local branch `reconcile/readiness-baseline-20261012`, HEAD `28766ae`. It is not a full application review or a deployment check. No service payment or live database changes were made here.

- **Confirmed charge model:** property reservation fee only where the property booking flow says one applies; no WeHouse reservation fee to a hotel guest; hotel partner commission is separate. For a Worker job, the customer pays the agreed service price plus a separate, optional WeHouse service charge; WeHouse also deducts Worker commission from the Worker’s share. Do not charge an identity-check fee.
- **Service money/review gap:** the current service review shows only the agreed amount as the customer total, and payment is disabled because Worker cancellation terms are not attached. It does not show a customer service charge or applied refund-policy version. The payment creation path initializes Paystack for the negotiated/agreed amount. The payment confirmation path rejects a charge that differs from that amount, calculates Worker commission from a compatibility `platform_settings` rate at confirmation time, then stores that commission and the Worker amount in payment protection. It does not snapshot the accepted fee policies alongside the quote. Therefore, neither a customer service charge nor an end-to-end two-sided service-fee settlement is implemented yet.
- **Misleading fee control:** the Creator fixed-fee screen is not the charge requested here. Its `fixed_fee_worker` policy says it is taken from a partner’s share, and the newer `calculate_commission` helper adds that fixed fee to Worker commission; the inspected payment-creation/confirmation functions do not call that helper. Do not rename this control to customer service charge or present it as live checkout behavior. Reconcile or retire it only as part of a migration that preserves unrelated property/hotel fee behavior.
- **Worker checkout requirements:** one atomic backend policy must calculate and snapshot the accepted service price, customer WeHouse charge, Worker commission, Worker net, currency and cancellation/refund policy before checkout. Booking review, Paystack initialization, verified webhook, protected ledger, refunds and payout must agree on those exact values. The current review screen is an interface component but this Worker instance is hard-disabled pending approved cancellation terms.
- **Creator/Admin security:** Creator step-up is server verified through the live Supabase session, Creator credential and short-lived action-scoped elevation; the credential is separately hashed and has failed-attempt lockout. High-risk Creator actions require a verified TOTP factor. Admin does not currently have the separately requested security-password/step-up flow; the decision log already marks it unbuilt. Do not tell the user an Admin password works until an Admin-scoped server implementation and tests exist. Old password functions in legacy SQL files are not evidence of a live secure implementation.
- **Showcase:** work-only post types, linked-job customer confirmation, Worker edit/hide/delete controls and private storage are foundations to keep. Public comments and reactions make it social; the agreed product direction is a focused portfolio with human review, clear “Worker-provided” versus customer-confirmed labels, reasoned moderation, and an appeal route.
- **Experiences:** not implemented. If validated, model it as a scheduled Service offer with capacity and its own booking facts; reuse the one account, Worker workspace, save, support, review and payment systems. Restaurant ordering is a separate later commerce flow, not another Worker service category.
- **Pro:** current Worker Pro has schedules, costs, packages, receipts and business records; Partner Pro has portfolio schedule, income, property tasks and occupancy tools. These are real foundations but not enough evidence to recommend opening paid sales. Keep core marketplace and safety free; add Pro only around tested, repeat business needs. Current competitor patterns support operations value, not a badge bundle: Airbnb makes multi-calendar, insights, rule-sets, extra fees and tasks optional professional tools ([Airbnb](https://www.airbnb.com/help/article/2499)); Upwork makes service packages comparable through scope, price, timing and add-ons ([Upwork](https://support.upwork.com/hc/en-us/articles/10408677826963-What-is-Project-Catalog)); Thumbtack emphasizes provider-controlled pricing and lead budget without a subscription ([Thumbtack](https://www.thumbtack.com/pro?directory=true)). For WeHouse, the strongest Pro test is whether a Worker can price a well-scoped package, manage actual capacity, understand net earnings/costs and convert suitable requests with less admin; Partner Pro should save time managing multiple listings, teams, turnovers and reconciled income. Verify those features work and measure repeat use/retention before billing. Never paywall visibility, trust, verification, response handling or safety.
- **Creator controls:** existing versioned settings cover several prices, commissions and operational switches, but do not make future product types or markets code-free. New capabilities still require implementation; after that, validated per-market settings should control rollout without country checks scattered through the UI.

### Next implementation slice

Before service checkout opens: select the customer service-charge formula and bounds; add a distinct Creator on/off policy; snapshot the accepted quote, both fee policies and cancellation terms; display the customer charge and total and the Worker’s commission/net in the right reviews; and calculate Paystack charge, ledger, refund and payout from the same immutable breakdown. Reconcile the existing fixed-fee control without changing property/hotel terms. Keep these as one money-flow change with database contract and Paystack sandbox evidence; do not merge the UI alone.

### 2026-10-15 implementation checkpoint

- Setup sign-out and “Sign out everywhere” now route through the same local session cleanup used elsewhere; the global sign-out action reports failures and does not leave an unhandled promise.
- Sent announcement history loads in 50-row pages; specific recipients are fetched in 50-user pages from the existing server-authorized RPC. The account-scoped inbox is now visible in every workspace shell. Creator audience preview and delivery now share a server-side active-workspace/scope matcher, with a database contract covering multi-workspace deduplication, branch/state staff, selected people, and the preview-to-delivery count. This makes current audience selection coherent, but is not the final high-volume architecture: search still spans loaded pages and fan-out is a synchronous transaction. Keep large-scale announcements gated until a scoped, idempotent outbox/worker is implemented and load-checked.
- Official announcements remain broadcasts. They do not provide a reply thread; a user who needs an answer should use the private support flow.
- A public Worker profile can be recommended to an accepted connection in the existing encrypted chat; the link resolves to the Worker profile route. A Showcase post can enter the existing service request/quote flow. These paths still need a real two-account/browser verification before release.
- The home Explore page already uses cursor paging and filters; roommate search loads 24 matches per page. Do not replace these with one giant client-side inventory list. A full cross-role Explore organization and responsive visual audit remains open.
- The idea of selling a general typo-correction API is not part of this release. First build user-confirmed suggestions over WeHouse-owned location and service dictionaries. Third-party place results have provider billing, attribution and storage/resale constraints; validate a licensable dataset and paying demand before offering an API.

This checkpoint does not close the service payment/refund blocker, foreign-market readiness, Admin step-up authentication, the full light/dark and device visual review, two-device encryption verification, or Paystack Test journeys. PR #118 remains unverified for merge until its CI, Vercel deployment, database replay and sandbox evidence are all green.
