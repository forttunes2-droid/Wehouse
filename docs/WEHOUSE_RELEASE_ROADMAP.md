# WeHouse release roadmap

**Status date:** 26 October 2026

## Current engineering checkpoints

### Owner corrections: guest gates, original brand and Home catalogue — 26 October

The separate signed-out Roommates/Services marketing pages are removed. All four
signed-out sections use the same GuestAccess renderer as Inbox and Bookings:
one heading, one sentence and one sign-in action. The selected Roommates or
Services destination is retained through authentication. No workflow steps or
temporary payment-paused copy remains in those screens.

Imported the owner's original `wehouse-brand-v4-complete.zip` from Downloads;
all 23 duplicate downloads had the same hash. `public/brand/v4/source.json`
records the archive and original-file hashes. Original vectors now supply the
theme-aware brand in sign-in/discovery/guest/payment screens and web install
icons. The maskable asset only insets the supplied artwork into a safe area.
No raster tracing or invented replacement logo was used.

Home cards no longer switch to a separate compact layout when the result count
reaches three. They use the same photo card, exact recorded-currency price,
readable specifications, keyboard action and missing-photo state at every
count. Save remains a separate action. A private room is not labelled a Studio
merely because its record has zero separate bedrooms.

The owner explicitly rejected the added Apartment/flat, Bungalow, House and
Other-home catalogue. It is removed from submission and discovery controls;
Short Let/Long Let, actual unit/privacy scope and bedroom layout remain the
organization. Penthouse is the previously agreed optional feature, independent
of bedroom count. Test migration `20261026170318` rejects unsupported new
features and retired feature-filter API values, preserving existing records.
The full physical-space SQL contract passes, including ordinary units without
an invented classification, Penthouse, Studio, mixed terms, private rooms,
customer booking conflicts, protected arrival and authority isolation. All 13
compound/unit browser journeys pass. No inventory-facet API was added: the
owner's correction was to the catalogue itself, not a missing result counter.

Service category filtering now uses the configured category's actual child
services and published offered services, rather than guessing from the parent
category name. Both-theme search, coverage, reset and read-recovery browser
journeys pass. The latest source suite passes 788 tests; build and focused lint
pass. Responsive brand/guest/card checks pass in all eight size/theme combinations,
including loaded photographs, the removed catalogue, shared guest gates and
sign-in return intent. Exact new-head CI remains pending.

