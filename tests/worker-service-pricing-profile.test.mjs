import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profile = readFileSync(
  new URL("../src/components/WorkerPublicProfile.tsx", import.meta.url),
  "utf8",
);

test("worker profile shows the price guide beside its own service", () => {
  assert.match(profile, /from\("worker_services"\)[\s\S]*select\("id,service_name,price,price_type,photos"\)[\s\S]*eq\("worker_id", worker\.user_id\)/);
  assert.match(profile, /serviceOffers\.map\(\(offer\) =>[\s\S]*offer\.service_name[\s\S]*servicePriceLabel\(offer\)/);
  assert.match(profile, /function servicePriceLabel\(offer: PublicServiceOffer\)/);
  assert.match(profile, /serviceOffersLoading \? \(/);
  assert.match(profile, /finally\(\(\) => \{\s+if \(active\) setServiceOffersLoading\(false\);/);
  assert.doesNotMatch(profile, /worker\.worker_price \?/);
});
