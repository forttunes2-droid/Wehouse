# WeHouse coherence plan (R1–R11)

Goal: make code, Supabase and Vercel agree with each other and with what
WeHouse is documented to be. Every step starts from evidence in the repository
or the live project. Nothing below is assumed; anything that cannot be read
from the repository is marked **verify live**.

> The original R1–R10 list from an earlier chat was lost. This is a fresh list
> built from the repository as of branch `reconcile/readiness-baseline-20261012`.
> R11 is the requirement you added: every part of the product code and its
> arrangement must be able to be excellent.

## What the repository shows today

| Area | Evidence |
|---|---|
| Supabase migrations | 711 files in `supabase/migrations`; no duplicate versions. 516 of them are identical one-line "Historical production migration" stubs that keep the repo aligned with production history (the real SQL is in `supabase/migrations_legacy` and the baseline `20250525000000_remote_schema.sql`). Do not edit or delete them. One name lacks a 14-digit version (`20250526_add_worker_and_location_columns.sql`, also a stub) |
| Older SQL | 886 files in `supabase/migrations_legacy`. Unreferenced stray scripts (repo root, `/migrations`, `public/supabase/migrations`, `src/lib/supabase/migrations`) were moved to `supabase/migrations_legacy/unapplied/` on 2026-10-12 |
| Release tool | `scripts/coordinated-database-release.py` with `plan`, `check` and `apply`. It refuses any host or user except the reviewed production project |
| Release record | `COMPLETED_RELEASES` ends at `20260927101830`. 294 migration files have later versions, so their production state has to be read, not assumed |
| Release workflow | `.github/workflows/supabase-db-password-check.yml`: manual, `check` or `apply`, needs the exact reviewed SHA and both `WeHouse Build Check` and `Consolidation Validation` to pass |
| DB contracts | `supabase/tests`: 55 tracked SQL files (contract and fixture) |
| Edge Functions | 26 functions in `supabase/functions`; `supabase/config.toml` sets `verify_jwt` for only 4 |
| Vercel | `vercel.json` holds CSP, security headers, cache rules and the SPA rewrite. Netlify is deliberately disabled in `netlify.toml`. Project settings and environment variables are not in the repo (**verify live**) |
| Frontend env | `.env.example` lists only `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_APPLE_SIGN_IN_ENABLED`, `VITE_NATIVE_BILLING_ENABLED` |
| Tests | 82 `tests/*.test.mjs` files; audit records 483 passing tests, lint and build |
| Branches | 244 remote branches; main-protection rulesets exist as JSON but are not active until an admin creates them |
| Known gaps | `docs/KNOWN_INCONSISTENCIES.md`, `docs/PRODUCT_READINESS_AUDIT_2026-10-20.md` ("Still unverified" and "Remaining work") |

## The steps

### R1. One source of truth for what WeHouse is
Read `docs/PRODUCT_MASTER.md`, `PRODUCT_RULES.md`, `ROLES_AND_PERMISSIONS.md`,
`DATA_MODEL.md`, `LIFECYCLES.md` and `DECISION_LOG.md`. Build a table of each rule, the code that
implements it and the database object that enforces it. Where docs and code
disagree, record a decision in `DECISION_LOG.md` before changing either.

### R2. Close the known inconsistencies
Work `KNOWN_INCONSISTENCIES.md` by severity (High, then Medium, then Low). Each
item ends with a test, a migration if needed, and the row marked resolved with
the commit.

### R3. Reconcile the branch and pull-request state
Open the pull request for this branch. Go through the 244 remote branches
using `BRANCH_CLEANUP_AUDIT.md`: merge, supersede or delete, and record the
disposition. Ask an admin to activate the main-protection rulesets
(`MAIN_PROTECTION_ROLLOUT.md`).

### R4. Make the migration history trustworthy
1. Read-only first: run `coordinated-database-release.py plan` against production
   through the existing workflow. This shows which of the 294 later files are
   applied, aliased or pending. No guessing.
2. Keep the 13 recorded production aliases. Never rewrite or replay history.
3. Leave the `20250526_*` stub as is: it may already be recorded in production
   history, and renaming it would break alignment. Stray SQL outside
   `supabase/migrations` is already archived (see above).
4. Add a CI check that fails on duplicate versions and on SQL files outside
   `supabase/` (the stub name `20250526_*` is the one allowed exception).

### R5. Release migrations the only safe way
Each change: write the migration, add or update a contract in `supabase/tests`,
get both required checks green, run the workflow in `check` mode (applies the
whole batch and rolls back), then `apply` with the exact reviewed SHA, then run
`plan` again to confirm production history matches the repository prefix.
Never use `supabase db push` or edit applied files. Add each completed
release to `COMPLETED_RELEASES` with its verification note.

### R6. Database security review
Action-by-action RLS, RPC, grant and storage review for each role (the audit's
P0 "before a security claim"). Each finding gets a denied-and-allowed test in
`supabase/tests`.

### R7. Edge Functions
Compare the 26 functions in the repo with those deployed (**verify live**).
For each, record: JWT mode (explicit `verify_jwt` for all, deliberately
disabled only for provider webhooks that verify signatures themselves), the
secrets it needs, and the tests that cover it. Deploy only from the reviewed
commit.

### R8. Vercel
Verify live and record in a doc: production branch, build and output settings,
Node version (24, matching CI and the devcontainer), the environment variables per
environment, and that Preview deployments do not point at the production
database. Compare the CSP `connect-src`, `script-src` and `frame-src` against
what the built app actually calls, using the browser check, and fix both sides
together. Confirm Vercel serves `/offline.js`, `/sw.js` and `/version.json`
with the cache headers in `vercel.json`.

### R9. Frontend structure
Per `WEHOUSE_ARCHITECTURE_CONTRACT.md`: one owner per route and workspace,
remove legacy aliases with measurement, no duplicate components or
data-access paths, one place for each query, strict types with no new lint
suppressions.

### R10. Verify the whole product
Run the role-by-role journey matrix on phone, tablet and desktop in light and
dark; Paystack sandbox and signed-webhook journeys; the signed-in screens still
unverified in the contrast scan; staged load tests on isolated infrastructure.
Record evidence next to each claim in the readiness audit.

### R11. Every part excellent and consistently arranged
Make the standard enforceable rather than a wish:
- Module map: each folder has one responsibility, a documented owner and an
  allowed-imports rule, checked in CI.
- Dead code, unused exports, unused dependencies and unreferenced SQL are
  found by tooling and removed with tests.
- Naming and file layout conventions written once and checked by lint.
- Database objects, TypeScript types, Edge Function contracts and docs are
  generated or cross-checked from one definition where possible.
- Every change must keep `npm run lint`, `npm test`, `npm run build` and the
  Consolidation Validation workflow green.
- Docs are updated in the same pull request as the behavior they describe.

## Order and rules of work
1. R4 step 1 (read-only `plan`) and R8 live verification first, because every
   later claim depends on what is actually deployed.
2. R1 to R3, then R5 to R7, then R9 to R11.
3. One pull request per step, each with its evidence.
4. No production change except through the audited release workflow.
