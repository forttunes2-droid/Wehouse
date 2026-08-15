# Phase 3 — WeHouse Dashboard & Website Unification

Status: **COMPLETED — ready for main**

Branch: `agent/phase3-website-unification`

## Non-negotiable rule

Phase 3 was completed as a **unification pass, not a tab-removal pass**.

Useful dashboard navigation remains available. On phones, role workspaces keep bottom navigation. When a role has more destinations than fit cleanly, overflow is placed under **More** rather than deleting real work areas.

## Canonical product rules now enforced

1. **One WeHouse workspace shell** for Creator, Admin, Staff, Worker and Property Partner.
2. **One private Account destination per role.** Account owns personal profile settings, privacy/security and sign-out.
3. **Worker Professional Profile stays separate** because it is a public/business-facing profile, not a duplicate private Account page.
4. **Operational work tabs are preserved.** Nested tabs remain where they represent a real workflow.
5. **Consistent responsive behavior:** desktop/tablet show workspace tabs in the header; phone uses the bottom rail plus More overflow where required.
6. **The outer app shell no longer wraps operational dashboards in a second dashboard/navigation system.** It owns consumer navigation and page-level Back behavior only.
7. **Pages that already own Back do not receive a second mobile Back control.**

## Role navigation retained

### User
- Home
- Explore
- Saved
- Messages
- Account

### Worker
Live Worker:
- Home
- Jobs
- Earnings
- Professional Profile
- Account

Pre-live Worker keeps only activation-relevant destinations plus Account.

### Staff
The assigned Staff module remains intact. Examples include:
- Property Operations: Pipeline, Live Housing
- Finance: Overview, Payments, Payouts, Ledger & Audit
- Support: Inbox
- Worker Verification: Worker Reviews
- Field Operations: Inspections
- Account

### Creator
- Overview
- Operations
- Communications
- Finance
- Analytics
- Settings
- Account

### Admin
- Overview
- Operations
- Communications
- Issues
- Account

### Property Partner
- Overview
- Property Requests
- My Properties
- Finance
- Communication
- Account

## Implementation

- `WorkspaceFrameV2` is the canonical operational workspace frame.
- Staff and Worker use it directly.
- Creator, Admin and Property Partner use `LegacyWorkspaceBridge`, which keeps their existing business logic and tab state while removing the old nested header/navigation chrome.
- `DesktopLayoutUnified` removes the second operational dashboard shell while retaining the customer desktop navigation.
- `nav2.tsx` no longer defines duplicate outer Account destinations for operational roles.

## Validation

- Pull-request changed-file audit: only Phase 3 shell/navigation files were changed; housing/payment/database lifecycle logic was not modified.
- TypeScript + production bundle: **passed** on commit `a56f468c707548dd21887bb9a7b2b05a50b3aaed` through the successful Netlify deploy-preview build.
- The following closeout commit changes this document only; it does not alter runtime code.
- Vercel preview checks during the rapid-push closeout were blocked by the project build-rate limit, not by a source/build failure.
- Full authenticated role-by-role end-to-end workflow testing remains part of the later Full QA phase; Phase 3 does not alter the underlying role workflows.

## Completion result

Phase 3 is complete at the architecture/UI-shell level:

- operational dashboards use one visual/navigation framework;
- duplicate outer Account/logout responsibility is removed;
- useful dashboard tabs are preserved;
- mobile bottom navigation remains intentional;
- the website no longer presents operational dashboards as separate apps nested inside another dashboard shell.
