# Release blocker investigation — 2026-10-01

## Measured baseline
Latest completed baseline f9e4edc1: disposable local catalog of 500,000 homes and 50,000 hotels, 3,601 synthetic Auth users. The 3,000-user booking burst completed without errors but p95 was 43.43 seconds. This is correctness evidence, not launch capacity approval.

The harness starts all journeys together and caps transport at 300 HTTP sockets. Its journey latency includes client transport waiting, gateway/database waiting and two sequential RPCs. New per-RPC transport-queue, response and total p95 metrics keep those contributions visible. Response time includes hosted stack waiting, not pure SQL execution.

## Change under evaluation
Availability quotes previously used the same room-row FOR UPDATE lock as authoritative booking creation. Read quotes now use the same calculation without the write lock. Existing private booking entry points retain the lock and recheck inventory before reserving. Quotes remain advisory and cannot guarantee a reservation. Existing cancellation, migration replay and concurrent capacity tests must pass; a new burst result is required before reporting any latency improvement.

## Provider and launch gates
Vercel's commit status explicitly reports “Account is blocked.” The connector exposes no unblock operation or detailed account notice. The account owner must use the Vercel dashboard/official support process: https://vercel.com/knowledge/why-is-my-account-deployment-blocked . No cause such as billing or abuse is assumed from this generic message.

Real Paystack sandbox checkout/refund/webhook reconciliation, real two-account/device sessions and hosted representative load remain unverified. Do not treat local mocks or SQL rollback contracts as substitute evidence.

A million registered users is not a concurrency or throughput target. Before production launch record peak booking/read RPS, active-session assumptions, regional latency objectives, Supabase compute/pool limits, vendor quotas and approved spend. Run staged hosted soak/burst tests on disposable representative infrastructure; record p95/p99, errors, pool saturation, lock waits, CPU/IO and recovery. Keep rollout limited to measured sustainable capacity, with monitoring, rollback and financial reconciliation. No claim of million-user readiness is supported yet.

No production migration, merge, payment/refund or deployment is performed by this change.
