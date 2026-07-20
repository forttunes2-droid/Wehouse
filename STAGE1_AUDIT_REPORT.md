# WEHOUSE — STAGE 1 AUDIT REPORT
## Freeze, Audit, and Map
### Date: 2026-07-20 | Branch: main | Commit: f683f22

---

## EXECUTIVE SUMMARY

WeHouse is a React + Vite + TypeScript single-page application using Supabase as the backend. It operates as a **page-state-driven app** (no React Router) — navigation is managed via a `navPage` state variable in `App.tsx` that switches between 49+ page components. The app serves 6 roles: user, worker, property_partner, staff, admin, and creator.

**Build Status:** PASSES (zero TypeScript errors, 20.8s build time)
**Deployment:** Vercel via GitHub integration (main branch)
**Database:** Supabase (project: rkrhnkhppeihvmuwvsvn)

---

## A. CURRENT SYSTEM ARCHITECTURE

### A1. Application Entry Point

| Component | File | Purpose |
|-----------|------|---------|
| **Renderer** | `src/main.tsx` | Creates React root, wraps App in StrictMode + ErrorBoundary |
| **NativeInit** | `src/main.tsx:9` | Capacitor StatusBar/SplashScreen setup (mobile only) |
| **App** | `src/App.tsx` | Central router, auth provider wrapper, layout wrapper |
| **ErrorBoundary** | `src/components/ErrorBoundary.tsx` | Catches render errors, shows fallback UI |

### A2. How the Application Starts

1. `main.tsx` renders `<App />`
2. `App.tsx` calls `useAuth()` hook
3. `useAuth` checks Supabase session via `supabase.auth.getSession()`
4. If session exists → `loadProfile(authId)` → reads `profiles` table by `auth_id`
5. If no session → shows Login page
6. After profile loads → `determinePage(profile)` returns initial page based on role
7. App.tsx renders the page via `renderPage()` switch statement

### A3. Route System (No React Router)

Navigation is **state-based**, not URL-based:

```
User clicks → goTo(page) → setNavPage(page) → localStorage.setItem('wh_navpage', page)
→ renderPage() switch → renders matching component
```

**Critical:** `RESTORABLE_PAGES` array (App.tsx:102) controls which pages survive refresh. Missing pages redirect to home on refresh.

### A4. Layout Architecture

```
App.tsx
├── DesktopLayout (lg: sidebar + header, <lg: transparent)
│   └── Page Content (renderPage())
├── CreatorAuthModal (creator only)
├── AdminAuthModal (admin/staff only)
├── SupportChat (user role only)
└── BottomNav (mobile only, lg:hidden)
```

---

## B. AUTHENTICATION AND ROLE MAP

### B1. Role Storage

| Role | Stored In | Column |
|------|-----------|--------|
| All roles | `profiles` table | `role` (text) |
| Staff module | `staff_permissions` table | `module` (text) |

### B2. Role Loading Flow

```
supabase.auth.getSession() → auth.user.id
→ getProfileByAuthId(authId, email)
→ SELECT * FROM profiles WHERE auth_id = ? OR email = ?
→ profile.role determines everything
```

### B3. Role → Initial Page Mapping

| Role | Initial Page | Source |
|------|-------------|--------|
| user | `dashboard` (→ Home) | `useAuth.ts:176` |
| worker | `worker_dashboard` | `useAuth.ts:170` |
| property_partner | `property_partner` | `useAuth.ts:174` |
| staff | `staff_dashboard` | `useAuth.ts:173` |
| admin | `admin` | `useAuth.ts:172` |
| creator | `creator` | `useAuth.ts:171` |

### B4. Role → Dashboard Mapping

| Role | Dashboard Component | File |
|------|-------------------|------|
| user | Home (via Dashboard) | `src/pages/Home.tsx` |
| worker | WorkerDashboard | `src/pages/WorkerDashboard.tsx` |
| property_partner | PropertyOwnerDashboard | `src/pages/PropertyOwnerDashboard.tsx` |
| staff | StaffDashboard | `src/pages/StaffDashboard.tsx` |
| admin | AdminDashboard | `src/pages/AdminDashboard.tsx` |
| creator | CreatorDashboard | `src/pages/CreatorDashboard.tsx` |

