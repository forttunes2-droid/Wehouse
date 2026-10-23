# Chat and Communication

This is the current communication contract. The dated document `COMMUNICATION_AND_SAVED_CANONICAL_2026-09-12.md` is a historical snapshot; where it conflicts with this contract, the Product Master and Decision Log, use those current sources.

## Customer language and identity

- Use **Friend** in every customer-facing surface. Roommate and Friend are separate relationships even when the same two people have both. They keep separate permissions, conversations and decisions.
- The relationship, chat, report, encryption and storage contracts all use **Friend** consistently. The forward migration upgrades the historical schema names before the new Friend RPCs are used.
- Use **share the booking cost** and **pay your share** in customer-facing booking actions. The payer sees their own amount and status; each invited payer explicitly accepts and pays. Never imply installments or that one user can charge another.

## Chat privacy

- Roommate, Friend and Worker-customer direct chats use their documented end-to-end encrypted message paths. Hotel and WeHouse Support conversations have different access models; do not describe every Inbox thread as end-to-end encrypted.
- The Friend chat has its own encrypted pairwise context. Private Friend Groups are a later feature requiring group key/membership design; do not simulate them with copied one-to-one messages.
- A Friend plan card is encrypted message content. It is a private suggestion, not a booking, ticket, payment or authoritative venue RSVP.

## Inbox and action outcomes

- Inbox is the sole top-level communication destination. Activity is a nested Inbox destination, not a competing chat tab.
- Every message/report action must show whether it saved, failed, or needs retry. A report is complete only when persisted to the review queue; an optimistic toast alone is not evidence.
- Reports from encrypted chats may include only evidence a reporting user deliberately selects and submits. Explain that choice before sharing plaintext with moderators.
- Hotel and Friend conversation-information screens and the user-facing report receipt/status experience remain release work unless the roadmap records verified completion.

The single release sequence and evidence are maintained in [the release roadmap](WEHOUSE_RELEASE_ROADMAP.md); this file defines language and communication behavior rather than a second checklist.
