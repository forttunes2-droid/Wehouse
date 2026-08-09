# WeHouse Dashboard Workflow Audit

Date: 2026-08-09
Scope: Active role dashboards, dashboard navigation, duplicate dashboard routes, placeholders, and confirmed dead/overlapping dashboard UI on `main`.
Method: Repository code only. No new product rules are introduced here.

## Agreed consolidation rule

For every role: audit first, retain one canonical dashboard, remove dead/placeholder/duplicate paths only after tracing their active callers, keep only role-relevant functions, and modernize the retained interface without creating a parallel replacement.

## Active role entry points

| Role | Active dashboard entry | Current state |
|---|---|---|
| User | `src/pages/Home.tsx` plus `src/pages/Dashboard.tsx` for Account | Home is the customer landing/discovery surface. `Dashboard.tsx` is currently an account hub shared by all roles rather than a dedicated user operations dashboard. |
| Worker | `src/pages/WorkerDashboard.tsx` | Canonical dashboard exists with Overview, Jobs, Schedule, Wallet, Services, Reviews, Verification and Account. |
| Property Partner | `src/pages/PropertyOwnerDashboard.tsx` | Canonical integrated dashboard exists with Overview, My Properties, Wallet, Earnings, Messages, Support and Account. It no longer mounts a separate legacy dashboard beneath new panels. |
| Staff | `src/pages/StaffDashboard.tsx` | Permission-driven dashboard exists with Overview plus only granted Operations, Finance, Support, Verification and Field Officer modules, then Settings. |
| Admin | `src/pages/AdminDashboard.tsx` | Active management dashboard exists but still contains older layout/style and an explicit nationwide-data assumption that conflicts with previously implemented branch/LGA authorization rules. |
| Creator | `src/pages/CreatorDashboard.tsx` | Active platform dashboard exists, but it remains a very large mixed component and duplicates navigation concepts with `management` and `analytics` routes. |

## Confirmed duplicate or dead dashboard paths

### 1. Worker Jobs placeholder duplicates the canonical Worker dashboard

`src/pages/JobsPage.tsx` contains only local tab state and empty “No jobs” placeholders. It does not load worker bookings. The real job lifecycle is implemented in the `Jobs` tab inside `WorkerDashboard.tsx`, using `getMyBookingConversations` and `BookingNegotiationChat`.

Classification: **dead placeholder / duplicate**.

Required correction: remove the standalone placeholder route and make Worker navigation open the canonical Worker dashboard Jobs section.

### 2. Worker Calendar placeholder duplicates the canonical Worker dashboard

`src/pages/CalendarPage.tsx` only displays “Calendar coming soon.” The real schedule is implemented in the `Schedule` tab inside `WorkerDashboard.tsx`, reading scheduled `worker_bookings`.

Classification: **dead placeholder / duplicate**.

Required correction: remove the standalone placeholder route and make Worker navigation open the canonical Worker dashboard Schedule section.

### 3. Explore and Search are duplicate routes

The former large marketplace implementation in `Explore.tsx` was removed. `Explore.tsx` is now only an alias/wrapper for the canonical `Search.tsx` apartment discovery page. Both still remain in navigation and routing.

Classification: **duplicate route alias**.

Required correction: retain one customer discovery destination in dashboard/navigation. Preserve an internal compatibility redirect only if old saved navigation values require it; do not show both as separate user tools.

### 4. Management duplicates operational dashboards

In `App.tsx`, the `management` route renders `CreatorDashboard`, `AdminDashboard`, or `StaffDashboard` again. Desktop and mobile navigation can therefore show both a Dashboard/Staff Hub item and a Management item that open the same component.

Classification: **duplicate navigation path**.

Required correction: one dashboard entry per operational role. Management remains an internal dashboard section/tab, not a second copy of the whole dashboard.

### 5. Analytics is exposed as a separate generic page

Creator/Admin/Staff navigation exposes `AnalyticsPage.tsx` separately while their dashboards already contain operational statistics and reports. This needs dependency review before removal because some roles may still require a dedicated analytics surface.

Classification: **overlapping; requires caller/data audit before deletion**.

## Role-specific findings

## User

### Keep
- `Home.tsx` as customer landing page.
- Canonical Apartment Search, Hotels, Saved, Messages, reservations/bookings and Account routes.
- `Dashboard.tsx` profile/account presentation where useful.

### Fix
- Do not present generic role shortcuts to operational roles through the same Account page when their dashboard already contains Account.
- Remove duplicate Explore/Search navigation.
- Ensure the customer Account surface only contains profile, privacy, security, reservations/bookings and relevant customer tools.

## Worker