### B5. Auth Hook State Machine

```
loading → login → setup/worker_setup → [role-specific page]
```

**Guards:**
- `profile_complete` check → Setup page
- `deleted` check → Restore option
- `maintenance_mode` setting → Block (except creator)
- `registration_open` setting → Block new registrations

---

## C. DASHBOARD MAP

### C1. ACTIVE Dashboards (rendered in App.tsx switch)

| Dashboard | File | Lines | Rendered For | Import Case |
|-----------|------|-------|-------------|-------------|
| **Home** | `src/pages/Home.tsx` | ~700 | All roles (default) | `case 'home'` |
| **CreatorDashboard** | `src/pages/CreatorDashboard.tsx` | ~3200 | creator, creator_admin, management | `case 'creator'`, `case 'management'` |
| **AdminDashboard** | `src/pages/AdminDashboard.tsx` | ~2500 | admin, management | `case 'admin'`, `case 'management'` |
| **StaffDashboard** | `src/pages/StaffDashboard.tsx` | ~1800 | staff, operations, field_officer, management | `case 'staff_dashboard'`, `case 'operations'`, `case 'field_officer'`, `case 'management'` |
| **WorkerDashboard** | `src/pages/WorkerDashboard.tsx` | ~1800 | worker | `case 'worker_dashboard'` |
| **PropertyOwnerDashboard** | `src/pages/PropertyOwnerDashboard.tsx` | ~1050 | property_partner, property_owner | `case 'property_partner'`, `case 'property_owner'` |
| **FinanceDashboard** | `src/pages/FinanceDashboard.tsx` | ~1200 | finance staff | `case 'finance_dashboard'`, `case 'finance'` |

### C2. LEGACY / REDIRECTED Dashboards

| Dashboard | File | Status | Notes |
|-----------|------|--------|-------|
| **OperationsDashboard** | `src/pages/OperationsDashboard.tsx` | REDIRECTED | `case 'operations'` → renders StaffDashboard |
| **FieldOfficerDashboard** | `src/pages/FieldOfficerDashboard.tsx` | REDIRECTED | `case 'field_officer'` → renders StaffDashboard |
| **WorkerVerificationDashboard** | `src/pages/WorkerVerificationDashboard.tsx` | UNUSED | Exists but never rendered in App.tsx switch |
| **PropertiesPage** | `src/pages/PropertiesPage.tsx` | GUARDED | Only for property_partner role |

### C3. Page Components (Non-Dashboard)

