# Property Partner Workflow Discovery

**Repository:** WeHouse React + Vite + TypeScript SPA with Supabase backend  
**Branch:** `main`  
**Discovery Date:** 2026-08-08  
**Scope:** DISCOVERY ONLY — No fixes or implementations applied.

---

## 1. Executive Summary

The WeHouse codebase contains a **partially-implemented `property_partner` role** that sits between a fully-built worker system and a legacy/abandoned unified property management system. The frontend treats Property Partners as property owners who can list properties, earn revenue, and communicate with WeHouse staff. The backend contains two overlapping property schemas: a **live `listings`-centric schema** (used by the frontend) and a **legacy `properties`/`property_units`/`bookings` unified schema** (defined in migrations but largely unused by frontend code).

---

## 2. How a Property Partner Account Is Created

### 2.1 Signup Flow

**File:** `src/pages/Login.tsx` (lines 343–350)

```tsx
// Signup role selector includes 'property_partner'
const [signupRole, setSignupRole] = useState<'user' | 'worker' | 'property_partner'>('user');

// On signup button click:
setSignupRole('property_partner');
onLoginSuccess(user.id, user.email!, 'property_partner');
localStorage.setItem('wh_pending_role', 'property_partner');
```

**Flow:**
1. User selects "Property Partner" on the signup form.
2. Supabase Auth creates the auth user.
3. `onLoginSuccess` is called with `role = 'property_partner'`.
4. `localStorage.setItem('wh_pending_role', 'property_partner')` stores the role for post-confirmation recovery.

### 2.2 Profile Creation

**File:** `src/hooks/useAuth.ts` (lines 258–316)

```tsx
const handleLoginSuccess = useCallback(async (authId: string, email: string, role?: 'user' | 'worker' | 'property_partner') => {
  // ...
  const { profile: newProfile, error: createError } = await createProfile(authId, email, chosenRole);
  // ...
  if (chosenRole === 'property_partner') {
    await supabase.from('property_partners').insert({
      profile_id: newProfile.user_id,
      partner_code: `WH-${Date.now()}`,
      status: 'active',
    });
  }
}, []);
```

**File:** `src/lib/supabase/profile.ts` (lines 18–20)

```ts
export async function createProfile(authId: string, email: string, role?: 'user' | 'worker' | 'property_partner') {
  const { data, error } = await supabase.rpc('create_my_profile', { p_email: email, p_role: role });
  // ...
}
```

**Backend RPC:** `create_my_profile` (defined in `20260807_worker_workflow_hardening.sql` and earlier migrations)

- Creates a row in `profiles` with `role = 'property_partner'`.
- For property partners, the frontend **also** inserts a row into `property_partners` table directly via `supabase.from('property_partners').insert(...)`.

### 2.3 `property_partners` Table

**File:** `supabase/migrations/20250707_property_partners_table.sql`

```sql
CREATE TABLE IF NOT EXISTS property_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id TEXT NOT NULL REFERENCES profiles(user_id),
  partner_code TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Live RLS Policies** (from `20260807_profile_role_data_security.sql`):
- `property_partner_owner_read` — SELECT using `profile_id = auth.uid()::text` (via profiles subquery)
- `property_partner_staff_read` — SELECT for staff/admin roles
- `property_partner_owner_insert` — INSERT with check that profile belongs to caller and role is `property_partner`

**Trigger:** `normalize_partner_self_insert_trigger` (from `20260807_partner_signup_compatibility.sql`)
- Before insert on `property_partners`, validates that the profile exists with matching `auth_id` and `role = 'property_partner'`.

---

## 3. What Happens After Signup/Login

### 3.1 Profile Setup

**File:** `src/pages/Setup.tsx` (line 19)

Property partners see the same Setup page as users/workers:
- Title: "Property Partner Setup"
- Fields: Username, State, Local Government
- On submit: calls `updateProfile(profile.user_id, { username, state, city, local_government, profile_complete: true })`
- After completion: `onSetupComplete(updated)` triggers app route resolution.

### 3.2 Role Resolution

**File:** `src/hooks/useAuth.ts` (lines 169–170)

```tsx
if (profile.role === 'property_partner') return 'property_partner';
```

### 3.3 Route Assignment

**File:** `src/App.tsx` (lines 565–566)

```tsx
case 'property_partner':
  return <PropertyPartnerDashboard profile={profile} onLogout={auth.logout} onNavigate={(p) => goTo(p as NavPage)} onGoToChat={goToChat} />;
