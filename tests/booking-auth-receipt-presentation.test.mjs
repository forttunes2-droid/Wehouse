import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Bookings use one compact presentation language", async () => {
  const [bookings, journey, css] = await Promise.all([
    read("src/pages/MyReservations.tsx"),
    read("src/components/PropertyBookingJourney.tsx"),
    read("src/index.css"),
  ]);

  assert.match(bookings, /divide-y divide-\[var\(--wh-border-subtle\)\]/);
  assert.match(bookings, /overflow-x-auto/);
  assert.match(bookings, /Booking filters/);
  assert.match(bookings, /text-\[13px\]/);
  assert.match(bookings, /font-mono text-xs font-bold/);
  const bookingCardBlock = bookings.slice(bookings.indexOf("function BookingCard"), bookings.indexOf("function formatStayTime"));
  const serviceBlock = bookings.slice(bookings.indexOf("function ServiceBookingDetail"), bookings.indexOf("function HousingCard"));
  const propertyBlock = bookings.slice(bookings.indexOf("function PropertyBookingDetail"), bookings.indexOf("function HotelBookingDetail"));
  const hotelBlock = bookings.slice(bookings.indexOf("function HotelBookingDetail"), bookings.indexOf("function AccommodationProtectionPanel"));
  assert.match(bookingCardBlock, /aria-label=\{`Open \$\{eyebrow\} booking for \$\{title\}`\}/);
  assert.match(bookingCardBlock, /compact \? "bg-\[var\(--wh-surface\)\] px-3 py-3"/);
  assert.match(serviceBlock, /BookingDetailShell/);
  assert.match(serviceBlock, /getBookingDetails/);
  assert.match(serviceBlock, /Open conversation/);
  assert.doesNotMatch(serviceBlock, /text-xl/);
  assert.doesNotMatch(propertyBlock, /text-xl font-bold/);
  assert.doesNotMatch(hotelBlock, /text-xl font-bold/);
  assert.doesNotMatch(
    css,
    /article:has\(button\[aria-label="Preview reservation property photos"\]\)/,
  );
  assert.match(journey, /text-\[11px\] font-semibold/);
  assert.match(journey, /text-\[9px\] leading-4/);
});

test("Login motion is subtle and respects reduced motion", async () => {
  const [login, css] = await Promise.all([
    read("src/pages/Login.tsx"),
    read("src/pages/login.css"),
  ]);

  assert.match(login, /<div key=\{mode\} className="wh-auth-form">/);
  assert.doesNotMatch(login, /text-\[28px\]/);
  assert.match(css, /whAuthStateIn 200ms/);
  // Only the changed form rises; the retired whole-form scale is not required.
  // Browser tests separately inspect real computed styles and reduced motion.
  const entrance = css.slice(css.indexOf("@keyframes whAuthStateIn"), css.indexOf("@media (prefers-reduced-motion"));
  assert.match(entrance, /translateY\(4px\)/);
  assert.match(entrance, /to\s*\{\s*opacity:\s*1;\s*transform:\s*none/);
  assert.doesNotMatch(entrance, /scale\(/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion"));
  assert.match(reduced, /\.wh-auth-form\s*\{\s*animation:\s*none/);
  assert.match(reduced, /:active\s*\{\s*transform:\s*none/);
});

test("Receipts have one branded compact PDF action", async () => {
  const [receipt, pdf] = await Promise.all([
    read("src/components/PaymentReceipt.tsx"),
    read("src/lib/receiptPdf.ts"),
  ]);

  assert.match(receipt, /Amount paid/);
  assert.match(receipt, /text-2xl tracking-tight/);
  assert.match(receipt, /Payment receipt/);
  assert.match(receipt, /onClick=\{\(\) => void loadReceipts\(\)\}/);
  assert.match(receipt, />\s*Receipt\s*<\/button>/);
  assert.doesNotMatch(receipt, />Payment history<\/button>/);
  assert.doesNotMatch(receipt, /receipts\.length === 0\) return null/);
  assert.match(pdf, /doc\.addImage\(receiptMark/);
  assert.doesNotMatch(receipt, /window\.print\(\)/);
});