| Page | File | Purpose |
|------|------|---------|
| Login | `src/pages/Login.tsx` | Auth entry |
| Setup | `src/pages/Setup.tsx` | Profile completion |
| Search | `src/pages/Search.tsx` | Listing search |
| Explore | `src/pages/Explore.tsx` | Browse listings |
| Saved | `src/pages/Saved.tsx` | Saved listings |
| ListingDetail | `src/pages/ListingDetail.tsx` | Property detail |
| Chat | `src/pages/Chat.tsx` | Messaging |
| Roommate | `src/pages/Roommate.tsx` | Roommate matching |
| HotelsHome | `src/pages/HotelsHome.tsx` | Hotel listings |
| HotelDetail | `src/pages/HotelDetail.tsx` | Hotel detail |
| HotelBooking | `src/pages/HotelBooking.tsx` | Hotel booking flow |
| HotelReservation | `src/pages/HotelReservation.tsx` | Hotel reservation |
| CreateListing | `src/pages/CreateListing.tsx` | Admin/staff listing creation |
| WorkerSetup | `src/pages/WorkerSetup.tsx` | Worker profile setup |
| WorkerVerification | `src/pages/WorkerVerification.tsx` | Worker verification flow |
| WorkerDiscovery | `src/pages/WorkerDiscovery.tsx` | Worker search/browse |
| WorkerCategories | `src/pages/WorkerCategories.tsx` | Worker category browser |
| ProfileEdit | `src/pages/ProfileEdit.tsx` | Profile editing |
| AccountCenter | `src/pages/AccountCenter.tsx` | Account settings hub |
| PrivacySettings | `src/pages/PrivacySettings.tsx` | Privacy controls |
| SecuritySettings | `src/pages/SecuritySettings.tsx` | Password/security |
| MyBookings | `src/pages/MyBookings.tsx` | User bookings |
| MyReservations | `src/pages/MyReservations.tsx` | Hotel reservations |
| JobsPage | `src/pages/JobsPage.tsx` | Worker jobs |
| CalendarPage | `src/pages/CalendarPage.tsx` | Worker calendar |
| AnalyticsPage | `src/pages/AnalyticsPage.tsx` | Analytics dashboard |
| ManagementPage | `src/pages/ManagementPage.tsx` | Management view |
| Activity | `src/pages/Activity.tsx` | Activity feed |
| WalletPage | `src/pages/WalletPage.tsx` | Unified wallet |
| WorkerWallet | `src/pages/WorkerWallet.tsx` | Worker wallet |
| UserWalletPage | `src/pages/UserWalletPage.tsx` | User wallet |
| PrivacyPolicyPage | `src/pages/PrivacyPolicyPage.tsx` | Public: Privacy policy |
| TermsPage | `src/pages/TermsPage.tsx` | Public: Terms of service |

### C4. Duplicate Dashboard Rendering

**CRITICAL FINDING:** `case 'management'` renders different dashboards based on role (App.tsx:604):
```tsx
case 'management':
  return isCreatorRole ? <CreatorDashboard ... />
    : isAdminRole ? <AdminDashboard ... />
    : <StaffDashboard ... />;
```
This means all 3 dashboard components share the `management` route.

---

## D. NAVIGATION MAP

### D1. Mobile Bottom Navigation (5 tabs per role)

| Role | Tab 1 | Tab 2 | Tab 3 | Tab 4 | Tab 5 |
|------|-------|-------|-------|-------|-------|
| **Creator** | Home | Management | Messages | Analytics | Account |
| **Admin** | Home | Management | Messages | Analytics | Account |
| **Staff** | Home | Management | Messages | Analytics | Account |
| **Worker** | Home | Jobs | Calendar | Messages | Account |
| **Partner** | Home | Dashboard | Messages | Wallet | Account |
| **User** | Home | Explore | Saved | Messages | Account |

**Source:** `src/App.tsx:156-215`

### D2. Desktop Sidebar Navigation

| Role | Items | Source |
|------|-------|--------|
| **Creator** | Home, Dashboard, Management, Analytics, Messages, Account | `desktop-nav.tsx:34` |
| **Admin** | Home, Dashboard, Management, Analytics, Messages, Account | `desktop-nav.tsx:46` |
| **Staff** | Home, Staff Hub, Management, Messages, Account | `desktop-nav.tsx:57` |
| **Worker** | Home, Dashboard, Jobs, Calendar, Messages, Account | `desktop-nav.tsx:68` |
| **Partner** | Home, Properties, Messages, Wallet, Account | `desktop-nav.tsx:80` |
| **User** | Home, Explore, Search, Saved, Messages, Account | `desktop-nav.tsx:91` |

**Source:** `src/lib/desktop-nav.tsx`

### D3. Navigation Issues Found

1. **MISMATCH:** Property Partner mobile nav has "Dashboard" (→ property_partner) but sidebar has "Properties" (→ property_partner) — same target, different labels
2. **DUPLICATE:** Creator/Admin/Staff share identical mobile nav arrays (lines 159-185) — defined 3 times instead of once
3. **HIDDEN PAGES:** `hideBottomNavPages` array (App.tsx:618) controls when bottom nav disappears — 15 pages listed
4. **NO ROLE VALIDATION on desktop nav:** DesktopLayout shows nav items without checking if the role can access them — relies on the user not clicking restricted items

---

## E. SETTINGS PERSISTENCE MAP

### E1. Settings Architecture

