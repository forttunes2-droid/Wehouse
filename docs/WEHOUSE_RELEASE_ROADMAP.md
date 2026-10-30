# WeHouse release roadmap

**Status date:** 30 October 2026. **Register review baseline:** `75463b316965e733bf602097d0f0d6fbe6eacbbb` (PR #118).

This is the only current work register. The [historical evidence snapshot](WEHOUSE_RELEASE_HISTORY_2026-10-30.md)
preserves prior checkpoints, decisions and failures; its old “open”, “current” and
“next push” statements are not instructions to restart work. The reorganization
changes no product rule or release approval. Scoped implementation evidence is
updated below; historical checkpoints do not reopen completed work.

## Open work register (single list; update in place, do not start another)

The 23 WR items below consolidate the prior 60 rows without dropping accepted
scope. Update these IDs in place. “Implemented” is not “release accepted”, and
“uninspected” is not a confirmed defect. Each item has one owner and a bounded
completion test; shared evidence is referenced, not repeated as another workstream.
The [prior-row disposition](#prior-row-disposition) accounts for every earlier row.

### Completion and change rules

- Keep completed implementation closed unless a changed dependency or reproduced regression identifies a specific failed case. Revalidate affected cases, not the entire product after every wording change.
- Close an item only with rule/case ID, reviewed commit, environment, date, persisted result and allowed/denied/recovery evidence appropriate to that item. Source/fixture, hosted Test, provider sandbox and owner-device evidence are different types.
- Add work only for an unfulfilled accepted requirement or evidenced release-blocking defect. New optional ideas require an explicit owner scope decision; they cannot silently move the finish line.
- Preserve one Personal identity and the existing booking, money, evidence, case and workspace authorities. No duplicate wallets, queues, payment engines or inventories.
- Engineering complete pending external activation means WR-01–22 are closed and WR-23 records their candidate evidence. Missing adapters, actual data-rights fulfilment, shared rent or hosted engineering checks are not external-only work. A credential dependency may block a case; it does not make it passed.
- No unsupported completion percentage or launch date. Estimate only the named remaining work after the acceptance cases/dependencies are identified.

### Current internal work

| ID | Outcome / owner and dependencies | Current boundary | Completion test |
|---|---|---|---|
| WR-01 | **Shared accommodation payments**. Bookings; depends on WR-05/06/09. | **Shared Long Let and Short Let implemented/Test verified; Hotel integration open.** Existing shared commands connect reservation fees, reviewed terms, each person's initial rent/protection and own later-year plan/history/debit consent to one booking. Partner totals, late-receipt refund actions and arrival visibility pass rollback/browser cases. Actual two/three-payer Short Let gateway receipts conserve stay/caution protection, saved management fees and funded discounts. Hotel sharing with accepted Friends remains unimplemented. | Complete accepted two/three-payer agreement and consent, per-payer initial protection, later-year shares/history/separate automatic-debit consent and combined Partner view. Preserve occupant capacity independently from payer count. Exercise invitation/eligibility, exact payer/reference/phase/attempt, duplicate and late payments, hold expiry, original-payer refunds, fulfillment and operator permissions. Reconcile all payer totals with one booking and use WR-06 for provider proof. |
| WR-02 | **Long Let terms, later-year collection and exit**. Bookings; WR-06/21. | **Implemented in part; recovery/evidence open.** Manual and optional automatic later-year collection, accepted terms, immutable fees, rent-year credit/history and payment Help are implemented on Test. Initial Year 1 protection remains; later-year payments do not create a new hold. | Verify full upfront terms and Partner-approved monthly terms without offering one-year monthly rent. Preserve eight payments funding each later year, separate debit consent/pause/cancel, due dates and accepted snapshots. Finish lawful arrears/grace/exit/dispute operations after the named policy decisions; test failed/late collection and Partner/customer recovery. Provider debit/settlement proof is recorded once in WR-06. |
| WR-03 | **Property and Worker evidence lifecycle**. Account/operations; WR-10/22. | **Implemented in part; recertification/terms open.** Private evidence, independent scoped correction/review, expiry and new-publication/new-job enforcement exist. Access footage is not title or safety proof. | Complete structured guest/tenancy terms and booking snapshots, already-live property/provider recertification, advance expiry reminders, appeals and evidence retention/deletion. Run actual owner/reviewer/outsider upload, partial-upload/replacement, expired-document, self-review-denial, publication and recovery cases. Verify category/market requirements and shared-person identity without adding another publication switch. Local forms/credential approval are EX-01; live identity adapter is WR-10. |
| WR-04 | **Buildings, spaces and availability**. Bookings; WR-03/09. | **Implemented; integrated verification pending.** Shared physical registry, whole/private disclosure, per-space terms, grouped offers, Partner management and operating schedule are implemented. Do not rebuild the hierarchy. | Demonstrate atomic whole-unit/child-room and Short Let/Long Let conflict prevention on the deployed Test configuration, mixed-building availability/calendar parity, ownership isolation, edits/cancellations and customer/Partner lost-response recovery. Keep one physical occupancy authority and existing Hotel inventory. |
| WR-05 | **One price, fee and refund contract**. Bookings/pricing; WR-06/21. | **Implemented in part; reconciliation pending.** Short/Long Let discounts and labels exist. Managed-property rates, Partner acceptance and booking snapshots are implemented/Test verified. Hotel rate-plan source exists. | Trace submission/Hosting approval through discovery, checkout, frozen receipt, Partner earnings and refund for apartments, Hotels, Services, Pro and shared costs. Cover currency, tax/mandatory charges, deposits, discount funding/caps/expiry, non-refundable combination and stale-rate rejection. Resolve the recorded Hotel 15%-versus-commission wording conflict without inventing a new cap; Short Let C-032 already rejects a fixed 15% cap. Reuse WR-06 settlement evidence. |
| WR-06 | **Provider reconciliation, wallet and payouts**. Money; requires authorised sandbox access. | **Integration/evidence pending.** Canonical booking payments/protection/ledger/wallet/outbox and withdrawal receipts exist. Bounded payout-account recovery is implemented; provider confirmation is not established by fixture success. | For each enabled payment purpose record exact amount/currency/reference, provider charge, valid/invalid signature, duplicate/delayed webhook, cancellation/refund, dispute, held/released/reversed earnings and withdrawal against stored ledger/provider results. Cover stale tabs, lost responses, late/failed settlement, chargeback after payout, secure bank replacement and real Finance/support resolution. Test later-rent card/debit/Partner settlement without duplicate wallet credit. Other rows link these cases instead of re-running a second money programme. |
| WR-07 | **Worker and Partner Pro lifecycle**. Money/Pro; WR-06/09. | **Implemented in part; billing/value verification open.** Existing practical tools and reminders remain implemented; Account Billing manages original entitlements during workspace-only restrictions. Partner Pro is prepaid; native stores retain their own management path. | Verify web price/terms, purchase, entitlement, cancellation through paid-through date, renewal/failure where supported, refund/revocation and support. Exercise free/active/expired/under-review states without granting trust or restricted tools. Verify reminder scheduling/rescheduling/completion/cancellation and deduplicated delivery. Provider cases use WR-06; deployment uses WR-17; phone delivery/value acceptance is PM-02; native store evidence is NT-01. Sales stay disabled until their existing activation gates pass. |
| WR-08 | **Account access, recovery and delivery**. Account; WR-09/17; mail activation EX-01. | **Implemented in part; hosted delivery/recovery pending.** The legacy recovery notice now directs customers to the implemented email-code path or an already-linked provider. Five isolated login journeys pass, including legacy-link cleanup without automatically sending a code. C-044/C-047/C-065 settle email policy. Provider sign-in, email-account recovery and pending-device proof remain distinct. | Verify signup/email change, purpose/account/device-bound code issuance and expiry/rate limits, failed delivery, retry/unknown outcome, one-use password reset and global session/device revocation. Record hosted sender/recovery evidence after configuration is available; owner two-device acceptance is PM-01, not a fresh policy decision. |
| WR-09 | **Permission and sensitive-action boundaries**. Security; domains supply cases. | **Implemented in part; matrix verification pending.** Mandatory internal MFA is active on Test; login MFA does not prove every sensitive action. | Complete one allowed/denied matrix for enabled roles/actions: login/session revocation, workspace switching, geography/ownership, self-review, RLS/RPC/storage/Edge access and cross-account denial. Enumerate finance/team/security actions requiring fresh confirmation; verify expiry/revocation, scope and audit records. Keep automated chat/session/encryption isolation pre-merge; physical two-device acceptance is PM-01. Changes require reviewed grants, not broad policy bypasses. |
| WR-10 | **Identity and recipient KYC integration**. Account/operations; selected provider/EX-01. | **Internal adapter/integration unfinished.** NIN is optional for Nigerian Partner/Service Worker identity, never Personal signup or ordinary booking/payment. Bank resolution is not recipient verification. | Implement the selected provider adapter and endpoint/UI, permitted alternative-ID/manual appeal, shared-person reuse, durable receipts, entity/bank match, provider-approval and payout gates. Verify denial, expiry, outage/unknown outcome and recovery against approved policy. Record exact missing provider documentation/credentials as an external dependency, not completed engineering. |
| WR-11 | **Reports, cases and solo-Creator operations**. Account/operations; WR-09. | **Implemented in part; whole journeys pending.** Shared reports, property/Hotel reports and scoped queues exist. Preserve existing cases, assignments and audit authority. | For each enabled report source (Roommate/Friend/Worker chat/profile, portfolio claims/reviews/uploads, property and Hotel), demonstrate receipt, scoped queue/evidence, decision/reason, reporter status, urgent safety route and escalation/appeal. Prove Creator can perform every mandatory queue/action without employees while Staff/Admin limits persist. Use one case matrix, including actual support resolution from WR-06/07; no copied queues. |
| WR-12 | **Actual data-rights fulfilment**. Account/operations; WR-22/EX-01. | **Tracked review implemented; fulfilment pending.** Access/correction/deletion drafts, assigned review, step-up, retry/stale receipts and retained/completed reasons exist. Account closure removes access; review attestation is not erasure. | Exercise actual access/export, correction and reviewed erasure across account/workspace data and private media. Check approved retention/legal holds for financial/dispute evidence, explain retained/not-completed items, verify requester/outsider access and resulting stored data. Confirm customer tracking and case closure cannot claim work not performed. Do not invent retention periods. |
| WR-13 | **Friend, Roommate and booking conversations**. Connections; WR-09/16. | **Implemented in part; cross-context checks open.** Friend-first schema/API and one-to-one plans exist. Request cap/expiry, Roommate cancellation and pinned messages are recorded implemented. Groups remain deferred. | Verify independent Friend/Roommate relationships, canonical chat identity, block/delete, plan refresh/pin/reaction, unread/recipient delivery, reconnect/account switch and end-of-lifecycle behavior. Inspect and finish Hotel/Friend conversation-info screens. Verify media/control permissions and remaining per-chat actions without rebuilding renamed schema. Capture automated isolation/delivery evidence here; PM-01 owns two-device acceptance. |
| WR-14 | **Experience whole-user/operator acceptance**. Existing Services/Provider domain; WR-06/09/11. | **Implemented/Test verified; hosted acceptance pending.** Applications/evidence, guided activities/sessions, publication/capacity, protected commerce, cancellation/refunds, attendance/completion, earnings, reviews/appeals, Help, sharing, offers and Sponsored integration exist. | Run customer/Provider/reviewer/operator journeys on matching deployed Test source, including unavailable dates, capacity races, withdrawn publication, payment recovery, attendance/completion, earned review/appeal, Help and sharing. Include existing offers/Sponsored restrictions and receipts. Refer to WR-06 for charge/refund/settlement, WR-11 for common cases; do not create another workspace, wallet or support queue. Shows/parties/nightlife stay excluded. |
| WR-15 | **Discovery, maps and followed searches**. Discovery; WR-04/09/16. | **Implemented in part; hosted lifecycle evidence pending.** Existing server-filtered/paged search and shared-link flows remain; source presence is not whole-flow proof. | Verify supported filters/sort/pagination, loaded-option dependencies, rapid input/stale responses, empty/retry behavior, map/list parity, approximate versus entitled exact location, and shared links. Exercise followed-search reopen/edit/delete/resume and notifications from each publication/edit path using the resolved replay policy. Preserve private/public-cache separation (WR-19). |
| WR-16 | **One web route/action quality inventory**. Frontend QA; domains own business outcomes. | **Inventory/evidence incomplete.** Selected responsive/browser tests exist. Historical route/module/spinner counts are not current coverage or a completion percentage. | Enumerate the enabled signed-out/Personal/Partner/Hosting/Hotel Team/Worker/Staff/Admin/Creator routes and nested actions once, including solo Creator and Roommate. Assign each a case ID, server owner and evidence. Cover 320px phone, 768px tablet and 1440px desktop in both themes, keyboard access, loading/empty/error/success, Back/refresh/deep link/sign-in/out/offline, second tap/retry and no false success. Reuse shared-component cases with recorded domain exceptions; do not demand every Cartesian combination blindly. Listing save/share/report/book/shared-cost/review/inspection/support must reach the persisted result. Close named defects and record explicit exclusions; PM-02 remains owner phone acceptance. |
| WR-17 | **Migration and deployed-configuration parity**. Platform; reviewed apply authority required. | **History disposition/rollout preparation pending.** Named Test repairs and prior fresh/upgrade checks exist. Older migration counts and old “next push” notes are historical, not current blockers. Production is unchanged by this cleanup. | Compare repository/Test/Production histories read-only and disposition every difference. Verify actual-baseline fresh/upgrade preservation, Edge/JWT/helper parity, secret/schedule/environment separation and affected hosted contracts. Prepare one ordered Production migration/Edge/config plan, rollback and post-checks. Never replay aliases or apply DDL merely for equal counts. Production apply/promotion needs separate approval under RL-01. |
| WR-18 | **Dependency vulnerability disposition**. Platform/security. | **Review/remediation evidence pending.** Existing npm/toolchain advisory findings need scoped review; an advisory count alone is not a production exploit. | Record exact dependency/version/advisory, runtime/build reachability, supported patch or mitigation and owner for accepted residual risk. Apply reviewed remediation with lockfile preservation and regression evidence; do not force a Tailwind major merely to reduce a count. |
| WR-19 | **Bounded Free-plan performance and abuse**. Platform; WR-16/17. | **Budgets and representative verification pending.** Controlled Free-plan release is the target. Historical 500-RPS failures remain diagnostic; 100k concurrency is not a web merge condition or certified claim. | Record the enabled workload, latency/error/resource budgets and sampling method before a bounded run. Verify indexes/pagination, expensive-work bounds, memory/media/upload limits, authorised cache keys, durable retries, notification/chat fan-out and abuse limits. Measure storage/egress/socket behavior and recovery without oversized hosted Free-plan ramps. Add queues/replicas only if measurements justify them; expansion claims are FX-02. |
| WR-20 | **Monitoring, restoration and incident drills**. Platform/operations; WR-06/17. | **Execution evidence pending.** Runbooks alone do not establish recoverability. | Exercise error/latency/queue/payment alerts, webhook/cron recovery, idempotent replay, backup restoration, media/DB recovery, secret rotation and deployment rollback in authorised non-production conditions. Record trigger, operator, evidence and recovery result; document production-specific steps without performing an unapproved production change. |
| WR-21 | **Remaining product decisions and contract reconciliation**. Product owner + affected domain. | **Some choices open; settled choices excluded.** D-016 is superseded by C-064. Email decisions, deferred Groups and existing accepted rent/payment rules are not reopened. | Disposition D-004–D-008, D-011–D-013 and D-017–D-020 against latest accepted decisions/source: address retention, Hotel lifecycle/turnover, date occupancy, closed-case messaging, block/skip/search resume, Worker modes/package boundary/response clock and property pause/removal. Link each genuine owner choice to its bounded question and each implementation gap to its existing WR item. No new package/mode or policy is silently selected; resolve stale status rather than rerun settled approval. |
| WR-22 | **Legal publication and operating integration**. Account/operations; legal/owner EX-01. | **Engineering verification pending; approvals external.** Approved legal content and local commercial/retention decisions are external; publication and actual operating paths are engineering. | Verify current document version publication, accessible reading, versioned consent and stale-version handling against approved bodies. Exercise required queue/runbook/escalation/support handoff and response ownership, including Creator-only operation. Link actual data-rights evidence to WR-12. Record commercial/legal/provider approval gaps individually in the existing Nigeria legal register; do not publish the draft or claim legal approval. The accepted post-engineering lawyer-review PDF is LG-01, not a circular prerequisite to finishing this row. |
| WR-23 | **Reviewed web release candidate**. Release engineering; WR-01–22. | **Exact candidate evidence/approval pending.** PR #118 is unmerged. Passing CI is limited to its exact commit; a ready older preview cannot close a newer candidate. | Record the candidate SHA, required build/lint/source/browser/fresh-upgrade results, matching Test preview and hosted role smoke evidence. Resolve known release-blocking defects and affected regressions, link WR-17/20 rollout/rollback evidence, and identify external residuals. Do not merge/promote until separate explicit approval; RL-01 tracks those actions, not another implementation checklist. |

## Latest scoped evidence — 30 October

WR-08/09/15/16: an unfinished Service Worker workspace has a direct return to
Personal, including the legacy setup route. Visiting or leaving it does not
submit a professional profile. Personal edits no longer require unrelated work
details; profile/private-address and professional/service changes each use one
atomic command, with failed-save rollback and ended-session denial verified on
Test. The saved country selects the region dataset; an unknown foreign country
never inherits Nigeria's State/LGA or institution list. Existing foreign values
remain editable. Additional authoritative country directories/identifiers remain
FX-01, not an implemented global-location claim.
Older accounts with no saved country now show “Not set” and can explicitly
choose from the enabled country catalog. There is no automatic Production
country backfill. First confirmation preserves a matching existing State/LGA;
an actual country change clears dependent region/locality, school and address.
Country-list failure has retry and does not prevent unrelated personal edits.
The list loads on opening the edit form, not on each typed search character.
Service coverage now stores its configured country code independently of the
private home. Search, staff review scopes, Admin Worker counts, credentials and
capacity use that coverage; changing home does not invalidate approved work
evidence. A real service-area/country change still requires review. Scoped work
projections omit the private home address/coordinates. Test rollback cases cover
these boundaries, document correction/expiry, out-of-area reviewers and capacity
after a private move. The new Test migrations are `20261030124330`,
`20261030130909`, `20261030131105` and `20261030132753`; no Production apply.
At `02e6fefc`, the full source suite passes 863 tests; the production build and focused lint
pass. Provider Account Back-to-Personal browser checks pass in light/dark modes;
the shared discovery/profile scenarios also cover failed loads, refresh, failed
and malformed save receipts, dependent locality clearing and server-required
re-review. All seven CI workflows passed on that commit. The country-choice
follow-up also passes seven focused client cases, the actual Test profile
contract and eight responsive/theme browser variants; its new CI/preview must
match its own pushed commit.

WR-15/16: Homes and Hotels each use one ordered collection: a six-card browsing
row followed by the remaining results in a responsive grid. The Homes row mixes
Short Let and Long Let rather than creating separate sections; both let types
remain filters rather than duplicate result sections. Focused searches and small
collections use one grid. The shared discovery browser scenarios pass at 320,
390, 768 and 1440px in both themes, including pagination without duplicate homes,
the correct open/save target, filter reset and no catalog fetch from rail arrows.
Hotels have explicit missing-photo states and one labelled open action per
card. Their arrows do not fetch, paging does not duplicate results, and a typed
search returns a comparison grid. Signed-out Roommates and Services retain
Explore category navigation; switching directly to Homes/Hotels clears the
signed-out prompt. All four signed-out prompts use plain content without a card
or repeated policy footer.
Policy access remains in sign-in and Account. Fixtures now set both the real
theme attribute and the matching Tailwind dark class. These scoped checks do not
close the entire route inventory or hosted discovery lifecycle.

WR-01/02: shared Long Let passes the actual Test constructors, accepted own
agreements, initial per-payer protection/ledger confirmation, host-confirmed
handover, later-year collection/credit/settlement, original-payer late-checkout
refund actions, overdue notices and combined Partner accounts. One person paying
all eight contributions does not complete the other person's annual share or end
the occupied tenancy. History/debit are scoped to the payer; revoked devices
cannot read arrival details and revoked hosts cannot read arrival Activity.
See [the rollback contract](../supabase/tests/shared_long_let_rent_collection_contract.sql).
No provider request or launch commission was invented; WR-06 still owns actual
sandbox provider reconciliation.

WR-01/05: the actual shared Short Let charge path previously failed to resolve
the reservation behind a per-payer protection component. The forward repair
binds each component to its saved booking, payer, attempt and management policy.
Two/three-payer gateway tests now verify partial payment stays unconfirmed,
separate stay/caution records, exact aggregate fees/net with minor-unit rounding,
Creator rate changes, Partner acceptance of updated fees, host/WeHouse discounts,
duplicate receipts and immutable allocations. They run against Test and in fresh
replay CI; fixtures roll back without contacting a payment provider. No parent
protection record duplicates the children's money.

Test migrations through `20261030113333` are applied; Test payment-init v15 uses
the current shared checkout and owned later-rent plan with JWT verification on.
The frozen Deno check, 855 source tests, build and focused lint pass. Sixteen
shared-rent browser cases, 48 existing practical cases and two individual-rent/
Partner cases pass. These are scoped engineering results, not closure of Hotel
sharing or the remaining WR outcomes. Required candidate CI/preview still follows
the integrated push.

WR-16: affected fixtures now set both the product theme attribute and Tailwind
dark class; the practical fixture no longer forces dark surfaces in light mode.
Screenshots from local changes or an older preview do not establish a newer
candidate's design. Rent history shows current payments/latest receipt first;
the full schedule is available on demand. Production is unchanged.

WR-17: fresh replay and all named migration contracts pass on `ebdf456f`.
The atomic existing-account upgrade found `SET LOCAL search_path=''` leaking
from an earlier file into a later unqualified function lookup. The coordinated
runner now restores its original connection search path before each migration
and preservation check, without editing applied SQL or its stored history.
Eight runner regressions pass; an actual rolled-back Test batch reproducing
the context boundary passes with unchanged records/history. The complete
existing-account upgrade must pass CI on the follow-up commit before closure.

## Delivery order and release gates

1. Reconcile WR-21 decisions and WR-17 baseline while the existing editor completes WR-01–15. External dependencies do not stop independent internal work.
2. Close domain outcomes with their named server, operator and recovery cases. WR-06 owns provider evidence once; WR-09 owns shared permission boundaries; WR-16 owns one web quality inventory.
3. Finish bounded performance, dependency and recovery evidence (WR-18–20), then assemble WR-23 for the exact candidate. Existing green tests remain evidence for their recorded scope.
4. Obtain explicit merge approval (RL-01). Owner two-device/physical-phone acceptance follows merge as already agreed; it is not quietly moved back into the PR prerequisites.
5. Public transactional launch additionally requires applicable EX-01 approvals, PM-01/02 acceptance and authorised Production rollout/smoke checks. Native stores and expansion claims have separate gates.

A smaller housing-only release cannot be described as completion of the full agreed
product. Experiences, shared accommodation costs and accepted later-year rent remain
in scope. The present controlled Free-plan web target does not assert global
transaction readiness or a numerical concurrency capacity.

| Gate | Scope, owner and exact exit | Relationship to web work |
|---|---|---|
| LG-01 | Engineering/document owner: after internal implementation and verification complete, reconcile and refresh the already-delivered `WeHouse-Policies-for-Lawyer-Review.pdf` against final confirmed rules and implemented behavior. Preserve the owner-corrected concise four-page format of policies/counsel questions, without raw decision IDs, code paths, hashes or historical/release-status appendices. Separate unresolved and jurisdiction-dependent questions; verify/render the refreshed sharing copy. Do not restart the earlier 14-page packet, draft prematurely or claim legal approval. | Post-engineering handover, before the applicable legal/operational launch sign-off; not a prerequisite to declaring the implementation work complete. |
| EX-01 | Owner/provider/legal: named provider account/credentials and model approval; accepted legal/evidence/retention/contracts and required licences; commercial decisions and operational sign-off. Record exact decision, recipient and approval evidence in the existing Nigeria legal register. | External activation dependencies, not permission to skip WR integration/tests or declare legal readiness. |
| PM-01 | Owner post-merge two-device E2EE: Friend/Roommate/Service/Hotel/host chats, plans, recovery/revocation and recipient behavior. Record both devices and actual results. | Explicitly post-merge, not a PR prerequisite. Automated isolation/session/encryption checks remain WR-09/13. |
| PM-02 | Owner post-merge physical-phone light/dark, notification delivery and practical Pro-value acceptance. Record affected journeys/results and route discovered defects to their WR owner. | Not a substitute for pre-merge responsive/browser tests or a reason to rebuild completed tools. |
| NT-01 | Native owner: signed iOS/Android builds, permissions/deep links, offline/update/old-tab behavior, store privacy/metadata, billing purchase/restore/revocation, signing and release recovery. | Separate native release; existing web billing still closes WR-07. |
| FX-01 | Market owner: destination-country snapshots, locations/timezones, currency/processors, translation, credentials/contracts/tax and support coverage for each additional market. | Future market activation; Nigeria-first is allowed. Do not hard-code assumptions into currently shared contracts. |
| FX-02 | Infrastructure owner: provisioned representative hosted workload, agreed latency/error/cost limits and recovery proof before a larger capacity claim. | Future expansion. No 100k-concurrent claim and no oversized hosted Free-plan test required for this web milestone. |
| DF-01 | Friend Groups and group plans: deferred by C-066; require a later explicit owner decision and encryption/membership/safety contract. | Excluded from current release requirements. One-to-one Friend plans remain WR-13. |
| RL-01 | User/release owner: explicit approval for the reviewed merge and separate Production promotion; approved SHA deployed, post-checks and rollback ready. Then disposition #117, #116, #110, #87 and #72, preserving any unique work before approved closure. | No merge, PR closure, DDL or Production deployment is authorised by this roadmap cleanup. |

## Implemented items retained, not restarted

These are implementation dispositions from the prior register, not fresh blanket
release passes. Their ongoing integrated acceptance belongs to the named WR cases.

| Record | Preserved implementation | Evidence / remaining acceptance owner |
|---|---|---|
| DONE-01 | Hotel data-exposure fix; scoped Admin/Creator queues; Roommate cancellation/30-day wait/notification. | Prior rows 5, 10, 11 recorded Done; WR-09/11/13 owns affected integration/regression only. |
| DONE-02 | Friend limit 5, request cap 10/day and 24-hour expiry; canonical Friend naming; one-to-one chat/plans. | Prior rows 12–15/19 and dated migration evidence; WR-01/13/17 and PM-01 own named remaining integration, rollout and device evidence. |
| DONE-03 | Short Let host discount pipeline, Long Let Year-1 discount, discount end-date/source labels. | Prior rows 21/25/36; migration `20261012370000` and `listing_discounts_contract.sql` are recorded evidence, not a new run; WR-05 owns remaining cross-purpose reconciliation. |
| DONE-04 | Up-to-ten pinned messages across Roommate, Service, Friend, Hotel and Property-host chats. | Prior row 35, migration `20261012380000`; WR-13 owns cross-chat acceptance. |

## Prior-row disposition

This is a migration map, not another task list. Old row numbers are positions in
the [preserved 30 October snapshot](WEHOUSE_RELEASE_HISTORY_2026-10-30.md#open-work-register-single-list-update-in-place-do-not-start-another).
Every old row maps to one or more current owners or an already established gate.

| Prior row | Original item | Current disposition |
|---|---|---|
| OLD-01 | Canonical wallet, withdrawal receipts and payout-account recovery | WR-06 |
| OLD-02 | Worker and Partner Pro contracts and practical features | WR-07; PM-02 |
| OLD-03 | All-role control, layout, wording and theme review | WR-16 |
| OLD-04 | Creator can operate launch without employees | WR-11 |
| OLD-05 | Hotel data exposure fix | DONE-01; WR-09 regression |
| OLD-06 | Admin sensitive-action step-up | WR-09 |
| OLD-07 | Report in Roommate, Friend, worker chats and profiles | WR-11; PM-01 |
| OLD-08 | Public property listing report to active review queue, receipt/status and urgent safety route | WR-11 |
| OLD-09 | Hotel public listing report action | WR-11 |
| OLD-10 | Admin and Creator queues with state and local-area scoping | DONE-01; WR-09/11 regression |
| OLD-11 | Roommate cancel, 30-day wait, other person notified | DONE-01; WR-13 regression |
| OLD-12 | Friend list limit of 5, requests, chat and shared booking costs | DONE-02; WR-01/13; PM-01 |
| OLD-13 | Friend request daily cap and expiry | DONE-02; WR-13 regression |
| OLD-14 | Friend chat: encrypted messages, media and controls | DONE-02; WR-13; PM-01 |
| OLD-15 | Private two-person plan card inside Friend chat | DONE-02; WR-13; PM-01 |
| OLD-16 | Roommate and Friend relationship overlap | WR-13 |
| OLD-17 | Private Friend Groups and group plan card | DF-01 |
| OLD-18 | Provider-led Experiences | WR-14; WR-06 provider evidence |
| OLD-19 | Friend naming across product, API and schema | DONE-02; WR-13/17 |
| OLD-20 | Hotel and Friend conversation-info screens | WR-13 |
| OLD-21 | Short Let host discount 5-50% in the price pipeline, shown on listing | DONE-03; WR-05 integration |
| OLD-22 | Discount during property submission and Hosting control | WR-05 |
| OLD-23 | Managed-property fee control and Partner disclosure | WR-05; WR-06 settlement |
| OLD-24 | Creator WeHouse-funded discount control | WR-05; WR-21 cap conflict |
| OLD-25 | Long Let discount (host 5-50% + WeHouse share capped by Long Let commission, Year 1 rent only, partner payout protected, migration `20261012370000`, DB test) | DONE-03; WR-05 integration |
| OLD-26 | Hotel discount/rate-plan pipeline | WR-05 |
| OLD-27 | Shared accommodation booking costs | WR-01 |
| OLD-28 | Partner-approved terms and optional later-year monthly rent | WR-02; WR-06 provider evidence |
| OLD-29 | Submission authority and evidence completeness for apartments and Hotels | WR-03/10/12; EX-01 forms |
| OLD-30 | Buildings and bookable spaces across Short Let and Long Let | WR-04 |
| OLD-31 | Category-specific credential and licensing requirements | WR-03/10; EX-01 local requirements |
| OLD-32 | Display, charge and refund agree on the test project | WR-05; WR-06 provider evidence |
| OLD-33 | Email-change and recovery delivery | WR-08; PM-01 |
| OLD-34 | One shared action pattern (`src/lib/safeAction.ts`): a second tap joins the first request, clear offline message, no false success. Applied to Short Let booking, payment, cancel, Friend requests and Friend chat. Other actions and a visible Retry button | WR-16; WR-09 server boundary |
| OLD-35 | Pinned messages in every chat (Roommate, Service, Friend, Hotel, Property host), both people, up to 10 | DONE-04; WR-13 integration |
| OLD-36 | Discount end date, and host/WeHouse source labels on the listing | DONE-03; WR-05 integration |
| OLD-37 | One loading and animation pattern (33 spinners, 6 skeletons today) | WR-16 |
| OLD-38 | Back, refresh, offline, sign-in/out audit | WR-16 |
| OLD-39 | Listing detail action-to-result verification (save, share, report, booking, shared booking cost, review, inspection and support) | WR-16 domain cases; WR-01/05/11 |
| OLD-40 | Measured performance, caching, background work and rate limits | WR-19 |
| OLD-41 | Controlled Free-plan release and future expansion | WR-19; FX-02 expansion only |
| OLD-42 | Two-device E2EE | PM-01; WR-09/13 automated checks |
| OLD-43 | Physical phone light/dark review | PM-02; WR-16 engineering checks |
| OLD-44 | Route and nested-control inventory | WR-16 |
| OLD-45 | Auth and permission boundary matrix | WR-09 |
| OLD-46 | Government-ID and recipient KYC contract | WR-10; EX-01 provider approval |
| OLD-47 | Reconcile unresolved contracts | WR-21 |
| OLD-48 | Booking-to-provider reconciliation matrix | WR-06 |
| OLD-49 | Web/native subscription lifecycle | WR-07; NT-01 native acceptance |
| OLD-50 | Report through resolution | WR-11 |
| OLD-51 | Account and data-rights operations | WR-12 |
| OLD-52 | Search/maps/followed-search lifecycle | WR-15 |
| OLD-53 | Deployed configuration parity | WR-17 |
| OLD-54 | Toolchain vulnerability remediation | WR-18 |
| OLD-55 | Observability and recovery drills | WR-20 |
| OLD-56 | Publication and commercial approvals | WR-22; EX-01 approvals |
| OLD-57 | Per-market expansion | FX-01 |
| OLD-58 | Signed device/store readiness | NT-01 |
| OLD-59 | Exact-commit CI and promotion | WR-23; RL-01 approval/promotion |
| OLD-60 | One merge to main, then close #117, #116, #110, #87, #72 | RL-01 |

## Evidence and collaboration

- [Historical release evidence through 30 October](WEHOUSE_RELEASE_HISTORY_2026-10-30.md): complete prior roadmap, including original rows, source/test references, failures and owner-attributed decisions. History is evidence, not another plan.
- [Decision log](DECISION_LOG.md) and [Product Rules](PRODUCT_RULES.md): accepted rules. Historical implementation sentences there defer to this register; a resolved choice does not become undecided again.
- [Documentation index](README.md), [R1–R11 operating model](WEHOUSE_OPERATING_MODEL_R1_R11.md), [migration history comparison](MIGRATION_HISTORY_DIFF_2026-10-19.csv), [Nigeria legal register](LEGAL_LAUNCH_REGISTER_NIGERIA_2026-09-13.md), and [capacity evidence](capacity-validation.md) retain their existing responsibilities.
- One editor/branch at a time. Preserve Codex's active source changes. Copilot may assist within the same boundaries, not create a competing implementation or status report.
- Review current remote head before committing this cleanup; if a file changed, merge its newer decisions/evidence rather than overwrite it. Documentation cleanup does not authorize main merge or Production changes.
