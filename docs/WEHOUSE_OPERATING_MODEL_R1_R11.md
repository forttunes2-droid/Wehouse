# WeHouse operating model and R1–R11 product contract

**Prepared:** 12 October 2026  
**Scope:** one coherent operating model for homes, short lets, hotels, services, reports, bookings, availability, support, account setup and operations.  
**Status:** product contract for review and implementation sequencing. It records verified foundations and proposed rules; it does not claim every flow is implemented or ready for launch.

## 1. Product promise

WeHouse is one platform with distinct, understandable journeys for finding a place, booking a stay, arranging a service, and getting help. Each journey must show who is responsible, what happens next, when a response is due, what money or status is at risk, and how to get human help.

A screen is complete only when its states, permissions, data source, failure path, notifications and operational owner are defined.

### Shared rules

1. A confirmed booking survives a listing being paused, hidden, reported or removed. It remains accessible to the people who need to fulfill or resolve it, with a history of changes.
2. A content/safety report is separate from a support case about an existing booking. The report investigates the listing or account; the case handles the user's live transaction.
3. No request, booking, report, dispute or support case may remain silently pending. Every pending state has an owner, a next action, a visible deadline or explicit wait reason, reminders, and an escalation or expiry outcome.
4. Availability and money decisions are authoritative on the server. The client may display availability but cannot reserve inventory by itself.
5. Home, Short Let, hotel and service-provider records keep the fields needed for their real-world fulfillment. Shared language and status patterns are useful; forcing all inventory into one schema is not.
6. User-facing policy is shown before confirmation and copied into the booking snapshot, so later edits do not silently rewrite an existing agreement.
7. WeHouse offers role-based workspaces inside the same product. A host, hotel operator, service provider, guest and support worker see tools for their role; a second host app is not required for the initial product.

## 2. Property and stay lifecycle

### Long Let

- Publish only after authority, address, price period, availability date, property facts, viewing/contact expectations, terms and required evidence pass review.
- Search results show the correct monthly or annual price basis and availability. A long-let inquiry/viewing is not represented as a short-stay reservation.
- A paid or signed tenancy workflow must state what is a lead, offer, reservation, deposit or completed agreement. Do not imply a protected booking if that contract/payment flow does not exist.
- Owner can pause new interest, request unlisting/removal, correct details and respond to moderation. Existing accepted commitments and case history remain reachable.

### Short Let

- Treat this as a date-based stay with check-in/check-out, guest count, nightly or length-of-stay price, amenities, check-in/out instructions, house rules, cancellation policy and a clear sleeping arrangement.
- The current code has server-side date checks, advance window, min/max nights, host date blocks, active-reservation checks, publication/paused checks, and reservation snapshots. Keep this as its own home-stay availability source.
- Resolve the model before adding schema: initial contract should be one whole home per reservation, with bedrooms and sleeping arrangements (bed type plus count per bedroom), total guest capacity, shared/private space, and amenities at home or room level. If separately bookable rooms are needed later, model them as explicit units with independent inventory; do not add one ambiguous bed_type to the whole-home listing.
- Before payment/confirmation, re-check exact dates and guests atomically on the server. Show unavailable dates and a recovery choice; do not leave a spinner or allow stale availability to become a confirmed booking.
- Owner may block dates, pause all new dates, or request removal. Blocking dates affects future inventory only, not an existing reservation.

### Hotel

- A hotel is a property with separately sellable room types, rate plans, occupancy, bed configuration, amenities, policies and dated inventory. Availability is the intersection of room, rate plan, date, occupancy and sellable units.
- Keep hotel search/detail/booking distinct from whole-home Short Let rules. Revalidate inventory at confirmation; record booked room, rate, units, guests, dates, total, cancellation terms and payment/refund state.
- Handle overbooking as an incident: stop further sales for affected units/dates, alert hotel operations and support, contact the guest, arrange an equal-or-better alternative where possible or a clear cancellation/refund path, and record every offer and decision. Never make the guest coordinate the platform's inventory failure alone.

### Shared lifecycle states

Use named, auditable states for each listing domain, with domain-specific fields:

draft → submitted/review → live → paused/unlisted → removal requested → retired

Safety/moderation can place an independent restriction on a live listing:

live → safety hold/restricted → reinstated or removed

A pause/unlist prevents new bookings and removes the listing from new discovery according to the chosen visibility rule. It does not cancel, erase or hide an existing booking. A safety hold may immediately suppress discovery and new checkout when credible urgent risk exists; the authorized reviewer records reason, evidence, scope and review deadline. An ordinary report is not an automatic takedown.

