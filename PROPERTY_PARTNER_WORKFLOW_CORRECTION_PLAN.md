# Property Partner Workflow — Correction Plan

**Repository:** WeHouse React + Vite + TypeScript SPA with Supabase backend  
**Branch:** `main`  
**Base Commit:** `7621b72c961e6d9b6213430ba0692efd6dba0050` (contains `PROPERTY_PARTNER_WORKFLOW_DISCOVERY.md`)  
**Plan Date:** 2026-08-09  
**Scope:** PLANNING ONLY — No code changes, no SQL execution, no migrations applied.

---

## 1. Executive Summary

The Property Partner workflow is **architecturally present but functionally incomplete**. The signup path works, the dashboard renders, and the `inspection_requests` table already provides the correct foundation for partner-to-WeHouse property submission. However, **five critical gaps** block the workflow:

1. **No partner-facing property submission form.** Partners are told to "Request an inspection" but have no UI to actually create an `inspection_requests` row.
2. **`CreateListing.tsx` assigns `owner_id: profile.auth_id` instead of `profile.user_id`.** This is a data-integrity bug that breaks partner→listing linkage.
3. **`listings` has dual owner columns (`partner_id` + `owner_id`) referencing the same `profiles.user_id`.** This creates query fragility and confusion.
4. **No commission attribution to property partners.** The `commission-v2.ts` system only calculates `workerShare` + `whouseShare`; partners are a third revenue party that is ignored.
5. **Partner earnings are not wired to the wallet system.** The wallet UI exists but `wallet_transactions` has no `partner_commission` transaction type, and the withdrawal RPC is `request_worker_withdrawal`.

The correction plan below identifies exactly what to keep, what to fix, what to drop, and what to build — all within the existing `listings` + `reservations` + `inspection_requests` architecture.

---

## 2. What Currently Exists and Can Be Kept

### 2.1 Signup & Profile (Keep As-Is)

| Component | File | Status |
|-----------|------|--------|
| Signup role selector | `src/pages/Login.tsx` | `property_partner` already present |
| Profile creation RPC | `create_my_profile` | Already handles role |
| `property_partners` table | `20250707_property_partners_table.sql` | Keep for metadata (`partner_code`, `status`) |
| Signup trigger | `normalize_partner_self_insert_trigger` | Validates role correctly |
| Setup page | `src/pages/Setup.tsx` | Works for partners |

### 2.2 Live Schema (Keep As-Is)

| Table | Why It Is Kept |
|-------|---------------|
| `profiles` | `role = 'property_partner'` is the canonical identity |
| `listings` | Core live schema. Has `owner_id`, `submitted_by_role`, `status` (`pending_approval`/`available`/`rejected`), `approved_by`, `approved_at` — already supports the approval workflow |
| `inspection_requests` | **Correct foundation for partner submission.** `owner_id` references `profiles.user_id`. Statuses: `pending` → `scheduled` → `in_progress` → `approved`/`rejected`/`completed` |
| `reservations` | Live booking table. Links to `listings(listing_id)` |
| `hotels` | Extended-stay properties. Has `owner_id` |
| `wallets` | Already accepts `owner_type = 'property_partner'` |
| `wallet_transactions` | Already stores transactions by `user_id` |
| `partner_support_conversations` / `partner_support_messages` | Already have RPCs (`create_partner_support_conversation`, etc.) |
| `commission_rules` | Configurable commission percentages. `commission_rate` defaults to 10% |
| `commission_snapshots` | Stores `worker_share` + `whouse_share`. **Extend** for partner share |

### 2.3 Frontend Components (Keep As-Is)

| Component | File | Reason |
|-----------|------|--------|
| Route resolution | `src/App.tsx` | `case 'property_partner'` is correct |
| Navigation | `src/lib/desktop-nav.tsx` | Partner nav items exist |
| Support RPC wrappers | `src/lib/supabase/partner-support.ts` | 7 RPCs are functional |
| Profile modal | `src/components/UserProfileModal.tsx` | Partner badge display is correct |
| Account center | `src/pages/AccountCenter.tsx` | Generic display works |
| Admin partner list | `src/pages/PartnersTab.tsx` | Admin view is correct |
| Public directory | `src/pages/PropertyPartnersList.tsx` | Public view is correct |

---

## 3. What Is Broken and Needs Correction

### 3.1 Critical Bugs

| # | Bug | Location | Impact |
|---|-----|----------|--------|
| B01 | **`owner_id` set to `profile.auth_id` instead of `profile.user_id`** | `src/pages/CreateListing.tsx` line 222 | Breaks all partner→listing linkage. `auth_id` is the Supabase Auth UUID; `user_id` is the profile primary key. Listings created by admin will not appear on the partner dashboard because the dashboard queries `owner_id = profile.user_id`. |
| B02 | **No partner-facing property submission form** | `src/pages/PropertyOwnerDashboard.tsx` | Partners see "Request an inspection to get started" but have no button or form to actually create an `inspection_requests` row. The SupportTab has a "Property Inspection" category that creates a generic `support_conversations` message, NOT an `inspection_requests` record. |
| B03 | **`listings` dual owner columns (`partner_id` + `owner_id`)** | `src/types/index.ts` lines 187–189; `supabase/migrations/20250707_listing_partner_id.sql` | Both columns reference `profiles.user_id`. The frontend OR-queries both. `partner_id` was added for admin assignment in `CreateListing.tsx` but is redundant with `owner_id`. Data inconsistency risk: a listing could have `owner_id = A` and `partner_id = B`. |
| B04 | **Partner earnings not calculated** | `src/lib/supabase/commission-v2.ts` | `calculateCommission` returns only `{ workerShare, whouseShare }`. Property partners are a third party. No `partner_share` field exists in `CommissionParams` or `commission_snapshots`. |
| B05 | **Partner wallet withdrawal uses worker RPC** | `src/pages/PropertyOwnerDashboard.tsx` WalletTab line 500 | Calls `request_worker_withdrawal` instead of a partner-specific withdrawal RPC. Transaction type is not distinguishable as partner earnings. |

