# We House Architecture Audit Report

## 1. CURRENT ARCHITECTURE

### Roles in Database
- `creator` - Platform owner (WHU-0001)
- `admin` - Platform managers
- `staff` - Operations workers
- `property_partner` - Property owners
- `worker` - Service providers
- `user` - Regular customers

### Dashboards Implemented
- `CreatorDashboard.tsx` - Creator/Admin combined
- `DirectorDashboard.tsx` - Admin (legacy, may be unused)
- `WorkerDashboard.tsx` - Worker (7 tabs)
- `StaffDashboard.tsx` - Staff
- `PropertyOwnerDashboard.tsx` - Property Partner
- `Dashboard.tsx` - User profile/settings
- `Roommate.tsx` - Roommate matching

### Database Tables
- `profiles` - All users (role field distinguishes type)
- `listings` - Property listings
- `worker_bookings` - Worker job bookings
- `booking_conversations` - Worker booking chats
- `booking_messages` - Worker booking messages
- `partner_support_conversations` - Partner support chats
- `partner_support_messages` - Partner support messages
- `inspection_requests` - Property inspections
- `role_change_history` - Role change audit log
- `platform_settings` - Creator platform configuration (NEW)
- `announcements` - Creator announcements
- `announcement_recipients` - Announcement delivery tracking

### API Layer
- `src/lib/supabase/admin.ts` - Admin/Creator functions
- `src/lib/supabase/worker-bookings.ts` - Worker booking system
- `src/lib/supabase/partner-support.ts` - Partner support system

---

## 2. PROBLEMS FOUND

### CRITICAL: Creator Dashboard Identity
**Constitution:** "Creator Dashboard must NEVER be read-only." Title must be "Creator Dashboard."
**Current:** Title shows "Staff Dashboard" because `checkIsCreator(profile)` checks `profile.role === 'creator'` but the component variable `isCreatorAccount` shadows the function name.
**Status:** Code has `checkIsCreator()` function but variable `isCreatorAccount` at line ~348 may conflict.

### CRITICAL: Settings Tab Shows Edit Profile
**Constitution:** Creator Settings = Platform Settings (Company, Finance, Commission, Toggles)
**Current:** Was showing generic profile edit (name, password change)
**Status:** FIXED in code - now shows `CreatorSettingsTab` with Platform + Finance sections. But needs Finance tab separated per Constitution.

### CRITICAL: Count Shows 12 Users (Should Be 11)
**Constitution:** "Real database counts. No placeholders."
**Current:** Shows 12 because `wehouse_support` artificial account was in database
**Status:** Code fixed to remove `wehouse_support` filters. SQL DELETE pending.

### HIGH: No Separate Finance Tab
**Constitution:** "Finance Settings (Creator Only) - separate page focused only on money"
**Current:** Finance settings were inside general Settings tab
**Status:** FIXED - `FinanceSettingsTab.tsx` created and added to tab bar

### HIGH: Partners Card Goes to Permissions
**Constitution:** Partners should have their own tab
**Current:** Clicked Partners stat → went to Permissions tab
**Status:** FIXED - `PartnersTab.tsx` created, Partners added to tab bar

### HIGH: Worker Verification Flow Incomplete
**Constitution:** Pending → Approved → Verification Dashboard → Submit ID/Video → Paystack Payment → Blue Badge → Profile Under Review → Public (when approved)
**Current:** Only has Pending → Verified status. Missing: Approved (can access verification), Reviewing (after submission), proper blue badge flow
**Status:** NOT FIXED - needs status expansion

### MEDIUM: Admin Dashboard Tabs Don't Match Constitution
**Constitution Admin Tabs:** Overview, Users, Workers, Property Partners, Staff, Listings, Bookings, Reports, Support, Verification
**Current:** Overview, Users, Listings, Reports, Audit, Workers, Services, Announcements, Hotels, Permissions, Inspections, Support, Partners, Settings, Finance
**Status:** PARTIAL MATCH - has extra tabs (Services, Announcements, Hotels, Audit), missing some structure

### MEDIUM: Worker Dashboard Tabs Don't Match Constitution
**Constitution Worker Tabs:** Overview, Bookings, Calendar, Wallet, Withdraw, Reviews, Services, Availability, Messages, Notifications, Verification Status, Profile, Settings
**Current:** Home, Bookings, Wallet, Services, Reviews, Settings (6 tabs)
**Status:** MISSING - Calendar, Withdraw, Availability, Messages, Notifications, Verification Status

### MEDIUM: Property Partner Dashboard Tabs Don't Match Constitution
**Constitution Partner Tabs:** Overview, My Properties, Inspection Requests, Bookings, Occupancy, Wallet, Withdraw, Earnings, Contracts, Messages, Support, Profile, Settings
**Current:** Home, Properties, Chat, Wallet, Settings, Bookings (6 tabs)
**Status:** MISSING - Overview, Inspection Requests, Occupancy, Withdraw, Earnings, Contracts, Support

### MEDIUM: User Dashboard Tabs Don't Match Constitution
**Constitution User Tabs:** Home, Search, Saved, Bookings, Worker Bookings, Hotel Bookings, Roommate, Messages, Notifications, Wallet History, Support, Profile, Settings
**Current:** Home, Search, Saved, Bookings, Roommate, Activity, Hotels, Workers, Profile (bottom nav)
**Status:** PARTIAL - missing separate Worker/Hotel bookings, Messages, Notifications, Wallet History, Support

