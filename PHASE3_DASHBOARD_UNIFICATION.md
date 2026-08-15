# Phase 3 — WeHouse Dashboard & Website Unification

Status: **REOPENED / IN PROGRESS**

Branch: `agent/phase3-website-unification`

## Non-negotiable rule

Phase 3 is a **unification pass, not a tab-removal pass**.

Useful dashboard navigation must remain available. On phones, role workspaces keep their bottom navigation. When a role has more destinations than fit cleanly, the overflow belongs under **More** rather than being deleted.

The purpose of Phase 3 is to remove duplicate responsibility and make every page feel like part of one WeHouse product.

## Canonical product rules

1. **One WeHouse visual shell**
   - shared page background, content width, header spacing, typography and navigation behavior;
   - role identity may change labels/content, but not create a different-looking product.

2. **One private Account destination per signed-in role**
   - Account owns personal profile settings, security/privacy and sign-out;
   - Professional Profile is separate only where it is genuinely public/business-facing (for example Worker professional profile).

3. **One sign-out responsibility**
   - do not render Logout in both the global shell and a dashboard;
   - canonical role workspaces route to Account instead.

4. **Preserve real work tabs**
   - Creator/Admin/Staff/Worker/Property Partner operational tabs are not removed merely to make navigation shorter;
   - nested tabs remain when they represent a real sub-workflow.

5. **Consistent responsive behavior**
   - desktop/tablet: all primary workspace tabs remain visible when space allows;
   - phone: primary tabs remain in the bottom bar, with overflow under More;
   - the phone experience is not a different information architecture.

6. **One component language**
   - cards, status badges, filters, empty states, loading states, forms, modal surfaces and back navigation should share the same visual grammar.

## Current shell inventory

### User
Uses the public/customer navigation shell. Keep Home, Explore, Saved, Messages and Account as the customer-level destinations.

### Worker
Uses `WorkspaceFrameV2`.

Primary live tabs:
- Home
- Jobs
- Earnings
- Professional Profile
- Account

Pre-live Worker keeps only the activation-relevant destinations plus Account. Jobs/Earnings are not shown until the Worker is live.

### Staff
Uses `WorkspaceFrameV2` and exposes only the assigned operational module. Module-specific tabs remain intact (for example Pipeline / Live Housing or Finance records).

### Creator
Still uses its own dashboard header/navigation implementation. Must be migrated to the canonical workspace frame while retaining:
- Overview
- Operations
- Communications
- Finance
- Analytics
- Settings

### Admin
Still uses its own dashboard header/navigation implementation. Must be migrated to the canonical workspace frame while retaining:
- Overview
- Operations
- Communications
- Issues

### Property Partner
Still uses its own dashboard header/navigation implementation and is the remaining role with mixed Account/logout ownership. Must be migrated without removing:
- Overview
- Property Requests
- My Properties
- Finance
- Communication
- Account

## Phase 3 sequence

### 3A — Shared navigation ownership
- remove dormant duplicate Account definitions for role dashboards that already own Account;
- preserve customer Account and temporary Property Partner Account until migration;
- keep phone bottom navigation.

### 3B — Canonical workspace frame
- standardize header, background, spacing, responsive tabs and Account entry;
- Staff and Worker use this frame first;
- Creator, Admin and Property Partner migrate next.

### 3C — Duplicate responsibility audit
For every role/page, remove only duplicated responsibilities such as:
- Account vs Profile vs Settings copies;
- repeated Logout controls;
- duplicate Support/Communication destinations;
- two navigation bars exposing the same destination;
- repeated status cards showing the same state under different labels.

### 3D — Shared component pass
Consolidate status badges, cards, filters, form controls, empty/loading states, detail headers and responsive spacing.

### 3E — Full responsive QA
Verify every role on phone, tablet and desktop. No role should lose a required workflow or tab during unification.

## Completion test

Phase 3 is complete only when:

- opening any signed-in WeHouse page clearly feels like the same product;
- no role shows duplicate Account/Profile/Settings/Logout responsibility;
- dashboard work tabs remain available and correctly responsive;
- mobile bottom navigation is intentional and consistent;
- each piece of information has one clear home;
- no role-specific workflow is removed simply for visual simplicity.
