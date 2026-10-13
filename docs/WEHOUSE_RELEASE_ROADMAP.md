# WeHouse release roadmap

**Status date:** 13 October 2026  
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

- PR #118 is open and unmerged at `63aa86ad5b6554d8efe38acebefd9eb66a37dd87` (254 changed files). Build, Structural Regression, Consolidation Validation, Isolated mixed journey preflight, Capacity Stage 1 baseline, and Medium disposable catalog passed on that commit. Vercel and Netlify report successful preview deployments for the commit.
- The Experience browser check failed at the Short Let date-review step: after clicking “Review dates”, the expected accessible review dialog did not appear. The dialog markup and label are present in the current source, so the failure still needs to be reproduced and traced to its booking action/test fixture. Do not mark that journey passed by changing only the selector.
- The hosted Test catalog passed 10–100 requests/second; at 100 requests/second it completed 3,000/3,000 with 0 errors, 0 retries and 228 ms p95. The 200 requests/second tier failed (3,643 errors, 1,699 dropped, 14,383 ms p95). The 1,000 requests/second test has not run. This is a catalog RPC test, not end-to-end app or payment capacity evidence.
- GitHub's disposable-stack migration replay, database contracts, existing-account upgrade and build checks passed. Live Supabase histories are behind this PR: WeHouse Test currently ends at `20261012113554`; Production ends at `20261010120000`. The newer PR migrations are not recorded in Test. No database writes were made during this check.
- The repository's `scripts/coordinated-database-release.py` is explicitly restricted to the Production database connection; it cannot safely be used as a Test-project check/apply tool. The direct Supabase reads here compared project histories but did not run that coordinated script. Do not apply migrations until a Test-specific ordered release plan preserves exact versions and explains history differences.
- “Friend” is the approved user-facing name. Older decision-log and roadmap wording contradicted that decision; the decision log has now been aligned. Internal `companion` identifiers remain for database/API/storage compatibility.
- Product readiness is not complete: live Paystack charge/webhook/refund journeys; the failed Short Let review journey; Owner pause/unlist/removal behavior across all property types; Hotel Friend split and hotel discount rules; service fulfillment modes, package selection and response deadlines; security-password/step-up verification; provider/Creator/Admin/Staff dashboard checks in both themes; and role-by-role phone/tablet/desktop visual checks still need evidence. The 2–4 week release-candidate window below is a planning estimate only and is no longer dependable until these checks close.

## Delivery sequence and ownership

| Stage | Target window from 12 Oct | Owner | Exit evidence |
|---|---|---|---|
| **0. Stabilize PR #118** | 12–16 Oct | Codex: inspect and fix code/docs; user: confirm product rules where authority is unclear | CI is green on `e1cd312`; the browser environment timeout is fixed; Vercel and Netlify previews are available for the reviewed commit. No production change. |
| **1. Establish live baseline (R1, R4, R8)** | 13–20 Oct | Codex: read-only comparison and evidence; user/admin: provide platform access or approve admin-only settings | One source-of-truth map links product rule → route/component → database/Edge Function enforcement. Production/test migration differences are explained by a read-only plan. Vercel production/preview settings and environment separation are recorded without exposing secrets. |
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

- **12 Oct:** Confirmed GitHub PR #118 and both Supabase projects and the Vercel project are connected. Fixed the signed-out Bookings assertion and the FFmpeg setup timeout. Browser, build, database-consolidation and preview checks passed on `e1cd312`.
- **12 Oct:** Added this staged release roadmap. Remaining gates are open until their evidence is recorded; the schedule is an estimate and should be updated after Stage 0 and Stage 1.
- **12 Oct:** Added [the product coherence audit](WEHOUSE_PRODUCT_COHERENCE_AUDIT_20261012.md) from the current branch and read-only production catalog/advisor checks. No production data or schema was changed.
- **12 Oct:** Added the [R1–R11 operating model](WEHOUSE_OPERATING_MODEL_R1_R11.md), including the editable checkout review before payment, Paystack-first real-world payment plan, separate wallet/processor/store-billing tracks, and role-specific completion gates. The 2–4 week web release-candidate estimate remains planning-only; public transactional launch has no date until payment, legal, support, security and migration gates pass.
