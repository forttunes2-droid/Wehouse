# WEHOUSE NIGERIA — COMPLETE MASTER PLAN

## 1. ROLES & DASHBOARDS (7 Total)

Every user who logs in gets ONE of these experiences based on their `role` in the `profiles` table:

| Role | Account Type | Dashboard | Bottom Nav Tabs |
|------|-------------|-----------|-----------------|
| **creator** | You (owner) | Creator Dashboard | Home, Hotels, Messages, Workers, Creator |
| **admin** | Your appointee | Admin Dashboard | Home, Hotels, Messages, Workers, Admin |
| **staff** | Field officer | Staff Dashboard | Home, Hotels, Messages, Workers, Staff |
| **worker** | Service provider | Worker Dashboard | Home, Hotels, Messages, Profile |
| **property_partner** | Property owner | Partner Dashboard | Home, Hotels, Messages, Workers, Partner |
| **user** | Regular tenant | User Profile | Home, Search, Saved, Hotels, Messages, Wallet, Roommates, Workers, Profile |

**If someone logs in and sees no dashboard** — their `role` field in the `profiles` table is either NULL, empty, or contains a value that doesn't match any of the 7 roles above. Fix: Set their `role` to `'user'`.

---

## 2. CREATOR DASHBOARD (You)

**Tabs:** Overview, Users, Workers, Partners, Staff, Listings, Bookings, Reports, Support, Verification, Announcements, Settings

### Settings Tab — What You Can Configure:

**Company Info:**
- Company Name, Short Name, Slogan
- Support Email, Phone, Office Address
- WhatsApp Number, Website URL, CAC Number

**Legal:**
- Privacy Policy (full text — shows to all users)
- Terms of Service (full text — shows to all users)
- Refund Policy (full text — shows to all users)
- Cookie Notice text, Minimum Age

**Financial:**
- Commission rates (worker, partner, hotel)
- Minimum withdrawal amount, withdrawal fee
- Inspection fee, Blue badge price
- Currency symbol

**Payment:**
- Paystack public key
- Test mode ON/OFF
- Auto payout ON/OFF

**Property:**
- Listing approval (manual/auto)
- Max listings per partner
- Min/max photos per listing

**Workers:**
- Worker approval (manual/auto)
- Video intro required ON/OFF
- Max skills per worker

**Features:**
- Hotels module ON/OFF
- Workers module ON/OFF
- Roommate matching ON/OFF
- Price negotiation ON/OFF
- Maintenance mode ON/OFF
- Registration open/closed

---

## 3. ADMIN DASHBOARD (Your Appointee)

**Tabs:** Overview, Users, Workers, Partners, Staff, Listings, Bookings, Reports, Support, Verification, Announcements

**What Admin Can Do:**
- View ALL users, workers, partners, staff
- Click any user to see their full profile
- Grant blue tick access to pending workers
- Approve/reject workers who are "under review"
- View and delete listings
- View reports
- Send announcements to all users
- Cannot: Edit platform settings (only Creator can), demote/promote staff (not built yet)

---

## 4. STAFF DASHBOARD (Field Officer)

**Tabs:** Overview, Inspections, Verifications, Listings, Bookings, Support, Analytics, Settings

**What Staff Can Do:**
- View assigned inspections
- Verify worker documents
- View listings in their assigned area
- Respond to support tickets
- Cannot: Access financial settings, approve workers, manage users

---

## 5. WORKER DASHBOARD (Service Provider)

**Status Flow (the correct flow):**
```
1. User signs up → role = 'worker', status = 'pending'
2. Worker sees "Pending" on dashboard
3. Admin clicks "Grant Access" → status = 'approved_for_verification' (BLUE TICK)
4. Worker fills profile info, pays via Paystack
5. Status = 'profile_under_review'
6. Admin reviews, clicks "Approve & Publish" → status = 'verified' (PUBLIC)
7. OR Admin clicks "Reject" → status = 'rejected'
```

**Worker Tabs:** Overview, Bookings, Calendar, Wallet, Services, Verification Status, Profile, Settings

**What Worker Can Do:**
- View their own bookings
- Manage availability calendar
- View wallet balance and transactions
- Request withdrawals
- Edit their profile and services
- View verification status