```
CreatorSettingsTab.tsx
→ SETTING_GROUPS (hardcoded array of 7 categories)
→ Each setting has: key, label, description, type, defaultValue
→ Save: direct upsert to platform_settings table (all fields)
→ Load: usePlatformSettings hook → get_all_settings_v2 RPC
→ Cache: In-memory singleton (cachedSettings)
```

### E2. Settings Database

| Table | Columns | Purpose |
|-------|---------|---------|
| `platform_settings` | id, key, value, label, description, category, data_type, is_active, updated_at | Primary settings store |
| `system_settings` | similar | Fallback/legacy settings store |

### E3. Settings Categories

1. **Company** — name, logo, support contacts, address
2. **Apartment** — commission %, reservation fee, rent plans, grace period
3. **Hotel** — reservation toggle, reservation fee, commission %
4. **Worker** — verification fee, categories, badges
5. **Withdrawals** — min amount, processing time
6. **Notifications** — email templates, SMS toggle
7. **Legal** — terms, privacy policy content

### E4. Settings Flow

```
Creator changes value
→ onSave() collects all settings in the group
→ direct supabase.from('platform_settings').upsert() with ALL columns
→ if success → toast.success + invalidateSettingsCache()
→ usePlatformSettings hook reloads via get_all_settings_v2 RPC
```

### E5. Why Settings May Not Persist

1. **RPC vs Direct:** Previously used `set_setting_v2` RPC which only inserted key/value, but `category` column is NOT NULL → silent failure. Now uses direct upsert with all columns.
2. **RLS Policies:** Platform settings has `FOR ALL USING (true)` — open access, but RPC functions may have different permission contexts.
3. **Cache Staleness:** `cachedSettings` is a module-level singleton — survives component remounts but not page reloads.

---

## F. DATABASE INVENTORY

### F1. Core Tables

| Table | Purpose | Status |
|-------|---------|--------|
| `profiles` | User accounts, roles, locations | **ACTIVE** |
| `listings` | Property listings (apartments, houses) | **ACTIVE** |
| `reservations` | Booking reservations | **ACTIVE** |
| `conversations` | Chat conversations | **ACTIVE** |
| `messages` | Chat messages | **ACTIVE** |
| `saved_listings` | User saved properties | **ACTIVE** |
| `reviews` | Property reviews | **ACTIVE** |
| `notifications` | User notifications | **ACTIVE** |
| `wallet_transactions` | Wallet transaction log | **ACTIVE** |
| `bank_accounts` | User bank accounts | **ACTIVE** |
| `withdrawals` | Withdrawal requests | **ACTIVE** |
| `property_types` | Property type definitions | **ACTIVE** |
| `service_categories` | Worker service categories | **ACTIVE** |
| `service_subcategories` | Worker subcategories | **ACTIVE** |
| `staff_permissions` | Staff module permissions | **ACTIVE** |
| `announcements` | Platform announcements | **ACTIVE** |
| `announcement_recipients` | Announcement delivery tracking | **ACTIVE** |
| `inspection_requests` | Property inspection requests | **ACTIVE** |
| `support_conversations` | Support chat | **ACTIVE** |
| `support_messages` | Support messages | **ACTIVE** |
| `hotels` | Hotel listings | **ACTIVE** |
| `hotel_rooms` | Hotel room types | **ACTIVE** |
| `hotel_bookings` | Hotel bookings | **ACTIVE** |
| `workers` | Worker profiles | **ACTIVE** |
| `worker_verifications` | Worker verification submissions | **ACTIVE** |
| `worker_bookings` | Worker job bookings | **ACTIVE** |
| `worker_skills` | Worker skills/pricing | **ACTIVE** |
| `property_partners` | Property partner records | **ACTIVE** |
| `platform_settings` | Creator-managed settings | **ACTIVE** |
| `user_sessions` | Session tracking | **ACTIVE** |
| `audit_logs` | Audit trail | **ACTIVE** |
| `reports` | User reports | **ACTIVE** |

### F2. Key Column Mappings

