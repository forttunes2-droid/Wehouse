# WeHouse Security Audit

**Date:** 2026-05-26
**Platform:** WeHouse Housing Platform
**Owner:** Creator Admin (forttunes2@gmail.com)

---

## 1. FINDINGS & REMEDIATIONS

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | Hardcoded Supabase anon key in source code | **HIGH** | **FIXED** |
| 2 | No .env file or .env.example present | MEDIUM | **FIXED** |
| 3 | .env not in .gitignore | MEDIUM | **FIXED** |
| 4 | No TypeScript declarations for env vars | LOW | **FIXED** |

---

## 2. ENVIRONMENT VARIABLES

| Variable | Required | Purpose | Source |
|----------|----------|---------|--------|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL | Project Settings > API |
| `VITE_SUPABASE_ANON_KEY` | Yes | Public anon key (RLS-scoped) | Project Settings > API |

**Security Note:** The anon key is a PUBLIC client key. Row Level Security (RLS) is the protection layer, not key secrecy. The service_role key must NEVER be used in client code.

---

## 3. ROLE ARCHITECTURE

```
creator  (3)  -- highest, cannot be changed/deleted
  |
admin    (2)  -- can modify staff and users
  |
staff    (1)  -- can modify users only
  |
user     (0)  -- regular user, student, tenant
worker   (0)  -- future: service provider
```

### Creator Protection
- Creator role cannot be changed by anyone (including creator self)
- Creator account cannot be deleted
- Creator-only settings: maintenance mode, registration toggle, max listings
- Only creator can assign creator role to others

### Permission Matrix (`canModifyRole`)
| Modifier | Can modify creator? | Can modify admin? | Can modify staff? | Can modify user? |
|----------|-------------------|-------------------|-------------------|------------------|
| creator  | Yes               | Yes               | Yes               | Yes              |
| admin    | No                | No                | Yes               | Yes              |
| staff    | No                | No                | No                | Yes              |
| user     | No                | No                | No                | No               |

---

## 4. EXTERNAL SERVICES AUDIT

| Service | Type | Purpose | Status |
|---------|------|---------|--------|
| Supabase | Database/Auth/Storage | Core backend | **APPROVED** |
| Nigeria location data | Local JSON | 36 states + 260+ cities | **APPROVED** (no API) |
| placehold.co | Placeholder images | Empty listing fallback | **APPROVED** (public CDN) |

### BLOCKED / NOT FOUND
- [x] No Google Analytics
- [x] No Mixpanel / Amplitude
- [x] No Sentry / Datadog
- [x] No Segment
- [x] No Hotjar
- [x] No third-party tracking scripts
- [x] No telemetry
- [x] No webhooks
- [x] No background services

---

## 5. ADMIN ROUTE PROTECTION

| Route | Required Role | Enforced |
|-------|--------------|----------|
| `/` (home) | any authenticated | Yes (auth gate) |
| `/creator` | creator / admin / staff | Yes (`hasAdminAccess`) |
| `/profile` | any authenticated | Yes (auth gate) |
| `/new_listing` | admin only | Yes (`isAdmin` flag) |
| `/privacy` | any authenticated | Yes (auth gate) |
| `/security` | any authenticated | Yes (auth gate) |
| `/account` | any authenticated | Yes (auth gate) |

### Bottom Nav Protection
- Admin nav shows "Admin" tab (creator/admin/staff)
- Users see "Profile" tab instead
- No direct URL navigation possible (SPA routing)

---

## 6. DATA STORAGE

| Data Type | Location | External? |
|-----------|----------|-----------|
| User profiles | Supabase PostgreSQL | No |
| Listings | Supabase PostgreSQL | No |
| Images | Supabase Storage (`listing-images`, `avatars`) | No |
| Auth sessions | Supabase Auth | No |
| Chat messages | Supabase PostgreSQL + Realtime | No |
| Audit logs | Supabase PostgreSQL | No |
| Session history | Supabase `user_activity` table | No |

**All data stays within the Supabase project.** No external sync, no hidden uploads.

---

## 7. DATABASE SECURITY

### Row Level Security (RLS)
- All tables have RLS enabled
- Users can only read/write their own data
- Admin queries use `service_role` (server-side only)
- `profiles_select` policy: `auth_id = auth.uid()::text`

### Key Constraints
- `profiles.user_id` — UNIQUE
- `profiles.auth_id` — UNIQUE  
- `profiles.email` — UNIQUE
- `profiles.username` — UNIQUE
- `roommate_preferences.user_id` — UNIQUE (upsert on conflict)
- `listings.listing_id` — UNIQUE

---

## 8. AUTH FLOW

```
1. User opens app
2. getSession() checks for active session
3. If session exists:
   a. Lookup profile by auth_id
   b. If found + linked → dashboard
   c. If found by email → link + dashboard
   d. If not found → create new profile → setup
4. If no session → login page
5. Login/signup creates Supabase Auth session
6. sessionStorage stores auth state
7. Logout clears session + reloads page
```

### Security Measures
- PKCE flow for OAuth (no secret in URL)
- 8-second timeout on getSession()
- Auto session refresh enabled
- `signOut({ scope: 'global' })` — kills all sessions
- Session end tracked in `user_activity` table

---

## 9. FILE MANIFEST

| File | Purpose | Secrets? |
|------|---------|----------|
| `src/lib/supabase.ts` | Supabase client + API helpers | No (uses env vars) |
| `src/hooks/useAuth.ts` | Auth state + session management | No |
| `src/App.tsx` | Root component + routing | No |
| `src/pages/` | Page components | No |
| `src/types/` | TypeScript types | No |
| `src/data/nigeria-locations.ts` | Static location data | No |
| `src/components/LocationSelector.tsx` | Location UI | No |
| `.env` | Environment variables (gitignored) | **YES — keep local** |
| `.env.example` | Template (safe to commit) | No |

---

## 10. DEPENDENCIES

| Package | Purpose | Version |
|---------|---------|---------|
| react | UI framework | ^19.0.0 |
| react-dom | DOM renderer | ^19.0.0 |
| @supabase/supabase-js | Database/Auth/Storage | ^2.49.0 |
| tailwindcss | CSS utility | ^3.4.19 |
| sonner | Toast notifications | ^2.0.0 |
| lucide-react | Icons | ^0.469.0 |
| vite | Build tool | ^7.2.4 |
| typescript | Type system | ~5.7.0 |

**No analytics, no tracking, no unnecessary dependencies.**

---

## 11. OWNER CHECKLIST

To take full ownership:

1. [ ] Rotate Supabase anon key (Project Settings > API > Anon Key > Regenerate)
2. [ ] Update `.env` with new key
3. [ ] Enable 2FA on Supabase account
4. [ ] Review RLS policies in Supabase Dashboard
5. [ ] Set up database backups (Supabase > Database > Backups)
6. [ ] Review connected GitHub integration
7. [ ] Set strong password on Supabase account
8. [ ] Run the SQL migration: `UPDATE profiles SET role = 'creator' WHERE role = 'creator_admin';`

---

**Audited by:** Code audit on 2026-05-26
**Next audit:** Recommended quarterly