---

## 6. PROPERTY PARTNER DASHBOARD

**Tabs:** Overview, My Listings, Bookings, Analytics, Profile, Settings

**What Partner Can Do:**
- Create property listings
- View booking requests for their properties
- Manage their profile
- View earnings

---

## 7. REGULAR USER (Tenant)

**What User Can Do:**
- Browse/search properties and hotels
- Save/bookmark listings
- Book properties and hotel rooms
- Hire workers
- Use roommate matching
- Chat with landlords/workers
- View wallet and transaction history
- Edit their profile

---

## 8. AUTHENTICATION FLOW

```
1. User opens wehouse.com.ng
2. Clicks "Get Started" → Google OAuth popup
3. Google returns user info to Supabase
4. Supabase creates auth record
5. Frontend checks if user has a profile
   - NO profile → Show Setup page (name, username, role selection)
   - HAS profile → Go to their dashboard
6. Role selection:
   - "I want to rent" → role = 'user'
   - "I want to list properties" → role = 'property_partner'
   - "I offer services" → role = 'worker'
7. Profile created → Go to their role-specific dashboard
```

**One Email = One Account.** If someone signs up with Google then tries again, they get logged into their existing account.

---

## 9. WORKER VERIFICATION FLOW (Detailed)

```
Step 1: SIGNUP
- User selects "I offer services" during setup
- Profile created with: role='worker', worker_status='pending'
- Worker sees "Pending" banner on dashboard

Step 2: ADMIN GRANTS ACCESS
- Admin goes to Verification tab
- Sees worker with status "Pending"
- Clicks "Grant Access" button
- Worker's status becomes: 'approved_for_verification'
- Worker sees BLUE TICK on their dashboard

Step 3: WORKER FILLS INFO
- Worker clicks "Complete Profile" or goes to Profile tab
- Fills: full name, bio, service category, skills, price, location
- Uploads avatar
- Submits → status stays 'approved_for_verification'

Step 4: PAYMENT (Paystack)
- Worker pays verification fee (set in Settings)
- On successful payment → status = 'profile_under_review'
- Worker sees "Under Review" banner

Step 5: ADMIN REVIEWS
- Admin goes to Verification tab
- Sees worker with status "Under Review"
- Reviews worker's info and video
- Clicks "Approve & Publish" → status = 'verified', worker is now PUBLIC
- OR clicks "Reject" → status = 'rejected'

Step 6: WORKER IS PUBLIC
- Worker appears in worker search results
- Users can find and book them
- Worker can receive booking requests
```

---

## 10. BOOKING FLOW

```
1. User browses properties/workers/hotels
2. Clicks "Book" or "Hire"
3. Selects dates/time
4. Negotiates price (if enabled in settings)
5. Clicks "Confirm Booking"
6. Payment via Paystack
7. Money goes to escrow
8. Service provider gets notified
9. After service completion:
   - Both parties confirm
   - Money released from escrow to provider
   - WeHouse commission deducted (set in Settings)
```

---

## 11. PAYMENT FLOW (Paystack)

```
1. Creator sets Paystack public key in Settings
2. User clicks "Pay" on any booking
3. Frontend initializes Paystack popup with:
   - Amount (from booking)
   - Email (user's email)
   - Public key (from settings)
4. User enters card details in Paystack popup
5. Paystack returns transaction reference
6. Backend verifies payment via Paystack API
7. On success: booking confirmed, money in escrow
```

---

## 12. DATABASE TABLES

| Table | What It Stores |
|-------|---------------|
| `profiles` | All users (7 roles). Key columns: user_id (WHU-XXXXX), role, worker_status, auth_id |
| `listings` | Property listings with photos, price, location |
| `bookings` | All bookings (property, worker, hotel) |
| `conversations` | Chat between two users |
| `messages` | Individual chat messages |
| `service_categories` | Worker service categories (manageable in Settings) |
| `service_subcategories` | Sub-categories under each category |
| `platform_settings` | ALL platform configuration (editable by Creator) |
| `hotels` | Hotel listings |
| `hotel_rooms` | Rooms within each hotel |
| `hotel_bookings` | Hotel room bookings |
| `announcements` | Platform-wide announcements |
| `announcement_recipients` | Who received which announcement |
| `reports` | User reports/complaints |
| `audit_log` | Record of admin actions |