For permanent owner removal: confirm ownership, explain that new bookings stop, show pending bookings/claims and funds, retain required records, finish or transfer active obligations, then mark retired. Hard deletion is a separate retention/privacy action after no booking, payment, dispute, report-retention, or legal hold depends on the record.

## 3. Service-provider journey and no-response handling

### Service definition before booking

Each service category has an explicit fulfillment mode: customer location (home/site visit); provider's venue; agreed public/neutral location; or remote service.

Each provider offer/package states what is delivered, duration or unit, included/excluded work, materials, service area, availability, qualification/verification, price or “starting from” estimate, cancellation/refund terms, and required photos or measurements. “Starting price” must not be presented as a fixed quote. A selected package and its terms are saved into the booking snapshot; a custom quote is a separate named path.

The booking form asks for an address only when the selected fulfillment mode requires one. Private location details are shared only with the assigned provider and staff who need them.

### Request states and clocks

draft → sent → awaiting provider → accepted, quote needed, declined or expired → scheduled → in progress → completion review → completed

Cancellation, refund and dispute are linked outcomes, not hidden text fields. Every state transition creates an actor, timestamp, event and user notification.

- Immediately show the customer a request reference and exact next step after submission.
- Start a visible category-configured response clock. Proposed launch default: provider accepts, declines or requests clarification within 24 hours; remind at 12 hours and 2 hours before expiry. Product/operations must confirm this deadline against provider coverage and staffing before activation.
- If the provider does not respond, expire automatically, notify both parties, release any authorization or refund captured payment under the displayed policy, and offer the customer a new provider or support. Never leave pending indefinitely or count silence as acceptance.
- If clarification is requested, pause the response clock only while the customer has a clear, bounded action. Show the deadline; if the customer does not respond, expire without charging for unperformed work and release/refund according to displayed terms.
- A confirmed service booking has a separate reschedule/arrival workflow. If the provider misses the agreed start window, the customer can report “provider did not arrive”; support owns rebooking/refund resolution. If a customer is unreachable, the provider gets an in-app contact/escalation path and must record arrival evidence before any no-show charge can be considered.
- Never automatically penalize a worker for a single unanswered request. Track response reliability over sufficient eligible requests, exclude platform/network failures and customer cancellations, and use graduated coaching/restriction with appeal.
- Workers need capacity and schedule controls, booking inbox, one-tap accept/decline/quote, customer location/fulfillment details after acceptance, work evidence, completion confirmation, payout/refund/dispute status and support. A customer uses the same app with a customer journey; the role workspace changes the navigation context.

## 4. Report, moderation and active-booking incident process

### Report intake

Every public home, Short Let, hotel and provider profile has a context-appropriate Report action. Ask for a controlled reason plus optional details/evidence. Suggested categories: misleading/fake listing; ownership or authority concern; illegal or unsafe activity; discrimination/harassment; scam/payment off-platform request; privacy/content misuse; inaccurate availability or property facts; other.

Submit creates a reference, timestamp and receipt; suppress duplicate spam; let the reporter view receipt/status without exposing staff notes, another user's data or the subject's private information. A report from a guest with an active booking offers both routes: report this listing and get help with this booking.

### Triage and resolution

received → triage → investigating → action needed or no violation or restricted → resolved → appeal/review where eligible

- Urgent physical safety, credible fraud, illegal activity or imminent harm: alert the designated on-call/operations owner immediately. They can apply a scoped temporary hold while preserving booking records and notify affected customers with a safe next step.
- Non-urgent content/accuracy: queue by risk and age; acknowledge promptly; gather evidence; request an owner response where appropriate; keep the case open while awaiting a bounded reply.
- Outcomes: no action with reason; correct content; require owner evidence; limit specific booking dates/units; temporarily pause discovery; suspend provider/listing; remove after review. Record actor, evidence, rationale, notice, effective time and appeal/review route.
- A report does not automatically cancel a booking, refund money or disclose the reporter. For an active stay/service safety incident, support manages the booking and safety plan in parallel; cancellation/refund is explained and recorded separately.
- Owner can see action required, what must be corrected and the review path, except details withheld for user privacy, fraud prevention, staff safety or legal reasons. Do not expose reporter identity unless law/policy requires it.
- A closed report receives an outcome notice where contact details permit. Reporting does not promise a particular sanction or outcome.

