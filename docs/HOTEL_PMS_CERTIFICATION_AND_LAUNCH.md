# Hotel PMS certification and launch

Status: fail-closed integration contract

Manual WeHouse hotel operations are the supported default. Connected mode is
not a generic toggle and WeHouse must not claim that every hotel PMS can
integrate or will work perfectly.

## Adapter boundary

Each provider is a named, versioned adapter. No provider is seeded as certified.
A hotel may request a connection, but only the service role may activate it
after both the provider and the hotel have passed the gates below.

Connected authority is declared by domain—for example inventory, rates,
reservations or stay status. Domains not delegated to the PMS remain under
manual WeHouse authority. Only one active integration may own a domain for a
hotel.

## Required certification evidence

- Executed vendor/API agreement and approved credential handling.
- Data-processing, privacy, data-location and security review.
- Exact field, status, room, package, rate, tax, refund and timezone mapping.
- Idempotency keys for inbound and outbound events.
- Replay, ordering, retry, dead-letter and reconciliation behavior.
- Sandbox evidence covering create, change, cancel, check-in, checkout and
  inventory/rate conflicts for every delegated domain.
- Monitoring, support ownership, incident response, disablement and rollback.
- Named hotel authorization plus a successful limited pilot.
- Current legal launch approvals for both the hotel marketplace and
  `hotel_pms_connected_mode`.

## Runtime rules

- Requests begin in `requested` or `pending_certification`, never `active`.
- Activation fails unless the named provider version is certified, current
  approvals exist, the hotel is active, credentials are recorded by hash and
  hotel authorization evidence is present.
- Every event has a stable source-system identity and idempotency key.
- Legal approval expiry/revocation pauses connected mode and requires review.
- Manual mode remains available and is the rollback path.

## Current launch state

There are no certified PMS providers. The certification registry and runtime
gates are merged fail-closed, and manual hotel operations remain available. The first
connected launch requires one specifically named provider to complete the full
checklist and end-to-end pilot; later providers repeat the same process.

## Gateway checks added during PR #74 review

The gateway revalidates `hotel_integration_runtime_active` on every request,
including reads through the service role. A token marked active does not override
revoked provider certification, a disabled hotel or expired launch approvals.

Inbound idempotency keys bind to the HTTP method, complete route (including booking
ID) and canonical JSON body. Only completed or explicitly review-required events
can return a successful replay. Pending, failed and mismatched requests return 409;
do not generate a fresh key blindly after a failure. Inspect the event and reconcile
any partial application first. Database errors must not be reported as a completed
acknowledgement. Every catalog domain is authorized before any catalog writes, and
room-status updates require the corresponding delegated domain.

Reservation clients must treat `next_cursor` as opaque and return the entire value
URL-encoded as `cursor`. The v1 cursor contains both the exact update timestamp and
booking ID, so equal-timestamp records are not skipped at a page boundary. Reading
reservations does not update booking delivery fields; doing so would advance the
booking update timestamp and repeatedly deliver the same rows. An explicit
acknowledgement updates the booking's synchronization state.

Catalog batches still use multiple database operations. A runtime failure may
partially apply a batch; the event is marked failed with reconciliation required.
Atomic batch application or proven adapter reconciliation remains a certification
requirement. Automated handler tests use synthetic external I/O and do not certify
a real hotel vendor connection. Production inspection on 2026-09-19 found zero
registered providers, zero certified providers and zero active connections.
