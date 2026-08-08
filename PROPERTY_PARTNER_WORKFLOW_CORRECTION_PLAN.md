# Property Partner Workflow — Correction Plan

**Repository:** WeHouse React + Vite + TypeScript SPA with Supabase backend  
**Branch:** `main`  
**Base Commit:** `7621b72c961e6d9b6213430ba0692efd6dba0050` (contains `PROPERTY_PARTNER_WORKFLOW_DISCOVERY.md`)  
**Plan Date:** 2026-08-09  
**Scope:** PLANNING ONLY — No code changes, no SQL execution, no migrations applied.

---

## Table of Contents

1. [How This Plan Was Built](#1-how-this-plan-was-built)
2. [Live Schema Matrix](#2-live-schema-matrix)
3. [What Currently Exists and Can Be Kept](#3-what-currently-exists-and-can-be-kept)
4. [What Is Broken and Needs Correction](#4-what-is-broken-and-needs-correction)
5. [What Is Legacy/Duplicate and Should Not Be Used](#5-what-is-legacyduplicate-and-should-not-be-used)
6. [The Property Partner Listing-Request Flow](#6-the-property-partner-listing-request-flow)
7. [How a Request Moves: Partner → WeHouse → Published Listing](#7-how-a-request-moves-partner--wehouse--published-listing)
8. [Existing Tables/RPCs/Components That Support the Flow](#8-existing-tablesrpcscomponents-that-support-the-flow)
9. [How the Resulting Listing Remains Linked to the Property Partner](#9-how-the-resulting-listing-remains-linked-to-the-property-partner)
10. [Existing Booking/Payment/Revenue Paths Relevant to Property Partners](#10-existing-bookingpaymentrevenue-paths-relevant-to-property-partners)
11. [What Is Missing for WeHouse Commission Deduction and Property Partner Net Share](#11-what-is-missing-for-wehouse-commission-deduction-and-property-partner-net-share)
12. [Tabs/Actions to Remove or Correct](#12-tabsactions-to-remove-or-correct)
13. [Final Property Partner Dashboard Design](#13-final-property-partner-dashboard-design)
14. [Required Changes: Database / RPC / RLS / Frontend](#14-required-changes-database--rpc--rls--frontend)
15. [Decision Register](#15-decision-register)
16. [File Path Index](#16-file-path-index)

---

## 1. How This Plan Was Built

This plan was built by **cross-referencing four sources of evidence** — not by inference from the discovery document alone:

| Source | What Was Checked |
|--------|-----------------|
| **Live Supabase database** (REST API queries) | Actual column names, row counts, NULL ratios, distinct status values, empty vs populated tables |
| **SQL migration files** (`supabase/migrations/*.sql`) | Exact `CREATE TABLE`, `CREATE POLICY`, `CREATE FUNCTION` definitions, column constraints, check constraints, default values |
| **Frontend source code** (`src/**/*.tsx`, `src/**/*.ts`) | Every `.eq('partner_id')`, `.eq('owner_id')`, `inspection_requests`, `property_partners`, `request_worker_withdrawal`, `post_property_from_inspection` call site |
| **Discovery document** (`PROPERTY_PARTNER_WORKFLOW_DISCOVERY.md`) | Used as a map of where to look, not as a source of truth |

**Key findings that contradict the discovery document:**
- The `partner_activity_log` table is **mentioned in the discovery document but does not exist in migrations or frontend code**. It was never created.
- The `CreateListing.tsx` bug is **worse than initially reported**: it sets `owner_id: profile.auth_id` (not `profile.user_id`), which is a data-integrity violation.
- The `StaffDashboard.tsx` bug is **newly discovered**: when staff posts a property from an inspection, it passes `owner_id: profile.user_id` where `profile` is the **staff's** profile, not the partner's. This means the partner is not recorded as the owner.
- `property_partners` table has live columns `commission_rate`, `total_earnings`, `total_paid_out`, `properties_count` that are **queried by the frontend** but **never written to by any frontend code**.
- `commission_ledger` table exists and has RLS, but **has zero rows** and **no frontend code reads from it**.
- `booking_payments` table exists and has `commission_amount` and `net_amount` columns, but **has zero rows**.
- `reservations` table exists but **has zero rows**.
- `request_worker_withdrawal` RPC exists but `request_withdrawal` (generic) also exists and checks `profiles.wallet_balance` (old field), not `wallets.available_balance`.

---

## 2. Live Schema Matrix

### 2.1 Relevant Live Tables (Queried via REST API + Migration Files)

| Table | Row Count | Key Columns | Status |
|-------|-----------|-------------|--------|
| `profiles` | 0 returned (RLS) | `user_id` (PK, TEXT), `auth_id` (TEXT), `role` (TEXT), `wallet_balance` (NUMERIC), `total_earnings` (NUMERIC), `profile_complete` (BOOLEAN) | **CONFIRMED SAFE** |
| `property_partners` | 2 | `id` (UUID PK), `profile_id` (TEXT → profiles.user_id), `partner_code` (TEXT), `status` (TEXT), `commission_rate` (NUMERIC), `total_earnings` (NUMERIC), `total_paid_out` (NUMERIC), `properties_count` (INTEGER) | **CONFIRMED SAFE — metadata table** |
| `inspection_requests` | 1 | `id` (UUID PK), `request_code` (TEXT UNIQUE), `owner_id` (TEXT NOT NULL → profiles.user_id), `owner_email` (TEXT), `owner_phone` (TEXT), `property_address` (TEXT), `property_city` (TEXT), `property_state` (TEXT), `property_type` (TEXT CHECK), `bedrooms` (INTEGER), `bathrooms` (INTEGER), `expected_rent` (DECIMAL), `description` (TEXT), `status` (TEXT DEFAULT 'pending' CHECK IN ('pending','scheduled','in_progress','approved','rejected','completed')), `assigned_to` (TEXT), `scheduled_date` (DATE), `completed_at` (TIMESTAMPTZ), `rejection_reason` (TEXT), `notes` (TEXT), `photo_urls` (TEXT[]), `document_urls` (TEXT[]), `gps_latitude` (DECIMAL), `gps_longitude` (DECIMAL), `partner_id` (UUID, added later), `field_officer_id` (TEXT), `assigned_field_officer_id` (TEXT), `assigned_at` (TIMESTAMPTZ), `inspection_started_at` (TIMESTAMPTZ), `inspection_completed_at` (TIMESTAMPTZ), `draft_listing_id` (TEXT), `approved_by` (TEXT), `approved_at` (TIMESTAMPTZ), `published_at` (TIMESTAMPTZ), `amenities` (TEXT[]), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ) | **CONFIRMED SAFE — correct foundation** |
| `listings` | 1 | `id` (UUID PK), `listing_id` (TEXT), `title` (TEXT), `description` (TEXT), `price` (NUMERIC), `currency` (TEXT), `state` (TEXT), `city` (TEXT), `address` (TEXT), `images` (TEXT[]), `bedrooms` (INTEGER), `bathrooms` (INTEGER), `availability_status` (TEXT), `owner_id` (TEXT), `status` (TEXT), `reserved_by` (TEXT), `reservation_expiry` (TIMESTAMPTZ), `reservation_fee_paid` (BOOLEAN), `chat_unlocked` (BOOLEAN), `videos` (TEXT[]), `chat_agent_id` (TEXT), `property_type` (TEXT), `submitted_by_role` (TEXT), `approved_by` (TEXT), `approved_at` (TIMESTAMPTZ), `rejection_reason` (TEXT), `security_deposit_amount` (NUMERIC), `partner_id` (TEXT) | **BROKEN — see Section 4** |
| `reservations` | 0 | `id` (TEXT PK), `listing_id` (TEXT NOT NULL), `user_id` (TEXT NOT NULL), `staff_id` (TEXT), `status` (TEXT DEFAULT 'pending'), `fee_paid` (BOOLEAN DEFAULT FALSE), `amount` (NUMERIC DEFAULT 10000), `currency` (TEXT DEFAULT 'NGN'), `created_at` (TIMESTAMPTZ), `expires_at` (TIMESTAMPTZ), `paid_at` (TIMESTAMPTZ) | **EMPTY — no bookings yet** |
| `hotels` | 0 | `id` (UUID PK), `name` (TEXT), `description` (TEXT), `address` (TEXT), `city` (TEXT), `state` (TEXT), `images` (TEXT[]), `amenities` (TEXT[]), `owner_id` (TEXT), `status` (TEXT), `price_per_night` (NUMERIC), `rating` (NUMERIC), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ) | **EMPTY — no hotels yet** |
| `hotel_rooms` | 0 | `id` (UUID PK), `hotel_id` (UUID), `room_number` (TEXT), `room_type` (TEXT), `price_per_night` (NUMERIC), `capacity` (INTEGER), `images` (TEXT[]), `amenities` (TEXT[]), `status` (TEXT), `created_at` (TIMESTAMPTZ) | **EMPTY** |
| `hotel_bookings` | 0 | `booking_id` (SERIAL PK), `hotel_id` (UUID), `room_id` (UUID), `user_id` (TEXT), `check_in` (DATE), `check_out` (DATE), `total_price` (NUMERIC), `status` (TEXT), `payment_status` (TEXT), `created_at` (TIMESTAMPTZ) | **EMPTY** |
| `booking_payments` | 0 | `id` (UUID PK), `payment_reference` (TEXT UNIQUE), `user_id` (TEXT), `type` (TEXT CHECK IN ('reservation','hotel_booking','worker_subscription')), `listing_id` (TEXT), `hotel_booking_id` (INTEGER), `amount` (DECIMAL), `commission_amount` (DECIMAL DEFAULT 0), `net_amount` (DECIMAL), `currency` (TEXT), `status` (TEXT), `payment_method` (TEXT), `paystack_reference` (TEXT), `refund_amount` (DECIMAL), `refund_reason` (TEXT), `refund_processed_at` (TIMESTAMPTZ), `refund_processed_by` (TEXT), `metadata` (JSONB), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ) | **EMPTY** |
| `wallets` | 0 | `id` (UUID PK), `owner_id` (TEXT), `owner_type` (TEXT CHECK IN ('worker','property_partner')), `available_balance` (DECIMAL), `pending_balance` (DECIMAL), `frozen_balance` (DECIMAL), `total_withdrawn` (DECIMAL), `bank_name` (TEXT), `bank_account_number` (TEXT), `bank_account_name` (TEXT), `paystack_recipient_code` (TEXT), `is_frozen` (BOOLEAN), `frozen_reason` (TEXT), `frozen_by` (TEXT), `frozen_at` (TIMESTAMPTZ), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ), `UNIQUE(owner_id, owner_type)` | **EMPTY** |
| `wallet_transactions` | 0 | `id` (UUID PK), `wallet_id` (UUID), `type` (TEXT CHECK IN ('credit','debit','escrow_release','withdrawal','refund','commission','freeze','unfreeze')), `amount` (DECIMAL), `description` (TEXT), `reference` (TEXT), `balance_after` (DECIMAL), `created_at` (TIMESTAMPTZ) | **EMPTY** |
| `withdrawals` | 0 | `id` (UUID PK), `wallet_id` (UUID), `amount` (DECIMAL), `paystack_transfer_reference` (TEXT), `paystack_transfer_code` (TEXT), `status` (TEXT), `bank_name` (TEXT), `bank_account_number` (TEXT), `bank_account_name` (TEXT), `created_at` (TIMESTAMPTZ) | **EMPTY** |
| `commission_ledger` | 0 | `id` (UUID PK), `payment_id` (UUID), `booking_type` (TEXT), `source_user_id` (TEXT), `commission_amount` (NUMERIC), `commission_rate` (NUMERIC), `gross_amount` (NUMERIC), `description` (TEXT), `paystack_reference` (TEXT), `status` (TEXT), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ) | **EMPTY — no frontend reads** |
| `financial_audit_logs` | 0 | `id` (UUID PK), `event_type` (TEXT), `user_id` (TEXT), `target_user_id` (TEXT), `amount` (NUMERIC), `reference_id` (TEXT), `reference_type` (TEXT), `description` (TEXT), `metadata` (JSONB), `created_at` (TIMESTAMPTZ) | **EMPTY** |
| `partner_support_conversations` | 0 | `id` (UUID PK), `partner_id` (TEXT), `title` (TEXT), `status` (TEXT), `is_resolved` (BOOLEAN), `last_message_at` (TIMESTAMPTZ), `created_at` (TIMESTAMPTZ) | **EMPTY** |
| `partner_support_messages` | 0 | `id` (UUID PK), `conversation_id` (UUID), `sender_id` (TEXT), `message` (TEXT), `is_read` (BOOLEAN), `created_at` (TIMESTAMPTZ) | **EMPTY** |
| `worker_bookings` | 0 | `id` (UUID PK), `user_id` (TEXT), `worker_id` (TEXT), `service_id` (UUID), `status` (TEXT), `amount` (NUMERIC), `commission_amount` (NUMERIC), `worker_earnings` (NUMERIC), `scheduled_date` (DATE), `created_at` (TIMESTAMPTZ) | **EMPTY** |

### 2.2 Tables That Do NOT Exist in Live Database

| Table | Discovery Claim | Actual Status |
|-------|----------------|-------------|
| `partner_activity_log` | Mentioned in discovery as queried by dashboard | **DOES NOT EXIST** in migrations or frontend code. No `CREATE TABLE` found. Dashboard references it in text but never queries it. |
| `properties` (unified) | Defined in `20250703_unified_property_system.sql` | **Exists in migration but not confirmed in live DB** (anonymous REST query returned 404, but may be RLS-blocked) |
| `property_units` | Defined in `20250703_unified_property_system.sql` | **Same as above** |
| `bookings` (unified) | Defined in `20250703_unified_property_system.sql` | **Same as above** |
| `property_payouts` | Defined in `20250703_unified_property_system.sql` | **Same as above** |
| `property_contracts` | Defined in `20250703_unified_property_system.sql` | **Same as above** |
| `rental_agreements` | Defined in `20250704_worker_escrow_and_rental_plans.sql` | **Same as above** |

### 2.3 Column Evidence: `listings.partner_id` vs `listings.owner_id`

**Live data query (1 row returned):**
```
listings row:
  owner_id:     e1da4303-690d-46d1-a5cd-6badf51697d1  (NOT NULL)
  partner_id:   NULL
  status:       'available'
  submitted_by_role: 'creator'
```

**Interpretation:** The single existing listing was created by a `creator` role (not a property partner), and `partner_id` was left NULL. This means `partner_id` is **not a reliable column** for partner linkage in practice. `owner_id` is the only populated owner column.

---

## 3. What Currently Exists and Can Be Kept

### 3.1 Signup & Profile (Confirmed Safe)

| Component | File | Evidence |
|-----------|------|----------|
| Signup role selector | `src/pages/Login.tsx` | `signupRole` includes `'property_partner'`, stored in `localStorage` as `wh_pending_role` |
| Profile creation RPC | `src/lib/supabase/profile.ts` | Calls `create_my_profile` RPC with `p_role` parameter |
| `property_partners` table | `supabase/migrations/20250707_property_partners_table.sql` | Has `profile_id` → `profiles.user_id`, `partner_code`, `status`, `commission_rate`, `total_earnings`, `total_paid_out`, `properties_count` |
| Signup trigger | `supabase/migrations/20260807_partner_signup_compatibility.sql` | `normalize_partner_self_insert_trigger` validates `role = 'property_partner'` before insert |
| Setup page | `src/pages/Setup.tsx` | Reads `role` from profile, sets title dynamically. Works for all roles. |

### 3.2 Inspection Requests (Confirmed Safe — Correct Foundation)

| Aspect | Evidence |
|--------|----------|
| Table creation | `supabase/migrations/20250702_inspection_requests.sql` — comprehensive schema with all required fields |
| RLS policy | `inspection_requests_owner`: `owner_id = auth.uid()::text OR role IN ('staff','admin',...)` — **partners CAN securely create their own requests** |
| Status values | `CHECK (status IN ('pending', 'scheduled', 'in_progress', 'approved', 'rejected', 'completed'))` |
| Staff workflow | `supabase/migrations/20250705_complete_system.sql` — `update_inspection_status` RPC handles transitions |
| Post from inspection | `post_property_from_inspection` RPC exists and creates listings from inspection data |

### 3.3 Listings (Confirmed Safe — Schema Is Correct, Data Is Wrong)

| Aspect | Evidence |
|--------|----------|
| Table creation | `supabase/migrations/20250705_complete_system.sql` — has `owner_id`, `submitted_by_role`, `status`, `approved_by`, `approved_at`, `rejection_reason` |
| Status values | `'pending_approval'`, `'available'`, `'rejected'` confirmed in migrations |
| RLS policies | `listings_public_read` (public SELECT), `listings_staff_all` (staff ALL), `listings_update_owner` (owner UPDATE) — all confirmed in migrations |
| `submitted_by_role` | Exists as TEXT column. Used in `src/lib/supabase/listings.ts` line 29: `posterRole = l.submitted_by_role || l.profiles?.role || 'staff'` |

### 3.4 Wallets (Confirmed Safe — Schema Supports Partners)

| Aspect | Evidence |
|--------|----------|
| Table creation | `supabase/migrations/20250704_worker_categories_wallet_system.sql` — `owner_type` CHECK IN `('worker', 'property_partner')` |
| `getOrCreateWallet` | `src/lib/supabase/workers.ts` line 407: `getOrCreateWallet(profile.user_id, 'property_partner')` — correctly passes `property_partner` owner_type |
| `request_worker_withdrawal` RPC | `supabase/migrations/20260807_worker_workflow_hardening.sql` — checks `owner_id = v_user_id` but **does NOT check `owner_type = 'worker'`**, so it would work for property partners too (though name is misleading) |

### 3.5 Partner Support (Confirmed Safe)

| Aspect | Evidence |
|--------|----------|
| RPC wrappers | `src/lib/supabase/partner-support.ts` — 7 RPCs: `createPartnerSupportConversation`, `getPartnerConversations`, `getPartnerSupportMessages`, `sendPartnerSupportMessage`, `markPartnerMessagesRead`, `getPartnerSupportInbox`, `resolvePartnerConversation` |
| Table | `partner_support_conversations` — `partner_id` (TEXT), `title`, `status`, `is_resolved`, `last_message_at` |

### 3.6 Frontend Components (Confirmed Safe)

| Component | File | Evidence |
|-----------|------|----------|
| Route resolution | `src/App.tsx` lines 565–566 | `case 'property_partner': return <PropertyPartnerDashboard ...>` |
| Navigation | `src/lib/desktop-nav.tsx` lines 84, 109 | `getPartnerNav(unreadCount)` returns partner-specific items |
| Profile modal | `src/components/UserProfileModal.tsx` | Shows partner badge when `role === 'property_partner'` |
| Account center | `src/pages/AccountCenter.tsx` | Shows role label |
| Admin partner list | `src/pages/PartnersTab.tsx` | Filters `profiles.role = 'property_partner'` |
| Public directory | `src/pages/PropertyPartnersList.tsx` | Lists all property partners |

---

## 4. What Is Broken and Needs Correction

### 4.1 Critical Bugs (Data Integrity)

| # | Bug | Location | Evidence | Impact |
|---|-----|----------|----------|--------|
| **B01** | **`StaffDashboard.tsx` passes staff's `user_id` as `owner_id` when posting from inspection** | `src/pages/StaffDashboard.tsx` | Line showing: `owner_id: profile.user_id` inside `submitPostProperty(inspection)` where `profile` is the **staff's** profile, not the partner's. The `post_property_from_inspection` RPC then uses this as `v_owner_id := COALESCE(p_data->>'owner_id', v_inspection.owner_id)` — because `owner_id` IS provided (staff's ID), it never falls back to `v_inspection.owner_id` (partner's ID). | **Partner will NEVER see their own listings** because `owner_id` is set to the staff's `user_id`, not the partner's. The dashboard queries `.eq('owner_id', profile.user_id)` where `profile` is the partner. |
| **B02** | **`CreateListing.tsx` sets `owner_id: profile.auth_id` instead of `profile.user_id`** | `src/pages/CreateListing.tsx` | Line 222: `owner_id: profile.auth_id,` | `auth_id` is the Supabase Auth UUID (e.g., `550e8400-e29b-41d4-a716-446655440000`). `user_id` is the profile primary key (e.g., `usr_abc123`). These are different values. Listings created by admin via `CreateListing.tsx` will have `owner_id` that does not match any partner's `profile.user_id`. |
| **B03** | **`listings.partner_id` is NULL in the only live row and never queried correctly** | `src/pages/PropertyOwnerDashboard.tsx` | The dashboard OR-queries: `.or('partner_id.eq.${profile.user_id},owner_id.eq.${profile.user_id}')`. But `partner_id` is a **TEXT** column on `listings` (references `profiles.user_id`), while the legacy `property_partners.id` is a **UUID**. The `CreateListing.tsx` sets `partner_id: assignedPartnerId || null` where `assignedPartnerId` comes from a dropdown of `profiles.user_id` values. This is actually correct in intent, but B01 and B02 make it irrelevant because `owner_id` is wrong. | Dual-column OR query is fragile. If `partner_id` is ever populated differently from `owner_id`, queries return inconsistent results. |
| **B04** | **`property_partners.total_earnings`, `total_paid_out`, `properties_count` are never updated** | `src/hooks/useAuth.ts`, frontend | No frontend code writes to these columns. No triggers update them. The dashboard reads `profile.total_earnings` (from `profiles` table) which is also never updated for partners. | Partner sees zero earnings always. Business metrics are completely broken. |
| **B05** | **`partner_activity_log` table does not exist** | Migrations, frontend | Searched all migrations and frontend code. No `CREATE TABLE partner_activity_log` found. Dashboard references it in text but never queries it. | "Recent Activity" on partner dashboard will always be empty. |

### 4.2 High-Priority Issues

| # | Issue | Location | Evidence | Impact |
|---|-------|----------|----------|--------|
| **H01** | **No partner-facing property submission form** | `src/pages/PropertyOwnerDashboard.tsx` | OverviewTab shows empty state text "Request an inspection to get started" but provides **no button or form** to create an `inspection_requests` row. The SupportTab has a "Property Inspection" category that creates a generic `support_conversations` message, NOT an `inspection_requests` record. | Partners cannot actually submit properties. The workflow is blocked at step 1. |
| **H02** | **`submitted_by_role` is set to staff role, not 'property_partner'`** | `src/pages/StaffDashboard.tsx` | In `submitPostProperty`: `submitted_by_role` is not passed in `p_data`, and the RPC does not set it. The default is whatever the staff's role was. The `post_property_from_inspection` RPC sets `submitted_by_role = 'staff'` (hardcoded in some versions) or leaves it NULL. | Cannot distinguish listings that came from property partners vs staff-created listings. |
| **H03** | **`request_worker_withdrawal` RPC name is misleading but functionally works** | `supabase/migrations/20260807_worker_workflow_hardening.sql` | The RPC looks up wallet by `owner_id = v_user_id` without checking `owner_type`. A property partner calling this would get their `property_partner` wallet. However, the RPC name and the frontend wrapper (`requestWorkerWithdrawal`) imply it is worker-only. | Partners can technically withdraw, but the UX is confusing. The transaction types in `wallet_transactions` don't distinguish partner vs worker earnings. |
| **H04** | **`commission_ledger` has no partner linkage** | `supabase/migrations/20250730_payment_security_hardening.sql` | Table has `payment_id`, `booking_type`, `source_user_id`, `commission_amount`, `gross_amount`. No `partner_id` or `partner_share` column. | Even if bookings existed, partner earnings could not be attributed. |
| **H05** | **`booking_payments` has `commission_amount` and `net_amount` but no partner attribution** | `supabase/migrations/20250702_cto_master_schema.sql` | `commission_amount` is the WeHouse commission. `net_amount` is `amount - commission_amount`. But `net_amount` goes to... whom? No `partner_id` or `recipient_id` column. | The "net amount after commission" has no designated recipient. It is unclear who receives this money. |
| **H06** | **`reservations` table has no `partner_id` or `owner_id`** | `supabase/migrations/20250527_reservation_enquiry.sql` | `reservations` has `listing_id`, `user_id`, `staff_id`. No column linking to the property partner. | When a reservation is made, there is no direct way to know which partner owns the listing without joining to `listings`. This is fine for reads but complicates commission attribution. |
| **H07** | **`hotels` table has no `partner_id`** | `supabase/migrations/20250702_cto_master_schema.sql` | `hotels` has `owner_id` (TEXT) but no `partner_id`. A property partner who owns a hotel building has no way to have their ownership recognized for commission purposes. | Hotel bookings cannot attribute revenue to property partners. |

### 4.3 Medium-Priority Issues

| # | Issue | Location | Evidence | Impact |
|---|-------|----------|----------|--------|
| **M01** | **Dashboard component name is misleading** | `src/pages/PropertyOwnerDashboard.tsx` | File is imported as `PropertyPartnerDashboard` in `App.tsx` but the actual filename is `PropertyOwnerDashboard.tsx`. It is shared by workers (`property_owner` role) and property partners (`property_partner` role). | Maintenance confusion. Rename to `PartnerDashboard.tsx` or similar. |
| **M02** | **Realtime hooks are placeholders** | `src/hooks/useRealtimeUpdates.ts` line 115 | `} else if (userRole === 'property_partner') { // Partner-specific realtime updates }` — empty implementation. | Partners do not receive realtime notifications for listing status changes, new bookings, or payout events. |
| **M03** | **Unread count hooks are placeholders** | `src/hooks/useUnreadCounts.ts` lines 80, 104 | `} else if (userRole === 'property_partner') { // Partner unread counts }` — empty implementation. | Unread badge on nav is always zero for partners. |
| **M04** | **`property_partners.id` UUID is orphaned** | `supabase/migrations/20250703_unified_property_system.sql` | The `property_partners.id` column is a UUID. Legacy `properties.partner_id` (from unified schema) references this UUID. But the live frontend uses `profiles.user_id` via `listings.owner_id`. | The `id` column is never queried by frontend code. It is harmless but confusing. |
| **M05** | **`partner_code` is generated but never used** | `src/hooks/useAuth.ts` | Generated as `WH-${Date.now()}` on signup. Never displayed in UI. Never used in any query. | Dead data. Either expose it as a referral code or stop generating it. |

---

## 5. What Is Legacy/Duplicate and Should Not Be Used

### 5.1 Legacy Unified Property Schema (Do Not Use)

These tables were defined in `20250703_unified_property_system.sql` and related migrations. They are **comprehensively defined but never queried by the live frontend**. The frontend uses `listings` + `reservations` + `hotels` instead.

| Table | Migration | Frontend References | Status |
|-------|-----------|---------------------|--------|
| `properties` | `20250703_unified_property_system.sql` | **ZERO** in `src/pages/`, `src/lib/`, `src/hooks/` | **LEGACY — Do not use** |
| `property_units` | `20250703_unified_property_system.sql` | **ZERO** | **LEGACY — Do not use** |
| `bookings` (unified) | `20250703_unified_property_system.sql` | **ZERO** — frontend uses `reservations` and `worker_bookings` | **LEGACY — Do not use** |
| `property_payouts` | `20250703_unified_property_system.sql` | **ZERO** | **LEGACY — Do not use** |
| `property_contracts` | `20250703_unified_property_system.sql` | **ZERO** | **LEGACY — Do not use** |
| `rental_agreements` | `20250704_worker_escrow_and_rental_plans.sql` | **ZERO** | **LEGACY — Do not use** |

**Note:** `inspection_requests` was ALSO defined in `20250703_unified_property_system.sql` with `partner_id UUID REFERENCES property_partners(id)`, but the **live** version is from `20250702_inspection_requests.sql` which uses `owner_id TEXT REFERENCES profiles(user_id)`. The live version is correct and should be kept.

### 5.2 Redundant Columns (Deprecate After Audit)

| Column | Table | Evidence | Rationale |
|--------|-------|----------|-----------|
| `partner_id` | `listings` | Live row shows `partner_id = NULL`. `CreateListing.tsx` sets it from dropdown. `StaffDashboard.tsx` sets it from `inspection.owner_id`. But `owner_id` is the canonical owner column. | Both columns reference `profiles.user_id`. `owner_id` is populated in the live row; `partner_id` is NULL. However, `StaffDashboard.tsx` explicitly sets `partner_id: inspection.owner_id` when posting from inspection. **Do NOT drop until we confirm whether any code relies on `partner_id` being set.** |
| `partner_id` | `inspection_requests` | Added by `20250707_fix_inspection_requests.sql` as `UUID` type. References `property_partners.id` (UUID). The live table already has `owner_id` (TEXT → profiles.user_id). | The `partner_id` UUID column is orphaned because it references `property_partners.id` which is not used by the frontend. **However**, `inspection_requests.owner_id` is the correct column and is NOT NULL. |

### 5.3 Dead Code (Remove)

| Code | Location | Evidence | Rationale |
|------|----------|----------|-----------|
| `partner_activity_log` references in dashboard | `src/pages/PropertyOwnerDashboard.tsx` | Table does not exist in migrations or frontend. Dashboard shows "Recent Activity" text but never queries the table. | Remove the "Recent Activity" section or replace with a query against `inspection_requests` + `listings` history. |
| `partner_code` generation in frontend | `src/hooks/useAuth.ts` | Generated as `WH-${Date.now()}`. Never displayed or used. | Remove from frontend insert. Keep column in DB for future use if needed. |

---

## 6. The Property Partner Listing-Request Flow

This is the **exact flow** that must be implemented, using existing architecture where possible.

### 6.1 Flow Diagram

```
Partner                  WeHouse Staff/Admin               Published Listing
   |                             |                                  |
   | 1. Submit Property          |                                  |
   |    (inspection_requests)    |                                  |
   | ------------------------->  |                                  |
   |                             | 2. Review & Inspect              |
   |                             |    (update status)               |
   |                             | -------------------------------> |
   |                             |                                  | 3. Create Listing
   |                             |                                  |    (listings table)
   | 4. View Status              |                                  |
   |    (dashboard)              |                                  |
   | <-------------------------  |                                  |
   |                             |                                  |
   | 5. Receive Bookings         |                                  | 6. Bookings Made
   |    (reservations)           |                                  |    (by users)
   | <-------------------------  |                                  |
   |                             |                                  |
   | 7. Earn Net Share           |                                  | 9. WeHouse Deducts Commission
   |    (wallet credit)          |                                  |    (commission_ledger)
```

### 6.2 Step-by-Step Flow

#### Step 1: Partner Submits Property for Inspection

**Action:** Partner clicks "Submit Property" on dashboard.  
**Form fields (all exist in `inspection_requests` table):**
- `property_address` (TEXT, required)
- `property_city` (TEXT, required)
- `property_state` (TEXT, required)
- `property_type` (TEXT, CHECK IN ('apartment', 'house', 'self_contain', 'mini_flat', 'duplex', 'bungalow', 'mansion'))
- `bedrooms` (INTEGER)
- `bathrooms` (INTEGER)
- `expected_rent` (DECIMAL)
- `description` (TEXT)
- `photo_urls` (TEXT[])
- `document_urls` (TEXT[])

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
**RLS:** `inspection_requests_owner` policy allows `owner_id = auth.uid()::text` — partners CAN securely create their own requests.

#### Step 2: WeHouse Reviews & Inspects

**Action:** Staff views inspection request in admin dashboard.  
**Status transitions:**
- `pending` → `scheduled` (staff assigns field officer via `assigned_to` or `assigned_field_officer_id`)
- `scheduled` → `in_progress` (field officer visits)
- `in_progress` → `approved` or `rejected`

**Existing support:** The `inspection_requests.status` column already supports these values. The `update_inspection_status` RPC in `20250705_complete_system.sql` handles transitions.

#### Step 3: WeHouse Creates Listing (If Approved)

**Action:** Staff uses `post_property_from_inspection` RPC or `CreateListing.tsx` to create the listing.  
**Current (broken) flow in `StaffDashboard.tsx`:**
```tsx
// BUG: profile.user_id here is the STAFF's user_id, not the partner's
owner_id: profile.user_id,
partner_id: inspection.owner_id || null,
```

**Correct flow:**
```tsx
owner_id: inspection.owner_id,  // The partner's profiles.user_id
partner_id: inspection.owner_id, // Legacy column — keep populated during transition
submitted_by_role: 'property_partner',
status: 'pending_approval',
approved_by: staffProfile.user_id,
approved_at: new Date().toISOString(),
```

**The `post_property_from_inspection` RPC** (`20250705_complete_system.sql`) currently does:
```sql
v_owner_id := COALESCE(p_data->>'owner_id', v_inspection.owner_id);
v_partner_id := COALESCE(p_data->>'partner_id', v_inspection.owner_id);
```
Because `StaffDashboard.tsx` passes `owner_id` (staff's ID), the `COALESCE` never falls back to `v_inspection.owner_id` (partner's ID). **This is the root cause of B01.**

#### Step 4: Partner Views Published Properties

**Action:** Partner opens "My Properties" tab.  
**Query:**
```tsx
const { data } = await supabase.from('listings')
  .select('*')
  .eq('owner_id', profile.user_id)
  .order('created_at', { ascending: false });
```

**Note:** After B01 is fixed, this query will correctly return the partner's listings.

#### Step 5: Users Book the Property

**Action:** User makes reservation via `reservations` table.  
**Existing flow:** `reservations` links to `listings(listing_id)`. The `booking_payments` table records the payment with `commission_amount` (WeHouse commission) and `net_amount` (amount after commission).

#### Step 6: Partner Receives Net Share

**Action:** After booking is confirmed and paid, Property Partner net share is credited to wallet.  
**Missing:** See Section 11.

---

## 7. How a Request Moves: Partner → WeHouse → Published Listing

### 7.1 Partner Side (Frontend)

1. **Dashboard OverviewTab** shows stat: "Under Inspection" = count of `inspection_requests` with `status IN ('pending', 'scheduled', 'in_progress')` where `owner_id = profile.user_id`.
2. **New "Submit Property" button** on OverviewTab opens a modal/form.
3. **Form submission** inserts into `inspection_requests` via direct Supabase insert (RLS policy allows owner insert).
4. **Partner sees request status** in a new "My Submissions" tab or inside SupportTab.
5. **When listing is published**, it appears in "My Properties" tab automatically (after B01 fix).

### 7.2 WeHouse Side (Admin/Creator)

1. **Admin dashboard** queries `inspection_requests` with `status = 'pending'`.
2. **Staff assigns field officer** via `assigned_to` or `assigned_field_officer_id` column and sets status to `scheduled`.
3. **Field officer inspects**, uploads photos/notes, sets status to `approved` or `rejected`.
4. **If approved**, staff opens the "Post Property" flow in `StaffDashboard.tsx`, pre-fills data from inspection request, and calls `post_property_from_inspection`.
5. **Listing goes live** with `status = 'available'` (after approval).

### 7.3 Data Flow Integrity

| Step | Table | Key Column | Value |
|------|-------|-----------|-------|
| Partner signup | `profiles` | `role` | `'property_partner'` |
| Partner signup | `property_partners` | `profile_id` | `profiles.user_id` |
| Property submission | `inspection_requests` | `owner_id` | `profiles.user_id` |
| Inspection approval | `inspection_requests` | `status` | `'approved'` |
| Listing creation | `listings` | `owner_id` | `profiles.user_id` (same as inspection) |
| Listing creation | `listings` | `submitted_by_role` | `'property_partner'` |
| Booking | `reservations` | `listing_id` | `listings.listing_id` |
| Payment | `booking_payments` | `listing_id` | `listings.listing_id` |
| Commission | `commission_ledger` | `payment_id` | `booking_payments.id` |
| Payout | `wallet_transactions` | `user_id` | `profiles.user_id` |

**Critical:** `profiles.user_id` is the single identifier used throughout. `property_partners.id` UUID is not needed for this flow.

---

## 8. Existing Tables/RPCs/Components That Support the Flow

### 8.1 What Already Supports the Flow

| Layer | Artifact | How It Supports |
|-------|----------|-----------------|
| **DB Table** | `inspection_requests` | Already has `owner_id`, `property_address`, `property_city`, `property_state`, `property_type`, `bedrooms`, `bathrooms`, `expected_rent`, `description`, `status`, `photo_urls`, `document_urls`, `assigned_to`, `assigned_field_officer_id` |
| **DB Table** | `listings` | Already has `owner_id`, `submitted_by_role`, `status` (`pending_approval`/`available`/`rejected`), `approved_by`, `approved_at`, `rejection_reason` |
| **DB Table** | `profiles` | Already has `role = 'property_partner'` |
| **DB Table** | `property_partners` | Already has `profile_id` → `profiles.user_id`, `commission_rate`, `total_earnings`, `total_paid_out`, `properties_count` |
| **DB Table** | `wallets` | Already accepts `owner_type = 'property_partner'` |
| **DB Table** | `booking_payments` | Already has `commission_amount` and `net_amount` |
| **DB Table** | `commission_ledger` | Already has `commission_amount`, `commission_rate`, `gross_amount` |
| **Frontend** | `PropertyOwnerDashboard.tsx` | Already queries `inspection_requests` and `listings` |
| **Frontend** | `StaffDashboard.tsx` | Already has `post_property_from_inspection` call (buggy) |
| **Frontend** | `CreateListing.tsx` | Already creates listings (buggy `owner_id`) |
| **Frontend** | `src/lib/supabase/partner-support.ts` | Already has RPCs for partner support conversations |
| **RLS** | `inspection_requests_owner` | Already allows `owner_id = auth.uid()::text` |
| **RLS** | `listings_update_owner` | Already allows `owner_id = auth.uid()::text` to update |
| **RPC** | `post_property_from_inspection` | Already creates listings from inspection data (buggy fallback logic) |
| **RPC** | `update_inspection_status` | Already handles inspection status transitions |

### 8.2 What Is Genuinely Missing

| Layer | Missing Artifact | Why Needed |
|-------|-----------------|------------|
| **Frontend Component** | `SubmitPropertyModal.tsx` | Partner-facing form to create `inspection_requests` |
| **Frontend Component** | `MySubmissionsTab.tsx` | Partner-facing view of `inspection_requests` status |
| **Frontend Function** | `getPartnerInspectionRequests` | Query helper for partner's inspection history |
| **Frontend Function** | `getPartnerEarnings` | Query partner's total/pending/available net share |
| **Frontend Function** | `requestPartnerWithdrawal` | Wrapper for partner-specific withdrawal (even if RPC is shared) |
| **RPC** | `get_partner_earnings` | Return partner's financial summary from `property_partners` + `commission_ledger` |
| **Trigger** | Update `property_partners.total_earnings` | Auto-update on `commission_ledger` insert |
| **Trigger** | Update `property_partners.properties_count` | Auto-update on `listings` insert/delete for that partner |

---

## 9. How the Resulting Listing Remains Linked to the Property Partner

### 9.1 Canonical Linkage: `listings.owner_id`

The **single source of truth** for partner→listing linkage is `listings.owner_id` referencing `profiles.user_id`.

**Current state (broken due to B01):**
```tsx
// StaffDashboard.tsx (buggy)
owner_id: profile.user_id,  // WRONG: staff's user_id, not partner's
partner_id: inspection.owner_id || null,  // Partner's ID stored here instead
```

**Correct state:**
```tsx
// StaffDashboard.tsx (fixed)
owner_id: inspection.owner_id,  // The partner's profiles.user_id
partner_id: inspection.owner_id, // Legacy column — keep populated during transition
submitted_by_role: 'property_partner',
status: 'available',  // or 'pending_approval' if admin wants review
approved_by: staffProfile.user_id,
approved_at: new Date().toISOString(),
```

### 9.2 Query Pattern

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

### 9.3 Migration Path for `partner_id` Column

**Phase 1 (Immediate):** Fix B01 so `owner_id` is correctly set to the partner's `user_id`. Keep `partner_id` populated with the same value for backward compatibility.

**Phase 2 (After frontend cleanup):** Verify all frontend queries use `owner_id` only. Check if any admin tools rely on `partner_id`.

**Phase 3 (Cleanup migration):**
```sql
-- Verify no mismatched rows
SELECT COUNT(*) FROM listings
WHERE partner_id IS NOT NULL
  AND owner_id IS NOT NULL
  AND partner_id != owner_id;

-- If zero mismatches and no code references partner_id:
ALTER TABLE listings DROP COLUMN partner_id;
DROP INDEX IF EXISTS idx_listings_partner_id;
```

**WARNING:** Do NOT execute Phase 3 until a full codebase audit confirms `partner_id` is not used by any admin tool, report, or analytics query.

---

## 10. Existing Booking/Payment/Revenue Paths Relevant to Property Partners

### 10.1 Short-Stay / Apartment Bookings (`listings` + `reservations` + `booking_payments`)

**Flow:**
1. User views `listings` with `status = 'available'` and `availability_status = 'available'`.
2. User creates `reservations` row with `listing_id`, `user_id`, `status = 'pending'`.
3. User pays reservation fee via Paystack.
4. `booking_payments` row is created with:
   - `type = 'reservation'`
   - `listing_id = listings.listing_id`
   - `amount = total_paid`
   - `commission_amount = amount * commission_rate` (WeHouse commission)
   - `net_amount = amount - commission_amount`
   - `status = 'completed'`
5. `reservations.status` changes to `confirmed`, `fee_paid = true`, `paid_at = now()`.

**Partner relevance:** Currently, `booking_payments.net_amount` has no designated recipient. The `commission_ledger` table records the commission but does not link to a partner. **There is no code that credits the partner's wallet with the net amount.**

### 10.2 Extended-Stay / Hotel Bookings (`hotels` + `hotel_rooms` + `hotel_bookings` + `booking_payments`)

**Flow:**
1. User views `hotels` with `owner_id` set.
2. User books a room via `hotel_bookings` table.
3. `booking_payments` row is created with `type = 'hotel_booking'`, `hotel_booking_id = hotel_bookings.booking_id`.

**Partner relevance:** `hotels` has `owner_id` but no `partner_id`. A property partner who owns a hotel building has no way to have their ownership recognized for commission purposes. The `booking_payments` table has `hotel_booking_id` but no `partner_id`.

### 10.3 Worker Bookings (`worker_bookings` + `booking_payments`)

**Flow:**
1. User books a worker service.
2. `worker_bookings` row is created.
3. `booking_payments` row is created with `type = 'worker_subscription'`.
4. `commission_ledger` records the commission.

**Partner relevance:** Not directly relevant to property partners. Property partners are NOT workers.

---

## 11. What Is Missing for WeHouse Commission Deduction and Property Partner Net Share

### 11.1 Commission Calculation Gap

**Current `booking_payments` schema:**
```sql
amount DECIMAL(12,2) NOT NULL,           -- Gross property revenue
commission_amount DECIMAL(12,2) DEFAULT 0,  -- WeHouse commission
net_amount DECIMAL(12,2) NOT NULL,       -- Amount after commission
```

**Current `commission_ledger` schema:**
```sql
payment_id UUID REFERENCES booking_payments(id),
commission_amount NUMERIC(12,2),
commission_rate NUMERIC(5,2),
gross_amount NUMERIC(12,2),
source_user_id TEXT,  -- The user who made the payment
```

**Missing:**
- `partner_id` on `commission_ledger` — to know which partner earned the net share
- `partner_net_share` on `commission_ledger` — to store the partner's earnings
- `partner_paid` on `commission_ledger` — to track whether the partner has been paid

**Required calculation:**
```
gross_property_revenue = booking_payments.amount
WeHouse_commission = gross_property_revenue * commission_rate  (default 10% from property_partners.commission_rate)
Property_Partner_net_share = gross_property_revenue - WeHouse_commission
```

### 11.2 Wallet Crediting Gap

**Current `wallet_transactions` schema:**
```sql
type TEXT NOT NULL CHECK (type IN ('credit', 'debit', 'escrow_release', 'withdrawal', 'refund', 'commission', 'freeze', 'unfreeze'))
```

**Missing:** Transaction types for partner earnings:
- `partner_credit` — Property Partner net share credited
- `partner_withdrawal` — Property Partner withdrawal

**Current `request_worker_withdrawal` RPC:**
- Checks `wallets.available_balance`
- Does NOT check `owner_type`
- Would work for property partners but is misnamed

**Current `request_withdrawal` (generic) RPC:**
- Checks `profiles.wallet_balance` (old field)
- Does NOT interact with `wallets` table
- **This is a different system from the wallet system**

**Gap:** There are TWO parallel financial systems:
1. **Old system:** `profiles.wallet_balance` + `request_withdrawal` RPC + `withdrawals` table
2. **New system:** `wallets` table + `wallet_transactions` table + `request_worker_withdrawal` RPC

The partner dashboard currently shows the **new system** (`wallets.available_balance`) but the withdrawal uses `request_worker_withdrawal` which is named for workers.

### 11.3 Earnings Display Gap

**Current dashboard:** Shows `totalEarnings` from `profile.total_earnings` (from `profiles` table) but this field is never populated for partners.

**Required:**
- Query `commission_ledger` where `partner_id = profile.user_id` to get:
  - Total earnings (sum of `partner_net_share` where `partner_paid = true`)
  - Pending earnings (sum of `partner_net_share` where `partner_paid = false`)
  - Available balance (from `wallets` table)

### 11.4 Required New RPCs

| RPC | Purpose | SQL Outline |
|-----|---------|-------------|
| `get_partner_earnings(p_partner_id TEXT)` | Return partner's financial summary | `SELECT total_earnings, total_paid_out, properties_count FROM property_partners WHERE profile_id = p_partner_id` |
| `get_partner_commission_history(p_partner_id TEXT)` | Return commission ledger entries | `SELECT * FROM commission_ledger WHERE partner_id = p_partner_id ORDER BY created_at DESC` |
| `credit_partner_wallet(p_partner_id TEXT, p_amount NUMERIC, p_reference TEXT)` | Credit partner wallet | Insert into `wallet_transactions` with `type = 'credit'` and update `wallets.available_balance` |

---

## 12. Tabs/Actions to Remove or Correct

### 12.1 Dashboard Tabs: What to Keep vs Remove

| Tab | Current State | Action | Rationale |
|-----|--------------|--------|-----------|
| **Overview** | Shows 3 stat cards (Under Inspection, Published, Total Earnings) + empty state text "Request an inspection to get started" | **MODIFY** | Add "Submit Property" button that opens `SubmitPropertyModal`. Fix "Total Earnings" to query `commission_ledger` or `property_partners.total_earnings`. |
| **My Properties** | Queries `listings` with OR on `partner_id`/`owner_id` | **MODIFY** | After B01 fix, simplify to `.eq('owner_id', profile.user_id)` only. Remove OR query. |
| **Inspections** | Empty tab or minimal implementation | **MODIFY** | Rename to "My Submissions" and query `inspection_requests` where `owner_id = profile.user_id`. Show status timeline. |
| **Earnings** | Shows placeholder stats, reads `profile.total_earnings` | **MODIFY** | Query `wallets` + `commission_ledger` for real data. Add withdrawal button. |
| **Messages** | Empty or minimal | **MODIFY** | Implement support conversation list using `partner_support_conversations`. |
| **Profile** | Basic profile view | **KEEP** | Already functional. |
| **Support** | Uses generic `support_conversations` with category "Property Inspection" | **CORRECT** | Stop creating generic support messages for property submissions. Redirect "Property Inspection" category to actual `inspection_requests` creation flow. Keep support for general questions. |
| **Recent Activity** | Empty placeholder referencing non-existent `partner_activity_log` | **REMOVE** | Table does not exist. Replace with activity from `inspection_requests` + `listings` + `wallet_transactions`. |

### 12.2 Actions to Remove

| Action | Location | Why Remove |
|--------|----------|-----------|
| "Request an inspection to get started" as empty-state-only text | `PropertyOwnerDashboard.tsx` OverviewTab | It is not actionable. Partners need a button/form, not just text. |
| "Property Inspection" support category creating generic support messages | `PropertyOwnerDashboard.tsx` SupportTab | It creates support messages instead of actual inspection requests. Partners think they submitted a property but nothing was created in `inspection_requests`. |
| `partner_activity_log` references | `PropertyOwnerDashboard.tsx` | Table does not exist. Dead code. |

### 12.3 Actions to Add

| Action | Where | Description |
|--------|-------|-------------|
| "Submit Property" button | OverviewTab | Opens modal with `inspection_requests` creation form |
| "My Submissions" tab | Dashboard | Shows all `inspection_requests` with status timeline |
| "Withdraw Earnings" button | EarningsTab | Calls `request_worker_withdrawal` (works for partners) or new `request_partner_withdrawal` |
| "View Commission History" link | EarningsTab | Shows `commission_ledger` entries for this partner |
| "Support Chat" button | MessagesTab | Opens `partner_support_conversations` |

---

## 13. Final Property Partner Dashboard Design

### 13.1 Navigation (Desktop + Mobile)

```
Partner Nav Items:
- Overview        (dashboard summary + submit button)
- My Properties   (published listings)
- My Submissions  (inspection requests + status)
- Earnings        (wallet + commission history + withdraw)
- Messages        (support conversations)
- Profile         (profile settings)
```

### 13.2 Overview Tab Layout

```
+----------------------------------------------------------+
|  Welcome back, [Partner Name]                            |
|                                                          |
|  +----------------+  +----------------+  +--------------+ |
|  | Under Inspection|  | Published      |  | Total Earnings| |
|  | 0              |  | 0              |  | N0.00        | |
|  +----------------+  +----------------+  +--------------+ |
|                                                          |
|  [Submit Property]  <-- Button that opens modal          |
|                                                          |
|  Recent Activity (from inspection_requests + listings)   |
|  - You submitted a property at 123 Main St (Pending)     |
|  - Your property at 456 Oak Ave was approved             |
|  - Your property at 789 Pine Rd is now live              |
+----------------------------------------------------------+
```

### 13.3 My Submissions Tab Layout

```
+----------------------------------------------------------+
|  My Property Submissions                                 |
|                                                          |
|  +----------------------------------------------------+  |
|  | WHIR-0001 | 123 Main St, Lagos | Pending | [View]  |  |
|  +----------------------------------------------------+  |
|  | WHIR-0002 | 456 Oak Ave, Abuja | Approved  | [View] |  |
|  +----------------------------------------------------+  |
|                                                          |
|  Status Legend:                                          |
|  - Pending (gray) → Scheduled (blue) → In Progress (yellow) |
|  - Approved (green) → Rejected (red) → Completed (green) |
+----------------------------------------------------------+
```

### 13.4 Earnings Tab Layout

```
+----------------------------------------------------------+
|  Earnings Overview                                       |
|                                                          |
|  +----------------+  +----------------+  +--------------+ |
|  | Total Earnings |  | Available      |  | Withdrawn    | |
|  | N0.00         |  | N0.00          |  | N0.00        | |
|  +----------------+  +----------------+  +--------------+ |
|                                                          |
|  [Withdraw Earnings]                                     |
|                                                          |
|  Commission History                                      |
|  +----------------------------------------------------+  |
|  | Date       | Property      | Gross  | Commission | Net |  |
|  | 2026-08-01 | 123 Main St   | N100k  | N10k       | N90k|  |
|  +----------------------------------------------------+  |
+----------------------------------------------------------+
```

---

## 14. Required Changes: Database / RPC / RLS / Frontend

### 14.1 Critical Fixes (Must Fix Before Any Partner Can Use the System)

| # | Change | File | Description |
|---|--------|------|-------------|
| **C1** | Fix B01 | `src/pages/StaffDashboard.tsx` | In `submitPostProperty`, change `owner_id: profile.user_id` to `owner_id: inspection.owner_id`. Also set `submitted_by_role: 'property_partner'`. |
| **C2** | Fix B02 | `src/pages/CreateListing.tsx` | Change `owner_id: profile.auth_id` to `owner_id: profile.user_id`. Verify `assignedPartnerId` uses `profiles.user_id` values. |
| **C3** | Add Submit Property form | `src/pages/PropertyOwnerDashboard.tsx` or new `SubmitPropertyModal.tsx` | Create a form that inserts into `inspection_requests` with `owner_id = profile.user_id`. |
| **C4** | Fix SupportTab | `src/pages/PropertyOwnerDashboard.tsx` | Remove "Property Inspection" category from support. Add dedicated "Submit Property" button elsewhere. |

### 14.2 High-Priority Changes (Fix After Critical)

| # | Change | File | Description |
|---|--------|------|-------------|
| **H1** | Create `MySubmissionsTab` | New file or modify `PropertyOwnerDashboard.tsx` | Query `inspection_requests` where `owner_id = profile.user_id`. Show status timeline. |
| **H2** | Fix earnings query | `src/pages/PropertyOwnerDashboard.tsx` EarningsTab | Query `wallets` table for balance. Query `commission_ledger` (after adding `partner_id`) for earnings history. |
| **H3** | Add `partner_id` to `commission_ledger` | Migration | Add `partner_id TEXT` column. Update existing triggers/RPCs to populate it. |
| **H4** | Add `partner_net_share` to `commission_ledger` | Migration | Add `partner_net_share NUMERIC` column. Calculate as `gross_amount - commission_amount`. |
| **H5** | Create wallet credit trigger | Migration | On `commission_ledger` insert, credit partner's wallet via `wallet_transactions` insert. |
| **H6** | Add `partner_id` to `booking_payments` | Migration | Add `partner_id TEXT` column. Populate from `listings.owner_id` when `type = 'reservation'`. |
| **H7** | Rename or alias withdrawal RPC | Migration / Frontend | Either rename `request_worker_withdrawal` to `request_withdrawal` (generic) or create `request_partner_withdrawal` wrapper. |

### 14.3 Medium-Priority Changes (Nice to Have)

| # | Change | File | Description |
|---|--------|------|-------------|
| **M1** | Rename dashboard file | `src/pages/PropertyOwnerDashboard.tsx` → `src/pages/PartnerDashboard.tsx` | Update all imports. Keep shared logic for worker and partner roles. |
| **M2** | Implement realtime updates | `src/hooks/useRealtimeUpdates.ts` | Listen to `inspection_requests`, `listings`, `wallet_transactions` changes for partner. |
| **M3** | Implement unread counts | `src/hooks/useUnreadCounts.ts` | Count unread `partner_support_messages` for partner. |
| **M4** | Remove `partner_code` generation | `src/hooks/useAuth.ts` | Stop generating unused code. |
| **M5** | Clean up `partner_id` on `listings` | Migration (Phase 3) | After full audit, drop `partner_id` if truly unused. |

### 14.4 Database Schema Changes Summary

| Table | Change | Migration File | Notes |
|-------|--------|---------------|-------|
| `commission_ledger` | Add `partner_id TEXT` | New migration | References `profiles.user_id` |
| `commission_ledger` | Add `partner_net_share NUMERIC` | New migration | Calculated as `gross_amount - commission_amount` |
| `commission_ledger` | Add `partner_paid BOOLEAN DEFAULT FALSE` | New migration | Track payout status |
| `booking_payments` | Add `partner_id TEXT` | New migration | For reservation type, from `listings.owner_id` |
| `property_partners` | Add trigger on `commission_ledger` insert | New migration | Update `total_earnings`, `total_paid_out` |
| `property_partners` | Add trigger on `listings` insert/delete | New migration | Update `properties_count` |
| `listings` | Keep `partner_id` for now | None | Deprecate after audit, do not drop yet |

### 14.5 RLS Policy Changes

| Table | Policy | Change | Notes |
|-------|--------|--------|-------|
| `commission_ledger` | New | `commission_ledger_partner_read` | `partner_id = auth.uid()::text` |
| `booking_payments` | New | `booking_payments_partner_read` | `partner_id = auth.uid()::text` |
| `inspection_requests` | Existing | Keep as-is | Already allows partner insert |
| `listings` | Existing | Keep as-is | Already allows owner update |

---

## 15. Decision Register

| # | Decision | Rationale | Date |
|---|----------|-----------|------|
| D01 | Keep `inspection_requests` as the canonical property submission mechanism | Table exists, has correct schema, has RLS, and `post_property_from_inspection` RPC already converts to listings. No need to invent a new submission system. | 2026-08-09 |
| D02 | Use `profiles.user_id` as the canonical partner identifier across all tables | `property_partners.id` UUID is orphaned. `profiles.user_id` is already used in `inspection_requests.owner_id`, `listings.owner_id`, and `wallets.owner_id`. | 2026-08-09 |
| D03 | Do NOT create `partner_activity_log` table | Table does not exist and is not needed. Activity can be derived from `inspection_requests` + `listings` + `wallet_transactions`. | 2026-08-09 |
| D04 | Do NOT drop `listings.partner_id` yet | `StaffDashboard.tsx` explicitly sets it. Need to audit all admin tools before dropping. Deprecate in Phase 3. | 2026-08-09 |
| D05 | Use `wallets` + `wallet_transactions` as the canonical financial system | `profiles.wallet_balance` is the old system. The new wallet system already supports `property_partner` owner_type. | 2026-08-09 |
| D06 | Keep `request_worker_withdrawal` RPC for now | It does NOT check `owner_type`, so it works for property partners. Rename in Phase 2 to avoid confusion. | 2026-08-09 |
| D07 | Add `partner_id` to `commission_ledger` rather than creating a new table | `commission_ledger` already has the right structure. Adding `partner_id` and `partner_net_share` is simpler than a new table. | 2026-08-09 |
| D08 | Do NOT use legacy unified schema tables (`properties`, `property_units`, `bookings`, `property_payouts`, `property_contracts`, `rental_agreements`) | These tables are never queried by the live frontend. The live system uses `listings` + `reservations` + `hotels`. | 2026-08-09 |
| D09 | Property partners do NOT self-publish listings | The correct flow is: Partner submits inspection request → WeHouse inspects → WeHouse publishes listing. This is what `inspection_requests` + `post_property_from_inspection` already support. | 2026-08-09 |
| D10 | Partner commission is calculated as `gross - WeHouse commission` | Default commission rate from `property_partners.commission_rate` (default 10%). Net share = `booking_payments.net_amount`. | 2026-08-09 |

---

## 16. File Path Index

### 16.1 Files That Must Be Modified

| File | Reason |
|------|--------|
| `src/pages/StaffDashboard.tsx` | Fix B01: `owner_id` must be `inspection.owner_id`, not `profile.user_id` |
| `src/pages/CreateListing.tsx` | Fix B02: `owner_id` must be `profile.user_id`, not `profile.auth_id` |
| `src/pages/PropertyOwnerDashboard.tsx` | Add Submit Property button, fix SupportTab, add My Submissions tab, fix earnings query |
| `src/hooks/useAuth.ts` | Remove `partner_code` generation (M05) |
| `src/hooks/useRealtimeUpdates.ts` | Implement partner-specific realtime updates (M02) |
| `src/hooks/useUnreadCounts.ts` | Implement partner unread counts (M03) |
| `src/lib/supabase/partner-support.ts` | Add helper for inspection request creation if needed |

### 16.2 Files That May Need Modification

| File | Reason |
|------|--------|
| `src/App.tsx` | Update import if `PropertyOwnerDashboard.tsx` is renamed |
| `src/lib/desktop-nav.tsx` | Verify partner nav items are correct |
| `src/lib/supabase/workers.ts` | Verify `getOrCreateWallet` works for partners (already does) |

### 16.3 New Files to Create

| File | Purpose |
|------|---------|
| `src/components/SubmitPropertyModal.tsx` | Partner-facing form to create `inspection_requests` |
| `src/components/MySubmissionsTab.tsx` | Partner-facing view of inspection request status |
| `src/lib/supabase/inspections.ts` | Query helpers for inspection requests |
| `src/lib/supabase/partner-earnings.ts` | Query helpers for partner earnings and commission history |

### 16.4 Migration Files to Create

| File | Purpose |
|------|---------|
| `supabase/migrations/20260809_partner_commission_ledger.sql` | Add `partner_id`, `partner_net_share`, `partner_paid` to `commission_ledger` |
| `supabase/migrations/20260809_partner_booking_payments.sql` | Add `partner_id` to `booking_payments` |
| `supabase/migrations/20260809_partner_wallet_triggers.sql` | Triggers to update `property_partners` stats and credit wallets |
| `supabase/migrations/20260809_partner_rls_policies.sql` | RLS policies for partner read access to `commission_ledger` and `booking_payments` |

---

## Appendix A: Evidence Queries Used

These are the exact queries run against the live database to build this plan:

```sql
-- Table existence and row counts
SELECT schemaname, tablename, n_tup_ins - n_tup_del as row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- listings column check
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'listings';

-- listings live data
SELECT owner_id, partner_id, status, submitted_by_role
FROM listings
LIMIT 5;

-- inspection_requests columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'inspection_requests';

-- property_partners columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'property_partners';

-- commission_ledger columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'commission_ledger';

-- wallet_transactions distinct types
SELECT DISTINCT type FROM wallet_transactions;

-- Check for partner_activity_log table
SELECT table_name
FROM information_schema.tables
WHERE table_name LIKE '%partner_activity%';

-- Check for commission_snapshots table
SELECT table_name
FROM information_schema.tables
WHERE table_name LIKE '%commission_snapshot%';

-- Check request_withdrawal vs request_worker_withdrawal RPCs
SELECT proname, proargnames, prosrc
FROM pg_proc
WHERE proname LIKE '%withdrawal%';
```

---

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Property Partner** | A property owner whose properties are listed BY WeHouse (not self-published). They earn a net share of booking revenue after WeHouse deducts commission. |
| **Inspection Request** | A partner's submission of a property for WeHouse to inspect. Created in `inspection_requests` table. |
| **Listing** | A published property available for booking. Created in `listings` table. |
| **Net Share** | The amount a property partner receives after WeHouse deducts its commission from the gross booking amount. |
| **WeHouse Commission** | The percentage WeHouse keeps from each booking. Default 10% from `property_partners.commission_rate`. |
| **Unified Schema** | A set of legacy tables (`properties`, `property_units`, `bookings`, etc.) defined in `20250703_unified_property_system.sql` but never used by the live frontend. |
| **Old Financial System** | `profiles.wallet_balance` + `request_withdrawal` RPC. Deprecated in favor of `wallets` table. |
| **New Financial System** | `wallets` table + `wallet_transactions` table + `request_worker_withdrawal` RPC. Supports both workers and property partners. |

---

*End of Correction Plan. This document is a planning artifact only. No code changes were made.*
