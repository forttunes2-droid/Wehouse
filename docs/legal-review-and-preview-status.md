# Legal review and preview status — 19 September 2026

## What the owner saw

The PR preview uses WeHouse Test. A read-only count confirmed no Test Auth accounts, while the owner's email exists once in production. No password was inspected, copied or tested. A live account therefore cannot sign in to the empty Test project. Login now labels non-production hosts and links to the live site. Production account recovery remains separate.

The Privacy Policy and Terms endpoints return null in both projects. There are no published clauses to deduplicate. The repeated title/banner/empty-message/publisher footer were interface chrome. Both public documents now use one shared, continuous dark page with one page title, a concise unavailable state, readable text and inline confirmation after the document. Account's legal panel has two document rows; its bulk unchecked-document acceptance form is removed. Navigation/editor labels consistently use Terms of Service. Published document bodies were not edited or fabricated.

A source scan of 146 top-level page/component TSX files flagged only Activity/Messages in StaffWorkspaceRepair after the repair. Inspection confirmed these belong to separate OperationsInbox, SupportInbox and ActivityOnlyInbox render paths, not simultaneous duplicate headings. This is a literal-heading scan, not certification of every dynamic label, nested component combination or signed-in screen.

## Registration and confirmations — corrected owner requirement

- Missing/unpublished Privacy Policy or Terms do not block signup or account setup. Each published document independently requires its current version to be reviewed and accepted. One published document does not require a missing second document.
- A failed requirements request is not treated as an unpublished policy. Signup/setup remain paused and show Try again; existing form values stay in place.
- The signup helper and Supabase Before User Created hook validate current policy IDs and checksums. New publication or changed text invalidates a stale declaration. The database requires a receipt for each published document before completing a new profile.
- Registration-open and maintenance controls, Google identity verification, the private adult-eligibility check and all workspace authorization checks remain enforced.
- Auth metadata records a user's declaration only. It grants no role or workspace. Reading to the end enables the checkbox; no technical system can prove comprehension.
- Accepted unchanged versions carry forward into setup. The old blind-acceptance RPC remains unavailable, and repeated acceptance remains idempotent.

## Verification and deployment

158 JavaScript tests, the TypeScript/Vite build and lint pass locally. The hosted Test SQL contract passes with neither document, one document and both documents published, including current/stale/missing acceptance and profile completion. Fixtures roll back. Migration `20260919181136_legal_acceptance_after_publication` is applied only to Test.

CI's Auth HTTP check now exercises actual identity creation with unpublished documents, rejection when one published document lacks current acceptance, and successful creation after that published document is accepted. Synthetic policy/account fixtures are restricted to the disposable local CI database; no real legal text or customer account is used. The new CI result must be checked on the resulting commit.

The security advisor's new authenticated-function notice for accept_reviewed_legal is intentional: it records only the current signed-in profile's receipt. Anonymous and authenticated callers cannot invoke the signup hook, and anonymous callers cannot invoke acceptance. Existing broader privileged-function notices remain outside this scoped repair. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

All changes stay on PR #74. Production frontend, Auth hook and migration are **not released by this pass**. Deploy the migration and frontend together through protected main; enable the production Before User Created hook before opening registration. Legal publication remains the Creator's separately reviewed action. Do not publish fabricated policies or copy customer accounts to make the preview appear populated.

## Mobile and remaining work

The owner's Android screenshot shows a continuous black sign-in surface with full-width controls. The legal pages use normal vertical scrolling, safe-area padding and a reading-width limit on wider screens; no floating modal or sticky acceptance card. The deployed desktop preview was visually reviewed at 1363 CSS pixels: one legal-page heading, no fixed/sticky reader elements, no horizontal overflow, working Back navigation, and working Back navigation. The unpublished signup block from that earlier check is superseded by the owner requirement above. Actual narrow-viewport, iPhone/iPad and keyboard journeys remain unverified by this browser, which does not expose viewport emulation. No claim of universal-device completion is made.

The login retains a continuous black surface with purple actions. Back now sits beside the form heading, the mobile gutters are 20px, and excess header spacing is reduced. These refinements still need the new deployed preview checked.

Main branch protection is already complete. PR #74 contains the existing security/payment/PMS/call repairs and this legal review fix. WeHouse is not yet technically production-ready: Test Google/provider configuration, complete role/booking/payment/chat/call journeys, physical-device tests and restore checks remain. Live/manual payouts stay deferred until the owner's legal/business work is ready.

Supabase hook implementation follows [Before User Created](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook) and [Auth Hooks security/configuration](https://supabase.com/docs/guides/auth/auth-hooks). No paid plan or add-on was purchased.

## Coordinated release finding

Production has 38 pending database migrations from PR #74, plus the new conditional-publication migration. Two older migrations would reset existing worker review/approval state before later migrations make biometrics optional. Do not blindly apply that sequence or merge into an automatic frontend release. Preserve the current review history, verify the upgrade on representative existing records, then release matching database, Edge Functions, Auth hook and production frontend. No production data was changed in this check.
