# WeHouse product coherence audit

**Audit date:** 12 October 2026  
**Source:** PR #118, branch `reconcile/readiness-baseline-20261012`, commit `e1cd31264475d4dad19dbfdbb3f8c903ccb693fd`; read-only production Supabase inspection  
**Purpose:** preserve one product and operating-model audit for R1–R11. This is a code/schema/config review, not a claim that all signed-in production journeys have been exercised.

## Readiness checkpoint

**23 October follow-through:** C-064 has a private canonical physical-space registry
on Test, optional grouping/copy/reuse in the existing submission form, scoped
review/public/booking labels, whole-home/private-room reservation guards and
Partner inventory labels. Actual customer conflict and unpaid cancellation-release
SQL checks pass; simultaneous races and grouped stock/defaults/calendar remain open.
Property submission browser checks pass 13 cases. Partner assets pass 34 cases,
including compound grouping by canonical identity, explicit annual/nightly prices,
recorded currency and read recovery. Partner history passes 12 browser cases with
bounded pagination and permission-scoped older booking links. Field/publication
review passes 12 browser cases and normal-Auth rollback checks through audited
assignment, canonical Creator access and revocation denial. The V2 review wrapper's
legacy-role/RLS mismatch is repaired without widening direct table policies.
The current source suite passes 656 tests; TypeScript, focused lint and build pass.
Host arrival now binds the customer code to the exact reservation, validates the
occupied receipt and bounds waiting. Private activation prevents a Host bypass
through staff endpoints. Normal-Auth rollback SQL passes actual customer checkout,
seeded verified provider/payment/ledger/Protection, exact Short Let check-in and
idempotent retry with one policy snapshot; this is not live PSP evidence. The full
wallet/Pro browser suite now passes 83 cases including wrong arrival receipts.
Hotel cancellation's missing snapshot and refund projections are repaired on Test;
preview and locked cancellation share eligibility, the local screen reviews exact
amount/deadline before confirmation, and verified refund completion reaches the
receipt. Its replacement normal-Auth SQL contract keeps triggers/RLS enabled;
36 browser cases pass. PMS queued cancellation, stale-ack refusal and atomic current
acknowledgement pass rollback SQL checks. The updated Test gateway uses correct event states,
bounded input and request budgets; hosted missing-token smoke returns 401. Synthetic
approvals/providers/users are rolled back. Atomic catalog/room-status checks pass
late-error rollback, price/stock validation, committed-receipt recovery and assigned
unit protection. Thirteen gateway handler checks and Deno check pass. Public Long Let
search/detail also respect a linked Short Let hold and recover after cancellation.
Source UI is not deployed and Production is unchanged.
The release register retains remaining internal work and external dependencies;
this is not whole-product readiness.

**22 October latest follow-through:** Provider API refund reconciliation now
shares the canonical ledger routine with signed webhook receipts, while keeping
their proof methods distinct. Bounded reconciliation and a configuration-gated
minutely scheduler are applied to Test; processor v3 and interactive reconciliation
v2 are deployed there. Real hosted Auth checks passed scoped Finance/Creator
access and device revocation; fixtures were removed. Missing Test provider and
scheduler credentials still prevent real settlement/dispatch verification.
Finance summary failures no longer fabricate zero counts, and both provider
wallets share validated NGN balances. The full isolated wallet/Pro browser suite
passed 81 cases, with eight additional summary and eight wallet recovery cases.
Private call ownership is bound to live trusted originating/answering devices;
the normal-Auth rollback contract passes block/preference changes, other-device
denial, revocation and signal cleanup. The broken Roommate restore reference is
repaired without removing its waiting period. Late media permission cleanup,
subscription cleanup and network-receipt guards have regression tests. Full
source suite passed 633 checks; build and focused checks passed. Exact Pro and
Sponsored amounts now use the common market contract locally. The existing
release register records deployment boundaries and remaining internal work;
this is not whole-product completion or real PSP/two-device calling acceptance.
Further Test repairs serialize financial actions per protected payment, verify
the original successful provider charge before a refund POST, and deploy processor
v4/reconciliation v3. Pro setting writers now share trusted canonical Creator
authority. Fifteen absent Service Pro controls were restored with sales disabled
and existing values preserved. Expanded Finance rollback checks pass Creator
access, price precision and revoked-device denial; twelve isolated call browser
cases pass across both themes and three widths. See the release register for
the exact forward migration versions and remaining internal gates.

**22 October financial recovery follow-through:** Test migration
`20261022144813_financial_action_recovery_visibility.sql` moves interrupted
15-minute processing claims into manual review without resubmitting money.
Uncertain refunds now block another refund against the same protected payment.
The existing Finance queue exposes scoped action/provider references and errors;
the actual component passed six isolated browser checks in both themes at
320/768/1440 pixels. Normal authenticated-role rollback tests passed for scope,
revocation, service-only execution, fresh claims and recovery retries. The full
automated suite passed 618 checks after late-receipt fixes. Provider reconciliation/resolution, scheduler
and deployment remain open. A removed-toast pointer-blocking defect found during
broader browser checks is fixed locally; the rerun passed 81 isolated wallet/Pro cases. Late verified refund events recover uniquely matched attempted actions; submission responses preserve their bound provider receipt. Ambiguity and missing proof remain unresolved.

