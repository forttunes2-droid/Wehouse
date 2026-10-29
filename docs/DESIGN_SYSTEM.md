# WeHouse design system

## Purpose

Use one visual and interaction language across WeHouse while preserving the
different tasks of Personal, Worker, Property Partner, Hotel Team, Staff, Admin
and Creator. A shared design system standardizes hierarchy, controls, feedback
and responsive behavior; it does not make each workspace identical.

The implemented theme tokens live in `src/index.css` and Tailwind mappings in
`tailwind.config.js`. Use those tokens in application surfaces. Avoid adding a
one-off color or a second shell to solve a local layout problem.

## Theme tokens

| Purpose | Token |
|---|---|
| Page background | `--wh-bg` |
| Main surface | `--wh-surface` |
| Raised surface/input | `--wh-elevated` |
| Main text | `--wh-text` |
| Supporting text | `--wh-text-secondary` |
| Muted text | `--wh-text-muted` |
| Accent text | `--wh-accent-text` |
| Accent surface | `--wh-accent-surface` |
| Borders | `--wh-border`, `--wh-border-subtle` |
| Interactive hover surface | `--wh-interactive` |
| Overlay | `--wh-overlay` |
| Shadows | `--wh-shadow-sm`, `--wh-shadow-md` |

Dark and light values are defined together in `src/index.css`. Text that needs
to remain legible across both themes uses these tokens. Keep text on filled
primary actions white. Do not rely on color alone to communicate status; pair
status color with a label or icon.

## Type and readable density

- Use the normal Tailwind scale: `text-xs` (12px) for dense supporting copy,
  `text-sm` (14px) for normal controls/body copy, and larger sizes for section
  and page headings.
- **12px is the minimum rendered size for interface text**, including labels,
  metadata, status badges, map attribution/tooltips and button text. Existing
  `text-[7px]` through `text-[10px]` classes are temporarily raised to 12px by
  the shared CSS rule in `src/index.css`; replace those source classes with
  `text-xs` as the screens are refined.
- Do not use uppercase, tracking, muted color or a badge shape to justify text
  smaller than the minimum. Give important labels enough width to wrap or move
  secondary information to a detail view rather than shrinking it.

## Layout and navigation

- Each workspace has one page background and one shell hierarchy. Avoid cards
  nested as duplicate page shells.
- Back is in the screen header and returns to the exact parent route and useful
  list/search state.
- Tabs switch peer views; modules navigate; filters refine records; pills label
  status; primary buttons perform the next domain action.
- Detail, booking and focused full-screen views keep their own content hierarchy
  and hide top-level navigation consistently. Preserve safe-area and keyboard
  space on mobile.
- Cards describe a record or a clearly actionable destination. Dashboards
  summarize work and next actions instead of duplicating the full navigation.

## Controls and feedback

Filter dependent fields together: a region change clears its local area and a
category change clears its specialty. Filter before pagination on the server;
avoid a second browser predicate with different taxonomy or text rules. Retain
existing results when the next page fails and provide retry. Shared record links
and eligible Sponsored cards must open independently of the loaded results page.
Account and verification shells take the active workspace explicitly; a person's
primary role does not identify the workspace they are currently using.

Discovery reads wait 300 ms after text or filter changes settle, including price
slider movement. Local option searches (regions, areas, categories and banks)
filter their loaded options without a new database request. Whitespace-only edits
do not repeat an identical search. Cancel superseded direct reads and ignore stale
results; shared public-feed requests retain their independent cache/deduplication
ownership. Never put personalised search responses into the public feed cache.

Use these existing components as implementation references:

| Interaction | Shared reference |
|---|---|
| Settings on/off, including optional school matching | `src/components/SettingSwitch.tsx` |
| Searchable State/LGA filters for Homes, Hotels and Services | `src/components/LocationFilterFields.tsx`, `SearchableSelect.tsx` |
| Account settings hierarchy and personal-data requests | `src/components/AccountShell.tsx`, `src/pages/PrivacySecuritySettings.tsx` |
| Date selection with deliberate tap versus scroll | `src/components/BookingDateField.tsx` |
| Listing photography and readable price overlay | `src/components/ListingCard.tsx` |

Photo overlays retain white foreground ink in both themes; ordinary content below
the photo uses theme text tokens. Payment amounts retain their recorded currency
when a person changes presentation region. A deadline shows one explicit timezone,
not a second hardcoded zone after the formatted time.

