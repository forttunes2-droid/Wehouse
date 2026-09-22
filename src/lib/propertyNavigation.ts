/** Typed record keys prevent a hotel, listing and inspection sharing an ID from
 * opening each other's surfaces. These are navigation hints, never authority. */
export type PropertyKind = "hotel" | "listing" | "inspection";
export function propertyRecordKey(kind: PropertyKind, id: string | number) {
  return `${kind}:${String(id).replace(/^(hotel|listing|inspection):/, "")}`;
}
export function matchesPropertyRecord(row: Record<string, any>, target: string) {
  const match = /^(hotel|listing|inspection):(.+)$/.exec(target);
  const kind = match?.[1];
  const id = match?.[2] || target;
  const ids = kind === "hotel" ? [row.hotel_id, row.draft_hotel_id, row.hotel?.hotel_id, row._assetKind === "hotel" ? String(row.id || "").replace(/^hotel:/, "") : null]
    : kind === "listing" ? [row.draft_listing_id, row.listing_id, row.listing?.id, row._assetKind === "property" ? row.id : null]
    : kind === "inspection" ? [row.inspection_id, row.request_code ? row.id : null, row.lifecycle_stage ? row.id : null]
    : [row.id, row.draft_listing_id, row.listing?.id, row.draft_hotel_id, row.hotel_id, row.hotel?.hotel_id];
  return ids.some(value => value !== null && value !== undefined && String(value) === id);
}
export function hotelInventorySummary(hotel: Record<string, any>) {
  // Missing projection is not zero inventory. The server computes these counts
  // within the caller's authorized hotel list; public gallery rows are not stock.
  const types = Number(hotel.room_type_count);
  const rooms = Number(hotel.total_room_count);
  if (hotel.room_type_count == null || hotel.total_room_count == null || !Number.isFinite(types) || !Number.isFinite(rooms)) return "Room inventory unavailable";
  const label = `${types} room ${types === 1 ? "type" : "types"} · ${rooms} ${rooms === 1 ? "room" : "rooms"}`;
  const rate = Number(hotel.starting_rate || 0);
  return rate > 0 ? `${label} · from ₦${rate.toLocaleString("en-NG")}` : label;
}
export function hotelPaymentLabel(status: string, paymentStatus: string) {
  if (paymentStatus === "paid") return "Payment verified";
  if (["refunded", "partially_refunded", "reversed"].includes(paymentStatus)) return paymentStatus === "partially_refunded" ? "Partially refunded" : paymentStatus === "reversed" ? "Payment reversed" : "Refunded";
  if (paymentStatus === "failed") return "Payment failed";
  if (status === "payment_conflict") return "Payment review";
  if (["cancelled", "expired"].includes(status)) return "No active payment";
  return "Awaiting payment";
}