### 3.2 Architecture Issues

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| B06 | **Dashboard name implies ownership** | `src/pages/PropertyOwnerDashboard.tsx` | File name says "PropertyOwner" but component is shared by workers (`property_owner` role) and property partners (`property_partner` role). Misleading and causes maintenance confusion. |
| B07 | **SupportTab uses generic `support_conversations`** | `src/pages/PropertyOwnerDashboard.tsx` SupportTab | Creates generic support tickets with category "Property Inspection" instead of using the dedicated `inspection_requests` table or `partner_support_conversations` RPCs. |
| B08 | **`partner_activity_log` is completely dead** | `src/pages/PropertyOwnerDashboard.tsx` OverviewTab | The table is queried for "Recent Activity" but **no code anywhere in the frontend writes to it**. No triggers populate it either. The Recent Activity section will always be empty. |
| B09 | **Realtime hooks are placeholders** | `src/hooks/useRealtimeUpdates.ts` line 115 | `property_partner` branch is a comment only. Partners do not receive realtime updates for listing status changes, new bookings, or payout events. |
| B10 | **Unread count hooks are placeholders** | `src/hooks/useUnreadCounts.ts` lines 80, 104 | `property_partner` branch has no implementation. Unread badge on nav is always zero for partners. |
| B11 | **`property_partners.id` UUID is orphaned** | `supabase/migrations/20250703_unified_property_system.sql` | The `property_partners.id` column is a UUID that legacy `properties.partner_id` references, but the live frontend uses `profiles.user_id` via `listings.owner_id`. The `id` column is never queried by frontend code. |
| B12 | **`CreateListing.tsx` fetches property partners but assigns wrong ID** | `src/pages/CreateListing.tsx` lines 27–30, 224 | Fetches `profiles` with `role = 'property_partner'` and assigns `partner_id = assignedPartnerId`. But `partner_id` on `listings` references `profiles.user_id`, and the dropdown values are `user_id` strings. This part is actually correct. The bug is B01 (`owner_id: profile.auth_id`). |

---

## 4. What Is Legacy/Duplicate and Should Not Be Used

### 4.1 Legacy Unified Property Schema (Do Not Use)

These tables were defined in `20250703_unified_property_system.sql` and related migrations. They are **comprehensively defined but never queried by the live frontend**. The frontend uses `listings` + `reservations` + `hotels` instead.

| Table | Migration | Why Legacy |
|-------|-----------|------------|
| `properties` | `20250703_unified_property_system.sql` | Frontend queries `listings`, not `properties` |
| `property_units` | `20250703_unified_property_system.sql` | No frontend references |
| `bookings` (unified) | `20250703_unified_property_system.sql` | Frontend uses `reservations` and `worker_bookings` |
| `property_payouts` | `20250703_unified_property_system.sql` | No frontend references; payouts should use `wallet_transactions` |
| `property_contracts` | `20250703_unified_property_system.sql` | No frontend references |
| `rental_agreements` | `20250704_worker_escrow_and_rental_plans.sql` | No frontend references |

**Note:** `inspection_requests` was ALSO defined in `20250703_unified_property_system.sql` with `partner_id UUID REFERENCES property_partners(id)`, but the **live** version is from `20250702_inspection_requests.sql` which uses `owner_id TEXT REFERENCES profiles(user_id)`. The live version is correct and should be kept.

### 4.2 Redundant Columns (Deprecate)

| Column | Table | Replacement | Rationale |
|--------|-------|-------------|-----------|
| `partner_id` | `listings` | `owner_id` | Both reference `profiles.user_id`. `owner_id` is the canonical owner column. `partner_id` was added for admin assignment but creates dual-source-of-truth. |
| `partner_id` | `inspection_requests` (added by `20250707_fix_inspection_requests.sql`) | `owner_id` | The live migration (`20250702_inspection_requests.sql`) already has `owner_id`. The `partner_id` UUID column added later references `property_partners.id` which is orphaned. |

### 4.3 Dead Code (Remove)

| Code | Location | Rationale |
|------|----------|-----------|
| `partner_activity_log` queries | `src/pages/PropertyOwnerDashboard.tsx` OverviewTab | Table has no write path. Remove from UI or implement write path. |
| `partner_code` generation | `src/hooks/useAuth.ts` | Generated as `WH-${Date.now()}` but never displayed or used. |
| `property_partners.id` references | Any future code | Use `profiles.user_id` instead. |

---

## 5. The Property Partner Listing-Request Flow

This is the **exact flow** that must be implemented, using existing architecture where possible.

### 5.1 Flow Diagram

```
Partner                  WeHouse Staff/Admin               Published Listing
   │                             │                                  │
   │ 1. Submit Property          │                                  │
   │    (inspection_requests)    │                                  │
   │ ─────────────────────────>  │                                  │
   │                             │ 2. Review & Inspect              │
   │                             │    (update status)               │
   │                             │ ───────────────────────────────> │
   │                             │                                  │ 3. Create Listing
   │                             │                                  │    (listings table)
   │ 4. View Status              │                                  │
   │    (dashboard)              │                                  │
   │ <─────────────────────────  │                                  │
   │                             │                                  │
   │ 5. Receive Bookings         │                                  │ 6. Bookings Made
   │    (reservations)           │                                  │    (by users)
   │ <─────────────────────────  │                                  │
   │                             │                                  │
   │ 7. Earn Commission          │                                  │ 9. WeHouse Deducts Commission
   │    (wallet credit)          │                                  │    (commission_snapshots)
   │ <─────────────────────────  │                                  │
```

### 5.2 Step-by-Step Flow

#### Step 1: Partner Submits Property for Inspection

**Action:** Partner clicks "Submit Property" on dashboard.  
**Form fields:**
- Property address (required)
- City (required)
- State (required)
- Property type: `apartment` | `house` | `self_contain` | `mini_flat` | `duplex` | `bungalow` | `mansion`
- Bedrooms
- Bathrooms
- Expected rent / price
- Description
- Photo upload (multiple)
- Document upload (optional: deed, survey plan, etc.)

**Backend:** Insert into `inspection_requests`:
```sql
INSERT INTO inspection_requests (
  request_code, owner_id, owner_email, owner_phone,
  property_address, property_city, property_state,
  property_type, bedrooms, bathrooms, expected_rent,
  description, status, photo_urls, document_urls
) VALUES (
  'WHIR-' || nextval('inspection_request_seq'),
  profile.user_id, profile.email, profile.phone,
  ..., ..., ..., ..., ..., ..., ..., ...,
  'pending', photo_urls, document_urls
);
```

