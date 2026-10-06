# WeHouse capacity validation

## What “one million users” must mean

Report registered accounts, daily active accounts, concurrent foreground sessions, open Realtime connections, and completed business actions per second separately. One million simultaneous foreground sessions taking one action every 30 seconds means roughly 33,333 actions per second before page resources, session checks, notifications, and chat fan-out. Ten and one hundred million under the same assumption mean roughly 333,333 and 3,333,333 actions per second. A 30-second ramp measures a burst, not steady capacity.

## Current evidence and what it proves

- Hosted WeHouse Test (`qoobnkedfyosnizrlttt`): 1,000 synthetic apartments and 1,000 synthetic hotels/rooms; 0 Auth users. A prior anonymous catalog run had no errors at the tested rates; this is a small functional smoke result, not a scale proof.
- Disposable local capacity smoke: the current launch fixture contains 500,000 homes, 500,000 hotels/rooms and 500,000 synthetic profile rows. The booking harness provisions 3,601 real synthetic Auth users and exercises real authenticated hotel quote/booking RPCs plus a 20-attempt contention check. This is useful for query/index/transaction correctness and runner behavior, but it is NOT evidence that WeHouse supports millions of concurrent users.
- The repository's old `million`/`full` presets are fixture-size presets, not claims about concurrent-user capacity. They must not be described as a million-user test.
- The final requested target remains separate: 6,000,000 synthetic profiles, 7,000,000 listings, 700,000 simultaneous booking attempts and 1,000,000 authenticated roommate-discovery attempts. That target has NOT been validated yet.

## Required mixed journey in an isolated capacity environment

Create disposable, confirmed synthetic Auth accounts with customer, Property Partner, Hotel Team, Worker, and staff grants. Seed distinct available room nights and homes, conversations and encryption keys for actor pairs, and a processor sandbox that can replay success, duplicate, delayed, and failed callbacks. Do not run the write workload against production or real customers. Tag every generated record for cleanup; never use live payment credentials.

Use a stated traffic mix and record per-journey outcomes. Initial proposed mix: 55% discovery/detail and media; 10% sign-in/session restoration; 15% booking availability, reservation and competing checkout; 10% Inbox open, private message send/read and reconnect; 5% sandbox payment plus webhook reconciliation; 5% cancellation, refund review, notifications and receipt. Measure the browser as well as API/RPC and database. Count all downstream requests per journey, including the current session guard and unread-summary calls. Measure connected but idle users separately from actively sending users.

Run a preflight with 10 actors, then 100 and 1,000, sustaining each step for at least 10 minutes and repeating a one-hour soak after stability. Increase only after the previous stage meets the gate. Larger stages require measured per-session cost, load generators in multiple regions, capacity and budget agreements with Supabase, Vercel, Realtime, and the payment provider. A 1m→10m→100m simultaneous-user ramp every 30 seconds is not an acceptable capacity proof or a safe test on this Test project.

Proposed release gates to agree before a run: observed request rate within 5% of offered load; unexpected journey failures under 0.1%; p95 public discovery under 2 seconds and p95 authenticated booking/message operations under 3 seconds; no double-booked room night or duplicated payment/refund under races and webhook replay; no message cross-account disclosure; no unreconciled paid booking; and a recovery drill after a database or Realtime interruption. Record p99, queue age, DB CPU/IO, locks, connection and Realtime limits, egress, CDN hit rate, and per-journey cost. Exclude expected policy rejections from the error numerator but report them separately.

## Known scale blockers to address before large stages

- The signed-in app refreshes unread summaries with several database calls and a 60-second fallback. Session guarding reads a user session about every 30 seconds and writes last-seen for an active one. Even idle foreground users therefore generate sustained database work.
- Chat currently uses Postgres Changes subscriptions on message tables, some without recipient filters. A conversation has a scoped subscription; the global Inbox and app counters still need a user-targeted delivery design. Supabase recommends private Broadcast for larger Realtime workloads. Verify authorization and delivery under reconnect before replacing the current path.
- Test has no Auth users, so an authenticated mixed load result cannot honestly be reported yet. Payment sandbox webhooks and representative actors must be installed and verified before that run.

Reference: [Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits) and [database change delivery guidance](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes).


## Roommate million-user capacity gate

The roommate workload is tested independently because its scaling characteristics differ from booking.

Target:
- 6,000,000 synthetic profiles in the isolated capacity database.
- 1,000,000 users attempting roommate discovery once in the same burst.
- 24-result page reads, pagination, interest/accept races, block/privacy checks, and reconnects.
- A separate refresh-search workload that exercises the real `refresh_my_roommate_search()` RPC.

### Current architectural blocker

The current `refresh_my_roommate_search()` has now been structurally bounded: indexed hard filters run before compatibility scoring, scoring is capped to 1,000 candidates, and only the top 120 persisted results are written. This fixes the unbounded candidate-work problem and is covered by the roommate contract tests.

It is still NOT a million-user synchronous-refresh proof. Before that scale can be considered production-safe, WeHouse needs refresh throttling/coalescing and durable background processing for large refresh bursts, plus a distributed authenticated load environment. The final test must exercise real session tokens and the real refresh RPC; a publishable key cannot impersonate one million users.

### Required roommate rules

1. Hard filters first: State + LGA, active/search-visible status, reciprocal gender compatibility, budget overlap, move-in overlap, smoking boundaries, school constraint when enabled, and room arrangement.
2. No full candidate scan per refresh.
3. Expensive compatibility scoring only against a bounded candidate window.
4. Repeated refreshes are throttled/coalesced; pagination reads persisted results instead of recomputing.
5. Large refresh bursts are processed through a server-side durable queue.
6. Queue internals and service credentials are never exposed to clients.
7. Refresh/search rate limits are separate from ordinary 24-result reads.
8. Blocked, suspended, banned, deleted, hidden, or inactive profiles remain hard exclusions.
9. Large result pagination uses deterministic keyset ordering rather than unbounded offsets.
10. Concurrent interest/accept operations must produce at most one mutual match/conversation and never leak a blocked or withdrawn relationship.

### Release gates

Record offered/completed requests, p50/p95/p99 latency, DB CPU/IO, locks, connections, queue age, candidate rows examined, compatibility evaluations, result writes, throttling/coalescing, privacy failures, duplicate match/interest/conversation attempts, and recovery after interruption. Performance alone is not sufficient; matching correctness and privacy must also pass.

The repository contains `scripts/load-roommate-capacity.mjs`. Its page mode can measure the persisted-match read path against the dedicated Test project, but it deliberately refuses to claim authenticated million-user capacity or run refresh mode without disposable actor sessions. The large run must be a distributed/sharded capacity exercise with disposable identities/session tokens and explicit infrastructure limits.


## Capacity test policy

The capacity workflow named `Disposable capacity smoke — not production-scale proof` is intentionally a merge-safe smoke gate. It must remain bounded enough to run on a disposable CI runner and must never be renamed or described as a million-user test merely because fixture counts increase.

The requested large-scale validation is a separate release gate. It must use an isolated capacity environment, multiple load-generator workers, authenticated disposable actors, staged ramps, database/connection/Realtime/payment telemetry, and cleanup. If those prerequisites are unavailable, the correct result is **not validated**, not a green synthetic substitute.
