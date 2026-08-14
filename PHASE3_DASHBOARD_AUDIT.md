# Phase 3 — Dashboard Structure & Deduplication Audit

Date: 2026-08-14
Branch: `agent/phase-1-foundation`

## Principle

Phase 3 is not a visual redesign. The existing role workspaces are retained. Work in this phase is limited to:

- removing duplicate/conflicting navigation or workflow entry points;
- removing irrelevant actions that have no backing data;
- repairing role-to-workspace handoffs;
- keeping each role focused on the work it actually performs;
- preserving responsive behavior across phone, tablet and desktop.

A summary card may link to a canonical workflow without becoming a second implementation of that workflow.

## Controlled operational-role creation

Admin and Staff are not public signup account types.

- A person first has a normal WeHouse User account.
- Creator may assign an existing User as Admin or Staff.
- Creator selects State + LGA for Admin/Staff and selects one operational module for Staff.
- Admin may appoint an existing User as Staff only inside the Admin's own assigned State/LGA.
- Admin Staff appointment requires the Staff module in the same operation.
- Admin cannot create another Admin or Creator.
- Once promoted, the account belongs under Team/Staff management instead of remaining duplicated as a regular User workflow.

## User workspace

Primary navigation:

1. **Home** — discovery entry point, useful summaries, recent housing and quick actions.
2. **Explore** — the canonical full Search/discovery workflow for listings and services.
3. **Saved** — only content the User intentionally saved.
4. **Messages** — User conversations and unread communication state.
5. **Account** — profile, privacy, notifications, security and legal consent.

Why this structure: the User is a consumer of housing, roommate and local-service workflows. Operational management does not belong here.

Phase-3 correction: phone/tablet and desktop now both navigate Explore through the canonical `search` route. The legacy `explore` route remains only as a compatibility alias and is not a second discovery implementation.

## Worker workspace

### Worker still activating

Primary navigation:

1. **Home** — one activation/progress path and the next required action.
2. **Profile** — public professional/service information.

Jobs and Earnings stay hidden until the Worker is live.

### Live Worker

Primary navigation:

1. **Home** — priority work and next job.
2. **Jobs** — Worker job/booking records and their per-item statuses.
3. **Earnings** — Worker financial records.
4. **Profile** — professional/service profile.

**Account** remains separate from Profile: Account is personal account/security/settings; Profile is the professional information customers can use to evaluate the Worker.

Why this structure: activation requirements should not be scattered into status tabs, and an inactive Worker should not see operational modules that cannot yet be used.

## Staff workspace

A Staff account receives **exactly one operational module**. Staff do not see every Staff module.

- **Operations Staff** → Properties.
- **Support Staff** → Inbox.
- **Field Officer** → Inspections.
- **Finance Staff** → Overview, Payments, Payouts, Ledger & Audit.
- **Verification Staff** → Worker Reviews.

If a Staff account has zero or conflicting module assignments, the workspace stops and reports the assignment problem instead of merging unrelated responsibilities.

Why this structure: Staff are task-specific operational accounts. Giving every Staff member every module would duplicate responsibility, weaken access boundaries and make the dashboard confusing.

Phase-3 correction: Admin appointment is now atomic — User → Staff + selected module occur together, preventing a newly appointed Staff member from landing in an unusable unassigned workspace.

## Admin workspace

Top-level navigation:

1. **Overview** — branch health, counts and links to the canonical branch workflows.
2. **Operations** — actual branch record management.
3. **Communications** — branch inbox and official announcements.
4. **Issues** — listing reports/moderation requiring branch action.

Operations contains:

- **People** — regular Users and Property Partners in the Admin's branch.
- **Staff** — branch Staff and their one operational module.
- **Properties** — property request/inspection/preparation/publication pipeline.
- **Workers** — branch Worker status and professional verification review.
- **Service Bookings** — branch Worker-service bookings.

Why this structure: Admin authority is State/LGA-scoped. Overview summarizes; it does not duplicate record management. Each record type has one operational home.

## Creator workspace

Top-level navigation:

1. **Overview** — platform-wide status and priority work.
2. **Operations** — platform operational records and team management.
3. **Communications** — support and official announcements.
4. **Finance** — platform financial operations/rules.
5. **Analytics** — performance/reporting.
6. **Settings** — global platform/marketplace configuration only.

Operations contains:

- **People** — regular Users and Property Partners.
- **Team** — existing Admins/Staff, branch placement and Staff modules.
- **Properties** — property pipeline.
- **Workers** — Worker account/verification review.
- **Bookings** — Worker/apartment/hotel booking records.
- **Issues** — moderation reports.

Creator appointment is initiated from the canonical People record: Creator can turn a User into Admin or Staff with the required branch/module data. The promoted account then belongs in Team. No duplicate second User list is added to Team.

Why this structure: Creator needs global oversight and global configuration, but a workflow still has one canonical management home.

## Phase-3 corrections completed

- Removed duplicate Creator/Admin primary navigation on phone/tablet: when the workspace rail is mirrored into the bottom navigation, the source rail is desktop-only.
- Kept desktop workspace navigation intact.
- Support Conversation action is displayed on a person record only when a real support conversation exists.
- Restored Creator's controlled User → Admin/Staff assignment UI using the existing hardened backend flow.
- Added atomic Admin User → Staff + module appointment.
- Canonicalized User Explore navigation to the Search route across device layouts.
- Kept Worker activation/live navigation separate instead of exposing unusable Jobs/Earnings early.
- Kept Staff module-specific rather than combining all Staff responsibilities.

## Responsive structure verified in code

- **Phone:** User uses its consumer bottom navigation; Creator/Admin use one mirrored workspace bottom rail; Worker/Staff use their workspace mobile navigation.
- **Tablet:** Creator/Admin continue using the single bottom workspace rail until the desktop breakpoint; Worker/Staff switch to their compact workspace tab rail at the small breakpoint.
- **Desktop:** global role sidebar appears at `lg`; Creator/Admin source workspace rail is visible once; responsive grids expand without introducing another copy of the workflow.
- Content containers use responsive widths, grids and overflow handling rather than fixed mobile-only dimensions.

The supplied phone recording was used to identify the duplicated Creator navigation and the absent-support action. Full signed-in visual regression testing at a device-width matrix remains part of Phase 11 QA; this phase does not claim a browser test that the current execution environment cannot perform.

## Phase-3 completion condition

The active code now preserves one dashboard/workspace per role, one canonical home per workflow, Staff module isolation, controlled Admin/Staff creation, and non-duplicated primary navigation. Latest implementation commits must remain Vercel `READY` before this phase is considered closed.