```

---

## 4. Where a Property Partner Is Routed

### 4.1 Dashboard Component

**File:** `src/App.tsx` (line 49)

```tsx
const PropertyPartnerDashboard = lazy(() => import('@/pages/PropertyOwnerDashboard'));
```

**Note:** The component is imported as `PropertyPartnerDashboard` but the actual file is `PropertyOwnerDashboard.tsx`. Both workers and property partners use the **same page component**.

### 4.2 Navigation Tabs

**File:** `src/lib/desktop-nav.tsx` (lines 84, 109)

```tsx
{ id: 'property_partner', label: 'Properties', icon: ... }

case 'property_partner': return getPartnerNav(unreadCount);
```

**Bottom Nav Tabs** (mobile) — `src/App.tsx` (lines 188–205):
- `property_partner` tab shows: Dashboard, Properties, Wallet, Earnings, Messages, Support, Profile, Settings

### 4.3 Page Validation

**File:** `src/App.tsx` (lines 237, 615)

```tsx
if ((savedPage === 'property_owner' || savedPage === 'property_partner') && role !== 'property_partner') valid = false;
```

`property_partner` is in the valid page list alongside `property_owner`.

---

## 5. What Dashboard/Pages They Currently See

### 5.1 PropertyOwnerDashboard.tsx Tabs

**File:** `src/pages/PropertyOwnerDashboard.tsx` (lines 19, 29, 168–175)

```tsx
type PartnerTab = 'overview' | 'properties' | 'wallet' | 'earnings' | 'messages' | 'support' | 'profile' | 'settings';

