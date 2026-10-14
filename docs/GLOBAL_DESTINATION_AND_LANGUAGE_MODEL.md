# Global destination and language model

## Product rule

WeHouse is one marketplace. A person's home country, preferred app language, and the destination they search or book are separate values.

- Account creation does not ask for GPS or a home country. A person can choose a destination when they search.
- Device location is an optional convenience for a nearby search. It never silently changes the chosen destination.
- Every property, hotel, service offer, booking, payment, refund, review, support case, and operations record belongs to a country. Administrative names and identifiers are interpreted within that country.
- A destination becomes bookable only when WeHouse has enabled its inventory, location catalogue, currency and payment route, payout and refund handling, local legal terms, support, and operations coverage.
- Currency shown for a quote is explicit. The confirmed booking keeps an immutable quote and charge-currency snapshot; display conversion never changes the amount charged or refunded.
- Property dates and service appointments use the destination's time zone. Account activity can be displayed in the viewer's chosen time zone.
- Search can begin with Nigeria as the launch-market suggestion, but it must let the user choose any enabled destination. A user's country must never silently restrict destinations.

## Language rule

App language is an account preference, independent from country and destination. Country may influence which complete language translations are suggested first, but must not force a language. Show each option by its native name. A language is selectable only when the customer-facing journey and essential safety, payment, policy, and support messages have reviewed translations. Add languages through a translation catalogue and complete translation bundles, not country-specific UI branches.

Nigeria's catalogue can include its supported national and regional languages once the UI is translated; future markets add their own reviewed languages as catalogue data. Do not show a language as available while important screens remain English-only.

## Current implementation status (14 October 2026)

- platform_countries currently contains Nigeria as the only enabled/default country. The app loads its currency, time zone, and locale defaults.
- The search region/city filters are free text and do not force a Nigeria-only list. The property publishing and worker professional-coverage flows still use Nigeria-only State/LGA data.
- Account setup previously required a Nigerian State and Local Government for every role. That requirement has been removed; users can finish setup without setting a personal location.
- There is no app-wide translation catalogue or language selector yet. The visible interface is not ready to claim multi-language support.
- Cross-border booking is not ready: country-aware location identifiers and enabled-market readiness checks still need to be connected through publishing, discovery, pricing, payments, cancellation/refund, support, and operations.

## Required release sequence

1. Keep account locale and optional current location separate from the destination search control.
2. Define one country-qualified place model and catalogue; migrate existing Nigeria locations without changing their displayed meaning. Use it in property and hotel publishing, worker coverage, search, and service request fulfilment.
3. Carry destination country, local time zone, quoted currency, market policy version, and provider/host model into immutable booking snapshots. Validate these on the server before checkout and again before fulfillment.
4. Enable a market only after inventory, payment settlement/refunds, payout, local legal/policy review, safety coverage, support routing, and country-specific operations have passed end-to-end checks.
5. Add language preference and reviewed translation bundles. Check every customer journey, role workspace, email/push template, legal document, error state, and light/dark UI before marking a language complete.
6. Keep Nigeria as the configured launch market until a second market passes the same readiness gate. A future country should be enabled by catalogue/configuration plus its required operational integration, not by scattered country checks.

## Acceptance checks

- A user signing in from any country is not asked for GPS or home location to browse.
- The user can search an enabled destination regardless of where the user is located; unsupported destinations clearly say they are not available yet.
- Listings and workers can only be published against a country-qualified valid location.
- Dates, prices, cancellation terms, booking receipts, and support cases remain tied to the exact destination and quote after the user changes language, profile location, or display currency.
- Selecting a language changes the complete supported interface; notification and email copy use the matching reviewed language.
