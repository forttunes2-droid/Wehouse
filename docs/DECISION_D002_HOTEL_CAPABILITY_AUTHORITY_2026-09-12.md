# D-002 — Hotel capability authority

Status: **decision locked; implementation follow-up required**  
Baseline: `main` after PR #71 (`e79b2dc2`)

## Why D-002 was still open

Current production does not have one authority model. The live database currently allows Owner, Manager and Front Desk (`hotel_role='staff'`) to open/send an eligible paid-stay conversation, but `partner_transition_hotel_booking` permits only Owner or Front Desk to check a guest in/out. The Partner hotel UI mirrors the mismatch by setting `canHandleGuests = accessRole !== 'manager'`, so a Manager can be authorized for chat at the database boundary while being hidden from guest reservations in the UI.

This decision removes role-name guessing. **Capabilities authorize actions. Role labels are presets only.**

## Canonical capabilities

| Capability | Meaning |
|---|---|
| `stay.read` | Read scoped hotel reservations/stays and guest-safe details |
| `stay.message` | Send/receive the hotel-business conversation for eligible paid stays |
| `stay.assign_unit` | Assign or reassign a physical room within the booked room type and valid readiness/capacity rules |
| `stay.check_in` | Perform the confirmed → checked_in transition after credential/payment/unit checks |
| `stay.check_out` | Perform checked_in → checked_out and send the occupied unit into turnover/cleaning |
| `stay.modify_commercial` | Use the controlled booking-modification command for dates/package/room-type/price changes; never raw row UPDATE |
| `room.mark_ready` | Change a non-occupied physical unit between ready/cleaning/maintenance/out-of-service |
| `hotel.inventory.manage` | Change dated inventory/closures within verified capacity |
| `hotel.rate.manage` | Change future rate/package commercial terms |
| `hotel.policy.manage` | Change hotel-operating policies that the platform allows the hotel to choose |
| `hotel.team.manage` | Invite/revoke hotel team members and customize their capabilities |

## Default presets

| Action | Owner | Manager default | Front Desk default |
|---|---:|---:|---:|
| Read reservations/stays | Yes | Yes | Yes |
| Message eligible paid guest | Yes | Yes | Yes |
| Assign physical room | Yes | Yes | Yes |
| Check in | Yes | Yes | Yes |
| Check out | Yes | Yes | Yes |
| Mark room ready/cleaning/maintenance | Yes | Yes | Yes |
| Manage dated inventory | Yes | Yes | No |
| Manage rates/packages | Yes | Yes | No |
| Manage hotel operating policy | Yes | Optional/off by default | No |
| Manage hotel team/capabilities | Yes | Optional/off by default | No |
| Change verified identity/location/capacity/public-media facts | No direct edit | No direct edit | No direct edit |
| Settle/refund/payout money | No direct finance authority | No | No |

The Owner may add or remove individual Manager/Front Desk capabilities, except platform invariants and review/finance boundaries cannot be granted by a hotel owner.

## Guest conversation rule

There is one deterministic business conversation per paid confirmed stay. It represents the **hotel**, not a private staff member. A guest may write while the paid stay is `confirmed` or `checked_in`. Any active hotel team member with `stay.message` may write during that same window. After checkout, permitted history remains read-only. Cancellation/expiry before a valid paid stay does not create a writable direct hotel thread.

No booking/check-in credential is allowed in the thread title, subtitle, preview or Activity copy.

## Room assignment and stay transitions

- `stay.assign_unit` may assign only a ready unit in the booked room type unless a controlled booking modification has changed the booked room type first.
- Check-in requires paid/confirmed booking, valid arrival state, an eligible ready unit, and the platform's credential/identity checks.
- Checkout always records `checked_out` first and moves the physical unit to turnover/cleaning. Hotel completion policy runs after checkout.
- Manager and Front Desk must not get different database/UI behavior merely because one surface hard-coded a role name.

## Booking changes

A paid booking is not a freely editable database row.

- Physical unit reassignment inside the same booked room type is operational and may be done with `stay.assign_unit`.
- Date, room-type, package/rate, guest-count or price changes use one audited booking-modification command.
- Any change that changes money must produce a quote delta and explicit guest acceptance/payment/refund handling.
- Front Desk does not receive `stay.modify_commercial` by default.
- Raw client UPDATE policies must not be the authority for booking transitions.

## Implementation order

1. Add a server capability helper and capability storage/overrides for hotel team membership; preserve current labels as default presets.
2. Replace role checks in hotel conversation, room-unit, inventory/rate, stay-policy and transition RPCs with the helper.
3. Make Partner hotel UI consume the returned capability set; remove `canHandleGuests = accessRole !== 'manager'` and similar label-derived gates.
4. Add actor × capability × hotel-record tests for owner, Manager, Front Desk, unrelated member, revoked member, scoped Admin/Operations and Creator.
5. Only after those tests pass, narrow legacy table UPDATE grants/policies to commands.

## Acceptance tests

- Owner/Manager/Front Desk with `stay.message` all reach the same paid-stay thread.
- Removing `stay.message` immediately prevents send/open even if the member still has a Manager/Front Desk label.
- Manager and Front Desk with `stay.check_in/out` can transition eligible stays; actors without the capability cannot.
- Revocation denies access server-side without waiting for UI refresh.
- Commercial booking changes cannot bypass quote/payment/refund rules.
- Checkout makes the conversation read-only and starts room turnover.