The preceding hosted `4e8a75dd` repair served the actual Test Home feed with HTTP
200 after fixing Node ESM imports. A later fresh hosted request returned HTTP
402 `DEPLOYMENT_DISABLED`. This is current external deployment evidence; no
successful CDN cache-hit or new hosted account journey is claimed. A local
Test-only build is served on `http://127.0.0.1:4174/` while hosted access is
restricted. Production code, database and financial transactions are unchanged.
Vercel Hobby is restricted to non-commercial personal use; commercial use needs
Pro or Enterprise ([commercial-use rules](https://vercel.com/docs/limits/fair-use-guidelines)).
The connected team read does not expose the current billing
plan, so the exact account restriction must be checked in Billing.

The location audit confirms another internal gap: listing, Hotel, submission and
workspace coverage still rely on State/City text without a complete shared
country/region/local-area identifier model. The Nigerian dataset and generic
free-text fallback do not close global rollout. Do not activate another market
without its location, scoped permissions, currency/payment and document paths.

### Connected discovery, shared links and gallery position — 26 October

The latest follow-through makes Friend chat navigation required, passes it
from the older Activity renderer and closes the conversation overlay before
opening a shared Home, Hotel or Service Provider. Home card previews now accept
the public listing reference as well as the internal identifier, matching the
detail API. Sender/receiver touch checks cover both forms. The active Inbox already
passed navigation; this is not a claim that the legacy callback explains every
reported live failure. Synthetic sent/received Home and Hotel touch journeys
resolve their typed destinations. Hosted two-device delivery remains unverified.

The gallery now opens the selected image, preserves fullscreen position when
closing or using Back, aligns on resize and resets for a different property.
Both-theme browser checks cover those transitions and sent/received shared cards.

Test migration `20261026144839` matches literal query words across public Home
title/location/layout/rental labels and Hotel name/city/region, in any order.
Client and server predicates agree; budgets, bedrooms, publication, availability
and cursor limits remain separate authoritative filters. SQL checks cover a
mixed-field query with price bounds, Studio/0-bedroom matching, unpublished
isolation and literal wildcard characters. This is bounded word matching, not
natural-language interpretation or typo correction.

Service search matches words across name/skills/base/declared coverage. Reset
and Clear no longer silently reapply the saved area. Failed discovery now has
an explicit retry state and does not consume a shared profile intent as though
the provider were unavailable. Both-theme browser checks cover coverage versus
base, word matching, reset/clear and a failed read followed by recovery.

Clearing a location invalidates pending GPS and reverse-geocode replies; browser
checks verify it stays cleared in memory and session storage. A successful
address lookup and denied device permission are also checked. This does not add
precise GPS-distance filtering for Services or global location identifiers.

Verification: 787 source tests pass; responsive Home/Hotel discovery passes at
320/390/768/1440 in both themes, including the mixed Hotel name/location query.
Friend history, gallery/sharing and location-race browser checks pass. The
earlier `8e3bdc28` replay progressed through Service booking and policy checks,
then exposed a team fixture assuming the old default-closed marketplace. That
fixture now explicitly pauses discovery before testing pause permissions; it
passes on Test without restoring a normal Creator opening requirement. All seven
workflows now pass on published commit `708c0f7e`, including fresh migration replay,
existing-account upgrade, browser journeys and isolated mixed/medium checks.

Further Home/Hotel sharing and saved Hotel search checks cover a second defect:
the public Home reference was rejected by the preview despite being accepted by
the detail RPC. Hotel filters now retain a followed-search origin together with
its radius, sort loaded results using that origin and expose the corresponding
distance control. A radius without a location does not become an empty-search
constraint. Account-specific filter state prevents another account inheriting
the previous query or saved-search origin. Eight responsive/theme journeys and
both touch-sharing journeys pass; 787 regression tests pass.

The actual `708c0f7e` deployed browser exposed a missing preview backend, despite
its successful HTML/build check. Added branch-specific Preview-only Test URL and
publishable-key configuration in Vercel; Production settings are unchanged. A
new build must visibly open the app before the preview is usable for account
testing. This checkpoint supersedes any inference that HTTP 200 alone proves a
connected preview. The next exact commit must pass CI again.

The next `05a03aae` preview opens the real Test app, but its public catalog
function returned HTTP 500. Runtime logs identify Node ESM extensionless imports
(`ERR_MODULE_NOT_FOUND`), which bundled unit checks had hidden. The function now
imports emitted `.js` module paths. A new regression compiles without bundling,
loads the emitted entry in native Node and executes its fetch contract. That
check and the existing gateway suite pass. Hosted feed success/cache evidence
must be recorded after deploying this repair; do not bypass the gateway to hide
a server failure or reconnect the preview to Production.

### Pushed verification and replay repair — 26 October

Commit `7692b787` is pushed to PR #118. Its exact preview deployment
`dpl_Ejb7jsEMXZaRMEfET3v5VfQpTZMt` is READY and returns the application HTML
with HTTP 200 through protected deployment access. Six of seven workflows pass:
build, structural checks, browser checks, both disposable capacity workflows and
isolated mixed journeys. The existing-account upgrade job also passes record
preservation, rollback, committed upgrade and repeat-release checks.

The remaining consolidation failure occurred in a rollback Hotel fixture that
inserted document metadata as an authenticated user without the new reservation.
Corrected those Hotel/property/credential/Experience/inspection/chat fixtures to
reserve first and supply a Storage version, preserving all RLS and publication
checks. All six affected contracts now pass on Test. Missing tickets now return
false from the restrictive Storage policy, producing the standard policy denial;
they do not become upload permission. The real disposable mixed-journey job
passes its actual Storage upload and reservation-race probe. Public Production
and its records remain unchanged. Full replay must pass on the repaired head.

### Service agreement and checkout follow-through — 26 October

The owner has now explicitly reauthorised the interrupted Test check and
commit/push to PR #118. The final expanded media admission/gallery contract
passes on Test, including destination ownership before reservation, retained
legacy galleries and gallery limits on Homes/Hotels/room types. The separate
real Storage API/concurrency probe still requires disposable CI.

Test migrations `20261026125152`, `20261026130437`, `20261026131457` and
`20261026132650` connect the Service quote, customer acceptance and checkout.
The existing worker_bookings record now stores a versioned work/schedule/price
contract, exact start instant, IANA timezone and saved 24-hour cancellation
deadline. Acceptance is a separate customer-authorized receipt, not user_approved
(which remains the completion signal). Repeating the same quote/acceptance is
idempotent. Changes invalidate acceptance; an active checkout prevents changing
the contract. The payment record copies the accepted contract and protects it
against rewriting. Provider/private-reference/account data stay participant-only.

The shared payment validator binds booking/customer/provider/version/price/start/
timezone/cancellation and acceptance timestamp to the frozen payment contract.
Test payment-init v7 replaces the blanket Service pause **only for valid accepted
contracts**. Legacy date/price-only unpaid bookings still need a complete quote;
previously paid history, verification, release and refund paths are retained.
The six retrieved deployed files match the reviewed source; JWT verification
remains enabled. No external charge was initiated.

The existing Creator commission policy is snapshotted through the existing
commission/protection/ledger path. No percentage was invented or activated. The
new quote has no additional customer service charge (zero is explicitly saved
and displayed). A configurable optional customer-charge formula remains separate
engineering work under C-040; it must not silently change accepted quotes.

Provider cancellation before completion queues a full refund of protected money
once. If money has already been released/refunded or is under review, Finance
must resolve the full refund rather than inventing available funds. Customer
cancellation by the saved 24-hour deadline queues a full refund. Late customer
cancellation has an explicit protected review kind; no late deduction was
invented. Legacy paid bookings keep their existing rule. Starting new quoted
work before its accepted start time is blocked so a provider cannot defeat the
customer's cancellation window by prematurely starting the job.

The complete rollback SQL contract passes on Test: participant/outsider authority,
stale acceptance, idempotent quote/checkout, frozen terms, canonical verified
receipt to Payment Protection, provider cancellation, early-customer refund and
late review. The separate commission policy-change/retry contract passes. The
private-change contract passes price, work-only and acceptance invalidation for
both participants, recipient RLS and identifiers-only payloads (Realtime adds a
delivery ID). The source suite passes 785/785 tests, focused lint and the build
pass; Deno checks pass with frozen dependencies. The actual chat review passes
light/390px and dark/1280px browser checks for required consent, acceptance before
checkout, failed-checkout persistent feedback/retained agreement, live quote
changes, stale response protection and account switching. Both screenshots were
visually inspected. These are synthetic browser/Test SQL proofs, not a hosted
two-device or real PSP sandbox charge/refund proof. Both SQL contracts and the
discovery browser check are included in CI for the version being pushed.

This closes the missing exact-schedule/accepted-contract implementation identified
in sequence 1; it does not close all Money/Pro/provider recovery, Experiences,
property inventory/tenancy/shared Hotel costs, privacy or release evidence. Those
rows remain open and cannot be described as external-only dependencies.

### Current publication and release facts — 26 October follow-through

PR #118 is open and technically mergeable at `03219c51`; it does not yet contain
the local changes below. Vercel's PR-branch preview for that commit is READY
(`dpl_F3c38HsjrfSSYRd8UGG2n3bQikyg`), so the historical HTTP 402 is not a
current blanket preview blocker. The public domain resolves to a production
deployment from `main` at `f990fc4a`, not that preview. Do not call a main merge
a Test-only update or assume it cannot affect the public app. No promotion,
Production migration or merge was performed.

The owner challenged the unnecessary separate service-discovery opening step.
Test's false setting was an untouched legacy seed (created_at=updated_at), with
an obsolete labour/recruiter approval description and no recorded Creator
publication action. Migration `20261026123401` corrects that untouched default
to open and renames it Service discovery availability. Fresh projects also seed
open. A changed setting or audited deliberate pause is preserved. Individual
professional review, active workspace, credential/coverage context, availability,
required identity, account restrictions, blocks and provider-specific moderation
remain authoritative. This does not activate Pro sales or new payment paths.
The existing Creator workspace retains an optional incident pause; no new
dashboard or routine opening task is required. The rollback SQL contract passes
automatic eligible-provider visibility and explicit-pause/outsider/revocation
checks. Light/390px and dark/1280px service-discovery rendering passes.

The Service review UI paused payment, but payment-init could still initialize
an unpaid Service charge without the missing exact-start/accepted cancellation
contract. Test payment-init v6 now rejects that path before cached provider URLs
or provider initialization. Existing paid receipts and verification/refund/release
handlers are preserved. Twenty-eight focused payment/environment/gate checks
pass, including direct-call and cached-URL bypass refusal and readable paid
receipts. The generic success, persistence and provider-reference checks now use
an enabled Hotel fixture, so they still exercise provider initialization instead
of accidentally passing at the new Service boundary. Deno type-check passes.
No charge was initiated. Completing the accepted Service contract/checkout
remains engineering work, rather than relabelling the paused flow as complete.
The combined source suite passes 781/781 tests; final build evidence is tracked
in `test-results/service-discovery-final-build.log`.

This table is the current execution view. The open register remains the detailed
inventory; dated entries below are evidence/history, not a declaration that the
whole feature or product is complete. Do not reopen settled owner policies.

| Sequence | Current work | Required result before closure |
|---|---|---|
| 1 | Money and accepted agreements: mandatory Payment Protection for every collected rent payment; Service proposal/review/payment; refunds, payout recovery and Pro billing | The exact accepted amount/currency/policy survives charge, protection, authorized release/refund, wallet credit and provider reconciliation; no double credit or silent success |
| 2 | Finish Experiences in the existing provider workspace | Approved public activity/session, capacity, customer booking/payment, cancellation/refund, attendance, review, sharing and optional promotion/discount journeys |
| 3 | Complete connected accommodation operations | Grouped unit availability/calendars, protected later-year rent collection and Hotel shared costs; actual customer and Partner fulfillment/recovery |
| 4 | Close account, privacy and operator journeys | Recovery/email/device proof, real access/export/deletion processing, scoped Team/Admin/Creator authority, support/report resolution and retention |
| 5 | Verify complete product behavior and appropriate scale | Route/role/device/light-dark checks, search/maps/location, chat delivery, native/Pro lifecycle, bounded jobs/cache and realistic isolated workload/recovery evidence |
| 6 | Verify the version proposed for merge | Exact-SHA CI and preview, fresh/upgrade replay, hosted-role smoke checks, feature boundaries and rollback; separate Test merge from public launch/Production promotion |

Current evidence: `03219c51` passed build, structural, consolidation/replay,
isolated mixed preflight and disposable capacity workflows. Its main browser
and Wallet/Pro jobs passed; the cancelled media job was requested for rerun.
The media rerun then passed, so all seven workflows completed successfully on
`03219c51`. The new 26 October changes below still require their own exact-SHA CI.

### 26 October: realistic launch resource boundaries

The owner confirmed a Free-plan launch. The current acceptance target is bounded
resource use and complete enabled journeys, not 100k concurrent users or a
500-RPS hosted ramp. See `capacity-validation.md` for verified plan limits and
the measured Production/Test data-size baselines. Historical failed checks stay
recorded, without treating their offered rate as a database hard limit.

Roommate results already use 24-row client pages (maximum 48) and score the
hard-compatible candidate pool before retaining the top 120. Requirements include
location, annual-budget overlap, mutual gender preferences, room arrangement,
move-in overlap, smoking boundaries, optional school matching, blocks and search
visibility. The optional lifestyle score compares answered preferences; it is
not a success probability. Current matching still uses Nigeria-specific location
fields/timezone; global location identity remains separate implementation work.

Work-sample posts use 24-row pages plus one lookahead. Video thumbnails previously
fetched and sought actual video media while scrolling. The local repair uses an
explicit Open video tile; playback remains in the post viewer. Chat encrypted
attachments have a local encrypted cache, but several full-thread reads and
aggregate upload/retention budgets still need implementation and verification.
No new hosted load was initiated, no plan purchased, and Production was only
queried for aggregate resource sizes.

Follow-through: migration `20261026081344` is applied to Test. Friend history
now reads at most 51 encrypted records (50 displayed plus one lookahead), uses a
stable `(created_at,id)` cursor and keeps earlier/newer navigation. The old RPC
is bounded too. Pinned messages outside the current page have an authorized
cursor lookup. Test's rollback contract reaches 122 visible records exactly
once, including tied timestamps; rejects oversized/partial cursors and outsider
reads/lookups; and preserves blocked/cancelled-chat authority. Browser checks
pass in light/390px and dark/1280px for earlier/newer history, older pins,
read failure/retry and no attachment download merely from reading messages.

Friend attachments load explicitly rather than decrypting/downloading an entire
page's media. Object URLs from departed pages are released. The shared encrypted
media cache now has a 32 MiB memory budget and a 64 MiB persistent budget with
seven-day expiry. Cross-tab Web Locks serialize persistent writes; browsers
without those locks skip persistent writes. Four cache tests pass, including
byte-based eviction, expired/legacy entries and unsupported-browser fallback.
This cache is encrypted local media, not additional Supabase storage capacity.

The eight-width/theme shared-discovery checks pass without fetching videos for
thumbnails. Video paths are signed when a post opens; only photos are batch
signed for grid previews. Practical Roommate SQL contracts also pass on Test.
The final local suite passes all 762 tests, including page receipts, cache
budgets and the hosted Free-load guard. The production build and focused lint
pass; changed workflow YAML parses successfully. Exact-SHA CI and
fresh/upgrade replay for these local changes remain pending push permission.

### Traced customer/provider paths and remaining resource work

| Journey | Connected implementation inspected | Current boundary |
|---|---|---|
| Work sample publication | Verified provider and current identity; choose/preview photo or video; bounded preparation; private Storage upload; server checks owned path and completed-job ownership; optional customer job confirmation; paged public/owner grid; authorized selected-post viewer | Aggregate upload reservations, per-account allocation, orphan recovery and actual egress monitoring still need completion. A 13 MB file limit cannot protect a 1 GB project by itself |
| Friend conversation | Accepted relationship and encrypted identity; server-authorized 50-message pages; explicit older history; pin lookup; private live hints; visible recovery; explicit cached media opening | Other chat surfaces still need equivalent bounded-history and on-demand-media verification. This is not whole-app two-device proof |
| Roommate discovery | Practical hard requirements before lifestyle ranking; blocked/paused visibility; candidate ranking before top-120 retention; 24-row results; review profile then explicit request/acceptance | Similarity is not a prediction or guaranteed household fit. Global country-qualified location/currency identifiers remain open |
| Booking and money | Existing accepted quote, payment reference, protection, authorized release/refund and recovery authorities remain the required path | Experiences checkout, later-year protected rent collection and Hotel shared costs remain implementation work. Existing locks/tests do not establish every booking flow complete |

The manual hosted workflow now defaults to 1 RPS, offers only 1/5/10 RPS,
and has no distributed job. Its script rejects larger ceilings and shards even
when called directly, caps transport/in-flight work at 32, and retains the
existing latency/error/integrity checks. The guard tests pass. No hosted check
was run. Disposable CI migration/booking checks remain separate from hosted
Free usage; their synthetic data does not occupy the hosted database.

Migration `20261026083524` adds a 30-second reuse window to unchanged Roommate
rankings, under the existing preference-row lock. Preference changes invalidate
reuse. The practical-match contract confirms unchanged refreshes keep their
prior ranking timestamp, changes invalidate it, and required matching/privacy
rules still pass. This reduces repeated computation; it is not a complete abuse
rate limiter or proof of 100k concurrent-user capacity.

Creator Home/Hotel funded offers now carry the optional end date through their
existing RPCs and confirm the saved receipt before reporting success. Test's
rollback discount contract passes finite/future date validation, retry receipt
reuse, saved duration and unchanged commission/Partner-net rules. Experiences
funded discounts and a consistent booking-date/arrival-date definition still
need completion; the existing resolvers use arrival dates for stay offers and
current-date Year 1 quoting for Long Let. Do not silently present these as one
universal campaign-expiry rule.

The launch resource gate therefore remains open for real Storage API admission
proof/recovery, other chat pagination, measured egress/socket monitoring and enabled-flow
verification. It does not require another oversized hosted Free-plan ramp.

### 26 October: bounded media, service areas and identity receipt recovery

Test migrations `20261026092158`, `20261026100543`, `20261026102713`
and `20261026115828` add bounded publication and durable upload admission.
Provider showcases allow 12 work samples, including at most 3 videos; stored
photos must be at most 2,000,000 bytes and videos at most 13,000,000 bytes.
The visible allowance is read from the server. Repeating the same publication
returns its existing receipt rather than consuming a second slot.
Property/Hotel/room galleries accept up to 12 photos. Existing unchanged
galleries are retained. New photo sources are capped at 12,000,000 bytes before
compression; the final shared photo limit is 2,000,000 bytes. Browser proof
compressed an actual generated 11,678,045-byte JPEG to 1,838,094 bytes and
decoded it successfully. Selected preparation and transfers share two slots.

The initial RLS lock-and-sum design was insufficient: Storage permission probes
can roll back their savepoint, releasing a transaction lock. The forward
correction reserves capacity in a committed RPC before transferring bytes.
Private configurable defaults reserve headroom at 800,000,000 project bytes
and 80,000,000 showcase bytes per provider. Pending allocations count even
after expiry until completion is verified or an operator safely recovers them.
Clients cannot enlarge or release allocations. Reservations now reuse actual
authenticated INSERT authorities before holding capacity; permission changes
fail closed until the migration refreshes that authority projection. The Hotel
media policy also now correlates the Storage object path rather than Hotel name.

The earlier Test rollback contract passed sample/video limits, idempotent
publication, photo metadata admission, quota boundaries and rollback-safe
reservations. The expanded final contract adds destination authority and all
three gallery triggers, but its execution was cancelled: **that final contract
has not passed**. A real Storage API/concurrent-allocation probe is added to
disposable mixed preflight; Docker is unavailable locally, so this probe still
needs exact-SHA CI. Storage metadata fixtures are not real upload proof.
Expired failed-upload recovery, per-bucket retention, usage warnings and billed
Storage/egress evidence remain internal work. No actual assets were deleted to
recover quota. The source suite passed 777 tests before the identity receipt
follow-through below; the media build and focused lint passed.

Migration `20261026111609` makes public service filtering use declared approved
coverage, keeping credential-context review and existing publication authority.
A provider based in Lafia but approved for Keffi appears for Keffi; an undeclared
area does not match. The Test publication contract and light/390px, dark/1280px
browser checks passed. Public cards distinguish Base from Serves. The obsolete
24-hour story reader, signing loop and viewer were removed from discovery;
existing portfolio samples remain. Service discovery still needs bounded server
paging and true consented distance/radius search. This is not GPS-nearest ranking
or a personal browsing-history recommendation system. The new browser runner
is local; adding it to the CI loop was rejected and remains pending permission.

Service cancellation/refund-review adapters now reject malformed receipts instead
of reporting success. New Service checkout still lacks accepted exact start and
versioned cancellation terms; existing paid-booking terms are not rewritten.
Identity capture likewise now validates a pending independent-review receipt and
retains its private uploaded reference after uncertain submission responses. It
does not delete a potentially committed review's reference on response loss.
Eight focused upload/identity receipt tests and the final combined source suite
(779/779) pass; focused lint and the identity/media production build pass.
These do not replace the cancelled final SQL check or pending real Storage API
probe. The retired external-identity endpoint's message now states that it
cannot verify identity; no provider adapter or verification was invented.

NIN is not a signup requirement and no NIN entry screen, live provider adapter,
receipt repository or endpoint is connected. The prepared server boundary is
restricted to Partner/Service Provider purposes, requires consent and an active
session, and is designed not to retain raw NIN. This is preparation, not a live
identity implementation. Existing optional policy-gated face screening requests
independent review; browser scores do not approve identity. Property authority
documents attach to each submission; Service credentials attach to the provider's
service/coverage context; Experience evidence attaches to the activity. These
private document journeys explicitly exclude NIN, passports and bank details.
Required-document configurations and legal approval for each jurisdiction still
need verification before enabling that market.

Country/currency/timezone rows and a closed payment-market adapter boundary exist.
Only NG/NGN/Paystack is enabled for money movement; a country catalogue row cannot
enable payment/refund/settlement. Property submission still selects Nigerian
locations explicitly. Global country-qualified locations, jurisdiction-specific
identity/document rules and end-to-end market activation are not complete.
There is no claim of all-country or all-continent readiness. Production is unchanged.


### 26 October: restore mandatory rent protection and trace live Service quotes

The attempted direct-subaccount model was an incorrect exception to the owner's
Payment Protection rule. It was prepared/applied only on Test, remained behind
an unconfigured rollout gate, created no actual later-rent payments, and was
replaced by migration `20261026055031`. Historical migration `20261026053058`
is retained as applied audit history; it is superseded, not an active product
path. Active checkout/webhook/verification handlers contain no new direct-rent
split exception. The retired experimental provider-proof RPC/trigger were
removed. No real charge or Production change was made.

Later-year collection cannot bypass protection even through a verified provider
receipt: it remains paused until its protected collection and authorized-release
journey is completed. Invalid later-rent charges enter the canonical durable
Finance-recovery event queue without becoming paid or creating ledger/wallet
credit. The existing signed-role Long Let contract passes that negative case,
as well as the accepted term, upfront payment, handover and future schedule.

Service quote delivery had a real configuration defect: the client listened for
Postgres changes on `worker_bookings`, which is absent from Test's Realtime
publication. Migration `20261026055951` sends private ID-only signals to the two
booking participants, without publishing raw booking rows or price/scope data.
The client coalesces signals into participant-authorized booking reads, recovers
on reconnect/focus, prevents older reads from overwriting a new quote, and keeps
editing input intact. Identity changes remount the conversation. UI labels say
proposed quote rather than implying the provider alone creates customer consent.
The participant/outsider SQL signal contract and focused client subscription
tests pass. The actual chat also passed isolated light/390px and dark/1280px
browser checks: a new price appeared without manual refresh; a price signal did
not reload/decrypt the conversation; a delayed older response did not restore an
old amount; changing accounts cleared the previous quote. These are synthetic
presentation/transport checks, not hosted two-device encryption proof. All 755
regressions and the production build pass. Service payment is still blocked by the missing attached cancellation
contract in the current review screen; completing that reviewed checkout remains
part of sequence 1, not an external dependency.

## Execution order and release decisions

The open work register below remains the single task inventory. Dated entries
are implementation history, not current release approval. Use this order to
close release gates; independent repairs continue while another gate is blocked.
Small component checks do not close a missing customer/operator journey.

| Order | Outcome required | Closure evidence |
|---|---|---|
| 1 | Reconcile the exact PR baseline, migrations and enabled feature boundaries | Fresh/upgrade replay, permission checks and exact-SHA CI; retain failed gates |
| 2 | Finish enabled money and booking journeys, then the agreed unfinished marketplace flows | Customer and operator success/failure/recovery journeys, inventory races and reconciled sandbox money |
| 3 | Replace expensive chat fan-out/polling and complete recipient delivery | Authorized live changes, reconnect/block/account-switch checks, unread and notification behavior for each chat type |
| 4 | Validate a realistic workload for the enabled release; track expansion claims separately | Free-plan budgets, bounded reads/media/uploads and representative isolated recovery checks. Larger concurrency claims are future expansion work; no oversized hosted Free-plan ramps |
| 5 | Close whole-app role, privacy, design and device gaps | Route/control inventory, actual data-rights operations, both themes and signed-device evidence on the reviewed SHA |
| 6 | Decide merge/promotion separately from public launch | All applicable internal gates pass; external credentials, commercial/legal and store approvals are explicitly identified |

**Current decision: finish and verify the controlled Free-plan release; no 100k-user capacity claim.**
The historical 500-RPS direct-origin failure remains expansion evidence, not a
target for load testing the hosted Free-plan database. The current PR preview
builds and serves application HTML; a fresh cache-hit verification is still
needed. The earlier billing failure must not be treated as a confirmed current
blocker without rechecking it. Do not purchase infrastructure or run large hosted
loads merely to make a dashboard number larger.

### 25 October owner correction: Year 1 is always paid in full

One-year Long Let has no monthly option. Accepted shorter terms are full-payment
terms too. Monthly payments cover only later years of a landlord-approved
multi-year contract: Year 1 is paid in full before handover, followed by eight
payments for each later year starting four months into the preceding year.
Without landlord opt-in the entire multi-year contract is paid upfront. Manual
or separately consented automatic collection does not change those amounts or
dates. This supersedes the earlier mistaken one-year monthly interpretation.

Migration `20261025152711` rejects one-year monthly quotes and agreements,
restricts future payment rows to Year 2 onward, and removes the invalid schedule
branch. Partner and customer controls, receipt validation and canonical product
rules use the same restriction. Test contained no invalid saved agreements or
first-year contribution rows to unwind. The corrected signed-role contract
passes three-month full payment and a two-year agreement with Year 1 paid in
full, eight Year 2 payments and actual-handover dates. No Production change is
part of this correction.

### 25 October: Service checkout commission and payment retry repair

Test migrations `20261025114934`, `20261025115331` and `20261025120132`
freeze the existing Service percentage commission on the canonical payment
record, reuse a pending reference despite optional null fields, and retain
unresolved verified receipts in the existing Finance recovery queue. A later
Creator policy change cannot rewrite accepted checkout terms. Existing valid
unpaid references freeze at migration cutover; paid history is not rewritten.
No commission rate or fixed fee is activated by these migrations.

`worker_checkout_commission_contract.sql` passed on Test with rolled-back
fixtures: original/new rate behavior, reference reuse, immutable terms, canonical
receipt processing, protected balance, duplicate receipt and unresolved legacy
receipt persistence. It is included in fresh migration CI. The 748 local tests
pass. This repairs Service payments; it does not implement Experience checkout.

The preceding exact PR head `eb7c505b` passed build, structural, Stage 1,
consolidation (including fresh/upgrade migration replay), browser, disposable
capacity and mixed preflight workflows. Hosted catalog capacity still failed;
these payment migrations require their own exact-head replay before approval.

### 25 October: Booking-offer precision and proportional verification

Home offer display now preserves minor units using decimal half-up rounding,
binds each offer receipt to its property, resets offers on navigation, validates
the offer breakdown and provides bounded failure/retry. The production build,
750 local regressions and property journeys at 320/390/768/1440 passed. Focused
light/dark browser checks passed for fractional prices, delayed property
switching and offer failure/recovery. These are synthetic functional checks,
not real provider transactions.

Owner direction: stop repeating large hosted load ramps for unrelated fixes.
Hosted capacity is now an explicit manual workflow; a failed single-generator
stage prevents the distributed load stage. Functional, permission, fresh/upgrade
migration and isolated browser checks remain automatic. The latest tested head
`111556e4` passed consolidation including the new payment contract. Its catalog
ramp passed 200 RPS without errors/retries, then failed at 500 RPS; no 100k-session
or fixed infrastructure ceiling is established. Those capacity targets do not
replace completion of the agreed booking flows.

Monthly Long Let is part of the existing reservation, rent schedule, canonical
payment records and Partner operations. It remains the active integration task,
not a separate product or a request to renegotiate already-agreed rules.

Test migrations `20261025133858` and `20261025134104` add one accepted-term
offer on the existing listing and reuse its existing monthly opt-in field.
The common schedule calculates the agreed 3/6/12-month and multi-year full or
monthly amounts, allocating every minor unit and anchoring calendar dates to
verified handover. Both rolled-back SQL contracts passed on Test: schedule sums,
leap/month-end dates, owner access in both management modes, denial for Operations
co-hosts/outsiders, idempotent saves and stale-update rejection. Partner controls
are integrated into property details.

Follow-through migrations `20261025141438`, `20261025141825`, `20261025142434`
and `20261025145336` connect the offer to reviewed tenant acceptance, immutable
checkout terms, protected first payment and actual-handover schedule anchoring.
The corrected rolled-back signed-role contract passes three-month full-term checkout
and two-year later-year monthly checkout through the canonical verified-charge
ledger, with Year 1 paid in full, then handover and eight dated Year 2 obligations. Full-term payment
creates no unpaid future plan. The accepted three-month term ends in three
months, rather than becoming a one-year tenancy. Allocated Partner, WeHouse and
funded-promotion amounts preserve every minor unit and avoid negative shares.

The null handling in the existing arrival guard was repaired without allowing
unpaid handover; the existing negative handover contract passes. The unused
legacy rent-plan cancellation RPC was revoked because it recorded claimed
refund/paid-out amounts without a verified provider refund. Historical records
are preserved; actual tenancy exit and refunds use booking Help/Finance review.

The customer agreement is connected inside My Bookings. Payment stays blocked
while terms differ, a quote is under review or acceptance is unconfirmed.
Wording now describes the agreed required rent payment instead of calling every
term a Year 1 payment. Partner and customer light/dark browser checks, malformed
receipt recovery, production build and 750 regressions pass. Later scheduled
collection and provider split/settlement reconciliation remain active internal
integration work. The initial-payment contract is not proof that the later
monthly payments or real Paystack settlement already work.

### 25 October: Friend reaction delivery and polling investigation

**Verified follow-up:** exact-SHA `d0cf0e81` mixed preflight run
`40171342520` passed the three-session message/reaction delivery and outsider
check, then completed 150/150 and 300/300 mixed HTTP journeys without failures
or drops. Consolidation run `40171342560` passed fresh and existing-account
upgrade replay. Requiring the disposable database broadcast stream before
assertions resolved the recorded local delivery failure. This proves the
synthetic WebSocket/RPC contract; hosted two-device encryption and phone push
remain separate checks.

Traced reaction setters and active-chat listeners across Friend, Roommate,
Service and Hotel. Friend had no live listener and reloaded/decrypted its full
thread every eight seconds. Its repair uses recipient-owned private Broadcast
signals, visible coalesced reads, join/reconnect/focus reconciliation and a
60-second visible recovery check until actual signals establish delivery, plus
a five-minute visible recovery snapshot to cover silent event loss. Joining a
socket alone is not delivery proof. The signals contain IDs and a change
kind, never message text, ciphertext or a reaction map. Source tables remain
RPC-only; there is no client publish policy or competing notification table.

Test migration `20261025060525_friend_chat_private_delivery` is applied. The first
SQL test exposed absent provider-owned broadcast partitions. A diagnostic Test
Realtime connection initialized the service; no application DDL touched its
tables. The rollback contract then passed: both recipients, outsider denial,
same-reaction deduplication, removal synchronization and closed direct grants.
CI now initializes its disposable Realtime service before this contract.
Four client/lifecycle tests and the 746-test regression pass; focused lint and
build pass. A three-session disposable WebSocket/RPC check is added to mixed
preflight; initial runs failed despite stored broadcasts and active replication
slots. Service readiness now requires the broadcast replication stream before
business assertions; the exact-SHA result is recorded above. A synthetic hosted Test broadcast
reached a live listener, and provider authorization confirmed own read/no publish
and outsider denial. Hosted two-device delivery remains
unverified. Friend history pagination/delta reads and wider app message fan-out
remain internal scale work; this repair alone does not meet the 100k target.
This does not add a background reaction push alert, a new unread message or an
Activity item. Existing non-Friend live listeners still need two-device evidence.

### 25 October: restore skipped browser checks and cover FK lookups

Exact-SHA `eb28d8c1` verification completed: build, structural regression,
all browser workflow jobs, fresh migration replay, existing-account upgrade,
Stage 1, disposable medium catalog and mixed journeys passed. Hosted Test
catalog capacity still failed; none of these passes close the whole-product
capacity or unfinished feature gates.

The `d0cf0e81` Wallet/Pro browser job failed before its first screen because a
relative import from the new Friend live helper bypassed the test's enumerated
client substitutes. Resolve the canonical client path instead of enumerating
importers, and reject any isolated fixture bundle containing the real client.
The repaired local Wallet/Pro suite passes 83 scenarios, management/arrival 16,
Experience applications/review 32, sessions 10, property submission 13, Hotel
cancellation 36 and Friend/Roommate sharing 12. The source regression passes
746/746. Independent browser domain steps now continue after another domain
fails, retaining a failed overall job. Exact pushed-SHA CI must pass before
closing the browser gate.

Test migration `20261025082141_cover_readiness_foreign_keys` adds 31 confirmed
missing reverse-lookup indexes across account challenges, notification jobs,
Hotel discounts, booking-policy references, chat replies, document reviewers
and Pro records. Current Test relations were inspected before apply; the largest
affected table was below 0.5 MB. The migration uses bounded lock/statement waits.
The schema coverage contract passes on Test, and its performance advisor now
reports no missing-FK-index findings. Fresh/upgrade replay is still required on
the new SHA. These indexes do not establish the cause of hosted overload.

Latest hosted catalog run `40171342548` on `d0cf0e81` passed through 100 RPS,
then failed 200 RPS (3,332/6,000 completed; 3,000 errors; 2,668 drops; 13,774 ms
p95). The 500 stage was not attempted. This later failure supersedes any claim
that 200 RPS is a dependable current limit. Provider logs for 07:06–07:08 UTC
contain 3,722 matching catalog responses, all HTTP 200, with approximately 901 ms
origin-time p95; they do not account for every attempted request and do not
identify the transport/API/database bottleneck. The failure remains open.

### 25 October: durable custom work reminders

Test migration `20261025083745_deliver_worker_pro_reminders` stores delivery
revision/time in the existing reminder row, dispatches up to 200 due rows per
minute with row locks and `SKIP LOCKED`, and creates one canonical Activity
event/audience per revision. No competing notification table is introduced.
Reminder notes remain in the private worker Activity; native push uses the
existing generic payload, preference/session checks and queue. Credentials and
actual signed-device delivery remain separate activation/verification gates.

Identical save retries retain the revision; rescheduling resolves the old alert,
completion resolves its action, and leaving an eligible job status closes its
unfinished reminders. Future, done, suspended/banned/deleted-account reminders
are not dispatched. The private dispatcher is unavailable to ordinary clients.
The rollback SQL contract passes on Test. Browser checks cover direct business
tools entry, both themes, completion and a malformed save receipt with recovery.
The former screen-only toast timer is removed; business writes require receipts
and reject overlapping taps. Local evidence: 747 regression tests, production
build, focused lint, 85 Wallet/Pro browser scenarios and 18 focused management/
reminder scenarios. On `47bea57a`, exact-SHA fresh/upgrade, regression/build,
mixed journeys, Stage 1, disposable medium catalog, Wallet/Pro domain browser
jobs and media compression pass. The separate document/Pro fixture returned a
boolean for UUID-returning reminder/package commands; receipt validation caught
it. Correct the fixture to model the actual RPC receipts, preserving the UI's
failure check. The 36-width/entitlement/account-switch document scenarios then
pass locally; their exact-SHA browser rerun remains required. Hosted capacity
still fails and broader product gates stay open.

### 25 October: booking currency and one Short Let price summary

Exact-SHA `7d3fc23a` passed all workflows except hosted Test catalog capacity.
This closes the prior document-browser fixture failure; it does not close
capacity or the missing booking implementations below.

Tracing current booking checkout exposed use of the viewer's selected currency
for stored amounts. Financial presentation now uses recorded currency across
property reservation/payment reviews, Hotel checkout, Service negotiation,
booking history, on-screen receipts and receipt PDFs. Historical Hotel/Service
records without a currency are known NGN records; that compatibility rule is
centralized and does not choose a currency for new charges. Explicit invalid
currencies and invalid/missing amounts fail visibly instead of becoming another
currency or zero. Currency precision follows the currency, including three-digit
minor units. Existing NGN-only settlement boundaries remain enforced.

The unused `ShortLetPaymentReview` had no application consumer and retained
different disclosure from the live `ShortLetPaymentSummary`; remove it and test
the live summary. Its saved fee, stay charge, refundable caution, full booking
total and remaining balance are now verified together. Offline browser fixtures
resolve the real client path consistently on Windows/Linux and reject accidental
live-client imports; receipt image loading is asserted rather than ignored.

Local evidence: 748 regression tests, production build and focused lint;
87 Wallet/Pro browser scenarios, 20 focused management/currency scenarios and
10 Long Let viewing/rent-action scenarios pass. NGN summaries and receipts remain
NGN in a USD region in both themes. The booking-workspace suite additionally
checks legacy currency fallback, itemized total/balance, workspace switching and
Hotel reply/follow-up behavior. Exact pushed-SHA CI remains required. This repair
does not implement optional monthly settlement, Experiences checkout or shared
Hotel costs; their existing register rows remain open.

### 25 October: prevent duplicate browser feed work (implementation history)

Deployed web now shares identical in-flight public Home/Hotel feed reads, keyed
by origin and canonical public query. Forty simultaneous equivalent reads make
one fetch; each consumer receives an independent JSON receipt. Completed reads
are removed immediately, so this adds no stale browser cache. Distinct pending
feeds are capped at sixteen per tab; overload never falls back to origin RPCs.
Success and failure both release slots. Typed/private/precise-location searches,
pagination, native/local clients and payment/account operations retain their
existing direct paths. Focused gateway/client tests pass 16/16.
The full local source suite passes 742/742; production build and focused lint pass.
Discovery/privacy/location browser checks pass at 320, 390, 768 and 1440px in
both themes using real components and intercepted synthetic public responses.

Read-only provider inspection confirms the organization is currently on the Free
plan. That is a deployment constraint to include in capacity planning, not proof
of the cause of the 500-RPS failure and not a fixed database RPS ceiling. No plan,
billing, compute setting or Production resource was changed.

### 25 October: measured capacity failures retained; public response memory bounded

The compressed direct-origin run on `1f34cb29` passed 200 RPS (6,000/6,000;
604ms p95; zero errors/retries/drops), then failed 500 RPS (4,072/15,000
completed; 3,434 errors; 10,928 drops; 11,128ms p95). It never ran 1,000.
Four subsequent generators each passed 10 RPS, then failed the 25-RPS latency
gate (7,477–7,669ms p95), despite completing all requests without final errors.
There is no passing 800-RPS distributed result. Neither this variability nor
the database's configured 60 connections establishes a fixed database RPS limit.
The matching 23:01–23:02 UTC provider log window contains 3,175 HTTP 200 entries;
it does not explain all client latency or establish CPU/IO headroom.

Public gateway responses now have a 2 MiB decoded-byte budget enforced while
streaming, including chunked responses. Oversized, malformed and invalid UTF-8
receipts fail uncached; failed streams are cancelled and pending slots released.
Non-success origin bodies are discarded rather than buffered. Fixed storage
also bounds tiny-chunk bookkeeping. Negative/recovery tests cover these paths.
This protects function memory; it is not evidence of higher production RPS.
Current-preview/CDN verification still requires resolving Vercel's overdue balance.
Local full regression passes 739/739 outside the Windows sandbox; the sandbox
itself denied loopback sockets and temporary-directory renames. The prior pushed
head passes the other seven workflows, including migration replay, browser
journeys and disposable mixed/catalog checks; hosted capacity remains failed.

### 24 October: higher-throughput work continues beyond the 200-RPS test ceiling

Benchmark correction: the native transport initially omitted HTTP compression.
A Test Home feed was 21,650 decoded bytes versus 1,591 on the wire with gzip.
Compression negotiation/decoding and byte counters are now tested; prior native
results remain labelled uncompressed, not a compressed-browser/database maximum.
The initial four-source run failed at 100 RPS each and emitted no 800-RPS pass.
Vercel's API confirms an overdue team balance prevents preview deployment (402);
this external blocker is distinct from all remaining internal release work.

200 RPS was a benchmark ceiling, not an established database maximum. Repeat
ec5f35ef origin testing passed through 100 but failed at 200 (187 errors). Do not
substitute the earlier passing run for this failure. The staged CI ceiling is now
1,000 RPS, preserving lower stages, thirty-second holds and all failure gates;
it stops immediately at a failed stage. A local expanded attempt failed its 1 RPS
latency/retry gate and did not run the higher stages.

Expanded CI on f8507e32 passes 200 RPS, then fails 500 RPS (12,543/15,000 completed,
2,457 dropped; 9,087ms p95). No 1,000-RPS result exists. Subsequent transport work
removes the 256-socket generator bottleneck for the expanded ceiling and reports
client queue versus post-socket response timings separately. The 2,000ms p95,
errors/retries/drops and dispatch gates stay unchanged; the next run decides.

Repeat fbcffd6e still fails 500 after a passing 200 stage; no 1,000 result exists.
The workflow now additionally measures four independent generators after the
single-generator phase, with strict same-version, complete per-shard gates and
overlapping-window validation before reporting 800 aggregate offered RPS. This
is pending measured evidence. The structural timing assertion was corrected for
Unix assigning a newly freed socket just before abort; measured queue time and
absence of headers remain required. Secret-free gateway operator diagnostics are
also covered, with one event per failed collapsed lookup rather than per waiter.

The public-feed gateway, browser wiring, API build checks and negative/concurrency
tests are implemented; see `capacity-validation.md` for the exact cache boundary
and exclusions. No payment/booking/session data is cached. Focused tests and
both-theme browser journeys pass; real preview/CDN verification is blocked by
Vercel's reported account deployment block and unavailable connector. This does
not close the broader internal engineering register or establish global capacity.

### 24 October: repeatable capacity transport

Exact-commit 16519f06 passes seven workflows, including both-theme browser checks,
fresh/upgrade replay and mixed journeys; the hosted 200 RPS ramp fails. Its retained
report records 3,000 failed logical requests and 1,556 drops after reaching 3,000
in flight. Errors are connection refusal/connect timeout/attempt timeout. During
the same window, the available Supabase catalog edge logs record 2,802 HTTP 200s
and no other status; this does not prove every offered request reached Supabase.
Aggregate Home/Hotel database search time is about 6.2 ms, not a transport verdict.

The benchmark now uses an explicit reusable 128-socket TLS pool instead of an
unbounded implicit client connection budget. Queued time remains inside the same
15-second attempt deadline; offered rate, logical in-flight ceiling, retry budget,
latency, drops and success gates are unchanged. Seven local transport/gate tests
pass, including 64 concurrent POSTs on four reused connections and queue expiry.
The next hosted run must determine the result. This is measurement hardening,
not a claim that application caching or production capacity is complete.

Result: all eight workflows pass on fcc9cc149f2a63a248228f209dda3f21a3cb09b9.
The unchanged 200 RPS gate completes 6,000/6,000 requests with zero failures,
retries or drops, 69 maximum logical requests in flight and 234ms p95. Keep the
earlier failures and distinguish this bounded catalog result from sustained or
mixed production capacity. The full local suite passes 721 tests.

Follow-up visual review also replaces translucent low-contrast photo status ink
with white on a dark badge. ListingCard no longer infers a “Verified” claim from
availability status alone or repeats the same availability message beneath the
rich card. Both-theme discovery/privacy/location browser journeys pass again.

### 24 October: shared late receipts and theme evidence

Consolidation on 9ab4777aa919984aa7df0185bca38d27f98ad719 passes the added
late-shared-receipt savepoint test. A final payment after expiry and its duplicate
leave all three verified payments recorded, keep the group refunding and never
confirm rent/arrival. Rolling that branch back then exercises normal on-time
completion in the same contract. This is database behavior, not a live refund.

Discovery/privacy/location and Roommate/shared-payment browser checks now run
both actual theme attributes at 320/390/768/1440px, with separate screenshots.
Light screenshot inspection exposed inherited dark ink on photo price/Save
overlays; ListingCard now gives media its own white foreground in both variants,
and formats amounts in the listing currency rather than the viewer's default.
The shared design reference names the reusable controls instead of introducing
a competing visual system. These checks do not certify all app screens polished.

### 24 October: exact-commit gates and personal-data/location follow-up

All eight GitHub workflows on 96b90067775e954b7926d03279ad544db410bd11 pass,
including fresh replay, existing-account upgrade, complete browser workflow,
build, structural regression, mixed journeys and the bounded catalog ramp.
The earlier 200 RPS failure remains historical capacity evidence; a later passing
smoke run alone does not establish sustained production capacity.

Personal-data access/correction/deletion now has a visible entry point for every
account in Privacy & Security. It opens the existing account-access conversation
with a typed privacy-request source. The user must send the message to submit;
the UI does not pretend opening it completes erasure. The existing scoped support
reply/receipt controls apply. Actual retention, purge coverage, operator resolution
and legal publication still require separate completion/evidence.

Homes, Hotels and Service search now reuse the searchable structured State/LGA
dataset for Nigeria. Changing State clears a stale LGA. Browser checks cover this
and the privacy-request handoff at 320/390/768/1440px. Other countries still need
reviewed administrative datasets/stable identifiers before equivalent regional
filtering can be claimed; free-text fallback is not global-location completion.
Same-school matching uses the shared theme-aware switch and explains reciprocal
preferences, self-reported school names and preservation of existing connections.

Shared-payment browser checks pass across four widths with a foreign display
currency preference: current NGN-only checkout obligations stay labelled NGN.
The deadline no longer adds WAT after an already zone-labelled viewer timestamp.
The screen states that late acceptance cannot extend the common payment deadline,
all assigned shares need verification, and expiry refunds return through original
payment processing rather than being instantly complete. The existing Short Let
SQL contract proves one paid share cannot confirm the stay and acceptance cannot
renew its hold. Scheduler/late-receipt and real-provider reconciliation evidence
remain distinct from these UI checks.

### 24 October: browser and privileged-RPC verification follow-through

The hosted rollback sweep now covers 42 contract files, including support reply
receipts, case routing, inspection authority, Finance receipts, booking arrival,
Service commands, Experience applications, withdrawal receipts, private calls
and physical-space identity. These execute synthetic records and roll back;
they do not initiate provider payments.

The privileged-write audit now recognizes six explicitly reviewed authorization
helpers only after verifying their definitions and non-browser execution ACLs.
The full audit passes on Test; fresh replay on the next PR commit remains required.
No runtime permission was relaxed to satisfy the audit.

Focused browser reruns pass profile refinement, management/security, communication
draft isolation and the media viewer at four screen widths. The media run exposed
a real duplicated touch/double-click zoom toggle, now repaired. A separate touch
trace exposed suppressed compatibility clicks after date-field scrolling; the
date field now accepts a stationary touch while retaining drag rejection.
The complete property suite passes, including all four screen widths, guest
media boundaries, reviewed payment handoff, sharing, workspace Activity, Hotel
chat, receipts, delayed account loading and retry behavior. TypeScript, focused
lint and media regression tests pass.

Capacity evidence is mixed: 07039d62 passed the bounded 200 requests/second ramp,
but 42b9c9ce passed through 100 and failed at 200 (1,253 failed logical requests).
The earlier passing run does not close this reliability gate. The failure remains
recorded without lowering the threshold or claiming sustained/global capacity.

### 24 October: exact-PR replay and cancellation prerequisite

Pushed CI/bootstrap repairs as 5b752140 and compatible dependency audit updates
as ba58d723. All 718 local regression tests pass. TypeScript passes and the
updated production dependency audit reports zero vulnerabilities. Fresh CI on
5b752140 passed consolidation tests/build and advanced beyond missing buckets,
then correctly rejected the missing Hotel cancellation policy prerequisite.

The additive 20261023111611 prerequisite is intentionally ordered immediately
before the already-applied 24-hour update. It creates Hotel and non-refundable
accommodation policies only when no global history exists, using the approved
24-hour deadline and the existing published rate protections. It never alters
an existing draft, schedule, version or booking snapshot. Original migration
bytes remain unchanged. Existing installations must include this earlier missing
version in their reviewed deployment migration list (`--include-all` for CLI
push); do not repair history by falsely marking it applied. Hosted rollback
checks verified unchanged existing history, empty-table initialization against
a temporary table with the real constraints, and repeated execution. Added a
fresh-replay SQL contract. Full fresh/upgrade CI still decides replay readiness.

On d79082ef, full fresh initialization and reset complete, including the new
policy contract. Consolidation then catches a stale source assertion: cancellation
now delegates eligibility to the shared preview helper. The revised assertion
checks both the call/required full-refund receipt and that helper's saved terms,
deadline and Finance guards; hosted rollback execution passes. The real paid
cancellation behavioral contract remains enabled.

Versioned upgrade omitted the historical eight-digit 20250526 migration from
the disposable runner's fourteen-digit filter. The runner and regression fixture
now retain it without changing its version or bytes; all 26 focused checks pass.
Mixed-journey booking correctly rejected synthetic Hotels lacking current
document approval. The local-only fixture now supplies distinct synthetic owner/
reviewer records and every default Hotel evidence requirement. Hosted rollback
verification confirms all 50 satisfy the unchanged production document guard.
Six coordinated-release tests also pass on Windows after normalizing only their
LF fixture, leaving the exact migration-hash exception unchanged.

The hosted anonymous catalog ramp passed through 50 requests/second but failed
at 100 with 1,173 request failures. This is unresolved capacity evidence; it is
not a passed global-scaling gate and its threshold has not been lowered.

Follow-up on 07039d62: the hosted catalog ramp passed every 30-second stage
through 200 requests/second, with zero errors/retries/drops and 232ms p95 at
200. This is bounded anonymous catalog evidence, not sustained mixed-product
capacity or an explanation of the earlier intermittent timeouts.

Further replay checks reached the credential-dependent team fixture. It now
includes reviewed synthetic service evidence, and its full hosted rollback
contract passes. Upgrade execution identified a leading UTF-8 BOM interpreted
as SQL by the coordinated runner; only SQL decoding removes that initial marker,
while original file hashes remain exact. Seven runner/history tests pass.
The mixed Auth load now registers its first trusted device and uses the same
idempotent support message RPC as the app. Experience continuity waits for the
actual submit button to become actionable after save instead of reading a
transient busy state; 32 application and 10 session browser journeys pass locally.

On b6639ca2, the real Auth/mixed HTTP journey preflight passes, including
inventory contention and reference uniqueness. The complete upgrade then exposed
a policy created and retired in the same atomic transaction: `now()` is identical
for both, so the original strict positive effective interval rejects retirement.
The still-unreleased prerequisite now permits an empty interval only on a retired
version. Active/scheduled empty intervals and all negative intervals remain
rejected; the hosted rollback SQL contract verifies all three cases. Existing
policy values/history and booking snapshots remain untouched. This is a
transactional migration fix, not permission to disable the policy guard.

The free arrival-instruction contract now registers trusted synthetic devices for
its actual owner, unrelated owner and guest; the full hosted rollback contract
passes without weakening session or ownership checks. Entry browser fixtures now
use the implemented username-or-email and Homes wording. Login layout (six
viewport arrangements), enlarged text, reduced motion, welcome composition and
Help failure/retry checks pass locally on a reachable fixture server.

The broader baseline-field projection proposal was rejected by automatic review
and was not applied. The replacement is restricted to the six explicitly reviewed
credential columns absent before this upgrade. Already deployed credential fields,
all original fields and every row remain hashed. The new hosted rollback contract
proves insertion into an empty table, later insertion/deletion, approval/evidence
mutation, already deployed credential mutation and unrelated schema drift are
detected. It also proves the reviewed six-column addition alone is not mislabeled
as data loss. Seven Python release tests and workflow parsing pass. The Hotel
conversation/media contract now passes with its actual trusted-session fixture.

Partner browser checks pass at 390/768/1440px through Hotel operations, exact
Activity booking links, access revocation, and internal property-profile navigation.
Public discovery checks pass at 320/390/768/1440px, including guest read-only access,
room/rate selection continuity, sign-in return and retained search state.

### 24 October: batch role, money and marketplace verification

Existing-account upgrade on 2c3ea788 passes its atomic rollback, commit and repeat
checks in GitHub. A broader hosted rollback sweep has now verified 32 contract
files covering Pro, Friend cost sharing, reports, property documents/submission,
operating costs, Roommate cancellation/matching, discounts, worker refunds,
country settings, account email security, workspace authority/inboxes, Help
routing, property management, co-host invitations, Sponsored payment/placement
and cross-user RLS. Synthetic setup was brought through current trusted-device,
hosting-assignment and credential requirements; those production guards remain
enabled. psql-specific recovery/shared-stay contracts and the upgrade-fixture-
dependent withdrawal contract still require the exact CI run; they are not
counted as hosted passes.

The matching sweep found Test deployment drift: the existing canonical
20261007210000 Roommate ranking fix was missing there. Applied its unchanged SQL
to Test as recorded version 20261024174602, then its full practical matching
contract passed. The existing canonical file is preserved; no duplicate Roommate
implementation was added. This Test alias is distinct from Production history.

Cross-user security checks found unintended browser grants on hotel_rooms and
hotel_commercial_change_audit plus automatic public-table browser defaults.
Additive Test migrations 20261024175813 and 20261024180442 revoke those direct
grants and close future postgres-owned public table defaults, preserving service
maintenance and scoped RPCs. The complete foundation RLS contract passes after
the fixes. Its explicit anonymous-function inventory now includes the reviewed
Home-style search overload, key-allowlisted discovery settings and published-only
bounded site offers. Marketplace and Sponsored contracts also pass with the real
invitation, publication, payment and row-access guards. No Production changes,
real charges, transfers or persistent synthetic customer records were made.

Full 25a20e5f source regression passes 718/718, while exact CI fresh replay has
progressed through the first 68 steps and now reaches the shared Short Let
contract. That fixture previously created a public-looking home without an owner,
reviewed inspection/documents or trusted payer devices. Its setup now includes
those prerequisites; the real booking guard remains enabled. Hosted rollback
verification reaches reservation creation successfully. The complete psql shared
payment lifecycle still requires the next CI result; it is not counted as passed.

### PR integration and actual CI failure repair

The accumulated engineering work was committed in d489194c and pushed to #118;
ff90075c additionally protects PDF bytes and updates the Experience proposal.
The work is no longer only local. That exact remote version passed structural
regression, consolidation source/build checks, hosted catalog capacity and media
compression, and its Vercel Preview reached READY. It did not pass all CI.

The build audit found DOMPurify <=3.4.16 and Vite <=7.3.6 advisories. Compatible
updates to DOMPurify 3.4.17 and Vite 7.3.7 produce a production audit with zero
reported vulnerabilities. Three moderate development-tool advisories remain;
no forced Tailwind major upgrade was performed. The patched build passes.

CI also exposed stale Account/Pro fixtures and an inventory assertion counting
the newly connected building-schedule control as a listing. Account's fixture
now intercepts its actual database-client import paths. Essential arrival tools
are asserted absent from Pro rather than tested as a paid entitlement. Account
and Pro preview journeys pass locally after repair.

Fresh/upgrade replay failed because the historical schema-only dump omitted
Storage bucket rows required by an existing migration guard. The disposable
runner now provisions explicitly reviewed baseline bucket metadata before
executing the unchanged original migration files. It never targets a remote
project, overwrites existing bucket configuration, copies customer data or
rewrites applied migration history. Four runner tests and the 26 focused CI/
critical-contract checks pass; full GitHub fresh/upgrade execution of this
repair remains required. The original guard and all SQL contracts remain active.

### Subscription receipt replay and revised lawyer brief

Fixed canonical Service Worker Pro subscription-event replay on Test, migration
20261023154900. A duplicate provider event now has to match its original account,
payload hash, event kind, event time and entitlement end. A repeated conflict or
rejection cannot become a successful acknowledgement. Ignored older events stay
ignored. The hosted rollback contract checks these cases, unchanged entitlements,
no cross-account entitlement, one canonical event record and absence of direct
anonymous/customer execution grants. Registered that contract in consolidation
CI; workflow parsing passes. This updates the existing event authority without
another subscription/event table. No real purchase, refund or payout was sent.

At the owner's correction, replaced the earlier 14-page legal-review pack with
four pages (12,525 bytes): current product rules and counsel questions, without
raw decision IDs, historical appendices, code paths, hashes or release-status
pages. All four pages were rendered and inspected. The requested rent schedule
is described as the owner's requested model requiring legal review, rather than
omitted or asserted to be an enforceable agreement. The revised file remains at
the existing output path, and an identical sharing copy is saved to Downloads
as WeHouse-Policies-for-Lawyer-Review.pdf. This supersedes the earlier PDF format
and record-count description below; it does not change the product's engineering
completion status or provide final published terms.

### Experience media, independent approval and payment confirmation boundary

Private activity photos now use the same provider application, with immutable
upload reservations, prepared JPEG bounds, signed previews, exact receipts,
retry recovery, current-content review and actionable host Activity. Independent
Creator approval checks identity, workspace, evidence, all selected photos and
future reviewed sessions. Approved evidence, photos and dates remain read-only;
the host withdraws approval before revising and resubmitting. Approval does not
publish an activity or open checkout. Duplicate React keys that retained obsolete
document controls after approval were corrected.

Test migrations 20261023144716, 20261023145334, 20261023150000,
20261023150359 and 20261023151718 are applied. The rollback contract passes,
including self-review denial, revoked-device denial, missing identity, stale
currency/capacity/timezone/duration, lost-response replay and host Activity.
The 32 application browser journeys and broader 83 wallet/Pro journeys pass; light/dark approval captures were
inspected. Source checks now pass 714 tests; the combined build and full lint pass.

The payment trace also removed the legacy generic paid-writer fallback from
verification and webhook routing. Unsupported purposes reach the canonical
provider-event gateway and fail without claiming a protected booking. Rejected,
malformed and ignored confirmations cannot produce a success receipt. Service
Worker Pro verification uses its subscription confirmation lifecycle. Twelve
routing/client-retry checks with simulated external I/O and both Deno checks pass.
Known verified charges retain their charged/review status when persistence fails;
the client rejects incomplete or contradictory success receipts and preserves the
final recovery error. Test paystack-verify v8 retains JWT verification;
paystack-webhook v6 retains its
signature authentication boundary. Unauthenticated/invalid-signature hosted
probes before the final strict-receipt rollout both returned 401
(payment-confirmation-edge-auth.json). On the final bounded probe, verification
v8 returned 401 and the webhook request hit a network timeout; that final webhook
probe is inconclusive (payment-confirmation-edge-auth-final.json). The hosted
payment_confirmation_routing_contract.sql passes: an unsupported receipt remains
durably failed for recovery, its payment stays pending and no protected balance
is manufactured; replay keeps one receipt. This contract is registered in the
existing consolidation CI workflow. No charge, transfer
or refund was initiated. Real authenticated provider recovery remains unproven.

The Marketplace work-register row below is the current feature boundary;
historical dated entries saying all Experiences work is unimplemented are
superseded by this evidence. Public discovery, publication, checkout, attendance,
booking-bound reviews, discounts and sponsorship still require their connected
implementation. No remote PR update, merge or Production deployment occurred.

### Retried Test access and payout limiter rollout

The owner requested another connection attempt. Test Edge-function inventory
succeeded and confirmed existing JWT verification for both payout endpoints.
Deployed payout-account v7 and payout-withdrawal v4 with the tested fail-closed
limiter, preserving verify_jwt=true. Both complete handlers pass Deno checking;
the 55 focused money/PMS checks remain the source verification for this repair.
Four hosted POST probes (missing and invalid bearer for each endpoint) return
HTTP 401 and are recorded in test-results/payout-edge-auth.json. Windows HTTP
worked after Node fetch could not connect. The source-readback connector failed;
no remote file diff or authenticated limiter-outage proof is claimed. No charge,
refund or transfer was submitted. Production and PR #118 were not changed.
This supersedes the earlier inventory/rollout blocker, not the remaining release
implementation and authenticated financial-recovery verification gates.

### Ingress/gateway review and shared money-action throttling

Traced current client -> Vercel assets / direct Supabase API paths and recorded
their protection boundary in capacity-validation.md. Managed routing/CDN/gateway
services do not remove application authorization, atomic capacity controls or
origin-side action budgets. No custom proxy/load balancer or read replica was
added without a measured workload and origin-access design.

The shared Edge action limiter now denies by default on unavailable/malformed
limiter receipts, including payout withdrawal and bank-account actions that
previously inherited fail-open behavior. It validates budget arguments and
normalizes finite bounded retry guidance. Fifty-five focused money/PMS tests
and the Deno type check pass. Test function inventory inspection failed with a
connector transport error, so no deployment/JWT setting was guessed and no
function was replaced. Hosted rollout/outage verification remains internal.

### Policy reconciliation and owner-requested legal review PDF

Reconciled C-035's obsolete email-change question with later owner approvals and
C-041's earlier service-refund wording with the 23 October 24-hour confirmation.
The full combined ESLint run passes. At the owner's renewed request, generated
`output/pdf/WeHouse_Policy_Decisions_For_Legal_Review.pdf`: 14 rendered pages,
65 decision-table records plus C-055 and the latest dated confirmations, current
precedence notes and unresolved legal/commercial questions. Every recorded ID is
checked in extracted PDF text; rendered pages were inspected and the unsupported
currency glyph and orphaned heading were corrected. This is a factual review copy
provided while engineering closure remains open, not published terms or the
post-completion final policy certification. The generator is retained in
`scripts/create-policy-review-pack.py`; local PDF dependencies/previews are ignored.
No missing commission rate, tenancy schedule, late penalty or retention period
was invented. No merge, remote branch update or Production deployment occurred.

### PR #118 merge-gate inspection

GitHub inspection confirms #118 is open against main and its remote head remains
`449d8ccd0435825c7372c7a7ba00d0ce20023a86`; current local engineering changes are
not that reviewed commit. GitHub's mergeable flag only indicates conflict status.
The remote browser job failed on a clipped booking filter at 320px. Running the
same `bookings_layout.py` against the current isolated CI fixture configuration
now passes at 320, 390, 768 and 1440px; no assertion was relaxed.

Fixed four incorrectly nested steps in consolidation-validation.yml that would
prevent the updated workflow from loading. Registered Experience application/
evidence and exact Creator-booking SQL contracts, plus application/session and
sharing/viewing browser suites, in their existing CI jobs. All nine workflow
files parse with valid step shapes. All 876 migration filenames have unique
version identifiers. Docker is not available on this local command path; a fresh
database replay was not run locally. Remote CI on the final reviewed commit,
fresh/upgrade replay and the open product implementation remain necessary.
No merge, Production deployment or remote branch update was performed here.

### Experience activity-specific evidence implemented on Test

Test migrations `20261023135425`, `20261023135647`, `20261023135732`,
`20261023140054` and `20261023140157` add private activity-bound evidence using
the existing reviewed-document client and UI. Requirements live on the canonical
activity application, with their own versions and a snapshot of the actual
activity details. Documents retain immutable upload references and versions;
expiry and newer replacements affect readiness. Identity remains account-level;
neither an unrelated occupation nor another provider account is required.

The host application and elevated independent Creator review now expose their
respective upload/requirements/review controls. Private bucket access checks the
actual activity owner or reviewer, trusted session and current upload context.
Storage metadata must confirm the reserved file before submission. Audited
decisions require a reason, current requirements and any required future expiry.
Readiness is evidence readiness, never publication approval.

Canonical Activity delivers requirements/outcomes to the host and submissions
to independent Creators, with application links. Review resolves prior document
actions; material edits, withdrawal, decline and archive clear obsolete evidence
actions. An explicit no-additional-documents decision needs a recorded basis and
does not create an unnecessary action once evidence is ready.

Verification: rollback-only hosted contract covers unconfigured readiness,
stale requirements, upload retry, missing stored file, independent review,
private-object denial, expiry, changed-context invalidation and Activity routing.
The notification record-boundary defect caught by that contract has a forward
fix. Eighteen application browser journeys cover host uploads and Creator
requirements in both themes alongside existing application behavior. All 694
source tests, TypeScript, focused lint and application build pass. Advisor
notices for these new APIs concern intentional authenticated SECURITY DEFINER
entry points whose authority is checked inside each function; new FK indexes
are present. This does not clear the broader existing advisor inventory.

Activity approval, public media/catalog/publication and checkout remain internal
work. No merge or Production deployment was performed.

### Shared evidence confirmation integrity

The canonical property/Service Worker document client now binds upload reservations
to filename, MIME type, byte count and positive requirements/version identifiers.
Submission confirmation must match the reserved document, offering requirement,
object path, revision, version and metadata. Finish/discard must acknowledge the
requested document and outcome; mismatched confirmation retains the retry key.
Thirteen focused document/credential tests and focused lint pass, including
wrong-document/version/file responses, response loss and discard mismatch.
Browser fixtures now include the actual server revision/version fields. This
repairs the shared evidence foundation; it does not implement Experience evidence.

### Provider application usability follow-through

Experience application fields now form three named sections: activity details,
location/meeting point, and participation/inclusions. Review uses a compact
overview and expandable evidence sections, with session prices before decision
controls. Provider tracing also found that unsaved session edits disabled Back,
preventing the existing discard confirmation from being reached. Back now opens
that confirmation; Keep editing retains session inputs. Activity lists reject
oversized or duplicate receipts. Focused lint and nine receipt checks pass.
This entry records implementation evidence, not approval/publication completion.

### 23 October - exact Creator booking links and submitted session review

Creator Home/Hotel Activity links now request the exact authorized booking before
any list limit is applied. The ordinary list remains bounded. Test migration
`20261023131615` preserves Creator authorization and rejects malformed identifiers;
its rollback-only hosted contract confirms an older Home outside the first 100,
the exact Hotel, a missing record, and revoked Creator access.

Test migration `20261023131954` freezes submitted Experience session changes and
provides a revision-bound, paginated review read for an independent, elevated
Creator. The application review displays dates, capacity and prices without
editing or archive controls. Submission alone no longer produces a false stale
session warning. The hosted application contract passes including submitted
edit/archive rejection, host rejection from review authority, stale revision and
incomplete cursor rejection. Session receipt tests pass, including reviewer RPC
selection and malformed receipt rejection. These are review prerequisites;
approval, publication, public discovery and checkout remain unimplemented.

Verification: nine focused receipt tests, 14 application browser journeys and
10 host-session journeys pass; TypeScript and focused lint pass. Screenshot
inspection found concurrent browser suites overwrote shared generated CSS.
The runner now isolates assets and asserts loaded styles before review screenshots;
all 14 styled application journeys pass again, and both review screenshots were
visually inspected at a 320-pixel viewport. Supabase advisors
still report broader existing security/performance notices, including missing
actor foreign-key indexes on Experience audit tables; no blanket security or
scalability clearance is claimed.

Both migrations are applied to Test only. No Production deployment or merge.

### 23 October - property sharing and one customer viewing journey

Home/Hotel sharing now offers accepted Friends as well as Roommates, passes the
Friend destination through both detail screens and App, and queues the public
reference for the existing encrypted composer. Friend chat renders/removes/sends
the queued property and opens received cards; its former property-open no-op is
removed. A missing send receipt keeps the draft. Service recommendations load the
chosen audience independently, so Roommate lookup failure does not block Friends.
No new relationship, reservation or payment is created by sharing.

The listing's separate Long Let reservation state machine was removed. It now
uses the same lifecycle/timeline as Bookings, including optional viewing, rent
review through booking details, actual arrival manager and payment-protection
gates. Completed viewings advance to rent; pending visits block rent; scheduled
dates appear without inventing a time for date-only records. Both viewing request
entry points check the current lifecycle, and the listing request has a timeout
and synchronous duplicate-click guard. Customer wording uses viewing; property
verification and existing database identifiers remain distinct.

Browser verification exposed a paid-status/no-timestamp defect: the shared
payment-review guard now rejects paid status missing either receipt time or the
required protection reference, rather than offering another payment/viewing.

Evidence: 691 source tests and 47 focused checks passed. Twelve isolated sharing
browser journeys cover Home/Hotel/Service to each relationship in both themes;
ten reservation-panel journeys cover optional/scheduled/completed viewing,
cancelled bookings and unprotected paid state. TypeScript, focused lint and the
application build pass; light/dark viewing screenshots were inspected. These are local fixtures, not
two-device delivery or hosted-role/payment certification. Experiences still lack
the approved public catalog/detail/checkout journey required for a usable shared
Experience link; that remains internal implementation work. No Production change.

### 23 October - Activity conversation and booking destinations

Partner Inbox now refreshes Home conversations when that source changes. Activity
opens loaded, authorized Home and WeHouse conversations as well as Hotel chats;
an unavailable conversation stays in the workspace with a visible retry message.
Unread message text uses the theme foreground in light and dark modes.

Creator/Admin navigation now preserves explicit Hotel and Service booking types
instead of sending every booking ID to Apartments. Service oversight matches the
linked booking through the existing authorized records, excludes unrelated rows,
and supports visible failed/missing-record recovery. Admin Hotel lookup applies
the exact booking ID before the result limit. Booking reads have timeouts and
guards against responses from a closed or superseded view.

Verification: 688 source tests and 23 focused routing/inbox checks passed; six
isolated Service Activity browser scenarios passed, covering success, missing
record and request failure/recovery in both themes. Screenshots inspected.
TypeScript, focused lint and the application build passed. These browser checks
do not establish hosted role access. Inbox caches also clear on account/scope
changes so failed refreshes cannot retain the previous account's conversations.
Creator Hotel/Home detail lookup still searches its bounded RPC result; an exact
authorized lookup outside that page remains internal work. No schema migration,
merge or Production deployment was performed for these changes.

### 23 October - Activity routing and partial refresh integrity

Traced the shared Activity feed, workspace aliases, destination resolver, read
receipts and lifecycle retention. Fixed support-case routing to follow the selected
workspace rather than a person's profile role: Personal help stays Personal even
for a Creator, while operational workspaces keep their internal routing.

Canonical rows and summary counts now reject null/malformed responses. Destination
IDs reject object/array coercion. A failed feed source preserves its last loaded
rows while successful sources refresh; a visible retry message replaces the prior
silent partial result. Incomplete reads do not publish a zero unread count or say
All caught up. A late read receipt cannot navigate an already-unmounted feed.
Reading an event still does not resolve its underlying domain action.

Wording now labels the standalone feed Activity, home/hotel links by destination,
and service links as service records. Screenshots were reviewed in light/dark.
Verification: 686 source tests, 27 focused Activity/preference checks, 13 notification
browser scenarios, TypeScript, focused lint and build pass. The browser cases
include a successful load followed by a failed refresh, preserved unread items,
visible error, and recovery in both themes. No schema or Production change.

This does not certify every producer, recipient grant, exact-record destination,
resolution trigger or background delivery across every role. Those domain checks
remain alongside the existing booking, Experiences, finance and release work.

### 23 October - tenant and guest booking reviews

Long Let eligibility already existed, but the customer interface was guest-only
and relied on the listing page. Added review read/write controls to the customer's
own property booking, reusing listing_reviews rather than a second review table.
Long Let qualifies after paid rent and verified handover/occupancy; Short Let
requires paid verified arrival and an ended stay. A booking-linked review remains
reachable without depending on public listing availability. Owners/hosts cannot
submit a customer's review. No new tenancy waiting period was invented.

Migration 20261023121029 is applied to Test. The exact reservation is authorized
against the signed-in trusted Personal account. Identical retries return the saved
review, conflicting replacements are rejected, and the listing entry point uses
the same write authority. Client success requires matching booking/rating/comment.
Public wording now says Property reviews and Long Let guidance addresses tenants.

The hosted property rollback contract passes guest submission/retry/read and
host denial; Long Let eligibility predicates pass paid-handover and unpaid/unverified
negative cases. This is not a full hosted Long Let tenancy journey. Ten isolated
review browser scenarios pass in light/dark themes. Five focused review tests,
TypeScript, build and focused lint pass. All 683 source tests pass; the initial
legacy endpoint assertion was updated to verify the booking-bound authority.
Security advisor findings remain open (61 no-policy information findings, 19 anon
and 602 authenticated security-definer warnings); no security-clearance claim.

Experience participant reviews remain part of its booking-completion lifecycle:
one verified booking must back a review of the activity, without requiring an
unrelated requested-service job. Prepared sessions are not attendance proof.
Experience reviews, review-specific reporting/moderation and the broader wording
and role checks remain internal work. Production is unchanged.

### 23 October - private Experience session preparation

Dated sessions now live inside the existing activity editor in the Service Worker
workspace. A host can prepare, edit and archive dates, places and a per-participant
price. Timezone and duration come from the saved activity; currency comes from its
enabled country configuration. Integer minor units preserve currency precision.
This adds no provider account, workspace, wallet or commission authority.

Migration 20261023115749 is applied to Test. Trusted host ownership, activity/session
revision checks, shared write throttling, bounded pagination, a draft quota and
idempotent retries are enforced on the server. Each mutation records a session
snapshot. Direct client table access and anonymous access are revoked. Archived
dates cannot be silently reactivated. Application submission/save/archive controls
are blocked while session edits are unsaved; restored sessions remain visible when
the host reopens the activity. A changed activity marks older prepared dates for review.

The hosted rollback contract passes ownership/device isolation, wrong currency,
excess capacity, past dates, stale revisions, save/archive retries and audit count.
Four new receipt/currency tests pass; the full source suite passes 680 tests.
TypeScript, focused lint and build pass. Ten session browser scenarios (including full-editor save/reopen continuity)
and fourteen existing application/review scenarios pass across light/dark themes.
Screenshots were reviewed and the native dark-theme date control corrected.

Security advisors report 61 RLS-without-policy information findings, 19 anonymous
and 600 authenticated security-definer warnings. The two new private tables are
accessed only through guarded commands; these totals are not security clearance.

Prepared sessions remain private. Evidence/media approval, publication, customer
capacity holds, checkout, refunds and settlement are still unfinished internal
Experiences work. Country currency configuration alone does not enable a payment
market. Monthly tenancy and other release gates are unchanged. Production is unchanged.

### 23 October - public offers within a compound or building

Implemented a shared customer panel in signed-in and guest property details.
Customers can choose another published home or room in the same physical site,
filter Short Let/Long Let, and carry their Short Let dates to the selected offer.
Prices use each offer's stored currency. Empty, failure, retry and pagination
states are explicit; malformed receipts do not become successful results.

Test migration 20261023113630 adds a bounded, keyset-paginated public projection.
It excludes unpublished offers, host closures and overlapping reservations,
including whole-home/private-room and mixed-term conflicts. Private addresses,
occupants and host identifiers are not projected. The rollback property contract
passes anonymous access, rental filtering, 90-night limits, partial-date rejection,
unknown-source isolation, cursor continuation and conflict checks.
The reservation transaction remains responsible for final availability.

Verification: 676 source tests pass; production build, TypeScript and focused lint pass; 12 isolated
phone browser scenarios pass across light and dark themes. Screenshots were
reviewed. These fixtures do not prove actual provider payments or full hosted
customer journeys. Security advisors still report 59 no-policy information
findings, 19 anonymous and 597 authenticated security-definer warnings; the new
public projection accounts for one intentional anonymous callable function.
These warnings are not a clean security sign-off.

This is explicit offer selection in property details, not pooled auto-allocation,
search-level grouped cards or a consolidated date-grid calendar. Monthly tenancy,
Experiences checkout and the rest of the release register remain internal work.
Production is unchanged.

### 23 October - shared checkout initialization confirmation

The existing booking payment initializer now fails closed when throttling cannot
be confirmed, bounds database/Auth requests and provider initialization, checks
the provider's returned reference, and requires a matching persisted pending-row
receipt before returning checkout success. A lost or changed pending payment is
not a successful checkout. Responses are no-store; unexpected outcomes instruct
the customer to refresh the same booking rather than imply payment failure.

Thirty-six focused payment/environment/refund checks pass. Test payment-init v5
is deployed with JWT verification retained. Its bundled market resolver remains
NGN-only. This does not add Experience booking support or establish real PSP
end-to-end acceptance; Production remains unchanged.

### 23 October - Creator Experience commission control

Implemented Experience commission inside the existing Creator Booking & money
rules screen and creator_policy_versions authority. No default percentage or new
wallet/settings table is introduced. Read requires a trusted Creator session;
publication also requires policy_publish elevation, a reason, a finite 0?50%
rate with at most two decimal places, and the expected saved version. Retries
return the same published version; conflicting edits require refresh.

Migration 20261023112139 is applied to Test. The extended rollback contract passes
role/device denial, stale version, invalid percentage, explicit zero and retry
checks. Test has no published Experience commission after fixture rollback.
The client rejects malformed receipts and has bounded requests and synchronous
publication locking. Focused tests, lint and TypeScript pass. The isolated Creator money browser run
passes 12 phone/desktop scenarios, including failed-read recovery and authenticated
Experience commission publication. No live rate was set by those fixtures. This is a working
configuration control, not Experience checkout; session/publication/payment and
booking policy snapshots still need their lifecycle integration.

### 23 October - approved 24-hour policy rollout

Owner confirmed a standard 24-hour full-refund deadline across Experiences,
Services, Short Let and Hotels, full refunds when the host cancels, and a
Creator-configurable Experience commission. No numeric Experience rate is assumed.
The lawyer-review PDF is requested after internal implementation is complete.

Test inspection found both accommodation policies still set to 48 hours.
Migration 20261023111612 publishes version 2 at 24 hours for Short Let and Hotel,
retains the retired version 1 values, and does not update any booking snapshot.
The Creator screen's stale 48-hour default is corrected. Ten focused policy tests,
focused lint and the hosted Hotel cancellation/refund/PMS rollback contract pass.
Services deadline enforcement and Experience policy/configuration/checkout still
require integration verification; this rollout does not claim them complete.
Production is unchanged.

### 23 October - hosted contracts and Experience receipt acceptance

Replayed four transaction-rollback contracts on Test: email account security,
email-change/cancellation access, Experience applications, and paid Hotel
cancellation/refund/PMS records. All passed. These fixtures do not prove real
mail delivery, payment-provider transport or vendor acknowledgement delivery.

Experience saves now require the expected revision, editable status and matching
saved details. Submission/withdrawal/archive and review decisions must match the
host, next revision and exact activity details. Three behavior tests cover valid
retries and mismatched receipts. The full source suite passes 670 tests; focused
lint and TypeScript pass. Fourteen isolated Experience browser journeys pass in
light/dark themes and at 320/768/1440px, including creation, submission,
withdrawal, review feedback and failure recovery. These are application journeys,
not paid Experience bookings.

Owner confirmation received: 24-hour standard full-refund deadline, full refund
when the host cancels, and Creator-configurable Experience commission. No numeric
rate is assumed: checkout requires a published policy and snapshots its version.
See the 23 October decision in DECISION_LOG.md. The lawyer-review PDF is deferred
until internal implementation is complete, as requested. Approval and
publication, activity evidence/media, dated sessions and canonical paid booking
remain internal implementation work. This entry does not close them.

### 23 October - account recovery and email-change failure handling

Email code network, per-account resend and daily budgets now fail closed when the
limiter cannot confirm permission. Deployed to Test as email-account-security v3;
Production is unchanged. Hosted probes reject invalid purpose (400) and missing
device bearer (401). No email was sent by these probes.
The email-change return validates pending address/timestamp and the exact saved
address receipt; rejected requests no longer become unhandled promises. Email
settings requests have deadlines and restore their controls after rejection.
Eight focused email-security checks and focused lint pass. Hosted email delivery,
provider callbacks, complete device revocation journeys and concurrent capacity
acceptance remain open. Existing code limits do not establish a supported user count.

### 23 October - market routing and sponsorship recovery

The payment resolver now uses an explicit supported-market registry and accepts an
optional country discriminator. Unsupported pairs are rejected; currency-only
legacy lookups reject ambiguity rather than choosing an arbitrary country. Nigeria
remains the only supported payment market. New country catalog rows do not enable
charging. Persisted market/provider identity, provider adapters and market-specific
charge/refund/settlement acceptance remain expansion requirements. This shared
function edit is local; affected Edge Functions have not been redeployed in this pass.

Sponsored discovery clears old placements when location/type changes, bounds
requests, ignores superseded responses, validates/caps returned placements and
catches failed analytics without counting them as confirmed events. Four new
behavior checks pass; the 34 focused payment/environment/refund checks also pass.
Homes, Hotels and Services now share a visible-placement observer: at least half
the card must remain visible for one second in a foreground document before an
impression is submitted. The old result-array effects were removed. Three further
checks cover short exposure, repeat exposure, background tabs and unmount cleanup.
Missing observer support does not fabricate a view. These are client viewability
checks, not proof of fraud prevention or complete cross-device attribution.
Campaign selection now also receives the selected service category or rental type
before the server limits candidates; unrestricted home search sends no category.
The additional behavior check passes (eight focused Sponsored checks total).
The full source suite passed 664 tests before this final filter connection; the
production build also passed. This is not an end-to-end payment or release approval.
Existing Sponsored targets remain Service Worker profiles, homes and Hotels.
Experience sponsorship is accepted product scope but depends on the unpublished
Experience catalog/session/booking lifecycle; it is not enabled by a UI type change.

Experience discounts and Sponsored placement are independent: a discount changes
the booked price; sponsorship buys clearly labelled exposure to a specific eligible
offering. Both remain optional. Keep one provider workspace, identity, wallet and
support model, with distinct requested-job and dated-activity lifecycles.

### 23 October - currency, optional discounts and rental Team scope

The normal hosting preview now uses NGN; USD remains an explicit separate currency
test. Hosting controls label the saved booking currency and reject missing/invalid
currency receipts instead of silently displaying the global fallback. A viewer's
region does not relabel an existing amount as another currency without conversion.
Test inspection confirms Nigeria/NGN is the only enabled country and all 1,000
catalog fixture homes use NGN. This is Test evidence, not a Production inspection.

Home discounts are explicitly labelled optional. Property Team invitations work
for both Long Let and Short Let: the rollback contract now exercises both paths.
Migration `20261023103020` also requires a trusted active session and active Partner
workspace before creating those invitations; revoked-device denial passes.
The expanded focused browser run passes 24 cases, including both NGN and explicit
USD in both themes and Hotel discount save/remove/read-error/write-error recovery.
Hotel discount reads no longer turn missing or failed data into a confirmed empty
list; writes have deadlines, synchronous locks, scoped receipt/read-back checks,
visible recovery and stale-response protection. Hotel discounts are labelled optional.
TypeScript, focused lint and the authenticated rollback contract pass for this increment.
Existing property/Hotel discount controls do not imply Experiences
discount checkout exists; the Experience session/quote/payment flow remains internal work.

Research: Airbnb supports optional Services/Experiences promotions but excludes
fixed-price service offerings from its discount tools:
https://www.airbnb.com/help/article/3421 . WeHouse's activity promotion design must
preserve original price, funded discount, currency and final amount in the server
quote and booking, apply explicit expiry/stacking rules, and keep existing paid
bookings unchanged. Do not add a cosmetic discount switch before that contract exists.

### 23 October - commercial recovery and grouped operating schedule

Partner price, booking-pause, discount and closed-date controls now bound requests,
reject malformed/wrong-property receipts, ignore superseded reads, release pending
actions on failure, and offer explicit refresh after uncertain writes. Money uses
the property's recorded currency. Discount read failure is visible rather than
being shown as a confirmed zero discount. The shared date picker now uses theme
tokens for button text/borders, month heading, today state and backdrop.

Test migrations `20261023100755` and `20261023101225` require trusted active
sessions for commercial writes, retain Full hosting authority, reject non-finite
price/discount values and past discount expiry, reuse identical discount receipts,
and make repeated exact date closure/reopening safe. Discount removal now rejects
unauthorized callers instead of silently doing nothing. Existing physical-unit
booking conflict triggers remain in force.

Test migration `20261023101747` adds a scoped building schedule, opened inside the
existing compound/building header without a Pro gate. It lists recorded stays and
closures for authorized published offers, keeps Short Let/Long Let distinct and
marks undated tenancies explicitly. It accepts at most 62 days, pages 50 offers,
caps each offer at 100 events with a visible truncation flag, and excludes guest
contact details. An empty schedule is not a bookable-stock guarantee. Shared defaults,
public grouped stock, date-grid visualization and allocation remain separate work.
Forward migration `20261023102520` further limits non-owner schedule access to
currently host-managed listings. Retained responsibility for an earlier stay after
a management handover does not grant the former host this operating overview.

Evidence: the authenticated rollback property contract passes commercial retries,
outsider/revoked-device denial, schedule scope/window bounds, and the existing
submission/publication/booking/cancellation/arrival paths. TypeScript and focused
lint pass. Sixteen commercial-control and schedule browser cases pass at 320px in
both themes; screenshots were inspected and the native month-picker color scheme
was corrected for dark mode. The complete source suite passed 656/656 after adding
the grouped schedule. The first source run's two
failures were repaired: the Field test harness needed the home-style helper, and
the release validator needed the installed Python runtime outside the sandbox.
The final production build completed with exit code 0; Vite still reports the
existing empty `vendor-react` chunk warning. No deployment or merge was performed.

The latest security advisor shows 59 RLS-without-policy notices, 18 anonymous and
594 authenticated security-definer notices. The added authenticated endpoint is
the reviewed trusted-session/per-listing-authority schedule projection; this count
is not a claim that the remaining project-wide security review is complete.

Production is unchanged. These checks do not close grouped public availability,
dated monthly tenancy, Experiences checkout, shared Hotel costs, viewing appointments,
global location IDs, concurrent provider-payment checks or the remaining release gates.

### 23 October - home classification connected through the property journey

Implemented optional structured home type (Apartment / flat, Penthouse, Bungalow,
House, Other home) in submission, persisted drafts, Partner submission details,
Property Operations review, assigned Field Operations inspections, publication,
public cards/details, search and followed-search matching. Studio / self-contained
remains the zero-separate-bedroom choice; Short Let/Long Let remain rental terms.
Existing unclassified records are not guessed or automatically called Penthouses.

Test migrations `20261023094848`, `20261023095137`, and `20261023095641`
snapshot classification from the submitted request, prevent publication overrides,
and reject conflicting classifications on offers sharing a physical root unit.
Field reads retain trusted-session, assignment and scoped staff authority checks.
Search adds an optional home-type parameter without requiring older callers to
provide it. No new marketplace, inventory table or automatic luxury rating exists.

Evidence: TypeScript and focused lint passed. The authenticated rollback SQL
contract passed submission/retry, publication snapshot, matching/nonmatching home
type search, scoped Field/Creator projection, cross-offer booking conflicts,
cancellation release and protected arrival checks. The real Test app at 390px sends
the Penthouse filter to the search RPC without horizontal overflow. This is not a
complete visual audit or simultaneous-booking/provider-payment proof.

Security advisor totals remain 59 RLS-without-policy notices, 18 anonymous and 593
authenticated security-definer notices; these require the existing scoped review,
not a claim that all security work passed. Production remains unchanged.

Next unresolved connected work: reviewed classification correction for existing
units; grouped public availability and calendars; actual viewing appointments;
server-backed global location identifiers; monthly tenancy; Experiences bookings;
shared Hotel costs; payment/reconciliation and full release verification. These
remain internal work in this register, not external dependencies.

### 23 October - rental-space wording and dependent location choices

The compound option now says "Compound or building". The space selector explains
that "Whole home or flat" means the named unit, not the entire compound; a shared
gate/parking area does not imply a private-bedroom listing. "Private bedroom"
requires identifying the bedroom and disclosing shared indoor areas. These choices
describe customer access, separately from Short Let/Long Let pricing.

The copy action is now "Add another unit" (or "Add another bedroom") after details
and pricing, with an explanation of copied fields and separate evidence. The old
top-level "Add a similar unit here" action is removed.

PropertyRegionFields reuses the existing searchable location picker and country
dataset interface. Current property submission explicitly uses the Nigeria catalog;
state changes clear the previous LGA, including linked drafts sharing the site.
Existing saved city/area text is preserved with a correction hint rather than silently
reinterpreted as an LGA. This is UI data-entry consistency, not a new server-side
geographic authority or proof that the catalog is complete/officially current.
Server catalog normalization, additional-market property support and multi-region
capacity/isolation verification remain release work.

Checked: TypeScript and focused lint; 13 existing physical-space browser journeys;
search/select Nasarawa/Lafia, change to Lagos, confirm Lafia is cleared and absent
from Lagos choices; mobile layout in both themes. No production changes.

Reference patterns: Airbnb's space/privacy definitions
https://www.airbnb.com/resources/hosting-homes/a/how-to-select-the-type-of-space-guests-will-have-366
and Booking.com's property/room-type inventory model
https://developers.booking.com/connectivity/docs/room-type-and-rate-plan-management/managing-room-types
support separating property structure, customer access and pricing; these are not
claims that WeHouse duplicates their full onboarding or matches their capacity.

### 23 October - visible home structure and full Test preview

Partner submission now asks Home/Hotel first and presents the home arrangement
before address/pricing: one home, or units/rooms in a compound/building/shared home.
The grouping choice is no longer hidden behind a checkbox. Layout examples include
studio, flat and bungalow; draft tabs show unit labels. Each unit retains separate
let terms and price. The 13 existing physical-space browser journeys passed after
updating their accessible selectors. Public discovery now says Homes consistently
in its category, loading, result count and error copy.

`node scripts/preview-full-app.mjs` starts the real app at `http://127.0.0.1:5180`
and its resizable phone/tablet/desktop frame at `http://127.0.0.1:4179`.
This uses explicit public Test configuration and normal sign-in/workspace authority;
it does not impersonate staff or supply privileged credentials. The earlier component
sample remains separate. Full app navigation is available; signed-in role journeys
are not proven just by opening this preview.

The actual signed-out preview exposed a 401 from `get_all_settings_v2`. Test migration
`20261023090252_public_discovery_settings.sql` adds an explicit ten-key public
presentation allowlist, and the shared discovery hook uses it. Broad settings access
remains denied to anon; no table permissions or booking price authority were widened.
An anon query returned only allowed keys, and actual discovery/settings/Sponsored
requests then returned 200. All observed database requests targeted Test.
The security advisor flags the intentionally public definer projection for review;
its only output is active allowlisted key/value pairs with no caller-controlled input.
The existing project-wide advisor findings remain unresolved by this increment.

This does not close the remaining product implementation or release gates below.

### 23 October - inspectable phone preview and submission sections

The local Property Partner submission now has expandable details/pricing,
photos/description, and on-site access/location sections. Existing draft persistence,
Home/Hotel rules, grouped unit identity and submission validation remain in place.
Completion labels and borders use theme-aware styling. This is progressive disclosure,
not a claim that every remaining property workflow is complete.

Run `node scripts/preview-property-journey.mjs` and open `http://127.0.0.1:4178`.
The phone frame renders actual components with isolated sample-data adapters:
compound inventory, new/existing-compound submission, documents, Hotel cancellation,
and customer Help. Network connections and camera/microphone/location permissions
are blocked in this sample. No live payment, upload or message is sent. The preview
binds to loopback only and is separate from the production bundle.

Checked this increment: TypeScript, focused lint, phone compound navigation, section
expansion with retained input, Help, documents and Hotel submission, and mobile
light/dark overflow. The prior 656-test result is historical, not a rerun for this change.

Read-only inspection of Test confirms `current_actor_can_access_operational_conversation`
requires a trusted active session and canonical workspace authority. Creator can see
queues; Admin is geographically scoped; Staff additionally needs the owning domain;
assigned Field Operations participates within its assignment/scope. Customer message
reads exclude internal notes. Dashboard visibility does not itself grant access.
This inspection does not replace the remaining full role/entry-point verification.

Still internal: grouped public stock/calendar/allocation, dated monthly tenancy,
Experiences booking, shared Hotel costs, and remaining release/role/device checks.
No production deployment or external-only readiness claim was made.

### 23 October - compound management and staff review

Test migrations `20261023022401`, `20261023022725`, `20261023023731`,
`20261023025423` and `20261023030603` extend the existing Partner and review
authorities. Partner stay history uses bounded timestamp/ID pagination and an
exact, permission-scoped booking lookup. Undated historical records remain undated;
their separate pagination token does not invent a business timestamp. The assets
projection carries recorded currency; missing price/currency is unavailable, not zero.

The local Partner list groups loaded homes by verified compound UUID, never by
matching addresses/names. Whole homes/private rooms and mixed Long Let/Short Let
offers retain separate controls. Annual/nightly price wording is explicit; loaded
listing counts do not claim total stock. Grouping adds no page or paid gate.
Copying a similar unit retains its draft price while creating a new physical identity
and requiring fresh evidence. Bedroom counts/layouts are not restricted to two.

Assigned Field visits and publication review receive the same room scope and
shared-area disclosure. Short Let review no longer calls nightly prices annual rent.
A confirmed canonical-role/RLS mismatch in the V2 review projection is repaired:
its authorized parent command still gates trusted sessions, workspace grants and
geographic scope; only its returned request IDs are enriched. Direct table policies
are unchanged. Rollback SQL passes audited access review/assignment, Field denial
after revocation, Creator grant access from a Personal base profile, and revoked
Creator/Partner-only denial. No synthetic accounts or permissions remain committed.

Evidence: 656 source tests, TypeScript, focused lint and build pass. Isolated browser
checks pass 34 Partner asset cases, 12 history cases, 12 Field/review cases and the
83-case wallet/Pro suite. Phone screenshots were inspected in light/dark themes.
These are source/fixture and Test database checks, not Production or PSP acceptance.
Grouped public stock, consolidated calendars/defaults/allocation, simultaneous
booking races and the other internal gates below remain open. UI is not deployed.

Test migration `20261023031726` also repairs arrival authority. Host check-in and
handover require the exact open reservation ID as well as the customer code; a
code for another reservation cannot operate the current unit. The underlying
activation implementations are private. Public Operations commands require a live
trusted Team session; a Host cannot bypass the code through them. Existing payment,
Protection, date, geographic and physical occupancy guards remain active. Host
retries return an already recorded arrival without repeating the transition.
The local screen bounds confirmation time, checks the exact occupied receipt and
recorded arrival timestamp, and ignores late responses after leaving the record.
Malformed/different-booking receipts never show success. Readable text and theme
tokens replace tiny arrival copy. The normal-Auth SQL contract now covers a real
customer checkout, seeded verified provider/payment/ledger/Protection boundary,
exact Host check-in, retry and one arrival-policy snapshot. All fixtures roll back;
this is not actual provider money movement or full Long Let handover acceptance.
The existing arrival-date contract still passes after adding a real trusted Auth
session to its older isolated fixtures. Its historical trigger-disabled setup is
not equivalent to the newer normal-Auth physical-space contract.

### 23 October - Hotel cancellation and PMS follow-through

Test migrations `20261022202819`, `20261022203731`, `20261022204204`,
`20261022212526`, `20261023013801`, `20261023014443`, `20261023015957`
and `20261023020356` repair the previously
confirmed Hotel schema/flow gap. New bookings save the exact cancellation deadline,
property timezone and refundable amount after server pricing. Saved agreements
and stay/rate facts are immutable; historical NULL terms are not replaced with
today's policy. Trusted owner-only preview and locked cancellation share one
eligibility rule. The local paid-stay screen reviews refund, deduction and deadline
before confirmation; ineligible stays lead to review. Failed reads cannot offer
cancellation; uncertain writes read current status before another attempt. Selected
booking detail refreshes and projects refund state from the existing outbox.
Verified ledger completion updates the booking and original receipt; cancelling
alone does not mark the refund complete. The web source is not deployed.

The normal-Auth Hotel SQL contract keeps RLS, constraints and triggers active and
replaces the older trigger-disabled fixture. It covers actual document commands,
quote/booking, immutable terms, preview, cross-customer denial, repeat cancellation,
non-refundable/late refusals, seeded provider-event replay and final receipt.
Provider charge/submission is a fixture boundary, not actual PSP money movement.
Hotel cancellation browser checks pass 36 cases across both themes and
320/768/1440px, including malformed reads, write failure and lost response.

PMS cancellation retains one outbound event, flags a paused connection for review
and supersedes undelivered older confirmation events. Acknowledgement atomically
binds connection, booking status, exact delivered timestamp and event; a stale
confirmation cannot acknowledge a newer cancellation. Browser credentials cannot
invoke the service-only acknowledgement. The API uses actual database event states
and scoped token authentication on every request. The updated Test gateway is deployed;
hosted missing-token smoke returns 401. Requests fail closed at 120/minute per
connection and 30 POSTs/minute with Retry-After; JSON is bounded to 256 KiB and
catalog arrays to 200 records each. Thirteen actual-handler tests and Deno check pass.
The SQL fixture exercises queued cancellation and versioned acknowledgement with
synthetic approvals/certification inside a rollback; no approval/provider is left
enabled. Catalog and room-status changes commit atomically with their event
receipts. Later catalog errors roll back earlier writes; invalid prices cannot
become one-naira offers. Availability cannot exceed recorded stock, explicit unknown
currencies are rejected and assigned physical units cannot be overwritten. Lost
responses cannot overwrite committed receipts or apply the mutation twice.

Still internal: operational delivery/recovery acceptance with a named adapter,
broader booking/payment race and role/device checks, and the
remaining product gates below. Actual PSP/vendor sandbox evidence, named PMS
agreements/certification and legal signoff remain external. This is not an
external-only readiness claim.

**C-064 implementation checkpoint - 22 October:** the private physical-space
registry now identifies compounds/buildings, whole homes and contained private
rooms beneath existing submission, listing and reservation records. Test migrations
20261022184348, 20261022184854, 20261022185202, 20261022185949,
20261022190508, 20261022193321, 20261022194934, 20261022200119 and
20261023021338 are applied. The existing submission form
supports optional grouping, copying similar units/rooms, and reusing saved owned
compounds, units and rooms. Layout is free text; bedroom count is not restricted
to two. No extra marketplace, paid gate or booking/money ledger is introduced.

Trusted owner-only submission, exact-payload retry/recovery receipts, scoped
review/public/booking labels, and physical-unit reservation/host-block guards are
implemented. Browser checks passed for new/saved inventory and failed-read
recovery in both themes at 320/768/1440px (13 cases). Partner property/reservation
failed and malformed reads recover without false empty states (covered in the 34
current Partner asset browser cases).
The existing Partner/Hosting page now projects compound and room labels. A legacy
profile-role requirement on listing ownership now uses the canonical active Partner
workspace, while existing records retain their owner after access revocation.
The rollback SQL contract covers normal Auth submission, owned inventory reads,
real customer checkout conflicts in both whole-home/private-room directions,
independent-home checkout and unpaid customer cancellation release. It seeds
reviewed property/document state; it does not prove the upload/publication UI,
simultaneous booking races or actual PSP money movement. The web source is not deployed.

Public Long Let discovery, direct detail and Sponsored eligibility now respect
active holds on the same physical space under another offer. Actual customer
checkout/cancellation SQL checks pass disappearance/restoration in bounded search
and unavailable/available direct detail, while other homes remain independent.
This remains conservative for undated Long Let; dated tenancy rules are unfinished.

**C-064 still open:** grouped public stock cards/counts and atomic unit allocation,
shared persistent defaults with per-unit overrides, consolidated Partner calendar
and complete inventory counts beyond loaded pages,
reviewed legacy linkage, simultaneous reservation concurrency checks,
and group-targeted Sponsored deduplication. Undated active Long Let conservatively
blocks the same physical home/contained rooms; dated tenancy/monthly rent is
unfinished. Individual Sponsored targets retain their existing exact listing;
promotion must not silently expand to every unit. This is internal work.

**Readiness: NOT READY.** Internal implementation and verification gates remain,
alongside external prerequisites. Passing checkpoint checks below do not close the
whole-product release gates. Evidence is from the dirty working tree on
`reconcile/readiness-baseline-20261012`, based on commit
`89453e2cb9d6287f2c76dc037fbb762682d105cb`; no new commit, merge or Production deployment is claimed.

### Customer payment-to-arrival trace - 22 October

**Trusted private calls and wallet follow-through:** Test migrations
`20261022162707_private_call_session_and_preference_authority.sql` and
`20261022162955_roommate_restore_canonical_wait.sql` are applied. Private calls
now require a live trusted session and canonical Personal/Services capability.
The originating device and answering device own the active call; another trusted
device cannot join or hang up that accepted call. Starting calls locks both
participants in stable order before checking busy state. Answering rechecks the
conversation, blocks and incoming-call preferences. Ringing expires after 45
seconds; accepted calls expire when a bound session dies or a participant has
not refreshed for 120 seconds. Heartbeats write at most once per 30 seconds per
participant. This is foreground web calling, not proven native background calling.
Signals require active device/context authority, have a 64 KiB object limit and
are removed when the call ends; call metadata is retained. Existing indexes are
reused. The rollback SQL contract passes trusted/other-device/outsider access,
preference changes, a block between ringing and answer, busy/retry, revocation,
signal cleanup and direct-write denial. It does not prove a simultaneous
multi-connection race or real two-device TURN/media connectivity.

The call controller now mounts after sign-in and remounts on identity change.
Late microphone/camera permission and camera-switch results stop unused tracks;
hangup stops local media immediately, and a delayed poll cannot reopen that call.
Signal subscription cleanup and failed signal receipts are handled. Incoming
calls use theme text; the immersive media view deliberately uses a dark surface.
Audio output selection appears only when the browser offers actual selection;
the misleading Speaker/Earpiece toggle is removed. Privacy eligibility uses the
canonical workspace receipt instead of legacy profile roles. A broken Roommate
restore trigger referenced a removed companion function; the forward repair
preserves the existing 30-day wait using the canonical Friend helper.

Finance summary failures now show recovery rather than invented zero totals;
loaded queue counts explicitly disclose the per-record-type 100-row limit and
include financial actions. Worker and Partner wallets share balance validation,
preserve recorded signed balances and label current balances as NGN independently
of viewer locale. Malformed balances cannot enable withdrawals. Isolated browser
checks passed eight summary cases and eight wallet error/recovery cases across
light/dark and narrow/wide screens. Full automated suite: 633 passed; focused
lint and TypeScript passed. Full browser rerun passed 81 cases; build passed. These
source UI changes are not deployed. Remaining implementation gates below remain
open; this checkpoint is not an external-only readiness claim.
Twelve additional isolated call browser cases pass incoming dismissal and
microphone-denial recovery at 320/768/1440 pixels in both themes. Screenshot
review corrected dark media warning contrast in light mode and removed an
ineffective reconnect action. These are UI/error-state proofs, not real media
transport or background-call acceptance.

Service Pro, Partner Pro and Sponsored web checkout now use the shared exact
minor-unit and enabled-market contract. Missing/unsupported currency, sub-minor
prices and unsafe integer amounts fail before provider initialization. Service
Pro also requires an explicit matching provider plan currency and integer price;
it no longer rounds a provider plan into a match. These checkout paths use
fail-closed payment throttling; both Pro provider calls have 12-second deadlines.
Actual-handler tests and Deno checks passed. These Edge changes are local, not
deployed or proven against live provider records. Plan sync now validates exact
prices/provider amounts, bounds provider calls, rejects Test/live environment
mismatches, throttles failures closed and requires a positive saved receipt.
Test migrations `20261022172946_creator_pro_settings_canonical_authority.sql`
and `20261022173447_seed_missing_service_pro_controls.sql` align both Pro setting
families with trusted canonical Creator grants and restore fifteen missing
Service Pro configuration rows without overwriting existing values or enabling
sales. Normal-Auth rollback checks pass canonical Creator access despite a
Personal compatibility role, sub-minor price rejection and revoked-device denial.
Remaining native and withdrawal paths need the same whole-lifecycle review;
real Pro billing, legal activation and hosted provider acceptance remain open.

**Provider lookup and scheduling follow-through:** Test migrations
`20261022151242_provider_refund_lookup_authority.sql` and
`20261022152123_financial_processor_scheduler_and_reconciliation.sql` are applied.
Later migration `20261022172331_serialize_financial_actions_by_payment.sql`
closes a same-batch claim race: only the oldest due action for each protected
payment may be claimed, with both action/payment locks and competing unresolved
effects excluded. The expanded rollback contract proves one action per payment
per batch, the second action remains unattempted, and a subsequent worker is
blocked. Independent simultaneous-connection/load proof remains open.
Processor v4 and interactive reconciliation v3 are now deployed on Test.
Both verify the original successful provider charge, NGN currency, test/live
environment and a safe original amount covering the refund. The processor's
new-action batch is reduced to three so original-charge verification fits its
bounded provider time budget alongside two refund lookups. Mismatched original
charges never reach refund POST. Expanded handler tests and Deno checks pass.
Signed webhooks and authenticated provider API lookups retain distinct proof
timestamps/methods and use one private canonical refund routine. One provider
refund ID cannot satisfy two actions. The bounded processor checks two leased
known refunds per run; failed lookups preserve financial state and defer retry.
The existing Finance view now verifies a bound refund ID, or an entered provider
ID, against the original transaction, amount, currency and environment. It does
not initiate another refund or accept a manual settled flag. Expensive lookups
use fail-closed throttling. Nine actual-component browser cases passed, including
unknown ID entry, missing receipts, lost responses, themes and device widths.

Test Edge versions were initially processor v3 and reconciliation v2; v4/v3 above
supersede them. The former v2 processor was preserved in ignored Test artifacts before
replacement. Hosted unauthenticated calls returned 401. Six disposable real Auth
accounts proved Creator and in-scope Finance read access, denial of ordinary/
orphan/out-of-branch accounts, and device revocation while Auth still recognised
the token. The authorized Edge path reports missing Paystack configuration (503);
unauthorized roles receive 403. All six accounts, their sessions and the fake
financial action were removed; the private credential/token file was deleted.
Artifacts: `test-results/hosted-finance-reconciliation.json` and
`test-results/hosted-finance-revoked.json`. These are hosted authority proofs,
not a real PSP refund test. Full automated suite: 623 passed; build, focused lint,
Edge checks and expanded rollback SQL passed. The funded refund fixture proves
one ledger transaction and no second financial effect on lookup replay.

The minutely Test scheduler exists but makes no request without Vault configuration.
`financial_processor_project_url` must identify the same Test project;
`financial_processor_worker_secret` must match Edge `WEHOUSE_CRON_SECRET`.
Those entries are absent. CLI configuration is blocked by missing Supabase CLI
authentication; Paystack configuration is also absent on the authorized Test path.
Do not count either as operational dispatch or provider settlement evidence.
Production is unchanged. Representative money throughput, real PSP acceptance,
fresh/upgrade replay and remaining product flows still require internal verification
when their necessary environment/provider access is available.

Financial recovery follow-through: Test migration
`20261022144813_financial_action_recovery_visibility.sql` adds a service-only,
100-row bounded, lock-safe recovery sweep. Claims still processing after 15
minutes move to manual review with an audit marker; they are never automatically
resubmitted. Refunds in manual review now block another refund action against
the same protected payment. The existing scoped Finance queue includes open
financial actions and prioritises interrupted/attention records. The existing
Payouts & refunds view exposes action/provider references, current processing
state and errors, with refresh and readable controls; it does not provide a
false manual-settled button. The processor invokes recovery before claiming work
and reports an unsuccessful batch if an action remains unresolved. The expanded
normal-Auth Test rollback contract passed recovery/retry, fresh-claim preservation,
uncertain-refund blocking, service-only execution and geographic/revoked-session
visibility. Full automated suite: 617 passed.
Six focused actual-component browser cases passed light/dark at 320/768/1440
pixels, including references, warning, refresh and no horizontal overflow. Visual
inspection led to full-width action details instead of a cramped phone column.
Removed/hidden toast exit elements no longer intercept underlying controls.
This earlier checkpoint left provider GET reconciliation and scheduler/Edge
implementation open; the later follow-through above supersedes those statuses.
Operational dispatch configuration and full provider acceptance remain open.
Follow-up Test migrations `20261022150329_late_refund_receipt_recovery.sql` and
`20261022150511_refund_submission_receipt_race.sql` close the late-webhook race:
verified events may recover uniquely matched attempted processing/manual-review
refunds, with provider ID and signature-verification timestamp required.
Ambiguous matches stay unresolved. Matching submission responses reuse receipts
already bound by a webhook; different IDs cannot replace them. The expanded SQL
contract passed ambiguity, late-event recovery, replay, missing proof and late
submission acknowledgement; four processor recovery tests pass. A completed
provider receipt is not downgraded to pending. Hotel refund copy now says
provider processed and explains possible bank posting delay. The broader isolated
wallet/Pro browser suite passed 81 cases after the toast interaction correction;
the production build passed. Final automated suite: 618 passed. These are not hosted real-provider settlement tests.

Payment-market follow-through: main checkout and explicit provider verification
now share `_shared/payment-market.ts`. Missing/unsupported currency is rejected
instead of silently treated as NGN; exact decimal-to-minor-unit conversion rejects
sub-minor-unit amounts and unsafe integers instead of rounding the obligation.
Verification and the signed charge webhook now fetch and check the booking
payment's stored currency, with safe-integer provider amounts and exact equality.
Only NG/NGN/Paystack is enabled. The conversion primitive supports zero/two/three
decimal precision, but does not enable other currencies. Extending the registry
alone is insufficient: provider adapter, originating booking currency/country,
ledger, refund, dispute, payout, legal gate and native billing acceptance remain
required. Other payment endpoints still need migration to this shared contract.
Evidence: 616 full-suite tests passed after the shared contract changes; an
additional actual-handler rejection test passed for missing/unsupported currency,
sub-minor precision and unsafe amount. Checkout, verification and webhook Deno
type checks pass. These Edge changes are local and are not deployed.
The subsequent financial recovery trace confirmed `claim_financial_actions`
leaves interrupted rows in `processing` without an inspected stale-claim recovery
path; no direct Finance outbox worklist was found in active source. Manual review
must preserve uncertain refunds without automatic resubmission. Recovery, scoped
Finance visibility/resolution and scheduler/deployment proof remain internal work.

Call/settings and analytics follow-through: audio/video preference APIs existed
without a settings consumer. Personal and Service Worker Privacy now expose
incoming audio/video controls using existing server preferences, loading/error
recovery, bounded writes, duplicate-save protection and matching save receipts.
They are account preferences, not OS media permission switches. Existing call
controls include mute, camera off, camera switch and output switching where the
device supports it; two-device/TURN, revoked-session and full settings enforcement
acceptance remain open. Creator Analytics now uses theme surfaces and readable
accent/type colours instead of a hard-coded dark header; failed/timed-out reports
show an error and retry instead of a fabricated zero report. Whole-dashboard
visual/device acceptance remains open. Main Paystack charge/verification is
explicitly NGN-only; this is a Nigeria launch boundary, not global currency support.
Experiences remain activity application/review in Services, with public search,
session booking and exact-activity promotion still unimplemented.

Sponsored/PMS follow-through: current Test discovery uses market/category matching
and a daily hash order, not a proven fair-delivery scheduler. Fixed-duration
pricing is the selected market's daily NGN price times days, attached to one
property, hotel or Service profile; individual Experiences are not supported
targets. Client quotes and drafts now reject invalid prices or mismatched
resources/durations. Web checkout additionally requires the displayed amount and
rejects a changed server amount before provider initialization. Provider checkout
has a 12-second deadline. Native-store prices remain store-controlled. The
Sponsored panel uses readable type, theme-specific accent contrast and existing
reduced-motion-aware control transitions. These are local changes, not visual
acceptance of the entire platform.

**Earlier finding, repaired by the 23 October checkpoint above:** Test inspection confirmed `cancel_my_hotel_booking` had reverted to unpaid-only
despite older paid-cancellation migrations. **Further positive-path inspection
found Test has no `hotel_bookings.cancellation_snapshot` column**, while the
restored RPC reads it. Thus restoring the RPC alone did not restore the paid
flow. Current booking-list projection also has no refund queue projection, and
the separate Hotel refund projection trigger is absent. These are internal
schema/flow repair gates, not missing provider credentials. The older contract
constructs fixtures with triggers disabled and no trusted Auth sessions; it is
not acceptance proof. A normal-Auth replacement candidate reached this concrete
schema gap after configuring and reviewing Hotel documents through the actual
commands, with all attempted fixture transactions rolled back. The candidate is
preserved in ignored `test-results/hotel-paid-cancellation-normal-auth-candidate.sql`
for completion; the existing contract is retained. Assisted paid cancellation
remains in place. No new Hotel schema change or customer cancellation enablement
was made by this investigation. The following earlier restore result is partial:

Earlier inspection confirmed the RPC had reverted to unpaid-only
despite older paid-cancellation migrations. Forward migration
`20261022141407_restore_hotel_paid_cancellation_authority.sql` restores the saved
deadline/payment-protection/refund-outbox contract with trusted-session checks.
The revoked-session SQL check passes; positive paid cancellation, ledger/provider
refund and customer preview acceptance still remain. The customer paid-stay
button remains assisted until that acceptance is complete.

The local PMS feed now includes cancelled/refunded paid reservations and preserves
actual payment status; refunded bookings can be acknowledged. Default pagination
no longer collapses to one row when limit is omitted. Targeted combined booking,
sponsorship and PMS tests pass (34). Real connector delivery, version-specific
acknowledgement, overdue-delivery alerts and API load/security acceptance remain
open. No Edge deployment or Production change is claimed.

Traced listing review, reservation fee, stay/rent checkout, optional Long Let
inspection, private arrival instructions, move-in scheduling, host/WeHouse
responsibility, cancellation and refund messaging. Found contradictory tests:
one described a single Short Let stay payment while the actual Test server and
fee-first contract require Reserve date payment followed by stay/caution payment.
The shared journey now follows that actual two-stage contract. A shared price
summary and listing review disclose the combined saved cost before payment;
missing prices or inconsistent saved cancellation deadlines pause checkout.
The cancellation reader and server now honour either saved deadline key and
reject conflicting values instead of disclosing one deadline and enforcing another.

Test migrations `20261022124409_booking_arrival_payment_authority.sql`,
`20261022124908_booking_access_and_move_in_delivery.sql` and
`20261022131628_short_let_cancellation_snapshot_parity.sql` are applied.
Arrival instructions and move-in scheduling reuse the existing provider/ledger/
shared-payment authorization; reservation fees or paid labels alone cannot grant
access. Move-in retries preserve one request for the same valid time. Legacy
profile-role notification fanout was removed from that command; scoped Team
Activity remains on the existing trigger and an active responsible host receives
Hosting notification. Paid-cancellation retries retain the original queued refund
amount. Customer inspection requests require the pre-rent inspection stage.
The rollback SQL check passed for canonical wiring, negative access and saved
deadline parity; it does not prove a paid booking through physical handover.

Customer actions now use a synchronous command guard, bounded requests, checked
cancellation/inspection/move-in receipts and recovery after uncertain results.
Arrival-report failures retain the description and release controls. Arrival
instructions show loading, unavailable and retry states. Paid Hotel cancellation
was wired to an unpaid-only endpoint: its button now requests WeHouse assistance;
**this earlier gap is repaired on Test and in local source by the 23 October checkpoint above**. Short Let
copy no longer promises every separate payment will automatically be refunded.

Service Worker shared status presentation no longer invents a requested/confirmed
job from an unknown server value; it shows unavailable status without a job action.
Service job commands now require an active trusted session across nine request,
acceptance, work, completion, dispute and cancellation/refund-review commands.
Cancellation uses current workspace grants and actual participation instead of
legacy profile roles. Completion retries reuse the existing release receipt.
Test migrations `20261022133736_service_job_command_session_authority.sql` and
`20261022134843_service_completion_receipt_projection.sql` are applied. The
participant getter exposes the completion acknowledgement and matches payment
protection to its payer, payee and booking. Eligible releases show processing;
risk-held or unmatched money shows review. Chat prevents duplicate job commands,
checks positive receipts and preserves decimal quotes. Completion confirmation
does not claim the provider has already received money. The Test SQL contract
passed nine denied-session commands and release-state projection checks.
Positive hosted whole-job settlement remains unverified.
The broader Service Worker route/role/payment/safety/earnings audit remains open.
The customer journey explanation is in `LIFECYCLES.md`. Shared 2D control motion
is used for progress updates; whole-app visual/device/role acceptance and meaningful
3D feature assessment remain in the existing quality gate. Production is unchanged.

Checkpoint evidence: 608 automated tests and the production build passed after
the booking and service changes. Three additional processor recovery tests pass.
The existing financial processor now bounds its sequential claim batch to five,
uses a 12-second refund request deadline, rejects invalid/sub-kobo amounts and
requires a provider ID before recording submission. Missing internal-release
completion receipts go to manual review. These Edge changes are local, not
deployed. Stale processing claim recovery, Finance review resolution, scheduler
evidence and hosted provider reconciliation remain internal acceptance gates.

### Inspection submission, independent review and Finance recovery - 22 October

Test migration `20261022105825_assigned_field_case_participation.sql` allows the
explicitly assigned, active, in-scope Field Operations Staff member to read and
reply to a property case. Property Operations keeps primary ownership and case
decisions. Same-branch unassigned colleagues, out-of-scope assignees and revoked
grants do not gain this access. The rollback SQL contract passed on Test; the
actual conversation component passed six isolated browser cases (light/dark at
320/768/1440 pixels), including correct reply attribution and no primary-owner
controls for the field participant. These are not hosted multi-account checks.

Inspection client recovery now retains confirmed upload paths across retries,
does not delete potentially accepted evidence after an uncertain response,
requires positive boolean save receipts, bounds database writes, prevents
concurrent submissions and rejects blank location coordinates. The evidence
retry regression and focused lint pass. Upload reuse is limited to this open
inspection session; durable reload recovery and hosted submission verification
remain open.

Server enforcement now checks trusted sessions, current base Staff and Field
Operations coverage, exact assignment and separation from the property owner.
Only uploaded evidence linked to the same inspection is accepted. Submissions
follow start/complete/correction/review transitions; exact retries do not replace
a submitted report, reset an accepted review or repeat correction notifications.
Property Operations review uses its own current coverage and cannot self-review.
Customer inspection completion was broken by a missing `completed_at` column;
the column and getter are repaired. The same getter now returns correction
instructions and the submitted report. The Staff screen shows those instructions,
retains the report for corrections, uses readable theme tokens and applies the
four-photo requirement only to property submissions.

Applied Test migrations: `20261022112602_inspection_command_authority.sql`,
`20261022112933_inspection_review_and_completion.sql`,
`20261022113056_inspection_review_feedback.sql`, and
`20261022114324_finance_action_receipts.sql`, followed by
`20261022121327_inspection_current_access_and_additive_roles.sql`.
Current access approval is rechecked for every field write, including old
assignments. Explicit Staff/Field Operations grants remain usable alongside
Admin/Creator access; seniority alone cannot submit inspection evidence, and a
Creator who is the inspector still cannot approve their own work.
Inspection and Finance SQL contracts
passed with actual authenticated/service roles and normal triggers; fixtures were
rolled back. Both contracts are included in migration CI; a fresh CI replay has
not been performed here.

Finance queue responses now identify the canonical active Team role and require
a trusted session. The screen no longer reads legacy profile roles to decide
Creator confirmation. New payout references use lowercase; existing transfer
references are preserved. Local payout function repairs bound provider requests
to 12 seconds, reject unknown balances/mismatched reference/amount/currency,
avoid a second transfer POST after a concurrent claim, require a database receipt
before settlement, and never release held funds based solely on an HTTP error.
The operator screen requires action-specific status receipts and refreshes
authoritative records after uncertain outcomes. Provider reference/reconciliation
basis: [Paystack Single Transfers](https://paystack.com/docs/transfers/single-transfers/).
**The payout Edge Function repair remains local, not deployed:** retrieved Test
function version 3 predates these changes. Function deployment/parity and actual
provider reconciliation remain internal gates. Recovery for a transfer that the
provider cannot find must retain held funds until its disposition is established;
no manual unverified credit or new reference was introduced.

Working-tree verification: **600 tests passed**, production build, Deno payout
type-check and focused lint passed; **12 inspection** and **79 wallet/Pro**
isolated browser cases passed. These do not prove hosted multi-account/payment
journeys. Security advisors still report 58 informational no-policy tables and
17 anonymous / 585 authenticated callable security-definer warnings; this is not
a whole-database security clearance. Production is unchanged.

### Staff dashboard authority - 22 October

Staff dashboard selection now reads active, unrevoked `workspace_role_assignments`,
the same grant model used for conversation access. A work-area grant without an
active base Staff grant does not open a dashboard. Reads are bounded, malformed
responses show recovery, and the existing hook rejects old-account/old-refresh
results. The existing Team management mutation continues to control assignment;
no additional role or permission table was added.

Removed six unused permission helpers and their exports, including the legacy
profile-role staff listing and its per-person permission queries. The older
`staff_permissions` table is retained while compatibility consumers remain; this
does not claim all database permission readers have been retired.

Verification: the full suite passes 589/589, including canonical-grant dashboard
selection, orphaned operation denial, malformed receipt recovery and stale-request
rejection. The Test routing contract also runs actual authenticated-role reads:
matching staff can read their own base/operational grants through RLS and cannot
read another person's grants. Earlier role/branch case checks remain passing.
Full rendered acceptance for every Staff/Admin/Creator dashboard remains open.

Self-appointment denial was verified through actual authenticated-role calls:
ordinary users cannot insert their own Staff grant, call the operation-assignment
RPC to promote themselves, or use the Creator Team endpoint to become Field
Operations Staff. Existing Staff cannot change their own department. Field
Operations is a Staff work area, not a public provider/account category.

The Field Operations inspection list now bounds reads, rejects malformed data,
discards old-account responses, and shows an error with Retry on failure rather
than claiming there are no assignments. A component behavior check distinguishes
a failed read from a successfully confirmed empty list. Inspection evidence upload
and status-response recovery remain under review; this does not close that journey.

Runtime inventory found no PHP application files or Composer configuration. No
particular PHP CVE was supplied, so no vulnerability-specific clearance is claimed.
Removed an unreferenced root sample Dockerfile that installed and ran `fortune`
instead of WeHouse. The independently configured dev-container file was preserved.

### Case ownership, dashboard routing and request volume - 21 October

Real Test case-opening checks exposed three defects beyond the isolated browser
fixtures: the schema-only baseline omitted required case-reason rows; generic
conversation uniqueness blocked different issues about one account; and the Inbox
used a shared transport channel instead of the operational case's owning domain.
Test migrations `20261021185537`, `20261021185849` and `20261021190009` correct
those boundaries. No new case table or competing support workspace was created.
The generic enquiry index excludes records already governed by the existing unique
operational-case ID. Eleven required reason definitions are migration-owned.

| Work area | Responsibility and dashboard destination |
| --- | --- |
| General Support | App help and account-access requests in its Messages queue |
| Property Operations | Property submissions, stays and arrival issues; property/booking work and Messages |
| Field Operations | Assigned inspections and field evidence; specialist tasks rather than a second property Help front door |
| Service Worker Operations | Professional-profile review and service-job cases; review work and Messages |
| Finance Operations | Standalone payment/refund and withdrawal cases; finance records and Messages |
| Security Operations | Account-security and safety cases; investigation, notes and escalation, without staff sanction authority |
| Admin / Creator | Scoped / global oversight respectively; assignment and audited decisions through existing work areas |

Customer wording remains “Message WeHouse.” A shared message transport does not
make every case General Support. Booking-linked payment questions retain their
journey context; this catalog does not grant Finance unilateral property/service
decisions or bypass payment/refund authority.

`supabase/tests/case_routing_catalog_contract.sql` passes against Test with normal
triggers and rollback-only fixtures: six actual first-send paths, same-draft retry,
the owning queue, exclusion from General Support, matching-branch staff read/claim/
reply, cross-domain queue denial, other-branch Finance denial and unrelated-target
rejection. Consolidation CI now includes this contract and the private reply
contract. Older support SQL fixtures now include Auth sessions and trusted devices;
the full fresh-database CI replay remains unverified locally without Docker.

Request-volume correction: customer WeHouse Inbox refresh now uses the existing
coalescing scheduler instead of independent 15-second polling and event reads.
Tests cover a burst of 100 events producing one read, one follow-up during a slow
read, hidden-tab deferral and stale-workspace rejection. This is not a load-test
capacity claim. The metadata audit found no structurally equivalent duplicate
indexes across public tables; duplicate records, overlapping tables, bounded
operational pagination and hosted load/recovery checks remain separate work.

Brand review: inspected `Downloads/wehouse-brand-v4-complete (22).zip`, its preview
and usage guide. It contains outlined SVG lockups, monochrome/theme variants,
micro marks and rendered app icons. SVG inspection found no embedded raster art,
live text, scripts or external references. This was an asset review; application
branding and native icon sets have not been replaced.

### Operational support delivery and confirmed replies - 21 October

Found and corrected: Finance, Security and Service Worker Operations had Activity
surfaces without their server-supported domain message queues. All operational
work areas now open the shared Messages surface with their own queue, retaining
the common Activity entry. Creator and Admin can explicitly claim unassigned
cases; the composer follows actual assignment, including for a solo Creator.
Claim receipts must confirm success before local ownership changes.

Test migrations `20261021140215` and `20261021140315` add a sender-bound reply
intent in the existing message table and enforce active trusted-device authority
through the central conversation access function. Exact retries return the same
message receipt; changed payloads under the same intent are rejected. Existing
assignment, scope, lifecycle and private-note checks remain authoritative.
Customer and operational composers share reply upload/retry handling: a missing
receipt preserves the composer and already-uploaded evidence instead of deleting
attachments that may belong to a committed message. Pending reply intents are
currently retained in memory, not a durable reload outbox.

Verification: rollback-only Test SQL covers exact retry, one stored message,
payload mismatch, unrelated-person denial, requester private-note denial,
Creator claim-before-reply, operational/public note separation and revoked-device
bundle/send denial (`supabase/tests/support_reply_receipt_contract.sql`). The
automated suite passes 585/585 and the production build passes. The build initially
hit sandbox path access and was rerun with approval. Focused support lint passes.
Security advisors report 58 RLS-without-policy informational findings, 17 anonymous
and 585 authenticated SECURITY DEFINER findings; the one additional authenticated
RPC is deliberate and anonymous execution is revoked. These counts are not a clean
security audit. Production remains untouched. Twenty-four isolated Help-to-Inbox browser
journeys pass across Personal, Service Worker, Property Partner and Hotel Team at
390, 768 and 1440 pixels in both light and dark themes, including lost reply receipt, preserved input, exact-intent
retry without duplication, Back during first send, saved-thread reopening and
failed Inbox recovery. Fixtures run under an intercepted secure origin; they do
not prove real-account hosted transport or all operational role journeys.

Test migration `20261021183712` replaces legacy read-receipt authorization with
the central conversation permission check. Requester reads cannot consume private
note receipts; the team bundle includes note read state so note-only updates are
acknowledged. Rollback checks cover unrelated and revoked-session receipt denial.
The existing read flag is shared by readers; individual team-member read receipts
remain a separate unfinished contract. Light-mode sender label contrast was
corrected after screenshot inspection, and chat scrolling respects reduced motion.

Test migration `20261021184300` also fixes a privacy defect in the legacy
customer conversation projection: internal notes no longer contribute previews,
last-message ordering, unread counts or conversation existence. Both that read
and the operational Inbox now require a trusted active session. Rollback checks
deliberately make a private note newest and verify it cannot appear in the customer
preview, unread count or message API; revoked-session Inbox reads are rejected.

Test migration `20261021184531` closes the direct-table version of note privacy:
the SELECT policy uses canonical conversation access and requester/team
relationship, not a legacy profile role. An owning requester with a legacy Creator
label still cannot see private notes. Rollback checks switch to the actual
`authenticated` database role to verify that denial and authorized team visibility.
Anonymous message-table privileges are removed; authenticated clients retain only
RLS-filtered SELECT, with writes confined to the existing controlled RPCs.

Security Operations signal and note/claim/escalate/resolve controls now also
require matching server receipts before showing success or clearing a written
note. Requests are bounded and synchronous duplicate clicks are blocked. Their
full browser and role/scope checks remain open.

Open in this audit: complete role/geography browser checks, queue/message
pagination, individual team-member read receipts, durable retry across reload,
Security Operations role/scope acceptance, and full Creator/Admin/Staff dashboard and
table inventory. Property Team invitations were traced to resource-scoped access
and recipient acceptance; this does not establish completion of every invitation
or property journey. Full marketplace Experiences booking remains unimplemented.

### Connected provider workspace and application decisions - 21 October

Root causes: service-review flags controlled unrelated workspace tools; applicants
could submit Experiences but their Inbox exposed only support; decisions had no
canonical delivery; exact-record reads needed a boundary against unsent revisions.
Test migrations `20261021130610`, `20261021130921`, `20261021131200` and
`20261021132750` now provide:

- One account-bound, trusted-session capability receipt. Services management is
  separate from public discovery. Existing jobs remain a management capability even
  when service review is not current; common Inbox, Experiences and earnings do not
  require an unrelated service occupation or service approval. Jobs remains the
  operational home; applicants retain Setup. No extra Overview product was added.
- Submissions reach independent active Creators in canonical Activity. Submission
  acknowledgements and decisions reach the host in the same Service Worker Inbox.
  Withdrawal, resubmission, archive and review decisions resolve superseded actions.
  Unique revision events preserve retry idempotency; no second notification table.
- Targeted application links with owner/fresh Creator checks, explicit retry,
  current-state review controls and retained history. Unsubmitted or newly edited
  draft revisions are private, including after a previous submission. Reviewer
  history reads follow the same privacy boundary.
- Identity gating around relevant jobs/showcase/earnings screens, with feedback,
  support, application drafts and account entry remaining reachable. This does not
  weaken any server identity, job, evidence or payout requirement.

Verification so far: 20 rollback-only Test SQL assertions pass for application
lifecycle, duplicate submission, canonical audience delivery/resolution, private
drafts, owning/unrelated users, initial common capabilities and revoked devices.
No fixtures persist. Direct synthetic service-approval attempts were correctly
rejected by self-review and current-credential guards; those guards were preserved.
The durable checks are in `supabase/tests/experience_application_contract.sql`;
record and review-queue category names both come from the canonical intake catalog.
The existing Worker credential SQL contract also passes with added authenticated
capability assertions: an independently reviewed provider retains service management,
and after credential expiry new work is blocked while the existing job remains
manageable. These fixtures are rolled back; this is not a real-person hosted journey.
Full source suite passes 583/583 after resolving the receipt test-loader dependency,
current Service Worker wording and onboarding expectations, and making the installed
Python interpreter available to the release contract check. Production build and
focused lint pass. Fourteen isolated browser scenarios pass: activity creation,
save/submission/withdrawal at 320/768/1440 px in both themes, category/link/save-receipt
recovery, Creator correction/confirmed decline, reopening decided records without
enabled decision controls, and failed-decision retry retaining feedback. Both narrow
host and Creator screenshots were inspected. Corrected stable accessible names for
category and feedback fields after these checks exposed label ambiguity. Incremental
TypeScript compilation passes. Browser data and Creator elevation are isolated
fixtures; authenticated server assertions are recorded separately above.
Advisors: 58 command-only RLS-without-policy INFO findings, 17 anonymous and 584
authenticated security-definer execution warnings. The two additional authenticated
RPCs have explicit trusted-session authorization; broader exposure review remains open.

Only Test was migrated; no web/native deployment or Production change. Activity
delivery is implemented in the canonical database pipeline, not proven as phone push
delivery. This closes specific internal onboarding/delivery gaps, not Experiences
sales. Required next dependencies remain offering-specific evidence and approval,
media, dated sessions, capacity, canonical payment/refund/settlement and customer
journeys, alongside the other product release work in this register.

### Canonical Experience categories and application recovery - 21 October

Migration `20261021084716_experience_category_catalog.sql` is applied to Test only.
One country-scoped catalog now drives the application selector and server submission
validation: Culture and local tours, Food and cooking, Creative and practical
workshops, and Outdoor activities. The initial application market is Nigeria;
examples are guidance, not bookable inventory. Shows, parties and nightlife remain
excluded. Categories require configuration before another market accepts applications.
The catalog has RLS enabled, no direct anon/authenticated table reads and a gated
workspace RPC. Local migration version matches the recorded Test version.

Read-only Test inspection confirms identity checks are keyed by person/profile and
activities reference that same profile; the save command derives ownership from
the authenticated actor rather than accepting a supplied host ID. This is account
binding, not proof of live NIN verification or approval of another instructor.

Category failures no longer hide saved applications or claim that the country has
no categories. They expose a separate retry. Creator review uses readable application
field labels and confirmation before decline. Experiences remains inside the existing
Service Worker workspace. There is no separate account, wallet or provider dashboard.

Security advisor counts: 58 RLS-without-policy informational findings, 17 anonymous
and 582 authenticated security-definer execution warnings. The added catalog is
command-only; its gated authenticated RPC accounts for the additional execution
warning. These counts do not close the broader function-exposure review. No public
Experience approval, sales, sessions, booking or payment capability is implied by
this application catalog. No Production or frontend deployment was performed.

Verification: production build passes for the category integration; subsequent
Creator review wording/confirmation and application recovery changes pass focused
lint and incremental TypeScript compilation. No automated suite, signed-in role
journey, live payment or browser visual checks were run in this checkpoint.

### Experiences private applications - 21 October

Unified-onboarding follow-through: the existing Friends/Experiences contract now
defines one account -> offering choice -> shared provider details -> relevant
offering fields -> requirements/review -> payout/terms -> publication journey.
The shared `ProviderOfferingEntry` is separate from service-readiness feedback;
service review wording no longer implies that an Experience has been approved.
Professional background is distinguished from the Experiences product in the
service profile. Existing reviewed providers add an Experience through the same
workspace's Experiences section. Shared checklist/evidence/publication/booking
completion remains internal work; the two private-application migrations do not
close those gates. Primary Airbnb/Booking.com/Viator comparison is recorded in the
existing proposal, without assuming a universal direct Booking.com supplier route.

Shared-entry changes pass production build/type-check and focused lint. New activity
drafts reuse the existing professional background as editable starting text; this
does not grant activity approval. Full onboarding/browser/role verification remains
pending. No Production change or deployment was made in this follow-through.

Moved beyond the UI/motion checkpoint into the agreed feature implementation. Test migrations `20261021080654` and `20261021081448` add the private activity application and revision/event history, owner draft/save/submit/withdraw/archive commands, Creator review queue and correction/decline decisions. This uses active Service Worker workspace membership and trusted Auth/device authority without service occupation, service prices, completed jobs or service approval as prerequisites. No separate provider account, dashboard or wallet was introduced. New workspace activation now enters the workspace choice rather than forcing service setup; private Experiences applications are reachable before service review.

Source includes a bounded, receipt-validated activity transport and shared provider application screen: activity/category/expertise/location/duration/participation/accessibility/inclusion details, draft validation feedback, pending review, withdrawal, corrections, history and keyset paging. Creator oversight opens its queue through fresh private-evidence confirmation; independent review decisions have version checks, written feedback and audit records. Creator-only initial review is intentional at this stage: delegated Staff/Admin review and affirmative approval with current identity/category evidence are still unimplemented. Public catalog, session/capacity, booking/payment, cancellation/refund, settlement and the rest of Experiences remain unbuilt. No public booking tile or charge is enabled by these changes.

Server writes use revision checks, response-loss retry handling, a serialized 30-draft quota and the existing canonical per-user action budget (30 activity changes/minute). RLS is enabled and direct anon/authenticated table privileges are revoked; commands check current actor/device/workspace, and six public commands have no anonymous execute grant. Keyset lists are bounded to 20 activities and history to 50 events. Test catalog inspection confirms these grants/objects and zero application/event rows. These are metadata/compilation checks, not a hosted provider/Creator flow or complete role/concurrency proof. Security advisors show 57 RLS-without-policy INFO notices (the two command-only tables intentionally have no direct grant), 17 existing anonymous-command WARN notices and 581 authenticated-command WARN notices including these six deliberately gated commands. Broader function authorization review remains open. Production is unchanged.

Source TypeScript/build and focused lint pass for the connected provider/Creator application implementation. Browser, signed-in submit/correction/retry, revoked-device, concurrency, quota and full replay evidence remain pending. No automated test suite was run in this checkpoint. Existing onboarding navigation assertion now includes the private Experiences tab. These changes are not deployed to the web app or Production database. Canonical Activity notifications and delegated reviewer controls remain internal work alongside affirmative evidence approval and the full customer booking journey.

### Shared motion, access receipts and Inbox recovery - 21 October

Standardised the shared motion foundation rather than adding isolated animation: 120 ms fades, 160 ms control feedback and 190 ms panel movement apply to shared UI primitives, Login, workspace/navigation and media entry. Replaced the reusable sheet's conflicting 500/300 ms timing and removed broad transition-all from shared buttons/switch tracks/accordion triggers. Shared primitive reduced-motion rules preserve required centring and selected-state transforms; the Service Worker availability thumb now moves by transform rather than animated position. Both themes use the same motion tokens. Route-level visual/reduced-motion/browser checks remain open.

Fixed a malformed-response fail-open in the shared Property Partner/Service Worker identity gate. It now requires explicit matching policy/current/gate booleans before rendering protected workspace content; request errors and invalid receipts use the same retry state. Server authority remains unchanged. Service Worker job and conversation reads now validate required identifiers/status/counts, bound waiting, expose errors with Retry and avoid claiming empty results after failed reads. Inbox message refreshes reuse the existing coalescing scheduler rather than overlapping per-event calls. Workspace/conversation component state resets by account. Both provider workspaces now share account-bound unread-count state, bounded summary reads and preservation of complete counts on partial failure.

Receipt follow-through found dark-theme ink leaking into the paper document, malformed reads presented as an empty list, stale subject responses/cached refund state, duplicate PDF action risk, and lost payment-return references on reload. Corrected the receipt paper's local ink, settled-state/amount/currency/date validation, owner-reference matching, account/subject isolation, refreshed reads and synchronous action locks. PDFs validate the same transaction contract. Payment return now retains its reference for reload recovery and shows verified payment before receipt loading; receipt retry does not restart payment confirmation. These are source changes, not provider charge/refund proof. No migration or Production apply is part of this checkpoint. Experiences capability/session/booking work and other release gates remain open.

Evidence at this checkpoint: production build and focused lint pass; final incremental TypeScript check passes. Existing motion and Service Worker wording assertions were updated to the shared tokens/current wording. No new tests were added and no automated test suite or browser/hosted-role/payment journey was run in this checkpoint. The prior 583-test baseline has not been rerun against these changes. Receipt contrast and shared primitive timings are implemented, but whole-app visual quality remains unverified. No deployment was performed.

### Active onboarding reliability and motion - 20 October

Fixed additional defects in the Service Worker setup summary and full verification page: unbounded status reads, missing retry, failed reads rendered as an invented pending record, stale responses after account changes, status-string approval inference and expired identity shown as passed. Both screens now validate the canonical activation receipt, bound reads to 15 seconds, recover through Retry and derive approval/current identity from explicit server fields. A shared receipt validator avoids diverging rules. These changes do not add activity-host eligibility or an Experiences backend.

Improved the active shared review checklist and verification screens: readable text sizes, theme-aware surfaces and feedback colours, explicit button types, semantic ordered steps and completion labels. Removed dark-only setup backgrounds and white-on-light status controls. Primary verification buttons use brief colour feedback that respects reduced motion; generic spinner/pulse animation also respects the user's reduced-motion setting. No 3D tour was added: the current listing media has no verified spatial-tour asset/contract, and decorative rendering would not supply one. Experiences capability gating, the complete booking lifecycle and the remaining release register remain open. This checkpoint requires focused browser review before visual or hosted-flow sign-off.

Checkpoint evidence: production build passes; final TypeScript check and focused lint pass for both activation/verification screens, the shared checklist and receipt validator. No new tests, hosted role checks, browser checks, migrations or Production changes were performed in this checkpoint. Earlier 583-test evidence belongs to the earlier checkpoint and has not been rerun against these changes.

### Experiences eligibility and shared workspace clarification - 20 October

The existing Experiences proposal now specifies the implementation order and customer/provider/Creator screens, including independent capability gating, sessions, capacity/payment recovery and operations. Source inspection found the current workspace gates main screens on service verification; Experiences implementation must replace that assumption for activity-only providers while preserving existing job permissions. No Experiences screens or backend are claimed implemented. Fixed the generic spinner/pulse reduced-motion gap in `src/index.css`; normal-motion animation remains enabled. This CSS change has not had browser verification in this checkpoint. Other roadmap gates remain open.

Experiences remains unbuilt. The agreed implementation uses the existing Service Worker workspace with independent requested-service and Experience capabilities. An applicant can offer Experiences only; an unrelated service occupation, catering listing or completed service job must not be a prerequisite. Review relevant activity expertise, session/venue safety and applicable category/market documents. Existing service approval must not automatically approve an Experience. Reuse identity, wallet, Team and support authorities. See the existing Friends and Experiences product proposal for the clarified contract and primary-source comparison. No separate provider dashboard is approved.

Corrected visible shortened Worker wording in profile sharing, the professional setup save receipt and staff operations navigation. This is a bounded wording correction, not a completed app-wide consistency audit. Internal identifiers are unchanged. Experiences implementation, other product work and release gates remain open.
**Working branch:** `reconcile/readiness-baseline-20261012` (PR #118)  
**Purpose:** take WeHouse from a substantial codebase to one verified, supportable web product. R1–R11 remain the engineering checklist; this document adds an execution order, owners, evidence, and the limits of schedule estimates.

### Worker profile, availability and legacy inventory - 20 October 2026

Found and fixed active profile defects: failed reads silently became zero job counts or empty/fallback services; local review flags were treated as publication; biography formatting silently removed the first professional introduction and everything after a Services Offered heading; hard-coded dark colours weakened light mode; the V3 component lived in a V2 file. The canonical `WorkerProfilePanel` now uses bounded reads with receipt checks and Retry, authoritative activation/publication, confirmed service records, unknown statistics instead of invented zeroes, the saved biography and theme-aware colours. Availability now checks the matching saved profile/boolean, locks repeat taps and recovers from errors/timeouts; its wording no longer promises discovery simply because availability was enabled. Existing jobs remain independent.

Removed unused bio-status/admin lookup helpers, old subscription types/labels, and unused raw government-ID verification client contracts after consumer searches. The active UI/Edge source has no direct consumers of `workers`, `blue_badge_subscriptions`, `wallet_balances` or `withdrawal_requests`; all four are empty on Test at this checkpoint. Migration `20261020182853` then retired the empty `workers` and `blue_badge_subscriptions` tables with row locks, no-data-loss guards, function-reference checks and RESTRICT. Both are absent on Test; `profiles`, `worker_verifications` and `worker_pro_subscriptions` remain. `wallet_balances` and `withdrawal_requests` remain for reviewed financial-history disposition. This is not a Production data inventory or Production apply. Server inspection found two remaining references in support/history functions (including a comment-only bank-history reference) and an unused service-executable `request_withdrawal` writer that directly debited wallets and inserted legacy withdrawal requests. No function, view, policy, schedule, current UI or Edge caller of that writer was found. Migration `20261020181421` removes only that function with RESTRICT and implementation/dependency guards. The canonical `request_my_wallet_withdrawal` remains callable by authenticated users through its own checks. The withdrawal-writer migration deleted no tables, balances or retained financial records; the subsequent migration removed only the two proven-empty nonfinancial predecessor tables above. The rollback retirement contract and existing canonical wallet-withdrawal receipt contract both pass after retirement; Worker credential SQL replay also passes. These use rollback-only synthetic balances and do not exercise a provider transfer.

Focused browser checks pass 18/18 for the actual Worker profile and availability control: light/dark, 320/768/1440 px, preserved biography, reviewed-but-not-public state, read/malformed errors, missing save receipts, recovery and credential access while already live. Narrow screenshots were inspected. Full source suite passes 583/583; build/type-check and focused lint pass. The shared wallet/Pro/property browser regression replay passes 79/79 after fixture navigation was corrected to dismiss the visible success notification. This is not a hosted role or provider-payment proof.

Security advisor replay retains the broader existing command-exposure notices: [anonymous SECURITY DEFINER review](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [authenticated SECURITY DEFINER review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Removing the service-only legacy writer and two empty tables does not close the function-by-function authorization audit.

### Listing model comparison refresh - 20 October 2026

Current WeHouse submission is Apartment -> Short Let/Long Let or Hotel -> room types/physical units/rates/inventory, followed by private documents, access/field review, final gallery and publication. A submission batch groups submission work; it does not identify a building or allocate shared physical space. C-064 now has the Test physical identity foundation; the remaining building -> bookable space journey for multiple apartments and private bedrooms, including mixed let terms and whole-unit/room overlap protection. Studio remains a layout, never a separate marketplace or payment rule. These distinctions must be carried through submission, review, discovery, detail, calendar, checkout, booking snapshot and Partner management before the hierarchy is enabled.

Current primary comparison: [Airbnb space types](https://www.airbnb.co.uk/help/article/5), [separate room listings](https://www.airbnb.co.uk/help/article/289), [eligible multiple-unit property grouping](https://www.airbnb.co.uk/help/article/4050), and [Booking.com room/rate/date inventory](https://developers.booking.com/connectivity/docs/ari). Airbnb's multiple-unit article describes grouped property content with per-unit calendar/pricing/reservations and explicitly limits the feature to listed markets/property types; it is not a claim of global availability. Booking.com's inventory model separates property, room/unit type, rate and dated availability. This updates the earlier comparison; WeHouse must not claim those capabilities are already implemented.

### Worker credential controls - 20 October 2026

Implemented service/operating-area credential requirements on the existing Worker verification record, private versioned uploads, incomplete-upload recovery, correction reasons, independent scoped review and expiry. Both onboarding paths and Staff/Admin/Creator review surfaces share the property-document control and transport rather than separate competing implementations. Identity verification remains separate; these uploads must not contain NIN, passport or banking details. An explicit recorded review basis is required even when no additional credentials apply. This provides enforcement; acceptance of local evidence still requires appropriate operational/legal review.

Test migrations through `20261020152644` enforce matching current service/coverage context, every operating area's reviewer scope, trusted active sessions, Creator elevation, no self-approval, immutable Storage reservations, publication and new-job eligibility. Service/area changes invalidate acceptance. Expiry immediately blocks new work and the scheduled maintenance returns the Worker to review without cancelling existing bookings. Activity records carry review/correction outcomes. Unused raw government-ID submission, direct client approval and parallel dashboard helpers were removed; no historical financial records or tables were dropped. Evidence actions and review commands now have bounded waits and release busy state on failure.

Evidence: rollback Test SQL contract passes, including actual approval/new-booking, expiry denial, preserved existing booking, changed-area scope denial and revoked-device checks. Full source suite passes 582/582; production build/type-check and focused lint pass; existing isolated wallet/Pro/property browser regression passes 79/79. The final credential browser replay passes 16/16 across light/dark and 320/768/1440 px; narrow-screen screenshots were inspected. A notification obscuring a control was made dismissible, and evidence date inputs now follow the selected theme. These checks do not prove hosted signed-in role/file journeys, real legal acceptance, existing-live-Worker recertification or Production readiness. A follow-on Test migration (`20261020154022`) replaces the older private-property-document session helper with canonical Auth liveness plus a matching trusted active device. The property SQL contract passes, including still-live Auth tokens on revoked/pending WeHouse devices; all fixtures were rolled back. Advisors report no new anonymous credential entry point or credential table RLS gap; authenticated SECURITY DEFINER command notices remain expected for the explicitly scoped RPCs, and broader existing advisor warnings remain open. Production remains unchanged. Next dependency: finish supply/term snapshots and the remaining financial recovery controls, then the agreed booking features in this same register.

### Property evidence after publication - 20 October 2026

Fixed the post-publication gap: the publication gate alone did not stop a new apartment or Hotel booking after evidence expired. Test migrations through `20261020160132` now reuse the document authority for actual reservation inserts/asset changes. Current bookings retain their lifecycle, payment and support records. Evidence replacement, correction and changed requirements pause public availability; bounded expiry maintenance pauses expired apartments/Hotels and creates Partner and scoped operations Activity. Renewal resolves those tasks but does not automatically republish. The existing preparation screen now receives paused records rather than a false live state; explicit publication restores the public state. Selected records refresh after a document decision. Publish controls use current document readiness, prevent repeat taps and release busy state on errors/timeouts.

The extended rollback SQL contract passes actual apartment and Hotel inserts with reviewed evidence, credential-specific denial after expiry, idempotent expiry processing, hidden public availability, preserved existing bookings, Activity resolution, preparation-screen routing and explicit republication. Booking checks share the evidence request lock; publication now uses request-first ordering with expiry/review. This is not yet a two-connection concurrency or hosted browser proof. The test fixture includes real required policy snapshots, rate plan and ready Hotel unit; these are rollback-only, not legal publication or live provider configuration. No fixture profiles, reservations or Hotels remain. Legacy public properties without reviewed evidence must be recertified before this gate reaches Production; broad SQL fixture upgrade and fresh/upgrade replay remain required.

## What “finished” means

The full requested scope includes the agreed Friend/Roommate behavior, provider-led Experiences, optional Partner-approved monthly rent, Hotel shared booking costs and useful Worker/Partner Pro. Unfinished features remain in this register. A smaller housing-only milestone must be described explicitly; it cannot be presented as completion of the full requested product.

WeHouse Web v1 is ready for a controlled public release only when all of these are true:

1. The reviewed commit passes required GitHub checks, including the browser journeys, build, lint, tests, migration validation, and upgrade checks.
2. Vercel has a successful preview for that exact commit; production uses the approved commit and expected environment. Vercel preview readiness is verified per exact reviewed commit; production promotion remains a separate release approval.
3. The route and journey inventory covers signed-out and signed-in users, each enabled workspace/role, empty/loading/error/success states, refresh/back/deep links, and phone/tablet/desktop in light and dark themes. Every in-scope journey has recorded evidence and no unresolved release-blocking defect.
4. The production and test Supabase histories have been compared read-only. Every difference has an explained disposition. No migration is applied just to make the two environments look alike.
5. Security, money movement, privacy, support, and operating rules have owners and pass their release checks. Any feature without the required approval stays disabled.
6. Recovery, monitoring, and rollback steps are documented and exercised for the web release.

A green build alone is not product completion. Native-store release and a capacity claim are separate targets with their own evidence.

### Definition of engineering complete, pending external activation

This state has not been reached. It requires every internal implementation and verification row in the work register to be closed for the full agreed scope. A feature hidden behind a flag can await commercial activation after its code, permissions, operator controls and failure/recovery paths are implemented and tested. An absent catalog, provider adapter, document store/review flow or rent workflow is unfinished engineering.

Closure evidence must cover the rule, user journey, authoritative server action, operator decision/recovery, access denial, persisted result, and deployed Test journey. Finish the role/route/nested-action inventory itself; an uninspected surface remains an internal verification task. Keep the existing delivery sequence and work register as the execution authority; do not introduce another competing checklist.

External-only residuals may include provider accounts/credentials and written model approval, legal acceptance of evidence/contracts/retention, actual business/asset licences, owner commercial decisions, signed store approval, domain/account-owner action, and the owner's operational launch sign-off. Adapter implementation after obtaining provider documentation, hosted tests, migration disposition/replay, security fixes, rollout preparation and monitoring/recovery exercises remain engineering work. External approval alone cannot close an internal row.

## Current baseline

### Bank search and provider catalog repair - 20 October 2026

Owner reports are observations from the older live product. None of this checkpoint was promoted to Production. The current bank picker was reproduced locally first: basic name/code filtering worked. Found a separate server defect: both listing banks and resolving a selected bank fetched only the first 100 Paystack entries. Test payout-account version 6 now follows documented cursors with a shared deadline and bounded page count, rejects incomplete/looping/malformed responses, filters retired/deleted institutions, deduplicates codes and caches only successful complete lists for five minutes. Both display and verification use this catalog. No provider charge or transfer was made. Live Paystack catalog retrieval still needs a signed-in Test journey.

The shared picker now normalizes accents/case/spacing and matches all words in either order, retains code/metadata/explicit-keyword search, uses separate control/search labels instead of nesting interactive controls inside one label, supports Escape and keyboard selection, improves touch/readability and uses theme shadows. Bank loading now validates the receipt, exposes inline retry and avoids an empty-list success after malformed responses.

Verification: 578/578 source tests, 10/10 focused bank browser scenarios, 15/15 phone/popup/select browser scenarios, production build, focused lint and Deno checks pass. Bank scenarios use the actual payout setup with controlled provider responses at 320/768/1440 px in both themes, including no matches, word order, code, keyboard selection, reopen and malformed/timeout retry. The native SQL contract passes with rollback. These are not Production or physical-device proofs.

### Native push implementation and concrete theme/control fixes - 20 October 2026

Implemented native Android/iOS registration, independently persisted phone consent, expected-account/trusted-session checks, token rotation and stale-registration protection; service-only canonical-Activity delivery queue; FCM OAuth and APNs signing; provider receipts, bounded leases/retries, invalid-token removal, off/revocation cancellation and retention. Test has the three migrations through 20261020101104, native-push version 1 and an every-minute scheduler. Missing Vault/provider configuration prevents delivery. The rollback SQL contract passes without persistent fixtures. Capacitor sync and the earlier production build pass. Hosted endpoint probing was blocked by rejected network approval; signed-device delivery, channel-by-channel chat coverage, durable reminders and capacity evidence remain internal verification/integration work after credentials. Production is unchanged.

Also fixed the alternate toast theme provider and invalid colour variables, shared off-switch contrast/touch targets, select-sheet text/overlay/border/shadow/long-option layout and privacy save races/false receipts. Browser scenarios cover the real phone control, failure/denial/unavailable states, popup colours and option sheet at three widths in both themes. This does not close the whole-app visual audit.



### Notification controls and native configuration - 20 October 2026

**Evidence:** 559/559 source tests, 11/11 isolated notification/followed-search browser scenarios, focused lint and production build pass. Followed searches were checked at 320/768/1440 px in both themes; the two 320 px screenshots were inspected. These are local isolated browser checks, not hosted signed-in delivery or physical-device verification.

Implemented persisted preference receipts, owned followed-search pause/delete receipts, explicit failed-read handling, filter-restore errors, foreground preference propagation to both workspace listeners, authoritative false action state, bounded Activity read operations, and bulk-read protection for newly arrived rows. Removed the inactive optional email toggle; recovery/verification email remains separate. At that earlier checkpoint background push was unimplemented; the later native-push checkpoint above records the implemented transport and remaining activation/verification gates. Followed-search edit-trigger/criteria parity, announcement read receipts and complete feed/badge architecture remain open.

Android configuration now follows Capacitor 8 (SDK 36, AGP 8.13.0, Gradle 8.14.3). No native build is claimed: Java is missing locally; iOS requires macOS/Xcode. See native-release.md and NOTIFICATIONS_AND_ACTIVITY.md for the exact boundaries. Full requested feature, role, money, migration, design, recovery and native verification gates remain in this register. No production mutation or email/NIN activation was performed.


### Email access, device confirmation and scope correction — 20 October 2026

**Current evidence:** 552/552 source tests, 22 isolated email/signup/notice browser scenarios at 320/768/1440 px in both themes, 20 actual Login-page browser scenarios at 320/390/768/1440 px, production build, focused lint, Deno check and the rollback email-security SQL contract pass. Hosted anonymous/public probes pass 11/11, including missing-bearer device denial and recovery failing closed without mail configuration. These are not delivered-email or signed-in provider/payment proofs. Test records 759 migrations; no SQL-fixture Auth users/challenges remain. Production remains unchanged.

- C-065 replaces the previous Google-only signup/device prompts. Email signup accepts the Auth confirmation link/code; default recovery and device confirmation have separate purpose-bound eight-digit codes. A provider login cannot promote a pending device. New pending-device state is stored separately from provider transactions; the obsolete client Google-device RPC wrapper is removed and its authenticated execution revoked on Test.
- `email_account_challenges` holds service-only, short-lived HMAC proofs, with ten-minute expiry, five guesses and atomic claims. It is not a new identity/session authority. The exact account, purpose and challenge are bound; device proof additionally binds the pending device and Auth session. Recovery verifies real global Auth revocation and device cleanup before success. The existing purge handles old proofs; unresolved verified processing claims require operational recovery review. See [account recovery and device confirmation](IDENTITY_PROVIDER_PASSWORD_RECOVERY.md) for activation and failure cases.
- Deployed `email-account-security` Test version 2, including a 4 KB streaming body limit; all four files match reviewed local source. Public recovery needs gateway JWT verification disabled; the handler independently authenticates every device action and verifies recovery proofs. **Mail activation remains external:** a verified sender/provider account, `RESEND_API_KEY`, `EMAIL_SECURITY_FROM`, a separate HMAC secret and final enable flag are not configured. Real delivery, two-device approval/rejection and password-reset/session-revocation journeys remain internal verification tasks after configuration. Do not call the code enabled or fully hosted-verified.
  Deployment follow-through: an initial transport failure left version 1 active; read-back confirmed that before retry. Version 2 deployed successfully and all four files were compared. One probe during deployment timed out; the final replay passed 11/11. This small replay does not establish a latency or availability guarantee.
- New-login notice uses theme tokens, larger controls and matching server receipts; malformed receipts retain the notice, and double taps are locked. Notification bursts are coalesced. The shared Auth-liveness helper now rejects explicitly revoked WeHouse devices. Device registration also rejects a revoked bearer before updating metadata; both client entry paths reject unknown/rejected states and require a trusted session receipt. The final SQL replay verifies live-device registration still works and a revoked device cannot reregister. Test now records 759 migrations through `20261020084701`. This does not close the full direct-API/Storage/RPC revocation audit or certify server capacity. Narrow-screen light/dark security screenshots were inspected; input boundaries were improved and the focused browser suite replayed. Full existing browser suite 79/79 and the focused property-Team replay 14/14 pass.
- C-066: **Friend groups are deferred. Do not build them yet or count them as current release prerequisites.** One-to-one Friend plans remain. Experiences remains required engineering work; provider-led activities can include suitable campus workshops/classes/walks under the same reviewed provider, session, capacity, booking, money and support lifecycle. It is still not implemented. Team invitation recipient confirmation and the remaining role/onboarding, financial, schema, capacity and whole-design rows remain open in the existing register.


### Hosted account access and Friend confirmation — 20 October 2026

Latest result: **9/9 deployed public/anonymous boundary probes, 7/7 isolated Friend browser scenarios, 546/546 source tests**, production build, focused lint, Partner Pro Deno check and rollback recipient SQL contract passed. Partner Pro Test version 2 has JWT verification enabled. Provider configuration and signed-in payment/role journeys remain open. These checks do not exercise Google/Apple consent, recovery email delivery, native downloads or actual provider money movement.

- Executed `scripts/check-hosted-test-boundaries.mjs` against the fixed Test project. Public Auth settings and discovery responded; anonymous Friend/arrival and existing payment/payout endpoints denied access. This is deployed boundary evidence, **not signed-in role/payment completion**. No actual charge, refund, transfer or delivery email was sent. Test has no prepared signed-in role fixtures or locally available Test service credential; creating SQL-only profiles cannot substitute for Auth/browser journeys.
- Public Test Auth settings report email enabled, **Google disabled and Apple disabled**. At the earlier inspection, repository recovery required a previously linked Google/Apple identity and the new-device screen required Google, leaving password-only accounts without a complete route. C-065 above supersedes that implementation with the email-code path; real delivery remains gated. A third-party address can be registered with Google, but that is not automatic and must not be assumed. Implement and verify a provider-independent fallback through the authoritative session/recovery controls; do not bypass pending-device trust or offer an unimplemented support reset. Provider configuration, redirects, Apple relay identity, expiry/reuse, session revocation and phone/tablet/desktop theme checks remain open.
- The Partner Pro initialization endpoint was missing from Test (404). Deployed the repository implementation with JWT verification enabled, then added missing-token rejection before environment checks. Its initial deployed probe exposed **payment environment not configured (503)**; provider credentials/approved Test return URL must be configured before sandbox checkout can succeed. Pro sales remain closed. This does not certify the provider mode or financial recovery.
- Added an exact-username Friend preview, explicit confirmation, immutable recipient-ID sending, defensive receipt checks and per-account lookup limits using the existing throttle table. No new relationship or identity table. Test migration `20261020071014`; rollback contract verifies privacy, no request on preview, self/prefix/block denial, rename-safe send and persisted throttling. Seven isolated browser scenarios passed at 320/768/1440 px in both themes, including error recovery; 34 focused source tests and build passed. These remain isolated component checks.
- Chat photos/videos now expose save links; native save/share behaviour still needs device verification. Existing decrypted photo cache lasts for the mounted Friend conversation and is revoked on close; durable encrypted caching, bounded pagination/polling and cross-device behaviour remain open. Reactions exist; no sticker catalog was found. Fixed attachment/Friend action colours do not close the full visual audit.
- Keep **Team** as the user-facing property collaboration model, with scoped operational/commercial permissions. Extend recipient confirmation to Team invitations; Friend confirmation alone does not cover invitation entry points elsewhere. Experiences remains unbuilt: reviewed provider → activity → dated session/capacity → booking, payment, cancellation/refund, support and review. Campus workshops, cooking/creative classes and suitable guided outdoor activities may use that shared lifecycle. Shows, parties and nightlife remain excluded.


## Product-coherence checks — 19 October 2026

### Data duplication and money authority

- `wallets` is the current Worker/Property Partner balance source, `wallet_transactions` is its movement history, and `withdrawals` is the current payout workflow. `wallet_balances`, `withdrawal_requests` and `payments` remain legacy schema objects; repository docs that call these active competing writers are stale. Their eventual retirement is gated on consumer inventory and parity, not a cleanup-only migration. See [D-010](DECISION_D010_MONEY_AUTHORITY_2026-09-12.md), [Payments and Money](PAYMENTS_AND_MONEY.md) and [Data Model](DATA_MODEL.md).
- The schema still contains overlapping generations: four conversation families, several audit-log families, old payment/payout objects and parallel historical migration directories. Some represent distinct domains, and some are legacy. This audit does not certify that all duplicate code or schema has been removed. Keep `supabase/migrations` as the migration authority; classify each overlap, inventory its readers/writers and prove parity before any retirement. The release blocker is clarity and safe ownership, not table-count minimalism.
- Money is processed through server-side payment initialization, Paystack verification, signed webhook confirmation, domain-specific protected funds/earnings, wallet movements and payout settlement. This is a real provider-backed implementation, but live charge, refund, dispute and payout journeys are not release-verified. Worker offline invoice marking is explicitly a Worker note, not provider-verified payment.
- Production hotel access was checked read-only on 19 October. Anonymous has no direct SELECT grant on hotel base tables; authenticated access is RLS/capability-scoped, and `hotel_rooms` has no browser SELECT policy. This resolves the old H-000 exposure claim; role-by-role field/action testing remains open. [Product Master](PRODUCT_MASTER.md) and [Known Inconsistencies](KNOWN_INCONSISTENCIES.md) now identify the historical finding accurately.

### Paid tools: genuine current value, sales remain closed

Current code provides at least ten useful workflows per tier. These are real tools, not commitments to invent more checklist items. Pro checkout remains closed until pricing, terms, refunds, payment verification and repeat-use value are verified; core discovery, booking, trust and safety stay free.

**Worker Pro** (`WorkerProTools`, `WorkerProBusinessTools`, `WorkerProJobCosts`):

1. Work calendar across booked jobs.
2. Calendar export.
3. Returning-customer history.
4. Private customer notes.
5. Service package records and profile visibility controls (not marketplace checkout offers).
6. Job reminders.
7. Branded receipt PDF for completed/released jobs.
8. Receipt aftercare notes.
9. Per-job cost capture.
10. Profit view and cost CSV export.
11. Quote and invoice drafts tied to a WeHouse job, with line items and PDF download.
12. Work insights: completed/active jobs, released earnings, verified rating, repeat customers and cancellations.
13. Earnings CSV over 30/90/365-day periods.

**Property Partner Pro** (`PropertyPartnerProWorkspace`, `PartnerProOccupancy`, `PartnerProOperatingCosts`):

1. Portfolio overview across owned homes and hotels.
2. Property filter for focused operations.
3. Consolidated stay calendar.
4. Calendar export (a snapshot; it does not sync or alter availability).
5. Twelve-month released-income view.
6. Monthly income breakdown.
7. Income CSV export.
8. Statement PDF export.
9. Maintenance and turnover tasks by property.
10. Repeating tasks with due dates and completion/reopen controls.
11. Next-30-day booked-unit-night occupancy view (with stated capacity limitations).
12. Property operating cost records.
13. Recorded margin against released WeHouse income.
14. Shown-cost CSV and retained correction/void history.

Guest arrival instructions belong to free home and Hotel operations. Owners can read, save and clear them without Pro; only the paid guest of an eligible booking can read the guest projection. Consolidated occupancy reporting remains Pro. Normal job/booking management, payment records, support and safety are not subscription benefits.

Feature count is not proof that customers will pay. Validate repeat usage and pricing before opening sales. In particular, package records are not checkout packages, ICS is a non-syncing snapshot, and the occupancy ratio excludes room closures/manual occupancy.

### Friends and the wider marketplace

The two-person encrypted **Plan something** card is implemented in the working tree inside the existing Friend conversation. It works for dinner, day activities or a trip; lodging is optional. A plan does not charge, reserve or claim a venue booking. One account may have two separate relationship edges with the same person: Roommate and Friend. Their chats, permissions and decisions remain separate; being one does not automatically grant the other. On 20 October the owner deferred Friend groups: do not build group chat or count it as a current release prerequisite. Keep one-to-one Friend plans. Provider-led Experiences (tours, classes and suitable activities) remain part of the agreed full product scope and are still unimplemented. Shows, parties and the earlier event-directory proposal have been removed. Define the full booking, payment and support contract before implementation. Full scope and exit checks are in [Friends and Experiences Product Proposal](FRIENDS_AND_EXPERIENCES_PRODUCT_PROPOSAL.md).

### Terms, policies and release order

- Legal software structure supports versioned publication, checksums, per-document acceptance receipts and stale-version invalidation. The legal review register says public Terms and Privacy bodies are unpublished; therefore the platform has **not** completed legal publication or approval. Do not treat UI structure or acceptance plumbing as legal readiness. Creator publication and qualified legal review remain required before transactional launch.
- The single release order is the **Delivery sequence and ownership** table below; the **Open work register** is its detailed status list. Do not maintain parallel numbered next-step lists. The agreed Experiences implementation remains in the full-scope register alongside security, payment, legal, migration and journey gates; it is not silently deferred by this proposal.

## Phase execution status — 19 October 2026

This roadmap is the single implementation status report, per the documentation
index. “Built”, “locally verified”, “CI verified”, “merged”, “migrated” and
“production verified” are distinct states.

| Directive phase | Status | Evidence and remaining gate |
|---|---|---|
| A. Verified baseline | Complete, read-only | [Product coherence audit](WEHOUSE_PRODUCT_COHERENCE_AUDIT_20261012.md) covers repository/PR, CI, Vercel, Supabase histories/advisors, product findings and roles. No production or test database writes. |
| B. Product contract | Reconciled; owner choices open | Product Rules, Decision Log, Roles & Permissions and domain contracts are indexed in [docs README](README.md). Nigeria is the first market, not a permanent boundary. Five unresolved workflow rules remain explicit. |
| C. Design and interaction | Foundation implemented; route review open | [Design System](DESIGN_SYSTEM.md), theme-aware readable type floor, and the Listing Detail stale Rent options removal. Full route/role/device/theme, navigation and accessibility evidence remains open. |
| D. Data and business architecture | Partial; targeted Test repairs applied | Earlier baseline identified 266 history differences and reviewed the 15 anonymous-executable public SECURITY DEFINER functions without a confirmed exposure in that group. Targeted Test document/publication/management/Pro/media/free-arrival repairs are now applied through 20261019221843. Full history disposition, authenticated role/body review, fresh/upgrade replay and configuration parity remain open. Production was not changed. |
| E. End-to-end workflows | Incomplete | Payment-provider verification, Short Let review, owner lifecycle, hotel reporting/discounts, worker fulfillment/packages/response clock, and several admin/Creator/invitation journeys remain in the work register. |
| F. Performance and capacity | Partial; bounded stages green | On exact SHA `449d8ccd`, the hosted Test catalog passed 1–200 RPS: 6,000/6,000 at 200 RPS, 0 errors/retries/drops, 221ms p95. The disposable medium catalog replayed migrations, seeded 50k homes/100k hotels/50k profiles, confirmed indexes and query plans, and completed its read/resource stage. 1,000 RPS was not run; these are catalog/read tests, not end-to-end or payment capacity evidence. |
| G. Regression and release gates | Working-tree checks pass; exact-SHA CI pending | Current source suite passes 545/545; production build and focused lint pass. Payout-account Deno type-check passes; Test version 5 matches reviewed source with JWT verification enabled. The earlier full lint passed; the isolated browser runner now passes 79 scenarios, including actual light/dark provider-document, Pro-cost and free arrival-editor journeys. The latest wording/helper-text changes have not received a fresh whole-route visual pass. Document/publication, operating-cost and management/media SQL contracts pass on Test with fixtures rolled back. Historical CI at 449d8ccd is not evidence for this uncommitted working tree; current reviewed-SHA CI, fresh/upgrade replay and hosted role/two-device checks remain open. |
| H. Integration and launch readiness | Not complete; no release performed | PR #118 remains open/unmerged. Vercel preview for exact SHA `449d8ccd` is READY and authenticated root/JS/CSS requests returned HTTP 200; this does not establish public production availability. Production domains previously returned 402 `DEPLOYMENT_DISABLED`. No production setting, migration, merge or deployment was changed. Classification: **NOT READY**. |

### Current owner and external blockers

- Vercel project owner: restore the disabled deployment and provide a successful
  public smoke test; READY metadata does not establish availability.
- Database/release owner: explain every migration-version difference and approve
  a Test-specific ordered plan before any DDL. Do not manipulate history or use
  the Production-only coordinated script against Test.
- Product/payment owner: approve the Short Let sellable unit, Worker fulfillment
  modes, marketplace package-versus-quote behavior, owner pause/removal lifecycle
  and Worker response clock; verify Paystack charges, signed webhooks, retries,
  refunds and reconciliation before enabling real payment flows.
- Security/admin owner: complete function-by-function RLS/grant and
  SECURITY DEFINER review, authorize password breach protection, and implement
  and verify admin step-up.
- Engineering: the `449d8ccd` browser run found a stale city-field test name
  and a genuinely clipped 320px bookings status filter. Both are corrected in
  the working tree; commit and rerun the exact-SHA browser workflow before
  closing this gate.
- Local environment: Deno 2.9.6 and Python 3.12.10 are installed. The
  repository's 15-file Edge Function type check passed; all 500 local tests
  passed. Supabase CLI 2.114.0 is installed. Playwright 1.57.0 could not be
  installed because files.pythonhosted.org timed out at 18.9/36.6MB; Edge is
  present, but local browser replay is unavailable until that dependency can be
  downloaded. Docker is needed to run the Supabase stack only, not for ordinary
  Vite/React work. On 19 Oct, no Docker command, service, installer process or
  matching installer file was present in this environment; the reported 78.8%
  installer stall could not be diagnosed from this checkout.

### Current handoff

Continue the complete release-readiness programme in the delivery sequence below. New requests update the same work register; they do not replace the product-wide mission. Targeted report, Friend, wallet and Pro migrations have been applied to Test; Production remains unchanged. Complete the remaining financial controls and role journeys while separately resolving migration-history divergence and obtaining fresh replay/CI evidence. Review Partner, Worker and Creator controls, solo-Creator operations, Pro integration, discovery/search/maps, accessibility, wording, themes and responsive layouts as part of the same quality gate. Legal publication, real-provider payment/reconciliation, operational recovery and release approval remain gates. Do not claim that a passing component test proves the full product ready.

### Source coverage baseline: 19 October

Source enumeration found 37 declared navigation keys, including aliases; this is not 37 verified user journeys. There are also 49 page modules, 222 component modules, 26 Edge Function directories, 764 active migration SQL files, 74 SQL contract files and 92 Node test files. Counts describe files or declared keys, not a completion percentage. Nested tabs, dialogs, feature states, identity/workspace combinations and server operations still need individual coverage.

| Source key family | Declared keys from `src/types/nav.ts` | Coverage requirement |
|---|---|---|
| Discovery | search, saved, followed_searches, roommate, worker_discovery, worker_categories, hotels | Query/pagination/map/location and saved/followed results; role and privacy restrictions; loading/empty/error/retry and themes |
| Booking/payment | detail, hotel_detail, hotel_booking, my_reservations, payment_return | Every action through server response, durable state, internal queue where needed, provider reconciliation and resulting controls |
| Communication | conversation, chat, activity, notifications | One Inbox; Friend/Roommate/booking/WeHouse boundaries, encryption, unread/activity, report/block, attachments and end-of-lifecycle behavior |
| Account | profile, profile_edit, account, privacy, security, devices | Identity updates, workspace entry, sessions, recovery, consent/privacy and actual operator resolution |
| Workspaces | creator, admin, staff_dashboard, worker_dashboard, property_partner, hosting_operations, hosting, hotel_operations | Allowed/denied actions, geography/ownership, actionable totals, sensitive step-up, no-staff Creator operation and Pro entitlement states |
| Supply/setup | Partner submitted properties/hotels, worker_setup, worker_verification | Evidence, corrections, review/publication and category-specific credentials without false verified claims. Retired internal direct-creation route is excluded |
| Compatibility keys | messages, my_bookings | Canonical destination, old links/back/refresh and no duplicate product destination |
| Public legal | privacy_policy, terms_of_service | Published current content, effective version, accessible reading and acceptance changes where required |

No family is marked fully passed by this inventory. The existing open work register is the only unfinished-work list. Current tests and partial browser runs are evidence for their named checks, not blanket closure for these families.

## Delivery sequence and ownership

| Stage | Target window/status (updated 22 Oct) | Owner | Exit evidence |
|---|---|---|---|
| **0. Stabilize PR #118** | In progress; duration not yet measured | Codex: inspect and fix code/docs; user: confirm product rules where authority is unclear | Required CI and browser journeys pass on the reviewed SHA; that SHA has a successful preview; known failure causes are fixed rather than waived. No production change. |
| **1. Establish live baseline (R1, R4, R8)** | In progress; disposition incomplete | Codex: read-only comparison and evidence; user/admin: provide platform access or approve admin-only settings | One source-of-truth map links product rule → route/component → database/Edge Function enforcement. Every Production/Test/repository migration difference has a read-only disposition. Vercel production/preview settings and environment separation are recorded without exposing secrets. |
| **2. Close release-blocking product defects (R2, R6, R7, R9)** | Active: wallet/payment/Pro recovery and provider reconciliation; inspection server authority/review checks now pass on Test, with durable drafts and hosted acceptance open. Next: unfinished property inventory/monthly rent/shared hotel costs and Experiences in the register. Cross-role support, notifications and design checks accompany each domain. | Codex, one editor/branch at a time; user resolves product decisions | Complete each domain from rules through UI, server enforcement, operator resolution and recorded evidence before closing it. High-severity inconsistencies are fixed or explicitly disabled; each behavior has a regression check. Role/action security review covers RLS, RPC grants, storage, and Edge Functions. No unresolved critical or high defect in the full agreed scope. |
| **3. Complete web journey and quality pass (R10, R11)** | Partial evidence; full matrix incomplete | Codex: test matrix and fixes; user: review the actual product and approve scope | Route/workspace matrix passes at agreed device widths and themes. Loading, empty, validation, error, and success states are verified. Browser console has no uncaught app errors; accessibility and agreed performance budgets are measured and pass. CI remains green. |
| **4. Web release candidate** | **Not dated: coverage and external gates remain incomplete** | Codex prepares the reviewed release; user owns release approval and operational readiness | Candidate is deployed from an approved SHA; smoke checks pass on the actual Vercel preview; rollback and monitoring are ready; required legal/security/provider gates for the enabled features are signed off. |
| **5. Public transactional launch** | **Date not estimable yet** | User/business owner + payment, legal, support and security owners; Codex supplies technical evidence | Nigeria operating/legal model is approved; Paystack sandbox and signed webhook flows pass, including retries, duplicates, refunds, and reconciliation; a pre-payment review/edit screen and server-side price/inventory revalidation are verified; support/privacy operations are staffed; independent security review and recovery evidence are accepted. Google Pay is considered as a Paystack web wallet method after account/country enablement; Flutterwave is a later optional processor; native digital subscriptions/features require a separate Apple/Google billing policy and receipt-verification track. |
| **6. Native stores and scale claims** | Separate follow-up | Native release owner and infrastructure owner | Signed iOS/Android device/store evidence and server-verified billing; workload-specific hosted tests, agreed latency/error targets, cost limits, and recovery results. Never test against production with destructive or synthetic load. |

The earlier 2–4 week range is withdrawn as an unsupported schedule for the full requested scope. A defensible date needs a completed gap/coverage audit, estimates for verified work packages, the reviewed migration path and dates for provider/legal/operational approvals. No percentage-complete or production date is established. Technical fixes continue while external gates are resolved.

## R1–R11 mapped to completion evidence

- **R1 — One product authority:** accepted product rules, decision log, and a rule-to-code-to-database map.
- **R2 — Inconsistencies:** each high/medium/low finding is fixed, disabled safely, or has an owner and scheduled decision; closure links to a test and commit.
- **R3 — Branch/PR hygiene:** the release PR is merged only after required checks; branch dispositions and main-protection settings are recorded. Admin-only changes are assigned to the user/admin.
- **R4 — Migration history:** read-only production plan and test comparison first; no guessing, replaying, or rewriting applied migrations.
- **R5 — Safe database releases:** reviewed migration, SQL contract, exact-SHA workflow check, controlled apply, and post-release plan.
- **R6 — Database security:** allowed and denied cases for each role/action, including revocation and cross-account boundaries.
- **R7 — Edge Functions:** deployed inventory matches reviewed source; JWT mode, secrets, webhook signature checks, and tests are documented per function.
- **R8 — Vercel:** production and preview settings are verified; PR preview and production deploys use reviewed commits; environment separation and headers/assets are checked.
- **R9 — Frontend structure:** one route/workspace owner and data path per feature, measured removal of legacy paths, and no new unexplained lint suppressions.
- **R10 — Whole product:** recorded role/device/theme journey evidence, plus provider and operational evidence for enabled features.
- **R11 — Consistent quality:** module boundaries, CI-enforced conventions, generated/cross-checked contracts, and docs kept current with behavior.

## Open work register (single list; update in place, do not start another)

Evidence rule: historical **Done** or **Built** entries describe earlier implementation evidence, not a current release pass. Every release closure must name the reviewed commit, check/artifact, environment and date. **Not implemented**, **implemented / verification pending**, **not yet inspected**, and **external approval pending** are distinct states. An uninspected item is neither a confirmed defect nor a presumed pass. This register lists currently identified work; completeness of defect discovery remains unverified until the route/role/action inventory is covered.

| Area | Item | Status |
|---|---|---|
| Payments | Canonical wallet, withdrawal receipts and payout-account recovery | Test schema/RPC repairs applied; shared Worker/Partner withdrawal intent and activity model implemented. Isolated browser checks passed; real provider settlement remains unverified. Payout-account recovery now retains its reference across reloads, checks once a minute, distinguishes load errors and opens support with request/workspace context. Internal finance reads fail visibly and uncertain actions reload authoritative state. Isolated browser checks pass; Test payout-account v5 now bounds provider requests/whole paginated lookup to 12 seconds, preserving unknown outcomes without a repeated recipient POST; deployed file parity and JWT checks pass. Real provider reconciliation, actual support resolution and secure bank replacement remain gates |
| Paid tools | Worker and Partner Pro contracts and practical features | Worker has twelve described workflows; Partner has fourteen paid workflows after removing essential guest arrival instructions from Pro, including property operating costs, recorded margin, export and retained void/correction history. New costs use current entitlement/ownership checks, idempotent records, 50-row keyset pages and explicit NGN/UTC reporting; mixed currencies suppress income/margin. Test SQL and isolated browser journeys pass. Research baseline: Jobber scheduling/customer/quote/invoice/cost workflows and Guesty portfolio/operations/reporting. Willingness to pay is not established by a feature count. Custom work reminders now use a bounded, locked server dispatcher and canonical Activity, with reschedule/completion/cancellation resolution and deduplicated revision delivery. Test SQL and both-theme UI recovery checks pass; exact-SHA rollout, phone delivery, billing/recovery and real-user value verification remain gates |
| Product quality | All-role control, layout, wording and theme review | Active: Partner, Worker, Creator/Admin/Staff, personal journeys, search/discovery/maps and hotel/listing controls. Verify actionable totals, loading/errors, keyboard access, responsive widths and both themes; record remaining defects here |
| Operations | Creator can operate launch without employees | Active review: prove access to every mandatory queue/action under Creator permissions, audit sensitive actions and preserve scoped roles for later hires |
| Security | Hotel data exposure fix | Done |
| Security | Admin sensitive-action step-up | Internal implementation/review open: inspect current Creator/Admin boundaries, require fresh server-validated step-up for sensitive finance/team/security actions, verify expiry/revocation, failed attempts, scope and audit records; no authority from a client flag |
| Reports | Report in Roommate, Friend, worker chats and profiles | Shared form now requires the server receipt, preserves retry after errors and links to private report history. Existing shared SQL membership/scope contract re-passed on Test. Isolated generic-form recovery checks pass; hosted per-chat/two-device evidence remains |
| Reports | Public property listing report to active review queue, receipt/status and urgent safety route | Canonical queue routing and Test migration applied. A receipt is required before success; MyReports now displays the full persistent reference and status; urgent support is wired. Hosted role/browser verification and reviewed rollout remain |
| Reports | Hotel public listing report action | Implemented in the active Hotel page and shared form. Test migration 20261019171328 applied; geographic/role/receipt/deduplication SQL contract passed with fixtures rolled back. Isolated browser checks cover submission, operator review, reporter status, failures, sign-in and urgent support context. Application rollout and hosted role/browser verification remain |
| Reports | Admin and Creator queues with state and local-area scoping | Done (state and branch/LGA contracts pass in CI) |
| Connections | Roommate cancel, 30-day wait, other person notified | Done |
| Connections | Friend list limit of 5, requests, chat and shared booking costs | Built for eligible Long Let/Short Let flows; two-device E2EE and real-device theme check remain |
| Connections | Friend request daily cap and expiry | Built: unanswered requests expire after 24 hours; 10 per person per day |
| Connections | Friend chat: encrypted messages, media and controls | Active product, UI, API and forward-schema names are Friend-first; pre-migration checks found zero Test relationships, messages, request logs, Friend key envelopes or Friend media, and Production has no Friend schema. No stored chat history needed transfer. Both forward migrations are applied to Test; role/browser checks, two-device encryption and real-device light/dark checks remain |
| Connections | Private two-person plan card inside Friend chat | Production build passes on working tree; exact-SHA CI, real-account/browser, refresh, block/delete, pin/reaction and two-device encryption checks remain |
| Connections | Roommate and Friend relationship overlap | Product contract documented: one account, independent relationship edges, permissions and conversations; code/UI cross-context review remains |
| Connections | Private Friend Groups and group plan card | Deferred by owner on 20 October: do not build yet. Excluded from current release requirements; retain one-to-one Friend plans. Any later group proposal needs a separate reviewed encryption, membership and safety contract |
| Marketplace | Provider-led Experiences | Private applications, categories, dated session preparation/prices, activity-specific documents and photos, independent approval, revision and host Activity are implemented and checked on Test. Public discovery/publication, capacity holds, checkout/protected payments, attendance, cancellation/refunds, booking-bound reviews, sharing, discounts and sponsorship remain internal work. Shows, parties and nightlife are excluded. No public catalog or booking feature is implemented |
| Connections | Friend naming across product, API and schema | Canonical names implemented across active source, UI, API and contract fixtures. The forward migration renamed empty legacy Test objects and created Friend-first schema there; Production remains untouched. Only historical migration records, the migration-history register, and explicit upgrade references retain the retired term. Production rollout and role/browser checks remain |
| Connections | Hotel and Friend conversation-info screens | Open |
| Pricing | Short Let host discount 5-50% in the price pipeline, shown on listing | Built |
| Pricing | Discount during property submission and Hosting control | Reconcile the canonical submission/Hosting path after retiring the internal posting form. Earlier internal-form-only evidence is obsolete; verify saved discounts, approval boundaries and final charged price |
| Pricing | Creator WeHouse-funded discount control | Built and commission-capped in current migration; docs still conflict on whether the campaign cap is 15% or commission-only—reconcile before campaigns |
| Pricing | Long Let discount (host 5-50% + WeHouse share capped by Long Let commission, Year 1 rent only, partner payout protected, migration `20261012370000`, DB test) | Built |
| Pricing | Hotel discount/rate-plan pipeline | Rate-plan/discount source exists; verify current display, checkout, Partner earnings and refund behavior against the approved rule. No second price authority; hosted evidence pending |
| Payments | Hotel shared booking cost with accepted Friend | Product rule confirmed 19 Oct; implementation and complete Paystack Test charge/verify/refund/reconciliation flow remain open |
| Long Let | Partner-approved terms and optional later-year monthly rent | **Partly implemented; release blocker remains.** Test and PR #118 connect accepted 3/6/12-month and multi-year terms, reviewed tenant agreement, immutable upfront checkout, protected initial payment and handover-anchored schedules. One-year and shorter terms are paid in full. Monthly payments are only for later years of a landlord-approved multi-year contract, with Year 1 fully upfront and eight payments for each later year. Without opt-in the full contract is upfront. Later collection through mandatory Payment Protection and authorized release, optional active-mandate automatic debit, reconciliation and arrears/exit/refund recovery remain internal work. See the 25 October correction and `PRODUCT_RULES.md` |
| Property supply | Submission authority and evidence completeness for apartments and Hotels | **Implemented/Test verified for private documents and new publication; wider supply work remains open.** Existing request/operations records now own accepted requirements, private uploads, incomplete-upload recovery, corrections, versioned replacement, independent scoped decisions, expiry and publication enforcement. Canonical Inbox carries actionable review/correction/outcome records and resolves superseded work. Actual apartment/Hotel publish contracts pass using additive Admin/Creator grants; owner self-approval is denied. Test operating-choice column/commands and 13 MB media limits were restored after contracts exposed missing parity. Open: live person KYC, structured guest/tenancy term capture and booking snapshots, already-live-property recertification, advance expiry reminders, appeal/retention/deletion operations and hosted real-role/file journeys. Worker credential enforcement is implemented in the 20 October checkpoint above; live recertification and hosted journey proof remain open. Local legal forms and provider approvals remain external. Access footage is not ownership proof |
| Property supply | Buildings and bookable spaces across Short Let and Long Let | **C-064 in progress; not release ready.** Supports several independent apartments in one building and separately let private bedrooms with shared areas disclosed. Retain current listings/reservations and Hotel inventory; submission batches are not buildings. Implement shared property/space identity, scoped review/evidence, per-space terms/calendar, Partner management and atomic whole-unit/room and Short Let/Long Let overlap prevention. Creating/managing spaces and normal bookings stay core features; optional consolidated analytics can remain Pro. Do not enable mixed whole-unit/room selling before concurrency and recovery pass |
| Worker supply | Category-specific credential and licensing requirements | Private context-bound requirements, uploads, independent review, expiry and new-publication/new-job enforcement are implemented on Test (20 October checkpoint). The accepted service/location requirements are not a universal legal matrix. Current market requirements, existing-live-provider recertification and hosted role/file verification remain open; retain the public Services launch gate until those requirements are accepted and verified |
| Pricing | Display, charge and refund agree on the test project | Internal verification/fixes open: each apartment/Hotel/service/Pro/shared-cost purpose must agree on currency, base price, discount funding/caps/expiry, compulsory charges/taxes, protected deposits, partner earnings and refund allocation. Revalidate server-side and snapshot the accepted version; resolve the recorded campaign-cap conflict |
| Account | Email-change and recovery delivery | Owner policy is confirmed by C-044/C-047/C-065; do not reopen it as undecided. Test modules and failure handling exist. Verified sender delivery, provider/email recovery, session revocation and hosted two-device journeys remain activation/release checks |
| Reliability | One shared action pattern (`src/lib/safeAction.ts`): a second tap joins the first request, clear offline message, no false success. Applied to Short Let booking, payment, cancel, Friend requests and Friend chat. Other actions and a visible Retry button | Built (partly applied). Server side: Short Let booking and canonical property submission carry request keys; the old direct-listing writer is retired. Payment already has a unique reference; other actions still open |
| Chat | Pinned messages in every chat (Roommate, Service, Friend, Hotel, Property host), both people, up to 10 | Built (migration 20261012380000) |
| Pricing | Discount end date, and host/WeHouse source labels on the listing | Built |
| UX | One loading and animation pattern (33 spinners, 6 skeletons today) | Open; shared tokens and selected structural tests exist, but no complete route × role × device-width × light/dark visual and action-result audit is recorded. Roommate screens and small controls are included, not presumed complete |
| UX | Back, refresh, offline, sign-in/out audit | Open |
| Journeys | Listing detail action-to-result verification (save, share, report, booking, shared booking cost, review, inspection and support) | Open; static pass found handlers and feedback; report migration is applied on Test, but real-role browser evidence and deployed rollout remain |
| Scale | Measured performance, caching, background work and rate limits | Internal review open: define release latency/error/resource budgets, verify indexes/pagination, bound expensive work, check public/private cache separation, durable retries and abuse limits. Add replicas or queues only where the measured workload requires them; no architecture purchase is itself a release gate |
| Scale | Controlled Free-plan release and future expansion | Current: enforce bounded reads/media/uploads, observe actual storage/egress/socket use and verify enabled journeys with isolated tests. Historical hosted 500-RPS failures remain diagnostic evidence, not the current merge throughput requirement. The 100k concurrent-session ambition requires separately provisioned infrastructure and measured evidence before making that claim. CDN verification remains blocked by Vercel billing |
| Release | Two-device E2EE evidence | Earlier owner check recorded. Current Friend schema, plan cards, recovery/revocation and all enabled chat types need scoped evidence. Group encryption is not implemented |
| Release | Phone light/dark check | Engineering journey/visual pass remains internal work; physical-device owner review supplements it |
| Coverage | Route and nested-control inventory | Current source count: 36 declared navigation keys including aliases, 47 page modules and 225 component modules (19 Oct). Map nested tabs/dialogs and role-specific actions to their server authority, persisted result, operator action and journey evidence. Cover signed-out/Personal/Partner/Hosting/Hotel Team/Worker/Staff/Admin/Creator, including Creator-only operation. Full coverage is not established |
| Security | Auth and permission boundary matrix | Hosted checks pending for username/email/provider login, recovery, device/session revocation, workspace switching, geography, self-review denial, Admin/Creator step-up, RLS/RPC/storage/Edge grants and cross-account denial. Identity/NIN and credential-provider behavior must match approved policy |
| Identity / payouts | Government-ID and recipient KYC contract | NIN is optional as an ID method for Nigerian Partners/Service Workers, not required at signup or ordinary booking/payment. Prepared NIN module is limited to those two purposes. Provider-approval/payout gates, alternative ID/appeal, shared-person reuse, receipt persistence, endpoint/UI and entity/bank matching remain internal work. The provider-specific adapter is also engineering work dependent on a selected provider. Provider account/credentials and processor approval of the actual recipient model are external. Paystack merchant compliance does not automatically verify WeHouse recipients; current bank resolution is not NIN verification |
| Domain rules | Reconcile unresolved contracts | Review D-004–D-020 against current source: unit/sleeping facts, Worker delivery modes and package/quote snapshots, unanswered-request clocks, property pause/removal, hotel turnover/lifecycle and fee/refund snapshots. Do not reopen decisions already settled by the owner |
| Money | Booking-to-provider reconciliation matrix | Internal sandbox integration/recovery work and evidence pending for every enabled purpose: order review, exact total/currency, price/capacity revalidation, charge, signed and duplicate/delayed webhook, cancellation, refund, dispute, held/released/reversed earnings and withdrawal. Include stale tabs, lost responses, failed/late settlement, chargeback after Partner payout and bank-change recovery. Independently reconcile provider and ledger results. Live-account authorization/credentials are external; engineering of these journeys is internal |
| Pro billing | Web/native subscription lifecycle | Verify prices, versioned terms, purchase, entitlement, paid-through cancellation, renewal, failed payment, refund/revocation, restore and support. Exercise free/active/expired/under-review states in main workspaces and Paid Tools. Pro never grants trust or internal authority |
| Moderation | Report through resolution | Every enabled report needs a receipt, scoped operator queue, evidence permissions, decision/reason, reporter status and escalation/appeal. Include portfolio claims, reviews, uploads, chat, hotels and properties. Whole-journey evidence pending |
| Privacy | Account and data-rights operations | Verify profile changes, closure, access/export/deletion requests, retained financial/dispute evidence, private media expiry and consent/version changes through authorized operator actions. Coverage and operating evidence pending |
| Discovery | Search/maps/followed-search lifecycle | Verify filters, sort, pagination, empty results, map/list agreement, approximate versus entitled exact location, followed-search reopen/edit/delete and notifications from every publication/edit path. Hosted whole-flow evidence pending |
| Platform | Deployed configuration parity | Current local inventory: 26 Edge Function directories, 776 active migration SQL files and 80 SQL contracts (20 Oct). Test records 755 migrations through `20261020062733`; Production was not changed. Compare reviewed source, JWT modes, session checks, secrets, webhooks, schedules, storage and flags with each target. Confirmed management-choice/media-limit parity gaps were repaired; the remaining histories still require disposition and fresh/upgrade replay. Counts do not establish parity |
| Dependencies | Toolchain vulnerability remediation | Existing npm audit findings need reviewed remediation and regression evidence. Do not force a Tailwind major upgrade merely to clear an advisory count. Review maintained/pinned runtime/provider dependencies and preserve lockfiles |
| Reliability | Observability and recovery drills | Verification pending for error/latency/queue/payment alerts, webhook/cron recovery, idempotent retries, backup restoration, media/DB recovery, secret rotation, rollback and incident response. Record actual execution evidence |
| Legal/operations | Publication and commercial approvals | External: qualified review/approved document bodies, applicable provider/property/Hotel/Worker/consumer/tax/insurance/privacy/settlement approvals, final owner commercial decisions and operational sign-off. Internal: exercise publication/versioned acceptance/stale-version handling, consent/retention/export/deletion, required queues/runbooks/escalations and support handoff. Owner can operate launch without employees if the role journeys and response obligations are met. Evidence belongs in the existing Nigeria legal register |
| Global | Per-market expansion | Regional formatting is not multi-country transaction readiness. Destination-country snapshots, country-qualified locations, property timezone rules, currency/processors, translations, local credentials/contracts/tax and support coverage need market-specific implementation/evidence |
| Native | Signed device/store readiness | Separate evidence pending for signed iOS/Android builds, permissions/deep links, offline/update/old-tab behavior, store privacy/metadata, purchase/restore/revocation where applicable, signing and release recovery |
| Release engineering | Exact-commit CI and promotion | Working-tree checks do not replace reviewed-SHA CI, fresh/upgrade migration replay, hosted role smoke tests, environment isolation and deployment health. Prepare rollback and obtain final approval before Production promotion |
| Release | One merge to main, then close #117, #116, #110, #87, #72 | After all gates |

The Test project has both forward migrations applied through the connected Supabase environment; Docker was not required for this remote Test apply. The repository files now match the migration versions recorded by Supabase: `20261019144712_listing_reports_to_content_reports.sql` and `20261019144719_friend_first_schema.sql`. Post-apply checks confirmed `friends`, `friend_messages`, and `friend_request_log` exist; the empty legacy tables and old RPCs are gone; report storage exists; and no Friend rows, messages, reports, key envelopes or media objects were present. At that point Test history had 738 recorded migrations; the subsequent five targeted wallet/Pro/throttle repairs bring the recorded Test total to 743. Production remains at 712 and was not changed. The histories still diverge, so Production alignment requires a separate reviewed disposition; do not deploy the UI/database release to Production yet. Test advisors also report broad existing SECURITY DEFINER-function warnings; review grants and authorization for the changed functions before release rather than adding broad table policies.

## How Codex and Copilot fit together

Codex will keep the release checklist and evidence current, inspect GitHub/Supabase/Vercel state, make focused changes on the PR branch, and follow each CI failure to its source. Copilot can help you edit and review in VS Code. To avoid overwriting work, coordinate on one branch at a time: if you edit locally, tell Codex and push your commit; if Codex commits through GitHub, pull that commit into VS Code before continuing. Product decisions and external approvals stay with you and the responsible human owners.

## Progress log

- **19 Oct, property and NIN checkpoint:** Test migration `20261019202244_property_submission_fact_validation.sql` now rejects missing/fractional/negative apartment counts and invalid Hotel room capacity/inventory before submission. Studio bedrooms remain zero. The rolled-back SQL contract passed on Test; Test has 745 migration records. Production remains untouched. The Partner form shares the validation; the internal listing form also preserves zero and rejects invalid apartment counts. The internal generic Hotel creation path still needs reconciliation with dedicated Hotel inventory before it can be certified.
- **19 Oct, NIN preparation:** Owner confirmed no provider account. Added server-only provider orchestration with disabled/unapproved-provider handling, active-session and consent checks, purpose policy, authenticated-result binding, mismatch review, protected replay and receipts excluding raw NIN. No provider adapter, persistence implementation, deployed endpoint or NIN UI is wired. NIN is not required for signup. Actual verification and provider/privacy approval remain open; no verified status may be granted by format or face review alone.
- **19 Oct, verification checkpoint:** Full source suite passed 520/520 and production build passed after property/NIN preparation; focused lint and Deno module check passed. Earlier isolated report/wallet/Pro browser checks passed 50/50. The later internal listing count correction receives a focused check separately. Required property authority, Hotel operating and category-specific Worker credential evidence remain incompletely enforced; these numeric fixes do not close that release gate.

- **19 Oct:** Initial baseline checkpoint: local tests were 497/498 because Python was unavailable to launch the existing release-boundaries helper. After Python installation, the complete suite passed 500/500 (see the later Phase C entry). The exact-head test/build gates and browser interaction remain red until verified on a reviewed commit. Production domains returned 402 `DEPLOYMENT_DISABLED` despite READY Vercel metadata; no setting or database was changed. At that checkpoint migration histories were divergent and untouched; the Test-only applies are recorded below.
- **19 Oct:** Phase B reconciled the accepted regional scope: Nigeria is the first market, not the permanent product boundary; the master plan and legal register no longer call the product Nigeria-only. Product Rules now distinguish confirmed owner decisions from proposed defaults and list the five contracts that need owner/operations approval before implementation: Short Let sellable unit, Worker fulfillment modes, marketplace packages versus custom quotes, owner pause/removal, and provider response clocks. These decisions do not authorize migrations or change live behavior.
- **19 Oct:** Began Phase C on real application surfaces. Added the shared typography/interaction contract, raised legacy 7–10px Tailwind text and map/message CSS to a 12px minimum, and removed the dead Rent options action left after the rent-plan modal was removed. Added structural regression checks. Targeted design/document checks pass 5/5; lint, TypeScript and production build pass; the full Node/Python suite passes 500/500. The repository's 15-file Deno Edge Function check passed. Local Playwright installation timed out at 18.9/36.6MB; the next verification is the exact-SHA CI run. Route-level visual/device/theme checks remain open.
- **19 Oct:** Retrieved the full failed browser job log. The 320px roommate-preferences failure was a stale accessible-name expectation (`Preferred State` / `Choose preferred state`) after the component adopted region-aware labels, not a page error. Updated the test to assert the current `Preferred state or region` control and matching dialog while retaining the state/LGA selection and save checks. Local browser verification remains pending.
- **19 Oct:** Recorded the owner's Friend Groups direction and the Roommate-plus-Friend overlap contract. Added a private group product design gate because existing Friend encryption is pairwise. Clarified Experiences as a demand/supply validation pilot using provider checkout; no direct ticket money is authorized. See the proposal and the corresponding single work-register rows.
- **19 Oct:** Listing detail audit found that its Report form wrote to `listing_reports`, while the current Creator/Admin review UI reads `content_reports`. Added a repository migration and client path to the scoped queue, using listing state/city for moderation scope and returning a short report reference. Focused report, booking-share and release-contract tests pass 46/46; the production build passes (3,408 modules) on this working tree. At this checkpoint migration replay had not been performed; it was subsequently applied on Test as recorded below. Test/Production migration histories diverge, so do not deploy the UI change until that gate is safely resolved. Persistent user report status remains open; urgent Support routing still needs browser/operations verification.
- **19 Oct:** Extended the property report form with a dedicated urgent Support action carrying listing context, and made success require a returned report ID. Reworded customer actions to “Share booking cost” and renamed the active Short Let component/wrapper to booking-share language. A following Friend-first pass removed the retired term from active application source, RPC client calls, UI, docs, and contract fixtures. The forward migration references old identifiers only to rename the empty Test schema and remove historical RPC names safely. Read-only checks found no existing chat history to migrate.
- **19 Oct:** Current working-tree Node/Python suite passes **505/505**; ESLint and the Vite production build pass (3,409 modules). Exact-SHA CI, hosted role checks and browser journeys remain outstanding. Test/Production migration histories are divergent.
- **19 Oct:** Long Let review found the current product requires Year 1 rent before move-in, has a 1–5 year database tenure, and has no active client call to select tenure. Future-year contributions are paused because their Partner payout path lacks verified settlement. The owner's clarified model is recorded in `PRODUCT_RULES.md`: [historical wording superseded by the 25 October correction: one-year rent is always paid in full]; for multi-year terms, Year 1 upfront and eight monthly payments for each future year in months 5–12 of the preceding year, paid to the Partner as received; if the Partner does not accept monthly payment, the full contract total is due before booking. This model is not implemented and remains blocked on contract/legal approval, provider settlement proof and payment recovery rules.
- **19 Oct:** Applied `listing_reports_to_content_reports` and `friend_first_schema` to the Test Supabase project using its connected migration interface, without Docker. Renamed the repository SQL files to the recorded migration versions (`20261019144712` and `20261019144719`) and updated contract-test references. Post-apply catalog/data checks passed; all relevant Friend/report data counts were zero before and after the schema transition. Production was not changed. Test now records 738 migrations and Production 712, so production migration-history disposition, reviewed security checks, and role/browser verification are still required.
- **19 Oct:** Property review distinguished the existing controls: declared Partner authority relationship, private access recording, independent Field Operations evidence and scoped review. These do not prove ownership/authority or every listing claim. Worker review has a policy-gated identity check, submitted work evidence and optional certificate, but no complete category/market credential matrix. A whole-app role/device/theme/action-result audit remains open, including Roommate screens and small controls.
- **19 Oct:** Expanded the Experiences proposal into a product/data shape (Organizer, Experience, dated Occurrence), a curated provider-checkout pilot, and a distinct future booking/payment lifecycle. This earlier event proposal was superseded by the owner decision to remove shows and parties. No Experience schema or checkout is implemented.

- **12 Oct:** Confirmed GitHub PR #118 and both Supabase projects and the Vercel project are connected. Fixed the signed-out Bookings assertion and the FFmpeg setup timeout. Browser, build, database-consolidation and preview checks passed on `e1cd312`.
- **12 Oct:** Added this staged release roadmap. Remaining gates are open until their evidence is recorded; the schedule is an estimate and should be updated after Stage 0 and Stage 1.
- **12 Oct:** Added [the product coherence audit](WEHOUSE_PRODUCT_COHERENCE_AUDIT_20261012.md) from the current branch and read-only production catalog/advisor checks. No production data or schema was changed.
- **12 Oct:** Added the [R1–R11 operating model](WEHOUSE_OPERATING_MODEL_R1_R11.md), including the editable checkout review before payment, Paystack-first real-world payment plan, separate wallet/processor/store-billing tracks, and role-specific completion gates. This historical estimate has been withdrawn for the full requested scope; no production date is established while implementation and external gates remain open.

### 19 October follow-up: current evidence and active review

Targeted Test repairs now include durable wallet withdrawal receipts, Pro RPC/schema alignment, one writable job-cost amount, provider-review resolution and restored financial action throttling, in addition to the earlier report/Friend migrations. Production has not been changed. These targeted repairs do not resolve the full migration-history divergence or prove a fresh replay.

The latest full source regression run passed 513 tests, including Friend placement and plan-payload checks. The isolated browser runner now passes 41 scenarios, including shared price-control keyboard bounds/reset, payout-account timeout and persisted-request recovery, and internal finance error/unknown-outcome handling. After the Creator overview wording/refresh change, its seven behavior tests passed. The production build and lint passed. The later Creator refresh/wording change also passed its seven focused behavior tests; type validation also passed. Friend chat event presets were subsequently removed; the three Friend naming/workflow checks passed after that wording change. These checks do not prove real provider charges, settlement or all role journeys.

The owner removed shows and parties from Experiences. The event-discovery/referral proposal is superseded by the narrower activities proposal. The current review also covers Partner/Worker/Creator controls, solo-Creator operation, discovery and price controls, light/dark consistency, Pro integration and username-login wording. No full-app premium-design or global-readiness claim has been established. Login already supports username entry; its entry button now says so.
- **19 Oct, direct-creation retirement:** Removed the unused internal listing page, route, writer/exports and duplicate Hotel detail implementation. Test forward migration `20261019204555` removes both bypass RPCs; SQL contract passed with canonical submission and inventory preserved. Build, full lint and 520/520 source tests passed after source removal; later focused route/property/NIN regression passed 6/6 and Deno check passed. Product Rules contains the researched evidence/KYC target. Private document/review/publication enforcement remains explicitly internal unfinished work; external approvals are tracked separately. The roadmap delivery sequence remains the single execution plan.
- **19 Oct, final retirement regression:** Full source suite rerun after adding the route-retirement regression passed 521/521; working-tree diff whitespace check passed.
- **19 Oct, provider evidence and Pro checkpoint:** Owner accepted C-063. Private request-linked documents, independent scoped correction/review, current requirements/expiry and actual apartment/Hotel publication are implemented on Test; additive Admin/Creator grants and self-review denial pass. Canonical Inbox carries both sides' work. Restored confirmed Test management-choice and media-limit parity gaps. Added Partner Pro operating costs, recorded margin, safe shown-row CSV and retained void reasons with no wallet effect. SQL contracts passed with rollback; 530/530 source tests, full lint/build and 61 isolated browser scenarios passed, including actual light/dark new workflows. Test now records 753 migrations through 20261019220022. The full 16-area engineering scope remains open: this closes specific implementation defects and does not establish launch readiness, hosted-role verification, live KYC or whole-product completion.

### 19 October: free core features, media and presentation follow-through

- Removed the essential arrival editor from Pro. One canonical private property-arrival table and owner commands serve normal home/Hotel operations; the obsolete paid writer and mixed arrival/occupancy RPC are dropped by forward migration 20261019221843 on Test. Existing instructions are preserved. Ownership, live-session and eligible paid-guest checks remain. The updated SQL contract passes with rollback, including saving without a Pro entitlement. Production is unchanged.
- Studio means zero separate bedrooms, not an additional inventory count. The form says ?Bedrooms (0 for a studio)?; public cards/detail, Partner property detail and submitted-request detail display Studio for zero.
- All video sizes require playable finite-duration metadata, bounded loading and cleanup. Public/chat videos allow up to 90 seconds; private evidence allows 180 seconds. Source evidence now consistently accepts up to 100,000,000 bytes across Worker screens/uploader; prepared videos remain at most 13,000,000 bytes. Public source video accepts 50,000,000 bytes. Chat source attachments use 26,214,400 bytes (25 MiB), now labelled consistently; chat video preparation uses that same source budget. Property documents retain their distinct 10 MiB limit. These are content-specific limits, not proof of global capacity.
- The fullscreen viewer retries failed media in place and respects reduced motion for its loading indicator. Hosting controls and management choices use theme-appropriate foreground colours. The new free arrival editor was inspected at 320px in actual light/dark themes, including reload, read-error and lost-save recovery; isolated browser suite passes 65 scenarios. This is not a whole-route visual audit.
- No 3D renderer/library is present. Keep functional 2D motion and reduced-motion support; a future real property tour needs its own usable content/viewer/low-bandwidth path. Decorative 3D is not a launch requirement.
- Primary competitor research: Airbnb recommends home photos at least 1024 x 683 and coverage per room (https://www.airbnb.com/help/article/477); Booking.com?s connectivity Photo API accepts up to 50,000,000 bytes per source photo (https://developers.booking.com/connectivity/docs/photo-api/managing-photos). API input limits do not establish their guest download budgets or justify increasing every WeHouse limit. Responsive image derivatives, delivery/cache costs, load/capacity evidence and the full upload/view role matrix remain release work.

The existing sixteen-area release inventory remains authoritative. Core/free boundary review is ongoing beyond the confirmed arrival defect. Missing Experiences, Friend groups, monthly-rent/shared-cost workflows, payment recovery/verification, hosted role journeys, migration replay and launch operations are still engineering gates, not merely external approvals.

Final evidence for this follow-through: 533/533 source tests, 65/65 isolated browser scenarios, full ESLint and production build passed. Python was already available through the downloaded installer; installer setup/repair completed successfully, and the full Python-dependent checks required execution outside the filesystem sandbox. The theme-token inventory found one genuinely undefined announcement danger-text token; it now has explicit light/dark values. Optional conversation/swipe tokens have fallbacks or runtime values and were not renamed blindly. Guest arrival reads and Pro occupancy now have bounded requests and recovery states. Full hosted and complete-route verification remains open.

### 19 October: property grouping clarification and capacity-check repairs

Studio describes an open sleeping/living layout with no separate bedroom. It is not another marketplace, property inventory count, feature or paid tier. Existing schema branches remain Apartment -> Short Let/Long Let, and Hotel -> room types, physical rooms, rates and date inventory. No additional property categories or 3D work were added. The submission field now explains studio in plain language with a linked accessible description, theme-aware borders and visible keyboard focus. Partner details use the canonical Apartment/Hotel and Short Let/Long Let labels instead of raw stored codes; Hotel submissions no longer show irrelevant apartment bedroom/let fields. Hotel operators see "rooms of this type" and "Edit room type." Missing guest capacity displays Not specified rather than inventing one guest.

Comparison reviewed from primary sources: Airbnb separates the space booked (entire place/private room/hotel room/shared room) from home/property descriptions (https://www.airbnb.co.uk/help/article/5); Booking.com groups sellable units beneath properties and combines them with rates and availability (https://developers.booking.com/connectivity/docs/rooms-api/introduction-to-rooms-api). WeHouse's supported range can remain smaller. Independent room/shared-room selling, additional home categories and the complete sleeping-arrangement/whole-unit contract must not be presumed implemented merely because other platforms support them.

Fixed the existing read-only Test catalog checker so slow individual routes, incomplete warm-up, missing measurements and a delayed load generator cannot receive a passing result just because HTTP errors are zero. It now gates p95, validates sample accounting/dispatch rate, stops escalation after a failed stage and records scoped pass/failure evidence. Four checker tests pass; the full source suite passes 537/537. The dedicated Test fixture is still 1,000 synthetic homes/1,000 synthetic hotels and zero Auth users. No hosted load run was performed here; historical catalog results do not establish signed-in bookings, money, messaging, media or sustained global capacity. Existing capacity and release documents remain the authorities.

Verification update for property grouping/capacity-check repairs: full regression suite 537/537; production build and focused lint passed. The hosted checker also persists an explicitly non-passing running/partial report after each completed stage so an interrupted run cannot be mistaken for a completed pass. No Production change, new hosted load result or whole-product readiness claim is included.

20 October owner clarification: Studio is a layout description that can apply to either Short Let or Long Let. It uses the selected let type's existing booking/payment/cancellation rules; there is no separate Studio product, paid tier, inventory table, policy or release dependency. The explanation/helper text is complete. Further studio-specific work is not scheduled.

### 20 October: both accommodation arrangements confirmed; payout recovery repaired

The owner explicitly confirmed multiple self-contained apartments per building and separately let private bedrooms, for both Short Let and Long Let. C-064 records this accepted direction and supersedes the earlier whole-home-only recommendation. The original inspection found no parent-space relationship. Test now has the canonical property_spaces registry with listing/inspection/booking projections and overlap guards; grouped inventory presentation, allocation and full concurrency proof remain internal work. Existing listings/reservations and Hotel room inventory remain authoritative. Partner building grouping, per-space authority/terms/calendar and sibling/whole-unit overlap protection are one supply workstream in this register, not additional product sections.

Compared primary Airbnb guidance on multiple rooms (https://www.airbnb.co.uk/help/article/289) and Booking.com room inventory (https://developers.booking.com/connectivity/docs/b_xml-availability). Airbnb gives separately offered rooms distinct listings/calendars; Booking.com manages quantities/rates/date availability at room-type level. A property grouping alone cannot stop overlapping sales of the same physical space.

Continued the money-recovery workstream: payout-account provider requests lacked an explicit deadline. Added a 12-second request deadline and a single 12-second budget for paginated recipient reconciliation. Mutation timeout is not automatically retried, and reconciliation remains pending/uncertain without saving/promoting an unconfirmed destination. Four payout tests and the Deno type-check pass; full source suite 541/541 passes. Deployed Test payout-account version 5, JWT verification true; retrieved deployed files match the reviewed entrypoint and unchanged shared helpers. No provider transfer or authenticated bank-save journey was performed, and Production was unchanged. Fresh-sign-in/OTP replacement remains deliberately unavailable until implemented.

Found and corrected a duplicated decision ID: C-060 remains announcements; identity/provider documents are C-063, with their audit/roadmap references corrected. Added a uniqueness/placement regression check. This is documentation consistency repair, not a change to identity requirements.

Remaining scope is substantial: the accepted property/space hierarchy, monthly-rent and Hotel shared-cost contracts, Experiences and Friend groups still need implementation, alongside money/provider recovery proof, complete hosted-role/device/theme checks, migration replay and operational release evidence. These are engineering gates; the product is not yet engineering-complete pending only external approvals.

### 20 October: management controls and customer/Experiences clarification

Continued the existing money/provider/release programme; prior payout-account v5 and canonical wallet work remain in place. This checkpoint addresses actual property-management failures. Management reads now time out, validate the property/assignment response, discard stale results and offer visible reload/support. Rejected management/co-host commands release a synchronous action lock, require valid returned state/receipts and do not display unconfirmed success. Pending-invitation failures are visible and have refresh controls; failed withdrawals release their lock. Short Let arrival and Long Let handover confirmations recover after thrown requests. The unused PropertyHostInvitations UI and its old RPC references were removed; backend legacy APIs were not dropped without a full dependency/permission review. Both management palettes use shared surfaces and readable status colours, with an accessible co-host identifier field.

Found a server defect: re-inviting an active co-host could reset their active assignment to invited. Test forward migration 20261020062733 now rejects that operation and reuses an existing matching pending direct invitation on retry. Changing pending permissions deliberately replaces the invitation. The rollback SQL contract verifies retained active access, one pending receipt/notification, permission replacement and outsider denial. No fixture profiles/invitations remain. Test now has 755 migration records; repository has 776 active migrations and 80 SQL contracts. Production is unchanged.

Evidence: full source suite 545/545, production build and focused lint pass; isolated browser suite passes 79 scenarios, including management read failures/malformed data/timeouts, mutation/invitation receipt/withdrawal failures, host/WeHouse-pending/WeHouse-approved/co-host controls, Short Let arrival/Long Let handover recovery and 320px actual light/dark screenshots. Inspected both management screenshots after finite theme transitions completed. These are isolated UI plus Test SQL checks, not deployed multi-account or provider-payment proofs.

Customer direction for pure Long Let, pure Short Let and mixed buildings is one property/space structure with matching available spaces, comparable price basis, private/shared disclosures and the actual approved operator. Core building-space inventory remains unfinished. Host-managed and WeHouse-managed are operating assignments, independent of let/layout and requiring scoped permissions and reviewed handoffs. The current public detail lacks a complete operator/space projection; customer disclosure and booking snapshot parity stay open.

Experiences remains unimplemented. Updated the existing activity proposal with category-as-data over activity/session/booking, category-specific evidence/safety gates and the complete customer lifecycle. No new Experiences tile or partial checkout was added. Primary comparison sources: Airbnb co-host permissions (https://www.airbnb.com/help/article/1534), Airbnb activity ground rules (https://www.airbnb.com/help/article/3855), Booking.com Attractions (https://developers.booking.com/demand/docs/attractions/about-attractions). A permission matrix and a management agreement are distinct; WeHouse acting as operator must be explicit, not inferred from platform verification.

Plain-language release glossary: **hosted role/payment checks** means the deployed Test app is exercised with separate signed-in customer, Partner, operator and outsider accounts plus payment-provider sandbox events. Check bookings, receipts, earnings, cancellations/refunds and denied cross-account access at the browser, API and stored-data layers. This has no connection to the label Host manages and is not a request to test with real customer funds.

Final management follow-through: the complete isolated browser run passed 79 scenarios; after the final refresh-control changes, a focused 14-scenario management/arrival replay passed and both 320px theme artifacts were regenerated. Source tests remain 545/545, with production build, focused lint and Test SQL contract passes. The focused runner writes results-management.json so it cannot overwrite the full results.json evidence. Security advisors still require the established role/body review; aggregate executable-function warnings are not counts of proven vulnerabilities.
