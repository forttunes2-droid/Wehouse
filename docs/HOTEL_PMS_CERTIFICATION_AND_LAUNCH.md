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
