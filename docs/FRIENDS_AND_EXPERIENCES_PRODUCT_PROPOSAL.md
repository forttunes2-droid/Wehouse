# Friends and Experiences product proposal

**Status:** the two-person encrypted Friend plan is implemented; hosted/two-device verification remains. Friend groups are deferred by the owner and excluded from this release. Experiences now has private applications, activity-specific documents/photos, independent approval, dated-session preparation/prices, revision and host Activity on Test. Public catalog/publication, booking/capacity, protected checkout, cancellation/refunds, attendance, reviews, sharing, discounts and sponsorship remain internal work.
**Reviewed:** 23 October 2026
**Decision state:** private Friend groups are deferred by the owner on 20 October, superseding the earlier direction. On 19 October the owner removed shows and parties from the Experiences direction. Provider-led activities remain in the agreed full product scope; Friend groups are excluded for now.

## Product fit

WeHouse should make it easy to go from **“we should do something”** to a real plan. That should work for dinner, a day activity or a trip. A property can be one possible part of a trip; it must not be the prerequisite for making a plan.

## One person who is both Roommate and Friend

There is one WeHouse account and two independent relationships. Accepting someone as a Friend does not make them a Roommate, and a Roommate match does not grant Friend status. If the same two people mutually establish both relationships, they can see the person in both relevant contexts: the separate Roommate workflow/conversation and the accepted-Friend conversation. Each has its own permissions, message history, reporting/block controls and purpose. Nothing from one chat should be copied into the other or used to infer a booking, contract or consent.

Booking eligibility continues to follow the booking type: Roommates can share eligible Long Let arrangements under the existing rules; accepted Friends can share eligible Long Let, Short Let and Hotel booking costs. Hotel cost-sharing is an approved rule but is not implemented yet. Being both does not create a second profile, combine chat histories, bypass booking limits or automatically charge anyone.

## Friend chat: first slice

The current Friend experience is a one-to-one accepted relationship and end-to-end encrypted conversation. Keep the plan inside that conversation as a new structured message/card, alongside ordinary messages. The first version should work for two Friends and should not require a property listing, public event, payment or booking.

Current flow:

1. A **Suggest a plan** action is available in the Friend chat composer. Friends are accessed from Inbox Messages, not Activity. The card title is **Plan together**.
2. The author suggests an activity, date/time and optional place in the chat. The message keeps the sender's timezone.
3. The Friend receives an encrypted plan card and can say “I’m in” or “Suggest a change”. The response is a normal encrypted reply tied to the plan message.
4. Both users can react, pin, reply to, or delete the plan message using the existing message actions. It is explicitly a personal plan, not a venue reservation or ticket.
5. Public experience sharing is not implemented yet. Later, a public listing can be shared as an ordinary Friend message; its own page must handle availability, price, age/entry rules and its booking rules.

### What private planning adds

A two-person plan means the sender and one accepted Friend agree on a suggested activity, time and place in their existing conversation. It is not a subscription plan, package, venue reservation, ticket or payment commitment. Removing public shows and parties does not remove the usefulness of arranging dinner, coffee, a walk, a day activity or a trip. Selecting Something else includes a short description field.

Friend groups would let several accepted Friends discuss one shared plan in one private thread instead of repeating it across individual conversations. The proposed group adds membership and shared coordination; it does not create Roommate eligibility, a booked stay, a public event or a debt. The core benefit to WeHouse is convenient private coordination around local activities and trips when users want it. Retention or booking conversion is a hypothesis to measure, not established revenue. Never force a booking or add unsolicited offers to the chat.

**Implementation state:** the one-to-one plan card exists in source and has focused structural/payload checks. Its full hosted/two-device journey is pending. Friend groups are deferred and excluded from current implementation work.

## Deferred Friend group proposal (not current implementation scope)

Keep individual Friend chat. Add a distinct, closed **Friend Group** that a user creates and invites only from their already accepted Friends. A practical first limit is the creator plus five invited members, matching the existing small Friend network scale; treat that as a proposed cap to confirm against real use. No public directory, stranger discovery, open invite links, attendee list or property requirement. Each invitee must accept before seeing the group.

For the first group release, include encrypted text chat, member list, leave, block/report, remove-member controls for the creator, and the same private plan card in the group thread. Keep the plan private to group members; it is not a reservation, ticket, or public RSVP. Do not build event ticket checkout, group calls, payments, public member profiles or arbitrary event publishing into this slice. A user can share a public Experience link into the group explicitly; the link points to a separately governed public listing.

### Privacy and technical boundary