**22 October booking and service follow-through:** checkout now discloses the
Short Let reserve-date fee, stay charge and caution as one saved total before
payment. Arrival access reuses canonical payment authorization; move-in and
inspection commands enforce trusted sessions and checked receipts. Nine service
commands reject inactive/untrusted sessions. Completion confirmation and actual
release are distinguished in chat and payment projection. The full 608-test
suite and build passed; three additional financial processor recovery tests
passed. Five related Test migrations are recorded in the existing release
roadmap. Positive hosted whole-booking/whole-job settlement, unfinished inventory,
monthly rent and Experiences remain open; this is not whole-product acceptance.

**22 October inspection and Finance follow-through:** actual authenticated-role
Test contracts exposed and repaired the missing customer-inspection completion
column, incorrect report projection, stale assignment/coverage access and mutable
submitted evidence. Inspection start, submission, correction, resubmission and
independent review now pass targeted database checks; current access approval,
revoked devices and additive Team grants are covered. The Staff screen shows
correction instructions and applies the four-photo rule only to property supply.
Local payout repairs preserve held funds after uncertain provider responses and
validate matching transfer and action receipts. The Finance queue uses canonical
Team identity and a trusted session. The payout function repair is not deployed.
600 tests, 12 inspection and 79 wallet/Pro isolated browser cases, build, focused
lint and payout type-check passed. The existing release roadmap records exact
Test migrations and remaining hosted/recovery/provider gates; this is not a
whole-product completion claim.

**21 October routing and scale follow-through:** actual Test RPC checks found
missing case-reason configuration, overly broad conversation uniqueness and a
queue filter that mistook the shared case channel for General Support ownership.
Three forward migrations restore the catalog, retain one conversation per case,
and route by operational ownership. Six real first-send paths now pass with
matching-branch staff claim/reply and cross-domain/branch denial. Customer Inbox
refresh bursts are coalesced through the existing scheduler. Public-index metadata
contains no structurally equivalent duplicates; that does not close the table/data
or hosted-capacity audit. The v4 brand ZIP and vector source were inspected, with
application branding unchanged. Evidence and remaining gates are in the existing
release register.

**21 October operational support follow-through:** Finance, Security and Service
Worker Operations now expose their server-supported domain message queues with
the shared Activity entry. Creator/Admin assignment controls follow the same
claim-before-reply authority as staff. Replies and private notes reuse the existing
message table with server-enforced intent receipts; uncertain sends retain their
composer/evidence for retry. Test SQL verifies replay, private-note separation,
assignment, unrelated-person and revoked-device denial. Twenty-four isolated customer
workspace browser journeys pass in light and dark themes, including a lost receipt
and duplicate-free retry. Read receipts now use central conversation scope; requester
reads cannot consume private-note receipts, and note-only team updates are acknowledged.
Customer previews, counts and message reads exclude private notes. Direct-table
RLS also excludes notes for an owning requester with a privileged legacy role;
rollback checks exercise the actual authenticated database role. Message-table
client writes are revoked in favor of controlled RPCs. Operational and customer
support Inbox reads require trusted active sessions. Test migrations are recorded
under `20261021183712`, `20261021184300` and `20261021184531` in the release register.
The 585-test checkpoint and production build pass; these are not hosted acceptance
of all dashboards. Security Operations action receipts were subsequently tightened;
the full role/scope and dashboard/table audit remains open in the release register.

**21 October connected provider follow-through:** common workspace access is now
separate from requested-service review, with existing-job management preserved after
credential expiry. Experience submissions and decisions enter canonical Activity;
applicants can read feedback before service approval. Exact-record authorization
protects unsent and newly edited drafts. Current source regression passes 583/583,
14 isolated host/Creator browser scenarios pass, the 20-assertion application SQL
contract passes with rollback, and the credential contract passes with reviewed and
expired-existing-job capability checks. Build and focused lint pass. Scope, Test
migrations, advisor findings and remaining internal dependencies are recorded in the
existing [release roadmap](WEHOUSE_RELEASE_ROADMAP.md). Production is unchanged;
Experiences sales and the full product are not ready.

**21 October working-tree follow-through:** shared motion tokens now align Login,
workspace navigation, media and reusable controls/panels, including reduced motion.
Found and repaired malformed identity-gate response handling, false empty job/Inbox
states, overlapping refreshes, cross-account badge state and partial-read count loss.
Receipt fixes cover paper contrast, verified-data validation, refreshed status,
reference/purpose matching, reload recovery and independent receipt retry. See the
21 October checkpoint in the existing [release roadmap](WEHOUSE_RELEASE_ROADMAP.md)
for exact scope and evidence. These changes do not complete Experiences or the full
release gates; the original baseline below remains historical evidence.

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

### P1 — Reporting is available on selected surfaces, but product coverage is incomplete

The current branch has an authenticated Report listing action and dialog on `ListingDetailCore`, profile reporting through `PublicProfileSurface`, and person/chat reporting in the chat surfaces. `createReport` stores a `listing_reports` row and the scoped operations queue exists. The public Hotel detail route has no matching Report hotel action, and the listing dialog reports success without showing the returned report reference or a durable receipt/status view. Its copy correctly says submission does not automatically cancel a reservation or hide the listing, but the urgent safety escalation described in `PRODUCT_RULES.md` is not surfaced by this form.

**R2/R6/R10 action:** keep the existing action; complete coverage for public Hotels and other reportable entities, return a durable receipt/reference, add duplicate/abuse controls and make the urgent safety route visible. Keep a report separate from booking cancellation/refund and use scoped operations review. Do not auto-hide a listing merely because a report was submitted.

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
2. **R2:** complete report coverage/receipt and owner lifecycle first; then resolve Short Let sleeping model and worker fulfillment/package contract.
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

