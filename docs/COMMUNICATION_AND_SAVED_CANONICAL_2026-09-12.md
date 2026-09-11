# WeHouse Communication, Activity, Saved and Followed Search Contract

This correction supersedes any older document that treated Conversation and Inbox as one top-level customer destination.

## Customer navigation

The customer navigation is exactly:

`Explore · Bookings · Conversation · Inbox · Account`

- **Conversation** contains direct and operational conversation threads: roommate, service job, paid hotel stay and WeHouse cases that genuinely require dialogue.
- **Inbox** contains Activity: booking/lifecycle events, followed-search matches, security/account updates, announcements and other product events.
- Activity is never stacked above or below the Conversation thread list.
- Legacy `messages`/`chat` routes normalize to Conversation. Legacy `notifications` routes normalize to Inbox Activity.
- Conversation unread and Activity unread are counted separately.

## Saved, Followed Search and Showcase Like are different intentions

### Saved

Saved is a private bookmark. It contains homes and hotels only.

- Apartment bookmarks use `saved_listings`.
- Hotel bookmarks use `saved_hotels`.
- The UI uses a bookmark icon.
- Saving never starts a booking and never changes a social reaction.

### Followed Search

Follow Search is a subscription to search criteria, not a saved item and not a separate destination.

- Follow/unfollow/resume is managed from the current discovery search.
- Duplicate semantic criteria are prevented by canonical saved-search identity.
- A newly published matching home/hotel creates Inbox Activity.
- A followed search does not appear inside Saved.

### Showcase Like

Worker Showcase is a social/work-media surface.

- Heart means Like.
- Comments belong to the Showcase post.
- Showcase reactions use Showcase reaction storage and never use `saved_listings` or `saved_hotels`.

## Private conversation identity

Public discovery profiles and private chat identity are intentionally different.

- Worker discovery may show services, pricing, reviews, trust and Showcase.
- Worker identity opened from service chat shows identity, occupation, call controls and safety/block controls only.
- Roommate discovery may show approved match information.
- Roommate identity opened from chat omits school/matching-preference/discovery details.

## Hotel communication

- One deterministic conversation exists per paid confirmed hotel stay.
- Direct hotel conversation is writable only while the paid stay is `confirmed` or `checked_in`.
- After checkout, permitted history remains read-only.
- Hotel/Front Desk communication is presented as the hotel business context, not as a staff member's private identity.
- Conversation context uses hotel/room/stay dates. Booking/check-in credentials never appear in thread titles/subtitles/previews.
- Customer hotel detail is focused on hotel facts, rooms, rates, amenities, arrival/departure and availability. Internal venue/restaurant records are not a separate public WeHouse product surface.

## Service block and Payment Protection

- Either-direction block stops new service messages and private calls at the database boundary.
- Existing ringing/connected private calls end.
- Pre-payment work may cancel under the booking policy.
- Protected/verified money is never silently released or destroyed by blocking. The job/payment moves to WeHouse review.
- Unblocking restores communication capability only; it does not resurrect a cancelled or disputed job.

## Regression checks

1. Mobile and desktop both expose Conversation and Inbox separately.
2. Activity never renders inside the Conversation list.
3. Followed-search matches appear in Inbox Activity only.
4. Homes and hotels can both be bookmarked.
5. Heart remains Showcase Like; bookmark remains Saved.
6. Private chat profiles do not reuse full public discovery profiles.
7. One hotel-stay thread exists per paid confirmed stay.
8. Closed hotel stays have no writable composer.
9. Blocking stops every service message/call path while protected value remains protected.
10. Back from a thread returns to the Conversation context rather than a detached extra destination.