---

## 13. IMPORTANT: SQL YOU MUST RUN

### SQL File 1: ULTIMATE_FIX.sql
This ONE file fixes EVERYTHING:
1. Creator auth password (pgcrypto + functions)
2. Settings system (table + functions + defaults)
3. Worker status flow (new constraint)

**Run this in Supabase SQL Editor → New Query → Paste → Run:**
```sql
-- (Full SQL is in the file supabase/migrations/ULTIMATE_FIX.sql)
-- Key commands: CREATE EXTENSION pgcrypto, create functions, create settings table
```

**After running, test:**
1. Go to Creator Settings → set a password → should save without error
2. Go to Company Info tab → should show all fields with defaults
3. Edit any field → click away → should say "Saved"

---

## 14. WHAT'S WORKING vs WHAT NEEDS THE SQL

| Feature | Status | Needs SQL? |
|---------|--------|-----------|
| Google Login | WORKING | No |
| User signup/setup | WORKING | No |
| Property search | WORKING | No |
| Hotel browsing | WORKING | No |
| Worker search | WORKING | No |
| Chat/messaging | WORKING | No |
| Save listings | WORKING | No |
| Creator Dashboard UI | WORKING | No |
| Admin Dashboard UI | WORKING | No |
| **Creator Auth Password** | **BROKEN** | **YES — run ULTIMATE_FIX.sql** |
| **Platform Settings** | **BROKEN** | **YES — run ULTIMATE_FIX.sql** |
| **Worker status flow** | **NEEDS UPDATE** | **YES — run ULTIMATE_FIX.sql** |
| Announcements | WORKING | No |
| Category manager | WORKING | No |
| Paystack payments | NEEDS TEST KEY | Set key in Settings |

---

## 15. DEPLOYMENT STATUS

**Latest commit:** `46885de` (build fix)
**Previous commits:**
- `f688b5e` — Settings rewrite
- `7e66785` — Admin cleanup + worker flow
- `cadacd3` — Creator Auth fix + Announcements

**If Vercel shows failed:**
1. Go to vercel.com → your project
2. Check the latest deployment
3. If it shows the old commit, redeploy
4. The build passes locally — the issue is Vercel hasn't pulled the latest code

---

## 16. QUICK TROUBLESHOOTING

**"Failed to set password: function gen_salt does not exist"**
→ Run ULTIMATE_FIX.sql in Supabase SQL Editor. The `pgcrypto` extension isn't enabled.

**"No settings in Company tab"**
→ Run ULTIMATE_FIX.sql. The `platform_settings` table doesn't exist yet.

**"Worker stuck on pending"**
→ Admin must click "Grant Access" in Verification tab. Worker cannot proceed without this.

**"User logs in but sees no dashboard"**
→ Check their `role` in the `profiles` table. Must be one of: creator, admin, staff, worker, property_partner, user.

**"I changed a setting but it doesn't reflect"**
→ Settings save to the database immediately. The frontend reads from the database on load. Some settings (like toggles) need a page refresh to take effect.

---

## 17. FILE STRUCTURE (Key Files)

```
src/
├── App.tsx                    — Main router, nav, auth
├── pages/
│   ├── CreatorDashboard.tsx   — Your dashboard (12 tabs)
│   ├── AdminDashboard.tsx     — Admin dashboard (11 tabs)
│   ├── StaffDashboard.tsx     — Staff dashboard
│   ├── WorkerDashboard.tsx    — Worker dashboard
│   ├── PropertyOwnerDashboard.tsx — Partner dashboard
│   ├── CreatorSettingsTab.tsx — Settings (Company, Legal, Financial, etc.)
│   └── ... (30+ other pages)
├── hooks/
│   ├── useAuth.tsx            — Login/auth state
│   └── useCreatorAuth.tsx     — Creator password protection
├── components/
│   └── CreatorAuthModal.tsx   — Password modal
└── lib/supabase/
    └── ... (database functions)

supabase/migrations/
└── ULTIMATE_FIX.sql           — RUN THIS FIRST
```
