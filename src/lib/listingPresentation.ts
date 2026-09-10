import type { Listing } from "@/types";

const GENERIC_PROPERTY_TITLE = /^(apartment|flat|house|home|property)(\s+in\s+.+)?$/i;

function titleCaseName(value: string) {
  return value
    .trim()
    .replace(/^@/, "")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function listingDisplayTitle(listing: Listing) {
  const savedTitle = String(listing.title || "").trim();
  const city = String(listing.city || "").trim();
  const generic = !savedTitle || GENERIC_PROPERTY_TITLE.test(savedTitle);

  if (listing.sub_type === "short_let" && generic) {
    const partner = String(listing.partner_display_name || "").trim();
    if (partner) return `${titleCaseName(partner)}’s Short Stay${city ? ` · ${city}` : ""}`;
    return `Short Stay${city ? ` in ${city}` : ""}`;
  }
  if (listing.sub_type === "long_stay" && generic)
    return `Long Let Apartment${city ? ` in ${city}` : ""}`;
  return savedTitle || `Apartment${city ? ` in ${city}` : ""}`;
}
