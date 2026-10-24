import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detail = readFileSync(
  new URL("../src/pages/ListingDetailCore.tsx", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../supabase/migrations/20261023121029_booking_bound_property_reviews.sql", import.meta.url),
  "utf8",
);

test("property details show saved amenities and verified property reviews", () => {
  assert.match(detail, /listing\.amenities\.map\(\(amenity\)/);
  assert.match(detail, /get_listing_review_summary/);
  assert.match(detail, /listingReviewSummary\.reviews\.map/);
});

test("a property review requires the existing server-verified eligibility gate", () => {
  assert.match(detail, /listingReviewSummary\?\.eligible/);
  assert.match(detail, /submitBookingReview\(listingReviewSummary\.eligible_reservation_id/);
  assert.match(migration, /create_my_verified_listing_review/);
  assert.match(migration, /Verified occupancy or a completed verified stay is required/);
  assert.match(migration, /r\.rent_payment_status='paid'/);
  assert.match(migration, /reservation_id=booking\.id/);
});
