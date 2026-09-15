# Master plan alignment note — 2026-09-15

This branch must follow `WEHOUSE_CANONICAL_MASTER_PRODUCT_PLAN_2026-09-11.md` as product authority where rules are owner-locked.

Corrections required by the locked plan:

- Personal primary navigation is exactly **Explore · Bookings · Inbox · Account**.
- Inbox opens to Messages. Activity is one compact entry/view inside Inbox, not a separate top-level product and not a full Activity feed above Messages.
- Conversation/thread routes remain inside Inbox. Compatibility aliases may redirect but must not render competing Conversation/Messages/Notifications products.
- Public account creation creates one Personal identity first. Worker and Property Partner are later onboarding/application/workspace activations on that identity.
- Account must not present inactive Worker and Property Partner as permanent account tabs. Use one onboarding entry such as **Use WeHouse as**; approved active workspaces may be switched deliberately.
- Hotels remain a supply type inside Property Partner. Rooms, rates/availability, reservations and team operate on the same hotel records. Manager and Front desk access is capability-limited.
- Ordinary chat messages do not generate duplicate Activity. Activity is a server projection of meaningful immutable events and keeps its own unread/action state.

Do not silently replace these rules with design guesses during hardening work.