- Friend chat content is currently end-to-end encrypted. The plan title, note, proposed time, custom location and responses must use the same client-side encryption before persistence. Do not add a plaintext `hangouts`/`events` table containing those fields while continuing to claim that the conversation is unreadable to WeHouse.
- A structured message can be encoded in the encrypted message payload and rendered as a card after decryption. Keep the current encrypted message store and one-to-one thread. Do not create another chat, message history, wallet or booking model for this feature.
- The public experience identifier/link may be visible only if the user explicitly attaches/shares that public listing. A user must be able to delete their own plan message under the same Friend message deletion rules.
- Current Friend chat is one-to-one and uses a pairwise encryption context. It cannot safely become group chat by reusing that key or duplicating messages into individual chats. Group implementation needs an explicit membership model, server-side authorization on every read/write, and a group encryption design reviewed before schema or code changes.
- Recommended group encryption: encrypt each message with a group epoch key; distribute that key to each accepted member using a member-specific encrypted envelope. Increment the epoch and issue a new key when someone joins or is removed. New members see messages from after they joined; removed members cannot decrypt future messages. Store membership/control metadata server-side but keep chat and plan content encrypted. Define device recovery, key rotation failures, blocked-user behavior, backup, report evidence and deletion before implementation.
- Do not imply that end-to-end encryption means there can be no reporting: make a user-selected report flow that lets the reporter explicitly submit selected decrypted message(s) plus context. Explain that this exposes only the selected evidence to the safety team.
- Structured payloads need a version, strict schema validation, size limits, safe rendering, duplicate-send protection and a fallback for old app versions that can display the content as an ordinary encrypted message.

This preserves privacy and fits the real chat model. The card is a client-rendered structured form of an encrypted message; the server stores only the same ciphertext/IV fields as other Friend messages. The other Friend's response is a message reply, not a group or server-authoritative RSVP roster. Updating a proposal means sending a new plan card. If users need a shared RSVP roster, design that as a later feature with its own clear privacy disclosure and data model.

## Experiences: provider-led activities

### Application catalog implemented on Test - 21 October 2026

The shared Service Worker workspace uses a server-owned, market-scoped category
catalog rather than independently maintained UI and submission lists. Nigeria
currently accepts private applications for:

| Category | Examples of appropriate applications |
| --- | --- |
| Culture and local tours | Local history walks, campus or city orientation, cultural visits |
| Food and cooking | Cooking classes, baking workshops, guided food tastings |
| Creative and practical workshops | Photography, arts and crafts, practical skills classes |
| Outdoor activities | Guided nature walks, introductory outdoor skills, supervised local activities |

These are application categories, not invented published activities. Relevant host
expertise, safety and market/category evidence still require review before selling.
No unrelated requested-service occupation is required. One account can offer services,
Experiences or both. Shows, parties and nightlife are excluded.

Identity belongs to the person: the canonical identity record is keyed by profile,
and application ownership is derived server-side from the signed-in profile. Team
membership or company ownership does not verify another person leading an activity.
Live NIN verification remains unavailable until a real provider is integrated.

The implemented private flow is offering choice -> category/activity draft -> save
requirements -> submit -> Creator review -> retained feedback -> correction or decline.
Submissions and decisions now reach canonical Activity within the same workspace,
including applicants who have not completed service review. Exact-record links use
owner/fresh Creator authorization and expose no unsent revisions. Service review
controls requested-service tools independently; common Inbox, account, earnings and
Experiences do not require a service occupation. Existing jobs remain manageable
after service credentials expire, with new work still blocked on current requirements.
Public approval/evidence, media, dated sessions, capacity, prices, bookings, payment,
refunds, host settlement and customer support remain implementation work. Do not
present the private application flow as a complete customer Experiences product.

**Owner decision, 19 October 2026:** leave shows and parties out. The previous event directory, nightlife, organizer referral and sponsored event proposal is withdrawn. It must not be treated as an approved implementation plan.

The narrower proposal is a marketplace for provider-led activities such as guided tours, cooking or creative classes, and suitable outdoor activities. Users should understand what they will do, who provides it, the location, duration, total price, available session, inclusions, accessibility and cancellation rules. Booking a property is not required. A private Friend plan remains a chat message and cannot reserve an activity.

The complete marketplace is not implemented or launch ready. Private applications and initial review feedback are implemented on Test. Before accepting bookings, confirm actual provider supply and the commercial role, then specify one complete journey: provider application and review; listing and session approval; capacity and availability; booking confirmation; payment and provider settlement; cancellation and refund; completion; reviews; and report/support handling. Reuse the canonical identity, money and moderation systems where their contracts fit. Do not route a scheduled activity through a Worker job request that requires the customer's service address.