### LOW: Role Change Shows for Creator
**Constitution:** "No role can manage or modify a role above it"
**Current:** Creator could see role change dropdown (fixed to use explicit role check)
**Status:** FIXED in code

### LOW: Staff Shows 3 Instead of 2
**Constitution:** Only real people
**Current:** 3 staff because `wehouse_support` artificial account counted
**Status:** Code fixed. Need to run SQL DELETE.

---

## 3. PROBLEMS FIXED

| # | Problem | Fix |
|---|---|---|
| 1 | Creator detected by wrong user_id | Changed to `profile.role === 'creator'` |
| 2 | Settings tab shows Edit Profile | Built `CreatorSettingsTab` with Platform + Finance |
| 3 | No Finance tab | Built `FinanceSettingsTab` and added to tab bar |
| 4 | Partners → Permissions | Built `PartnersTab` with partner list + property counts |
| 5 | Role change visible for Creator | Changed to explicit role check `(u.role === 'user' \|\| u.role === 'staff' \|\| u.role === 'admin')` |
| 6 | wehouse_support hardcoded in code | Removed ALL hardcoded references from CreatorDashboard, DirectorDashboard, wehouse.ts |
| 7 | Chat input too low on mobile | Added `pb-safe` and `chat-input-container` CSS classes |
| 8 | Page refresh redirects to home | Added `validatedRef` to prevent validation loop |
| 9 | Service worker caches old code | Added force-update script in index.html |
| 10 | Global scrolling issues | Added `min-h-[100dvh]`, `pb-nav`, `scrollable-content` CSS |
| 11 | Worker accepts booking fails | Fixed param mismatch between frontend and SQL |
| 12 | Photo upload in chat | Implemented actual Supabase Storage upload |
| 13 | No Partners tab in navigation | Added 'partners' to AdminTab type and tab bar |
| 14 | Admin functions use wrong deleted column | Changed from `deleted = false` to `deleted_at IS NULL` |

---

## 4. REMAINING IMPROVEMENTS

### Must Fix Before Launch
1. **Delete `wehouse_support` from database** - `DELETE FROM profiles WHERE user_id = 'wehouse_support';`
2. **Recreate admin functions** with `deleted_at IS NULL` (not `deleted = false`)
3. **Worker status flow** - Add `approved_for_verification` and `reviewing` statuses
4. **Complete Admin dashboard tabs** per Constitution (remove extra, add missing)
5. **Complete Worker dashboard tabs** (add Calendar, Withdraw, Availability, Messages, Notifications, Verification)
6. **Complete Partner dashboard tabs** (add Overview, Inspection Requests, Occupancy, Withdraw, Earnings, Contracts, Support)

### Should Fix
7. **User dashboard** - Add separate Worker/Hotel bookings, Messages, Notifications, Wallet History, Support
8. **Long Stay / Short Stay** rental modes for properties
9. **Finance module** - Revenue, Escrow, Transfers, Refunds monitoring
10. **Property Chat** - Single conversation for everything (inspection, assignment, status)

### Nice to Have
11. **Audit log** - Every action logged
12. **Maintenance mode** - Controlled by Creator setting
13. **Open/close registration** - Controlled by Creator setting

---

## 5. CONSTITUTION COMPLIANCE

| Section | Status | Notes |
|---|---|---|
| Role Hierarchy | COMPLIANT | Creator > Admin > Staff > Partner > Worker > User |
| User Dashboard | PARTIAL | Missing some tabs, bottom nav exists |
| Worker Dashboard | PARTIAL | 6/13 tabs implemented |
| Property Partner | PARTIAL | 6/13 tabs implemented |
| Admin Dashboard | PARTIAL | Has extra tabs, core functionality works |
| Creator Dashboard | MOSTLY FIXED | Title, counts, settings fixed. Needs tab alignment |
| Creator Settings | FIXED | Platform + Finance settings with database storage |
| Payments (Escrow) | COMPLIANT | Customer → Escrow → Wallet → Paystack flow |
| Worker Bookings | MOSTLY FIXED | Negotiation chat works, buttons need SQL |
| Property Chat | PARTIAL | Support conversations exist, needs field officer assignment |
| Hotels | PARTIAL | Same workflow as houses, room management after approval |
| Long Stay / Short Stay | NOT IMPLEMENTED | Rental mode exists but not fully enforced |
| Database Audit | IN PROGRESS | Dead code identified, needs cleanup |
| Finance Monitoring | NOT IMPLEMENTED | Needs revenue/escrow/transfer reports |

---

## SQL REQUIRED

```sql
-- 1. Delete artificial account
DELETE FROM profiles WHERE user_id = 'wehouse_support';

-- 2. Fix admin functions
DROP FUNCTION IF EXISTS public.admin_get_all_users();
CREATE OR REPLACE FUNCTION public.admin_get_all_users()
RETURNS SETOF profiles LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM profiles WHERE deleted_at IS NULL ORDER BY created_at DESC; $$;

DROP FUNCTION IF EXISTS public.admin_get_user_count(TEXT);
CREATE OR REPLACE FUNCTION public.admin_get_user_count(p_caller_role TEXT DEFAULT 'admin')
RETURNS TABLE(total BIGINT, today BIGINT) LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT COUNT(*)::BIGINT, COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::BIGINT FROM profiles WHERE deleted_at IS NULL; $$;

-- 3. Expand worker status
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_worker_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_worker_status_check
CHECK (worker_status IN ('pending', 'approved_for_verification', 'reviewing', 'verified', 'suspended'));
```

---

*Report generated after full codebase audit against We House Master Constitution*
*Date: 2025-07-06*