**Existing support:** The `inspection_requests` table already has all these columns. No schema change needed for this step.

#### Step 2: WeHouse Reviews & Inspects

**Action:** Staff views inspection request in admin dashboard.  
**Status transitions:**
- `pending` → `scheduled` (staff assigns field officer + date)
- `scheduled` → `in_progress` (field officer visits)
- `in_progress` → `approved` or `rejected`

**Existing support:** The `inspection_requests.status` column already supports these values. The `assigned_to` column references the field officer.

#### Step 3: WeHouse Creates Listing (If Approved)

**Action:** Staff uses `CreateListing.tsx` (admin/creator only) to create the listing.  
**Data mapping:**
- `title` ← from inspection request description / address
- `address`, `city`, `state` ← from inspection request
- `property_type`, `bedrooms`, `bathrooms` ← from inspection request
- `price` ← from inspection `expected_rent`
- `owner_id` ← `inspection_requests.owner_id` (**NOT** `profile.auth_id` — fix B01)
- `submitted_by_role` ← `'property_partner'`
- `status` ← `'pending_approval'` (or directly `'available'` if auto-approved)
- `approved_by` ← staff `user_id`
- `approved_at` ← `now()`
- `partner_id` ← `inspection_requests.owner_id` (legacy column, populate for backward compat during transition)

**Existing support:** `listings` table has all these columns. `CreateListing.tsx` already exists but needs bug fix B01.

#### Step 4: Partner Views Published Properties

**Action:** Partner opens "My Properties" tab.  
**Query:**
```tsx
const { data } = await supabase.from('listings')
  .select('*')
  .eq('owner_id', profile.user_id)
  .order('created_at', { ascending: false });
```

**Note:** After `partner_id` is dropped, this single `owner_id` query is sufficient.

#### Step 5: Users Book the Property

**Action:** User makes reservation via `reservations` table.  
**Existing flow:** `reservations` links to `listings(listing_id)`. Commission is calculated via `commission-v2.ts`.

#### Step 6: Partner Receives Commission

**Action:** After booking is confirmed and paid, partner share is credited to wallet.  
**Missing:** See Section 10.

---

## 6. How a Request Moves: Partner → WeHouse → Published Listing

### 6.1 Partner Side (Frontend)

1. **Dashboard OverviewTab** shows stat: "Under Inspection" = count of `inspection_requests` with `status IN ('pending', 'scheduled', 'in_progress')` where `owner_id = profile.user_id`.
2. **New "Submit Property" button** on OverviewTab opens a modal/form.
3. **Form submission** inserts into `inspection_requests` via direct Supabase insert (RLS policy allows owner insert).
4. **Partner sees request status** in a new "My Submissions" tab or inside SupportTab.
5. **When listing is published**, it appears in "My Properties" tab automatically.

### 6.2 WeHouse Side (Admin/Creator)

1. **Admin dashboard** queries `inspection_requests` with `status = 'pending'`.
2. **Staff assigns field officer** via `assigned_to` column and sets status to `scheduled`.
3. **Field officer inspects**, uploads photos/notes, sets status to `approved` or `rejected`.
4. **If approved**, staff opens `CreateListing.tsx`, pre-fills data from inspection request, creates listing with `owner_id = inspection.owner_id`.
5. **Listing goes live** with `status = 'available'`.

### 6.3 Data Flow Integrity

| Step | Table | Key Column | Value |
|------|-------|-----------|-------|
| Partner signup | `profiles` | `role` | `'property_partner'` |
| Partner signup | `property_partners` | `profile_id` | `profiles.user_id` |
| Property submission | `inspection_requests` | `owner_id` | `profiles.user_id` |
| Inspection approval | `inspection_requests` | `status` | `'approved'` |
| Listing creation | `listings` | `owner_id` | `profiles.user_id` (same as inspection) |
| Listing creation | `listings` | `submitted_by_role` | `'property_partner'` |
| Booking | `reservations` | `listing_id` | `listings.listing_id` |
| Commission | `commission_snapshots` | `partner_id` | `profiles.user_id` |
| Payout | `wallet_transactions` | `user_id` | `profiles.user_id` |

**Critical:** `profiles.user_id` is the single identifier used throughout. `property_partners.id` UUID is not needed for this flow.

---

## 7. Existing Tables/RPCs/Components That Support the Flow

### 7.1 What Already Supports the Flow

| Layer | Artifact | How It Supports |
|-------|----------|-----------------|
| **DB Table** | `inspection_requests` | Already has `owner_id`, `property_address`, `property_city`, `property_state`, `property_type`, `bedrooms`, `bathrooms`, `expected_rent`, `description`, `status`, `photo_urls`, `document_urls`, `assigned_to` |
| **DB Table** | `listings` | Already has `owner_id`, `submitted_by_role`, `status` (`pending_approval`/`available`/`rejected`), `approved_by`, `approved_at`, `rejection_reason` |
| **DB Table** | `profiles` | Already has `role = 'property_partner'` |
| **DB Table** | `property_partners` | Already has `profile_id` → `profiles.user_id` |
| **DB Table** | `wallets` | Already accepts `owner_type = 'property_partner'` |
| **DB Table** | `commission_rules` | Already has `commission_rate` default 10% |
| **Frontend** | `PropertyOwnerDashboard.tsx` | Already queries `inspection_requests` and `listings` |
| **Frontend** | `CreateListing.tsx` | Already creates listings with `partner_id` and `owner_id` (buggy) |
| **Frontend** | `src/lib/supabase/partner-support.ts` | Already has RPCs for partner support conversations |
| **RLS** | `inspection_requests_owner` | Already allows `owner_id = auth.uid()::text` |
| **RLS** | `listings_update_owner` | Already allows `owner_id = auth.uid()::text` to update |

### 7.2 What Is Genuinely Missing

