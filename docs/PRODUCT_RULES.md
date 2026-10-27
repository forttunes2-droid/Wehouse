# Product Rules and Invariants

## Authority

These rules are the review checklist for future WeHouse changes. A proposed change that violates one needs an explicit approved decision and an update to this contract before implementation.

## CURRENT IMPLEMENTATION

The repository already enforces some of these rules in newer database functions: hotel chat closes at checkout, worker blocking preserves secured money, private property evidence is separated from public assets, followed searches have canonical keys, and physical hotel units cannot be edited while occupied. Other rules are enforced only in UI or applied inconsistently across domains.

## INCONSISTENCIES / LEGACY BEHAVIOUR

Rules currently live in SQL migrations, SECURITY DEFINER functions, RLS policies, Edge Functions, frontend status arrays, button conditions, route aliases, and copy. There is no shared registry or test generator, so the UI can omit a valid database state (`payment_protected`) or display an action whose RPC will reject it.

## Canonical model and implementation requirements

The invariants below are the shared engineering contract. Their approval
status comes from `DECISION_LOG.md`: confirmed owner decisions are binding;
items explicitly called open or proposed remain recommendations until the
owner records a decision. Do not treat a recommended default in an audit or
operating model as product-owner approval.

### Cross-system invariants

**Account access (C-065, 20 October):** Google/Apple authenticate a linked identity; they do not confirm a new device or substitute for email-account recovery. Email signup accepts its Auth confirmation link/code. Device approval and password recovery use separate eight-digit, purpose/account/challenge-bound codes, ten-minute expiry, at most five guesses, per-network and account send limits. Pending-device proof also binds the exact device and existing Auth session. No raw codes or passwords are persisted or logged. Recovery claims are one-use, reset passwords server-side and require global Auth-session revocation plus device-history cleanup before success. Unknown outcomes cannot be reported as success or automatically reopen a consumed proof. Delivery is gated on verified mail configuration and exercised recovery; no client can enable it.


| ID | Rule |
|---|---|
| R-001 | A person has one durable identity. Workspace grants and role revocation never delete or recreate the personal account. |
| R-002 | Permissions depend on actor, active grant, action, relationship/assignment, and scope—not the screen or client role string. |
| R-003 | Status is not navigation. Statuses may filter a record list or label a record; they are never top-level destinations. |
| R-004 | A domain state has one canonical meaning across database, API, UI, Activity, and analytics. |
| R-005 | Every state change uses an explicit transition service/RPC that validates source state and actor and writes an audit event. Direct generic updates must not bypass it. |
| R-006 | A completed, cancelled, expired, blocked, or otherwise invalid action removes its original CTA on the next authoritative projection. |
| R-007 | Reading an Activity item never completes its underlying action. Completing the domain action resolves the item. |
| R-008 | A booking/job/match has at most one conversation identity for each declared purpose. Route aliases cannot create another thread. |
| R-009 | Inbox is the communication destination. Conversation and Activity are nested views/details, not competing top-level tabs. |
| R-010 | Every message and call rechecks participant capability at execution time. Opening a screen is not authorization. |
| R-011 | A block in either direction stops direct messages and calls everywhere. Blocking never makes an automatic decision about secured money. |
| R-012 | Private verification evidence never becomes public. Public media comes only from explicitly selected, approved derivatives with provenance. |
| R-013 | Public discovery projections reveal only deliberately allowlisted fields; exact location, identity, evidence and credentials follow relationship permissions. |
| R-014 | Booking/check-in/security codes are credentials, not labels. They never appear in chat headers, thread lists, notifications or general Activity. |
| R-015 | Publication, availability, reservation, payment, communication and occupancy are independent dimensions. One overloaded status must not represent them all. |
| R-016 | Hotel dates select an interval; hotel check-in/out times define local arrival/departure policy; physical room state controls operations. Changing one does not silently rewrite the others. |
| R-017 | A physical room can have at most one current occupant assignment, and `occupied` must agree with that assignment. Checkout moves it to cleaning, not ready. |
| R-018 | Sellable capacity cannot exceed valid physical/operational capacity or conflict with existing interval holds. |
| R-019 | Browser state, redirects and toasts never establish payment. Only idempotent server/provider verification can do so. |
| R-020 | A mutation timeout is `unknown/reconciling` unless cancellation is proven. It must not invite a duplicate payout/payment/profile mutation. |
| R-021 | Protected funds remain protected through block, dispute, connection loss and late webhook races until an authorized audited resolution. |
| R-022 | Settlements, refunds and reversals use immutable compensating records. Economic history is never deleted or silently overwritten. |
| R-023 | Notifications describe real domain facts. UI events such as draft saved, tab opened or message viewed are not product Activity. |
| R-024 | Ordinary chat messages belong to Messages unread, not Activity unread. Announcements remain distinct from both. |
| R-025 | One canonical event key prevents duplicate recipient Activity for one domain fact. |
| R-026 | A followed search has one semantic criteria identity per user/kind; following is idempotent and future match delivery is deduplicated. |
| R-027 | Stopping a roommate search does not destroy established matches, conversations, shared housing or money history. |
| R-028 | Unblocking restores only permitted contact. It never resurrects a cancelled/disputed job, stay or shared-housing agreement. |
| R-029 | Entity cards display entities. Module/navigation controls display destinations. Status pills display state. Primary buttons display the single next domain action. Their visual roles must not be interchangeable. |
| R-030 | Every screen belongs to one shell with one header/back contract; back returns to the prior location and preserved list state. |
| R-031 | Realtime invalidates canonical read models; focus/reconnect reconciliation and backoff are safety nets. Fixed polling is not the primary consistency model. |
| R-032 | UI labels come from product vocabulary: Overview for workspace landing, Inbox for communication, and actor/team names that match actual responsibility. |
| R-033 | Every privileged or economic override records actor, reason, previous state, resulting state and correlation ID. |
| R-034 | Compatibility aliases have an owner, telemetry and removal date; they do not become permanent alternate product concepts. |

