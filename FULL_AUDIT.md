# WEHOUSE NIGERIA — FULL SYSTEM AUDIT
## Date: July 5, 2026
## Auditor: AI Assistant
## Status: COMPLETE

---

## TABLE OF CONTENTS
1. [Environment Variables](#1-environment-variables)
2. [Database Tables](#2-database-tables)
3. [Source Files Inventory](#3-source-files-inventory)
4. [Dead Code Removed](#4-dead-code-removed)
5. [Flows Audit](#5-flows-audit)
6. [Permission System](#6-permission-system)
7. [Issues Found & Fixed](#7-issues-found--fixed)
8. [A-Z Test List (Pre-Public)](#8-a-z-test-list-pre-public)

---

## 1. ENVIRONMENT VARIABLES

| Variable | Value | Purpose |
|----------|-------|---------|
| `VITE_SUPABASE_URL` | `https://rkrhnkhppeihvmuwvsvn.supabase.co` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | (hidden) | Client-side auth key |

**Risk**: `.env` is committed to git with the real anon key. The `.gitignore` should exclude `.env`.
**Fix needed**: Add `.env` to `.gitignore`, use `.env.example` as template.

---

## 2. DATABASE TABLES

### ACTIVE TABLES (in use)
| Table | Purpose | Status |
|-------|---------|--------|
| `profiles` | All user accounts | ACTIVE |
| `listings` | Property listings | ACTIVE |
| `conversations` | Chat threads | ACTIVE |
| `messages` | Chat messages | ACTIVE |
| `user_inspection_requests` | User + partner inspections | ACTIVE |
| `staff_permissions` | Staff permission assignments | ACTIVE |
| `announcements` | Creator/admin broadcasts | ACTIVE |
| `announcement_recipients` | Who received announcements | ACTIVE |
| `saved_listings` | User bookmarks | ACTIVE |
| `hotels` | Hotel listings | ACTIVE |
| `hotel_rooms` | Hotel room inventory | ACTIVE |
| `hotel_bookings` | Hotel reservations | ACTIVE |
| `reviews` | User reviews | ACTIVE |
| `admin_audit_log` | Admin action tracking | ACTIVE |
| `role_change_history` | Role change audit | ACTIVE |
| `listings_reports` | Listing abuse reports | ACTIVE |
| `service_categories` | Worker service categories | ACTIVE |
| `service_subcategories` | Worker service subcategories | ACTIVE |
| `support_tickets` | Customer support tickets | ACTIVE |
| `notifications` | User notifications | ACTIVE |
| `property_partners` | Property partner accounts | ACTIVE |
| `student_preferences` | Roommate matching prefs | ACTIVE |
| `saved_roommate_matches` | Persisted roommate matches | ACTIVE |

### DEAD/LEGACY TABLES (not queried by code)
| Table | Status | Notes |
|-------|--------|-------|
| `inspections` | DEAD | Original table, replaced by `user_inspection_requests` |
| `inspection_requests` | DEAD | Early partner table, superseded |
| `property_owners` | DEAD | Replaced by `property_partners` |
| `owner_properties` | DEAD | Replaced by partner system |
| `owner_contracts` | DEAD | Replaced by partner system |
| `reservations` | DEAD | Reservation system unused |
| `enquiries` | DEAD | Enquiry system replaced by chat |

### SYSTEM TABLES
| Table | Purpose |
|-------|---------|
| `admin_audit_log` | Audit trail |
| `user_sessions` | Session tracking |
| `user_activity` | Activity tracking |
| `system_settings` | Platform settings |

---

## 3. SOURCE FILES INVENTORY

### Pages (40 files)
| File | Purpose | Status |
|------|---------|--------|
| `Home.tsx` | Main landing page | ACTIVE |
| `Search.tsx` | Property search | ACTIVE |
| `ListingDetail.tsx` | Property detail view | ACTIVE |
| `Saved.tsx` | Bookmarked properties | ACTIVE |
| `Chat.tsx` | Unified chat system | ACTIVE |
| `Roommate.tsx` | Roommate matching | ACTIVE |
| `Login.tsx` | Auth/login page | ACTIVE |
| `Setup.tsx` | New user onboarding | ACTIVE |
| `WorkerSetup.tsx` | Worker verification form | ACTIVE |
| `WorkerDashboard.tsx` | Worker home dashboard | ACTIVE |
| `WorkerDiscovery.tsx` | Find/book workers | ACTIVE |
| `WorkerCategories.tsx` | Worker service categories | ACTIVE |
| `CreatorDashboard.tsx` | Creator admin panel | ACTIVE |
| `DirectorDashboard.tsx` | Admin panel (was "Director") | ACTIVE |
| `StaffDashboard.tsx` | **Unified staff dashboard** | ACTIVE |
| `PropertyOwnerDashboard.tsx` | Property partner dashboard | ACTIVE |
| `HotelsHome.tsx` | Hotel listings | ACTIVE |
| `HotelDetail.tsx` | Hotel detail | ACTIVE |
| `HotelBooking.tsx` | Hotel booking flow | ACTIVE |
| `Activity.tsx` | User activity feed | ACTIVE |
| `ProfileEdit.tsx` | Edit profile | ACTIVE |
| `AccountCenter.tsx` | Account settings | ACTIVE |
| `PrivacySettings.tsx` | Privacy controls | ACTIVE |
| `SecuritySettings.tsx` | Security settings | ACTIVE |
| `CreateListing.tsx` | Create new listing | ACTIVE |
| `SettingsTab.tsx` | Universal settings component | ACTIVE |
| `ServiceCategoriesTab.tsx` | Category CRUD | ACTIVE |
| `Dashboard.tsx` | OLD user dashboard | **DEAD** — replaced by Home+WorkerDashboard |
| `OperationsDashboard.tsx` | OLD standalone operations | **DEAD** — unified into StaffDashboard |
| `WorkerVerificationDashboard.tsx` | OLD standalone verification | **DEAD** — unified into StaffDashboard |
| `FinanceDashboard.tsx` | OLD standalone finance | **DEAD** — unified into StaffDashboard |
| `FieldOfficerDashboard.tsx` | OLD standalone field officer | **DEAD** — unified into StaffDashboard |

### Lib (23 files)
| File | Purpose | Status |
|------|---------|--------|
| `supabase/client.ts` | Supabase client init | ACTIVE |
| `supabase/index.ts` | Barrel exports | ACTIVE |
| `supabase/auth.ts` | Auth functions | ACTIVE |
| `supabase/profile.ts` | Profile CRUD | ACTIVE |
| `supabase/listings.ts` | Listing CRUD | ACTIVE |
| `supabase/chat.ts` | Chat functions | ACTIVE |
| `supabase/admin.ts` | Admin functions | ACTIVE |
| `supabase/workers.ts` | Worker functions | ACTIVE |
| `supabase/hotels.ts` | Hotel functions | ACTIVE |
| `supabase/announcements.ts` | Announcement functions | ACTIVE |
| `supabase/reservations.ts` | Inspection/field officer functions | ACTIVE |
| `supabase/roommate.ts` | Roommate matching | ACTIVE |
| `supabase/notifications.ts` | Notification system | ACTIVE |
| `supabase/permissions.ts` | Staff permission functions | ACTIVE |
| `supabase/session.ts` | Session management | ACTIVE |
| `supabase/activity.ts` | Activity logging | ACTIVE |
| `supabase/utils.ts` | DB utilities | ACTIVE |
| `utils.ts` | General utilities | ACTIVE |
| `native.ts` | Native app bridge | ACTIVE (minimal use) |
| `aiChat.ts` | AI chat features | ACTIVE (minimal use) |
| `imageHash.ts` | Image deduplication | ACTIVE (minimal use) |

### Hooks (5 files)
| File | Purpose | Status |
|------|---------|--------|
| `useAuth.ts` | Auth state + role checks | ACTIVE |
| `useCreatorAuth.tsx` | Creator auth modal | ACTIVE |
| `useStaffPermissions.ts` | Staff permission fetching | ACTIVE |
| `useConfirm.ts` | Confirmation dialogs | ACTIVE |
| `use-mobile.ts` | Mobile detection | ACTIVE |

---

## 4. DEAD CODE REMOVED

### In This Audit:
1. **Standalone dashboard routing** — `operations`, `finance`, `worker_verification`, `field_officer` pages now redirect to unified `StaffDashboard`
2. **Standalone dashboard imports** — Removed from `App.tsx` lazy imports
3. **`OfficerName` component** — Replaced with inline `officerMap` lookup in `CreatorDashboard`
4. **All `prompt()` calls** — Replaced with proper inline forms (3 occurrences)
5. **`inspections` table queries** — `FieldOfficerModule` now queries correct `user_inspection_requests` table

### Still Present (Legacy, Not Breaking):
- `Dashboard.tsx` — Old user dashboard page file exists but not routed
- `OperationsDashboard.tsx` — File exists, not imported
- `WorkerVerificationDashboard.tsx` — File exists, not imported
- `FinanceDashboard.tsx` — File exists, not imported
- `FieldOfficerDashboard.tsx` — File exists, not imported

---

## 5. FLOWS AUDIT

### A. Chat System
| Component | Status |
|-----------|--------|
| Conversations stored in `conversations` table | OK |
| Messages stored in `messages` table | OK |
| `wehouse_support` is participant_b for all support chats | OK |
| Partner sees "WeHouse Support" (not staff names) | OK |
| Staff sees partner's real name | OK |
| File upload supported | OK |
| Delete conversation with custom modal | OK |
| Back button routes by role (not hardcoded to home) | OK |

### B. Inspection System
| Component | Status |
|-----------|--------|
| Inspections stored in `user_inspection_requests` | OK |
| `assignFieldOfficer()` updates correct table | OK |
| `admin_get_field_officers()` returns only staff with `field_officer` permission | OK |
| Creator can assign/unassign field officers | OK |
| Field officer sees assigned inspections in StaffDashboard | **FIXED** (was querying wrong table) |
| Officer can start/complete with report form | **FIXED** (was using `prompt()`) |

### C. Worker Booking Flow
| Component | Status |
|-----------|--------|
| User clicks "Book" → describes work, adds address, date | OK |
| Booking request sent to worker | OK |
| Chat unlocks after booking request | OK |
| Worker sets price when approving | OK |
| Only `verified` workers visible in discovery | OK |
| Pending workers hidden from public | OK |
| Worker edit → status resets to `pending` | OK |

### D. Staff Permission System
| Component | Status |
|-----------|--------|
| One permission per staff (operations/finance/support/verification/field_officer) | OK |
| `staff_permissions` table with `is_active` flag | OK |
| Staff dashboard shows tabs based on permission | OK |
| Header shows permission name (e.g., "Field Officer") | **FIXED** |
| `useStaffPermissions` hook fetches from `staff_permissions` | OK |
| Unified StaffDashboard replaces all standalone dashboards | **FIXED** |

### E. Announcement System
| Component | Status |
|-----------|--------|
| Creator sends to selectable groups (Users/Workers/Staff/Partners) | OK |
| All toggles default to OFF | OK |
| Copy says "Send to selected groups" (not "Broadcast to all") | OK |
| Stored in `announcements` + `announcement_recipients` | OK |

### F. Reservation/Property Flow
| Component | Status |
|-----------|--------|
| Listings stored in `listings` table | OK |
| Status: available/reserved/closed/pending_approval/rejected | OK |
| Short let vs Long stay subtypes | OK |
| Security deposit (caution fee) for short let only | OK |
| Reservation fee: N5,000 for 72-hour hold | OK |
| Commission: 10% long stay, 20% short stay | OK |

---

## 6. PERMISSION SYSTEM

### Role Hierarchy
```
creator (5)     — Full platform control
  └ admin (3)   — Full admin access (creator assigns)
      └ staff (1) — Limited access (one permission)
          ├ operations        — Manage listings
          ├ finance           — Payouts, commissions
          ├ support           — Customer tickets
          ├ verification      — Approve workers
          └ field_officer     — Property inspections
  
user (0)        — Regular tenant/student
worker (0)      — Service provider
property_partner (0) — Property owner
```

### Permission Assignment
- Creator assigns ONE permission per staff via `staff_permissions` table
- Staff sees only their assigned module tab(s) on StaffDashboard
- `hasPermission()` checks `staff_permissions` table

---

## 7. ISSUES FOUND & FIXED

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | FieldOfficerModule queried dead `inspections` table | **CRITICAL** | FIXED |
| 2 | Staff header showed generic "Staff Dashboard" | HIGH | FIXED — now shows permission name |
| 3 | Old standalone dashboards still imported/routed | HIGH | FIXED — redirected to StaffDashboard |
| 4 | `prompt()` used for reject/resolve/complete (3 places) | MEDIUM | FIXED — inline forms |
| 5 | `OfficerName` component did client-side fetches (RLS risk) | MEDIUM | FIXED — batch fetch in `load()` |
| 6 | Worker edit via SettingsTab didn't reset status | HIGH | FIXED |
| 7 | Admin dashboard filtered by admin's state (Nasarawa) | HIGH | FIXED — nationwide view |
| 8 | Chat back button hardcoded to 'home' | HIGH | FIXED — routes by role |
| 9 | `.env` file committed with real keys | HIGH | NOTED — add to .gitignore |

---

## 8. A-Z TEST LIST (PRE-PUBLIC)

### A — Account & Auth
- [ ] New user can sign up with email
- [ ] User can log in
- [ ] User can reset password
- [ ] User can change password in Settings
- [ ] User can edit profile (name, phone, bio, avatar)
- [ ] User can delete their account
- [ ] Session persists after page refresh
- [ ] Auto-logout on token expiry

### B — Booking (Worker)
- [ ] User can browse verified workers only
- [ ] Pending workers are NOT visible
- [ ] User clicks "Book" → fills description, address, date
- [ ] Booking request created in database
- [ ] Chat button appears after booking request
- [ ] Worker receives booking request notification
- [ ] Worker sets agreed price when approving
- [ ] User pays via Paystack
- [ ] Payment held in escrow
- [ ] Worker completes job → user approves → funds released

### C — Chat
- [ ] Users can message listing owners
- [ ] Partners can message WeHouse Support
- [ ] Workers can message WeHouse Support
- [ ] Staff can message workers (verification)
- [ ] File upload works in chat
- [ ] Messages marked as read/unread
- [ ] Delete conversation works with modal (not browser confirm)
- [ ] Back button returns to correct dashboard by role

### D — Dashboard (Creator)
- [ ] Creator sees all users nationwide
- [ ] Creator can filter users by role
- [ ] Creator can assign staff permissions
- [ ] Creator can send announcements to selected groups
- [ ] Creator can assign field officers to inspections
- [ ] Creator can unassign field officers
- [ ] Creator sees worker applications
- [ ] Creator can approve/suspend/reject workers
- [ ] Creator sees inspection requests (user + partner)
- [ ] Creator sees support inbox

### E — Dashboard (Staff)
- [ ] Staff header shows their permission name (not generic "Staff")
- [ ] Staff sees only their assigned module tab
- [ ] Operations: can approve/reject listings with inline form
- [ ] Finance: sees payouts and commissions
- [ ] Support: sees tickets, can assign/resolve with inline form
- [ ] Verification: sees pending workers, can approve/reject
- [ ] Field Officer: sees assigned inspections, can start/complete with report form
- [ ] Settings tab available to all staff
- [ ] Tab persistence after navigating away and back

### F — Field Officer
- [ ] Only staff with `field_officer` permission see inspections
- [ ] Assigned inspections appear in StaffDashboard
- [ ] Can start inspection (status → in_progress)
- [ ] Can complete with report + condition rating
- [ ] Creator sees completed inspection reports

### G — General
- [ ] Website loads without console errors
- [ ] PWA install prompt appears
- [ ] Service worker auto-updates on new deploy
- [ ] Works on mobile (responsive)
- [ ] Works offline (cached pages)

### H — Hotels
- [ ] Hotels display with filters
- [ ] Hotel detail shows rooms, amenities
- [ ] Booking flow: select dates → guest count → pay
- [ ] Booking confirmation received

### I — Inspections
- [ ] User can request property inspection
- [ ] Partner can request property inspection
- [ ] Creator sees all inspection requests
- [ ] Creator can assign field officer
- [ ] Creator can unassign field officer
- [ ] Field officer sees assigned inspections
- [ ] Officer name + phone displayed correctly (not "Unknown")

### L — Listings
- [ ] Create listing with all fields
- [ ] Upload images
- [ ] Set price, location, amenities
- [ ] Submit for approval (status: pending_approval)
- [ ] Admin/Creator approves → status: available
- [ ] Search by state, city, price range
- [ ] Filter by bedrooms, property type
- [ ] Save/unsave listings

### N — Notifications
- [ ] New inspection request → notification
- [ ] New message → notification
- [ ] Booking request → notification
- [ ] Worker approved → notification
- [ ] Bell icon shows unread count
- [ ] Clicking notification marks as read

### P — Partners
- [ ] Partner can register/login
- [ ] Partner dashboard shows their listings
- [ ] Partner can chat with WeHouse Support
- [ ] Partner can request property inspection
- [ ] Partner settings tab works

### R — Roommate
- [ ] Set preferences (gender, budget, habits)
- [ ] Search for compatible roommates
- [ ] Send/accept/decline match requests
- [ ] View roommate profiles

### S — Security
- [ ] Worker role cannot be changed
- [ ] Partner role cannot be changed
- [ ] Creator role cannot be changed
- [ ] Admin can only change user ↔ staff
- [ ] `wehouse_support` excluded from user lists
- [ ] RLS policies prevent unauthorized access
- [ ] `.env` with keys NOT in git

### W — Workers
- [ ] Worker can complete verification form
- [ ] Upload ID card and video
- [ ] Select occupation and skills
- [ ] Set price
- [ ] Submit → status: pending
- [ ] Creator approves → status: verified
- [ ] Worker appears in discovery
- [ ] Worker edits profile → status: pending (re-approval)
- [ ] Worker hidden from discovery while pending

---

## SQL NEEDED BEFORE PUBLIC

Run this in Supabase SQL Editor:

```sql
-- 1. Fix field officer function (only staff with field_officer permission)
DROP FUNCTION IF EXISTS public.admin_get_field_officers();
CREATE OR REPLACE FUNCTION public.admin_get_field_officers()
RETURNS TABLE(user_id TEXT, username TEXT, full_name TEXT, phone TEXT)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT p.user_id, p.username, p.full_name, p.phone 
  FROM public.profiles p
  INNER JOIN public.staff_permissions sp ON sp.staff_id = p.user_id
  WHERE p.role = 'staff'
    AND sp.permission = 'field_officer'
    AND sp.is_active = true
    AND p.user_id != 'wehouse_support'
    AND p.deleted = false
  ORDER BY p.username;
$$;

-- 2. Ensure staff_permissions RLS allows creator to manage
-- (already set up in migrations, verify it works)
```

---

## END OF AUDIT