## 2026-10-19 verified baseline refresh

This baseline refresh checks branch `reconcile/readiness-baseline-20261012`, local HEAD `4283d6d1856e5e36665cb6c49048a987ab25c4f7`, PR #118 and connected service metadata. Since that commit, this working tree now includes the Long Let reservation-panel correction, the shared 12px typography floor, and regression-test updates for platform portability and the current region-aware accessible labels. These local changes have not been pushed or tested by exact-SHA CI. No production database, migration history, deployment setting, or external provider state was changed.

### Release and runtime findings

| Severity | Finding and evidence | Roles / impact | Repair order |
|---|---|---|---|
| **Critical operational blocker** | The Vercel project reports `live: false`. Requests to both `https://wehouse.com.ng` and `https://www.wehouse.com.ng` returned HTTP 402 `DEPLOYMENT_DISABLED`; direct fetch of the latest listed production deployment URL returned the same. Vercel metadata still lists a READY production deployment for `main` SHA `f990fc4a8d6b508badb232de0b071f13109e615b`; READY metadata is not evidence the public service responds. Do not claim production is available until the project/domain is re-enabled by its owner and a smoke test succeeds. | All public and authenticated roles; service unavailable at the inspected domains. | Human Vercel project owner must resolve the disabled deployment/account state. Recheck the same domains and role journeys after recovery. No deployment setting was changed. |
| **High release blocker** | PR #118 is open, unmerged, mergeable and points at the inspected HEAD. Exact-HEAD workflows: Structural Regression failed; Build Check failed in `npm run build`; Consolidation Validation's application build failed, while its migration replay, database contracts and existing-account upgrade passed; Experience Browser media-compression passed but its isolated browser-interaction step failed; hosted Test catalog failed. Capacity Stage 1, mixed-journey preflight and the disposable medium catalog passed. Netlify's exact-head status is success; GitHub's Vercel status is failure. Results are linked to SHA `4283d6d`, not to uncommitted local files. | All roles; release cannot pass required quality gates. | The local Long Let correction removes the obsolete “Rent options” action and callback left behind after removal of the rent-plan modal. Local TypeScript, lint, and production build pass. Full browser logs show the 320px roommate-preferences case timed out on stale `Preferred State` / `Choose preferred state` names; the current component exposes `Preferred state or region`. The test now asserts the current accessible names and keeps the full state/city selection path. Local browser verification and exact-head CI remain open. |
| **High environment gap (partly resolved)** | Host has Node 24.21.0 and npm 11.19.0 (`npm.cmd`), Deno 2.9.6, Python 3.12.10, and pinned Supabase CLI 2.114.0. The CI-equivalent 15-file Edge Function type check passed and the complete Node/Python suite passes 500/500. A local Playwright 1.57.0 install timed out at 18.9/36.6MB from files.pythonhosted.org; Edge is installed but the browser test cannot yet run locally. The Node test launcher selects `python` on Windows and preserves the assertion. TypeScript, lint and production build pass; targeted design/document tests pass 5/5. Docker is needed for local Supabase stack replay, not ordinary Vite/React development or read-only Phase A; the user is installing it. | Engineering/release checks. | Rerun the updated browser test on exact-SHA CI; retry the local Playwright install if CI evidence is unavailable. Use Docker only for local DB replay when available; do not make Docker an unnecessary prerequisite for ordinary web work. Do not weaken or skip checks. |

### Data and security findings

- Both connected Supabase projects report `ACTIVE_HEALTHY` on PostgreSQL 17.6.1.166 (Test) and 17.6.1.121 (Production). Read-only migration inventory: 757 executable repository migrations, 736 in Test, 712 in Production. The histories are not simple prefixes. This is an unexplained release-order/history divergence; there were no DDL or migration-history writes. A version-by-version disposition is required before any schema mutation.
- A fresh read-only comparison on 19 October 2026 records every non-identical version row in [MIGRATION_HISTORY_DIFF_2026-10-19.csv](MIGRATION_HISTORY_DIFF_2026-10-19.csv), tied to repository commit `449d8ccd0435825c7372c7a7ba00d0ce20023a86`. Of 757 repository versions, 670 also appear exactly in Test (87 repository-only; 66 Test-only) and 678 appear exactly in Production (79 repository-only; 34 Production-only). The comparison found 27 same-name candidates on each side of the Test difference and 8 repository / 21 remote same-name candidates in Production. These are leads, not proof that SQL or resulting schema is equivalent; repeated production entries have different recorded versions. All 266 difference rows remain **UNRESOLVED**. Compare source SQL, migration logs and actual schema before assigning a disposition. No migration or history row was changed.
- Production security advisors currently report 39 INFO tables with RLS enabled and no policies, 15 anonymous-executable and 506 authenticated-executable `SECURITY DEFINER` functions (WARN), plus leaked-password protection disabled (WARN). Test reports 49 RLS/no-policy INFO, 17 anonymous and 551 authenticated callable `SECURITY DEFINER` functions. Advisor counts are review inventories, not counts of proven vulnerabilities. In sampled function definitions, `begin_identity_provider_password_recovery` uses a uniform response and per-account 5-per-15-minute limit; `get_accommodation_rate_terms` returns active public cancellation terms; `accept_current_worker_pro_terms` binds acceptance to the authenticated, active, verified Worker. These are examples only; the full callable-function inventory still needs purpose/grant/body/abuse-control review before findings can be closed.
- Production performance advisors report 16 unindexed foreign keys, 17 multiple-permissive-policy warnings and 198 unused-index INFO findings. Test reports 19, 17 and 274 respectively. Do not drop indexes or merge policies solely to clear advisor counts: confirm query paths, intentional policy union semantics and query plans first.
- An earlier hosted Test catalog run failed at 200 requests/second. The newer exact-SHA `449d8ccd` run passed through 200 RPS with 6,000/6,000 requests, 0 errors/retries/drops and 221ms p95. The disposable medium catalog also passed its synthetic-data read/resource stage. These catalog tests do not prove end-to-end app or payment capacity; 1,000 RPS has not been run.

