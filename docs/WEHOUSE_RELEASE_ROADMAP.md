# WeHouse release roadmap

**Status date:** 19 October 2026
**Working branch:** `reconcile/readiness-baseline-20261012` (PR #118)  
**Purpose:** take WeHouse from a substantial codebase to one verified, supportable web product. R1–R11 remain the engineering checklist; this document adds an execution order, owners, evidence, and a realistic release window.

## What “finished” means

WeHouse Web v1 is ready for a controlled public release only when all of these are true:

1. The reviewed commit passes required GitHub checks, including the browser journeys, build, lint, tests, migration validation, and upgrade checks.
2. Vercel has a successful preview for that exact commit; production uses the approved commit and expected environment. Vercel preview readiness is verified per exact reviewed commit; production promotion remains a separate release approval.
3. The route and journey inventory covers signed-out and signed-in users, each enabled workspace/role, empty/loading/error/success states, refresh/back/deep links, and phone/tablet/desktop in light and dark themes. Every in-scope journey has recorded evidence and no unresolved release-blocking defect.
4. The production and test Supabase histories have been compared read-only. Every difference has an explained disposition. No migration is applied just to make the two environments look alike.
5. Security, money movement, privacy, support, and operating rules have owners and pass their release checks. Any feature without the required approval stays disabled.
6. Recovery, monitoring, and rollback steps are documented and exercised for the web release.

A green build alone is not product completion. Native-store release and a capacity claim are separate targets with their own evidence.

## Current baseline

## Phase execution status — 19 October 2026

This roadmap is the single implementation status report, per the documentation
index. “Built”, “locally verified”, “CI verified”, “merged”, “migrated” and
“production verified” are distinct states.

| Directive phase | Status | Evidence and remaining gate |
|---|---|---|
| A. Verified baseline | Complete, read-only | [Product coherence audit](WEHOUSE_PRODUCT_COHERENCE_AUDIT_20261012.md) covers repository/PR, CI, Vercel, Supabase histories/advisors, product findings and roles. No production or test database writes. |
| B. Product contract | Reconciled; owner choices open | Product Rules, Decision Log, Roles & Permissions and domain contracts are indexed in [docs README](README.md). Nigeria is the first market, not a permanent boundary. Five unresolved workflow rules remain explicit. |
| C. Design and interaction | Foundation implemented; route review open | [Design System](DESIGN_SYSTEM.md), theme-aware readable type floor, and the Listing Detail stale Rent options removal. Full route/role/device/theme, navigation and accessibility evidence remains open. |
| D. Data and business architecture | Read-only findings complete; changes gated | Migration histories diverge across repository/Test/Production. Security advisor rows require function and policy review; no setting or schema was changed. Version dispositions and an ordered Test plan are required before DDL. |
| E. End-to-end workflows | Incomplete | Payment-provider verification, Short Let review, owner lifecycle, hotel reporting/discounts, worker fulfillment/packages/response clock, and several admin/Creator/invitation journeys remain in the work register. |
| F. Performance and capacity | Partial; bounded stages green | On exact SHA `449d8ccd`, the hosted Test catalog passed 1–200 RPS: 6,000/6,000 at 200 RPS, 0 errors/retries/drops, 221ms p95. The disposable medium catalog replayed migrations, seeded 50k homes/100k hotels/50k profiles, confirmed indexes and query plans, and completed its read/resource stage. 1,000 RPS was not run; these are catalog/read tests, not end-to-end or payment capacity evidence. |
| G. Regression and release gates | Local checks pass; browser rerun required | On `449d8ccd`, Structural Regression, Build Check, Consolidation Validation (including replay/contracts/upgrade), Capacity Stage 1, both catalog stages, and isolated mixed-journey preflight passed. Experience Browser media compression, Account motion, Partner Pro captures, and startup-recovery passed. Isolated interactions found stale “Preferred LGA” test labels at all widths and a clipped bookings status filter at 320px. Working tree now uses the current “Preferred city or area” label and wraps the bookings status filters; full local Node/Python suite passes 500/500, focused tests 20/20, lint and production build pass. These working-tree fixes still need exact-SHA CI. |
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
  Vite/React work; the user is installing Docker.

### Next exact actions

1. Commit the current city-label and 320px filter-wrap corrections, then review
   the exact-SHA Experience Browser rerun and all assertions.
2. Continue the route-level design review and apply focused, regression-tested
   fixes for proven visual, navigation and accessibility defects.
3. Continue read-only database/security review and prepare migration dispositions
   without applying them.
4. Continue end-to-end journey review and fix independently actionable defects;
   keep product-choice-dependent behavior gated.
5. Review the complete diff and rerun applicable gates. Request exact-SHA CI and
   preview through the established branch workflow; Production merge, migration
   and deployment remain separate release-authority steps.

- PR #118 remains open, unmerged and mergeable at `4283d6d1856e5e36665cb6c49048a987ab25c4f7`. The working tree contains uncommitted implementation and documentation changes; review `git status` and the full diff before integration. Exact-head Structural Regression, Build Check and the application-build job in Consolidation Validation failed. The original failure is the removed rent-plan modal leaving a dangling `setShowPlan` callback at `src/pages/ListingDetailCore.tsx:955`. The local correction removes the obsolete “Rent options” action/callback, retains contract-rent payment and labels the stored period “Tenancy term.” Local TypeScript, lint and production build pass; exact-head CI has not yet tested the local fix.
- The exact-head Experience browser run completed: media compression passed, but `tests/browser/stabilisation_practical.py` failed the 320px preferences case because the test queried a button named `Preferred State`, while the current shared control is labelled `Preferred state or region`. The error was a 30-second locator timeout; page errors were empty. The test also expected the obsolete `Choose preferred state` dialog name. The regression check now follows the current accessible labels while preserving the same location-selection journey. This local test correction still needs a local browser run and exact reviewed-SHA CI. Consolidation migration replay, database contracts and existing-account upgrade passed. Capacity Stage 1, mixed-journey preflight and the disposable medium catalog passed. The hosted Test catalog failed at 200 RPS after passing through 100 RPS. GitHub reports Netlify success and Vercel failure for this SHA. Results are SHA-specific; older successful checks do not close the current gate.
- The hosted Test catalog completed 30/30 at 1 RPS, 150/150 at 5, 300/300 at 10, 750/750 at 25, 1,500/1,500 at 50, and 3,000/3,000 at 100 with no errors, retries, or drops; 100 RPS p95 was 350 ms. At 200 RPS it completed 6,000 requests with 1,091 errors, 2,182 retries, 0 drops, and 1,457 ms p95. The 1,000 RPS test has not run. This is a hosted Test catalog RPC test, not end-to-end app or payment capacity evidence.
- Read-only migration inventory on 19 October found 757 executable repository migration files, 736 recorded in WeHouse Test, and 712 in WeHouse Production. The version sets are not simple prefixes; both live histories contain versions absent from the working migration directory, and local versions are absent remotely. Treat this as an unexplained history divergence, not as an instruction to apply every local migration. Produce a version-by-version disposition and Test-specific ordered release plan before any DDL or migration-history action. No database writes were made during this inventory.
- Vercel metadata lists a READY production deployment on `main` commit `f990fc4a8d6b508badb232de0b071f13109e615b`, but the project currently reports `live: false`; requests to `wehouse.com.ng`, `www.wehouse.com.ng` and the listed deployment URL return HTTP 402 `DEPLOYMENT_DISABLED`. Treat public production as unavailable until the Vercel owner restores it and a smoke test succeeds. No deployment setting was changed. The current PR head has no matching deployment.
- Supabase Test and Production are `ACTIVE_HEALTHY` on PostgreSQL 17.6.1.166 and 17.6.1.121. Current advisors are inventories, not proven vulnerability counts: Production has 39 RLS/no-policy INFO, 15 anon and 506 authenticated callable SECURITY DEFINER WARN, 16 unindexed foreign keys, 17 multiple-permissive-policy warnings and 198 unused-index INFO; Test has 49, 17, 551, 19, 17 and 274 respectively. Production leaked-password protection is disabled. Review function-by-function, confirm query/policy semantics before changes, and do not drop indexes based only on unused-index warnings.
- The repository's `scripts/coordinated-database-release.py` is explicitly restricted to the Production database connection; it cannot safely be used as a Test-project check/apply tool. The direct Supabase reads here compared project histories but did not run that coordinated script. Do not apply migrations until a Test-specific ordered release plan preserves exact versions and explains history differences.
- “Friend” is the approved user-facing name. Older decision-log and roadmap wording contradicted that decision; the decision log has now been aligned. Internal `companion` identifiers remain for database/API/storage compatibility.
- Product readiness is not complete: live Paystack charge/webhook/refund journeys; the failed Short Let review journey; Owner pause/unlist/removal behavior across all property types; Hotel Friend split and hotel discount rules; service fulfillment modes, package selection and response deadlines; security-password/step-up verification; provider/Creator/Admin/Staff dashboard checks in both themes; and role-by-role phone/tablet/desktop visual checks still need evidence. The 2–4 week release-candidate window below is a planning estimate only and is no longer dependable until these checks close.

## Delivery sequence and ownership

| Stage | Target window from 12 Oct | Owner | Exit evidence |
|---|---|---|---|
| **0. Stabilize PR #118** | Original window 12–16 Oct elapsed; close on a reviewed current head | Codex: inspect and fix code/docs; user: confirm product rules where authority is unclear | Required CI and browser journeys pass on the reviewed SHA; that SHA has a successful preview; known failure causes are fixed rather than waived. No production change. |
| **1. Establish live baseline (R1, R4, R8)** | Original window 13–20 Oct; in progress | Codex: read-only comparison and evidence; user/admin: provide platform access or approve admin-only settings | One source-of-truth map links product rule → route/component → database/Edge Function enforcement. Every Production/Test/repository migration difference has a read-only disposition. Vercel production/preview settings and environment separation are recorded without exposing secrets. |
| **2. Close release-blocking product defects (R2, R6, R7, R9)** | 19–30 Oct | Codex + Copilot, one editor/branch at a time; user resolves product decisions | High-severity inconsistencies are fixed or explicitly disabled; each behavior has a regression check. Role/action security review covers RLS, RPC grants, storage, and Edge Functions. No unresolved critical or high defect in the v1 scope. |
| **3. Complete web journey and quality pass (R10, R11)** | 26 Oct–6 Nov | Codex: test matrix and fixes; user: review the actual product and approve scope | Route/workspace matrix passes at agreed device widths and themes. Loading, empty, validation, error, and success states are verified. Browser console has no uncaught app errors; accessibility and agreed performance budgets are measured and pass. CI remains green. |
| **4. Web release candidate** | **Estimate: 2–4 weeks from 12 Oct (26 Oct–9 Nov)** | Codex prepares the reviewed release; user owns release approval and operational readiness | Candidate is deployed from an approved SHA; smoke checks pass on the actual Vercel preview; rollback and monitoring are ready; required legal/security/provider gates for the enabled features are signed off. |
| **5. Public transactional launch** | **Date not estimable yet** | User/business owner + payment, legal, support and security owners; Codex supplies technical evidence | Nigeria operating/legal model is approved; Paystack sandbox and signed webhook flows pass, including retries, duplicates, refunds, and reconciliation; a pre-payment review/edit screen and server-side price/inventory revalidation are verified; support/privacy operations are staffed; independent security review and recovery evidence are accepted. Google Pay is considered as a Paystack web wallet method after account/country enablement; Flutterwave is a later optional processor; native digital subscriptions/features require a separate Apple/Google billing policy and receipt-verification track. |
| **6. Native stores and scale claims** | Separate follow-up | Native release owner and infrastructure owner | Signed iOS/Android device/store evidence and server-verified billing; workload-specific hosted tests, agreed latency/error targets, cost limits, and recovery results. Never test against production with destructive or synthetic load. |

The 2–4 week estimate is a planning range for a web release candidate, not a guarantee of public transactional launch. It assumes prompt review, access to the existing preview/deployment configuration, and no newly discovered architecture or security blocker. External legal/provider approvals can extend the public launch date.

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

Status: **Done** = built and DB-tested in CI. **Built** = built, not yet verified on the live test project. **Open** = not built. **Codex** = needs Supabase/Paystack access.

| Area | Item | Status |
|---|---|---|
| Security | Hotel data exposure fix | Done |
| Security | Admin extra security password (extend Creator step-up) | Codex |
| Reports | Report in Roommate, Friend, worker, hotel chats and profiles | Built; CI contracts pass, hosted user flow still needs full check |
| Reports | Admin and Creator queues with state and local-area scoping | Done (state and branch/LGA contracts pass in CI) |
| Connections | Roommate cancel, 30-day wait, other person notified | Done |
| Connections | Friend list limit of 5, requests, chat and split pay | Built; two-device E2EE and real-device theme check remain |
| Connections | Friend request daily cap and expiry | Built: unanswered requests expire after 24 hours; 10 per person per day |
| Connections | Friend chat: encrypted messages, media and controls | Built; internal storage path remains `e2ee/companion/`; two-device encryption check remains |
| Connections | User-facing name | Friend confirmed; internal database/API objects retain `companion` |
| Connections | Hotel and Friend conversation-info screens | Open |
| Pricing | Short Let host discount 5-50% in the price pipeline, shown on listing | Built |
| Pricing | Discount on the posting form | Built (Short Let, optional field when posting; applied right after the listing is saved) |
| Pricing | Creator WeHouse-funded discount control | Built and commission-capped in current migration; docs still conflict on whether the campaign cap is 15% or commission-only—reconcile before campaigns |
| Pricing | Long Let discount (host 5-50% + WeHouse share capped by Long Let commission, Year 1 rent only, partner payout protected, migration `20261012370000`, DB test) | Built |
| Pricing | Hotel discounts | Open (hotels price through rate plans; needs an owner choice) |
| Pricing | Display, charge and refund agree on the test project | Codex |
| Account | Email-change flow and recovery policy (C-035) | Open; no owner decision recorded |
| Reliability | One shared action pattern (`src/lib/safeAction.ts`): a second tap joins the first request, clear offline message, no false success. Applied to Short Let booking, payment, cancel, Friend requests and Friend chat. Other actions and a visible Retry button | Built (partly applied). Server side: Short Let booking and posting a listing carry a UUID key stored for 24h (`idempotency_keys`), so a repeat returns the first result. Payment already has a unique reference; other actions still open |
| Reliability | Long Let discounts use the Short Let pipeline | Built |
| Chat | Pinned messages in every chat (Roommate, Service, Friend, Hotel, Property host), both people, up to 10 | Built (migration 20261012380000) |
| Pricing | Discount end date, and host/WeHouse source labels on the listing | Built |
| Reliability | Hotel discounts use the same pipeline | Open |
| Workers | Skills, submission and profile structure review | Open |
| UX | One loading and animation pattern (33 spinners, 6 skeletons today) | Open |
| UX | Back, refresh, offline, sign-in/out audit | Open |
| Scale | CDN caching, read replicas, request queue, rate limits | Open (design only) |
| Scale | Catalog capacity evidence | 10–100 req/s passed at last head; 200 req/s failed; 1,000 req/s not run |
| Payments | Paystack test-mode journeys | Codex |
| Release | Two-device E2EE test | Done by owner |
| Release | Phone light/dark check | Owner |
| Release | One merge to main, then close #117, #116, #110, #87, #72 | After all gates |

## How Codex and Copilot fit together

Codex will keep the release checklist and evidence current, inspect GitHub/Supabase/Vercel state, make focused changes on the PR branch, and follow each CI failure to its source. Copilot can help you edit and review in VS Code. To avoid overwriting work, coordinate on one branch at a time: if you edit locally, tell Codex and push your commit; if Codex commits through GitHub, pull that commit into VS Code before continuing. Product decisions and external approvals stay with you and the responsible human owners.

## Progress log

- **19 Oct:** Initial baseline checkpoint: local tests were 497/498 because Python was unavailable to launch the existing release-boundaries helper. After Python installation, the complete suite passed 500/500 (see the later Phase C entry). The exact-head test/build gates and browser interaction remain red until verified on a reviewed commit. Production domains returned 402 `DEPLOYMENT_DISABLED` despite READY Vercel metadata; no setting or database was changed. Migration histories remain divergent and untouched.
- **19 Oct:** Phase B reconciled the accepted regional scope: Nigeria is the first market, not the permanent product boundary; the master plan and legal register no longer call the product Nigeria-only. Product Rules now distinguish confirmed owner decisions from proposed defaults and list the five contracts that need owner/operations approval before implementation: Short Let sellable unit, Worker fulfillment modes, marketplace packages versus custom quotes, owner pause/removal, and provider response clocks. These decisions do not authorize migrations or change live behavior.
- **19 Oct:** Began Phase C on real application surfaces. Added the shared typography/interaction contract, raised legacy 7–10px Tailwind text and map/message CSS to a 12px minimum, and removed the dead Rent options action left after the rent-plan modal was removed. Added structural regression checks. Targeted design/document checks pass 5/5; lint, TypeScript and production build pass; the full Node/Python suite passes 500/500. The repository's 15-file Deno Edge Function check passed. Local Playwright installation timed out at 18.9/36.6MB; the next verification is the exact-SHA CI run. Route-level visual/device/theme checks remain open.
- **19 Oct:** Retrieved the full failed browser job log. The 320px roommate-preferences failure was a stale accessible-name expectation (`Preferred State` / `Choose preferred state`) after the component adopted region-aware labels, not a page error. Updated the test to assert the current `Preferred state or region` control and matching dialog while retaining the state/LGA selection and save checks. Local browser verification remains pending.

- **12 Oct:** Confirmed GitHub PR #118 and both Supabase projects and the Vercel project are connected. Fixed the signed-out Bookings assertion and the FFmpeg setup timeout. Browser, build, database-consolidation and preview checks passed on `e1cd312`.
- **12 Oct:** Added this staged release roadmap. Remaining gates are open until their evidence is recorded; the schedule is an estimate and should be updated after Stage 0 and Stage 1.
- **12 Oct:** Added [the product coherence audit](WEHOUSE_PRODUCT_COHERENCE_AUDIT_20261012.md) from the current branch and read-only production catalog/advisor checks. No production data or schema was changed.
- **12 Oct:** Added the [R1–R11 operating model](WEHOUSE_OPERATING_MODEL_R1_R11.md), including the editable checkout review before payment, Paystack-first real-world payment plan, separate wallet/processor/store-billing tracks, and role-specific completion gates. The 2–4 week web release-candidate estimate remains planning-only; public transactional launch has no date until payment, legal, support, security and migration gates pass.
