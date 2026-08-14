# Phase 3 — Dashboard Structure Completion

Date: 2026-08-14
Branch: `agent/phase-1-foundation`

## Phase rule

Phase 3 is **not a visual redesign**. Existing dashboard styling and good workflow surfaces are preserved. The audit changes only:

- duplicate navigation or duplicate management surfaces;
- irrelevant information shown to a role;
- missing actions that belong to an existing workflow;
- role/module ownership conflicts;
- responsive conflicts on phone/tablet/desktop;
- dashboard actions that contradict backend permissions or verification rules.

A summary card on Overview is not considered duplicate functionality when it only reports a count/status and links to the single canonical management area. Two separate surfaces that both manage the same workflow are duplicates and are not allowed.

---

## 1. User workspace

### Canonical navigation
- **Home** — personalized starting point, search entry, housing/services/roommate shortcuts and recent relevant inventory.
- **Explore** — canonical discovery/search surface for apartments, hotels, Workers and roommate discovery. `Explore` is only a compatibility route into the canonical Search implementation, not a second discovery engine.
- **Saved** — the User's saved listings only.
- **Messages** — eligible conversations and official communication.
- **Account** — personal profile, privacy/security and account actions.

### Why this is correct
The User is a customer/student/tenant, not an operator. Management, finance administration, Staff controls, Worker verification and platform configuration do not belong here.

### Responsive ownership
The normal User has one mobile bottom navigation from `App.tsx`. `DesktopLayout` does not create a second operational workspace rail for the User, so the User does not receive duplicate mobile navigation.

---

## 2. Worker workspace

### Before the Worker is live
- **Home** — one activation/progress path showing what is complete and the next required action.
- **Profile** — professional service information and entry to the verification workflow.

### After the Worker is live
- **Home** — current work priorities.
- **Jobs** — one job list. Every job carries its own status; there are no global `Confirmed`, `Completed`, etc. tabs.
- **Earnings** — Worker wallet/earnings and payout information.
- **Profile** — public professional profile, service coverage, reputation and verification entry.

### Why this is correct
Activation status is one progress flow rather than many status dashboards. Jobs are individual records with individual lifecycle statuses. Financial information has one Worker home instead of being unnecessarily split across multiple competing tabs.

### Responsive ownership
`WorkspaceFrameV2` owns the Worker responsive workspace navigation. The general desktop layout does not mirror a second Worker rail from this component.

---

## 3. Staff workspace

A Staff account receives **exactly one operational module**. The Staff dashboard is generated from that assignment; Staff do not see every module.

### Operations Staff
- **Properties** — assigned-branch property pipeline/work.

Why: property operations are this Staff member's assigned job. Support, Finance and Worker review are irrelevant.

### Support Staff
- **Inbox** — submitted support conversations for the assigned branch.

Why: Support Staff handle actual conversations. Merely opening Support does not create a management case.

### Finance Staff
- **Overview** — finance workload summary.
- **Payments** — incoming verified payment records.
- **Payouts** — withdrawals/refunds.
- **Ledger & Audit** — commission, escrow and finance audit records.

Why: these are distinct stages/views of one Finance responsibility, not unrelated dashboard modules.

### Verification Staff
- **Worker Reviews** — submitted Worker professional verification/review only.

Why: Worker verification is a trust/verification responsibility. General website-security monitoring was removed from this Staff module because suspicious website activity belongs to the platform Security & Audit system, not to Worker Verification Staff.

The review screen shows external identity status/provider and professional evidence. Raw government-ID review is not part of the WeHouse Staff workflow.

### Field Officer
- **Inspections** — assigned field inspection work only.

Why: this Staff member's responsibility is physical/field verification, not general platform operations.

### Assignment rule
Creator assigns a Staff member to State + LGA + exactly one module. Admin can appoint a same-branch User as Staff only, and appointment requires the module in the same atomic server operation.

---

## 4. Admin workspace

Admin authority is State/LGA scoped.

