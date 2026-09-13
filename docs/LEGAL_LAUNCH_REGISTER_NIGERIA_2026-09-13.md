# WeHouse Nigeria legal and regulated-launch register

Status: merge blocker register

Review date: 2026-09-13
Scope: Nigeria-only v1

This is an engineering and operational issue register, not a legal opinion. A
qualified Nigerian lawyer and the relevant regulator/provider must confirm the
classification and evidence for each regulated launch. A feature flag, a
Creator decision or a paid subscription is never a substitute for that
approval.

## Binding product position

- Worker registration, professional profile completion, evidence submission,
  WeHouse review, Reviewed, Trusted, discovery and eligible job access are
  free. No Worker payment may unlock these states.
- WeHouse Pro is optional monthly software. Its gold `PRO` mark means only that
  the server has verified an active subscription. It is not identity,
  licensing, safety, ranking, endorsement or job access.
- Web Pro uses Paystack recurring billing. iOS and Android use their respective
  stores for native digital subscription sales. Native sales remain disabled
  until store-side products and server verification are complete.
- WeHouse describes protected booking funds as `Payment Protection`, not
  `escrow`, unless a written provider/regulatory approval later authorizes that
  description and operating model.
- Manual hotel operations are supported. Connected PMS support is named and
  certified per provider; WeHouse must never advertise universal PMS support.
- Hotel and Short Let funds remain protected through the disclosed two-to-four-
  hour arrival-issue window after authorized check-in. A formal issue freezes
  the affected amount; check-in or checkout alone cannot release it.
- A Short Let caution fee is refundable by default. A Partner claim requires
  itemized evidence within 24 hours after effective checkout, followed by a
  48-hour guest response window after successful notice. Silence is never
  treated as acceptance.

## Launch register

| Area | Current state | Must exist before launch/claim | Enforced or planned control |
|---|---|---|---|
| Worker marketplace / recruitment | **Blocked** | Written Nigerian counsel classification of WeHouse's exact marketplace, contracting, fee, control and worker-supply model; recruiter/private-employment-agency approval or licence if the Ministry confirms it is in scope; approved Worker/customer contracts and grievance process | `worker_marketplace_launch_enabled=false`; enabling requires a current `legal_launch_approvals.worker_marketplace` record |
| Worker onboarding and professional review | **Free** | Plain-language review criteria, rejection/appeal/correction path, evidence retention schedule and category-specific credential checklist | Paid verification creation is retired; historical payment records stay as financial history only |
| Regulated Worker occupations | **Category matrix missing** | Counsel-approved list of occupations/services requiring licences, permits, insurance or restricted activities in each launch state; issuer and expiry verification; safe public wording | Do not infer a licence from Reviewed, Trusted or Pro; block affected service categories until their rule is configured |
| Face, liveness or other biometric identity checks | **Blocked** | Lawful-basis analysis, DPIA, vendor/controller-processor terms, security review, data-location/cross-border analysis, retention/deletion schedule, accuracy and bias testing, manual alternative, human appeal and incident plan | `worker_identity_checks_enabled=false`; old external identity endpoint is retired; enabling requires a current `legal_launch_approvals.worker_identity_checks` record and a separately deployed approved verifier |
| General privacy / NDPA | **Open blocker** | Data inventory and records of processing; privacy notices and lawful bases per purpose; processor agreements; data-subject access/correction/deletion/objection workflow; retention rules; breach response; DPO and Data Controller/Processor of Major Importance assessment; cross-border safeguards | Published Privacy Policy plus versioned acceptance exists, but policy acceptance alone is not the compliance programme |
| Payments, protection, refunds and payouts | **Open blocker** | Written Paystack/PSP flow approval; counsel/CBN classification of custody, wallet, settlement and marketplace payout model; KYC/AML/sanctions allocation; safeguarding/segregation position; reconciliation, chargeback, refund and complaint procedures | Provider webhooks and canonical ledger are authoritative; UI cannot invent success; no `escrow` claim |
| Pro web subscription | **Fail-closed** | Final price and feature schedule; renewal, cancellation, failed-payment, refund and support terms; consumer-law review; tax treatment; Paystack monthly plan; signed webhook; cancellation route; support capacity | `worker_pro_sales_enabled=false` until price, versioned terms, terms content and Paystack plan are present; provider event creates entitlement |
| Pro iOS subscription | **Blocked** | App Store Connect auto-renewable product, store price, purchase/restore/manage flows, App Store Server Notifications and server transaction verification | No native entitlement from the client; no active iOS sales gate yet |
| Pro Android subscription | **Blocked** | Play Console subscription/base plan, store price, Billing Library purchase/acknowledgement, Real-time Developer Notifications and server verification | No native entitlement from the client; no active Android sales gate yet |
| Property marketplace / agency role | **Open blocker** | Counsel classification of WeHouse and each Partner's role; state-by-state real-estate practitioner/agency requirements; title/authority and property-access evidence; tenancy/short-let contract, deposits, fees, cancellation, repairs, habitability and dispute rules | Verified facts return through review; commercial edits use narrow audited commands; add a state launch matrix before expansion |
| Accommodation arrival issues and protected release | **Implemented fail-closed; legal/PSP wording open** | Counsel- and PSP-approved explanation of Payment Protection, arrival defects, evidence, notice, investigation, decision, appeal, refund/release timing, chargebacks and emergency relocation; operating owner and response SLA | Booking snapshots and displays a 2–4 hour window; authorized check-in starts it; a timely formal case freezes only the affected money; checkout does not release funds |
| Short Let refundable caution fee | **Implemented fail-closed; terms review open** | Approved caution schedule and cap; condition/evidence standard; effective-checkout definition; successful-notice evidence; 24-hour claim and 48-hour response terms; neutral facts review, appeal, refund and chargeback procedures | Full refund is the default; claim must be itemized and evidenced; undisputed remainder is refunded; disputed amount stays frozen; guest silence never awards the Partner |
| Accommodation cancellation templates | **Commercial/legal decision open** | Creator-approved percentages, deadlines, no-show/late-arrival treatment, taxes/fees, refund timing, notice presentation and versioned booking snapshot for Flexible, Standard and Non-refundable templates | Do not activate guessed percentages; provider inability, cancellation or overbooking produces a full refund; caution is never a cancellation penalty |
| Hotel marketplace | **Open blocker** | Each hotel's corporate/operating authority and applicable federal, state and local tourism, fire, health, planning and tax evidence; accurate room/rate/refund/tax terms; incident and guest-complaint process | Manual mode remains fallback; connected PMS does not waive hotel eligibility evidence |
| PMS connected mode | **Blocked until named certification** | Named vendor agreement and credentials; hotel authorization; DPA/security review; field/status/rate/tax mapping; idempotency, replay, reconciliation, monitoring, incident response and rollback; sandbox and pilot sign-off | One adapter at a time; `hotel_pms_connected_mode` approval record is reserved; no “all PMS” claim |
| Reviewed / Trusted / public claims | **Partly implemented** | Published definitions and evidence; substantiation logs; correction/appeal and expiry rules; marketing review that avoids safety, licence or endorsement guarantees | Reviewed and Trusted are non-purchasable; Pro cannot influence them |
| Messaging, calls, reviews and uploaded content | **Open blocker** | Community/content rules; report, block, moderation and takedown operations; evidence preservation and retention; IP/privacy complaint route; age/minor position; emergency and criminal-activity escalation rules | Blocking and conversation closure exist; complete moderation SLA and operator tooling before public scale |
| WeHouse staff and field operations | **Open blocker** | Employment/contractor classification, contracts, confidentiality, safety training, assignment scope, insurance/NSITF assessment and field incident process | Capabilities must be scoped grants; never treat a role label as unlimited authority |
| Corporate, tax and insurance | **Open blocker** | CAC objects/classifications; federal and applicable state tax registration and invoice/receipt design; VAT/withholding/commission treatment; platform, professional, cyber and public-liability insurance review | Financial records are retained; tax values must come from approved configuration, not UI assumptions |

