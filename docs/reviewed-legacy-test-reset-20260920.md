# Reviewed legacy Test reset — 20 September 2026

The owner confirmed that every payment was Test and clarified that only records
conflicting with newer rules should be reset. Age is not a deletion criterion.
The broad pre-launch wipe is not authorized by this operation.

Three Showcase posts were mistakenly soft-deleted during the initial
interpretation. All three were restored immediately after the correction. No
video object was removed. They are preserved by the reset's digest assertions.

The executed script is `scripts/reviewed-legacy-test-reset.py`. Its default mode
runs the complete transaction and rolls back. Only `--mode apply` commits it.
An initial rollback rehearsal found a text/UUID comparison error; it committed
nothing. After correcting that comparison, the rollback rehearsal and application
both passed. Re-running after application is refused by the unique reset ID.

| Affected data | Result |
|---|---|
| Two hotel bookings | Archived: paid but missing canonical protection and cancellation-policy records |
| Two worker jobs | Archived: legacy released/protected states without canonical protection ledger links or policy records |
| One Long Let reservation | Archived: paid rent without the required rent-protection and policy records; its listing is available again |
| Ten payment attempts | Archived: eight paid Test records totalling ₦210,000 and two pending attempts; includes two retired ₦500 verification charges |
| Related records | Archived only the linked conversations/messages, one job review, old notifications/activity, verification references, commission and earnings projections |
| Old wallet projections | Removed ₦162,010 pending partner earnings and ₦6,370 released worker earnings after exact reconciliation; no provider refund or transfer was initiated |

Before-images and the row-count manifest are held in
`wehouse_maintenance.test_record_resets`, under reset ID
`reviewed-legacy-test-records-2026-09-20`. Application roles, including service_role,
cannot access this schema/table. Recovery requires a reviewed database-owner
transaction using these before-images; do not automatically reinstate obsolete
obligations. No private row data is committed to Git.

Preservation assertions passed for all Auth users, profile authority/approval
fields, workspace grants, identity/review evidence, Showcase posts, hotels/rooms,
unaffected bookings/payments, canonical ledger and settings/migration history.
Derived review totals correctly reflect removal of the old Test job review.
The current hotel stay, its ₦180,000 paid Test record and protection ledger remain.
Already cancelled/expired history remains inactive; valid properties remain.

Post-check: 44 Auth users, 38 profiles, three visible Showcase posts, two verified
workers, two available listings, one hotel/current hotel booking, zero worker
jobs or active Long Let reservations, 12 payment records (one paid, none pending),
zero legacy wallet balances, one canonical ledger transaction/two entries.
The archive contains one completed reset. A late charge webhook for a removed
reference cannot recreate its booking: the handler requires an existing payment
record and otherwise returns `Payment not found` for these physical-service
payments. Historical references remain in the private archive.

Backend release revision: `7d30f6eac25270963379ace9ace022649dc868eb`.
Both required checks passed. Coordinated rollback run `35527525465` and apply run
`35527766375` succeeded. Production migration history is 572 entries through
`20260920174906`. The schema release preserved all original account and financial
rows; the explicitly authorized data reset ran separately afterward.
