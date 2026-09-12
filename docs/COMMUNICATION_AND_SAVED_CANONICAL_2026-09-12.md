# WeHouse Communication, Activity, Saved and Followed Search Contract

This correction supersedes any branch or document that creates separate top-level Conversation and Inbox destinations.

## Customer navigation

The customer navigation is exactly:

`Explore · Bookings · Inbox · Account`

- **Inbox is the one communication destination.** It opens to the message/conversation list.
- Near the top of Inbox is one compact **Activity** entry, similar to the TikTok Inbox pattern. It can show an unread indicator/latest-update summary, but it does not dump Activity history above messages.
- Tapping **Activity** opens the Activity history inside the Inbox flow. Back returns to the same Inbox/message context.
- Roommate, service-job, paid hotel-stay and relevant WeHouse threads remain typed conversations inside Inbox; they are not separate top-level products.
- Legacy `conversation`, `messages` and `chat` routes may remain for deep-link compatibility, but they must never create another visible primary-navigation destination.
- The Inbox navigation badge may combine unread messages and unread Activity. Inside Inbox, message unread and Activity unread remain independently understandable.

## Saved, Followed Search and Showcase Like are different intentions

### Saved

Saved is a private favourite/bookmark intent. It contains homes and hotels only.

- Apartment saves use `saved_listings`.
- Hotel saves use `saved_hotels`.
- A home/hotel Save control may use a **heart** because property-booking products commonly use a heart for a private favourite. Its label/state must still clearly mean **Saved**, not a public/social Like.
- Saving never starts a booking and never changes a Showcase reaction.

### Followed Search

Follow Search is a subscription to search criteria, not a saved item and not a separate destination.

- Follow/unfollow/resume is managed from the current discovery search.
- Duplicate semantic criteria are prevented by canonical saved-search identity.
- A newly published matching home/hotel creates Activity inside Inbox.
- A followed search does not appear inside Saved.

### Showcase Like

Worker Showcase is a social/work-media surface.

- Showcase heart/reaction means a social Like/reaction on that post.
- Comments belong to the Showcase post.
- Showcase reactions use Showcase reaction storage and never use `saved_listings` or `saved_hotels`.

## Private conversation identity

Public discovery profiles and private chat identity are intentionally different.

- Worker discovery may show services, pricing, reviews, trust and Showcase.
- Worker identity opened from service chat shows identity, occupation, call controls and safety/block controls only.
- Roommate discovery may show approved match information.
- Roommate identity opened from chat omits school/matching-preference/discovery details.

## Hotel booking product

- The booking model is **Hotel → Room type → Rate/package choices → Date availability → Booking → Stay**.
- One room type can have several active rate/package choices with different prices and rules, for example Room only, Breakfast included, Flexible/refundable, Non-refundable, Pay now, Pay before arrival, Pay at property, Executive/VIP benefits, lounge access or other hotel-defined inclusions.
- A package belongs to a room/rate plan; it does not become a separate hotel listing.
- Restaurants, bars, cafes, spa, lounge, pool and similar named facilities may be shown under **Facilities & dining / At the hotel** when the hotel actually offers them.
- Those facilities are descriptive hotel records with details such as name, type, opening hours and package access. They are not separate WeHouse booking products unless a future approved requirement explicitly makes one bookable.
- Room availability remains date/inventory based and independent of the hotel's publication state.

## Hotel communication

- One deterministic conversation exists per paid confirmed hotel stay.
- Direct hotel conversation is writable only while the paid stay is `confirmed` or `checked_in`.
- After checkout, permitted history remains read-only.
- Hotel/Front Desk communication is presented as the hotel business context, not as a staff member's private identity.
- Conversation context uses hotel/room/stay dates. Booking/check-in credentials never appear in thread titles/subtitles/previews.

## Service block and Payment Protection

- Either-direction block stops new service messages and private calls at the database boundary.
- Existing ringing/connected private calls end.
- Pre-payment work may cancel under the booking policy.
- Protected/verified money is never silently released or destroyed by blocking. The job/payment moves to WeHouse review.
- Unblocking restores communication capability only; it does not resurrect a cancelled or disputed job.

## Regression checks

1. Mobile and desktop expose one top-level Inbox, never a separate Conversation destination.
2. Opening Inbox shows messages by default with one compact Activity entry; full Activity history appears only after tapping Activity.
3. Back from Activity or a thread returns to the Inbox context rather than a detached extra page.
4. Followed-search matches appear in Inbox Activity only.
5. Homes and hotels can both be saved independently of Showcase reactions.
6. A property Save heart is private saved state; a Showcase heart/reaction is social state. Their storage and behavior never cross.
7. Private chat profiles do not reuse full public discovery profiles.
8. Hotel room types can expose multiple rate/package choices with different prices/rules.
9. Named hotel facilities/dining appear as hotel information, not as a competing booking product.
10. One hotel-stay thread exists per paid confirmed stay and closed stays have no writable composer.
11. Blocking stops every service message/call path while protected value remains protected.