### Keep
- `WorkerDashboard.tsx` as the only Worker dashboard.
- Overview, Jobs, Schedule, Wallet, Services, Reviews, Verification and Account.
- Verified-only availability control.
- Real booking conversations and canonical wallet.

### Remove/replace
- `JobsPage.tsx` placeholder.
- `CalendarPage.tsx` placeholder.
- Duplicate external Worker wallet route where it only repeats the dashboard Wallet tab, after all callers are redirected.

### Review
- `setWorkerAvailability` wrapper still accepts a user ID argument even though the hardened RPC derives identity. Confirm wrapper signature and remove unnecessary identity input if still present.

## Property Partner

### Keep
- `PropertyOwnerDashboard.tsx` as the canonical partner dashboard.
- Property submission through `PropertyInspectionRequestPanel`.
- Published listings read-only.
- Pending/available/held/reversed earnings model.
- Partner-only WeHouse messaging/support.

### Fix
- Replace dual `owner_id OR partner_id` dashboard queries with the canonical ownership identifier after the listing-schema compatibility decision is complete.
- Ensure Overview available count uses canonical listing statuses only. Current code also checks `status === 'approved'`, which is not part of the consolidated listing lifecycle.
- Confirm Account and external Wallet navigation do not duplicate dashboard tabs unnecessarily.

## Staff

### Keep
- Permission-driven modules.
- Branch-scoped analytics helper.
- One dashboard whose visible modules depend on granted permissions.

### Fix
- Remove duplicated `management` route to the same Staff dashboard.
- Review `SettingsTab` content so Staff cannot access controls outside staff account responsibilities.
- Confirm Finance module appears only for finance permission and uses the canonical finance system.

## Admin

### Critical conflict

`AdminDashboard.tsx` contains the comment and implementation assumption “Admin sees ALL data nationwide (scope not restricted)” and calls broad helpers such as `getAllUsers()` and `getAllListingsAdmin()` for stats and lists.

This conflicts with the previously established Admin LGA/branch boundary. Even if database RPC/RLS blocks unauthorized mutations, the dashboard must not request or display nationwide data.

Classification: **active but authorization/UI scope is incorrect**.

Required correction:
- Replace broad list/stat calls with branch/LGA-scoped RPCs.
- Fail closed if assigned state/LGA is missing.
- Admin must never manage, modify, delete, demote or promote the Creator.
- Admin can only manage authorized roles/data inside the assigned operational scope.
- Modernize the retained dashboard after scope correctness is established.

## Creator

### Keep
- Platform-wide management.
- Protected Creator authorization for critical actions.
- Users, Workers, Partners, Staff, Listings, Bookings, Reports, Support, Verification, Announcements and Creator Settings.

### Fix
- Remove duplicate Management route that re-renders the full Creator dashboard.
- Separate Account from platform Settings.
- Reduce the single very large component by retaining existing modules as canonical child components where already available; do not create a second Creator dashboard.
- Verify old role aliases and obsolete role-transition UI are not present.
- Keep Creator protected from modification/deletion by Admin or Staff.

## Navigation consolidation target

### User
Home · Search · Saved · Messages · Account

### Worker
Home · Worker Dashboard · Messages · Wallet/Account (final five-item choice must point to canonical dashboard sections, not placeholder pages)

### Property Partner
Home · Property Partner Dashboard · Messages · Wallet · Account

### Staff
Home · Staff Hub · Messages · Account; operational modules live inside Staff Hub according to permissions.

### Admin
Home · Admin Dashboard · Messages · Account; all management modules live inside Admin Dashboard.

### Creator
Home · Creator Dashboard · Analytics/Reports only if retained after dependency audit · Account.

## Implementation order

1. Navigation and route consolidation: remove duplicate Dashboard/Management and Explore/Search exposure.
2. Worker cleanup: redirect callers, remove JobsPage and CalendarPage placeholders, retain WorkerDashboard tabs.
3. Property Partner final cleanup: canonical statuses and ownership query; remove duplicate external tab paths where safe.
4. Staff cleanup: permission-only dashboard and Settings audit.
5. Admin correction: enforce assigned scope in every dashboard query and action, then modernize.
6. Creator consolidation: remove duplicate routes and split the retained component into existing canonical modules without parallel implementations.
7. User Account cleanup: customer-only tools and one discovery route.
8. TypeScript/build/deployment validation and dead-import search.

## Current verdict

- Worker, Property Partner and Staff have usable canonical dashboards, but navigation and some duplicate external pages still need removal.
- Admin is not complete because its active dashboard assumes nationwide visibility.
- Creator is functional but not fully consolidated.
- User discovery/account navigation still exposes duplicate Search/Explore concepts.
- Dashboard phase is therefore **in progress**, not complete.
