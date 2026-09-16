# Master plan alignment note — 2026-09-16

This branch must follow `WEHOUSE_CANONICAL_MASTER_PRODUCT_PLAN_2026-09-11.md` as product authority where rules are owner-locked.

## Identity and work access

- Every public signup creates one **Personal identity** first.
- **Service Provider** is the product/workspace term. Existing internal database keys named `worker` remain compatibility implementation details; they must not create a second identity or leak old terminology into customer-facing flows.
- **WeHouse Services** is the customer-facing services area.
- Service Provider and Property Partner are later onboarding/application flows from Account, not signup account types and not permanent inactive account tabs.
- One Personal identity may legitimately hold Service Provider, Property Partner, Hotel Team and WeHouse Team/Staff/Admin/Creator grants at the same time where assigned.
- Activated workspaces may be switched deliberately. Pending/incomplete applications remain onboarding routes.
- Multi-role grants never permit self-review, self-approval, self-inspection or self-payout approval.

## Personal navigation and Inbox

- Personal primary navigation is exactly **Explore · Bookings · Inbox · Account**.
- Inbox opens to Messages.
- Activity is one compact entry/view inside Inbox, not a separate top-level product and not a full Activity feed above Messages.
- Conversation/thread routes remain inside Inbox. Compatibility aliases may redirect but must not render competing Conversation/Messages/Notifications products.
- Ordinary chat messages do not generate duplicate Activity. Activity is a server projection of meaningful events and keeps its own unread/action state.
- The six-digit private-messaging passcode unlocks the Personal identity's encrypted messaging session, not one page/workspace/conversation at a time. Once unlocked in the same browser/app session, Inbox and eligible private-message entry points reuse that unlocked key until logout, explicit lock, a genuinely new session, or key/passcode reset.

## Hotels

- Hotels remain a supply type inside Property Partner.
- Rooms, rates/availability, reservations and team operate on the same hotel records.
- Manager and Front Desk are hotel-scoped capability grants accepted by the invited person's existing Personal identity. They do not become Property Partners and do not inherit access to the owner's other hotels.

## Identity/liveness

- Face/liveness is sensitive identity-continuity evidence, not proof of skill, property ownership, licensing, trust or entitlement.
- The biometric collection/enforcement gate remains disabled unless the approved legal/privacy launch gate is recorded.
- Recurring identity checks are a separate policy switch and are not a default monthly requirement.
- Service Provider professional review can proceed without biometric collection while that policy gate is disabled.

## Security and release truth

- Green CI proves only its named automated scope. Do not describe WeHouse as impossible to hack or production-ready solely because tests pass.
- Public/private storage follows workspace grants and record ownership, not the legacy single `profiles.role` projection.
- Public projections use explicit allowlists where private/operational fields exist.
- Audio/video calls use call-participant authorization and short-lived TURN credentials; a real TURN relay still requires configured external infrastructure and real-device verification.
- Payment Protection remains legally/provider gated for real-money launch. Do not market the flow as escrow unless the approved provider/legal structure supports that wording.
- Production release requires the production Supabase migrations/Edge Functions, Vercel build, required secrets, provider configuration and launch gates to be verified; merging Git alone is not proof of those actions.

Do not silently replace these rules with design guesses during hardening work.