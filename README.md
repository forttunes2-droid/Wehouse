# WeHouse

WeHouse is a housing and home-services platform. People can discover homes and
hotels, make and manage reservations, find roommates, request home services,
communicate, and follow booking activity. Property partners, service providers,
hotel teams, and WeHouse operations use scoped workspaces over shared product
records.

## Project status

This repository contains a substantial application, database, and regression
test suite; it is not a blank starter project. A successful build or CI run is
evidence only for the checks that ran. It does not by itself establish legal or
provider readiness, production deployment, disaster recovery, or capacity for
any particular number of users.

In particular, million-user capacity is **not certified**. The current capacity
document describes outstanding workload, load-test, reliability, and cost
gates: [capacity acceptance](./docs/LAUNCH_CAPACITY_ACCEPTANCE_2026-09-27.md).
Do not represent WeHouse as production-ready or able to serve a stated scale
until its release gates have passed with production-like infrastructure and
evidence.

## Technology

- React, TypeScript, and Vite for the web application.
- Supabase Postgres, row-level security, RPCs, Storage, Realtime, and Edge
  Functions for application data and backend behavior.
- Capacitor for the Android and iOS application shells.
- Node's built-in test runner, TypeScript build checks, ESLint, and browser
  regression workflows for automated validation.

## Run locally

Use a supported Node.js and npm version for the dependencies in
[`package-lock.json`](./package-lock.json). From the repository root:

```sh
npm ci
cp .env.example .env
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env` to a
dedicated local or test Supabase project. Keep real credentials out of source
control, and do not use production credentials for local development. Optional
providers and native billing remain disabled by default; configure them only
when their documented launch requirements are met.

Start the web app:

```sh
npm run dev
```

For a disposable local database (Docker and the pinned Supabase CLI required),
use the baseline-aware commands:

```sh
node scripts/disposable-supabase.mjs start
node scripts/disposable-supabase.mjs reset
```

The original schema-only snapshot omitted Storage bucket rows. The runner
starts/resets local platform infrastructure, provisions the reviewed bucket
metadata without overwriting existing settings, and then applies the original
migration files. It rejects remote targets and restores migration sources after
command failures. Bucket configuration is in
[`supabase/bootstrap/storage-buckets.sql`](./supabase/bootstrap/storage-buckets.sql).
This does not provision a hosted project or copy any customer data or files.

Run the available automated checks:

```sh
npm test
npm run lint
npm run build
```

The build runs TypeScript project checks before producing the Vite web bundle.
Native release preparation commands are available in `package.json`; review
the native release and store checklists before using them.

## Repository map

- [`src/`](./src/) — application routes, workspaces, shared UI, and Supabase
  adapters.
- [`supabase/`](./supabase/) — database migrations, Edge Functions,
  configuration, and SQL contract tests. Database changes must follow the
  repository's migration and coordinated-release process.
- [`tests/`](./tests/) — Node contract tests and browser regression fixtures.
- [`scripts/`](./scripts/) — release, migration, and capacity-test helpers.
- [`.github/workflows/`](./.github/workflows/) — automated validation and
  release-related workflows.
- [`android/`](./android/) and [`ios/`](./ios/) — Capacitor native projects.
- [`docs/`](./docs/) — product decisions, architecture, release gates, and
  current investigations.

## Product and release references

The full, ordered list of authoritative documents is in [docs/README.md](./docs/README.md).
Start with the accepted product rules and recorded decisions, then check the
implementation and release evidence before changing behavior:

- [Product rules](./docs/PRODUCT_RULES.md) and [decision log](./docs/DECISION_LOG.md)
- [Product implementation audit and current status](./docs/PRODUCT_MASTER.md)
- [Known inconsistencies and safe migration order](./docs/KNOWN_INCONSISTENCIES.md)
- [Release roadmap](./docs/WEHOUSE_RELEASE_ROADMAP.md) and [R1–R11 operating model](./docs/WEHOUSE_OPERATING_MODEL_R1_R11.md)
- [Capacity acceptance gates](./docs/LAUNCH_CAPACITY_ACCEPTANCE_2026-09-27.md)
- [Payment and money rules](./docs/PAYMENTS_AND_MONEY.md)
- [Native release checklist](./docs/native-release.md)

The older product audit and dated investigations are evidence snapshots, not
live deployment status. Confirm current database, provider, legal, and
deployment state before treating a documented check as complete.