## Research baseline

Primary sources checked for this register:

- [Federal Ministry of Labour and Employment / NELEX Recruiter's Licence](https://nelex.gov.ng/recruiters-license/) — describes the Ministry's licensing programme, statutory references, requirements and its FAQ scope for private employment agencies/labour contractors. Whether WeHouse's exact model is in that scope is a legal classification question, so the gate remains closed.
- [Nigeria Data Protection Commission resources](https://ndpc.gov.ng/resources/) and the [NDP Act General Application and Implementation Directive 2025](https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf) — baseline for the NDPA compliance programme and biometric/high-risk processing review.
- [FCCPC consumer rights](https://fccpc.gov.ng/consumers/consumer-rights-responsibilities/), [business obligations](https://fccpc.gov.ng/businesses/business-obligations/) and [FCCPA library](https://fccpc.gov.ng/resources-library/fccpa/) — baseline for clear, non-deceptive offers, consumer rights, complaints and subscription terms.
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) and [Google Play Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818) — native digital features/subscriptions require the applicable store billing model unless a documented exception applies; ongoing value and clear subscription information are required.
- [Paystack Subscriptions documentation](https://paystack.com/docs/payments/subscriptions/) — recurring web billing implementation baseline; provider contract and product approval still remain operational prerequisites.
- [Nigerian Tourism Development Authority](https://ntda.gov.ng/) — identifies accreditation, classification and grading of tourism establishments as part of its mandate; counsel must reconcile federal, state and local hotel requirements for each launch location.

## Evidence rule

An approval record must name the decision-maker/authority, reference the written
evidence, define its scope and conditions, and include approval/expiry dates.
Confidential advice and identity documents stay in the approved evidence store;
the database register contains only the operational reference. Revocation or
expiry closes the corresponding high-risk gate.

## Merge meaning

Engineering may merge fail-closed controls while a legal item remains open. It
must not merge or advertise the regulated feature as live. Production launch is
allowed only when the row above has its evidence, implementation, operating
owner and regression test, and the applicable gate is deliberately opened.
