# Pro plans and merge review — 30 September 2026

This review accompanies PR #107. Automated checks must pass on the final commit.
This document is a feature assessment and validation plan; it does not certify
production capacity, real payment processing, real devices or a completed
paid-hotel cancellation workflow.

## Worker Pro

A useful optional starter plan for workers with regular WeHouse jobs:
- Work Insights, released-earnings CSV and quote/invoice PDFs.
- Upcoming job schedule and one in-app reminder per job.
- Up to six published service packages and three featured owned work posts.
- Consented repeat-customer records and private notes; consent removal deletes notes.
- Customized service receipts for completed, released jobs.
- Priority routing for ordinary support, behind safety/payment cases.

Keep basic discovery, bookings, posting, professional review and payment receipts
free. Membership never buys verified trust, ranking or Sponsored campaigns.
Reminders currently run only while the business-tools screen is mounted; the
product copy now states that. They are not background, email or push reminders.
Featured posts are profile presentation, not increased marketplace reach.
Custom receipts are not tax invoices or proof of bank payout.
Quotes/invoices remain readable/exportable after subscription expiry. The newer
business-tools view requires current paid entitlement.

The new review hold pauses paid access and new checkout on verified Paystack
refund/dispute events. Later subscription events cannot clear it. Existing work
documents and subscription-management/cancellation remain accessible.
Finance must reconcile the provider, including future recurring billing, before
calling the service-only resolution command. The hold itself does not send a
refund or cancel the external Paystack subscription.

## Property Partner Pro

A useful optional starter plan for owners with multiple properties:
- Portfolio stays across owned homes/hotels.
- Released-income totals, CSV and statement PDF.
- Maintenance/turnover tasks scoped to currently owned assets.
- Forward 30-day booked-unit-night ratio and guest arrival instructions.

It is prepaid month/year web access, without automatic renewal. Ordinary listing,
booking and basic receipts remain free. Native Partner Pro purchasing is not
implemented; the app keeps that checkout closed.
The ratio uses listed room capacity and excludes cancelled stays. It does not
subtract room closures or manual occupancy, so it is not an operational PMS
occupancy percentage. Tasks neither assign staff nor change inventory.
Arrival guidance appears only on the guest's paid booking.

The feature set supports a modest initial subscription; it does not yet justify
claims of a complete property-management system, accounting software or automated
turnover. Price/value validation needs actual intended customers. Preview prices
were zero and Partner sales were closed at inspection; no live prices, terms or
sales settings were changed.

## Repairs in this review

- Resolve ambiguous browser selectors for job cards and image/audio upload inputs.
- Exclude unused local mail service from the disposable catalog runner to avoid
  its occupied-port startup failure; retain capacity thresholds.
- Use the existing accessible in-app choice sheets on new Pro screens.
- Improve Worker plan light-mode text and expose Partner occupancy/arrival benefits.
- Handle rejected/malformed business/arrival reads with retry instead of a stuck view.
- Reset plan acceptance when the account or displayed terms change.
- Add Worker refund/dispute review with replay, environment, authorization,
  later-renewal and resolution checks.
- Serialize customer-consent removal with note writes on the Worker profile row.
- Exercise custom reminder choice and saving in the browser.

## Required verification before paid launch

1. On a disposable, authorized Test account, perform a real Paystack sandbox
   purchase, return, webhook-only completion and repeated return/webhook.
2. Verify monthly/yearly price and terms snapshots, cancellation of recurring
   Worker billing, expiry, wrong-amount/currency/environment rejection.
3. Exercise actual provider refund/dispute delivery, Finance reconciliation and
   hold resolution for both plans. Synthetic SQL/provider fixtures are not this.
4. Verify real Android/iOS themes, microphone permission, captured sound, uploaded
   audio and video playback. Licensed music catalogues are not included.
5. Run hosted sustained mixed traffic including Auth, chat, media and payments.
   A previous local 3,000-booking burst reported p95 46.36 seconds; success counts
   do not demonstrate acceptable latency or million-user capacity.

## Existing release gaps

- Issue #100: paid hotel cancellation/refund is incomplete. The current customer
  command permits only unpaid pending cancellations, while rate screens advertise
  refundable rates. A production launch offering those rates remains blocked
  until booking-snapshotted deadlines, idempotent cancellation, inventory release,
  durable refund execution/reconciliation and hosted failure/race tests are done.
  No completed hotel refund is claimed by this PR.
- Issue #96: representative physical-device/mobile and two-account session review
  still needs recorded evidence. Isolated browser fixtures do not replace it.
- Issue #95: production-like hosted capacity and supported latency remain open.
- Supabase leaked-password protection was disabled at inspection. Configure it
  through Auth settings; no account configuration was changed here.

See the PR body for final commit-specific CI results. Leave the PR as draft while
mandatory checks fail or the full requested release scope lacks evidence.