**Current gap:** report storage and a scoped operations queue exist. A Report Listing UI has recently been added on the PR branch as a draft. It must be checked against these reason categories, accessible confirmation/reference, booking-issue routing, hotel/provider coverage, abuse controls and queue response states before it is called complete.

## 5. Money, cancellation and service recovery

- Before booking, show all-in price, currency, taxes/fees where applicable, payment timing, cancellation deadline and exact refund schedule. Save terms and calculation basis on the transaction.
- Cancellation, provider/host cancellation, non-response expiry, overbooking, safety intervention, payment failure and customer service complaint are different causes and must be distinguishable in the ledger and activity timeline.
- A refund request has eligibility decision, amount, payment state, initiator, reason, approval authority, processor state/reference, customer notice and reconciliation state. Do not mark refunded until processor outcome confirms it.
- A host/provider cancellation after confirmation triggers immediate operations support, customer notice, rebooking/alternative options if available, and policy-based refund. A customer receives a clear choice and time limit; do not silently substitute a different property/provider.
- Listing owner removal never overrides guest booking terms. Support can see the booking snapshot even if the listing is no longer public.

## 6. Support, AI, email and announcements

### Human support

Every Help entry creates or opens a tracked case, linked to booking/listing/service when context exists. The user sees case reference, category, urgency, status, expected next update, assigned team when appropriate, messages, attachments, and reopen/escalate action. A case has an accountable queue/assignee, response clock, urgency rules, reminders, escalation on breach, and closure reason. If the team cannot meet a published response target, show receipt and progress without claiming an unstaffed SLA.

A user should not have to discover whether “no response” means a worker, host, hotel or WeHouse support. Ask which party is not responding, attach the relevant booking, and route to the correct workflow. Immediate danger routes to emergency guidance and staffed urgent safety coverage, not only a chatbot.

### Optional AI assistance

The inspected application currently has human support cases; there is no verified active Anthropic/Claude responder. If AI is added, it should first summarize a case, classify intent, retrieve approved help content, draft a response for staff, and suggest next action. It must not autonomously remove a listing, decide a refund/dispute, promise compensation, expose another user's data or claim it contacted someone. Keep a visible human path and log the source and reviewer for AI-assisted decisions.

### Email and announcement

Gmail is not currently a connected WeHouse code/project integration in this audit. Email can later be a notification channel for the same case/booking record, using an owned support inbox/provider integration and inbound case matching. Do not make a separate untracked email conversation the source of truth.

Announcements are official in-app operational broadcasts, segmented by role/branch/audience and recorded with recipients/read state. Use for service notices, release notes or operational messages; they do not replace direct booking updates, support cases, safety notices or transactional email.

## 7. Account setup and navigation

- Preserve current DOB age-eligibility check and current-version terms/privacy acceptance. Show terms during signup, save version/time, and make acceptance evidence inspectable by authorized audit roles.
- Users can review account details, accepted policies, notifications, privacy choices, help cases and account deletion request from a stable account area.
- Bottom tabs belong to top-level marketplace/workspace navigation. Detail, booking checkout and focused full-screen flows hide them consistently; back returns to the same parent search/context. Test housing, room, hotel checkout and service detail on narrow screens and nested sheets. The verified source already hides tabs on selected nested routes; investigate any reproduced persistent tab by recording route, transition and viewport before changing global navigation.

## 8. End-to-end acceptance gates

Each gate is required before claiming the corresponding journey complete.

| Gate | User can… | System proves… | Operations can… |
|---|---|---|---|
| Publish | submit each property/service type with complete required facts | validation, ownership, RLS and state transition are enforced server-side | review, request changes, approve, pause and audit |
| Discover | find only live/available listings and understand price, type, occupancy, amenities and location mode | search returns authoritative publication/availability data | diagnose stale/missing inventory |
| Book | see full terms, submit once and receive reference/status | server revalidates price/availability and prevents duplicate/overlapping confirmation | inspect immutable booking facts |
| Manage | pause/block dates or request removal | owner authority and active-booking protections apply | preserve obligations and process safe removal |
| Report | report a property/provider or route booking issue | privacy, rate limits, receipts, queue and audit work | triage by severity, investigate, restrict/resolve/appeal |
| Service response | see who must respond and by when | reminders, expiry, payment release/refund and idempotency work | monitor overdue and failed jobs |
| Stay/service incident | contact help from the booking and see the next step | refund/rebook/cancel events reconcile across database and payment processor | assign, escalate and complete a case |
| Account/legal | set DOB, accept current terms, manage profile | age/legal evidence is versioned and protected | investigate only through authorized audit access |
| Announcements | receive role-relevant official notice | audience, read status and delivery are auditable | target the correct segment without substituting for transactional communication |