| Layer | Missing Artifact | Why Needed |
|-------|-----------------|------------|
| **DB Column** | `reservations.partner_id` | To attribute a booking to the property partner for commission calculation |
| **DB Column** | `hotels.partner_id` | To attribute hotel bookings to property partners |
| **DB Column** | `commission_snapshots.partner_id` | To store which partner earned the share |
| **DB Column** | `commission_snapshots.partner_share` | To store the partner's earnings amount |
| **DB Column** | `wallet_transactions.transaction_type` values for partner | To distinguish partner commission from worker earnings |
| **Frontend Component** | `SubmitPropertyModal.tsx` | Partner-facing form to create `inspection_requests` |
| **Frontend Component** | `MySubmissionsTab.tsx` | Partner-facing view of `inspection_requests` status |
| **Frontend Hook** | `usePartnerRealtime.ts` | Realtime updates for partner-specific events |
| **Frontend Function** | `calculatePartnerCommission()` | Commission calc including partner share |
| **RPC** | `request_partner_withdrawal` | Partner-specific withdrawal (not `request_worker_withdrawal`) |
| **RPC** | `get_partner_earnings` | Query partner's total/pending/available earnings |
| **Trigger** | `log_inspection_created` | Auto-write to `partner_activity_log` on inspection insert |
| **Trigger** | `log_listing_published` | Auto-write to `partner_activity_log` on listing approval |
| **Trigger** | `log_partner_earned` | Auto-write to `partner_activity_log` on commission snapshot insert |

---

## 8. How the Resulting Listing Remains Linked to the Property Partner

### 8.1 Canonical Linkage: `listings.owner_id`

The **single source of truth** for partner→listing linkage is `listings.owner_id` referencing `profiles.user_id`.

**Current state (broken):**
```tsx
// CreateListing.tsx (buggy)
owner_id: profile.auth_id,  // WRONG: auth_id !== user_id
partner_id: assignedPartnerId || null,
```

**Correct state:**
```tsx
// CreateListing.tsx (fixed)
owner_id: inspectionRequest.owner_id,  // The partner's profiles.user_id
partner_id: null,  // To be deprecated
submitted_by_role: 'property_partner',
status: 'available',  // or 'pending_approval' if admin wants review
approved_by: staffProfile.user_id,
approved_at: new Date().toISOString(),
```

### 8.2 Query Pattern

**Partner dashboard queries:**
```tsx
// My Properties tab
const { data } = await supabase.from('listings')
  .select('*')
  .eq('owner_id', profile.user_id)
  .order('created_at', { ascending: false });
```

**Admin queries:**
```tsx
// Listings by partner
const { data } = await supabase.from('listings')
  .select('*')
  .eq('owner_id', partnerUserId)
  .eq('submitted_by_role', 'property_partner');
```

### 8.3 Migration Path for `partner_id` Column

**Phase 1 (Immediate):** Keep `partner_id` populated for backward compatibility. Set `partner_id = owner_id` on all new listings.

**Phase 2 (After frontend cleanup):** Verify all frontend queries use `owner_id` only. Then drop `partner_id` column.

**Phase 3 (Cleanup migration):**
```sql
-- Verify no mismatched rows
SELECT COUNT(*) FROM listings WHERE partner_id IS NOT NULL AND partner_id != owner_id;

-- If zero mismatches:
ALTER TABLE listings DROP COLUMN partner_id;
DROP INDEX IF EXISTS idx_listings_partner_id;
```

---

## 9. Existing Booking/Payment/Revenue Paths Relevant to Property Partners

### 9.1 Short-Stay / Apartment Bookings (`listings` + `reservations`)

**Flow:**
1. User views `listings` with `status = 'available'` and `availability_status = 'available'`.
2. User creates `reservations` row with `listing_id`, `user_id`, `status = 'pending'`.
3. User pays reservation fee via Paystack.
4. `reservations.status` changes to `confirmed`, `fee_paid = true`, `paid_at = now()`.
5. `listings.status` may change to `reserved` or stay `available`.

**Partner relevance:** Currently, when a reservation is confirmed, **no commission is attributed to the partner**. The `commission-v2.ts` system only handles worker bookings.

### 9.2 Extended-Stay / Hotel Bookings (`hotels` + `hotel_rooms` + `hotel_bookings`)

**Flow:**
1. User views `hotels` with `owner_id` set.
2. User books a room via `hotel_bookings` table.
3. Payment is processed.

**Partner relevance:** `hotels` has `owner_id` but no `partner_id`. A property partner who owns a hotel building cannot have their ownership recognized in the hotel booking flow.

### 9.3 Worker Bookings (`worker_bookings`)

**Flow:**
1. User books a worker service.
2. `commission-v2.ts` calculates `workerShare` and `whouseShare`.
3. Worker gets paid.

**Partner relevance:** Not directly relevant to property partners unless they also hire workers for their properties. Property partners are NOT workers.

---

## 10. What Is Missing for Commission Deduction and Partner Earnings/Wallet Crediting

### 10.1 Commission Calculation Gap

**Current `commission-v2.ts`:**
```ts
export interface CommissionResult {
  workerShare: number;
  whouseShare: number;
}
```

**Missing:** `partnerShare: number` and `partnerId: string`.

**Required calculation:**
```ts
// For property bookings (not worker bookings)
const whouseRate = 0.10; // 10% default from commission_rules
const whouseShare = grossAmount * whouseRate;
const partnerShare = grossAmount - whouseShare; // 90% to partner

// Store in commission_snapshots
{
  listing_id: listingId,
  reservation_id: reservationId,
  gross_amount: grossAmount,
  commission_amount: whouseShare,
  worker_share: 0,        // Not a worker booking
  whouse_share: whouseShare,
  partner_id: partnerId,   // NEW
  partner_share: partnerShare, // NEW
  net_amount: partnerShare,
  partner_paid: false,     // NEW
}
```

### 10.2 Wallet Crediting Gap

**Current state:** `wallet_transactions` has no `transaction_type` for partner commission.

**Required addition:**
```sql
-- wallet_transactions table already has type TEXT
-- Need to support: 'partner_commission', 'partner_payout', 'partner_bonus'
```

**Crediting flow:**
1. When reservation is confirmed and paid, trigger inserts `wallet_transactions`:
   - `user_id = partner_profiles.user_id`
   - `type = 'partner_commission'`
   - `amount = partnerShare`
   - `status = 'completed'`
   - `reference = reservationId`
2. Partner wallet balance increases.
3. Partner requests withdrawal via `request_partner_withdrawal` RPC.
4. Admin approves, `wallet_transactions` inserts `type = 'partner_payout'`.