### UI action to domain action map

| UI intent | Underlying domain action | Required authoritative result | CTA after success |
|---|---|---|---|
| Add property | Begin/edit a meaningful `property_submission` draft | Draft exists only after real progress | Continue draft; do not say property submitted |
| Send property | Submit batch and private access evidence | Verification case in `access_review` | View submission; Send disappears |
| Accept access evidence | Verify private evidence | Case advances to field assignment | Accept/reject disappear |
| Select gallery | Approve public derivative sources | Public-media selection recorded with provenance | Selection action becomes view/edit only until publication boundary |
| Publish property/hotel | Approve discoverability | Published product becomes live and match event emitted | Publish disappears |
| Follow search | Idempotently persist normalized criteria | Saved search returned with active state and stable key | Shows Following; duplicate follow disabled |
| Resume alerts | Reactivate same saved search | State active, no duplicate row | Shows Following/Pause |
| Unfollow | Delete/disable saved-search subscription | Server confirms no active subscription | Follow becomes available |
| Reserve/book | Create authoritative reservation and hold | Server returns booking/quote snapshot | Pay/view booking; Book disappears for same intent |
| Pay | Initialize exact obligation | Provider pending reference | Checking/continue payment, never Paid before verify |
| Message hotel | Open existing/one stay thread | Paid confirmed/checked-in capability | Opens thread; after checkout action disappears |
| Check in | Validate paid booking, local time and ready room; allocate unit | Booking checked in + unit occupied atomically | Check out; Check in disappears |
| Check out | End occupancy and release unit to cleaning | Booking checked out + unit cleaning atomically | History/review; Message hotel and Check out disappear |
| Block worker | Set pair safety block and classify all nonterminal jobs | Contact stopped; unsecured cancelled; secured disputed/review | Unblock/report; send/call/continue-job CTAs disappear |
| Approve completed service | Authorize protected-fund settlement | Job released and ledger credited once | Review/history; Approve disappears |
| Mark room ready | Complete operational cleaning/maintenance state | Physical unit ready and unassigned | Ready status; Mark ready disappears |
| Mark Activity read | Advance recipient read cursor | Read timestamp only | Unread badge disappears; domain CTA remains if unresolved |
| Resolve case | Complete the case work state | Case resolved with resolution event | Reply/reopen according to policy; original operational CTA disappears |
| Request withdrawal | Reserve available earnings and create payout request | Awaiting review with stable transfer reference | View status; duplicate request disappears |