### Top-level areas
- **Overview** — branch health and counts; summary only.
- **Operations** — branch management work.
- **Communications** — branch support/official communication.
- **Issues** — branch moderation reports.

### Operations sub-areas
- **People** — regular Users and Property Partners in the Admin branch.
- **Staff** — branch Staff and their one assigned module.
- **Properties** — branch property pipeline.
- **Workers** — branch Worker status/professional review.
- **Service Bookings** — branch Worker-service booking oversight.

### Why this is correct
Admin is a local branch manager. Global platform Settings, global Analytics and global Finance policy do not belong in this dashboard. Finance operational work is handled by assigned Finance Staff; global finance policy belongs to Creator Finance.

Admin may appoint a normal User in the same State/LGA as Staff, with exactly one Staff module. Admin cannot create another Admin, cannot create Creator, and cannot convert Worker/Property Partner accounts into Staff.

Worker approval is server-blocked until external government identity verification has passed. The Admin review UI shows external identity status rather than raw government-ID images.

---

## 5. Creator workspace

### Top-level areas
- **Overview** — global platform status and priority summaries.
- **Operations** — global operational management.
- **Communications** — global support inbox and announcements.
- **Finance** — withdrawals, commissions and financial settlement rules.
- **Analytics** — platform reporting/performance.
- **Settings** — platform identity/access/legal/Assistant connection and marketplace configuration.

### Operations sub-areas
- **People** — regular Users and Property Partners.
- **Team** — Admins, Staff, branch placement and Staff module assignment.
- **Properties** — global property pipeline.
- **Workers** — global Worker status/professional review.
- **Bookings** — Worker, apartment and hotel booking records.
- **Issues** — listing reports/moderation.

### Why this is correct
Creator is the global operator. Overview summarizes but does not replace Operations/Finance/etc. Finance owns money/settlement rules; Settings owns platform configuration, legal documents and marketplace choices, so the two are not competing configuration homes.

Creator can take an existing normal User account and assign it as:
- **Admin** — State + LGA required;
- **Staff** — State + LGA + exactly one Staff module required.

Creator can return Admin/Staff to User. Public signup never exposes Admin/Staff/Creator as account-type choices.

Worker review shows external identity status/provider and professional evidence rather than raw government-ID images. Server approval is blocked until external identity verification is verified.

---

## Phase 3 corrections applied

1. Restored missing Creator → User → Admin/Staff assignment UI using the existing controlled backend workflow.
2. Made Admin Staff appointment atomic and required the Staff module during appointment.
3. Fixed the user-detail Support action: `Go to Support Conversation` is rendered only when a real support conversation exists.
4. Removed duplicate Creator/Admin workspace navigation on phone/tablet: the mirrored bottom navigation is the only primary workspace rail below the desktop breakpoint; the header rail remains for desktop.
5. Removed website Security monitor/activity from Verification Staff. Verification Staff now see Worker Reviews only.
6. Removed raw government-ID review from Admin/Creator Worker panels and replaced it with scoped external identity status/provider.
7. Hardened Admin/Creator Worker approval so the server rejects approval until external identity verification is `verified`.
8. Preserved the Worker one-list/per-job-status pattern instead of introducing status tabs.
9. Preserved the existing User and Worker layouts because the audit found their current dashboard ownership structurally appropriate.

---

## Verification performed

- Creator role assignment was tested inside a rollback transaction: a normal User could be assigned Admin with State/LGA; rollback restored the User unchanged.
- Admin Staff appointment was tested inside a rollback transaction: a same-branch User could be appointed Staff with an operational module; rollback restored the User unchanged.
- The external-identity approval guard was tested inside a rollback transaction and correctly blocked Worker approval when identity was not verified.
- Post-test queries confirmed the real test Users remained normal Users with no active Staff module.
- The current Vercel preview branch builds successfully after the Phase 3 corrections.
- Source-level responsive audit confirms one navigation owner per role at phone/tablet/desktop breakpoints.

Full interactive cross-device/account QA remains Phase 11; Phase 3 does not claim the later complete device/browser test matrix has already been executed.