### 10.3 Earnings Display Gap

**Current dashboard:** Shows `totalEarnings` from `profile.total_earnings` but this field is never populated for partners.

**Required:**
- Query `commission_snapshots` where `partner_id = profile.user_id` to get:
  - Total earnings (sum of `partner_share` where `partner_paid = true`)
  - Pending earnings (sum of `partner_share` where `partner_paid = false`)
  - Available balance (from `wallets` table)

### 10.4 Required New RPCs

| RPC | Purpose |
|-----|---------|
| `get_partner_earnings(p_partner_id TEXT)` | Returns total, pending, available earnings |
| `request_partner_withdrawal(p_amount NUMERIC, p_bank_account_id TEXT)` | Creates withdrawal request for partner |
| `credit_partner_commission(p_reservation_id TEXT)` | Trigger/RPC to credit partner wallet on booking confirmation |

---

## 11. Tabs/Actions to Remove or Correct

### 11.1 Actions That Improperly Let Partners Perform WeHouse-Controlled Actions

| # | Action | Current State | Correction |
|---|--------|--------------|------------|
| C01 | **Direct listing creation** | `CreateListing.tsx` is admin/creator only. **No partner access.** No correction needed — keep gated. | Keep as-is. Partners must NOT access `CreateListing.tsx`. |
| C02 | **Listing editing** | `PropertyOwnerDashboard.tsx` PropertyDetail has tabs including 'general', 'photos', 'amenities', 'status', 'occupancy', 'performance'. | **Remove 'status' tab** from partner view. Partners must NOT change `status` (e.g., from `pending_approval` to `available`). Only WeHouse staff should change status. Keep 'general', 'photos', 'amenities', 'occupancy', 'performance' as read-only or limited-edit. |
| C03 | **Listing deletion** | Partner can see a "Delete" button on property cards (implied by `MyPropertiesTab` but not confirmed in code). | **Verify and remove if present.** Partners must NOT delete published listings. Only WeHouse staff can delist. |
| C04 | **Direct support ticket escalation** | SupportTab allows sending messages but no escalation mechanism. | Add escalation request as a support category. |
| C05 | **Featured listing toggle** | `listings.is_featured` exists. Partners might be able to set this. | **Gate `is_featured`** behind staff approval or remove from partner view. |

### 11.2 Tabs to Correct

| Tab | Current | Correction |
|-----|---------|------------|
| **Overview** | Shows stats, no action buttons | Add "Submit Property" button that opens `SubmitPropertyModal` |
| **Properties** | Shows listings, empty state says "Request an inspection" | Add "Submit Property" button to empty state. Remove edit/delete on published listings (read-only). |
| **Support** | Uses generic `support_conversations` | Add direct `inspection_requests` creation form. Keep generic support for non-inspection issues. |
| **Messages** | Shows generic messages | Keep. Partner↔WeHouse messaging is correct. |
| **Wallet** | Shows balance, uses `request_worker_withdrawal` | Change to `request_partner_withdrawal`. Add transaction type filter for partner earnings. |
| **Earnings** | Shows charts from `profile.total_earnings` | Wire to `commission_snapshots` partner queries. Show breakdown by property and booking. |
| **Settings** | Has "Close Account" | Keep. Account deletion check is correct (blocked if listings exist). |

### 11.3 Tabs to Add

| Tab | Purpose |
|-----|---------|
| **My Submissions** | View `inspection_requests` status history. Track: submitted → scheduled → inspected → approved/rejected → listed. |

---

## 12. Final Property Partner Dashboard Design

Based on the actual responsibilities supported by the workflow (submit properties, view published listings, track earnings, communicate with WeHouse, manage wallet), the dashboard should contain:

### 12.1 Sidebar Navigation

| Item | Label | Content |
|------|-------|---------|
| `overview` | Overview | Stats, notifications, quick actions (Submit Property) |
| `submissions` | My Submissions | **NEW.** Inspection request history and status |
| `properties` | My Properties | Published listings (read-only view) |
| `earnings` | Earnings | Commission breakdown, property performance |
| `wallet` | Wallet | Balance, transactions, withdrawal |
| `messages` | Messages | Conversations with WeHouse staff |
| `support` | Support | FAQ, contact form, inspection request |
| `profile` | Profile | Business details, contact info |
| `settings` | Settings | Notifications, password, close account |

### 12.2 Overview Tab

```
+-------------------------------------------------------------+
|  Overview                                      [Submit Property]  |
+-------------------------------------------------------------+
|  Total Properties | Active | Under Inspection | Pending Approval |
|  Wallet Balance   | Pending | Total Earnings  |                  |
+-------------------------------------------------------------+
|  Recent Notifications                                       |
|  - Your property at 123 Main St has been approved            |
|  - New booking received for Duplex A                         |
|  - Withdrawal of N50,000 completed                           |
+-------------------------------------------------------------+
```

### 12.3 My Submissions Tab (NEW)

```
+-------------------------------------------------------------+
|  My Submissions                                               |
+-------------------------------------------------------------+
|  +-----------------------------------------------------+   |
|  | WHIR-00042  | 123 Main St, Lagos  | pending         |   |
|  | Submitted: 2026-08-01 | Expected Rent: N500,000/year |   |
|  +-----------------------------------------------------+   |
|  +-----------------------------------------------------+   |
|  | WHIR-00038  | 456 Oak Ave, Abuja  | approved        |   |
|  | Inspected: 2026-07-28 | Listed: Duplex B            |   |
|  +-----------------------------------------------------+   |
+-------------------------------------------------------------+
```

### 12.4 My Properties Tab (Read-Only)

```
+-------------------------------------------------------------+
|  My Properties                                                |
+-------------------------------------------------------------+
|  +---------+ +---------+ +---------+                        |
|  | [Image] | | [Image] | | [Image] |                        |
|  | Duplex A| | Short   | | Hotel R |                        |
|  | N2.5M/yr| | Let N15K| | N8K/day |                        |
|  | * Active| | * Active| | * Active|                        |
|  +---------+ +---------+ +---------+                        |
|                                                               |
|  Click a property to view details (read-only)                |
+-------------------------------------------------------------+
```