No extra wallet, event ticket system, public attendance feed or second social product is proposed. Do not publish fictional offers or imply that a contact link confirms a booking. The activity provider's documentation and local requirements need review for the actual category and launch location before sales. Existing Terms and Privacy remain subject to publication and legal review; this proposal does not establish compliance.

### Proposed first complete activity journey

Start with scheduled, fixed-price activities from reviewed providers. A concrete example is a cooking class: the customer chooses a dated session and number of places, sees the meeting point, duration, inclusions, accessibility, cancellation deadline and full total, then reviews the order before paying. Confirmation must show the booked session, participant count, provider and support route. It must not display a booking merely because checkout opened.

| Part | Required behavior |
|---|---|
| Provider | One WeHouse identity with an explicitly approved activity-host capability and category-specific evidence. A person may apply directly to host an Experience without offering requested services or holding a catering listing. Existing Service Worker approval does not automatically approve an activity. |
| Offer | One Activity description and provider; dated Sessions carry local timezone, meeting point, price, capacity and cancellation state. No customer home address is required unless the actual activity explicitly takes place there. |
| Capacity | A server-side short-lived hold reserves places atomically. Checkout revalidates price and capacity. Expired holds are released; replayed requests return the original result rather than taking more places. |
| Payment | A canonical booking payment reference is tied to the activity booking. Only verified provider confirmation can mark it paid. A late payment after hold expiry goes to reconciliation/refund rather than overselling or silently disappearing. |
| Earnings | Agreed commission is snapshotted into the booking. Provider earnings use the existing canonical money authority with explicit activity attribution; no second wallet. Choose and approve release timing/refund liability before enabling checkout. |
| Changes | Provider cancellation notifies affected customers and creates a tracked refund obligation. Rescheduling requires customer consent; a new date cannot be imposed silently. |
| Customer controls | Booking details, cancellation preview and confirmation, refund status, provider contact, support and report reference. Cancellation entitlement is decided on the server from the booking snapshot. |
| Review | Only an eligible completed booking can create a review. Removal/moderation and appeal controls need a real queue and audit history. |
| Operations | Creator can review providers and activities, pause new sales, inspect affected bookings, route complaints and manage refund/reconciliation exceptions with scoped audited commands. Staff delegation comes from the same capability model. |

A commission on completed, paid activities is the simplest proposed revenue model. No percentage has been approved and no revenue is assumed before actual provider participation and reliable fulfillment. Private Friend planning stays free and never creates a charge. Supplier subscriptions, sponsored event placement and an event-referral directory are not required for this model.

### Implementation evidence required

There is currently no Experiences catalog, activity-session availability or activity-booking flow in active application source. The table above is the proposed contract, not implemented functionality. The first code slice must follow it through provider review, listing/session publication, customer booking and the internal exception queue, with failure and role checks. Do not add an attractive public tile that leads to an unfinished action.

### Competitor comparison: patterns, not a superiority claim

| Public competitor pattern | WeHouse plan | Current limit |
|---|---|---|
| Airbnb states who hosts and requires consent before changing confirmed price/time/date/location | Disclosed reviewed provider, booked-session snapshot, consented rescheduling | Proposed; no implemented Experiences booking journey |
| Airbnb displays cancellation rules before payment and in booking details | Pre-payment cancellation disclosure and a booking snapshot used by server cancellation/refund controls | Proposed; percentages/deadlines and operating approval still need final policy |
| Booking.com Attractions discloses whether the customer contracts with the provider or an aggregator | Disclose the actual seller, platform role, fulfillment and refund responsibility before payment | Exact WeHouse commercial/legal role still needs approval |