| Concept | Column(s) | Notes |
|---------|-----------|-------|
| User ID (WHU-XXXXX) | `profiles.user_id` | Custom format, NOT Supabase UUID |
| Auth ID (Supabase UUID) | `profiles.auth_id` | Links to supabase.auth.users |
| Property owner | `listings.owner_id` | Stores auth_id (UUID) |
| Property partner | `listings.partner_id` | Links to profiles.user_id |
| Staff module | `staff_permissions.module` | operations/finance/support/verification/field_officer |

### F3. RLS Status

| Table | RLS | Policy Pattern |
|-------|-----|---------------|
| `profiles` | ✅ Enabled | Complex — auth-based with role checks |
| `listings` | ✅ Enabled | Public read, restricted write |
| `conversations` | ✅ Enabled | Participant-only access |
| `messages` | ✅ Enabled | Participant-only access |
| `platform_settings` | ✅ Enabled | `FOR ALL USING (true)` — open read |
| `wallet_transactions` | ✅ Enabled | User-only access |
| `inspection_requests` | ✅ Enabled | Owner + staff access |
| `announcements` | ✅ Enabled | Creator/admin write, all read |

---

## G. PROPERTY SYSTEM MAP

### G1. Property Types (from `property_types` table)

| Type | Sub Types | Managed By |
|------|-----------|------------|
| house | — | Creator (active/visible toggle) |
| apartment | short_let, long_stay | Creator |
| hotel | — | Creator |

**Note:** Workers and Roommates are NOT property types — they are separate systems.

### G2. Property Flow (Constitution)

```
Property Partner
→ Submits inspection request (property name, address, city, state, type, description, documents, photos)
→ WeHouse assigns Field Officer
→ Field Officer inspects → creates DRAFT listing (bedrooms, bathrooms, rent, amenities)
→ Draft belongs to partner but NOT public
→ Operations/Admin/Creator approves
→ Goes public on platform
```

### G3. Tables Used in Property Flow

| Step | Table | Key Columns |
|------|-------|-------------|
| Partner submits | `inspection_requests` | owner_id, property_address, property_type, document_urls, photo_urls |
| Field Officer drafts | `listings` | status='draft', partner_id, bedrooms, bathrooms, price |
| Approval | `listings` | status → 'approved', availability_status → 'available' |
| Public view | `listings` | Public query with is('deleted_at', null) |

---

## H. WORKER SYSTEM MAP

### H1. Worker Flow

```
User selects "Offer Service" during registration
→ Worker registration (role='worker')
→ WorkerSetup page (profile completion)
→ WorkerDashboard
→ Can submit verification:
  → Select service category/subcategory
  → Upload government ID
  → Upload skill demonstration video
  → Pay verification fee (via Paystack)
  → Golden Tick (after payment)
  → Manual submit for review
  → Under Review status
  → Admin/Creator approves/rejects
  → Public discovery (WorkerDiscovery)
```

### H2. Worker Tables

| Table | Purpose |
|-------|---------|
| `workers` | Extended worker profile data |
| `worker_verifications` | Verification submission records |
| `service_categories` | Available service categories |
| `service_subcategories` | Subcategories per category |
| `worker_skills` | Worker skills and pricing |
| `worker_bookings` | Job bookings |

---

## I. PAYMENT AND WALLET MAP

### I1. Payment Status

**CRITICAL FINDING:** Paystack is NOT fully integrated. The codebase has:
- Paystack utility file (`src/lib/paystack-marketplace.ts`) — config loader, no live payments
- Worker verification references Paystack (`worker-bookings.ts`) — RPC expects paystack params
- Hotel booking shows "Paystack payment coming soon" toast
- Blue Badge subscription shows "available once Paystack is connected"

### I2. Wallet Architecture

| Component | File | Purpose |
|-----------|------|---------|
| WalletPage | `src/pages/WalletPage.tsx` | Unified wallet (Overview/Earn/Withdraw/Bank/Tx) |
| WorkerWallet | `src/pages/WorkerWallet.tsx` | Worker-specific wallet |
| UserWalletPage | `src/pages/UserWalletPage.tsx` | Legacy user wallet |