### Action visibility algorithm

The server/read model should return capabilities, or the UI should derive them from the exact same generated transition contract:

1. Load authoritative record and actor grant.
2. List transitions whose source state, actor permission, scope, temporal rule, money prerequisite, block rule and capacity invariant are satisfied.
3. Show no more than one primary action; secondary actions must be genuinely distinct domains such as Help or Cancel.
4. On success or external event, invalidate/reload the record and Activity projection.
5. Remove the source action. Never keep it as a harmless disabled decoration when the action is finished.

### Timeouts and consistency

- A timeout is a transport observation, not a domain state.
- Client timers may stop spinners or abandon reads. Mutation APIs require idempotency, cancellation where real, and reconciliation where cancellation cannot be proven.
- Do not add timeout races to “fix” a slow call. Measure latency, surface progress, allow navigation where safe, and make operations durable.
- Avoid parallel polling loops for the same aggregate. Use a single invalidation owner and deduplicated request/cache.

### Design and shell rules

- Use one page background/chrome hierarchy per workspace, not a card containing another pseudo-page.
- Back belongs in the screen header and has a route-derived destination.
- Tabs switch peer views of the same scope. Modules navigate. Filters refine a list. Pills label state.
- Keep mobile continuity: opening a conversation or record preserves the parent list and returns to it.
- A dashboard Overview summarizes work and next actions; it must not duplicate every navigation destination as a collection of oversized buttons/cards.

### Contracts requiring implementation or remaining decisions