Sources: [Airbnb host rules](https://www.airbnb.com/help/article/3855), [Airbnb cancellation disclosure](https://www.airbnb.com/help/article/1593), [Booking.com terms, Attractions](https://www.booking.com/content/terms.html).

This is a coherent proposed structure, not evidence that WeHouse is more capable than Airbnb or Booking.com. Those public patterns do not reveal their entire internal operating systems. Quality must be demonstrated through verified supply, correct fulfillment, reliable money handling, usable screens and effective support.

## Place in the release programme

Use the activity journey above for the next Experiences implementation design; the owner has already removed shows and parties, so do not reopen that proposal. Recruit and verify real activity providers before enabling public sales. Continue housing, wallet, role permissions, design consistency and release verification under the existing release roadmap. Friend groups remain deferred and are not an Experiences release dependency.

### Screen and implementation sequence

This is the required implementation sequence, not a statement that the screens exist.

1. **Shared provider eligibility:** replace the assumption that service approval unlocks every provider screen with explicit requested-service and activity-host capabilities. Existing jobs and conversations retain their permissions. Experiences-only applicants can reach identity, activity application, review feedback and support without inventing a service occupation. Reuse the existing Service Worker workspace and Team authority.
2. **Provider activity management:** within that workspace, offer activity drafts, submitted changes, review feedback, approved offers, dated sessions and reservations. Drafts preserve incomplete work; publication checks the current host, evidence, venue and activity policy on the server. Sessions show local timezone, places remaining, price and cancellation state. Earnings and Inbox stay shared. Service-only providers retain their existing useful navigation; do not expose empty or nonfunctional Experiences controls before the journey is available.
3. **Creator operations:** extend scoped review and support queues to cover activity applications, evidence, publication, pauses, affected reservations and financial exceptions. Every submission and report needs a reference, visible status, accountable queue and audited decision. Team members receive only explicitly delegated controls.
4. **Customer discovery and details:** Experiences is a category within Explore. Cards show truthful activity, location, duration and starting price; details identify the host, what happens, inclusions/exclusions, meeting arrangements, requirements, accessibility and cancellation policy. Filters operate on real published supply. Empty results say so. A Friend can share a public listing link without creating a reservation.
5. **Reservation and money:** session and places selection leads to an atomic capacity hold, server-priced order review, canonical payment and verified booking receipt. Booking details expose participants, session timezone, contact, cancellation preview, refund progress and support. A processing payment stays processing. Sold-out, expired hold, changed price, declined payment and late confirmation require explicit recovery paths. Never create a parallel wallet or use an ordinary service-job address to represent a session venue.
6. **Completion and release verification:** support host cancellation, consented changes, attendance/completion disputes, eligible reviews and settlement/reconciliation. Inspect real provider/customer/Creator journeys, concurrent last-place booking, duplicate and late payment events, unauthorized Team access, both themes and responsive failure states before enabling sales. Policy commission, settlement timing and contractual responsibility must be approved before checkout activation; they are not placeholder constants.

Use customer wording consistently: **Experience**, **session**, **places**, **Experience host**, **booking**, **total**, and **cancellation policy**. Keep **service request** for requested services and **Suggest a plan** for private Friend chat. Do not call an activity a job, a private plan a booking, or a pending payment a confirmed reservation.

## 20 October clarification: categories and customer structure

### Shared workspace and independent eligibility

#### One provider onboarding journey

Services and Experiences use one provider onboarding journey inside the existing
Service Worker workspace. The offering determines the extra fields; it does not
create another account, business dashboard, wallet, Team or identity record.

1. **Use your account:** reuse the existing personal account, confirmed contact
   details and trusted-device access. Creating an ordinary account does not require
   NIN or service-provider approval.
2. **Choose what to offer:** requested services, Experiences, or both. Existing
   Service Workers can add an Experience from the Experiences section without
   repeating service setup, buying Pro or offering catering first.
3. **Confirm shared provider details:** public name/photo, contact and any required
   individual/business identity information. Reuse current verified information;
   request an update only when it is missing, expired or materially changed.
4. **Describe the offering:** collect only the fields needed for that booking type.
   Requested services need scope, service area, scheduling and pricing. Experiences
   need activity details, relevant expertise, media, meeting arrangements, duration,
   participation/accessibility information, dated sessions, places and total price.
5. **Complete relevant review:** show a single checklist with saved, missing,
   submitted, changes requested and approved states. Identity is shared; licences,
   insurance, venue/safety evidence and expertise are assessed for the actual
   offering/category/market. Service approval never automatically approves an
   Experience. Written claims alone must not manufacture verified expertise.
6. **Prepare paid bookings:** reuse the canonical payout account and wallet; disclose
   the approved fees, settlement/cancellation/refund responsibilities and applicable
   terms before enabling paid publication. Never charge for normal onboarding or
   require Pro to submit an offering.
7. **Publish and manage:** publish only after all current requirements pass. Manage
   requested jobs and activity reservations in the same workspace, with shared
   Inbox, earnings, Team authority and support. Review material changes and expiring
   evidence without erasing existing bookings.

**Current limit:** private Experience drafts, submission, withdrawal, history and
Creator correction/decline are implemented on Test. The full common checklist,
activity evidence approval, media, dated sessions, paid booking and publication
journey above are not complete. This is the acceptance contract for the existing
release register, not a new parallel plan or a claim that the whole journey works.

**Primary-source comparison, checked 21 October:** [Airbnb's application
process](https://www.airbnb.com/host/experiences) describes host/activity background,
details/photos/itinerary/pricing, human review, requested corrections/documents,
then approval/publication. [Airbnb's publication
requirements](https://www.airbnb.com/help/article/4084) include identity and
applicable licences, permits or insurance. [Booking.com's Attractions
terms](https://www.booking.com/content/terms.html) distinguish direct providers and
aggregators. A confirmed distribution route is [Viator supplier
onboarding](https://supplier.viator.com/sign-up-info): email confirmation, supplier
portal, identity/account verification, product setup/review and payout setup, with
distribution including Booking.com. These sources do not establish one universal
direct Booking.com sign-up route, guaranteed distribution or WeHouse's local legal
requirements. WeHouse does not adopt Viator's submission fee.

#### Independent offering eligibility

Experiences belong inside the existing Service Worker workspace. A person may offer requested services only, Experiences only, or both. The onboarding choice must expose the relevant application rather than requiring an unrelated service occupation, service listing or completed service job. Share account identity, wallet, Team permissions and support; assess each offering against its own requirements. Do not create another provider account or dashboard.

For example, a capable cooking instructor can apply to run a cooking class without selling catering. Review relevant teaching/cooking experience, the proposed session, venue and food-safety arrangements, and documents required for that activity and market. A catering provider can also apply, but catering approval alone does not approve the class. Mandatory licences cannot be replaced by a portfolio; formal qualifications should not be invented as a universal requirement for unregulated activities.

Use **Service Worker** for the existing workspace name, **service provider** where natural in service customer copy, and **Experience host** for the person leading an activity. These are contextual descriptions of the same account, not competing roles or wallets. Internal `worker_*` identifiers remain implementation contracts and are not customer wording.

Research checked on 20 October: [Airbnb hosting routes](https://www.airbnb.com/help/article/18) distinguishes applying to host Experiences from offering services; [Airbnb review process](https://www.airbnb.com/help/article/3937) assesses identity, relevant qualifications and applicable licences. These support independent activity assessment; they do not establish WeHouse's legal requirements in every market. This clarification is an implementation contract. Private applications are implemented on Test; the customer/session/payment journey remains unbuilt.

Implementation status is **private applications implemented; complete marketplace not built**. Experiences is a single provider-led activity marketplace independent of accommodation, not a new chat mode or a requirement to book a home. Categories such as culture/tours, food, creative learning and suitable outdoor activities are data/filter choices over one activity -> dated session -> booking model. Category availability and provider evidence are enabled deliberately by market and risk; the existence of many possible activities does not mean every activity is accepted automatically. Shows, parties and nightlife remain excluded.

Customer flow: choose destination/category and date, review the activity/provider, meeting location, duration, participation/accessibility requirements, inclusions, cancellation rules and total; select a session and places; hold capacity on the server; review and pay through the canonical payment authority; receive a verified booking with provider contact, cancellation/refund status and support. No success or earning is inferred from an opened checkout. Specialized requirements extend category policy rather than creating separate mini-apps, account systems or wallets.

#### Optional pricing promotions

Discounts are optional, not a condition of publishing or selling. A scheduled
Experience may have a fixed base price per participant or group and an optional
time-limited promotion on that offering. Keep the original price, pricing basis,
participant count, funded discount, currency, expiry and final payable amount in
the server quote and immutable booking snapshot. Changing or removing a promotion
must not reprice a confirmed booking or change its refund basis. Do not infer a
discount from a provider's negotiable service estimate, or invent a crossed-out
original price for a job quoted individually. Provider-funded and WeHouse-funded
reductions require separate settlement treatment; no implicit stacking.

This is part of the unbuilt Experience quote/session/payment work, not a working
discount control today. Competitor research on 23 October: Airbnb supports optional
Services/Experiences promotions and separately excludes fixed-price service
offerings from its tools (https://www.airbnb.com/help/article/3421). This does not
require WeHouse to copy those eligibility rules or create another provider workspace.

Compared current primary Airbnb ground rules (https://www.airbnb.com/help/article/3855) and Booking.com Attractions documentation (https://developers.booking.com/demand/docs/attractions/about-attractions): disclosure, dependable fulfillment, activity-specific requirements and clear availability/booking roles matter. WeHouse is not currently equivalent in implementation, supply or operational coverage. Its first scope can remain reviewed scheduled activities while the shared lifecycle is completed.