- Prefer the shared controls in `src/components/ui/`, `WeHouseChoice`,
  `WeHouseSelect`, `BackButton`, `ConfirmDialog` and the shared dialog hooks
  before making another control.
- Interactive targets should be at least 44px high where space allows. Show
  visible focus, pressed, disabled, loading and error states; keep a control's
  label stable while a request is running.
- A success message follows a verified domain result. On an uncertain mutation,
  show that the result is being checked instead of inviting duplicate payment,
  booking or payout actions.
- Dialogs have an accessible name, modal semantics, focus handling, a usable
  close/back path and an opaque surface. Sheets remain scrollable above the
  mobile keyboard and safe-area inset.
- Reduced-motion preferences are honored. Motion must not transform an
  ancestor of a fixed header, navigation bar, dialog or conversation.

## Responsive, media and accessibility rules

- Design phone-first, then verify tablet and desktop rather than stretching the
  phone layout. Lists become readable rows/cards; dense controls scroll or
  reflow instead of shrinking labels.
- Keep body copy and interactive labels readable at 320px width and 200% zoom.
  Do not clip primary actions, status, totals or privacy/safety instructions.
- Provide a programmatic label for controls and meaningful alternative text for
  informative images. Decorative icons are hidden from assistive technology.
- Use the shared WeHouse media viewer. Images and video remain inside the app;
  video is inline and does not preload full media for a list thumbnail.
- Check contrast in both themes. Do not use a dark-theme literal as text on a
  light surface without a theme-aware token.

## Required screen review

For every changed workspace and critical route, inspect loading, empty, error,
success, validation and confirmation states at phone, tablet and desktop widths
in both themes. Review keyboard/focus and browser Back behavior as well as a
successful path. Record the exact commit and evidence in the release roadmap.

The route-level phone/tablet/desktop and light/dark review remains open in the
release roadmap. A passing build or shared token does not prove visual quality.

## Motion must explain a state or action

### Shared motion timing

The shared tokens in `src/index.css` apply in both themes: `--wh-motion-fast`
(120 ms) for small fades, `--wh-motion-feedback` (160 ms) for control feedback,
and `--wh-motion-panel` (190 ms) for sheets/dialogs and content arrival. Login,
workspace navigation, media entry and shared Radix primitives use these values.
Control transitions name only visual properties; they must not animate layout
dimensions. Switch thumbs move with transforms while their saved on/off state
remains authoritative.

Reduced motion disables shared primitive animations/transitions without clearing
layout transforms needed to centre dialogs or position switches. Loading keeps
its text when decorative spinning/pulsing is suppressed. Payment status and
navigation never wait for an entrance animation. This foundation does not replace
route-level visual and keyboard checks.

Receipt documents intentionally use a white paper surface with locally scoped
ink colours in either app theme. Their surrounding dialog follows the app theme.
Receipt text must not inherit light ink from the dark app palette. The screen
receipt and PDF use the same verified transaction data; an unknown payment state
must never be labelled Paid.

2D motion is appropriate for sheet entry/exit, navigation, selected controls, save feedback and loading. Keep it brief, interruptible and independent of successful server receipts. Generic spinning and pulsing placeholders must also respect reduced-motion preferences, including outside the shared loading component. Static loading text remains necessary when animation is suppressed. Optional 3D belongs to a useful spatial preview or property tour with equivalent photos/details, not a required step in authentication, checkout or support.

Use short transitions for opening/closing panels and state changes, and truthful loading/progress/error feedback. Respect reduced-motion settings and keep navigation and payment confirmation independent of an animation completing. Sign-in, sign-out, booking and loading do not require 3D. No 3D framework is currently present. A future real property tour needs a concrete viewing benefit and an accessible, low-bandwidth fallback before adding a renderer. Visual polish is assessed through hierarchy, readable contrast, consistent spacing, keyboard/touch controls and complete responsive journeys; decorative motion does not close those checks.

### Catalogue arrangement

Use horizontal shelves to browse actual Short Let, Long Let and Experience category
results. A shelf uses the same card as the full results grid. “See all” applies the
corresponding real search filter; entering a query or choosing filters shows the
responsive grid and normal pagination. Do not invent “popular”, “recommended” or
nearby labels from a small loaded page. Hotel results retain their grid; Sponsored
placements use a labelled shelf so paid cards cannot create a long wall above the
ordinary results. Shelves scroll within the page width, retain keyboard/card access,
provide previous/next controls only when needed, and respect reduced motion.
Changing arrangement never changes the accepted price, result ranking, publication
checks or API page size, and must not fetch the complete catalogue into the browser.