#### 19 October read-only review of anonymous `SECURITY DEFINER` functions

A direct read-only Production catalog query found 15 `public` `SECURITY DEFINER`
functions executable by `anon`. Every reviewed definition pins `search_path`.
Fourteen are `STABLE` reads; one is the deliberately `VOLATILE`
`begin_identity_provider_password_recovery` flow. No confirmed anonymous data
exposure or authorization bypass was found in this group. This is a bounded
review; it does not close the separate 506 authenticated-callable function
inventory or prove protections against every abuse pattern.

- Public discovery reads (`get_discoverable_homes`, `get_discoverable_hotels`,
  `get_discoverable_listings`, `search_discoverable_homes`,
  `search_discoverable_hotels`, `get_sponsored_discovery`) filter to approved,
  active/published resources, use bounded page/slot sizes, suppress exact
  coordinates in public projections, and require verified, visible, active
  workspace state for sponsored Workers. The sponsored Worker result is
  additionally withheld from anonymous callers.
- Detail and review reads (`get_public_hotel_detail`,
  `get_public_listing_detail`, `get_hotel_review_summary`,
  `get_listing_review_summary`) gate public views on publication/approval and
  give internal detail access only through scoped owner/team/Creator/Admin/Staff
  checks. Public detail projections hide exact coordinates; review eligibility
  is derived from the current signed-in profile and qualifying paid/completed
  booking state.
- `get_short_let_date_availability` checks publication, approval, pause state,
  stay limits, host date blocks, and conflicting reservations. Its current
  “today” boundary is hardcoded to `Africa/Lagos`; keep this as a
  future-market regionalization item so availability uses the listing/market
  time zone before enabling Short Lets outside Nigeria. Do not patch Production
  while history reconciliation is unresolved.
- `get_accommodation_rate_terms` returns effective global policy versions;
  `get_current_legal_documents` returns only active, effective, reviewed,
  public-disclosure legal versions. `preview_resource_invitation` requires a
  pending, unexpired link token whose hash matches, then returns a constrained
  invitation preview.
- `begin_identity_provider_password_recovery` returns an indistinguishable
  random attempt shape for unknown, unlinked and rate-limited accounts, uses an
  account-scoped transaction lock, and permits at most five attempts per
  account per 15 minutes. The recovery Edge Function requires a valid Auth
  session; claim/finish routines bind the attempt to fresh provider sign-in,
  the linked identity and that session before changing a password. No per-IP
  limit was established by this SQL/Edge source review; confirm an edge/WAF
  limit during the operational abuse-control review.

### Product, workflow and design findings carried forward

The earlier findings remain verified against the code and current canonical docs: (1) the public property flow has no general owner pause/unlist/removal request across all hosting modes; (2) reporting is present on listings, profiles and chat, but direct public Hotel reporting, a durable receipt/status and the urgent safety path remain incomplete; (3) Short Let creation/details lack one approved unit/sleeping model and bed facts; and (4) Worker service booking requires a customer address and shown packages are not selected/snapshotted into the negotiated booking. Each affects several roles and has a different ownership/lifecycle; do not combine them into a generic property or worker flow. Unit and fulfillment semantics require product-contract decisions before database changes.

Other release blockers already documented remain open: service-fee and refund-policy snapshots; Admin step-up; Paystack charge/webhook/refund journeys; hotel discount and Friend split rules; legal publication/approval; two-device encrypted messaging; staff/Creator/Admin access checks; and role-by-role phone/tablet/desktop plus light/dark review. These are not closed by a green build.

### Phase A exit and current next actions

Phase A has an evidence-backed, read-only baseline. Phase B has reconciled accepted market scope and documented unresolved sellable-unit, fulfillment, package/quote, owner-lifecycle and response-clock decisions. Phase C has begun with a shared design contract, 12px minimum rendered text, and a focused correction to the Long Let reservation panel; full route-level visual and journey review remains open. Next: finish local Python/Deno checks, continue the route and security reviews, prepare (but do not apply) the migration disposition, and reproduce the browser failure from its actual assertion. No production mutation or broad rewrite is authorized by this audit.

### 19 October implementation follow-up (supersedes the earlier next-actions paragraph)

The full readiness scope remains active. Additional owner requests belong to the existing release work register and do not replace the money, permissions, supply, legal, design, migration or operational gates.

Targeted Test migrations repaired listing-report routing, Friend schema, durable withdrawal receipts, Pro RPC/schema alignment, the single writable job-cost amount, review resolution and financial action throttling. Repository throttle migration timestamp is aligned to the recorded Test version `20261019154146`. Production remains unchanged; fresh replay and full migration-history disposition are still required.