const SIDEBAR_ITEMS = [
  { key: 'overview', label: 'Overview', icon: '...' },
  { key: 'properties', label: 'Properties', icon: '...' },
  { key: 'wallet', label: 'Wallet', icon: '...' },
  { key: 'earnings', label: 'Earnings', icon: '...' },
  { key: 'messages', label: 'Messages', icon: '...' },
  { key: 'support', label: 'Support', icon: '...' },
  { key: 'profile', label: 'Profile', icon: '...' },
  { key: 'settings', label: 'Settings', icon: '...' },
];
```

| Tab | Implementation | Live? |
|-----|---------------|-------|
| `overview` | `OverviewTab` — stats cards, recent activity, quick actions | Yes |
| `properties` | `MyPropertiesTab` — lists `listings` table rows | Yes |
| `wallet` | `WalletTab` — balance, withdrawals, transactions | Yes |
| `earnings` | `EarningsTab` — revenue charts, payout history | Yes |
| `messages` | `MessagesTab` — partner-staff conversation list | Yes |
| `support` | `SupportTab` — FAQ, contact form, inspection request | Yes |
| `profile` | `ProfileTab` — business details, contact info | Yes |
| `settings` | `SettingsTab` — notifications, password, close account | Yes |

### 5.2 Other Accessible Pages

From `src/App.tsx` route resolution, property partners can navigate to:
- `property_partner` (their dashboard)
- `chat` (if they have conversations)
- `account` (AccountCenter)
- `security_settings` (SecuritySettings)
- `worker_discovery` (public worker listing — visible to all)

They **cannot** access:
- `dashboard` (user dashboard)
- `worker_dashboard`
- `creator`, `admin`, `staff_dashboard`

---

## 6. What Buttons, Tabs and Actions They Currently Have

### 6.1 Overview Tab Actions

**File:** `src/pages/PropertyOwnerDashboard.tsx` (lines 186–300)

- "Add Property" button → opens `CreateListing` (only if `profile.is_staff === true` — **this is suspicious**)
- "Request Inspection" button
- "View Properties" button
- "Wallet" balance card
- "Earnings" summary card
- "Recent Activity" feed (from `partner_activity_log`)

### 6.2 Properties Tab

**File:** `src/pages/PropertyOwnerDashboard.tsx` (lines 302+)

- Lists properties from `listings` table where `partner_id = profile.user_id` OR `owner_id = profile.user_id`
- Shows property cards with image, title, price, status
- "Edit" button on each card
- "Delete" button on each card
- "Add Property" button (staff-only gate)

### 6.3 Wallet Tab

**File:** `src/pages/PropertyOwnerDashboard.tsx` (lines 500+)

- Displays wallet balance
- "Withdraw" button
- Transaction history table
- Uses `getOrCreateWallet(profile.user_id, 'property_partner')`

### 6.4 Support Tab

**File:** `src/pages/PropertyOwnerDashboard.tsx` (lines 700+)

- FAQ accordion
- "Contact Support" button → creates partner support conversation
- Inspection request form
- Recent support conversations list

### 6.5 Settings Tab

**File:** `src/pages/PropertyOwnerDashboard.tsx` (lines 900+)

- Notification toggles
- "Change Password" button
- "Close Account" button (navigates to `security_settings`)

---

## 7. What They Can Currently Do with Properties/Listings

### 7.1 Live Schema: `listings` Table

**File:** `supabase/migrations/20250708_worker_pricing_skills.sql` (lines 45–76)

```sql
CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  price NUMERIC NOT NULL,
  location TEXT,
  state TEXT,
  city TEXT,
  property_type TEXT DEFAULT 'house',
  bedrooms INTEGER,
  bathrooms INTEGER,
  amenities TEXT[],
  images TEXT[],
  partner_id TEXT REFERENCES profiles(user_id),
  owner_id TEXT REFERENCES profiles(user_id),
  status TEXT DEFAULT 'pending',
  is_featured BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Key finding:** The `listings` table has both `partner_id` (references `profiles.user_id`) and `owner_id` (also references `profiles.user_id`). The frontend queries use `.or(`partner_id.eq.${profile.user_id},owner_id.eq.${profile.user_id}`)`.

### 7.2 Create Listing

**File:** `src/pages/CreateListing.tsx`

- Accessible from admin/creator accounts (not directly from partner dashboard unless `is_staff === true`)
- Form fields: title, description, price, location, state, city, property type, bedrooms, bathrooms, amenities, images
- On submit: inserts into `listings` table with `partner_id` or `owner_id` set
- **Discovery:** Partners can NOT self-create listings from their own dashboard. The "Add Property" button in `PropertyOwnerDashboard` is gated by `profile.is_staff === true`.

### 7.3 Property Owner Dashboard Queries

**File:** `src/pages/PropertyOwnerDashboard.tsx` (lines 201, 311, 636)

```tsx
const { data: props } = await supabase.from('listings').select('*')
  .or(`partner_id.eq.${profile.user_id},owner_id.eq.${profile.user_id}`)
  .order('created_at', { ascending: false });
```

### 7.4 Legacy Schema: `properties` / `property_units` / `bookings`

**File:** `supabase/migrations/20250703_unified_property_system.sql`

This migration defines a comprehensive unified property system:
- `properties` table (with `partner_id` → `property_partners.id`)
- `property_units` table
- `bookings` table
- `property_payouts` table
- `property_contracts` table
- `inspection_requests` table
- `rental_agreements` table

**However**, the frontend (`PropertyOwnerDashboard.tsx`) does **NOT** query these tables. It only queries `listings`.