| Area | Verified current behavior | Accepted direction / remaining choice | Remaining release gate |
|---|---|---|---|
| Long Let contract duration and rent schedule | The integrated Test flow supports accepted-term offers, reviewed tenant agreements, required upfront checkout and handover-anchored schedules. Year 1 is paid in full. Manual later-year collection, verified direct settlement and paged gross rent history are implemented on Test and PR #118. Optional automatic payment is implemented with separate consent, private provider-verified reusable-card authorization, bounded dispatch and uncertain-result recovery. Actual provider card/debit verification remains pending. | Keep term and payment agreement explicit. Offer only terms the Partner has accepted (including 3/6/12-month options and multi-year terms). A one-year stay is always paid in full before handover. Accepted shorter terms are also paid in full. Monthly payments apply only to later years of a multi-year tenancy when that Partner has explicitly opted in; there is never a one-year monthly option. For a multi-year contract, default to the full contract amount unless the Partner opts into monthly payments: Year 1 is paid before handover, then each later year's rent is paid in eight equal monthly amounts in months 5–12 of the prior contract year (first future payment four months after move-in). Initial upfront rent retains accepted Payment Protection. Later-year monthly rent uses no new protection hold: require explicit tenant acceptance, verify each charge and frozen fee, and settle the accepted Partner net through the provider. The full verified gross contribution funds the target rent year. Record charge and actual Partner settlement separately; direct settlement must not also create withdrawable wallet credit. Collect the scheduled amounts rather than charging and holding the whole future-year balance. If monthly payment is not accepted, show and collect the full multi-year total before booking. Snapshot price, term and every due date in the contract; make renewal an explicit new agreement. For eligible later-year monthly payments, offer manual payment or optional automatic debit only through a separately consented, verified active provider mandate, with pause/cancel, failed-charge, retry and notification controls. Collection method never changes Year 1 being paid in full or the accepted due dates. | Owner and local counsel approve eligible terms, due dates, arrears/grace, notice, renewal and refund treatment. Finance/Engineering verifies initial Payment Protection, later-year direct settlement, Partner account checks, frozen fees, duplicates, late/failed payments, chargebacks, provider reconciliation and lawful exit/dispute recovery. The rolled-back manual collection and settlement contract passes on Test; additional arrears/exit operational and actual provider card/debit/payout evidence remain open. |
| Property/building and bookable spaces (C-064) | The Test physical registry links existing inspection/listing/reservation records and enforces whole-unit/private-room overlap; grouped stock/allocation and full concurrency proof remain open. Multiple independently submitted Short Let/Long Let listings already exist; submission batches group paperwork, not physical inventory. Hotel room inventory is separate and established. | Owner confirmed both independent apartments in one building and private bedrooms with disclosed shared areas, covering both Short Let and Long Let. Keep one physical-property/space hierarchy, per-space terms and dated availability. Studio remains a layout value. Retain existing booking and money authorities. | Implement the shared hierarchy through submission, documents/review, publication, discovery, booking, Partner operations and recovery. Concurrent whole-unit/child-room bookings and Short Let/Long Let overlap must be rejected atomically. Verified access and document scope must not spread to another owner merely because units share an address. |
| Worker service fulfillment | `create_booking_request` requires a customer address; the contract has no authoritative mode for provider venue, agreed public location or remote work. | Configure allowed fulfillment modes per service category and market: customer site, provider venue, agreed public/neutral location, and remote. Request private address/location only when that mode needs it, and disclose it only to authorized participants. | Owner/operations confirms mode availability and safety/response rules for each category. |
| Worker offers and packages | The marketplace negotiates a custom quote; Worker Pro's service packages are business records and are not selected into a marketplace booking. Public starting-price copy is not an accepted quote. | Keep negotiation as the live path. Label estimates accurately. Treat any later fixed package as an optional, scoped offer with explicit deliverables, exclusions, duration, capacity, currency, cancellation terms and a quote snapshot. Do not imply Worker Pro packages are public checkout packages. | Owner confirms whether fixed-price marketplace packages are in scope and how they coexist with custom quotes. |
| Trust evidence and verification claims | Worker identity is policy-gated; Worker onboarding collects professional work evidence and offers a certificate upload, currently optional. Property submissions record a declared authority relationship, private Partner access evidence, and can proceed through independent Field Operations evidence/review. This is evidence of identity, claimed representation, access or work samples; it does not by itself prove title, legal authority, a valid licence, every listing fact, property condition, or safety. | Create separate status claims for `identity checked`, `authority documents reviewed`, `property access observed`, `field visit completed`, `listing facts checked`, `credential checked`, and `licence/insurance checked`. For Partners, collect the minimum appropriate evidence that the named person may list/manage the asset (for example ownership record or a current management/letting authorization), plus entity/representative evidence when acting for a business; keep documents private and ask counsel which forms are valid locally. For each Worker category/market, define required qualifications, licenses/permits, insurance and expiry/recheck rules; keep non-required certificates optional and disclose what was checked. Publish the scope/date of each check, never an undifferentiated “safe/verified” guarantee. | Operations and local counsel approve evidence by asset type, Worker category and launch market; privacy owner sets purpose, access, retention/deletion and appeal rules. Do not require or retain sensitive documents without a defined need and lawful basis. |
| Owner property lifecycle | Host pause exists in a limited hosting mode; a consistent pause/unlist/removal request across apartment and hotel workflows is not verified. | Owners can stop new discovery/bookings across supported modes while existing bookings remain fulfillable. Permanent removal is a request/retirement path that preserves active bookings, payments, evidence, legal holds and required history. | Owner confirms visibility consequences, who reviews removal, and how affected future bookings are handled. |
| Provider response clock | Requests can remain pending without one documented response target/expiry rule across service categories. | Set category-specific response targets and reminders; missed targets escalate or expire only before acceptance. A missed response must not cancel an already accepted/paid job without a separately authorized recovery path. | Operations confirms staffed targets, coverage hours and escalation ownership. |

## Enforcement

### Nigerian identity verification

NIN is not required to create a Personal account, browse, use Friends or make an ordinary customer payment. The prepared NIN module accepts only Property Partner and Service Worker verification purposes; ordinary booking is not a NIN purpose. NIN is one potential Nigerian government-identity method, not the sole ID for every nationality. An approved alternative-ID/manual appeal route is required before an identity gate can launch. Hotel Team employees do not each become payout beneficiaries merely by accepting an operational invitation.

The owner accepted these enforcement points on 19 October: provider approval before public supply/accepting work and recipient KYC before payout activation. Workspace drafts may be prepared before those checks. Identity, business/entity review, property authority, professional credentials and payout-account verification are separate decisions. One person with both workspaces reuses an eligible current identity result, while each workspace retains its own authority/credential review. The existing face review and bank-name resolution do not implement the government-ID/KYC contract; that integration remains unfinished.