### I3. Wallet Flow

```
Reservation confirmed
→ wallet_transactions inserted (type='earning')
→ profile.total_earnings updated
→ profile.wallet_balance updated
→ Partner/Worker can withdraw
→ request_withdrawal RPC
→ withdrawal record created (status='pending')
→ Admin approves → bank transfer
```

---

## J. MESSAGING AND NOTIFICATIONS MAP

### J1. Chat Systems

| System | Participants | Table | File |
|--------|-------------|-------|------|
| **User↔User/Worker** | Any authenticated users | `conversations` + `messages` | `Chat.tsx` |
| **Partner↔WeHouse** | Partner + WeHouse support | `support_conversations` + `support_messages` | `PartnerSupportChat.tsx` |
| **Official Channel** | Creator/Admin → All users | `announcements` + `announcement_recipients` | `OfficialChannel.tsx` |

### J2. Key Finding: NO Customer↔Property Partner Chat

The PartnerSupportChat component only creates conversations between the partner and a system "WeHouse" user. There is NO direct customer-to-partner chat in the codebase.

### J3. Announcement System

```
Creator/Admin creates announcement
→ Insert into announcements table
→ Recipients determined by scope (global/local/role-specific)
→ Insert into announcement_recipients
→ Users see unread announcements
→ Read status tracked in announcement_recipients
```

---

## K. SECURITY FINDINGS (Report Only)

| Finding | Severity | File | Details |
|---------|----------|------|---------|
| **Supabase Anon Key in .env** | Medium | `.env` | Key committed to repo (though anon key is safe by design) |
| **RLS uses `FOR ALL USING (true)`** | Medium | Multiple | `platform_settings`, some tables allow any authenticated user full access |
| **No input sanitization on search** | Low | `Search.tsx` | User input passed directly to Supabase queries |
| **Paystack secret not in env** | N/A | — | No Paystack secret found (integration incomplete) |
| **Creator auth modal** | Good | `CreatorAuthModal.tsx` | Critical actions require password re-authentication |
| **Admin auth modal** | Good | `AdminAuthModal.tsx` | Similar protection for admin actions |
| **Role transition validation** | Good | `useAuth.ts:89` | Strict rules for who can change what role |
| **Session tracking** | Good | `user_sessions` | Active session monitoring with heartbeat |

---

## L. FRONTEND STABILITY FINDINGS

| Issue | Severity | File | Cause |
|-------|----------|------|-------|
| **Page state not URL-based** | High | `App.tsx` | Refresh can lose context if page not in RESTORABLE_PAGES |
| **No 404 handling** | Medium | `App.tsx` | Unknown navPage defaults to Home silently |
| **RESTORABLE_PAGES missing entries** | Medium | `App.tsx:102` | Some valid pages not listed (e.g., newer pages) |
| **Error boundary exists** | Good | `ErrorBoundary.tsx` | Catches render errors |
| **Loading spinner on auth** | Good | `App.tsx:413` | Prevents Login flash on refresh |
| **Capacitor status bar** | Good | `main.tsx` | Handles mobile status bar color |
| **Cache-busting on logout** | Good | `useAuth.ts:367` | Hard reload with timestamp on logout |
| **useAuth hook 423 lines** | Medium | `useAuth.ts` | Very large hook — complex state management |
| **App.tsx 828 lines** | Medium | `App.tsx` | Central router + layout + nav — monolithic |

---

## M. DEPLOYMENT FINDINGS

| Item | Value |
|------|-------|
| **Platform** | Vercel |
| **Branch** | main |
| **Build Command** | `npm run build` (tsc + vite build) |
| **Output** | `dist/` directory |
| **Cache Control** | `no-cache, no-store, must-revalidate` (vercel.json) |
| **Supabase URL** | `https://rkrhnkhppeihvmuwvsvn.supabase.co` |
| **Repo** | `https://github.com/forttunes2-droid/Wehouse` |

