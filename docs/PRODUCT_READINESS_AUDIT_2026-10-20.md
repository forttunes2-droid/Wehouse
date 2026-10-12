# WeHouse product-readiness audit

Date: 20 October 2026  
Repository commit at start: `f990fc4a` (`main`, 10 October 2026)  
Scope: current shared worktree, Phase 2/3 completion notes, product/release
registers, local automated checks, and available GitHub Actions evidence.

## Executive decision

WeHouse is a substantial, functioning product codebase with role-based
workspaces, housing and service discovery, bookings, messaging, account
controls, payment protections, and optional Pro feature surfaces. The current
code builds and lints, its 483 Node regression tests now pass, and the
committed 10 October revision had successful build, regression, and database
migration-replay CI.

That evidence does **not** establish that every screen has been visually and
interactively audited, that every role can complete its real job, that payment
and refund operations work against the provider, that the security boundary
has passed an adversarial review, that native store releases are ready, or that
the product can safely serve one million users. The defensible claim today is:

> WeHouse has a substantial web-app foundation and meaningful automated
> engineering coverage. It is not yet evidenced as production-ready across all
> roles, money flows, devices, legal obligations, or large-scale traffic.

Do not describe the present evidence as “every screen audited,” “secure from
attack,” “App Store/Play Store ready,” or “million-user ready.”

## Audit boundary and evidence

This was an audit-first pass. It did not access production customer data, make
production changes, run a penetration test, or perform a live payment. The
workspace is shared and already contained staged and unstaged changes. Those
were preserved. The only source edit during this pass was to update a stale
static regression assertion so it recognizes the current browser-history
route payload; no application behavior was changed.

| Evidence | Result | What it proves / does not prove |
|---|---|---|
| Local `npm test` on the current worktree | **483 passed, 0 failed** | Node regression tests pass; not equivalent to live role journeys or visual QA. |
| Local `npm run lint` on the current worktree | **Passed** | ESLint found no lint errors; not a security certification. |
| Local `npm run build` on the current worktree | **Passed**; TypeScript and Vite production build completed | The web bundle compiles. Vite also reported an empty `vendor-react` chunk; it was non-blocking. |
| GitHub Actions for commit `f990fc4a` (10 October) | **Passed**: build check, structural regression, consolidation validation | Included lint/test/type/build/Edge-function checks and migration replay/account-upgrade jobs for that committed revision. The shared worktree has newer uncommitted edits, so this is not CI evidence for those edits. |
| Interactive UI / device QA during this pass | **Not performed** | No claim that each page, role, theme, viewport, or native shell was manually inspected. |
| Hosted Supabase, Paystack, App Store / Play Console, production deployment | **Not exercised or reverified** | Current external settings, credentials, deployment health, and real-provider outcomes remain unknown. |

For this pass, the local machine had no `psql`, Supabase CLI, Docker/Podman,
Xcode, Android Gradle toolchain, or `adb`. A signed Node/npm runtime was
installed under temporary storage only because Node was absent; repository
dependencies and manifests were not changed to provision it.

## What was inventoried

The repository contains approximately:

- 402 files under `src/`, including 51 page modules, 201 components, 25 hooks,
  and 109 library modules.
- 30 Supabase Edge Function files.
- 711 SQL migration files and 55 SQL contract files under `supabase/tests/`.
- 164 files under `tests/`, including 81 top-level Node test files, 77 browser
  test/fixture files, and two visual repair-fixture files.
- A large, custom navigation/workspace state machine in [src/App.tsx](../src/App.tsx);
  [src/types/nav.ts](../src/types/nav.ts) defines the application page keys.
  `react-router` dependencies are present but are not the app's routing
  authority.

This is a source and test inventory, not a line-by-line audit of all 402 source
files or a screen-by-screen visual sign-off.

## Findings by product area

### 1. Phase 2 and Phase 3 claims

The supplied Phase 2 and Phase 3 notes are dated 14 August 2026. They document
useful authentication, onboarding, and dashboard/workspace structure work.
They do not close later QA:

- Phase 2 explicitly leaves interactive signed-in browser testing outstanding.
- Phase 3 is a structural unification pass, not a visual redesign, and
  explicitly leaves signed-in cross-device visual regression for a later QA
  phase.
- The Phase 3 structure and unification reports say that one workspace owner
  per role, role-specific navigation, and controlled Staff/Admin assignment
  were the intended outcome. These are design/completion notes, not current
  evidence that all of those workflows pass on every account and device.

**Decision:** describe those phases as structural work completed with later
validation still open—not as a complete product audit.

### 2. Navigation, refresh, and screen ownership

Navigation is implemented as a page-key state machine in `App.tsx`, backed by
hash/history and browser storage, with allowlisted route parameters in
[src/lib/navigationRoute.ts](../src/lib/navigationRoute.ts). Unit tests cover
parameter allowlisting, context round trips, and retaining a valid requested
route through sign-in. The full test run passed after aligning one old static
assertion with the current `pushState` shape.

