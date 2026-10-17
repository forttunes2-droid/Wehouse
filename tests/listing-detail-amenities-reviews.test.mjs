import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detail = readFileSync(
  new URL("../src/pages/ListingDetailCore.tsx", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../supabase/migrations/20261007190000_production_schema_reconciliation.sql", import.meta.url),
  "utf8",
);

test("property details show saved amenities and verified guest reviews", () => {
  assert.match(detail, /listing\.amenities\.map\(\(amenity\)/);
  assert.match(detail, /get_listing_review_summary/);
  assert.match(detail, /listingReviewSummary\.reviews\.map/);
});

test("a property review requires the existing server-verified eligibility gate", () => {
  assert.match(detail, /listingReviewSummary\?\.eligible/);
  assert.match(detail, /create_my_verified_listing_review/);
  assert.match(migration, /create_my_verified_listing_review/);
  assert.match(migration, /A verified stay or occupancy is required before reviewing this apartment/);
  assert.match(migration, /r\.rent_payment_status='paid'/);
  assert.match(migration, /not exists\([\s\S]*from public\.listing_reviews/);
});
