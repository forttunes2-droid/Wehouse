# Roles and Permissions

## Purpose

This contract separates a person's identity from the workspaces and capabilities granted to that person. Authorization must be based on the actor, action, record relationship, assignment, and scope—not on which screen the actor managed to reach.

## CURRENT IMPLEMENTATION

### Identity sources

| Source | Current meaning | Evidence |
|---|---|---|
| `profiles` | Personal record, account health, `role`, `account_kind`, worker fields and location | schema and checks across `supabase/migrations`; `src/App.tsx` |
| `workspace_role_assignments` | Revocable Staff/Admin/Creator grants with global/state/branch scope | `get_my_workspace_access()` in live schema; workspace migrations |
| `hotel_team_members` | Per-hotel owner-invited `manager` or `staff` assignment | `owner_invite_hotel_team_member`, `respond_to_hotel_team_invitation`, `current_actor_hotel_role` |
| Worker verification records | Evidence and review state required for worker marketplace capability | `worker_verifications`, `worker_identity_checks`, `worker_verification_reviews`; `WorkerWorkspaceModern.tsx` |

`get_my_workspace_access()` returns identity (`user_id`, `account_kind`), a personal-workspace flag only when `account_kind = consumer`, Staff/Admin/Creator assignments, and a synthetic `hotel` workspace when an active hotel-team membership exists. `src/App.tsx` maps the hotel workspace to an effective frontend role named `hotel_staff`.

The implementation still reads `profiles.role` in many RLS helpers and components. This means `profiles.role` is simultaneously a legacy account classification and an authorization input, while assignment tables are the newer grant model.

### Actors

| Actor | Current implementation | Canonical responsibility |
|---|---|---|
| User | `profiles.role=user`, usually `account_kind=consumer`; personal workspace | Personal discovery, bookings, payments, roommate and service relationships |
| Service Worker | Profile worker status plus verification records; dedicated worker workspace | Perform services only after verified/active; retain personal identity |
| Property Partner | `profiles.role=property_partner`; partner shell and owned records | Submit and operate owned/assigned supply; never self-approve publication |
| Field Operations | Staff with `field_officer` permission and geographic assignment | Collect independent field evidence and execute assigned visits/handover |
| Worker Operations | Staff with `verification` permission (displayed as Worker Operations) | Review worker identity/profile/evidence and govern activation |
| Operations staff | Staff with `operations` permission and scope | Review access, coordinate supply/bookings and cases within scope |
| Finance staff | Staff with `finance` permission and scope | Review payments/payouts/ledger through finance RPC/read models |
| Admin | Workspace assignment and/or legacy profile role; scoped in many helpers | Scoped governance, assignment and approval; not universal by screen |
| Creator | Global platform authority in current helpers | Global governance and exceptional approvals; actions must be audited |
| Hotel owner | `hotels.owner_id`; role returned by `current_actor_hotel_role` | Commercial policy, team, inventory and hotel operations |
| Hotel manager | Active `hotel_team_members.hotel_role=manager` | Manage policy, room/inventory/team as explicitly delegated |
| Front desk / hotel staff | Active `hotel_role=staff` | Day-of-stay operations, guest communication, room readiness/check-in/out |

### Live hotel access verification

The following matrix is derived from the live policies and SECURITY DEFINER helpers on 2026-09-11. “Active public” means the record belongs to an active hotel and contains only fields exposed by the table/RPC projection. “Scoped” means `current_actor_in_scope(state, city)` where the helper applies it.

| Actor | Hotel record | Booking record | Room type/rate/inventory | Physical room unit | Guest conversation |
|---|---|---|---|---|---|
| Anonymous | **Entire active `hotels` table row through direct SELECT, including exact/internal columns when populated; cannot execute `get_public_hotel_detail`** | None | Entire active room-type and inventory rows; no direct rate-plan SELECT | None | None |
| User without booking | Entire active hotel row through direct policy; masked detail RPC is available but can be bypassed | Own bookings only | Active room/inventory rows and active rates | None | None |
| Paid guest | Active row; may read an inactive previously booked hotel; detail RPC intentionally reveals exact location, although active-row direct access already defeats that distinction | Own booking | Hotel detail/rates for the stay | None | Own paid confirmed/checked-in conversation; history remains readable later |
| Hotel owner | Owned hotel, including non-public | Bookings at owned hotel | Owned hotel operations | Owned units | May read/send in an existing eligible booking conversation, but cannot create it through the guest-only open RPC |
| Hotel manager | Assigned hotel | Bookings at assigned hotel | Assigned hotel operations | Assigned units | RLS allows an existing assigned-team conversation, but UI does not consistently expose Inbox and manager cannot create the thread |
| Front desk | Assigned hotel | Bookings at assigned hotel | Assigned hotel operations | Assigned units | UI exposes Inbox when `access_role=staff`; may use an existing thread but cannot create it |
| Field/Worker Ops | Active public hotels; inactive hotel/booking only if the actor also has Operations permission and geographic scope | Scoped only when Operations permission exists | **Direct room/inventory policies currently allow any active Staff without scope** | None | Only when booking helper recognizes scoped Operations access |
| Operations | Active public plus scoped internal hotels | Scoped hotel bookings | Scoped rate plans, but room/inventory direct policies are broader than scope | **None by current unit policy** | Scoped booking conversations |
| Admin | Active public plus scoped internal hotels | Scoped hotel bookings | **Room/inventory direct policies are unscoped; rates are scoped** | **None by current unit policy** | Scoped booking conversations |
| Creator | All hotels and bookings | All | All room/rate/inventory | **None by current unit policy** | All booking conversations through participant/access helper |