Any later NIN check must have a defined purpose, approved provider, explicit consent and server-authenticated result. NIN format, a face/liveness review, property access evidence and paid Pro membership cannot grant a NIN verification claim. Identity verification does not establish property ownership or professional licensing. No NIN provider is currently integrated; the server orchestration module is preparation only and remains unavailable without approved dependencies. Processor requirements must be confirmed for WeHouse's actual marketplace recipient model, rather than copied from merchant onboarding.

### Property and Hotel submission evidence contract

The owner accepted this product contract on 19 October. Private request-linked document upload, current-requirement snapshots, correction/replacement, independent scoped review, expiry and new-publication enforcement are implemented on Test. Exact legal forms/retention still need local approval; live account KYC, structured guest/tenancy term capture and booking-time eligibility/recheck remain unfinished. No live identity or operating-licence verification is implied by a manual document decision.

| Check | Short Let / Long Let | Hotel | Review outcome |
|---|---|---|---|
| Responsible person | Legal name, contact details, approved identity method | Authorized operator/representative and legal entity where applicable | Identity checked; not ownership checked |
| Authority to offer accommodation | Owner evidence, or signed current management/letting authorization; tenant-host requires permission to sublet/host | Owner/operator agreement or current management authorization | Authority reviewed for this asset; address, parties, permitted use and expiry match |
| Business details | Registration and tax details when applicable to the host/business model | Legal/trading name, registration, address and tax details applicable to operator | Business reviewed independently from the named representative |
| Operating permission | Applicable accommodation/letting permits and landlord/building restrictions | Applicable tourism/accommodation, fire, health, planning and other locally required evidence | Issuer, scope and expiry reviewed; not a blanket nationwide checklist |
| Property facts | Exact private address, public map disclosure, whole-unit/private-bedroom scope, shared-space disclosures, beds/sleeping arrangements, bathrooms, occupancy, amenities and accurate media | Exact address, room types, bed configurations, capacity, sellable inventory, amenities and accurate media | Facts checked; access video alone does not establish authority |
| Guest terms | Price basis, currency, all compulsory fees/taxes, caution, house rules, arrival/departure, cancellation/refund, minimum/maximum stay; tenancy term for Long Let | Room/rate inclusions, taxes/fees, guest/child/extra-bed rules, arrival/departure, cancellation/no-show and inventory restrictions | Terms versioned and snapshotted into booking |
| Payout beneficiary | Recipient identity/entity and bank ownership/name match under approved processor rules | Authorized individual/entity recipient and compatible bank ownership | Payout eligible; no raw identity documents in wallet activity |

#### Asset-specific collection and review checklist

The examples below define the intended product intake, not a declaration that every example is legally compulsory or sufficient throughout Nigeria. Operations/counsel must approve acceptable evidence for each enabled state and asset type. Collect an appropriate accepted document, not every possible alternative.

- **Common identity and authority:** responsible person's legal name/contact and approved identity method; exact address and location; owner evidence such as an accepted deed/title/registry record, or a signed current letting/management authorization identifying the owner, representative, property and permitted use. A tenant offering accommodation needs the applicable landlord/subletting permission. An entity needs applicable registration details (for example CAC registration in Nigeria) and representative authority. Address evidence such as a utility bill supports address matching; it does not establish title. Payout beneficiary checks remain separate.
- **Short Let:** authority for short-stay use and any applicable local permit/building restriction; whole-unit/private-bedroom scope and disclosed shared spaces, bedrooms/beds/sleeping arrangements, bathrooms, maximum occupancy, amenities and condition media; nightly rate/currency, mandatory fees/taxes, refundable caution, minimum/maximum stay, house rules, check-in/out, cancellation/no-show and emergency/support contacts. Disclose relevant access limitations and safety information accurately. Snapshot the guest's accepted terms.
- **Long Let:** authority to let for the offered term; property condition/inventory and tenancy agreement; Partner-accepted term, annual/term total, any approved monthly schedule and due dates, itemized agency/service/deposit charges, utilities/service-charge responsibility, maintenance/repairs, handover, renewal/rent review, arrears/grace, notice, early exit and deposit return. Offer only supported approved schedules; a signed contract does not itself implement automatic debit or arrears recovery.
- **Hotel:** legal/trading operator name, applicable business/tax registration, authorized representative and owner/operator/management agreement; applicable local accommodation/tourism, fire, health, planning and other operating evidence with issuer, scope and expiry. Capture sellable room types/inventory, beds, occupancy/children/extra beds, amenities/accessibility, rate-plan inclusions, taxes/fees, arrival/departure, cancellations/no-shows, payment and complaint contacts. Company registration alone does not prove hotel operating eligibility.

