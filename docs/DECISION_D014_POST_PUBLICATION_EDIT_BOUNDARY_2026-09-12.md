# D-014 — Post-publication Partner edit boundary

Status: **decision locked; enforcement still needs targeted implementation**  
Baseline: `main` after PR #71 (`e79b2dc2`)

## Current inconsistency

The live apartment and hotel generations do not use the same boundary.

For inspected apartments, `guard_reviewed_listing_commercial_facts` currently blocks changes to price, currency, state/city/address, beds/baths, property/sub type, security deposit, ownership/partner, contact phone, amenities, coordinates and inspection link. Media changes also invalidate media review. This protects reviewed facts, but it also freezes commercial terms such as price that should belong to the Partner for future customers.

For hotels, the base `hotels` row is protected from direct Property Partner UPDATE by current RLS, but Owner/Manager RPCs can directly create/update room type, price, max guests, total rooms, amenities and room images. They can also manage rate plans, dated inventory and stay policy. That means post-publication hotel capacity provenance and public media are currently easier to change than equivalent apartment reviewed facts.

## Canonical rule

A published property has three classes of data:

1. **Verified facts** — facts WeHouse relied on during access/inspection/review. Changes return through Property Operations/Admin review before becoming public.
2. **Commercial/operational controls** — future-facing business choices the authorized Partner/hotel team may change directly, subject to audit and existing-booking protection.
3. **Editorial/public presentation** — Partner may propose changes, but approved public media and review-sensitive claims publish only through the WeHouse review/publication boundary.

Changing a future commercial setting must never rewrite an existing reservation/stay's snapshotted agreement.

## Apartments / homes

### Partner may edit directly for future reservations

- Asking rent / Short Let nightly price.
- Security deposit or other Partner-selectable commercial amount within platform policy.
- Future availability/open/closed dates that do not conflict with protected reservations.
- Partner-controlled minimum/maximum stay where the platform policy permits it.
- Commercial notes explicitly classified as non-verified and non-safety-critical.

These changes are audited and versioned. Existing paid/reserved agreements retain their snapshots.

### Must return through Property Operations/Admin review

- Exact address, State/LGA/location coordinates.
- Property identity/type/sub-type where changing it would change what was inspected.
- Bedrooms, bathrooms, unit identity/count/capacity or other physical capacity facts.
- Ownership/partner relationship and access-authority evidence.
- Inspection relationship/evidence.
- Presence/removal of review-sensitive amenities or facilities whose existence was part of verification.
- Approved public gallery selection or replacement media intended to become public.
- Any field that changes safety, access, legal identity or verified physical description.

### Public media

A Partner may upload replacement/candidate media after publication, but it enters a private review pool. It does not immediately replace the public gallery. Property Operations reviews evidence; final public selection follows the existing WeHouse publication-selection rule. Historical approved media/evidence remains auditable.

## Hotels

### Owner/authorized Manager may edit directly

- Future rate plans/packages and prices.
- Meal/package inclusions and refundable/payment-timing terms within platform policy.
- Dated inventory/closures **within already verified capacity**.
- Check-in/check-out and turnover operating policy where the platform allows hotel configuration.
- Room readiness/maintenance state for known physical units.
- Descriptive operating details such as opening hours for already approved facilities.

A Front Desk member only receives the operational capabilities explicitly granted by the Owner; the default Front Desk preset does not include rates, inventory or commercial policy.

### Must return through review before public effect

- Hotel legal/business identity or ownership.
- Exact location/coordinates/address provenance.
- Creating a new room type that materially expands the verified supply footprint.
- Increasing `total_rooms`, max guest capacity or other physical capacity beyond the last verified provenance.
- Changing room identity/bed configuration where it changes the verified physical product.
- Adding/removing review-sensitive facilities/amenities represented as verified hotel facts.
- Public hotel/room images selected for the approved public gallery.
- Any change to access evidence, inspection evidence or publication approval.

A reduction in sellable capacity may be operationally urgent, so an Owner/authorized Manager may immediately close inventory or mark units out of service. That does **not** rewrite the verified maximum capacity fact; increasing capacity beyond verified provenance requires review.

## Price and existing bookings

Price is commercial, not a field-officer verified physical fact. The current apartment trigger is therefore too broad when it permanently freezes post-publication price/security-deposit changes.

Canonical implementation:

- Store/version future commercial terms separately or through audited commands.
- A reservation/booking snapshots the price, deposit, package, dates and policy version at creation/payment.
- Later Partner price changes apply only to new quotes/reservations and never mutate an existing obligation.

## Required enforcement changes

1. Split the apartment `guard_reviewed_listing_commercial_facts` boundary into reviewed physical/identity facts versus auditable future commercial commands.
2. Do **not** replace the guard with broad client UPDATE access. Add narrow commands for price/deposit/availability changes.
3. Split hotel room editing: commercial rate/package/availability may update directly; capacity provenance and candidate public media go to review.
4. Stop direct post-publication room-image arrays from becoming public without gallery review.
5. Add immutable/audited before/after records for Partner commercial changes.
6. Snapshot commercial terms onto every new reservation/stay so later edits cannot change an existing deal.

## Acceptance tests

- Partner can change future apartment price without changing an existing reservation snapshot.
- Partner cannot change verified apartment address, coordinates, bedrooms/bathrooms or ownership directly.
- Hotel Owner/authorized Manager can change future rate/package and close inventory.
- Hotel team cannot increase verified physical capacity or replace approved public media without review.
- A maintenance/out-of-service action can immediately reduce sellable capacity without waiting for review.
- Every approved reviewed-fact change produces a new review/publication audit trail instead of overwriting evidence.