Worker and Partner wallets share durable withdrawal intents and canonical activity rendering. Lost responses retain the same request identifier, and protected money is not displayed as a second released credit. Payout-account reconciliation now retains a missing-ledger request rather than declaring failure after an arbitrary two minutes. Its terminal recovery/support path still requires completion; this is not evidence of a real provider payout.

The owner removed shows and parties from Experiences. The previous nightlife/event-directory/referral proposal is withdrawn. The remaining activities proposal does not authorize fictitious listings or incomplete checkout.

Username login was already supported by the sign-in form and identifier adapter; the entry button incorrectly advertised email only and is corrected. The shared search/hotel price slider had two identically labelled pointer-only handles and hard-coded dark colours. It now exposes separately named minimum/maximum sliders with keyboard steps, bounds, accessible current values, focus indication and theme tokens. Browser checks are being rerun after this change.

Initial role-source tracing confirms that Creator exposes people, properties, workers, finance, reports, refunds, legal and audit workspaces. Property pipeline UI includes Creator oversight and an exception path. This is not proof that every required server action works without staff: independent evidence/self-review rules and the actual permission contracts still require journey verification. Do not weaken those controls merely to make a solo operator appear supported.

Partner Pro and Worker Pro retain the existing workspace navigation. The current implementation places their main panels under Tools and Paid Tools respectively; useful in-context entry points, entitlement enforcement and consistent wording remain part of the ongoing review. No full-role visual or global scalability certification has been established.

Verification follow-up: full source suite 511/511; isolated Wallet/Pro and price-control browser scenarios 32/32; production build, lint and type validation passed. Creator's seven focused behavior tests passed after the overview refresh change. Friend's three naming/workflow checks passed after removal of event presets. These are local/isolated checks, not exact-SHA CI or real-provider end-to-end evidence.

### 19 October continued: payout recovery and internal finance

The same readiness programme continued through the financial failure paths. Payout-account polling every five seconds could consume the Edge Function's shared allowance of 20 requests per ten minutes. The client now serializes checks and spaces them at least one minute apart, including manual checks. No mutation is retried merely because a response is late.

Request references now persist in local browser storage, with migration from the prior session-only key. Unreadable/corrupt storage blocks a new request rather than silently deleting the identifier. Account read failures display retry rather than pretending no bank exists. Bank-list and account-resolution reads have bounded waits and release their loading states. Account saves remain pending until confirmed; the user can close setup and find the same reference and support action. Support receives the request reference and the originating Worker/Partner workspace; the existing first-message path is responsible for creating the case. This browser navigation evidence does not prove privileged provider reconciliation or case resolution.

The app previously offered a bank replacement flow that the server always refused pending additional sign-in verification. The current UI explains that restriction and offers support instead of implying replacement is available. Implementing secure replacement remains a release gate; support must not bypass that security requirement.

The shared internal finance screen also treated a failed read as an empty queue and could leave a thrown payout action busy. Reads now reject malformed/incomplete responses, handle network failures and timeouts, reject late read results, and show an explicit retry state. Payout actions have an immediate duplicate-action guard and reset busy state in finally. An uncertain network response reloads authoritative records without claiming a transfer succeeded or failed. The isolated browser fixture substitutes Creator elevation and provider responses; it does not establish actual step-up or provider money movement.

The Experiences proposal now specifies a complete scheduled-activity journey, including provider review, dated sessions, atomic capacity holds, checkout revalidation, late-payment reconciliation, canonical earnings, cancellation/refund, reviews and Creator operations. Code inventory found no active Experiences catalog or booking implementation. No Experience UI, schema or commerce has been published.

Verification at this checkpoint: 511/511 source tests, 41/41 isolated browser scenarios, production build and focused lint passed. The browser scenarios include bank-list/account-resolution timeout recovery. Production and remote Test were not changed in this continuation.

### 19 October: full-scope inventory and Friend planning clarification

The existing release register now includes the full requested feature scope and distinguishes not implemented, implemented/verification pending, not inspected and external approvals. It includes declared navigation families and nested-control coverage, auth/permissions, domain rules, real-provider money reconciliation, Pro lifecycle, moderation, data rights, discovery, deployed parity, dependencies, recovery, legal/operations, global expansion, native release and exact-commit promotion. This is the inventory of known work, not a claim that unknown defects have all been discovered. The earlier 2–4 week range is withdrawn for the full scope; dates require verified work estimates and external approval dates.

Current source counts: 37 declared navigation keys including aliases; 49 page modules; 222 component modules; 26 Edge Function directories; 764 active migration SQL files; 74 SQL contracts; 92 Node test files. Counts are not a completion measure and do not close nested role/state/action coverage.

The Friend list/entry point was inside Inbox Activity. It now belongs to Inbox Messages, including opening a Friend deep link. Individual conversation-only views do not display the contacts panel. Plan wording uses Suggest a plan / Plan together, explains that no booking/payment is created, and supports a short custom activity when Something else is selected. A two-person plan is the sender plus one accepted Friend. Friend groups are a separate, unimplemented private coordination feature; neither creates a booking, debt or Roommate relationship.

The current Experiences proposal is compared with public Airbnb host/cancellation rules and Booking.com Attractions responsibility disclosure. It has a coherent proposed lifecycle but no evidence of superiority and no implemented catalog/session/booking feature. Its remaining implementation stays in the full-scope register.

Verification: 513/513 source tests passed, including two new Friend placement/payload checks; production build passed and focused lint passed. The previous 41-scenario isolated browser result remains applicable to its named money/Pro/price checks, not the newly moved Friend interface. Hosted visual/two-device Friend checks remain open. No remote migration or production deployment was made in this pass.

