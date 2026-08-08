# Property Partner Workflow — Correction Plan

**Repository:** WeHouse React + Vite + TypeScript SPA with Supabase backend  
**Branch:** `main`  
**Base Commit:** `7621b72c961e6d9b6213430ba0692efd6dba0050` (contains `PROPERTY_PARTNER_WORKFLOW_DISCOVERY.md`)  
**Plan Date:** 2026-08-09  
**Scope:** PLANNING ONLY — No code changes, no SQL, no migrations in this commit.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Decision Register](#2-decision-register)
3. [Files to Touch](#3-files-to-touch)
4. [Frontend Files](#4-frontend-files)
5. [Backend Files](#5-backend-files)
6. [Section-by-Section Correction Plan](#6-section-by-section-correction-plan)
7. [Dependencies and Sequencing](#7-dependencies-and-sequencing)
8. [Testing Strategy](#8-testing-strategy)
9. [File Path Index](#9-file-path-index)
10. [Glossary](#10-glossary)

---

## 1. Executive Summary

The Property Partner role in WeHouse is **functionally operational but architecturally fragile**. It works for basic signup, dashboard viewing, and support chat, but contains a **dual-schema overlap** (`listings` vs `properties`/`property_units`/`bookings`), **orphan columns** (`partner_id` vs `owner_id` on `listings`), **unreachable legacy code**, and **missing financial plumbing** (no revenue attribution from hotel/apartment bookings to partners).

This correction plan proposes **15 concrete changes** organized into:
- **5 files to CREATE** (new components, types, constants)
- **18 files to MODIFY** (refactor, fix gates, clarify naming)
- **4 artifacts to DROP/REMOVE** (legacy tables, dead code, duplicate columns)
- **12 files confirmed NO CHANGE NEEDED**

The work is sequenced into 5 phases (A–E) with dependencies mapped. Each change carries a severity (Critical / High / Medium / Low) and a rationale.

---

## 2. Decision Register

| # | Decision | Severity | Rationale |
|---|----------|----------|-----------|
| D01 | **Rename `PropertyOwnerDashboard.tsx` → `PartnerDashboard.tsx`** | High | The component is shared by workers (`property_owner`) and property partners (`property_partner`). The current name implies ownership semantics that confuse the partner role. A unified `PartnerDashboard` with internal role branching is clearer. |
| D02 | **Remove `is_staff` gate from "Add Property" button on partner dashboard** | Critical | Partners currently cannot add properties because the button is gated behind `profile.is_staff === true`. This appears to be a copy-paste error from admin tooling. Partners must be able to request property listing creation. |
| D03 | **Unify `partner_id` and `owner_id` on `listings` into a single `owner_id`** | Critical | Both columns reference `profiles.user_id`. The frontend OR-queries both, but `partner_id` is only populated by admin `CreateListing.tsx`. `owner_id` is the canonical owner reference. `partner_id` should be dropped after migrating data. |
| D04 | **Deprecate `properties`/`property_units`/`bookings` (unified schema)** | High | These tables are defined in migrations but never queried by the frontend. The live system uses `listings` + `reservations`. Keeping both schemas risks data divergence and doubles migration maintenance. |
| D05 | **Keep `property_partners` table but ignore its `id` UUID** | Medium | The `id` column is a UUID that legacy `properties.partner_id` references, but the live frontend uses `profiles.user_id` via `listings.partner_id`/`owner_id`. The table remains useful for `partner_code` and `status` metadata. |
| D06 | **Add `partner_id` reference to `hotels` table** | High | Hotels have `owner_id` but no `partner_id`. Property partners who own hotel buildings cannot have their hotels linked to their partner profile for commission attribution. |
| D07 | **Add `partner_share` and `whouse_share` to `commission_snapshots`** | High | The commission system (`commission-v2.ts`) only tracks `worker_share` and `whouse_share`. Property partners are a third revenue party. Without this, partner earnings cannot be calculated. |
| D08 | **Implement `partner_activity_log` write path** | Medium | The table is queried in `PropertyOwnerDashboard` (Recent Activity tab) but no frontend code writes to it. Activity events (listing created, booking received, payout released) must be logged. |
| D09 | **Remove `CreateListing` partner-assignment from admin flow** | Medium | `CreateListing.tsx` currently fetches property partners and assigns `partner_id`. After D02 (partners self-list), this admin-assignment flow becomes obsolete. Admin should only approve, not assign. |
| D10 | **Standardize role enum to 3 values on frontend** | Medium | Frontend only uses `'user' | 'worker' | 'property_partner'`, but backend migrations and RLS policies recognize `'staff' | 'admin' | 'creator' | 'creator_admin' | 'state_admin' | 'assistant_state_admin' | 'director'`. This mismatch causes type safety holes. |
| D11 | **Split worker and partner wallet access controls** | Medium | `App.tsx` gates wallet access with `profile.role !== 'worker' && profile.role !== 'property_partner'`. Worker and partner wallets should have separate transaction types and commission rules. |
| D12 | **Add `is_featured` gate to partner listings** | Low | Partners can set `is_featured = true` on their own listings with no cost control. A staff approval gate or billing mechanism should be added. |
| D13 | **Implement partner support ticket escalation** | Low | `partner_support_conversations` has `is_resolved` but no `escalated_to` or `priority` fields. Partners cannot escalate issues beyond the first support tier. |
| D14 | **Document `partner_code` usage or remove it** | Low | `partner_code` is generated (`WH-${Date.now()}`) on signup but never displayed or used. Either expose it as a referral code or drop the column. |
| D15 | **Add RLS policy for partner earnings visibility** | Medium | No RLS policy exists on `commission_snapshots` or `property_payouts` for `property_partner` role. Partners cannot securely read their own earnings. |

---

## 3. Files to Touch

### 3.1 Files to CREATE (new)

| # | File | Purpose | Severity |
|---|------|---------|----------|
| C01 | `src/lib/supabase/partner-earnings.ts` | RPC wrappers for partner commission queries, earnings history, payout requests | High |
| C02 | `src/lib/supabase/partner-activity.ts` | Write helpers for `partner_activity_log` (logEvent, logListingCreated, logBookingReceived, logPayoutReleased) | Medium |
| C03 | `src/types/partner.ts` | Centralized TypeScript types: `PartnerProfile`, `PartnerListing`, `PartnerEarning`, `PartnerActivityLogEntry` | Medium |
| C04 | `src/lib/supabase/partner-listings.ts` | Partner-specific listing CRUD (self-create, edit, delete with proper ownership checks) | Critical |
| C05 | `src/constants/partner.ts` | Constants: `DEFAULT_COMMISSION_RATE = 0.10`, `PARTNER_ACTIVITY_TYPES`, `PARTNER_SUPPORT_TOPICS` | Low |

### 3.2 Files to MODIFY (existing)

| # | File | Change | Severity |
|---|------|--------|----------|
| M01 | `src/pages/PropertyOwnerDashboard.tsx` | Rename file; remove `is_staff` gate from "Add Property"; unify `partner_id`/`owner_id` queries; implement `partner_activity_log` writes | Critical |
| M02 | `src/pages/CreateListing.tsx` | Remove partner-assignment dropdown; change to self-listing form for partners; keep admin approval workflow | Critical |
| M03 | `src/hooks/useAuth.ts` | Remove direct `property_partners` table insert (move to RPC `get_or_create_partner_record`); stop generating unused `partner_code` | Medium |
| M04 | `src/App.tsx` | Update lazy import path after rename; split wallet access into worker vs partner routes | Medium |
| M05 | `src/lib/desktop-nav.tsx` | Rename nav items from "Properties" to "My Listings" for clarity | Low |
| M06 | `src/pages/SecuritySettings.tsx` | Unify listing deletion check to use only `owner_id`; remove `partner_id` OR branch | Medium |
| M07 | `src/lib/supabase/partner-support.ts` | Add `escalateConversation` and `setPriority` RPC wrappers | Low |
| M08 | `src/lib/supabase/workers.ts` | Add `getOrCreateWallet` variant for `property_partner` with distinct transaction types | Medium |
| M09 | `src/lib/supabase/reservations.ts` | Add `partner_id` linkage for hotel reservations; commission attribution to partner on reservation complete | High |
| M10 | `src/lib/supabase/commission-v2.ts` | Add `partner_share` / `whouse_share` / `partner_id` fields to commission calculation | High |
| M11 | `src/lib/supabase/hotels.ts` | Add `partner_id` column to hotel queries; allow partners to see their hotels | High |
| M12 | `src/lib/supabase/listings.ts` | Remove `partner_id` from queries; standardize on `owner_id` | Critical |
| M13 | `src/hooks/useRealtimeUpdates.ts` | Implement partner-specific realtime branches (listing status changes, booking notifications, payout events) | Medium |
| M14 | `src/hooks/useUnreadCounts.ts` | Implement partner unread counts for support messages + activity log | Medium |
| M15 | `src/lib/communication-boundaries.ts` | Expand partner communication targets to include users (for booking inquiries) | Medium |
| M16 | `src/pages/Chat.tsx` | Enable partner↔user chat for booking inquiries | Medium |
| M17 | `src/components/UserProfileModal.tsx` | Display `partner_code` if we keep it; show partner earnings summary | Low |
| M18 | `src/pages/AccountCenter.tsx` | Add partner-specific fields: commission rate, total earnings, partner since date | Low |

### 3.3 Artifacts to DROP / REMOVE

| # | Artifact | Replacement | Severity |
|---|----------|-------------|----------|
| R01 | `listings.partner_id` column | `listings.owner_id` (already exists) | Critical |
| R02 | `properties` table (unified schema) | `listings` table | High |
| R03 | `property_units` table (unified schema) | `listings` (sub_type field) | High |
| R04 | `bookings` table (unified schema) | `reservations` table | High |
| R05 | `property_payouts` table (unified schema) | `wallet_transactions` + `commission_snapshots` | Medium |
| R06 | `property_contracts` table (unified schema) | TBD — likely not needed if listings replace properties | Low |
| R07 | `inspection_requests` table (unified schema) | `partner_support_conversations` with type = 'inspection' | Medium |
| R08 | `rental_agreements` table (unified schema) | `reservations` + contract URL field | Medium |
| R09 | `partner_activity_log` dead write path | `src/lib/supabase/partner-activity.ts` (C02) | Medium |
| R10 | `CreateListing.tsx` partner-assignment dropdown | Self-listing flow (M02) | Medium |
| R11 | `is_staff` gate on partner "Add Property" | Remove gate (M01) | Critical |
| R12 | `property_partners.id` UUID references | `profiles.user_id` (already used) | Medium |

### 3.4 Files Confirmed NO CHANGE NEEDED

| File | Reason |
|------|--------|
| `src/pages/Login.tsx` | Already supports `property_partner` signup correctly |
| `src/pages/Setup.tsx` | Already handles partner setup flow correctly |
| `src/pages/PartnersTab.tsx` | Admin view is correct; only reads `profiles.role` |
| `src/pages/PropertyPartnersList.tsx` | Public directory reads `profiles` correctly |
| `src/pages/AnalyticsPage.tsx` | Partner count query is correct |
| `src/pages/CreatorHome.tsx` | Partner count query is correct |
| `src/pages/Home.tsx` | Partner CTA routing is correct |
| `src/lib/supabase/profile.ts` | `createProfile` RPC delegation is correct |
| `supabase/migrations/20250707_property_partners_table.sql` | Table creation is fine; keep for metadata |
| `supabase/migrations/20260807_partner_signup_compatibility.sql` | Trigger validates correctly |
| `supabase/migrations/20260807_profile_role_data_security.sql` | RLS policies are correct for current schema |
| `supabase/migrations/20260807_worker_workflow_hardening.sql` | `delete_user_account` RPC is correct |

---

## 4. Frontend Files

### 4.1 Discovery Document Reference

All findings below are derived from `PROPERTY_PARTNER_WORKFLOW_DISCOVERY.md` at commit `7621b72c961e6d9b6213430ba0692efd6dba0050`.

### 4.2 File-by-File Analysis

#### `src/pages/PropertyOwnerDashboard.tsx` (M01 — Critical)

**Current state:** Shared component for workers (`property_owner`) and property partners (`property_partner`). 8 tabs implemented. Queries `listings` with `.or(`partner_id.eq.${profile.user_id},owner_id.eq.${profile.user_id}`)`.

**Problems:**
1. File name implies property ownership, confusing the partner role.
2. "Add Property" button gated by `profile.is_staff === true` (line ~TBD in source). Partners cannot self-list.
3. `partner_activity_log` is queried for Recent Activity but never written to.
4. Dual `partner_id`/`owner_id` OR query is fragile.

**Correction:**
- Rename to `PartnerDashboard.tsx`.
- Remove `is_staff` gate; allow all partners to access "Add Property" (which navigates to self-listing flow).
- Replace dual-column OR query with single `owner_id.eq.${profile.user_id}` after `partner_id` data migration.
- Import `logEvent` from new `partner-activity.ts` (C02) and write on: listing create, listing edit, booking received, payout released.

**Impact:** High — touches core partner UX.

---

#### `src/pages/CreateListing.tsx` (M02 — Critical)

**Current state:** Admin/creator listing creation form. Fetches property partners via `supabase.from('profiles').select(...).eq('role', 'property_partner')` and assigns `partner_id` on insert.

**Problems:**
1. Partners cannot self-create listings; all listing creation is admin-driven.
2. Admin assigning `partner_id` is a bottleneck and prone to error.
3. `partner_id` column is redundant with `owner_id`.

**Correction:**
- Split into two modes: **Self-Listing** (partner creates their own listing, `owner_id = profile.user_id`, status = 'pending_approval') and **Admin-Approval** (staff reviews and changes status to 'active').
- Remove partner-assignment dropdown.
- For admin mode: remove `partner_id` field entirely; use `owner_id` only.
- Add `submitted_by_role = 'property_partner'` to track origin.

**Impact:** High — changes listing creation authority model.

---

#### `src/hooks/useAuth.ts` (M03 — Medium)

**Current state:** After `createProfile`, directly inserts into `property_partners` table with generated `partner_code`.

**Problems:**
1. Direct table insert bypasses `get_or_create_partner_record` RPC.
2. `partner_code` is generated but never used.
3. If RPC already creates the partner record, this insert may race or duplicate.

**Correction:**
- Remove the `supabase.from('property_partners').insert(...)` block.
- Rely on `get_or_create_partner_record` (defined in `20260807_profile_role_data_security.sql`) which is already present.
- Remove `partner_code` generation from frontend; either generate in backend trigger or drop the field.

**Impact:** Medium — cleanup, reduces frontend responsibility.

---

#### `src/App.tsx` (M04 — Medium)

**Current state:** Lazy imports `PropertyPartnerDashboard` from `@/pages/PropertyOwnerDashboard`. Wallet access gated with `profile.role !== 'worker' && profile.role !== 'property_partner'`.

**Problems:**
1. Import path will break after rename.
2. Worker and partner wallets share the same gate but should have separate transaction type filtering.

**Correction:**
- Update lazy import: `const PartnerDashboard = lazy(() => import('@/pages/PartnerDashboard'));`
- Split wallet access: `const canAccessWallet = profile.role === 'worker' || profile.role === 'property_partner';` (keep gate) but add `walletType` prop to `WalletTab`.
- Add `walletOwnerType` prop to distinguish `'worker'` vs `'property_partner'` for `getOrCreateWallet`.

**Impact:** Medium — routing change.

---

#### `src/lib/desktop-nav.tsx` (M05 — Low)

**Current state:** Partner nav label is "Properties".

**Correction:** Change to "My Listings" to align with `listings`-centric schema.

**Impact:** Low — UX clarity only.

---

#### `src/pages/SecuritySettings.tsx` (M06 — Medium)

**Current state:** Account deletion blocked if ANY `listings` row matches `partner_id` OR `owner_id`.

**Problems:**
1. Dual-column check is redundant after `partner_id` → `owner_id` migration.
2. No check for `hotels` ownership.

**Correction:**
- After R01 (drop `partner_id`), simplify to `.eq('owner_id', profile.user_id)`.
- Add hotel ownership check: `supabase.from('hotels').select('*', { count: 'exact', head: true }).eq('owner_id', profile.user_id)`.
- Update UI message to include hotels if applicable.

**Impact:** Medium — prevents partner deletion with active assets.

---

#### `src/lib/supabase/partner-support.ts` (M07 — Low)

**Current state:** 7 RPC wrappers for support conversations. No escalation or priority.

**Correction:**
- Add `escalateConversation(conversationId, reason)` → calls new RPC or updates `priority` column.
- Add `setConversationPriority(conversationId, priority)` where `priority ∈ ['low', 'normal', 'high', 'urgent']`.

**Impact:** Low — support UX improvement.

---

#### `src/lib/supabase/workers.ts` (M08 — Medium)

**Current state:** `getOrCreateWallet(profile.user_id, 'property_partner')` returns generic wallet.

**Problems:**
1. No distinction between worker earnings (service fees) and partner earnings (rental commissions).
2. `requestPartnerWithdrawal` is a thin wrapper around `requestWorkerWithdrawal`.

**Correction:**
- Add `getPartnerWallet(userId)` that returns wallet with `owner_type = 'property_partner'`.
- Add `requestPartnerWithdrawal` with distinct `withdrawal_type = 'partner_payout'`.
- Add `getPartnerTransactions` filtering by `transaction_type IN ('partner_commission', 'partner_payout', 'partner_bonus')`.

**Impact:** Medium — financial tracking accuracy.

---

#### `src/lib/supabase/reservations.ts` (M09 — High)

**Current state:** Creates `reservations` for listings. No `partner_id` linkage. Commission is worker-only.

**Problems:**
1. When a partner-owned listing is booked, no commission is attributed to the partner.
2. `createReservation` does not look up `owner_id` on `listings` to set `partner_id` on the reservation.

**Correction:**
- In `createReservation`, after fetching the listing, read `listing.owner_id`.
- Store `partner_id = listing.owner_id` on the `reservations` row (requires schema change — add `partner_id` to `reservations`).
- Trigger commission calculation that includes `partner_share`.

**Impact:** High — core revenue flow.

---

#### `src/lib/supabase/commission-v2.ts` (M10 — High)

**Current state:** `calculateCommission` returns `{ workerShare, whouseShare }`. No partner fields.

**Problems:**
1. Property partners are a third party in the transaction.
2. No `partner_id` on `commission_snapshots`.

**Correction:**
- Add `partner_id?: string` to `CommissionParams`.
- In `calculateCommission`, if `partner_id` is present, calculate `partnerShare = grossAmount * (1 - whouseRate)`.
- Store `partner_share` and `partner_id` in `commission_snapshots`.
- Add `getPartnerCommissions(partnerId)` query function.

**Impact:** High — enables partner earnings tracking.

---

#### `src/lib/supabase/hotels.ts` (M11 — High)

**Current state:** Hotels have `owner_id` but no `partner_id`. Partners who own hotels cannot manage them.

**Correction:**
- Add `partner_id` column to `hotels` table (references `profiles.user_id`).
- Update `getHotelsByOwner` to accept either `owner_id` or `partner_id`.
- Add `getHotelsByPartner(partnerId)` wrapper.
- Update hotel creation flow to set `partner_id` when a partner creates a hotel.

**Impact:** High — partner hotel ownership.

---

#### `src/lib/supabase/listings.ts` (M12 — Critical)

**Current state:** `getListings` and `getListingById` do not filter by partner. `CreateListingParams` includes `partner_id`.

**Correction:**
- Remove `partner_id` from `CreateListingParams`.
- Standardize all queries on `owner_id`.
- Add `getListingsByPartner(partnerId)` that simply calls `getListingsByOwner(partnerId)`.

**Impact:** Critical — schema alignment.

---

#### `src/hooks/useRealtimeUpdates.ts` (M13 — Medium)

**Current state:** `property_partner` branch exists but is a placeholder comment.

**Correction:**
- Implement partner-specific channels:
  - `listings:owner_id=eq.${userId}` → listing status changes
  - `reservations:partner_id=eq.${userId}` → new bookings on partner listings
  - `wallet_transactions:user_id=eq.${userId}` → payout received
  - `partner_support_conversations:partner_id=eq.${userId}` → new support message

**Impact:** Medium — realtime UX for partners.

---

#### `src/hooks/useUnreadCounts.ts` (M14 — Medium)

**Current state:** `property_partner` branch is a placeholder.

**Correction:**
- Query `partner_support_conversations` for `unread_count`.
- Query `partner_activity_log` for `unread_count`.
- Sum both for total partner unread badge.

**Impact:** Medium — notification accuracy.

---

#### `src/lib/communication-boundaries.ts` (M15 — Medium)

**Current state:** `property_partner: ['creator', 'admin', 'staff', 'support']`.

**Problems:**
1. Partners cannot communicate with users who want to book their properties.
2. Partners cannot communicate with workers who service their properties.

**Correction:**
- Expand to: `property_partner: ['user', 'worker', 'creator', 'admin', 'staff', 'support']`.
- Update `normalizeRoleForBackend` to handle partner↔user and partner↔worker conversations.

**Impact:** Medium — enables booking inquiry chat.

---

#### `src/pages/Chat.tsx` (M16 — Medium)

**Current state:** Partner role is detected but conversation creation may be blocked by `communication-boundaries.ts`.

**Correction:**
- Ensure `Chat.tsx` allows partner-initiated conversations with users.
- Add system message template for booking inquiries: "Hi, I'm interested in your property [listing title]."

**Impact:** Medium — partner sales channel.

---

#### `src/components/UserProfileModal.tsx` (M17 — Low)

**Current state:** Shows partner badge. No earnings or partner code.

**Correction:**
- If `role === 'property_partner'`, show:
  - Partner since date
  - Total listings count
  - Total earnings (from `partner-earnings.ts`)
  - `partner_code` (if we keep it)

**Impact:** Low — profile enrichment.

---

#### `src/pages/AccountCenter.tsx` (M18 — Low)

**Current state:** Shows generic role label.

**Correction:**
- Add partner-specific section: Commission Rate, Total Earnings, Withdrawal History.
- Link to Partner Dashboard.

**Impact:** Low — account page completeness.

---

## 5. Backend Files

### 5.1 SQL Migrations to Plan (NOT to execute in this commit)

The following migrations must be **designed** in a follow-up PR. This plan document only specifies what they must contain.

#### Migration: `20260810_drop_listings_partner_id.sql` (R01)

**Purpose:** Remove redundant `partner_id` column from `listings`.

**Steps:**
1. Verify `partner_id` and `owner_id` are always equal for existing rows (data validation).
2. If mismatched, update `owner_id = partner_id` where `partner_id IS NOT NULL`.
3. `ALTER TABLE listings DROP COLUMN partner_id;`
4. `DROP INDEX IF EXISTS idx_listings_partner_id;`
5. Update RLS policies that reference `partner_id`.

**Rollback:** Column can be re-added if needed.

---

#### Migration: `20260810_add_reservations_partner_id.sql` (M09 follow-up)

**Purpose:** Link reservations to property partners for commission attribution.

**Steps:**
1. `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS partner_id TEXT REFERENCES profiles(user_id);`
2. Backfill `partner_id` from `listings.owner_id` via `reservations.listing_id`.
3. Create index `idx_reservations_partner_id`.
4. Add RLS policy for partner read access.

---

#### Migration: `20260810_add_hotels_partner_id.sql` (M11 follow-up)

**Purpose:** Allow hotel ownership by property partners.

**Steps:**
1. `ALTER TABLE hotels ADD COLUMN IF NOT EXISTS partner_id TEXT REFERENCES profiles(user_id);`
2. Backfill from `hotels.owner_id` where owner is a property_partner.
3. Create index `idx_hotels_partner_id`.
4. Update RLS policies.

---

#### Migration: `20260810_partner_commission_schema.sql` (M10 follow-up)

**Purpose:** Enable partner share tracking in commission system.

**Steps:**
1. `ALTER TABLE commission_snapshots ADD COLUMN IF NOT EXISTS partner_id TEXT;`
2. `ALTER TABLE commission_snapshots ADD COLUMN IF NOT EXISTS partner_share DECIMAL(12,2) DEFAULT 0;`
3. `ALTER TABLE commission_snapshots ADD COLUMN IF NOT EXISTS partner_paid BOOLEAN DEFAULT FALSE;`
4. Create index on `partner_id`.
5. Update `calculate_commission` RPC to compute `partner_share`.

---

#### Migration: `20260810_partner_activity_log_trigger.sql` (M01/M08 follow-up)

**Purpose:** Auto-populate `partner_activity_log` on key events.

**Steps:**
1. Create trigger `log_listing_created` → insert into `partner_activity_log` on `listings` INSERT.
2. Create trigger `log_booking_received` → insert on `reservations` INSERT where `partner_id IS NOT NULL`.
3. Create trigger `log_payout_released` → insert on `wallet_transactions` INSERT where `type = 'partner_payout'`.

---

#### Migration: `20260810_deprecate_unified_property_schema.sql` (R02–R08)

**Purpose:** Mark legacy tables as deprecated.

**Steps:**
1. Add comments: `COMMENT ON TABLE properties IS 'DEPRECATED: Use listings table';`
2. Repeat for `property_units`, `bookings` (unified), `property_payouts`, `property_contracts`, `inspection_requests`, `rental_agreements`.
3. Do NOT drop tables yet — data audit required first.
4. Archive data to `legacy_properties_backup` schema if needed.

---

## 6. Section-by-Section Correction Plan

### 6.1 Signup & Onboarding (Phase A)

**Goal:** Fix partner account creation to be clean and idempotent.

| # | Change | File | Action |
|---|--------|------|--------|
| A1 | Remove direct `property_partners` insert | `src/hooks/useAuth.ts` | Delete the `if (chosenRole === 'property_partner')` block that inserts into `property_partners`. Rely on `get_or_create_partner_record` RPC. |
| A2 | Stop generating `partner_code` | `src/hooks/useAuth.ts` | Remove `partner_code: WH-${Date.now()}` from insert. Either generate in backend or drop column. |
| A3 | Add partner type tracking | `src/types/partner.ts` (C03) | Define `type PartnerType = 'individual' | 'company' | 'estate_agent'` for future use. |

**Success criteria:** Partner signup creates exactly one `profiles` row and one `property_partners` row (via RPC), with no frontend-side race conditions.

---

### 6.2 Dashboard & Navigation (Phase B)

**Goal:** Clarify partner UX and remove artificial gates.

| # | Change | File | Action |
|---|--------|------|--------|
| B1 | Rename dashboard component | `src/pages/PropertyOwnerDashboard.tsx` → `PartnerDashboard.tsx` | Rename file and all imports. Update `src/App.tsx` lazy import. |
| B2 | Remove `is_staff` gate | `PartnerDashboard.tsx` | Delete `profile.is_staff === true` check on "Add Property" button. |
| B3 | Rename nav label | `src/lib/desktop-nav.tsx` | Change "Properties" → "My Listings". |
| B4 | Add activity log writes | `PartnerDashboard.tsx` | Import `logEvent` from `partner-activity.ts`. Call on tab switch, listing create, payout view. |
| B5 | Implement realtime | `src/hooks/useRealtimeUpdates.ts` | Add channel subscriptions for partner-specific events. |
| B6 | Implement unread counts | `src/hooks/useUnreadCounts.ts` | Query `partner_support_conversations` + `partner_activity_log`. |

**Success criteria:** Partner sees "My Listings" nav, can click "Add Property", and receives realtime notifications.

---

### 6.3 Listings & Properties (Phase C)

**Goal:** Unify schema, enable self-listing, remove dual-column confusion.

| # | Change | File | Action |
|---|--------|------|--------|
| C1 | Remove `partner_id` from queries | `src/lib/supabase/listings.ts` | Replace all `partner_id` references with `owner_id`. |
| C2 | Remove partner assignment | `src/pages/CreateListing.tsx` | Remove dropdown that fetches property partners. |
| C3 | Enable self-listing | `src/pages/CreateListing.tsx` | If caller is `property_partner`, set `owner_id = profile.user_id`, `submitted_by_role = 'property_partner'`, `status = 'pending_approval'`. |
| C4 | Add partner listing CRUD | `src/lib/supabase/partner-listings.ts` (C04) | `createPartnerListing`, `updatePartnerListing`, `deletePartnerListing` with ownership checks. |
| C5 | Drop `partner_id` column | Migration (R01) | After data validation, drop column. |
| C6 | Deprecate unified schema | Migration (R02–R08) | Add deprecation comments. Archive data. |

**Success criteria:** Partner creates listing → `owner_id` set → status 'pending_approval' → admin approves → listing goes live.

---

### 6.4 Hotels & Extended Stay (Phase D)

**Goal:** Link hotels to property partners for commission attribution.

| # | Change | File | Action |
|---|--------|------|--------|
| D1 | Add `partner_id` to hotels | `src/lib/supabase/hotels.ts` + Migration | Query and set `partner_id` alongside `owner_id`. |
| D2 | Partner hotel management | `PartnerDashboard.tsx` | Add "My Hotels" sub-tab or extend "My Listings" to include hotels. |
| D3 | Hotel reservation partner link | `src/lib/supabase/reservations.ts` | Store `partner_id` on reservation when booking a partner's hotel. |

**Success criteria:** Partner-owned hotel bookings correctly attribute revenue to the partner.

---

### 6.5 Financial & Commission (Phase E)

**Goal:** Track partner earnings, enable payouts, split from worker financials.

| # | Change | File | Action |
|---|--------|------|--------|
| E1 | Add partner share to commission | `src/lib/supabase/commission-v2.ts` + Migration | `partner_share` field, `partner_id` on `commission_snapshots`. |
| E2 | Partner earnings queries | `src/lib/supabase/partner-earnings.ts` (C01) | `getPartnerEarnings`, `getPartnerPayoutHistory`, `requestPartnerPayout`. |
| E3 | Split wallet types | `src/lib/supabase/workers.ts` | `getPartnerWallet`, `requestPartnerWithdrawal` with distinct types. |
| E4 | Earnings tab data | `PartnerDashboard.tsx` | Wire Earnings tab to `partner-earnings.ts`. |
| E5 | Account center earnings | `src/pages/AccountCenter.tsx` | Show lifetime earnings, pending payouts. |

**Success criteria:** Partner sees accurate earnings from both short-stay (`listings`) and extended-stay (`hotels`) bookings.

---

### 6.6 Account Deletion (Phase F)

**Goal:** Correctly block deletion when partner has active assets.

| # | Change | File | Action |
|---|--------|------|--------|
| F1 | Unify listing check | `src/pages/SecuritySettings.tsx` | Use `owner_id` only after R01. |
| F2 | Add hotel check | `src/pages/SecuritySettings.tsx` | Query `hotels` table for `owner_id = profile.user_id`. |
| F3 | Update RPC | `delete_user_account` | Check `hotels` ownership in addition to `listings`. |

**Success criteria:** Partner with active listings OR hotels cannot self-delete.

---

### 6.7 Support & Communication (Phase G)

**Goal:** Enable partner↔user chat and ticket escalation.

| # | Change | File | Action |
|---|--------|------|--------|
| G1 | Expand communication boundaries | `src/lib/communication-boundaries.ts` | Add `'user'` and `'worker'` to partner targets. |
| G2 | Enable partner↔user chat | `src/pages/Chat.tsx` | Allow partner to initiate chat with users for booking inquiries. |
| G3 | Add escalation | `src/lib/supabase/partner-support.ts` | `escalateConversation` wrapper. |
| G4 | Add priority | `src/lib/supabase/partner-support.ts` | `setConversationPriority` wrapper. |

**Success criteria:** Partner can message users about bookings; can escalate support tickets.

---

### 6.8 Profile & Settings (Phase H)

**Goal:** Enrich partner profile with business-relevant data.

| # | Change | File | Action |
|---|--------|------|--------|
| H1 | Partner profile modal | `src/components/UserProfileModal.tsx` | Show partner since, listing count, earnings. |
| H2 | Account center | `src/pages/AccountCenter.tsx` | Partner-specific fields. |
| H3 | Settings tab | `PartnerDashboard.tsx` | Add commission rate display (read-only for partner, editable by admin). |

**Success criteria:** Partner profile shows actionable business metrics.

---

## 7. Dependencies and Sequencing

### 7.1 Phase Order

```
Phase A: Signup & Onboarding
    │
    ▼
Phase B: Dashboard & Navigation
    │
    ▼
Phase C: Listings & Properties  ←──┐
    │                              │
    ▼                              │
Phase D: Hotels & Extended Stay ───┤ (C and D can be parallel after B)
    │                              │
    ▼                              │
Phase E: Financial & Commission  ←┘ (E depends on C and D)
    │
    ▼
Phase F: Account Deletion
    │
    ▼
Phase G: Support & Communication
    │
    ▼
Phase H: Profile & Settings
```

### 7.2 Change Dependencies

| Change | Depends On | Blocks |
|--------|-----------|--------|
| R01 (drop `partner_id`) | M12 (remove from queries) | M06 (simplify deletion check) |
| M02 (self-listing) | B2 (remove `is_staff` gate) | C3 (partner listing CRUD) |
| M09 (reservation `partner_id`) | R01 (unify owner) | E1 (partner commission) |
| M11 (hotel `partner_id`) | — | D3 (hotel reservation link) |
| E1 (partner commission) | M09, M11 | E2 (earnings queries) |
| M13 (realtime) | M08 (activity log writes) | — |

### 7.3 Frontend vs Backend Sequencing

| Step | Frontend | Backend (SQL) | Coordination |
|------|----------|---------------|--------------|
| 1 | M03 (remove direct insert) | Verify `get_or_create_partner_record` RPC | Ensure RPC creates record before frontend stops inserting |
| 2 | M12 (unify queries) | R01 (drop `partner_id` column) | Frontend must stop using column before SQL drops it |
| 3 | M02 (self-listing) | — | Pure frontend change |
| 4 | M09, M11 (reservation/hotel partner_id) | Add columns to `reservations`, `hotels` | SQL must add columns before frontend writes to them |
| 5 | E1 (commission calc) | Add `partner_share` to `commission_snapshots` | SQL schema change before frontend calculation |
| 6 | E2 (earnings queries) | Backfill `partner_id` on `reservations` | Data backfill before earnings queries return correct results |

---

## 8. Testing Strategy

### 8.1 Unit Tests (to add in implementation phase)

| Module | Test Cases |
|--------|-----------|
| `partner-listings.ts` | Create listing sets `owner_id` correctly; edit rejects non-owner; delete rejects non-owner |
| `partner-earnings.ts` | Calculate commission with partner share; payout request validates balance |
| `partner-activity.ts` | Log event writes correct `partner_id`, `type`, `metadata` JSON |
| `useAuth.ts` | Signup as partner does NOT call `supabase.from('property_partners').insert` |

### 8.2 Integration Tests

| Flow | Steps |
|------|-------|
| Partner self-listing | Signup → Setup → Dashboard → Add Property → Submit → Admin approves → Listing live |
| Partner hotel booking | User books partner hotel → Reservation created with `partner_id` → Commission snapshot has `partner_share` → Partner sees earnings |
| Partner deletion blocked | Partner with listing tries to delete → Blocked with message → Partner deletes listing → Deletion succeeds |
| Partner support escalation | Partner creates ticket → Staff responds → Partner escalates → Director sees escalated ticket |

### 8.3 Regression Tests

| Area | Check |
|------|-------|
| Worker dashboard | Worker (`property_owner`) still sees same dashboard after rename to `PartnerDashboard` |
| Admin listing creation | Admin can still create listings and assign `owner_id` |
| User signup | User signup is unaffected by partner signup changes |
| Wallet | Worker wallet transactions are unaffected by partner wallet split |

---

## 9. File Path Index

### 9.1 Frontend Files (React/TypeScript)

| Path | Status | Section |
|------|--------|---------|
| `src/pages/PropertyOwnerDashboard.tsx` → `PartnerDashboard.tsx` | M01 (rename + modify) | B, C, E, H |
| `src/pages/CreateListing.tsx` | M02 | C |
| `src/hooks/useAuth.ts` | M03 | A |
| `src/App.tsx` | M04 | B |
| `src/lib/desktop-nav.tsx` | M05 | B |
| `src/pages/SecuritySettings.tsx` | M06 | F |
| `src/lib/supabase/partner-support.ts` | M07 | G |
| `src/lib/supabase/workers.ts` | M08 | E |
| `src/lib/supabase/reservations.ts` | M09 | D, E |
| `src/lib/supabase/commission-v2.ts` | M10 | E |
| `src/lib/supabase/hotels.ts` | M11 | D |
| `src/lib/supabase/listings.ts` | M12 | C |
| `src/hooks/useRealtimeUpdates.ts` | M13 | B |
| `src/hooks/useUnreadCounts.ts` | M14 | B |
| `src/lib/communication-boundaries.ts` | M15 | G |
| `src/pages/Chat.tsx` | M16 | G |
| `src/components/UserProfileModal.tsx` | M17 | H |
| `src/pages/AccountCenter.tsx` | M18 | H |
| `src/lib/supabase/partner-earnings.ts` | C01 (new) | E |
| `src/lib/supabase/partner-activity.ts` | C02 (new) | B, C |
| `src/types/partner.ts` | C03 (new) | A–H |
| `src/lib/supabase/partner-listings.ts` | C04 (new) | C |
| `src/constants/partner.ts` | C05 (new) | A–H |

### 9.2 Backend Files (SQL Migrations — to design in follow-up)

| Path | Status | Section |
|------|--------|---------|
| `supabase/migrations/20260810_drop_listings_partner_id.sql` | R01 | C |
| `supabase/migrations/20260810_add_reservations_partner_id.sql` | M09 follow-up | D, E |
| `supabase/migrations/20260810_add_hotels_partner_id.sql` | M11 follow-up | D |
| `supabase/migrations/20260810_partner_commission_schema.sql` | M10 follow-up | E |
| `supabase/migrations/20260810_partner_activity_log_trigger.sql` | M01/M08 follow-up | B |
| `supabase/migrations/20260810_deprecate_unified_property_schema.sql` | R02–R08 | C |

### 9.3 Unchanged Files (Confirmed)

| Path | Reason |
|------|--------|
| `src/pages/Login.tsx` | Already correct |
| `src/pages/Setup.tsx` | Already correct |
| `src/pages/PartnersTab.tsx` | Admin view correct |
| `src/pages/PropertyPartnersList.tsx` | Public directory correct |
| `src/pages/AnalyticsPage.tsx` | Count query correct |
| `src/pages/CreatorHome.tsx` | Count query correct |
| `src/pages/Home.tsx` | CTA routing correct |
| `src/lib/supabase/profile.ts` | RPC delegation correct |
| `supabase/migrations/20250707_property_partners_table.sql` | Table creation correct |
| `supabase/migrations/20260807_partner_signup_compatibility.sql` | Trigger correct |
| `supabase/migrations/20260807_profile_role_data_security.sql` | RLS correct |
| `supabase/migrations/20260807_worker_workflow_hardening.sql` | Delete RPC correct |

---

## 10. Glossary

| Term | Definition |
|------|------------|
| **Property Partner** | A user role (`property_partner`) who owns properties or hotels listed on WeHouse. Earns commission from bookings. Cannot be a worker simultaneously. |
| **Worker** | A user role (`worker`) who provides services (cleaning, repairs, etc.) and earns service fees. Uses the same dashboard component as partners historically. |
| **Unified Property Schema** | Legacy set of tables (`properties`, `property_units`, `bookings`, `property_payouts`, `property_contracts`, `inspection_requests`, `rental_agreements`) defined in `20250703_unified_property_system.sql`. Superseded by `listings` + `reservations`. |
| **Live Schema** | The actively used tables: `profiles`, `listings`, `reservations`, `hotels`, `wallets`, `wallet_transactions`, `commission_snapshots`, `partner_support_conversations`. |
| **`partner_id` (listings)** | Redundant column on `listings` referencing `profiles.user_id`. To be dropped in favor of `owner_id`. |
| **`owner_id`** | Canonical column on `listings` and `hotels` referencing `profiles.user_id`. Identifies who owns the asset. |
| **`property_partners.id`** | UUID primary key of `property_partners` table. Referenced by legacy `properties.partner_id` but unused by live frontend. |
| **`property_partners.profile_id`** | TEXT column referencing `profiles.user_id`. The live frontend uses this indirectly via `owner_id` on listings. |
| **`partner_code`** | Generated string (`WH-${timestamp}`) stored in `property_partners`. Currently unused. Candidate for referral code or removal. |
| **`partner_activity_log`** | Table queried for Recent Activity on partner dashboard. Currently has no write path from frontend or trigger. |
| **`is_staff`** | Boolean flag on `profiles`. Currently gates "Add Property" button on partner dashboard. Likely a copy-paste error from admin UI. |
| **Self-Listing** | Partner creates their own listing (status = 'pending_approval') rather than admin creating and assigning it. |
| **Partner Share** | The portion of a booking's gross amount that belongs to the property partner after WeHouse commission deduction. |
| **WeHouse Share** | The commission WeHouse retains from a booking (default 10%). |
| **RLS** | Row Level Security — PostgreSQL policies that restrict data access per user. |
| **RPC** | Remote Procedure Call — Supabase PostgreSQL functions callable from the frontend. |

---

*End of Correction Plan.*
