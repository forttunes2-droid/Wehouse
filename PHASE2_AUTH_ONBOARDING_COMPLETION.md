# Phase 2 — Authentication & Onboarding Completion

Date: 2026-08-14
Branch: `agent/phase-1-foundation`

## Scope

Registration, email/password login, Google OAuth flow, profile creation/completion, role routing, session persistence, multi-device behavior, account-state blocking, password recovery wiring, and production-safe identity ownership rules.

## Canonical post-auth destinations

| Account state | Destination |
|---|---|
| User, incomplete profile | Setup |
| User, complete profile | Home |
| Worker, incomplete or complete profile | Worker activation dashboard |
| Property Partner, incomplete profile | Setup |
| Property Partner, complete profile | Property Partner workspace |
| Staff, complete profile | Staff workspace |
| Admin, complete profile | Admin workspace |
| Creator, complete profile | Creator workspace |
| Suspended / banned / deleted | Sign-in, entry denied |

Workers intentionally enter their dashboard immediately. Professional profile setup is an action inside the activation workspace; the Worker does not get a second competing dashboard.

## Registration rules verified

- Public registration may create only `user`, `worker`, or `property_partner`.
- Public registration cannot create `staff`, `admin`, or `creator`.
- Profile creation is keyed to the authenticated `auth.uid()` and is idempotent by `auth_id`.
- A new profile cannot be created if the authenticated email is already attached to a different WeHouse Auth identity.
- Property Partner signup creates exactly one corresponding `property_partners` record.
- Historical authenticated identities without profiles are not deleted; when they return, the current login flow asks them to choose a valid public role and creates the profile securely.

## Profile completion verified

- User setup can set username + State + LGA and mark the profile complete.
- `update_my_profile` rejects unsupported/privileged fields.
- Worker professional profile completion now accepts the Worker fields used by the frontend (`worker_occupation`, `worker_skills`, `worker_price`, `worker_bio`, country/location) only for Worker accounts.
- Non-Workers cannot mutate Worker professional fields through the profile RPC.
- Once a profile is complete, self-service profile updates cannot revert it to incomplete.

## Sessions verified

- Supabase client persists sessions, auto-refreshes tokens, and handles PKCE callback state.
- Removed `trg_invalidate_old_sessions`; signing in on one device no longer deactivates all other devices.
- Rollback QA inserted two device sessions for one test identity and both remained active simultaneously.
- Explicit logout deactivates the current local WeHouse session.
- If a specific device session is later revoked/inactivated, that device returns to sign-in with a device-specific message.

## Account-state protection

- Suspended/banned/deleted flags are readable by the account itself so the frontend can explain the denial.
- Suspended profiles cannot mutate their profile through `update_my_profile`.
- `useAuth` signs banned/suspended/deleted identities out locally and does not route them into setup or dashboards.

## Provider evidence

The live Supabase Auth dataset contains successful email/password and Google identities/sign-ins. The frontend uses the same Supabase client for both providers.

## Supabase plan note

The current Supabase organization is on the Free plan. Supabase leaked-password screening is therefore not available as a project feature on the current plan. WeHouse still enforces the application-level minimum password length in signup/reset UI; plan-level leaked-password screening can be enabled after upgrading to a plan that supports it.

## Legal-consent note

The newer legal acceptance timestamps post-date the existing installed user base, so legal re-acceptance is a platform-wide migration/policy issue rather than a Worker-only routing rule. Do not block only Workers while legacy Users/Partners/operations accounts remain grandfathered. Handle this as one platform-wide legal-consent migration.

## Deployment verification

Phase 2 commits build successfully on the Vercel preview branch. An intermediate experimental `home` auth-state rename failed TypeScript and was immediately superseded by a READY compatibility commit; it is not the branch head.

Interactive signed-in browser testing with real account credentials remains part of the full QA phase. The execution environment used during this audit blocks direct Chromium network access to the protected Vercel preview, so no false browser-pass claim is recorded here.
