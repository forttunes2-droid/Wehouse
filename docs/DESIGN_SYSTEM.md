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