**Property Detail View (Partner):**
- General info (read-only)
- Photos (read-only)
- Amenities (read-only)
- Inspection History (read-only)
- Occupancy stats (read-only)
- Performance metrics (read-only)
- **NO "Edit" button**
- **NO "Delete" button**
- **NO "Change Status" button**

### 12.5 Earnings Tab

```
+-------------------------------------------------------------+
|  Earnings                                                     |
+-------------------------------------------------------------+
|  Total Earnings: N1,250,000  |  Available: N875,000          |
|  Pending: N375,000           |  Withdrawn: N500,000          |
+-------------------------------------------------------------+
|  By Property                                                  |
|  +-----------------------------------------------------+   |
|  | Duplex A    | 12 bookings | N750,000 | N675,000 net |   |
|  | Short Let B | 8 bookings  | N400,000 | N360,000 net |   |
|  | Hotel R     | 5 bookings  | N100,000 | N90,000 net  |   |
|  +-----------------------------------------------------+   |
+-------------------------------------------------------------+
```

---

## 13. Required Changes: Database / RPC / RLS / Frontend

### 13.1 Database Migrations (Plan Only — Do Not Execute)

#### Migration 1: Fix `inspection_requests` Column Mismatch
**File:** `20260810_fix_inspection_requests_owner.sql`

```sql
-- The live inspection_requests table (from 20250702_inspection_requests.sql)
-- already has owner_id TEXT REFERENCES profiles(user_id).
-- The 20250707_fix_inspection_requests.sql added partner_id UUID which
-- references the orphaned property_partners.id.
-- We standardize on owner_id.

-- Step 1: Drop the orphaned partner_id column
ALTER TABLE inspection_requests DROP COLUMN IF EXISTS partner_id;

-- Step 2: Drop the orphaned index
DROP INDEX IF EXISTS idx_ir_partner_id;

-- Step 3: Ensure owner_id is NOT NULL and indexed
CREATE INDEX IF NOT EXISTS idx_inspection_requests_owner ON inspection_requests(owner_id);
```

#### Migration 2: Add Partner Linkage to `reservations`
**File:** `20260810_add_reservations_partner_id.sql`

```sql
-- Link reservations to property partners for commission attribution
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS partner_id TEXT REFERENCES profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_partner_id ON reservations(partner_id);

-- Backfill partner_id from listings.owner_id
UPDATE reservations r
SET partner_id = l.owner_id
FROM listings l
WHERE r.listing_id = l.listing_id
  AND l.owner_id IS NOT NULL
  AND r.partner_id IS NULL;
```

#### Migration 3: Add Partner Linkage to `hotels`
**File:** `20260810_add_hotels_partner_id.sql`

```sql
-- Allow hotel ownership by property partners
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS partner_id TEXT REFERENCES profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_hotels_partner_id ON hotels(partner_id);

-- Backfill from hotels.owner_id where owner is a property_partner
UPDATE hotels h
SET partner_id = h.owner_id
FROM profiles p
WHERE h.owner_id = p.user_id
  AND p.role = 'property_partner'
  AND h.partner_id IS NULL;
```

#### Migration 4: Extend `commission_snapshots` for Partner Share
**File:** `20260810_partner_commission_schema.sql`

```sql
ALTER TABLE commission_snapshots ADD COLUMN IF NOT EXISTS partner_id TEXT;
ALTER TABLE commission_snapshots ADD COLUMN IF NOT EXISTS partner_share DECIMAL(12,2) DEFAULT 0;
ALTER TABLE commission_snapshots ADD COLUMN IF NOT EXISTS partner_paid BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_commission_snapshots_partner ON commission_snapshots(partner_id);
```

#### Migration 5: Extend `wallet_transactions` for Partner Types
**File:** `20260810_partner_wallet_types.sql`

```sql
-- Add check constraint or documentation for partner transaction types
-- wallet_transactions.type is TEXT; we need to document these values:
--   'partner_commission'  -- earnings from property bookings
--   'partner_payout'      -- withdrawal to partner bank account
--   'partner_bonus'       -- promotional or adjustment credit
--   'partner_refund'      -- reversal of commission

-- No schema change needed if type is unrestricted TEXT.
-- Add comment for documentation:
COMMENT ON COLUMN wallet_transactions.type IS
  'Transaction type: deposit, withdrawal, worker_commission, worker_payout, partner_commission, partner_payout, partner_bonus, partner_refund, commission, adjustment, reversal';
```

#### Migration 6: Populate `partner_activity_log` via Triggers
**File:** `20260810_partner_activity_log_triggers.sql`

```sql
-- Create triggers to auto-populate partner_activity_log

-- Trigger 1: Log when inspection request is created
CREATE OR REPLACE FUNCTION log_inspection_created()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO partner_activity_log (partner_id, activity_type, title, description, metadata)
  VALUES (NEW.owner_id, 'inspection_submitted', 'Property Submitted', 'Submitted ' || NEW.property_address || ' for inspection', jsonb_build_object('request_id', NEW.id, 'address', NEW.property_address));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_inspection_created ON inspection_requests;
CREATE TRIGGER trg_log_inspection_created
  AFTER INSERT ON inspection_requests
  FOR EACH ROW EXECUTE FUNCTION log_inspection_created();

-- Trigger 2: Log when listing is approved
CREATE OR REPLACE FUNCTION log_listing_approved()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'available' AND OLD.status != 'available' THEN
    INSERT INTO partner_activity_log (partner_id, activity_type, title, description, metadata)
    VALUES (NEW.owner_id, 'listing_published', 'Listing Published', NEW.title || ' is now live', jsonb_build_object('listing_id', NEW.id, 'title', NEW.title));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_listing_approved ON listings;
CREATE TRIGGER trg_log_listing_approved
  AFTER UPDATE ON listings
  FOR EACH ROW WHEN (NEW.status = 'available' AND OLD.status != 'available')
  EXECUTE FUNCTION log_listing_approved();

-- Trigger 3: Log when partner earns commission
CREATE OR REPLACE FUNCTION log_partner_earned()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.partner_id IS NOT NULL AND NEW.partner_share > 0 THEN
    INSERT INTO partner_activity_log (partner_id, activity_type, title, description, metadata)
    VALUES (NEW.partner_id, 'commission_earned', 'Earnings Received', 'N' || NEW.partner_share::text || ' from booking', jsonb_build_object('snapshot_id', NEW.id, 'amount', NEW.partner_share));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_partner_earned ON commission_snapshots;
CREATE TRIGGER trg_log_partner_earned
  AFTER INSERT ON commission_snapshots
  FOR EACH ROW EXECUTE FUNCTION log_partner_earned();
```

