# WeHouse Profile Workflow Consolidation

This branch consolidates Profile and Account behavior across User, Worker, Property Partner, Staff, Admin and Creator.

## Shared account profile
- One safe self-update RPC for personal fields.
- Database-generated WeHouse user IDs for new accounts.
- No browser-side auth relinking by email.
- Staff/Admin can edit personal information while operational assignment remains protected.
- One avatar upload path owned by the authenticated user.

## Privacy and account settings
- One meaning per privacy flag: profile, search, activity, email and phone.
- Simplified Account Center.
- Unified role-aware Settings page.
- Payout accounts stored in `bank_accounts`, not public profiles.
- Account closure uses the existing server-side role/obligation checks.

## Worker separation
- Personal location is not overwritten by service coverage.
- Worker coverage stored in `worker_service_coverage`.
- Professional information and private verification evidence are submitted through secured RPCs.
- Government ID, certificates and verification videos are stored in private buckets as object paths.
- Payment remains separate from manual submission and approval.

## Role-specific data security
- `staff_permissions`: public write access removed; LGA-scoped RPC used for changes.
- `property_partners`: public read/update removed; owner and authorized staff reads only.
- `worker_services`: owner-managed, public only for verified active workers.
- `bank_accounts`: RLS enabled; owner reads and secured update RPC.
- Avatar writes restricted to the authenticated user's folder.

## Deployment order
1. Merge this branch after CI passes.
2. Apply the new `20260807_*` migrations in filename order.
3. Deploy the merged `main` branch through Vercel.
4. Test all six roles before marking the phase live.