**Status:** Legacy/unused by frontend. May be used by admin/creator tools.

---

## 8. What Messages/Notifications/Settings They Currently Have

### 8.1 Messages

**File:** `src/pages/PropertyOwnerDashboard.tsx` (lines 600+)

- `MessagesTab` shows conversations between partner and WeHouse staff
- Uses `partner_activity_log` table for message history
- Messages are NOT real-time chat; they are activity log entries

**File:** `src/lib/supabase/partner-support.ts`

- `createPartnerSupportConversation` — RPC to create support thread
- `getPartnerConversations` — RPC to list conversations
- `sendPartnerSupportMessage` — RPC to send message
- `markPartnerMessagesRead` — RPC to mark as read

### 8.2 Notifications

**File:** `src/hooks/useRealtimeUpdates.ts` (line 115)

```tsx
} else if (userRole === 'property_partner') {
  // Partner-specific realtime updates
}
```

**File:** `src/hooks/useUnreadCounts.ts` (lines 80, 104)

```tsx
} else if (userRole === 'property_partner') {
  // Partner unread counts
}
```

**Discovery:** The realtime and unread count hooks have branches for `property_partner` but the actual implementation bodies are minimal or placeholder.

### 8.3 Settings

**File:** `src/pages/PropertyOwnerDashboard.tsx` (lines 900+)

- Notification email toggles
- Push notification toggles
- SMS notification toggles
- "Change Password" → navigates to `security_settings`
- "Close Account" → navigates to `security_settings`

---

## 9. How Their Account Deletion Currently Works

### 9.1 Eligibility

**File:** `src/pages/SecuritySettings.tsx` (lines 51–53)

```tsx
const canDeleteAccount = profile.role === 'user' || profile.role === 'worker' || profile.role === 'property_partner';
```

### 9.2 Listing Check

**File:** `src/pages/SecuritySettings.tsx` (lines 65–78)

```tsx
// Check property_partner: ANY listing ever created blocks self-deletion
if (profile.role === 'property_partner' && canDeleteAccount) {
  const { count } = await supabase.from('listings').select('*', { count: 'exact', head: true })
    .or(`partner_id.eq.${profile.user_id},owner_id.eq.${profile.user_id}`);
  setPartnerListingCount(count || 0);
}
```

### 9.3 Deletion RPC

**File:** `src/pages/SecuritySettings.tsx` (lines 252+)

```tsx
const { data: rpcData, error: rpcError } = await supabase.rpc('delete_user_account', {
  p_user_id: profile.user_id,
  p_reason: reason,
});
```

**Backend:** `delete_user_account` RPC (from `20260807_worker_workflow_hardening.sql`)

- For property partners: checks `listings` table for any `partner_id` or `owner_id` match.
- If listings exist: returns error `"Cannot delete account with active listings"`.
- If no listings: marks profile as deleted, anonymizes data, clears auth.

### 9.4 UI Blocking

**File:** `src/pages/SecuritySettings.tsx` (lines 579–644)

- If `partnerListingCount > 0`: shows amber warning "Cannot delete account" with listing count.
- Delete button is disabled.
- Message: "You have previously listed N property(s). Contact WeHouse support to close your account."

---

## 10. Frontend Files That Implement These Things