**Why changes might not appear after deployment:**
1. Vercel edge caching (mitigated by cache-control headers in vercel.json)
2. Supabase RLS policy caching (may need logout/login to refresh)
3. Platform settings in-memory cache (`cachedSettings` singleton)
4. Browser service worker (unregistered on logout)

---

## N. LEGACY/DUPLICATE CODE LIST

| File | Status | Why |
|------|--------|-----|
| `src/pages/OperationsDashboard.tsx` | LEGACY | Redirects to StaffDashboard |
| `src/pages/FieldOfficerDashboard.tsx` | LEGACY | Redirects to StaffDashboard |
| `src/pages/WorkerVerificationDashboard.tsx` | UNUSED | Never rendered in App.tsx |
| `src/pages/UserWalletPage.tsx` | LEGACY | Replaced by WalletPage |
| `src/pages/WorkerWallet.tsx` | ACTIVE but overlapping | Separate from WalletPage |
| `src/components/AppShell.tsx` | UNUSED | Replaced by DesktopLayout |
| `src/components/BlueBadgeSubscribe.tsx` | STUB | "coming once Paystack connected" |
| `src/lib/paystack-marketplace.ts` | STUB | Config loader, no live payments |
| `src/components/LocationSelector.tsx` | LEGACY | Replaced by StateLgaDropdown |

---

## O. OUTDATED DOCUMENTATION LIST

| File | Status | Notes |
|------|--------|-------|
| `README.md` | **PARTIALLY OUTDATED** | General info, may not reflect current architecture |
| `WEHOUSE_MASTER_PLAN.md` | **OUTDATED** | Contains old rules that may conflict with current code |
| `WEHOUSE_AUDIT.md` | **OUTDATED** | Previous audit, superseded by this report |
| `FULL_AUDIT.md` | **OUTDATED** | Previous audit, superseded by this report |
| `WE_HOUSE_ARCHITECTURE_AUDIT_REPORT.md` | **PARTIALLY OUTDATED** | Architecture report, some sections still valid |
| `SECURITY.md` | **UNKNOWN** | Needs verification against current code |
| `info.md` | **UNKNOWN** | Purpose unclear |

---

## P. RECOMMENDED CONSOLIDATION ORDER (Stage 2)

| Priority | Action | Impact | Effort |
|----------|--------|--------|--------|
| **P1** | Remove `max-w-lg mx-auto` from ALL dashboards | Fixes desktop layout | Low |
| **P2** | Add `lg:px-8` padding to ALL dashboard headers/content | Desktop spacing | Low |
| **P3** | Add responsive grid classes (`lg:grid-cols-*`) to ALL stat cards | Desktop grids | Low |
| **P4** | Unify duplicate mobile nav definitions (Creator/Admin/Staff identical) | DRY | Low |
| **P5** | Consolidate Wallet pages (WalletPage, WorkerWallet, UserWalletPage) | Architecture | Medium |
| **P6** | Remove LEGACY dashboard files (Operations, FieldOfficer, WorkerVerificationDashboard) | Cleanup | Low |
| **P7** | Add missing pages to RESTORABLE_PAGES | Fix refresh | Low |
| **P8** | Remove unused components (AppShell, BlueBadgeSubscribe stub) | Cleanup | Low |
| **P9** | Implement Paystack integration | Critical feature | High |
| **P10** | Add responsive grids to remaining pages (Search, Explore, Chat) | Desktop support | Medium |
| **P11** | Consolidate Settings system (platform_settings vs system_settings) | Architecture | Medium |
| **P12** | Add StateLgaDropdown to all forms (Setup, ProfileEdit, CreateListing) | Feature | Medium |
| **P13** | Integrate MediaUpload into CreateListing and Inspection forms | Feature | High |
| **P14** | Update documentation to match current codebase | Documentation | Low |

---

## END OF STAGE 1 REPORT

**Prepared by:** Kimi (AI Agent)
**Date:** 2026-07-20
**Branch:** main
**Commit:** f683f22
**Build Status:** PASS
**Files Audited:** 49 pages, 24 components, 9 hooks, 12 supabase modules, 95 migrations, 7 docs
