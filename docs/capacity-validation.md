# WeHouse capacity validation

## What “one million users” must mean

Report registered accounts, daily active accounts, concurrent foreground sessions, open Realtime connections, and completed business actions per second separately. One million simultaneous foreground sessions taking one action every 30 seconds means roughly 33,333 actions per second before page resources, session checks, notifications, and chat fan-out. Ten and one hundred million under the same assumption mean roughly 333,333 and 3,333,333 actions per second. A 30-second ramp measures a burst, not steady capacity.

## Current evidence (28 September 2026)

- Hosted WeHouse Test (`qoobnkedfyosnizrlttt`): 1,000 synthetic apartments and 1,000 synthetic hotels/rooms; 0 Auth users. A prior 450-request anonymous catalog run at 1, 2, then 5 requests/s had no errors or dropped work; 5 requests/s p95 was 246 ms.
- Disposable local database: 50,000 homes, 100,000 hotels, 50,000 profiles. A prior 1,560-request mixed catalog read at 2/5/10 requests/s had no errors; a separate 400-client read run found hotel price p95 about 3.96 seconds.
- Neither exercise used signed-in sessions, real booking writes, encrypted message delivery, payment sandbox webhooks, Realtime connections, notification delivery, media/CDN, or a million users. The “million” preset means catalog rows and has not been run.

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

The current `refresh_my_roommate_search()` implementation is not a million-user-safe design. It deletes the actor's prior temporary results, scans candidate profiles/preferences, invokes compatibility functions for candidates, evaluates duplicate/conversation exclusions, then sorts and writes up to 120 rows. The final limit does not prevent the candidate work before the cap.

Before a million-user synchronous refresh can be considered production-safe, WeHouse needs indexed hard-filter candidate selection, bounded expensive scoring, refresh throttling/coalescing, and queued background processing for large bursts.

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

The repository contains `scripts/load-roommate-capacity.mjs`, allowlisted to the dedicated WeHouse Test project. It deliberately refuses to impersonate a million authenticated actors with a publishable key. Authenticated million-user testing requires disposable test identities/session tokens in the isolated capacity environment.
