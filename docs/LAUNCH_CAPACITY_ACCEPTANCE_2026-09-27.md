# WeHouse capacity acceptance, 27 September 2026

This is a release gate, not a capacity certificate. Build and migration checks prove correctness for their fixtures. They do not establish throughput, tail latency, failover or 20–50 million-user capacity. Registered accounts, monthly active users, simultaneous connected devices and requests per second are different measures.

## Workloads to measure

| Demand at one instant | Expected behavior | Test focus |
|---|---|---|
| 400,000–1,000,000 people view one home | Public detail and media mostly use an allowed shared cache; personalized state and checkout stay private. | Cache hit ratio, origin reads, media bandwidth, p95/p99 response, errors and cost. |
| 1,000,000 people request 50 properties | About 20,000 contenders per property if evenly distributed. Browsing fans out; booking serializes contested inventory and rejects or waits boundedly. | Per-property/date contention, stale quotes, payment conflict/refund, lock wait and pool exhaustion. |
| 500,000 or 1,000,000 people request different properties | Fewer per-record locks, but aggregate API, database, Auth, Realtime, payment and image throughput can still saturate. | Sustained requests per second, connections, quotas, queue depth and recovery. |
| Many people message, follow searches and check Activity | Only intended recipients receive events; missed live delivery is recovered from durable records. | Concurrent sockets, messages per second, write amplification, unread reconciliation and workspace authorization. |

One million requests over one minute average about 16,667 requests/second; over ten minutes, about 1,667 requests/second. “At the same time” needs a burst window and a mix of reads, writes, media, login and payment calls before it can be tested.

## Current code and limits

- Short Let reservation creation takes a transaction advisory lock per listing; paid fulfilment checks overlapping dates under the same lock. Later paid conflicts are recorded for refund handling. A million contenders on one listing would form a long queue; the lock protects correctness, not throughput. Long Let uses listing state/current reservation; hotels use dated room capacity. Verify all with parallel payment/cancellation traffic.
- Homes discovery calls `get_discoverable_listings` and filters the returned collection in the browser. Hotels discovery calls `getHotels` and filters client-side. Large catalogues/traffic need bounded server-side indexed search and a cache policy.
- Saved places loads each exact home or hotel with up to four concurrent requests per user. This keeps saved items visible but multiplies reads; replace it with a batched, ownership-scoped projection before scale.
- Followed-search matching runs in database publication triggers, writes deduplicated personal Activity, and can slow publication when many followers match. Move fanout to a durable outbox/queue with bounded workers, retries and idempotency, then measure it.
- The personal App has broad `postgres_changes` subscriptions on message tables; Activity audiences are filtered by recipient. Broad live streams and repeated unread fanout are costly at high traffic. Use recipient-targeted delivery and durable reconnect reconciliation before high concurrency.
- Connection budgets, query plans, Realtime quotas, function limits, payment provider limits and media transfer must be measured for the actual production configuration. Vendor-wide benchmark results do not certify WeHouse.

## Gate for each growth stage

1. Model anonymous discovery/detail/media, authenticated booking/payment, hotel capacity, service jobs, roommate matching/chat, inbox/Activity and followed-search publication. Include hot-property skew, retries, slow PSP callbacks and reconnect storms.
2. Test real APIs and the database in isolated staging with production-like data and compute. Ramp gradually; record offered/accepted requests per second, p50/p95/p99 latency, errors, lock waits, CPU, memory, I/O, connections, Realtime disconnects, queue age and cost. Use approved PSP test mode and coordinate major tests with providers.
3. Enforce parallel-client invariants: no overbooked unit/date or double withdrawal; no duplicate charge/fulfilment; late payment has visible conflict and tracked refund; no cross-account/workspace data; inbox/Activity catches up after reconnect.
4. Set explicit thresholds for a specific stage before testing. Pass only after sustained load, burst, provider outage, retry storm, backup restore and rollback drill meet them. Repeat when data volume, plan, provider or product mix changes. Do not claim 20–50 million-person support without evidence and vendor capacity commitments.

Official references: [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod), [database pooling and limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits), [Realtime limits](https://supabase.com/docs/guides/realtime/limits), [Vercel function concurrency](https://vercel.com/docs/functions/concurrency-scaling).