#### Migration 7: Deprecate `listings.partner_id` Column
**File:** `20260810_deprecate_listings_partner_id.sql`

```sql
-- Phase 1: Verify no mismatched data
DO $$
DECLARE
  mismatch_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO mismatch_count
  FROM listings
  WHERE partner_id IS NOT NULL
    AND owner_id IS NOT NULL
    AND partner_id != owner_id;

  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'Found % listings with mismatched partner_id and owner_id. Fix before dropping column.', mismatch_count;
  END IF;
END $$;

-- Phase 2: Drop column and index
ALTER TABLE listings DROP COLUMN IF EXISTS partner_id;
DROP INDEX IF EXISTS idx_listings_partner_id;

-- Phase 3: Update RLS policies that referenced partner_id
-- (List policies that need updating)
```

#### Migration 8: Deprecate Legacy Unified Schema
**File:** `20260810_deprecate_unified_property_schema.sql`

```sql
-- Mark legacy tables as deprecated (do NOT drop yet -- data audit required)
COMMENT ON TABLE properties IS 'DEPRECATED: Use listings table. Unified property schema is no longer used by frontend.';
COMMENT ON TABLE property_units IS 'DEPRECATED: Use listings table with sub_type field.';
COMMENT ON TABLE bookings IS 'DEPRECATED: Use reservations table for property bookings, worker_bookings for service bookings.';
COMMENT ON TABLE property_payouts IS 'DEPRECATED: Use wallet_transactions table.';
COMMENT ON TABLE property_contracts IS 'DEPRECATED: No replacement. Contracts stored as document URLs in listings or owner_contracts.';
COMMENT ON TABLE rental_agreements IS 'DEPRECATED: Use reservations + contract document URL.';
```

### 13.2 RPCs to Create or Modify

| RPC | Type | Purpose | SQL Outline |
|-----|------|---------|-------------|
| `get_partner_earnings` | New | Return partner's financial summary | `SELECT SUM(partner_share) FILTER (WHERE partner_paid) as total_earnings, SUM(partner_share) FILTER (WHERE NOT partner_paid) as pending FROM commission_snapshots WHERE partner_id = p_partner_id` |
| `request_partner_withdrawal` | New | Partner withdrawal request | Similar to `request_worker_withdrawal` but with `owner_type = 'property_partner'` and transaction type `partner_payout` |
| `credit_partner_commission` | New | Credit partner wallet on booking | Insert into `wallet_transactions` with `type = 'partner_commission'` and update `wallets.balance` |
| `create_inspection_request` | New | Create inspection request with auto-generated code | Insert into `inspection_requests` with `request_code = 'WHIR-' || nextval('seq')` |
| `get_partner_inspection_requests` | New | List partner's inspection history | `SELECT * FROM inspection_requests WHERE owner_id = p_partner_id ORDER BY created_at DESC` |
| `delete_user_account` | Modify | Add hotel ownership check | Also check `hotels` table for `owner_id = p_user_id` or `partner_id = p_user_id` |

### 13.3 RLS Policies to Add or Modify

| Table | Policy | Action |
|-------|--------|--------|
| `inspection_requests` | `inspection_requests_owner` | Keep: `owner_id = auth.uid()::text` |
| `inspection_requests` | `inspection_requests_staff` | Keep: staff/admin/creator roles |
| `listings` | `listings_partner_read` | **New:** `owner_id = auth.uid()::text AND submitted_by_role = 'property_partner'` |
| `commission_snapshots` | `commission_partner_read` | **New:** `partner_id = auth.uid()::text` |
| `hotels` | `hotels_partner_read` | **New:** `partner_id = auth.uid()::text` |
| `wallet_transactions` | `wallet_partner_read` | **New:** `user_id = auth.uid()::text AND type IN ('partner_commission', 'partner_payout')` |

### 13.4 Frontend Changes

#### New Files to Create

| File | Purpose |
|------|---------|
| `src/components/SubmitPropertyModal.tsx` | Modal form for partner to submit property for inspection |
| `src/components/MySubmissionsTab.tsx` | Tab showing inspection request history |
| `src/lib/supabase/inspection-requests.ts` | CRUD for `inspection_requests` table |
| `src/lib/supabase/partner-earnings.ts` | Queries for partner commission and earnings |
| `src/types/partner.ts` | TypeScript types for partner-specific data structures |

#### Files to Modify

| File | Change |
|------|--------|
| `src/pages/PropertyOwnerDashboard.tsx` | Rename to `PartnerDashboard.tsx`; add "Submit Property" button; add "My Submissions" tab; remove edit/delete from property cards; wire earnings to `partner-earnings.ts`; implement `partner_activity_log` reads |
| `src/pages/CreateListing.tsx` | **Fix B01:** Change `owner_id: profile.auth_id` to `owner_id: profile.user_id` (or `inspectionRequest.owner_id` when creating from approved inspection); remove `partner_id` assignment; pre-fill from inspection request data |
| `src/App.tsx` | Update lazy import path after rename |
| `src/hooks/useAuth.ts` | Remove direct `property_partners` table insert; rely on `get_or_create_partner_record` RPC |
| `src/hooks/useRealtimeUpdates.ts` | Implement partner-specific channels: `listings:owner_id=eq.${userId}`, `reservations:partner_id=eq.${userId}`, `wallet_transactions:user_id=eq.${userId}` |
| `src/hooks/useUnreadCounts.ts` | Implement partner unread counts from `partner_support_conversations` and `partner_activity_log` |
| `src/lib/supabase/commission-v2.ts` | Add `partnerShare` and `partnerId` to `CommissionResult` and `CommissionParams`; add partner commission calculation logic |
| `src/lib/supabase/workers.ts` | Add `requestPartnerWithdrawal` wrapper around new RPC |
| `src/lib/supabase/hotels.ts` | Add `partner_id` to hotel queries and creation |
| `src/lib/supabase/reservations.ts` | Store `partner_id` on reservation when booking a partner-owned listing |
| `src/lib/supabase/listings.ts` | Remove `partner_id` from queries; standardize on `owner_id` |
| `src/pages/SecuritySettings.tsx` | Add hotel ownership check to deletion eligibility |
| `src/lib/desktop-nav.tsx` | Rename "Properties" to "My Properties"; add "My Submissions" |

