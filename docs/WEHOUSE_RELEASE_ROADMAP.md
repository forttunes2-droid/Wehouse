# WeHouse release roadmap

**Status date:** 12 October 2026  
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

- PR #118 is open against `main`. The current reviewed source commit is `e1cd31264475d4dad19dbfdbb3f8c903ccb693fd`. It includes the stale signed-out Bookings assertion fix and the browser-job FFmpeg timeout correction.
- Required checks observed on `e1cd312` passed: browser interaction matrix, media-compression/FFmpeg, structural regression, build, isolated mixed-journey preflight, consolidation validation (migration replay/tests/build/existing-account upgrade), and deployment previews. Vercel has a READY deployment for that exact SHA; Netlify preview is green. Reconfirm exact-SHA status after any PR update.
- Both connected Supabase projects report healthy status. Their applied migration histories differ: production has 712 recorded entries and test has 694, with different latest versions. These counts are not evidence of a defect by themselves. Reconcile the histories using the repository's read-only release plan and explain each difference before any database write. No production writes were made during the product audit.
- The readiness audit's future-dated headings (20 and 21 October) were corrected to 12 October and the file renamed `PRODUCT_READINESS_AUDIT_2026-10-12.md`. Its verification claims still need re-checking against current source before they are treated as evidence.
- Product/code findings are in [WEHOUSE_PRODUCT_COHERENCE_AUDIT_20261012.md](WEHOUSE_PRODUCT_COHERENCE_AUDIT_20261012.md); the end-to-end rules and sequencing are in [WEHOUSE_OPERATING_MODEL_R1_R11.md](WEHOUSE_OPERATING_MODEL_R1_R11.md). Open contracts include owner unlisting/removal, complete public reporting and moderation, Short Let sleeping facts, provider fulfillment/packages and response deadlines, checkout review/edit, Paystack settlement/refunds, and store billing for digital products.
- Production readiness still includes external or unverified work: legal and operating approval, signed payment-provider journeys, role-by-role security evidence, complete signed-in screen/device checks, recovery drills, and hosted load testing. Do not promise a million-user capacity or a full transactional launch date before those gates pass.

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
| Reports | Report in Roommate, Companion, worker, hotel chats and profiles | Done |
| Reports | Admin and Creator queues with state and local-area scoping | Done (state and branch/LGA contracts pass in CI) |
| Connections | Roommate cancel, 30-day wait, other person notified | Done |
| Connections | Companion bucket of 5, chat, split pay | Built |
| Connections | Companion request daily cap and expiry | Built: unanswered requests expire after 24 hours and free the slot; 10 requests per person per day. Both numbers are single functions in the database and need your confirmation |
| Connections | Friend chat matches Roommate chat | Built: photos, videos, voice notes, replies, reactions and delete-for-me, all end-to-end encrypted. Friend media is stored under its own `e2ee/companion/` path that only the two Friends can open. While blocked, nobody can send, react or upload, but both can still read the old chat |
| Connections | User-facing name for the separate Roommate/payment-sharing connection | Open: user suggested “Connection”; current app says “Friend” |
| Connections | Hotel and Companion conversation-info screens | Open |
| Pricing | Short Let host discount 5-50% in the price pipeline, shown on listing | Built |
| Pricing | Discount on the posting form | Built (Short Let, optional field when posting; applied right after the listing is saved) |
| Pricing | Creator WeHouse-funded discount control (5-15%, capped at the commission WeHouse earns, per state, Booking money screen) | Built |
| Pricing | Long Let and Hotel discounts | Open |
| Pricing | Display, charge and refund agree on the test project | Codex |
| Account | Email-change flow and recovery policy (C-035) | Open; no owner decision recorded |
| Reliability | One shared action pattern (`src/lib/safeAction.ts`): a second tap joins the first request, clear offline message, no false success. Applied to Short Let booking, payment, cancel, Friend requests and Friend chat. Other actions and a visible Retry button | Built (partly applied). Server side: Short Let booking and posting a listing carry a UUID key stored for 24h (`idempotency_keys`), so a repeat returns the first result. Payment already has a unique reference; other actions still open |
| Reliability | Hotel and Long Let discounts use the same pipeline | Open |
| Workers | Skills, submission and profile structure review | Open |
| UX | One loading and animation pattern (33 spinners, 6 skeletons today) | Open |
| UX | Back, refresh, offline, sign-in/out audit | Open |
| Scale | CDN caching, read replicas, request queue, rate limits | Open (design only) |
| Scale | catalog load test at 100 req/s, then 1,000 | Codex |
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