The code and test coverage do not establish a complete browser Back/Forward,
refresh, deep-link, workspace-switch, and sign-in matrix for every route and
account state. Multiple role shells and nested conversation/detail pages also
make route ownership a continuing regression risk. Refreshing a page is not
proof that record access is authorized; the server must still decide access.

**Decision:** routing has meaningful source-level regression coverage; finish
the real browser/history matrix before calling routing “fixed everywhere.”

### 3. Light and dark appearance

Both palettes exist as shared WeHouse CSS tokens in
[src/index.css](../src/index.css); startup and appearance synchronization are
implemented in [public/bootstrap.js](../public/bootstrap.js) and
[src/lib/appearance.ts](../src/lib/appearance.ts). Automated tests cover saved
preference, document theme, color scheme, and browser chrome metadata.

A source search found roughly 3,690 token references alongside roughly 652
literal/utility color references. Some literal colors are intentional semantic
colors or compatibility styling, so this count is not a defect count. It does
mean token usage is not universal. No complete light/dark screenshot,
contrast, keyboard, focus, or viewport review was performed for all pages.

**Decision:** the theming foundation is present and behavior-tested; consistent
visual quality and accessible contrast across every page remain unverified.

### 4. Signup, age, legal consent, and account access

Signup offers public roles and later onboarding requires a date of birth,
location, and current legal-document review. The date of birth is written to a
private eligibility table, and a database trigger blocks first profile
completion unless the stored birth date is at least 18. That is a useful
server-side eligibility gate, but the date is self-declared; it is not
identity-verified age assurance. Biometric/face identity checks are separately
blocked pending legal and privacy controls.

The Phase 2 note records checks for public role restrictions, identity
ownership, profile completion, multi-device sessions, and suspended/banned/
deleted account routing. Those claims are not a substitute for current
two-account signed-in QA of signup, OAuth callbacks, email confirmation,
recovery, device revocation, account closure, and every role transition.

**Decision:** the adult declaration and legal-review gate have implementation
evidence; identity assurance, account lifecycle, and all provider journeys
still need explicit test evidence and approved policy.

### 5. Authorization, privacy, and security

The intended security boundary is server-side: Supabase RLS, narrow RPCs,
workspace grants/scopes, and Edge Functions. Recent migrations include
workspace-scoped storage controls and a migration that revokes browser grants
on RLS tables with no policies. The repository also has SQL contract tests and
CI migration replay evidence for the 10 October commit.

This audit did **not** execute the 55 SQL contracts locally or against an
authorized Test project, inspect live grants/policies, or test cross-account
access. The repository's account/database review records that some privileged
routines had not yet been checked action-by-action for grant revocation and
branch scope. Later code may have changed those call sites; this audit did not
prove their closure. Revalidate them against the current schema and tests
before treating authorization as complete. The broader product rules also
record that some state and permission behavior still exists in multiple
generations of UI, RPC, RLS, and compatibility logic.

No exploitable vulnerability was confirmed by this scoped review. That is not
a finding of “no vulnerabilities”: there was no penetration test, hostile
account testing, live configuration review, or complete 30-function threat
review. Historical documents also list leaked-password screening and
production provider settings as external checks; their current status was not
reverified.

**Decision:** security design has substantial controls and useful regression
contracts, but needs a current actor/action/scope authorization matrix, hosted
cross-account tests, and an independent adversarial review before a strong
security claim.

### 6. Bookings, chat, jobs, and money

The code has explicit booking and payment state logic, scoped conversation
surfaces, webhook-signature handling, reconciliation functions, and multiple
regression/SQL contracts. These are meaningful building blocks, not proof of
end-to-end operation with Paystack. The release documents still call for
Paystack sandbox purchases/refunds/webhooks, two-account message and call
journeys, hosted reconciliation, and representative account/device testing.

The latest capacity/release evidence documents a 3,000-user booking burst with
no reported errors but p95 latency of **43.43 seconds** on a disposable local
baseline. That is not an acceptable claim of fast, production-scale service;
the same documents explicitly say this is not a hosted capacity pass. Realtime
fan-out, inbox/unread reads, media, payment webhooks, refunds, restore, and
recovery under real traffic remain unmeasured.

**Decision:** do not enable real money or claim money-flow readiness until
provider-sandbox purchase, duplicate/delayed webhook, cancellation, refund,
dispute, ledger, payout, and recovery journeys pass with isolated test
accounts and independently checked financial outcomes.

### 7. Service worker, Pro, and native stores

The service worker is deliberately small: it installs an offline page, checks
for worker updates, and uses the offline page only when a same-origin
navigation request fails. This audit did not exercise first install, offline
startup, update/old-tab behavior, cache cleanup, or native WebView behavior.

Worker Pro and Property Partner Pro surfaces exist. The Pro assessment dated
30 September says reminders are in-app while the business-tools screen is
mounted—not background, email, or push reminders—and describes product/value
and provider verification still required. Native purchases require StoreKit or
Play Billing plus server verification and remain gated. The native release
documents state that no signed iOS release or Xcode simulator/device build was
completed in this Linux workspace. Android signing, device testing, store
metadata, restore/refund/renewal, and production entitlements also remain
external launch gates.