The current document panel shows missing, unfinished upload, awaiting review, correction required, approved, rejected and expired states. Reviewers set accepted evidence instructions before collection, record a decision/reason and expiry, and cannot review their own asset. New requirements/material property changes invalidate the snapshot. New publication checks the latest approved current evidence on the server. The existing operations queue and canonical Inbox carry review and Partner correction/outcome work. Existing bookings are preserved. Automatic expiry outreach, recertification of already-live properties, broader appeal/retention processing and hosted-role verification remain open.

Required evidence is private. Request corrections through the existing submission/review journey, with a reason, reviewer, timestamp, expiry/recheck and appeal history. Unreviewed, expired or rejected required evidence prevents new publication/acceptance as appropriate; it must not silently cancel existing stays or destroy financial history. Guests and unrelated staff cannot read raw documents. Do not ask Partners to send identity documents through chat.

Research checked 19 October 2026: [Airbnb identity verification](https://www.airbnb.com/help/article/3033) includes booking guests as well as hosts and accepts multiple ID types; it does not establish a universal NIN requirement. [Airbnb hosting responsibilities](https://www.airbnb.co.uk/help/article/1397) cover permissions, local rules and licences. [Booking.com accommodation onboarding](https://join.booking.com/index.html?lang=xu) describes property verification before bookings may open; its publicly accessible material does not establish one universal Nigerian document list. [Paystack Nigeria compliance](https://support.paystack.com/en/articles/2123970) documents merchant ID/entity requirements and several accepted IDs; it is not proof that every WeHouse recipient must submit the same merchant dossier. The matrix above is WeHouse's proposed control contract, not a claim that either competitor requests every listed document or that counsel has approved it.

These invariants should become database constraints/RPC tests where possible, TypeScript types/read-model capability tests in UI, and end-to-end browser scenarios for visibility. Code review should cite rule IDs when accepting a deliberate exception.

### Core features and paid enhancements (19 October clarification)

Essential arrival/access instructions are included in normal property/Hotel operations, with owner-only editing and booking-scoped paid-guest reading. Pro may add consolidated portfolio reporting and optional business tools; it must not gate normal fulfillment, payment records, verification, reporting, support or safety. Studio denotes zero separate bedrooms and must retain that meaning in submission, cards and detail views.

### C-064: customer view and operator responsibility (20 October)

**Identical units in one compound/building (owner clarification, 22 October):**
A Partner may manage several separate Long Let or Short Let units with the same
layout, price and terms. Support a shared unit-type description/default price
and distinct physical units beneath it; equal prices do not merge occupancy.
Any valid layout/bedroom count is supported; two bedrooms is only an example.
For example, six two-bedroom flats can share an annual rent default while flats
A–F retain independent availability, inspections, tenants, agreements, payments,
handover and maintenance records. Changing the shared price affects new offers;
accepted agreements retain their saved prices and charges. Unit-specific facts,
condition/photos, price overrides and responsible operator remain explicit.

Discovery may show one matching unit-type card with the price basis and actual
matching availability, rather than six indistinguishable cards. A customer must
choose, or explicitly accept allocation of, an identified physical unit before
binding checkout. Allocation and a temporary hold must be atomic; the available
count alone is not inventory authority. Disclose material differences before
payment. Annual rent, term total, optional approved monthly schedule and separately
itemized charges must not be conflated. A shared address or equal rent never
grants access to another owner's units, private documents or money.

Promotion of a unit group requires that canonical group identity and availability
to exist first. An individual-listing campaign must not silently expand to all
units belonging to the Partner. Identical-unit presentation must not let one
compound fill a Sponsored section with duplicate cards. Grouped inventory and
group-targeted promotion remain unimplemented; this clarifies the existing C-064
workstream, not a separate product or new property category.

A building may contain only Long Lets, only Short Lets, or a mixture. The customer chooses the letting arrangement and applicable dates/term before comparing prices. Results and availability must identify the actual bookable apartment/private bedroom, with its whole/private scope, shared areas, guest capacity, price basis, total, terms and current operator. A building page groups matching available spaces; a building-wide room count is not dated availability. A physical space offered under more than one term still has one occupancy authority. Do not create independent inventory copies for each offer. The Test physical registry, submission/reuse and overlap guards are implemented; public grouped stock, Partner grouped calendar, defaults/allocation and full booking concurrency evidence remain unfinished.

Management responsibility is independent of property layout and let type. Existing management is recorded per listing: Host manages uses the named responsible host and scoped co-host permissions; WeHouse manages requires accepted Operations responsibility before new WeHouse-managed bookings. Ownership, commercial controls, operational access, earnings and support are separate capabilities. A future building default must not grant authority over separately owned spaces or change existing booking snapshots without a reviewed handoff. Customer operator wording must come from approved space/booking state, not a marketing label or the current viewer role.

## 26 October owner correction: Home organization and filters

Homes use Short Let or Long Let, the actual unit/private-room scope and bedroom
layout. Studio / self-contained means 0 separate bedrooms for an entire unit.
Compound or apartment building is the Partner's container for its individual
units, not another customer rental product. Remove the added Apartment / flat,
Bungalow, House and Other-home catalogue from submission and discovery controls.
The already agreed Penthouse option remains an optional property feature, never
an automatic luxury rating. Existing stored records and booking agreements are
preserved; new submitted features and public feature filters accept only that
supported option or no feature.

## 23 October owner confirmation: Experience money policy and legal review pack

- Confirmed by the owner: the standard full-refund deadline is 24 hours before the scheduled start for Experiences, Services, Short Let and Hotel bookings. Provider/host cancellation gives a full refund. Existing bookings retain their accepted policy snapshot; rollout must not silently rewrite them.
- Experience commission is configurable by the Creator. No numerical percentage was approved in this decision. Checkout must require a published, valid commission policy rather than inventing a default. Changes apply to new quotes/bookings, with the policy version and calculated amount saved alongside the booking currency and total.
- Customer screens must show the exact cancellation deadline and relevant booking/session timezone before payment. The 24-hour threshold alone does not decide every late-cancellation deduction, no-show, dispute or statutory exception; do not invent those terms.
- After the internal implementation is complete, produce one shareable PDF for lawyer review covering all agreed WeHouse policies. Derive it from confirmed decisions and implemented behavior; separate unresolved decisions and jurisdiction-dependent review questions. Do not present it as lawyer-approved terms or draft the pack prematurely.


### Owner clarifications — 27 October 2026

- Customer actions use **Request a service** for work agreed through chat and **Book an activity** for a dated Experience. Both belong to Services and the same provider workspace.
- Later-year monthly rent has no new Payment Protection hold. Before choosing this arrangement the tenant must accept direct Partner settlement: each verified payment deducts the disclosed WeHouse fee and settles the Partner net through the provider; the customer's gross rent contribution remains their rent credit. Initial upfront rent, including a full multi-year payment, retains its accepted Payment Protection. Eight scheduled payments funding a complete later year represent twelve months of rent value. Released rent is not shown as money still held by WeHouse for automatic refunds. This clarification does not create an automatic forfeiture or eviction rule.
- WeHouse-managed Homes carry a Creator-configured additional management percentage deducted from Partner earnings alongside base commission. Show the actual base rate, additional rate, combined deduction and expected net when choosing WeHouse management and submitting for inspection, and require Partner acceptance. Existing accepted bookings retain their saved rates. No numeric rate was approved by this clarification.

- Later-year rent tracking must show gross verified rent by target contract year, complete months funded, partial-month credit, the amount needed to complete the next month, and remaining annual rent. One of eight equal contributions funds 1.5 months, not one month. Round cumulative month boundaries in minor currency units, not an approximate rounded monthly price. Pending/failed charges and platform fees do not reduce or create rent credit. Contact the Partner to resolve the balance or agree an early exit; no automatic eviction, refund promise, or waiver of mandatory rights. Do not relabel advance rent credit as current occupancy before its target year.
