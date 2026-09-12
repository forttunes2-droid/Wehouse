import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const jsonHeaders = { "Content-Type": "application/json" };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });
const allowedRoomStatuses = new Set(["ready", "cleaning", "maintenance", "out_of_service"]);

type Integration = {
  id: string;
  hotel_id: number;
  provider: string;
  name: string;
  status: string;
  scopes: string[];
  authoritative_domains: string[];
  external_hotel_id?: string | null;
};

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function routeFor(req: Request) {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const index = parts.lastIndexOf("hotel-pms-api");
  return `/${parts.slice(index >= 0 ? index + 1 : parts.length).join("/")}` || "/";
}

function hasScope(integration: Integration, scope: string) {
  return integration.scopes?.includes(scope);
}

function owns(integration: Integration, domain: string) {
  return integration.authoritative_domains?.includes(domain);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function int(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

async function authenticate(admin: ReturnType<typeof createClient>, req: Request): Promise<Integration | null> {
  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token.startsWith("whpms_live_") || token.length < 40) return null;
  const tokenHash = await sha256(token);
  const { data, error } = await admin
    .from("hotel_integrations")
    .select("id,hotel_id,provider,name,status,scopes,authoritative_domains,external_hotel_id")
    .eq("token_hash", tokenHash)
    .eq("status", "active")
    .maybeSingle();
  if (error || !data) return null;
  return data as Integration;
}

async function beginEvent(admin: ReturnType<typeof createClient>, integration: Integration, req: Request, eventType: string, body: unknown) {
  const key = text(req.headers.get("idempotency-key"));
  if (!key) return { error: respond({ success: false, error: "Idempotency-Key is required" }, 400) };
  const { data: existing } = await admin
    .from("hotel_integration_events")
    .select("id,status,details,error_message")
    .eq("integration_id", integration.id)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (existing) return { existing };
  const payloadHash = await sha256(JSON.stringify(body ?? {}));
  const { data, error } = await admin
    .from("hotel_integration_events")
    .insert({
      integration_id: integration.id,
      idempotency_key: key,
      direction: "inbound",
      event_type: eventType,
      payload_hash: payloadHash,
      status: "pending",
      details: {},
    })
    .select("id")
    .single();
  if (error || !data) return { error: respond({ success: false, error: "Could not reserve this idempotent request" }, 409) };
  return { id: data.id as string };
}

async function finishEvent(admin: ReturnType<typeof createClient>, id: string, status: "processed" | "review_required" | "failed", details: Record<string, unknown>, errorMessage?: string) {
  await admin.from("hotel_integration_events").update({ status, details, error_message: errorMessage || null, processed_at: new Date().toISOString() }).eq("id", id);
}

serve(async (req) => {
  if (!["GET", "POST"].includes(req.method)) return respond({ success: false, error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return respond({ success: false, error: "PMS gateway configuration is incomplete" }, 503);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const integration = await authenticate(admin, req);
  if (!integration) return respond({ success: false, error: "Invalid or inactive PMS token" }, 401);

  const route = routeFor(req);
  try {
    if (req.method === "GET" && route === "/v1/health") {
      await admin.from("hotel_integrations").update({ last_sync_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", integration.id);
      return respond({ success: true, api_version: "v1", integration: { id: integration.id, hotel_id: integration.hotel_id, provider: integration.provider, external_hotel_id: integration.external_hotel_id, authoritative_domains: integration.authoritative_domains } });
    }

    if (req.method === "GET" && route === "/v1/reservations") {
      if (!hasScope(integration, "reservations.read")) return respond({ success: false, error: "reservations.read scope required" }, 403);
      const url = new URL(req.url);
      const cursor = text(url.searchParams.get("cursor"));
      const limit = Math.min(200, Math.max(1, int(url.searchParams.get("limit"), 100)));
      let query = admin
        .from("hotel_bookings")
        .select("booking_id,hotel_id,room_id,rate_plan_id,rate_plan_name,check_in,check_out,guest_count,total_nights,total_price,status,guest_name,guest_phone,special_requests,payment_status,confirmed_at,checked_in_at,checked_out_at,completed_at,updated_at,pms_external_reservation_id,pms_sync_status")
        .eq("hotel_id", integration.hotel_id)
        .eq("payment_status", "paid")
        .in("status", ["confirmed", "checked_in", "checked_out", "completed"])
        .order("updated_at", { ascending: true })
        .limit(limit);
      if (cursor) query = query.gt("updated_at", cursor);
      const { data: bookings, error } = await query;
      if (error) throw error;
      const roomIds = [...new Set((bookings || []).map((b: any) => b.room_id))];
      const { data: rooms } = roomIds.length
        ? await admin.from("hotel_rooms").select("room_id,room_type,external_reference,source_system").in("room_id", roomIds)
        : { data: [] as any[] };
      const roomMap = new Map((rooms || []).map((r: any) => [Number(r.room_id), r]));
      const rows = (bookings || []).map((booking: any) => {
        const room = roomMap.get(Number(booking.room_id)) as any;
        return {
          wehouse_reservation_id: booking.booking_id,
          external_reservation_id: booking.pms_external_reservation_id,
          status: booking.status,
          stay: { check_in: booking.check_in, check_out: booking.check_out, nights: booking.total_nights },
          guest: { name: booking.guest_name, phone: booking.guest_phone, count: booking.guest_count, special_requests: booking.special_requests },
          room: { wehouse_room_id: booking.room_id, external_reference: room?.external_reference || null, room_type: room?.room_type || null },
          package: { rate_plan_id: booking.rate_plan_id, name: booking.rate_plan_name },
          money: { currency: "NGN", total: booking.total_price, payment_status: "paid" },
          lifecycle: { confirmed_at: booking.confirmed_at, checked_in_at: booking.checked_in_at, checked_out_at: booking.checked_out_at, completed_at: booking.completed_at },
          updated_at: booking.updated_at,
        };
      });
      const ids = rows.map((r: any) => r.wehouse_reservation_id);
      if (ids.length) await admin.from("hotel_bookings").update({ integration_id: integration.id, pms_sync_status: "delivered", pms_last_synced_at: new Date().toISOString() }).in("booking_id", ids).in("pms_sync_status", ["not_connected", "pending", "delivered"]);
      const nextCursor = rows.length ? rows[rows.length - 1].updated_at : cursor || null;
      await admin.from("hotel_integrations").update({ last_cursor: nextCursor, last_sync_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", integration.id);
      return respond({ success: true, reservations: rows, next_cursor: nextCursor, count: rows.length });
    }

    const ackMatch = route.match(/^\/v1\/reservations\/(\d+)\/ack$/);
    if (req.method === "POST" && ackMatch) {
      if (!hasScope(integration, "reservations.ack")) return respond({ success: false, error: "reservations.ack scope required" }, 403);
      const body = await req.json().catch(() => ({}));
      const event = await beginEvent(admin, integration, req, "reservation_ack", body);
      if (event.error) return event.error;
      if (event.existing) return respond({ success: true, idempotent: true, status: event.existing.status, ...(event.existing.details || {}) });
      const bookingId = Number(ackMatch[1]);
      const { data: booking } = await admin.from("hotel_bookings").select("booking_id,user_id,total_price,status,payment_status").eq("booking_id", bookingId).eq("hotel_id", integration.hotel_id).maybeSingle();
      if (!booking || booking.payment_status !== "paid") {
        await finishEvent(admin, event.id!, "failed", { booking_id: bookingId }, "Paid WeHouse reservation not found");
        return respond({ success: false, error: "Paid WeHouse reservation not found" }, 404);
      }
      const accepted = body?.accepted === true;
      const externalId = text(body?.external_reservation_id) || null;
      const reason = text(body?.reason);
      const syncStatus = accepted ? "acknowledged" : "review_required";
      await admin.from("hotel_bookings").update({ integration_id: integration.id, pms_external_reservation_id: externalId, pms_sync_status: syncStatus, pms_last_synced_at: new Date().toISOString() }).eq("booking_id", bookingId);
      const details = { booking_id: bookingId, accepted, external_reservation_id: externalId, review_required: !accepted, reason: reason || null };
      await finishEvent(admin, event.id!, accepted ? "processed" : "review_required", details, accepted ? undefined : reason || "PMS rejected reservation");
      if (!accepted) {
        const { data: hotel } = await admin.from("hotels").select("owner_id,name").eq("hotel_id", integration.hotel_id).single();
        if (hotel?.owner_id) await admin.from("notifications").insert({ recipient_id: hotel.owner_id, type: "hotel_pms_review", title: "Hotel connection needs review", message: `${hotel.name || "Hotel"} PMS rejected WeHouse reservation ${bookingId}. The paid booking was not cancelled.`, related_id: String(bookingId), source_type: "hotel_booking", source_id: String(bookingId), destination_route: "property-owner", destination_params: { hotel_id: integration.hotel_id, booking_id: bookingId }, event_key: `hotel-pms-reject:${integration.id}:${bookingId}:${event.id}`, workspace_scope: "property_partner" });
      }
      return respond({ success: true, ...details });
    }

    if (req.method === "POST" && route === "/v1/catalog") {
      if (!hasScope(integration, "catalog.write")) return respond({ success: false, error: "catalog.write scope required" }, 403);
      const body = await req.json().catch(() => ({}));
      const event = await beginEvent(admin, integration, req, "catalog_sync", body);
      if (event.error) return event.error;
      if (event.existing) return respond({ success: true, idempotent: true, status: event.existing.status, ...(event.existing.details || {}) });
      const sourceSystem = `pms:${integration.id}`;
      const roomMap = new Map<string, number>();
      let roomCount = 0, rateCount = 0, inventoryCount = 0;

      if (Array.isArray(body?.rooms)) {
        if (!owns(integration, "rooms")) return respond({ success: false, error: "This integration does not own the rooms domain" }, 409);
        for (const incoming of body.rooms) {
          const externalReference = text(incoming?.external_reference);
          if (!externalReference) throw new Error("Each PMS room type requires external_reference");
          const payload = {
            hotel_id: integration.hotel_id,
            room_type: text(incoming?.room_type) || "Room",
            description: text(incoming?.description) || null,
            price_per_night: Math.max(1, int(incoming?.base_price, 1)),
            max_guests: Math.max(1, int(incoming?.max_guests, 1)),
            bed_type: text(incoming?.bed_type) || null,
            total_rooms: Math.max(1, int(incoming?.total_rooms, 1)),
            amenities: Array.isArray(incoming?.amenities) ? incoming.amenities.map(text).filter(Boolean) : [],
            source_system: sourceSystem,
            external_reference: externalReference,
            updated_at: new Date().toISOString(),
          };
          const { data: existing } = await admin.from("hotel_rooms").select("room_id,images").eq("hotel_id", integration.hotel_id).eq("source_system", sourceSystem).eq("external_reference", externalReference).maybeSingle();
          let roomId: number;
          if (existing) {
            const { data, error } = await admin.from("hotel_rooms").update(payload).eq("room_id", existing.room_id).select("room_id").single();
            if (error) throw error; roomId = data.room_id;
          } else {
            const { data, error } = await admin.from("hotel_rooms").insert({ ...payload, images: [] }).select("room_id").single();
            if (error) throw error; roomId = data.room_id;
          }
          roomMap.set(externalReference, Number(roomId)); roomCount++;
        }
      }

      if (Array.isArray(body?.rates)) {
        if (!owns(integration, "rates")) return respond({ success: false, error: "This integration does not own the rates domain" }, 409);
        for (const incoming of body.rates) {
          const externalReference = text(incoming?.external_reference);
          const roomReference = text(incoming?.room_external_reference);
          if (!externalReference || !roomReference) throw new Error("Each rate requires external_reference and room_external_reference");
          let roomId = roomMap.get(roomReference);
          if (!roomId) {
            const { data: room } = await admin.from("hotel_rooms").select("room_id").eq("hotel_id", integration.hotel_id).eq("source_system", sourceSystem).eq("external_reference", roomReference).maybeSingle();
            roomId = Number(room?.room_id || 0);
          }
          if (!roomId) throw new Error(`Unknown PMS room ${roomReference}`);
          const payload = {
            hotel_id: integration.hotel_id,
            room_id: roomId,
            name: text(incoming?.name) || "Standard rate",
            description: text(incoming?.description) || null,
            meal_plan: ["room_only", "breakfast", "half_board", "full_board", "all_inclusive"].includes(text(incoming?.meal_plan)) ? text(incoming?.meal_plan) : "room_only",
            payment_timing: ["pay_now", "before_arrival", "at_property"].includes(text(incoming?.payment_timing)) ? text(incoming?.payment_timing) : "pay_now",
            refundable: incoming?.refundable === true,
            cancellation_hours: incoming?.refundable === true ? Math.max(0, int(incoming?.cancellation_hours, 24)) : null,
            price_per_night: Math.max(1, int(incoming?.price_per_night, 1)),
            included_features: Array.isArray(incoming?.included_features) ? incoming.included_features.map(text).filter(Boolean) : [],
            active: incoming?.active !== false,
            source_system: sourceSystem,
            external_reference: externalReference,
            updated_at: new Date().toISOString(),
          };
          const { data: existing } = await admin.from("hotel_rate_plans").select("rate_plan_id").eq("hotel_id", integration.hotel_id).eq("source_system", sourceSystem).eq("external_reference", externalReference).maybeSingle();
          const result = existing
            ? await admin.from("hotel_rate_plans").update(payload).eq("rate_plan_id", existing.rate_plan_id)
            : await admin.from("hotel_rate_plans").insert(payload);
          if (result.error) throw result.error; rateCount++;
        }
      }

      if (Array.isArray(body?.inventory)) {
        if (!owns(integration, "inventory")) return respond({ success: false, error: "This integration does not own the inventory domain" }, 409);
        for (const incoming of body.inventory) {
          const roomReference = text(incoming?.room_external_reference);
          const date = text(incoming?.date);
          if (!roomReference || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Inventory requires room_external_reference and YYYY-MM-DD date");
          let roomId = roomMap.get(roomReference);
          if (!roomId) {
            const { data: room } = await admin.from("hotel_rooms").select("room_id,total_rooms").eq("hotel_id", integration.hotel_id).eq("source_system", sourceSystem).eq("external_reference", roomReference).maybeSingle();
            roomId = Number(room?.room_id || 0);
          }
          if (!roomId) throw new Error(`Unknown PMS room ${roomReference}`);
          const payload = { hotel_id: integration.hotel_id, room_id: roomId, inventory_date: date, available_quantity: Math.max(0, int(incoming?.available_quantity, 0)), rate_override: incoming?.rate_override == null ? null : Math.max(1, int(incoming.rate_override, 1)), closed: incoming?.closed === true, note: text(incoming?.note) || null, source_system: sourceSystem, external_reference: text(incoming?.external_reference) || null, updated_at: new Date().toISOString() };
          const { error } = await admin.from("hotel_inventory_daily").upsert(payload, { onConflict: "room_id,inventory_date" });
          if (error) throw error; inventoryCount++;
        }
      }

      const details = { rooms: roomCount, rates: rateCount, inventory: inventoryCount };
      await admin.from("hotel_integrations").update({ last_sync_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", integration.id);
      await finishEvent(admin, event.id!, "processed", details);
      return respond({ success: true, ...details });
    }

    if (req.method === "POST" && route === "/v1/room-status") {
      if (!hasScope(integration, "room_status.write")) return respond({ success: false, error: "room_status.write scope required" }, 403);
      const body = await req.json().catch(() => ({}));
      const event = await beginEvent(admin, integration, req, "room_status", body);
      if (event.error) return event.error;
      if (event.existing) return respond({ success: true, idempotent: true, status: event.existing.status, ...(event.existing.details || {}) });
      const roomReference = text(body?.room_external_reference);
      const unitLabel = text(body?.unit_label);
      const unitExternal = text(body?.unit_external_reference);
      const status = text(body?.status);
      if (!roomReference || !unitLabel || !allowedRoomStatuses.has(status)) {
        await finishEvent(admin, event.id!, "failed", {}, "room_external_reference, unit_label and a supported status are required");
        return respond({ success: false, error: "room_external_reference, unit_label and a supported status are required" }, 400);
      }
      const sourceSystem = `pms:${integration.id}`;
      const { data: room } = await admin.from("hotel_rooms").select("room_id").eq("hotel_id", integration.hotel_id).eq("source_system", sourceSystem).eq("external_reference", roomReference).maybeSingle();
      if (!room) return respond({ success: false, error: "PMS room type not found" }, 404);
      let unitQuery = admin.from("hotel_room_units").select("unit_id,current_booking_id").eq("hotel_id", integration.hotel_id).eq("room_id", room.room_id).eq("unit_label", unitLabel);
      const { data: unit } = await unitQuery.maybeSingle();
      if (!unit) {
        await finishEvent(admin, event.id!, "review_required", { room_external_reference: roomReference, unit_label: unitLabel }, "Physical unit is not mapped in WeHouse");
        return respond({ success: true, review_required: true, reason: "Physical unit is not mapped in WeHouse" });
      }
      if (unit.current_booking_id && status !== "cleaning") {
        await finishEvent(admin, event.id!, "review_required", { unit_id: unit.unit_id, status }, "PMS cannot override an occupied WeHouse unit");
        return respond({ success: true, review_required: true, reason: "Occupied WeHouse unit was not overridden" });
      }
      const { error } = await admin.from("hotel_room_units").update({ status, source_system: sourceSystem, external_reference: unitExternal || null, ready_after: status === "ready" ? null : undefined, updated_at: new Date().toISOString() }).eq("unit_id", unit.unit_id);
      if (error) throw error;
      const details = { unit_id: unit.unit_id, status };
      await finishEvent(admin, event.id!, "processed", details);
      return respond({ success: true, ...details });
    }

    return respond({ success: false, error: "Unknown PMS API route" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "PMS request failed";
    console.error("hotel-pms-api", { integration_id: integration.id, route, error: message });
    await admin.from("hotel_integrations").update({ last_error: message, updated_at: new Date().toISOString() }).eq("id", integration.id);
    return respond({ success: false, error: message }, 500);
  }
});