**Decision:** native application scaffolding exists; App Store, Play Store, and
native purchase readiness are not established. Do not market mounted-screen
reminders as push notifications.

### 8. Legal, operational, and launch controls

The Nigeria launch register still identifies open legal/operational gates for
the Worker marketplace, privacy/NDPA, payments and protected funds, property
and hotel operations, messaging/moderation, staff/field operations, and tax
and insurance. Paid Worker/Partner sales, biometric checks, and native sales
are designed to fail closed until their required controls are approved.

These are not code-only tasks. They require qualified legal/provider review,
named operational owners, support/escalation procedures, retention and restore
drills, and recorded approval. This audit did not change live settings or
independently verify those approvals.

## Remaining work, in release order

| Priority | Work | Evidence required to close |
|---|---|---|
| **P0 — before public transactional launch** | Complete the legal and PSP operating model for the actual Nigeria marketplace, protected booking money, refunds, payouts, property/hotel obligations, privacy, moderation, and support. | Written current approvals; approved customer/worker/partner terms, cancellation/refund rules, privacy/retention processes, complaint escalation, named owners, and verified fail-closed launch settings. |
| **P0 — before handling real money** | Exercise complete booking/job payment and cancellation/refund/dispute journeys. | Paystack sandbox and signed webhook tests for success, wrong amount/currency/environment, duplicate/out-of-order/delayed delivery, provider timeout, refunds and reconciliation; two independent actor accounts; ledger and provider outcomes agree. |
| **P0 — before a security claim** | Finish an action-by-action RLS/RPC/Edge Function review, including legacy privileged routines and storage/public projections. | Test each role and grant state against permitted and denied reads/mutations, revocation, geographic scope, account suspension/closure, and cross-account media/message access; review deployed configuration separately. |
| **P1 — before calling the whole UI audited** | Run the actual role-by-role screen and journey matrix across phone, tablet, and desktop in light and dark modes. | Recorded screenshots and interaction results for each route/workspace, including keyboard/focus, contrast, validation/error/empty/loading states, refresh/back/deep links, and account/workspace switching. |
| **P1 — before native-store claims** | Build, sign, and test iOS and Android artifacts and their store purchase flows. | Real simulator/device evidence, OAuth/deep links, safe areas/status bars, permissions/media, restore/renew/refund flows, production signing, store metadata, and backend transaction verification. |
| **P1 — before a scale claim** | Run staged, hosted, mixed authenticated load and recovery tests on isolated representative infrastructure. | Agreed traffic/latency/error targets; staged sustained runs with p95/p99, database/Realtime/provider limits and cost; no overbooked inventory, duplicate money, cross-user disclosure, or unreconciled provider outcomes; restore and rollback drills. |
| **P2 — structural quality** | Reduce ongoing navigation/schema drift and keep completion documents current. | Incremental route/shell ownership plan, migration replay/upgrade checks on every schema change, measurable removal of legacy aliases, and dated evidence linked to each readiness claim. |

The current scale target should be stated as **unknown and unqualified**, not
“one million.” A million registered accounts, daily users, simultaneous
foreground sessions, Realtime connections, and requests per second are
different workloads. Agree the workload and service-level targets before
running larger tests; do not run a million-user experiment against production.

## What can credibly be said now

> I have built a substantial WeHouse web-app foundation with customer,
> Worker, Property Partner, Staff, Admin, and Creator workflows; both theme
> palettes; account, discovery, booking, messaging, and payment-protection
> code; and a meaningful automated test/build pipeline. The current worktree
> passes 483 regression tests, lint, and a production web build. It is still
> undergoing release QA: real-provider money flows, complete role/device
> journeys, independent security verification, legal approvals, native-store
> releases, and measured production scale are not yet proven.

That is a strong and honest product-development claim. It is not yet a claim
that all screens or production launch gates are complete.

## Reconciliation addendum (2026-10-21)

Verified in a real Chromium run and by 483/483 tests, lint and build:

- Offline screen: its retry button was dead under the production CSP (inline
  handler). It now uses `/offline.js`, follows the saved theme, retries on
  reconnect, and the service worker precaches its assets.
- Sign-out now also deletes the local property-draft IndexedDB database.
- Worker occupation inference no longer maps "phone/computer repair" or any
  "technician" to Handyperson.
- Light mode: invisible text on profile/conversation surfaces, legal pages,
  solid violet buttons and red/amber/emerald notices was corrected through
  tokens and a guarded remap. A scan of the guest routes (terms, privacy,
  login, hotels, roommates, services, search) at 390px and 1280px in both
  themes reports 0 low-contrast text.
- Pull request disposition: #117 is included. #87 is already in main. #116 and
  #72 are superseded by main. #110 conflicts and would regress light-mode
  overlays; do not merge it.

Still unverified: signed-in screens (chat, bookings, wallet, Pro, onboarding)
under the contrast scan, the z-index layering map, backend followed-search
matching on edited listings, Paystack sandbox journey, native builds, load
staging and legal approvals.