Verification must cover guest, owner/host, hotel operator, provider, support, moderator and admin roles; desktop/mobile; empty/loading/error states; cross-account access; double submit; timeout/retry; and active booking during pause, report, owner removal, or staff restriction.

## 9. R1–R11 delivery sequence

These are gates, not eleven disconnected feature batches. A later gate must not change a canonical rule without updating this contract and its verification evidence.

1. **R1 — Product boundaries:** approve domain ownership, role map, business terms and supported markets; assign a product/operations owner per queue.
2. **R2 — Contracts:** decide short-let whole-home versus future units, exact cancellation/refund rules, provider response deadlines, evidence/retention and safety actions.
3. **R3 — Inventory and booking:** map every state and authoritative source; add no schema until required fields/constraints are mapped.
4. **R4 — Migration truth:** reconcile production/test migration histories read-only; reviewed migration plan before production DDL.
5. **R5 — Payments and reconciliation:** verify authorization/capture/refund/payout states, idempotency and failure recovery per booking type.
6. **R6 — Trust and access:** review report/moderation scope, RLS/RPC grants, private evidence, roles, audit trail and abuse rate limits.
7. **R7 — Operations/support:** staff queue ownership, response clocks, escalation, case linkage, incident playbooks and notification delivery.
8. **R8 — Performance and reliability:** prioritize measured hot paths, availability race prevention, retries, monitoring and service health; classify advisor warnings instead of bulk changes.
9. **R9 — User experience:** complete listing setup/details, booking terms, report and removal flows, service modes/packages, pending clocks, account and contextual help.
10. **R10 — End-to-end verification:** execute all role/device gates and failure cases against exact commit SHA; record blockers and owners.
11. **R11 — Release readiness:** promote only after gates, production/test migration decision, support capacity, payment/legal/provider setup, rollback and monitoring are documented. Estimate timeline from unresolved dependencies, not a screen count.

### Verified competitor patterns to adapt, not copy

- Airbnb lets users report an individual listing with a reason/details; it directs guests with an active stay problem to reservation support. Its help guidance ties refunds to cancellation policy and timing, with defined reservation-issue exceptions. Sources: [Airbnb: report a listing](https://www.airbnb.com/help/article/3598), [Airbnb: home reservation refunds](https://www.airbnb.com/help/article/3066), [Airbnb: unlist a home](https://www.airbnb.com/help/article/476).
- Booking.com separates content/listing reports from booking issues, asks for the exact listing URL and evidence, confirms receipt, investigates and sends the outcome/appeal path. Its accommodation status API checks required setup before opening; overbooking guidance routes guest and property through customer service for an alternative/relocation. Sources: [Booking.com: reporting content](https://m.booking.com/content-moderation-policy/reporting-content-on-booking.en-us.html), [Booking.com: property status and opening requirements](https://developers.booking.com/connectivity/docs/property-api/status-endpoint/status-introduction), [Booking.com: property statuses](https://developers.booking.com/connectivity/docs/property-statuses), [Booking.com: overbooking guidance](https://developers.booking.com/connectivity/docs/con-faq-reservations-troubleshooting-overbookings).
- WeHouse should use those patterns to make consequences, case ownership, receipts and next steps clear. Copying another company's legal, refund or cancellation policy would be inappropriate; WeHouse must define policies for its market, payments, partners and staffing.

## 10. Current release notes

- The product coherence audit at docs/WEHOUSE_PRODUCT_COHERENCE_AUDIT_20261012.md is a code/schema/config snapshot.
- The report UI was added on the PR branch after that baseline snapshot. It remains draft until checked against Section 4 and the R6/R9/R10 gates.
- At SHA 904454547a297cfec1f241601524aa70864e0498, Build and Structural Regression passed; Mixed Journey passed; browser matrix was still running at the last snapshot. Consolidation Migration Replay and Tests/Build passed. Existing Account Upgrade failed while starting its disposable Supabase baseline: Docker/container error exit 125 after image-pull rate-limit errors; upgrade assertions were skipped. Treat as environment/bootstrap failure to investigate or rerun, not proof of an application regression and not a green check.
- This is not production release approval. Vercel preview readiness is tied to exact source SHA, and production Supabase was inspected read-only in the cited audit.