### 19 October: Hotel and shared report-flow implementation

The active public Hotel page now has Report this hotel. It requires authentication, uses the existing property-report form, and calls a dedicated report_hotel RPC. The server resolves the Hotel owner and location, rejects own/inactive Hotel reports, and records the report in the existing content_reports queue. The same reporter/reason on an open Hotel concern returns its existing reference instead of creating another open queue row. No competing Hotel-report table was created.

Migration 20261019171328_hotel_listing_reports was applied to Test. The new SQL contract verified receipt creation/replay, private reporter status, wrong-state/branch denial, owner-home-location independence, local Admin review, Creator resolution and anonymous/direct-table denial. The existing shared-content-report contract also passed after the helper change. Both fixture sets rolled back; no hr- test profiles remain. Test now records 744 migrations; Production remains unchanged.

The operator queue now displays Hotel and report references, accepts a review note, distinguishes failed/malformed reads from empty queues, and resets failed actions. Its text clarifies that marking a report does not itself remove a listing or restrict an account. Reporter history displays the complete reference and status. Urgent Hotel safety opens contextual Support; the browser check establishes the correct context, not an actual emergency response or completed support case.

The generic chat/profile report form previously discarded the returned receipt and could strand busy state on a thrown request. It now requires a reference before success, catches thrown errors, resets busy state and uses shared dialog isolation/focus with theme tokens. A report already being sent is not cancelled by closing the form; report history is the recovery path.

Verification: 515/515 source tests; 50/50 isolated browser scenarios, including Hotel-to-operator-to-reporter status, authentication, missing receipts, submission failures, queue-read recovery, urgent support context and generic form recovery. Focused lint passed; final full build/lint results are recorded in the release register when complete. These are Test SQL contracts plus isolated browser checks, not an authenticated deployed end-to-end role pass.