| File | Role | Status |
|------|------|--------|
| `src/pages/Login.tsx` | Signup with `property_partner` role | Active |
| `src/hooks/useAuth.ts` | Profile creation, `property_partners` table insert | Active |
| `src/pages/Setup.tsx` | Post-signup profile setup (username, state, city) | Active |
| `src/App.tsx` | Route resolution, nav tabs, wallet access control | Active |
| `src/pages/PropertyOwnerDashboard.tsx` | Main dashboard (8 tabs) | Active |
| `src/lib/desktop-nav.tsx` | Desktop navigation for partner | Active |
| `src/pages/CreateListing.tsx` | Listing creation form | Active (admin/creator only) |
| `src/pages/SecuritySettings.tsx` | Account deletion with listing check | Active |
| `src/pages/AccountCenter.tsx` | Account info display | Active |
| `src/components/UserProfileModal.tsx` | Profile modal with partner badge | Active |
| `src/lib/supabase/partner-support.ts` | Support conversation RPC wrappers | Active |
| `src/lib/supabase/profile.ts` | `createProfile` with role parameter | Active |
| `src/lib/supabase/workers.ts` | `getOrCreateWallet` for partners | Active |
| `src/hooks/useRealtimeUpdates.ts` | Partner realtime branch | Minimal/placeholder |
| `src/hooks/useUnreadCounts.ts` | Partner unread count branch | Minimal/placeholder |
| `src/lib/communication-boundaries.ts` | Role normalization, chat permissions | Active |
| `src/pages/Chat.tsx` | Chat with partner role detection | Active |
| `src/pages/Home.tsx` | Home page with partner-specific CTA | Active |
| `src/pages/PartnersTab.tsx` | Admin view of partner list | Active |
| `src/pages/PropertyPartnersList.tsx` | Public partner directory | Active |

---

## 11. Backend Tables, RPCs, Policies and Functions

### 11.1 Core Tables

| Table | Purpose | Partner Column |
|-------|---------|---------------|
| `profiles` | User profile, role enum | `role = 'property_partner'` |
| `property_partners` | Partner-specific record | `profile_id` → `profiles.user_id` |
| `listings` | Property listings | `partner_id`, `owner_id` → `profiles.user_id` |
| `wallets` | Partner wallet | `owner_id`, `owner_type = 'property_partner'` |
| `wallet_transactions` | Wallet history | `user_id` |
| `partner_activity_log` | Dashboard activity feed | `partner_id` |
| `partner_support_conversations` | Support threads | `partner_id` |
| `partner_support_messages` | Support messages | `conversation_id` |

### 11.2 Legacy/Unused Tables (Defined in Migrations, Not Queried by Frontend)

| Table | Migration | Status |
|-------|-----------|--------|
| `properties` | `20250703_unified_property_system.sql` | Legacy |
| `property_units` | `20250703_unified_property_system.sql` | Legacy |
| `bookings` | `20250703_unified_property_system.sql` | Legacy |
| `property_payouts` | `20250703_unified_property_system.sql` | Legacy |
| `property_contracts` | `20250703_unified_property_system.sql` | Legacy |
| `inspection_requests` | `20250703_unified_property_system.sql` | Legacy |
| `rental_agreements` | `20250704_worker_escrow_and_rental_plans.sql` | Legacy |

### 11.3 RPCs for Property Partners

| RPC | File | Purpose |
|-----|------|---------|
| `create_my_profile` | `20260807_worker_workflow_hardening.sql` | Creates profile with role |
| `delete_user_account` | `20260807_worker_workflow_hardening.sql` | Account deletion with listing check |
| `create_partner_support_conversation` | `20250705_complete_system.sql` | Create support thread |
| `get_partner_conversations` | `20250705_complete_system.sql` | List partner threads |
| `get_partner_support_messages` | `20250705_complete_system.sql` | Get thread messages |
| `send_partner_support_message` | `20250705_complete_system.sql` | Send message |
| `mark_partner_messages_read` | `20250705_complete_system.sql` | Mark read |
| `get_partner_support_inbox` | `20250705_complete_system.sql` | Staff inbox view |
| `get_or_create_wallet` | `20250704_worker_categories_wallet_system.sql` | Wallet creation |
| `request_withdrawal` | `20250704_worker_categories_wallet_system.sql` | Withdrawal request |

### 11.4 RLS Policies for Property Partners

