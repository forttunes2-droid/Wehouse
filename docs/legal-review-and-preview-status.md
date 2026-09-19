# Legal review and preview status — 19 September 2026

## What the owner saw

The PR preview uses WeHouse Test. A read-only count confirmed no Test Auth accounts, while the owner's email exists once in production. No password was inspected, copied or tested. A live account therefore cannot sign in to the empty Test project. Login now labels non-production hosts and links to the live site. Production account recovery remains separate.

The Privacy Policy and Terms endpoints return null in both projects. There are no published clauses to deduplicate. The repeated title/banner/empty-message/publisher footer were interface chrome. Both public documents now use one shared, continuous dark page with one page title, a concise unavailable state, readable text and inline confirmation after the document. Account's legal panel has two document rows; its bulk unchecked-document acceptance form is removed. Navigation/editor labels consistently use Terms of Service. Published document bodies were not edited or fabricated.

A source scan of 146 top-level page/component TSX files flagged only Activity/Messages in StaffWorkspaceRepair after the repair. Inspection confirmed these belong to separate OperationsInbox, SupportInbox and ActivityOnlyInbox render paths, not simultaneous duplicate headings. This is a literal-heading scan, not certification of every dynamic label, nested component combination or signed-in screen.

## Registration and confirmations

- Create account loads both published documents before submission. Each expands in normal page flow. The checkbox becomes available when the end is reached; users must confirm both. No timer or claim of proving comprehension.
- Both the auth helper and Supabase Before User Created hook validate the exact published policy IDs and checksums. Missing, unpublished or stale documents fail closed before identity creation.
- New accounts use Create account, reviewed documents, email/password, then the existing Google verification. Continue with Google remains the sign-in route for existing accounts. A brand-new direct OAuth identity without the registration declaration is rejected with instructions to choose Create account. Recovery/new-device confirmation remains separate.
- Auth metadata is only a user's own declaration about reviewed text, never a role or authorization source. A custom client can declare acceptance without reading; no technical system can establish comprehension. The server does establish which published versions were declared and prevents missing/stale declarations.
- Account setup cannot mark a profile complete until both current versions have server-side receipts. It still requires the existing adult-eligibility check.
- Acceptance records bind to the actual displayed version/checksum. The old RPC that accepted whichever version happened to be current is no longer callable by application users. Repeated acceptance is idempotent.
- Pre-signup declarations are reused for the same versions during setup; users are not asked to agree to unchanged text again. A changed version requires fresh review. Account's legal reader uses the same version-aware endpoint.

## Verification and deployment

146 JavaScript tests, TypeScript build and lint pass. New executable tests cover missing/partial/stale review and the real signup helper's refusal to create an identity before review. The SQL contract covers missing publications, exact version declarations, direct OAuth without a declaration, missing/null/incorrect checksum, one-receipt completion rejection and receipt retry. Fixtures roll back; no synthetic policy, account or receipt is left published.

Migration `20260919135158_reviewed_legal_signup_gate` is applied to **WeHouse Test**. Its Before User Created hook is enabled in the Test dashboard. A real Test Auth signup request with a disposable invalid-domain identity returned HTTP 403 and the intended unpublished-documents message; Test Auth remains empty. Hosted SQL contract passes. Supabase restricts SET ROLE to its Auth owner in hosted and local environments, so the contract checks required execution grants and CI also calls the actual Auth HTTP endpoint; it does not expand role membership to run a test. The local config includes the same hook; CI now runs the legal contract along with the existing five contracts.

The security advisor's new authenticated-function notice for accept_reviewed_legal is intentional: it records only the current signed-in profile's receipt. Anonymous and authenticated callers cannot invoke the signup hook, and anonymous callers cannot invoke acceptance. Existing broader privileged-function notices remain outside this scoped repair. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

All changes stay on PR #74. Production frontend, Auth hook and migration are **not released by this pass**. Deploy the migration and frontend together through protected main; enable the production Before User Created hook before opening registration. Legal publication remains the Creator's separately reviewed action. Do not publish fabricated policies or copy customer accounts to make the preview appear populated.

## Mobile and remaining work

The owner's Android screenshot shows a continuous black sign-in surface with full-width controls. The legal pages use normal vertical scrolling, safe-area padding and a reading-width limit on wider screens; no floating modal or sticky acceptance card. The deployed desktop preview was visually reviewed at 1363 CSS pixels: one legal-page heading, no fixed/sticky reader elements, no horizontal overflow, working Back navigation, and disabled signup while documents are unpublished. Actual narrow-viewport, iPhone/iPad and keyboard journeys remain unverified by this browser, which does not expose viewport emulation. No claim of universal-device completion is made.

Main branch protection is already complete. PR #74 contains the existing security/payment/PMS/call repairs and this legal review fix. WeHouse is not yet technically production-ready: Test Google/provider configuration, complete role/booking/payment/chat/call journeys, physical-device tests and restore checks remain. Live/manual payouts stay deferred until the owner's legal/business work is ready.

Supabase hook implementation follows [Before User Created](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook) and [Auth Hooks security/configuration](https://supabase.com/docs/guides/auth/auth-hooks). No paid plan or add-on was purchased.
