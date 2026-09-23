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

/** The same display identity is used before and after publication. Codes identify
 * records in secondary details; they must not replace a property's actual name. */
export function propertyRecordTitle(row: Record<string, any>, fallback = "Property") {
  return [row.hotel?.name, row.listing?.title, row.property_display_name,
    row.hotel_program?.name, row.name, row.title, row.property_address]
    .find(value => typeof value === "string" && value.trim())?.trim() || fallback;
}

/** One dated display calculation for both the hotel total and room-type rows.
 * These figures are a projection of the authorized snapshot, not permission to
 * sell or check in; reservation writes remain server-authoritative. */
export function hotelRoomAvailability(
  room: { room_id: number; total_rooms: number },
  bookings: ReadonlyArray<{ room_id: number; status: string; check_in: string; check_out: string; payment_expires_at?: string | null }>,
  inventory: ReadonlyArray<{ room_id: number; inventory_date: string; available_quantity: number; closed: boolean }>,
  roomUnits: ReadonlyArray<{ unit_id: number; room_id: number; status: string }>,
  date: string,
  now: number,
) {
  const count = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const configured = count(room.total_rooms);
  const units = [...new Map(roomUnits.filter(unit => unit.room_id === room.room_id).map(unit => [unit.unit_id, unit])).values()];
  const registered = units.length;
  const operational = units.filter(unit => ["ready", "occupied", "cleaning"].includes(unit.status)).length;
  const maintenance = units.filter(unit => ["maintenance", "out_of_service"].includes(unit.status)).length;
  const override = inventory.find(row => row.room_id === room.room_id && row.inventory_date === date);
  const closed = Boolean(override?.closed);
  const offered = closed ? 0 : count(override?.available_quantity ?? configured);
  const dated = bookings.filter(row => row.room_id === room.room_id && row.check_in <= date && row.check_out > date);
  const occupied = dated.filter(row => ["confirmed", "checked_in"].includes(row.status)).length;
  const holds = dated.filter(row => row.status === "pending" && new Date(row.payment_expires_at || 0).getTime() > now).length;
  return {
    configured, registered, operational, maintenance, occupied, holds, closed,
    setupIncomplete: registered < configured,
    available: Math.max(0, Math.min(configured, offered, operational) - occupied - holds),
  };
}
