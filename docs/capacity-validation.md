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

The current `refresh_my_roommate_search()` implementation is not a million-user-safe design. It deletes the actor's prior temporary results, scans candidate profiles/preferences, invokes `_roommate_pair_open()` and `_roommate_practical_pair()` for candidates, evaluates duplicate/conversation exclusions, then sorts and writes up to 120 rows. Even though the final result is capped at 120, the candidate work occurs before the cap.

This means a million-user burst must not be described as safe merely because the UI returns 24 cards. The system needs an indexed hard-filter candidate stage and a bounded/queued refresh model before a million-user synchronous refresh can be considered production-safe.

### Required roommate rules before million-user production readiness

1. Hard filters first: State + LGA, active/search-visible status, reciprocal gender compatibility, budget overlap, move-in overlap, smoking boundaries, school constraint when enabled, and room-arrangement compatibility must reduce the candidate set before expensive scoring.
2. No full candidate scan per refresh: the request path must not evaluate the complete active roommate population for each user.
3. Bounded candidate work: expensive compatibility scoring must run only against a bounded candidate window selected by indexed predicates.
4. Refresh throttling: repeated refreshes by the same actor must be coalesced/throttled; pagination must read an existing result set rather than recomputing the search.
5. Background processing for large bursts: million-user refreshes should be queued and processed by workers. Supabase Queues provides a Postgres-native durable queue with guaranteed delivery and is appropriate for this background workload. citeturn0search0turn0search1
6. No client access to privileged queue internals: queue consumers and service operations remain server-side; do not expose service credentials to the mobile/web client.
7. Fairness and abuse limits: one account cannot continuously force expensive recomputation. Rate limits should be applied to refresh/search operations separately from ordinary 24-row reads.
8. Privacy remains a hard filter: blocked, suspended, banned, deleted, hidden, or inactive profiles must never enter the candidate result, regardless of score.
9. Stable pagination: use deterministic keyset ordering for large result sets; do not use unbounded offset scans as the population grows.
10. Match correctness under races: concurrent interest/accept operations must produce at most one mutual match/conversation and must not expose a blocked or withdrawn relationship.

### Release gates

For the million-user roommate burst, record offered versus completed discovery requests, p50/p95/p99 latency, database CPU/IO, locks, connections and queue age, candidate rows examined per actor, expensive compatibility evaluations per actor, result rows written per actor, refresh coalescing/rate-limit counts, cross-account/privacy failures, duplicate match/interest/conversation attempts, and recovery after a database or queue interruption.

A successful result requires both performance and structural correctness. A fast test with incorrect matching, privacy leakage, duplicate matches, or uncontrolled candidate scans is a failure.

The repository now contains `scripts/load-roommate-capacity.mjs`. It is allowlisted to the dedicated WeHouse Test project and deliberately refuses to impersonate a million authenticated actors with a publishable key. Authenticated million-user testing must use disposable test identities/session tokens provisioned by the isolated capacity environment.