| Policy | Table | Access |
|--------|-------|--------|
| `property_partner_owner_read` | `property_partners` | Owner read |
| `property_partner_staff_read` | `property_partners` | Staff read |
| `property_partner_owner_insert` | `property_partners` | Owner insert |
| `partners_own` | `property_partners` | All to authenticated (legacy) |
| `partners_staff` | `property_partners` | Staff all (legacy) |
| `properties_partner` | `properties` | Partner access to own properties |
| `units_partner` | `property_units` | Partner access via properties |
| `bookings_partner` | `bookings` | Partner access via properties |
| `payouts_partner` | `property_payouts` | Partner access |
| `contracts_partner` | `property_contracts` | Partner access |
| `inspections_partner` | `inspection_requests` | Partner access |
| `rental_agreements_partner` | `rental_agreements` | Partner access |

---

## 12. Active vs Legacy vs Broken vs Unreachable Code

### 12.1 Active Code

| Component | Evidence |
|-----------|----------|
| `Login.tsx` signup flow | `signupRole` includes `property_partner`, stored in localStorage |
| `useAuth.ts` profile creation | Explicit `property_partners` table insert on signup |
| `Setup.tsx` | Partner-specific title text, same form as users/workers |
| `PropertyOwnerDashboard.tsx` | 8 implemented tabs, live database queries |
| `SecuritySettings.tsx` deletion | Explicit partner listing check, delete RPC call |
| `partner-support.ts` | 7 RPC wrappers for support conversations |
| `desktop-nav.tsx` | Partner-specific nav items |
| `AccountCenter.tsx` | Partner role label display |
| `CreateListing.tsx` | Listing creation form (admin/creator gated) |

### 12.2 Legacy Code (Defined but Unused by Frontend)

| Component | Evidence |
|-----------|----------|
| `properties` table | Frontend queries `listings`, not `properties` |
| `property_units` table | No frontend references |
| `bookings` table (unified) | No frontend references for partners |
| `property_payouts` table | No frontend references |
| `property_contracts` table | No frontend references |
| `inspection_requests` table | Referenced in migrations but frontend uses `partner_support_conversations` |
| `rental_agreements` table | No frontend references |

### 12.3 Broken / Suspicious Code

| Issue | Location | Evidence |
|-------|----------|----------|
| **"Add Property" button gated by `is_staff`** | `PropertyOwnerDashboard.tsx` | Partners cannot add properties from their own dashboard unless `profile.is_staff === true`. This appears to be a bug or incomplete feature. |
| **Two overlapping property schemas** | Migrations + Frontend | `listings` table (live) vs `properties`+`property_units`+`bookings` (legacy). Partners use `listings`. |
| **`partner_id` vs `owner_id` dual columns** | `listings` table | Both columns reference `profiles.user_id`. Frontend OR-queries both. `partner_id` may be legacy from when `property_partners` table had its own UUID `id`. |
| **Realtime hooks are placeholders** | `useRealtimeUpdates.ts`, `useUnreadCounts.ts` | Have `property_partner` branches but minimal implementation. |
| **`CreateListing` fetches property partners** | `CreateListing.tsx` (lines 64–67) | Queries `profiles` with `role = 'property_partner'` but this is only used in admin/creator context. |
| **Wallet access allows both worker and property_partner** | `App.tsx` (lines 556–558) | `if (profile.role !== 'worker' && profile.role !== 'property_partner')` blocks non-partners from wallet. |

### 12.4 Unreachable / Dead Code

| Code | Location | Why Unreachable |
|------|----------|-----------------|
| `property_partners.id` UUID | `property_partners` table | Frontend never uses `property_partners.id`. It always uses `profiles.user_id` via `partner_id`/`owner_id` on `listings`. |
| `partner_code` | `property_partners` table | Generated but never displayed or used in frontend. |
| `property_partners.status` | `property_partners` table | Never checked in frontend. |
| `properties` table policies | `20250703_unified_property_system.sql` | Frontend never queries `properties`. |
| `property_units` table | Same migration | Never queried. |
| `bookings` unified table | Same migration | Never queried for partners. |

