# WeHouse Creator controls and layout review — 19 September 2026

Work continues on existing draft PR #74. Changes in this review are for its preview and the isolated WeHouse Test backend. They are not a production release.

## What the owner reported

Repetition was present beyond legal pages. The earlier scan of literal headings within individual files did not detect titles repeated between a layout, a page and an embedded component. Back navigation also looked like an extra strip added to the page.

## Repairs

- Removed the outer desktop breadcrumb/title strip. Pages retain their own title and navigation.
- Creator and Admin operation Back controls now sit next to the page title. Creator platform subpages use the same header and return to the correct parent.
- Embedded People, Team, Finance and Change history sections suppress a heading that matches the workspace title. Different section headings remain visible.
- Removed repeated platform/settings-group introductions for single-group settings pages, and the redundant Legal documents editor title when embedded.
- Public legal pages use the shared 44-pixel Back button alongside the heading. The black page background remains.
- Booking details have one page-level heading; the property name is a section heading.
- Restored access to the existing paid Service Provider plan controls under Operations → Platform settings → Paid Service Provider plan. No price, sales switch, provider credential or payment mode was changed.
- Settings groups are typed; the stale, nonexistent `worker_verification` group reference is removed. Free professional review remains in its existing review workspace.
- Settings fail visibly when loading fails. The editor does not offer to save fallback values after a failed read.
- Save operations are serialized. A failed bulk save stops at the failed setting; verified earlier changes remain saved. Inputs are disabled during saving, and errors release the busy state. The server value is read back before reporting success.
- A price saved without a successful Paystack plan sync reports partial completion and keeps the existing server sales gate. It does not claim provider setup succeeded.
- Shared settings readers refresh after a save, on returning to a visible tab, and through one shared 60-second timer while consumers are mounted and the tab is visible. In-flight reads are shared; failed reads can retry and stale responses cannot overwrite fresh values. This refresh is for display; privileged actions must still enforce current server rules.
- The Test Auth before-user-created hook now enforces Creator registration and maintenance settings before creating any new email/OAuth identity, in addition to the reviewed-legal requirement. No permanent users or policy documents were created for testing.

## Creator and bootstrap evidence

Production read-only inspection found one non-deleted Creator profile and one active Creator workspace assignment. Anonymous and ordinary authenticated users cannot execute first-Creator bootstrap.

A transaction-scoped Test database contract verifies:

1. An ordinary user cannot update registration settings or call server-only bootstrap/access helpers.
2. Bootstrap rejects an incorrect expected email.
3. Repeating bootstrap for the same exact confirmed identity retains one active Creator assignment and the Personal identity.
4. A different second Creator is rejected.
5. Successful bootstrap attempts and a Creator settings change produce audit records.
6. Closing registration or enabling maintenance rejects new Auth identities through the signup hook.
7. The Auth service has the required narrow helper permission; normal clients do not.

The fixtures roll back. Readback confirmed zero leftover fixture accounts and profiles. Bootstrap is initial owner setup, not something to run at every login or deployment. Initial app loading has separate existing bootstrap-shell tests.

Migration `20260919165717_creator_registration_controls.sql` is applied only to Test. Its server-only helper returns two boolean decisions and never accepts arbitrary setting names or returns settings values. The legal hook remains security invoker. The helper has an explicit Auth-service-only EXECUTE grant; no browser/table privileges were broadened.

## Verification and limits

- 151 local JavaScript tests passed, including five new executable settings/rendering tests.
- TypeScript/build and lint passed during this repair. Required hosted checks are tracked on the PR for the final commit.
- The Creator/bootstrap SQL contract passed against hosted Test. CI now runs seven SQL contracts and the actual local Supabase Auth HTTP hook test after full migration replay.
- The security advisor still reports existing intentionally public endpoints and a broader signed-in privileged-function surface. The new helper is not callable by either public client role. This is not a clean security audit of every endpoint.
- Production and preview browser tabs are signed out. Rendered component tests and source composition review do not replace a complete signed-in walkthrough of all tabs, physical phones, iPad, keyboards and deep detail states. No customer credentials were entered and no debug login route was added.
- Nested record-specific Back controls can still appear inside an operation; they return from that particular record. The repaired operation Back returns to its work-area list. Their complete signed-in navigation still needs testing.
- Maintenance blocks new registrations and normal sign-in through existing application checks. It does not revoke existing sessions, stop background jobs or shut down every API. The control now says this explicitly.

## Why WeHouse is not technically ready for launch yet

| Remaining work | Plain meaning | Kind |
| --- | --- | --- |
| Complete Test provider setup | Test Google is disabled; payment/call test credentials and auth settings still need safe alignment | Configuration |
| Full customer/team journeys | Finish real signup, recovery, booking/job, permission, support, payment and two-device chat/call tests; repair failures | Testing and any resulting code fixes |
| Property-system integration | The hotel PMS gateway has improvements, but vendor certification and partial catalog-batch recovery remain | Code/integration/testing |
| Recovery and release | Prove database/media restoration and account deletion/retention; release matching frontend, database and functions together | Technical operations |
| Mobile and tablet review | Check signed-in layouts, safe areas, keyboards, slow connections and original in-app-browser route on real devices | Design/testing |
| Account security configuration | Leaked-password protection requires the Supabase plan upgrade; branded auth domain/Google branding still need activation | Configuration/paid service |

Main-branch protection is complete. Green builds mean the checked code builds and tests pass; they do not prove the complete product works with providers and real devices. The owner's definition is not met while the technical rows above remain open.

Legal approval/publishing, payment-provider business/bank approvals and the owner's deferred live/manual payouts are separate. No real payout work was enabled by this review.

## What the control panel can reasonably do

Existing areas cover people and team assignments, property review/publishing, professional review, booking oversight, finance records, analytics, audit history, public contact settings, access, service/property categories, trust rules, legal documents and the restored paid-plan settings.

This is not proof every operational action has passed a real end-to-end test, nor that every business policy has an exposed control. Ordinary business configuration should be managed through authorized, validated and audited controls. New product behaviour, security repairs, provider API changes and database capacity changes still require engineering. A control panel cannot make an application permanently maintenance-free. At larger traffic levels, public configuration delivery needs cache/load measurement; do not promise support for millions from this review.

## Business recommendation to validate, not a feature added in this PR

Build a recurring property-operations subscription, working name **WeHouse Care**, alongside existing marketplace fees and optional WeHouse Works tools.

- Buyer: estate/property managers and multi-property landlords managing long-term homes; start with one customer segment in one city.
- Monthly value: maintenance requests and planned upkeep, provider assignment, resident communications, expense records and owner reports. Rent records/reminders can follow validated demand. Repairs/materials are separately priced; do not promise unlimited maintenance.
- Revenue: a monthly minimum plus a charge per managed unit. Price is a pilot hypothesis, not an established market fact. Validate willingness to pay and support cost before setting permanent prices.
- Advantage to pursue: WeHouse connects the property, resident, responsible manager and vetted local service provider around the same job and history. Existing property/service relationships are a starting point; the full operating subscription is not already implemented.
- Validate with ten property managers and a few paid pilots. Measure repeat weekly use, jobs completed, support cost, renewal and contribution margin before broad development.

Buildium markets recurring subscriptions including maintenance, leasing and communications; MaintainX markets maintenance workflow subscriptions. These are examples of an established model, not evidence that Nigerian customers will accept a particular WeHouse price: https://www.buildium.com/pricing/ and https://www.getmaintainx.com/pricing.

Less reliance on new bookings can make revenue steadier. Retention, margin and reliable service determine whether the business becomes more valuable; a new name or subscription alone cannot guarantee a valuation.