---

## 14. Decision Register

| # | Decision | Rationale |
|---|----------|-----------|
| D01 | **Keep `inspection_requests` as the partner submission mechanism** | The table already has all required columns (`owner_id`, `property_address`, `property_type`, `bedrooms`, `bathrooms`, `expected_rent`, `photo_urls`, `document_urls`, `status`). No new table needed. |
| D02 | **Use `listings.owner_id` as the canonical partner linkage** | `owner_id` already exists, is indexed, and has RLS policies. `partner_id` is redundant. Deprecate `partner_id`. |
| D03 | **Do NOT create a separate `listing_requests` table** | `inspection_requests` already serves this purpose. A second request table would fragment the workflow. |
| D04 | **Property partners do NOT directly create `listings`** | Business rule: WeHouse creates and publishes listings after inspection. `CreateListing.tsx` remains admin/creator-only. Partners use `inspection_requests` → WeHouse approval → listing creation. |
| D05 | **Keep `property_partners` table but ignore its `id` UUID** | The table is useful for `partner_code` and `status` metadata. Its `profile_id` column correctly links to `profiles.user_id`. The `id` UUID is orphaned but harmless if not referenced. |
| D06 | **Commission default is 10% (WeHouse), 90% (Partner)** | Matches existing `commission_rules.commission_rate` default of 10%. No worker share for pure property bookings. |
| D07 | **Partner dashboard properties are read-only** | Partners cannot edit, delete, or change status of published listings. Only WeHouse staff controls listing content and availability. |
| D08 | **Use `partner_support_conversations` for partner↔WeHouse messaging** | These RPCs already exist. The dashboard currently uses generic `support_conversations`; migrate to partner-specific tables for cleaner data separation. |
| D09 | **Hotel bookings must also attribute commission to partners** | Partners can own hotels (extended-stay properties). `hotels` needs `partner_id` for consistent revenue attribution. |
| D10 | **Do NOT drop legacy `properties`/`property_units`/`bookings` tables yet** | Add deprecation comments first. Data audit required to ensure no admin tools use them. Drop in a future cleanup migration. |

---

## 15. File Path Index

### 15.1 Frontend Files

| Path | Status | Section |
|------|--------|---------|
| `src/pages/PropertyOwnerDashboard.tsx` → `PartnerDashboard.tsx` | Rename + modify | 12, 13.4 |
| `src/pages/CreateListing.tsx` | Modify (fix B01) | 3.1, 13.4 |
| `src/hooks/useAuth.ts` | Modify (remove direct insert) | 13.4 |
| `src/hooks/useRealtimeUpdates.ts` | Modify (implement partner branches) | 13.4 |
| `src/hooks/useUnreadCounts.ts` | Modify (implement partner counts) | 13.4 |
| `src/lib/supabase/commission-v2.ts` | Modify (add partner share) | 10, 13.4 |
| `src/lib/supabase/workers.ts` | Modify (add partner withdrawal) | 13.4 |
| `src/lib/supabase/hotels.ts` | Modify (add partner_id) | 13.4 |
| `src/lib/supabase/reservations.ts` | Modify (add partner_id) | 13.4 |
| `src/lib/supabase/listings.ts` | Modify (remove partner_id queries) | 13.4 |
| `src/pages/SecuritySettings.tsx` | Modify (add hotel check) | 13.4 |
| `src/lib/desktop-nav.tsx` | Modify (rename, add submissions) | 13.4 |
| `src/components/SubmitPropertyModal.tsx` | **Create** | 13.4 |
| `src/components/MySubmissionsTab.tsx` | **Create** | 13.4 |
| `src/lib/supabase/inspection-requests.ts` | **Create** | 13.4 |
| `src/lib/supabase/partner-earnings.ts` | **Create** | 13.4 |
| `src/types/partner.ts` | **Create** | 13.4 |

### 15.2 Backend Migrations (Plan Only)

| Path | Status | Section |
|------|--------|---------|
| `supabase/migrations/20260810_fix_inspection_requests_owner.sql` | **Plan** | 13.1 |
| `supabase/migrations/20260810_add_reservations_partner_id.sql` | **Plan** | 13.1 |
| `supabase/migrations/20260810_add_hotels_partner_id.sql` | **Plan** | 13.1 |
| `supabase/migrations/20260810_partner_commission_schema.sql` | **Plan** | 13.1 |
| `supabase/migrations/20260810_partner_wallet_types.sql` | **Plan** | 13.1 |
| `supabase/migrations/20260810_partner_activity_log_triggers.sql` | **Plan** | 13.1 |
| `supabase/migrations/20260810_deprecate_listings_partner_id.sql` | **Plan** | 13.1 |
| `supabase/migrations/20260810_deprecate_unified_property_schema.sql` | **Plan** | 13.1 |

### 15.3 Unchanged Files (Confirmed)

| Path | Reason |
|------|--------|
| `src/pages/Login.tsx` | Already supports `property_partner` signup |
| `src/pages/Setup.tsx` | Already handles partner setup |
| `src/lib/supabase/profile.ts` | `createProfile` RPC delegation is correct |
| `src/lib/supabase/partner-support.ts` | RPC wrappers are functional |
| `src/pages/PartnersTab.tsx` | Admin view is correct |
| `src/pages/PropertyPartnersList.tsx` | Public directory is correct |
| `src/pages/AnalyticsPage.tsx` | Partner count query is correct |
| `src/pages/CreatorHome.tsx` | Partner count query is correct |
| `src/pages/Home.tsx` | Partner CTA routing is correct |
| `supabase/migrations/20250707_property_partners_table.sql` | Table creation is correct |
| `supabase/migrations/20260807_partner_signup_compatibility.sql` | Trigger is correct |
| `supabase/migrations/20260807_profile_role_data_security.sql` | RLS policies are correct |
| `supabase/migrations/20260807_worker_workflow_hardening.sql` | `delete_user_account` RPC is correct (just needs hotel check extension) |

---

*End of Correction Plan.*