---

## 13. Where Frontend and Live Supabase May Not Match

### 13.1 `listings` vs `properties` Schema Mismatch

**Frontend expects:** `listings` table with `partner_id` / `owner_id` referencing `profiles.user_id`.

**Migrations also define:** `properties` table with `partner_id` referencing `property_partners.id` (UUID, not `profiles.user_id`).

**Risk:** If admin tools use `properties` table while partners use `listings`, data is split across two schemas.

### 13.2 `property_partners.id` vs `profiles.user_id`

**Migration design:** `property_partners.id` is a UUID. `properties.partner_id` references this UUID.

**Frontend reality:** `listings.partner_id` references `profiles.user_id` (TEXT), not `property_partners.id`.

**Risk:** The `property_partners` table exists but its primary key is never used as a foreign key by the live frontend code.

### 13.3 `partner_id` vs `owner_id` on `listings`

Both columns exist on `listings`. The frontend OR-queries both. It is unclear:
- When `partner_id` is populated vs `owner_id`
- Whether they are always the same value
- Whether one is legacy and should be removed

### 13.4 `CreateListing` Form

The listing creation form is accessible to admin/creator roles. Partners cannot self-create listings from their dashboard (gated by `is_staff`). This suggests either:
- Partners are meant to request inspections, then staff create listings
- The `is_staff` gate is a bug

### 13.5 `wallets` Table `owner_type`

**Migration:** `owner_type TEXT NOT NULL CHECK (owner_type IN ('worker', 'property_partner'))`

**Frontend:** `getOrCreateWallet(profile.user_id, 'property_partner')` is called.

**Match:** Yes, this matches.

### 13.6 `delete_user_account` RPC

**Frontend:** Calls `delete_user_account` with `p_user_id`.

**Backend:** The RPC checks `listings` table for partner listings.

**Match:** Yes, this matches.

---

## 14. Communication Boundaries

**File:** `src/lib/communication-boundaries.ts`

```ts
property_partner: ['creator', 'admin', 'staff', 'support'],
```

Property partners can initiate communication with: creator, admin, staff, support.

They **cannot** directly message: users, workers, other property partners.

---

## 15. Admin/Creator Views of Property Partners

### 15.1 PartnersTab.tsx

**File:** `src/pages/PartnersTab.tsx`

- Admin view listing all `property_partner` profiles
- Shows partner count, filters, search
- Links to partner detail view

### 15.2 AnalyticsPage.tsx

**File:** `src/pages/AnalyticsPage.tsx` (line 288)

```tsx
.eq('role', 'property_partner')
```

- Analytics include property partner counts.

### 15.3 CreatorHome.tsx

**File:** `src/pages/CreatorHome.tsx` (line 61)

```tsx
supabase.from('profiles').select('*', { head: true, count: 'exact' }).eq('role', 'property_partner')
```

- Creator dashboard shows total partner count.

---

## 16. Things That Could Not Be Confirmed

1. **Whether `property_partners.id` UUID is used anywhere in the live system.**
   - The frontend never queries by `property_partners.id`.
   - Admin tools may use it, but this was not verified.

2. **Whether the `properties`/`property_units`/`bookings` unified schema is used by any admin/creator tooling.**
   - Migrations define it comprehensively.
   - Frontend `PropertyOwnerDashboard` only uses `listings`.
   - No admin-specific pages were fully audited in this discovery.

3. **Whether partners can actually receive payments/earnings.**
   - Wallet UI exists.
   - `wallet_transactions` table exists.
   - But no evidence of actual revenue-generating flows (rental bookings, escrow) was found for partners.

4. **Whether `partner_activity_log` is populated by any live code.**
   - The table is queried in `PropertyOwnerDashboard`.
   - No write path was discovered in the frontend code audited.