Security advisor review still reports 52 RLS-enabled/no-policy notices, 17 anonymous-executable SECURITY DEFINER warnings and now 557 authenticated-executable warnings. The new authenticated Hotel RPC is intentional; its actor checks and grants are covered by the contract, and the private scope helper remains closed to clients. Existing notices remain part of the broader security review, not 626 confirmed vulnerabilities. [Function permission advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

### 19 October: Property facts and NIN preparation

Test migration `20261019202244_property_submission_fact_validation.sql` rejects incomplete/invalid apartment counts and Hotel capacity/inventory; its rolled-back SQL contract passed. Studio bedrooms remain zero. Partner submission uses the same numeric rules. The separate internal listing form now rejects invalid apartment counts and preserves zero instead of defaulting to one; focused lint passed. Its generic Hotel creation path still needs reconciliation with dedicated Hotel inventory. Test has 745 migration records; Production was not changed.

The owner confirmed no NIN provider account. `supabase/functions/_shared/nigerianIdentity.ts` prepares a server-only integration boundary: approved purpose policy, live active account, consent, provider result binding, mismatch review and protected replay. Receipt data excludes raw NIN. No provider-specific adapter, actual receipt store, endpoint or UI is connected. Signup does not require NIN, and this module does not change face review, ownership or licensing claims.

Verification checkpoint: 520/520 source tests and production build passed before the final internal-form correction. The property/NIN focused suite passed 5/5 again after that correction; internal-form lint passed. Full lint from the reporting checkpoint also completed successfully. Deno checks and focused lint for the new NIN module passed. Hosted role verification, evidence-policy enforcement, migration replay and real provider/payment recovery remain in the existing release register.

### 19 October: Retired direct creation and defined provider-evidence contract

Removed the unused internal CreateListing page, new_listing route/type/restoration entry, client writer/export, unused permission helper and isolated-fixture export. Removed the unreferenced HotelDetailCore implementation; active Hotel detail remains the existing canonical page. Updated mixed-journey workflow paths and SECURITY documentation. Source inventory found no remaining active direct-writer/route consumers. Historical applied migration definitions remain as history.

Test migration `20261019204555_retire_internal_listing_bypass.sql` removes both direct-publication RPCs with dependency-restricting DROP FUNCTION, without deleting marketplace or financial records. Apply returned success; the rolled-back retirement SQL contract passed, confirming both functions absent and canonical property submission plus listing/Hotel/room tables present. Security advisors were retrieved after apply; broad existing advisor categories remain. A later migration-count read failed with an MCP transport error, so no new count is asserted. Production was not changed.

Product Rules now contains a researched Short Let/Hotel evidence matrix, separating identity, asset authority, entity/operator, applicable permits, listing facts, guest terms and payout eligibility. Private document collection/review/correction, expiry/recheck, appeal and publication/payout enforcement remain internal engineering work. Legal evidence/retention approval and provider/processor agreements are separate external requirements. The NIN module now accepts only Property Partner and Service Worker purposes, excluding ordinary booking; NIN remains one proposed Nigerian ID method, not mandatory customer signup or payment data.

Verification: full source suite 520/520, TypeScript/Vite build and full ESLint passed after source retirement. A subsequently added route-retirement regression initially lacked URLSearchParams in its isolated VM harness; the harness was corrected and all six focused property/NIN/retirement tests passed. Deno module check and git diff --check passed. CI includes the SQL retirement contract; exact-SHA CI and hosted role checks remain open.
Final full-suite rerun after adding the route-retirement regression: 521/521 passed; diff whitespace check passed.

### 19 October: Full completion boundary and document requirements clarified

Corrected the Paystack capability distinction: merchant onboarding and account-name resolution do not establish NIN verification for WeHouse recipients. Product Rules now spells out shared evidence plus separate Short Let, Long Let and Hotel intake/terms. The legal register records document forms and local permits as jurisdiction-specific approval work; collection/review/publication enforcement is still internal engineering work.

Reconciled the existing release register: removed the duplicate generic Paystack test row in favor of the complete money/reconciliation row; replaced bare Codex placeholders with acceptance work; corrected the stale 200-RPS-failed entry to the later recorded passing evidence; withdrew retired internal-form discount evidence; updated source counts to 36 navigation keys, 47 pages, 222 components, 767 migrations and 77 SQL contracts. No readiness claim is derived from these counts.

The register now defines engineering complete pending external activation. Missing implementations, provider adapters, hosted verification, migration replay/disposition, security fixes and recovery exercises remain internal work even when a provider account or approval is also needed. No new competing roadmap was created. This checkpoint changes documentation only; diff whitespace check passed. The previous 521-test/build/lint results remain historical implementation evidence, not a new execution or a whole-product readiness pass.

### 19 October: Accepted provider requirements implemented through review and publication

The owner accepted the property/Hotel/Long Let/Short Let requirements and NIN direction (C-063). Partner responsibilities mean accurate facts, authority, disclosed terms and fulfillment; WeHouse retains scoped review, enforcement, moderation and support duties. Operating sign-off means the launch owner can actually run the queues, incidents, refunds and recovery obligations. It does not require hiring staff; self-review restrictions still apply to an owner's own supplier assets.

Implemented one private request-linked document workflow in the existing Partner submission and Property Operations record. Reviewers confirm accepted evidence instructions and expiry rules before collection. The Partner can upload supported files, recover an unfinished upload, receive a persistent correction reason and submit an immutable replacement. Independent current-session reviewers decide with a reason; another person's or out-of-scope records are denied. Material changes invalidate the requirements snapshot. Canonical Inbox/operations records carry review, correction and outcome work; resolved/superseded tasks do not remain actionable. No NIN, passport or bank document is collected by this property-evidence flow.

Actual apartment and Hotel publication commands now use additive workspace authority, deny own-property approval, check current documents and retain one approval event on replay. The contract proved successful publication with base profile role user plus an Admin/Creator grant, preserved a zero-bedroom studio, and blocked missing/expired/changed evidence. Collection, access/inspection evidence, current documents, media review and final publication remain distinct checks. Already-live recertification, expiry outreach, acceptance/booking rechecks, structured guest/tenancy terms, appeals and legal retention/deletion remain open. Live person KYC and the actual identity-provider adapter remain unimplemented.

The stronger contract exposed two further Test parity gaps: the requested management-choice column/commands were absent, and media buckets allowed 50�100 MiB despite the current 13 MB compressed-video contract. Forward migrations restored the choice/owner-only handoff controls and bounded the six existing media buckets without changing visibility or deleting objects. The current v4 submission body retains identity, authority, numeric and batch validation and now persists the Partner choice; its obsolete private historical base wrapper was retired. The management-publication/media contract then passed. All synthetic document/cost contract profiles and document rows were confirmed absent after rollback.

### 19 October: Pro business value and cost records

Research checked the primary Jobber features page (https://www.getjobber.com/features/) and Guesty features page (https://www.guesty.com/features/). These support the practical scheduling/customer/quote/invoice/cost and portfolio/operations/reporting directions, not an assertion of competitive superiority or willingness to pay. Worker retains twelve described workflows; Partner now has fifteen with property operating costs, recorded margin and cost correction/export.

Added owner-scoped, entitlement-checked, idempotent operating-cost commands and a bounded monthly report. It joins the canonical released-earnings/payment authorities, attributes Hotel and home income through their existing payment links, records costs by owned property, supports 50-row keyset pagination, CSV for the shown rows, and retains voided records/reasons. It never writes a wallet movement. Mixed/unknown income currency suppresses income/margin instead of converting or adding currencies. NGN and UTC reporting are explicit. Owner RLS read access to their own records remains after paid access expires. Worker reminders still run only while its business-tools screen is open; durable delivery remains a Pro gap.

Verification: full source suite 530/530, full ESLint and production build passed; 61 isolated browser scenarios passed, including document upload/private download/correction/approval and cost recording/CSV/void/recovery at 320px in actual light and dark palettes. Visual inspection caught that the first new light fixtures toggled only the dark class; the fixtures now set both data-wh-theme and class, matching applyAppearance, and the full browser run passed again. Initial native-select label and stale twelve-tool offer assertions were corrected; the new fifteen-tool offer is checked. SQL document/publication, cost/entitlement/ownership and management/media contracts passed on Test with fixture rollback. These are not authenticated hosted/two-device or full-app journey passes.

Seven forward migrations in this checkpoint are recorded on Test: 20261019212345, 20261019212920, 20261019213241, 20261019214237, 20261019215454, 20261019215745 and 20261019220022. Test has 753 migration records; repository has 774 active migration files, 79 SQL contracts, 36 navigation keys, 47 page modules and 224 component modules. Production was not changed. Advisor results remain 52 RLS-no-policy notices, 17 anonymous-executable and 566 authenticated-executable SECURITY DEFINER warnings; these are review categories, not a count of confirmed vulnerabilities. Full history disposition, fresh/upgrade replay and exact-SHA CI remain open. Docker CLI is unavailable locally; connected Test migrations and contracts did not require Docker.

### 19 October: confirmed core-feature and media corrections

Found a real core/free-boundary defect: essential guest arrival instructions were sold as Partner Pro. Moved the editor into normal home and Hotel owner operations, removed its paid catalog entry, renamed the canonical private table/owner commands, and retired the old writer and mixed arrival/occupancy RPC through Test migration 20261019221843. Existing data stays in the renamed table. Paid portfolio occupancy stays separate. Updated Test SQL contract passes without a Pro entitlement and denies cross-owner access; eligible paid guest access still passes.

Corrected studio presentation across public cards/detail and Partner records; zero means no separate bedrooms. Added video metadata/duration checks for small files and a 10-second metadata timeout; removed the small-file/unreadable fallback bypass. Worker evidence input screens now share the 100 MB source cap; public/chat preparation and evidence retain their separate duration/output budgets. Chat source size and video preparation both accept 25 MiB, and attachment messages use the same unit. Media viewer supports retry without closing. Hosting selected/text colours were corrected for the light palette. No 3D renderer is present; 3D is optional, not evidence of premium usability.

The isolated browser runner passed 65 scenarios, including both themes at 320px for free arrival editing, saved-state reload and failure reconciliation. Viewed both screenshots. Updated media tests cover small over-duration/unreadable/stalled/empty videos and private evidence duration. Full source suite passed 533/533 after running outside the sandbox with access to the installed Python runtime. The full-product route/design/security/payment coverage remains open; current evidence must not be described as complete production readiness. See the existing release register for competitor sources, exact media budgets and next gates.

### 19 October: property grouping and measured-capacity continuation

Kept the existing Apartment (Short Let/Long Let) and Hotel/room-type structure; did not introduce a studio category or 3D work. Added plain-language studio help with an accessible description to submission, corrected raw property/subtype labels in Partner details through the existing canonical label maps, removed irrelevant apartment fields from Hotel submissions and made Hotel room-type inventory wording explicit. Missing guest capacity no longer appears as an invented one-guest limit. Submission fields now use the shared border token and visible keyboard focus.

The existing hosted Test catalog runner recorded latency but did not gate it; this could pass slow responses. It also allowed an unvalidated route when warm-up expired before that route started, and its warm-up failure file had a literal escape after JSON. Repaired these defects, added overall/per-route latency and dispatch/sample-accounting gates, stop-on-failure, metadata and partial report persistence. Four gate unit tests and the full source suite (537/537) pass; production build and focused lint pass. Read-only Test counts confirmed 1,000 synthetic homes, 1,000 synthetic Hotels and zero Auth users. No new hosted load test was run. Historical read-only catalog results remain narrower than signed-in/money/message/media/soak capacity. Current details and competitor sources are in the existing release register and capacity-validation document.

### 20 October: building/space scope and next money repair

Owner clarified both self-contained apartments and separately let private bedrooms in one building, across Short Let and Long Let. C-064 is accepted and the canonical supply row/rules/data-model direction now cover both terms. Current apartment schema lacks building/parent-space identity; no new inventory system was claimed or activated. Replaced the obsolete whole-home-only recommendation and corrected duplicate C-060 decision numbering (identity is now C-063; announcements retain C-060). A decision uniqueness/placement regression check passes.

Payout-account now applies a 12-second provider deadline and shares the same budget across reconciliation pages. Added mutation-timeout/no-POST-retry, shared-deadline and pending-without-bank-write tests. Existing recipient reuse still passes. Full source suite 541/541 and Deno type-check pass. Test deployment version 5 is ACTIVE with JWT verification true; retrieved source and shared-helper parity were checked. No real transfer, bank-save or Production change was made. Secure replacement step-up and broader financial recovery remain unfinished.

### 20 October: management failure recovery and preserved co-host authority

Repaired missing/failed management and sent-invitation reads, malformed property/assignment handling, rejected-command action locks, absent invitation receipts, withdrawal error recovery and Short Let arrival/Long Let handover rejection recovery. Removed the unused legacy PropertyHostInvitations component. Visible refresh/support controls accompany recovery instructions. Reviewed React hooks, stable account/property keys, stale-result guards, labels, bounded reads and theme surfaces. Browser suite 79/79 and source suite 545/545 pass; production build and focused lint pass. Both 320px management themes were visually inspected after transitions settled.

Test migration 20261020062733 prevents re-inviting active co-hosts from resetting access, reuses matching live pending direct invitations, and preserves deliberate pending-permission changes. SQL rollback contract passes for active access, receipt/notification uniqueness, replacement and outsider denial; fixture cleanup confirmed. Test755/repository776 active migrations, 80 SQL contracts. No Production change.

The full property-space hierarchy/customer operator projection is still open, and Experiences is not implemented. Existing rules/proposal now explicitly cover customer matching for pure/mixed let buildings, independent operating responsibility and category-as-data over the activity/session booking lifecycle. Deployed multi-account/provider-sandbox evidence remains separate from these isolated/SQL checks.

Final management follow-through: the complete isolated browser run passed 79 scenarios; after the final refresh-control changes, a focused 14-scenario management/arrival replay passed and both 320px theme artifacts were regenerated. Source tests remain 545/545, with production build, focused lint and Test SQL contract passes. The focused runner writes results-management.json so it cannot overwrite the full results.json evidence. Security advisors still require the established role/body review; aggregate executable-function warnings are not counts of proven vulnerabilities.
