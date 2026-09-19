# WeHouse account, Staff and database review — 19 September 2026

## Current decision

WeHouse is not yet technically production-ready under the owner's definition (all engineering complete, only legal/external work remaining). This review repairs confirmed defects on existing draft PR #74 and isolated Test; it does not certify every dashboard, operation, phone or provider.

## One source of truth

| Surface | Authority |
|---|---|
| Live website, wehouse.com.ng / www.wehouse.com.ng | Production project rkrhnkhppeihvmuwvsvn; real identities, business records, money history and current operating permissions |
| Existing PR #74 preview | Isolated Test project qoobnkedfyosnizrlttt; reproducible schema and synthetic test records |
| GitHub PR #74 | Reviewed code and ordered migrations awaiting coordinated release |
| Canonical master plan | Owner decisions and dated evidence; historical observations are not current deployment state |

Test has zero Auth users, profiles and workspace grants after rollback. No production customers were copied. A live password does not imply that a matching Test account exists. Test never becomes a replacement live database or a data source to copy over production. The preview environment variables override the shared legacy URL/key for this branch. Production's Google redirect was visibly the production project.

The frontend now blocks both Preview-to-Production and Production-to-Test mistakes. Missing configuration fails closed on preview. The existing official-domain public fallback is atomic: both URL and publishable key must be absent to use it; partial pairs are rejected. The URL is parsed and normalized. Publishable browser keys are public configuration, not server secrets. Database RLS/RPCs remain the security boundary.

## What the account checks actually proved

Read-only production inspection of the four supplied identities found one Creator, one Admin and two Service Providers. All retain their Personal identity, are email-confirmed, complete and active. None has a Property Partner or Staff grant. No role was assigned or changed to make testing easier.

Production currently has five active Property Partner grants, eight Service Provider grants, three Staff grants, two Admin grants and one Creator grant. The three active Staff profiles include one Field Operations assignment, one Property Operations assignment and one account with neither a work area nor an assigned State/LGA. That last account needs an owner-selected job assignment; assigning arbitrary access is not a code fix.

A real Google sign-in attempt reached the selected Creator's passkey verification and failed with Google's “Something went wrong” / Bluetooth-device message. This browser does not support passkeys and should not have offered that option. The attempt stopped. Creator is not confirmed signed in; no signed-in dashboard journey is marked passed. No supplied password was entered, stored, included in commands or committed.

## Confirmed repairs

1. Removed legacy profile-role fallback from two shared workspace checks. An active grant is required; a stale role cannot revive a revoked grant.
2. Changed the shared geographic check to honor explicit global, State and branch grants. A branch Admin must match both State and LGA; blank location cannot widen that grant. An explicitly State-scoped Staff grant remains State-scoped.
3. The deployment guard rejects live-to-Test configuration as well as preview-to-live configuration.
4. Staff permission reads distinguish errors from empty assignments, clear stale authority, stop loading on failure and ignore late responses from a previous identity or refresh.
5. Staff loading/unassigned/error screens use the black page background, one title and Back in the header, plus Account and Sign out. An error offers Retry and does not falsely claim the Staff member has no assignment.

Database migration: 20260919173441_enforce_active_workspace_grants.sql, applied only to Test. No production migration, customer record, grant or payout was changed during this review. Before a production rollout, repeat the missing-grant inventory: all active legacy work profiles currently have a matching active grant, so no automatic backfill was necessary.

These shared-helper repairs are not a claim that every legacy RPC now honors grant revocation or branch scope. Some privileged routines still read profiles.role directly. Their full call-site review and action-specific role tests remain an engineering release gate. In particular, role/scope checks inside staff-management and financial mutations need separate end-to-end evidence.

## Verification

- 157 executable JavaScript/render tests pass across the existing suite and three new Staff tests; TypeScript/build and lint pass.
- New hosted rollback SQL contract exercises Personal, Service Provider, Property Partner, Staff, Admin and Creator grants; both professional workspaces on one identity; revoked grants; cross-State and cross-branch denial; State/global positive controls; suspended/banned/deleted denial.
- Existing hosted Service Provider review, Creator bootstrap/settings and cross-user RLS contracts passed again after the helper change. The provider fixture now has the explicit active grant a real account requires.
- CI now includes eight SQL contracts and a full empty-database migration replay, plus the real local Auth signup-hook request.
- Hosted security advisors still flag the deliberate anonymous and broad authenticated SECURITY DEFINER API surfaces for review. The three changed helpers retain authenticated/service-only execution; they were not granted anonymous access. See [Supabase's privileged-function advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- No live account walkthrough, Staff job assignment, payment, payout, customer message or physical-device test is represented as completed.
- Hosted CI and preview results for this exact revision are recorded in PR #74.

## Remaining work in plain language

| Work | Why it matters | What finishes it |
|---|---|---|
| Signed-in role journeys | Screens loading is not proof that each person can complete their job | Supported secure sign-in and full read/action tests for all roles, using synthetic Test records for mutations |
| One unassigned Staff member | The system cannot infer their responsibilities | Owner selects their actual work area and geography through the approved control |
| Legacy privileged action review | Shared helpers cannot fix functions that bypass them | Action-by-action scope, revocation, self-review and money-approval tests and repairs |
| Test Google / payment / call setup | These provider settings are not automatically copied from live | Separate approved Test credentials/configuration and successful end-to-end provider tests |
| Phone/tablet/design review | This turn could not inspect authenticated screens on physical devices | Small Android/iPhone/tablet widths, keyboard, safe areas, deep Back navigation and weak-network checks |
| Booking, money, messages and calls | These cross several services and users | Test-mode payment/webhook/reconciliation, two-person encrypted messages and real call fallback |
| Restore and retention | A build cannot prove recovery after data loss | Database plus media restore drill and verified account deletion/retention |
| Production rollout | Draft code is not yet live | Coordinated frontend, migrations, functions and Auth-hook release through protected main |

Legal documents, approved business policies, real-payment activation/manual payouts and named-PMS certification remain separate external/commercial gates. The owner has deferred live/manual payouts. No paid plan was purchased here.

## Control panel and practical business advice

The control panel should handle established operating choices, staff assignments and supported policies without code edits. It cannot safely make entirely new business rules, repair defects, increase database capacity or certify an external provider. Those still need engineering and operations.

Recommendation, not an approved new product: finish the core WeHouse journey and measure repeat service work. For a landlord with occupied flats, a practical recurring need is arranging cleaners, plumbers and electricians, recording completion and showing costs. Start with actual service bookings and reliable delivery. If landlords later request ongoing coordination and will pay for it, trial a disclosed monthly management fee with a few willing owners. Keep repair labour/materials separate. Do not build “WeHouseCare” as another platform before validating demand, response times and margins.

Keep Service Provider onboarding/review free. Existing optional WeHouse Pro must earn its fee through useful business tools; it must not sell trust, rank or access to ordinary jobs. A million users is a capacity goal requiring measured load and costs, not a promise created by choosing Supabase or Vercel.