5. **Whether inspection requests actually create `listings` rows.**
   - The support tab has an inspection request form.
   - The FAQ says "WeHouse creates and manages all listings after inspection and approval."
   - But the actual backend flow from inspection → listing was not traced.

6. **Whether `is_staff` flag on profiles is correctly used.**
   - `PropertyOwnerDashboard` gates "Add Property" on `profile.is_staff === true`.
   - This means regular partners cannot add properties.
   - It is unclear if this is intentional or a bug.

---

## 17. File Path Index

### Frontend (React/TypeScript)

| Path | Lines | Description |
|------|-------|-------------|
| `src/pages/Login.tsx` | 343–350 | Partner signup role selection |
| `src/hooks/useAuth.ts` | 258–316 | Partner profile + `property_partners` insert |
| `src/pages/Setup.tsx` | 19 | Partner setup title text |
| `src/App.tsx` | 49, 150, 188, 237, 556, 565 | Route resolution, nav, wallet gate |
| `src/pages/PropertyOwnerDashboard.tsx` | 1–1000+ | Main dashboard with 8 tabs |
| `src/lib/desktop-nav.tsx` | 84, 109 | Partner navigation items |
| `src/pages/CreateListing.tsx` | 1–200+ | Listing creation form |
| `src/pages/SecuritySettings.tsx` | 51–644 | Account deletion with listing check |
| `src/lib/supabase/partner-support.ts` | 1–125 | Support conversation RPCs |
| `src/lib/supabase/profile.ts` | 18–20 | `createProfile` with role |
| `src/lib/supabase/workers.ts` | 407 | `getOrCreateWallet` |
| `src/hooks/useRealtimeUpdates.ts` | 115 | Partner realtime branch |
| `src/hooks/useUnreadCounts.ts` | 80, 104 | Partner unread counts |
| `src/lib/communication-boundaries.ts` | 37, 52, 87, 94 | Partner chat permissions |
| `src/pages/Chat.tsx` | 63, 858 | Partner role detection in chat |
| `src/pages/Home.tsx` | 86, 97, 108, 122 | Partner-specific home CTA |
| `src/pages/PartnersTab.tsx` | 18 | Admin partner list filter |
| `src/pages/PropertyPartnersList.tsx` | 1–200+ | Public partner directory |
| `src/components/UserProfileModal.tsx` | 68, 105, 166, 238, 279 | Partner badge + properties |
| `src/pages/AccountCenter.tsx` | 13 | Partner role label |

### Backend (SQL Migrations)

| Path | Description |
|------|-------------|
| `supabase/migrations/20250703_unified_property_system.sql` | Legacy `properties`/`property_units`/`bookings` schema |
| `supabase/migrations/20250704_worker_categories_wallet_system.sql` | Wallet system with `property_partner` owner_type |
| `supabase/migrations/20250704_worker_escrow_and_rental_plans.sql` | Rental agreements with partner_id |
| `supabase/migrations/20250705_complete_system.sql` | Partner support conversation RPCs |
| `supabase/migrations/20250707_property_partners_table.sql` | `property_partners` table creation |
| `supabase/migrations/20250707_listing_partner_id.sql` | `partner_id` column on `listings` |
| `supabase/migrations/20250707_conversation_type.sql` | Partner support conversation types |
| `supabase/migrations/20250707_fix_inspection_requests.sql` | Inspection requests partner_id |
| `supabase/migrations/20250708_worker_pricing_skills.sql` | `listings` table with partner_id/owner_id |
| `supabase/migrations/20260807_partner_signup_compatibility.sql` | Partner signup trigger + RLS |
| `supabase/migrations/20260807_profile_role_data_security.sql` | Partner RLS policies + `get_or_create_partner_record` |
| `supabase/migrations/20260807_worker_workflow_hardening.sql` | `delete_user_account` RPC with partner listing check |

---

*End of Discovery Document.*