Evidence: live policies and role grants on `hotels`, `hotel_bookings`, `hotel_rooms`, `hotel_rate_plans`, `hotel_inventory_daily`, `hotel_room_units`, `hotel_booking_conversations`, and `hotel_booking_messages`; helpers `current_actor_can_read_hotel_record`, `current_actor_can_read_hotel_booking_record`, `current_actor_hotel_role`, and `get_public_hotel_detail`. Live privilege checks show `get_public_hotel_detail` is executable by `authenticated`, not `anon`. RLS limits rows, not selected columns, so a full-row active-hotel SELECT bypasses RPC field masking.

### Hotel action permissions currently encoded

| Domain action | Current actor rule | Evidence |
|---|---|---|
| Set stay times | Owner or manager | `partner_update_hotel_stay_policy` |
| Edit a physical room unit | Owner, manager, or staff; never occupied | `partner_update_hotel_room_unit` |
| Check in / check out | Owner or staff; **manager excluded** | `partner_transition_hotel_booking` |
| Invite/revoke team | Owner | team RPCs in hotel operations migrations |
| Open guest chat | Guest only; paid and confirmed/checked-in | `open_my_hotel_booking_conversation` |
| Send guest-chat message | Any actor who can access thread; stay still paid and confirmed/checked-in | `send_hotel_booking_message` |

## INCONSISTENCIES / LEGACY BEHAVIOUR

1. `profiles.role` and workspace grants both authorize actions. Revoking an assignment cannot be trusted if a stale profile role still grants the same access.
2. Consumer personal workspace is disabled for worker/property-partner account kinds, so “one person with several capabilities” is not fully realized.
3. Staff UI assumes exactly one active permission, while schema and helper design can represent several; display names also differ from stored permission names.
4. Public active-hotel SELECT exposes the full row. The masked detail RPC cannot enforce location/owner privacy while clients can read the base table directly, and anonymous callers cannot execute that RPC anyway.
5. Hotel row, booking, room, rate, inventory, and physical-unit policies do not apply the same scope function. Adjacent records can therefore expose different slices to the same actor.
6. Hotel manager can configure policy and rooms but cannot execute check-in/out and may not receive Inbox navigation. The code does not establish whether this is deliberate separation of duty.
7. Broad direct `INSERT`/`UPDATE` policies on `hotels` and `hotel_rooms` permit any active Staff/Admin/Creator at the RLS predicate level; scope and workflow checks are not consistently present.
8. Customer UPDATE policies on hotel bookings validate ownership but do not constrain which columns/statuses the customer may change. Triggers/RPC conventions are not a substitute for a narrow write policy.
9. Base table grants are unusually broad (including non-SELECT privileges for `anon` on some hotel tables); absent write RLS policies block ordinary row DML, but grants should still be reduced as defense in depth.
10. Finance and other specialist staff can receive data through RPC queues while direct table policies differ. This is defensible only if explicitly documented and tested.
11. The live Supabase advisor reports 320 SECURITY DEFINER functions executable by authenticated users. Many deliberately perform their own actor checks, but there is no documented EXECUTE allowlist proving that every exposed helper/legacy RPC is intended.

## PROPOSED CANONICAL MODEL

### Identity and grant model

- `person`: durable personal identity and account health only.
- `capability_grant`: consumer, worker, property-partner, staff specialty, admin, creator, or hotel-team capability with status and optional scope.
- `workspace`: a presentation of granted capabilities, not a second identity.
- `assignment`: relation to a particular hotel, case, branch, state, or operational queue.
- `policy decision`: `active person` AND `active grant` AND `action permitted` AND `record relationship/scope`.

Until schema consolidation, one database helper per domain must implement that rule and every RLS policy/RPC must call it. UI guards are only presentation.

### Canonical permissions

| Capability | Read | Mutate | Forbidden |
|---|---|---|---|
| Consumer | Public discovery and own records | Own intents, preferences, messages and permitted transitions | Internal evidence, other users' records, settlement decisions |
| Worker | Public jobs addressed to them and own jobs/earnings | Profile, negotiation, execution evidence, completion request | Verify self, release own protected funds |
| Property Partner | Owned submissions/properties/hotels/bookings and earnings | Submit evidence, configure approved operations, respond to guests | Approve own evidence/publication, view unrelated supply |
| Hotel team | Only assigned hotels and their operational records | Actions allowed by explicit hotel role | Other hotels, platform approvals, protected guest/payment fields not needed for task |
| Field Operations | Assigned/scoped field cases | Field evidence, visit/handover actions | Access-evidence approval, publication, finance |
| Worker Operations | Assigned/scoped worker records | Review/activate/suspend within policy | Property publication, finance settlement |
| Operations | Scoped operational records | Coordinate and review within scope | Unscoped records, final finance authority unless separately granted |
| Finance | Scoped money read models | Review/settle via idempotent RPC | Change booking/property facts except through money-result events |
| Admin | Scoped governance | Approved scoped actions | Global access merely because route is Admin |
| Creator | Global governance | Exceptional/final actions with reason and audit | Bypass immutable money/evidence history |

### Required access tests

For each table/RPC, test anonymous, unrelated customer, owning customer, past customer, owner, manager, front desk, unrelated hotel team, each staff specialty in/out of scope, Admin in/out of scope, Creator, suspended actor, revoked actor, and deleted actor. Each test must cover SELECT plus every write transition. Public tests must assert that exact address, coordinates, owner IDs, private evidence, booking codes, guest identity, and operational unit data are absent.

## Decisions requiring approval

See D-001 through D-004 in [DECISION_LOG.md](./DECISION_LOG.md): multi-capability personal workspaces, manager/front-desk division, Admin global versus scoped authority, and whether past paid guests retain exact hotel location after completion.
