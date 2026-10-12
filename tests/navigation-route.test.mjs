import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const source = readFileSync("src/lib/navigationRoute.ts", "utf8");
const exports = {};
vm.runInNewContext(
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { exports, URLSearchParams },
);

test("sign-in preserves a valid requested destination but discards auth fragments", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(exports.identityEntryRoute("#detail?id=listing-4", "search"))),
    { page: "detail", params: { id: "listing-4" } },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(exports.identityEntryRoute("#access_token=secret", "search"))),
    { page: "search", params: {} },
  );
});

test("navigation URLs round-trip supported record context for refresh and browser history", () => {
  const expected = {
    id: "property/id?one",
    hotelId: "27",
    roomId: "4",
    ratePlanId: "8",
    checkIn: "2026-12-01",
    checkOut: "2026-12-04",
    conversationId: "thread-12",
    peerId: "person-9",
    bookingId: "booking-5",
    roommateId: "match-3",
    category: "Home cleaning",
  };
  const hash = exports.buildNavigationHash("hotel_booking", expected);
  assert.equal(hash.startsWith("#hotel_booking?"), true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(exports.parseNavigationRoute(hash))),
    { page: "hotel_booking", params: expected },
  );
});

test("navigation URLs reject path-shaped routes and ignore unsupported or oversized query data", () => {
  assert.equal(exports.parseNavigationRoute("#/detail/property-7"), null);
  assert.deepEqual(
    JSON.parse(JSON.stringify(exports.parseNavigationRoute("#detail?id=listing-4&admin=true"))),
    { page: "detail", params: { id: "listing-4" } },
  );
  assert.equal(exports.buildNavigationHash("search", { unsupported: "not-applicable" }), "#search");
  assert.equal(
    exports.parseNavigationRoute(`#detail?id=${"x".repeat(600)}`).params.id.length,
    512,
  );
});
