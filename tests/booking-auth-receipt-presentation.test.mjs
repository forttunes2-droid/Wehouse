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

  assert.match(bookings, /text-sm font-semibold leading-5/);
  assert.match(bookings, /aspect-\[16\/7\] max-h-52/);
  assert.match(bookings, /max-w-2xl px-0 py-0 sm:px-4 sm:py-4/);
  assert.match(bookings, /font-mono text-sm font-bold/);
  const bookingCardBlock = bookings.slice(bookings.indexOf("function BookingCard"), bookings.indexOf("function formatStayTime"));
  const serviceBlock = bookings.slice(bookings.indexOf("function ServiceBookingDetail"), bookings.indexOf("function HousingCard"));
  const propertyBlock = bookings.slice(bookings.indexOf("function PropertyBookingDetail"), bookings.indexOf("function HotelBookingDetail"));
  const hotelBlock = bookings.slice(bookings.indexOf("function HotelBookingDetail"), bookings.indexOf("function AccommodationProtectionPanel"));
  assert.doesNotMatch(bookingCardBlock, /text-xl/);
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
  assert.match(css, /whAuthStateIn 220ms/);
  assert.match(css, /translateY\(8px\)/);
  assert.match(css, /scale\(\.992\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("Receipts are compact and do not print as A4", async () => {
  const [receipt, css] = await Promise.all([
    read("src/components/PaymentReceipt.tsx"),
    read("src/index.css"),
  ]);

  assert.match(receipt, /Amount paid/);
  assert.match(receipt, /text-2xl tracking-tight/);
  assert.match(receipt, /Payment receipt/);
  assert.match(receipt, /onClick=\{\(\) => void loadReceipts\(\)\}/);
  assert.match(receipt, />\s*Receipt\s*<\/button>/);
  assert.doesNotMatch(receipt, />Payment history<\/button>/);
  assert.doesNotMatch(receipt, /receipts\.length === 0\) return null/);
  assert.match(css, /@page \{ size: 105mm 148mm; margin: 6mm; \}/);
  assert.doesNotMatch(css, /@page \{ size: A4/);
});
