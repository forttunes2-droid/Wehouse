import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { consumeUserAction } from "../_shared/rateLimit.ts";

const jsonHeaders = { "Content-Type": "application/json" };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });
const allowedRoomStatuses = new Set(["ready", "cleaning", "maintenance", "out_of_service"]);
const MAX_BODY_BYTES=262144;
async function requestBody(req:Request){
  const declared=Number(req.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>MAX_BODY_BYTES)return{error:respond({success:false,error:'PMS JSON requests are limited to 256 KiB'},413)};
  if(!req.headers.get('content-type')?.toLowerCase().includes('application/json'))return{error:respond({success:false,error:'application/json is required'},415)};
  const reader=req.body?.getReader();if(!reader)return{error:respond({success:false,error:'A JSON object is required'},400)};
  const chunks:Uint8Array[]=[];let length=0;
  for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BODY_BYTES){await reader.cancel();return{error:respond({success:false,error:'PMS JSON requests are limited to 256 KiB'},413)};}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{const body=JSON.parse(new TextDecoder().decode(bytes));if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return{body};}
  catch{return{error:respond({success:false,error:'A valid JSON object is required'},400)};}
}

type Integration = {
  integration_id: string;
  hotel_id: number;
  provider: string;
  connection_name: string;
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
  const route = parts.slice(index >= 0 ? index + 1 : parts.length).join("/");
  return route ? `/${route}` : "/";
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
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

async function authenticate(admin: SupabaseClient, req: Request): Promise<Integration | null> {
  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token.startsWith("whpms_live_") || token.length < 40) return null;
  const tokenHash = await sha256(token);
  const { data, error } = await admin
    .from("hotel_integrations")
    .select("integration_id,hotel_id,provider,connection_name,status,scopes,authoritative_domains,external_hotel_id")
    .eq("token_hash", tokenHash)
    .eq("status", "active")
    .maybeSingle();
  if (error || !data) return null;
  // Re-check revocation/certification on every request, including reads made
  // with the service role (which otherwise bypasses row-level policies).
  const { data: runtimeActive, error: runtimeError } = await admin.rpc("hotel_integration_runtime_active", { p_integration_id: data.integration_id });
  if (runtimeError || runtimeActive !== true) return null;
  return data as Integration;
}

function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function reservationCursor(value: string): { updatedAt: string; bookingId: number } | null {
  try {
    if (!value.startsWith("v1:")) return null;
    const [updatedAt, bookingId] = JSON.parse(decodeURIComponent(value.slice(3)));
    if (typeof updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt)) || !Number.isSafeInteger(bookingId) || bookingId < 1) return null;
    return { updatedAt, bookingId };
  } catch { return null; }
}

async function beginEvent(admin: SupabaseClient, integration: Integration, req: Request, eventType: string, body: unknown) {
  const key = text(req.headers.get("idempotency-key"));
  if (!key || key.length > 200) return { error: respond({ success: false, error: "Idempotency-Key must contain 1 to 200 characters" }, 400) };
  const payloadHash = await sha256(canonicalJson({ method: req.method, route: routeFor(req), body: body ?? {} }));
  const { data: existing, error: lookupError } = await admin
    .from("hotel_integration_events")
    .select("integration_event_id,event_type,payload_hash,status,details,error_message")
    .eq("integration_id", integration.integration_id)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (lookupError) return { error: respond({ success: false, error: "Could not verify this idempotent request" }, 503) };
  if (existing) {
    if (existing.event_type !== eventType || existing.payload_hash !== payloadHash) return { error: respond({ success: false, error: "Idempotency-Key was already used for a different request" }, 409) };
    if (!["acknowledged", "review_required"].includes(existing.status)) return { error: respond({ success: false, idempotent: true, status: existing.status, error: existing.status === "pending" ? "Request is still pending; reconcile before retrying" : "Previous request failed; reconcile before retrying" }, 409) };
    return { existing };
  }
  const { data, error } = await admin
    .from("hotel_integration_events")
    .insert({
      integration_id: integration.integration_id,
      idempotency_key: key,
      direction: "inbound",
      event_type: eventType,
      payload_hash: payloadHash,
      status: "pending",
      details: {},
    })
    .select("integration_event_id")
    .single();
  if (error || !data) return { error: respond({ success: false, error: "Could not reserve this idempotent request" }, 409) };
  return { id: data.integration_event_id as string };
}

async function finishEvent(admin: SupabaseClient, id: string, status: "acknowledged" | "review_required" | "dead_letter", details: Record<string, unknown>, errorMessage?: string) {
  let query=admin.from("hotel_integration_events").update({ status, details, error_message: errorMessage || null, processed_at: new Date().toISOString(), ...(status === "acknowledged" ? { acknowledged_at: new Date().toISOString() } : status === "dead_letter" ? { dead_lettered_at: new Date().toISOString() } : {}) }).eq("integration_event_id", id);
  // A lost response after an atomic commit must not overwrite its completed receipt.
  if(status==='dead_letter')query=query.eq('status','pending');
  const {data,error}=await query.select('integration_event_id').maybeSingle();
  if(error||(!data&&status!=='dead_letter'))throw error||new Error('PMS event completion could not be confirmed');
}

serve(async (req) => {
  if (!["GET", "POST"].includes(req.method)) return respond({ success: false, error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return respond({ success: false, error: "PMS gateway configuration is incomplete" }, 503);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const integration = await authenticate(admin, req);
  if (!integration) return respond({ success: false, error: "Invalid or inactive PMS token" }, 401);
  const budget=await consumeUserAction(admin,`hotel-pms:${integration.integration_id}`,'hotel_pms_request',120,60,true);
  const writeBudget=req.method==='POST'&&budget.allowed?await consumeUserAction(admin,`hotel-pms:${integration.integration_id}`,'hotel_pms_write',30,60,true):budget;
  if(!budget.allowed||!writeBudget.allowed){const retry=Math.max(1,budget.retryAfterSeconds,writeBudget.retryAfterSeconds);return new Response(JSON.stringify({success:false,error:'Hotel connection request limit reached; retry after the stated delay',retry_after_seconds:retry}),{status:429,headers:{...jsonHeaders,'Retry-After':String(retry)}});}

  const route = routeFor(req);
  let activeEventId: string | undefined;
  try {
    const parsed=req.method==='POST'?await requestBody(req):{body:null};
    if(parsed.error)return parsed.error;
    if (req.method === "GET" && route === "/v1/health") {
      await admin.from("hotel_integrations").update({ last_sync_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("integration_id", integration.integration_id);
      return respond({ success: true, api_version: "v1", integration: { id: integration.integration_id, hotel_id: integration.hotel_id, provider: integration.provider, external_hotel_id: integration.external_hotel_id, authoritative_domains: integration.authoritative_domains } });
    }

    if (req.method === "GET" && route === "/v1/reservations") {
      if (!hasScope(integration, "reservations.read")) return respond({ success: false, error: "reservations.read scope required" }, 403);
      const url = new URL(req.url);
      const cursor = text(url.searchParams.get("cursor"));
      const after = cursor ? reservationCursor(cursor) : null;
      if (cursor && !after) return respond({ success: false, error: "Invalid cursor; use the complete next_cursor from the previous response" }, 400);
      const limit = Math.min(200, Math.max(1, int(url.searchParams.get("limit"), 100)));
      let query = admin
        .from("hotel_bookings")
        .select("booking_id,hotel_id,room_id,rate_plan_id,rate_plan_name,check_in,check_out,guest_count,total_nights,total_price,status,guest_name,guest_phone,special_requests,payment_status,confirmed_at,checked_in_at,checked_out_at,completed_at,updated_at,pms_external_reservation_id,pms_sync_status")
        .eq("hotel_id", integration.hotel_id)
        .in("payment_status", ["paid", "refunded"])
        .in("status", ["confirmed", "checked_in", "checked_out", "completed", "cancelled", "refunded"])
        .order("updated_at", { ascending: true })
        .order("booking_id", { ascending: true })
        .limit(limit);
      if (after) query = query.or(`updated_at.gt.${after.updatedAt},and(updated_at.eq.${after.updatedAt},booking_id.gt.${after.bookingId})`);
      const { data: bookings, error } = await query;
      if (error) throw error;
      const roomIds = [...new Set((bookings || []).map((b: any) => b.room_id))];
      const { data: rooms, error: roomsError } = roomIds.length
        ? await admin.from("hotel_rooms").select("room_id,room_type,external_reference,source_system").in("room_id", roomIds)
        : { data: [] as any[], error: null };
      if (roomsError) throw roomsError;
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
          money: { currency: "NGN", total: booking.total_price, payment_status: booking.payment_status },
          lifecycle: { confirmed_at: booking.confirmed_at, checked_in_at: booking.checked_in_at, checked_out_at: booking.checked_out_at, completed_at: booking.completed_at },
          updated_at: booking.updated_at,
        };
      });
      // Reading must not update bookings: their update trigger would move each
      // delivered row after the cursor and cause an endless redelivery loop.
      const last = rows.at(-1);
      const nextCursor = last ? `v1:${encodeURIComponent(JSON.stringify([last.updated_at, last.wehouse_reservation_id]))}` : cursor || null;
      await admin.from("hotel_integrations").update({ last_cursor: nextCursor, last_sync_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("integration_id", integration.integration_id);
      return respond({ success: true, reservations: rows, next_cursor: nextCursor, count: rows.length });
    }

    const ackMatch = route.match(/^\/v1\/reservations\/(\d+)\/ack$/);
    if (req.method === "POST" && ackMatch) {
      if (!hasScope(integration, "reservations.ack")) return respond({ success: false, error: "reservations.ack scope required" }, 403);
      const body = parsed.body;
      const bookingId = Number(ackMatch[1]);
      const expectedAt = text(body?.reservation_updated_at);
      const expectedStatus = text(body?.reservation_status);
      if (typeof body?.accepted !== "boolean" || !reservationCursor('v1:' + encodeURIComponent(JSON.stringify([expectedAt, bookingId]))) || !["confirmed","checked_in","checked_out","completed","cancelled","refunded"].includes(expectedStatus)) {
        return respond({ success: false, error: "accepted, reservation_status and the exact reservation_updated_at from the latest reservation response are required" }, 400);
      }
      const event = await beginEvent(admin, integration, req, "reservation_ack", body);
      if (event.error) return event.error;
      if (event.existing) return respond({ success: true, idempotent: true, status: event.existing.status, ...(event.existing.details || {}) });
      activeEventId = event.id;
      const accepted = body.accepted;
      const externalId = text(body?.external_reservation_id) || null;
      const reason = text(body?.reason);
      const { data: details, error: ackError } = await admin.rpc("ack_hotel_pms_reservation", {
        p_integration_id: integration.integration_id, p_booking_id: bookingId,
        p_expected_updated_at: expectedAt, p_expected_status: expectedStatus, p_accepted: accepted,
        p_external_id: externalId, p_reason: reason || null, p_event_id: event.id,
      });
      if (ackError?.code === '40001') {
        await finishEvent(admin, event.id!, "dead_letter", { booking_id: bookingId, reconciliation_required: true }, "Reservation changed; fetch its latest version before acknowledging");
        return respond({ success: false, error: "Reservation changed; fetch its latest version before acknowledging" }, 409);
      }
      if (ackError) throw ackError;
      if (!details || details.booking_id !== bookingId || details.accepted !== accepted || details.reservation_status !== expectedStatus) throw new Error("Hotel acknowledgement could not be confirmed");
      if (!accepted) {
        const { data: hotel } = await admin.from("hotels").select("owner_id,name").eq("hotel_id", integration.hotel_id).single();
        if (hotel?.owner_id) await admin.from("notifications").insert({ recipient_id: hotel.owner_id, type: "hotel_pms_review", title: "Hotel connection needs review", message: `${hotel.name || "Hotel"} PMS rejected WeHouse reservation ${bookingId}. WeHouse booking status remains ${details.reservation_status}. Review the latest reservation state with the hotel.`, related_id: String(bookingId), source_type: "hotel_booking", source_id: String(bookingId), destination_route: "property-owner", destination_params: { hotel_id: integration.hotel_id, booking_id: bookingId }, event_key: `hotel-pms-reject:${integration.integration_id}:${bookingId}:${event.id}`, workspace_scope: "property_partner" });
      }
      return respond({ success: true, ...details });
    }

    if (req.method === "POST" && route === "/v1/catalog") {
      if (!hasScope(integration, "catalog.write")) return respond({ success: false, error: "catalog.write scope required" }, 403);
      const body = parsed.body;
      // Check every delegated domain before reserving an event or writing any
      // part of a mixed catalog request.
      for (const domain of ["rooms", "rates", "inventory"]) {
        if (body?.[domain] !== undefined && !Array.isArray(body[domain])) return respond({ success: false, error: `${domain} must be an array` }, 400);
        if (Array.isArray(body?.[domain]) && body[domain].length>200) return respond({ success: false, error: domain + " accepts at most 200 records per request" },400);
        if (Array.isArray(body?.[domain]) && !owns(integration, domain)) return respond({ success: false, error: `This integration does not own the ${domain} domain` }, 409);
      }
      const event = await beginEvent(admin, integration, req, "catalog_sync", body);
      if (event.error) return event.error;
      if (event.existing) return respond({ success: true, idempotent: true, status: event.existing.status, ...(event.existing.details || {}) });
      activeEventId = event.id;
      const { data: details, error: catalogError } = await admin.rpc("apply_hotel_pms_catalog", {
        p_integration_id: integration.integration_id, p_event_id: event.id, p_catalog: body,
      });
      if (catalogError) throw catalogError;
      if (!details || ["rooms","rates","inventory"].some(domain => !Number.isSafeInteger(details[domain]) || details[domain] !== (body[domain]?.length || 0))) throw new Error("Catalog completion receipt could not be confirmed");
      return respond({ success: true, ...details });
    }

    if (req.method === "POST" && route === "/v1/room-status") {
      if (!hasScope(integration, "room_status.write")) return respond({ success: false, error: "room_status.write scope required" }, 403);
      if (!owns(integration, "room_status")) return respond({ success: false, error: "This integration does not own the room_status domain" }, 409);
      const body = parsed.body;
      const event = await beginEvent(admin, integration, req, "room_status", body);
      if (event.error) return event.error;
      if (event.existing) return respond({ success: true, idempotent: true, status: event.existing.status, ...(event.existing.details || {}) });
      activeEventId = event.id;
      const roomReference = text(body?.room_external_reference);
      const unitLabel = text(body?.unit_label);
      const unitExternal = text(body?.unit_external_reference);
      const status = text(body?.status);
      if (!roomReference || !unitLabel || !allowedRoomStatuses.has(status)) {
        await finishEvent(admin, event.id!, "dead_letter", {}, "room_external_reference, unit_label and a supported status are required");
        return respond({ success: false, error: "room_external_reference, unit_label and a supported status are required" }, 400);
      }
      const { data: details, error: roomError }=await admin.rpc("apply_hotel_pms_room_status", {
        p_integration_id:integration.integration_id,p_event_id:event.id,p_room_reference:roomReference,
        p_unit_label:unitLabel,p_unit_external:unitExternal||null,p_status:status,
      });
      if(roomError)throw roomError;
      if(!details||typeof details.review_required!=="boolean"||(details.review_required?typeof details.reason!=="string":typeof details.unit_id!=="string"||details.status!==status))throw new Error("Room status completion could not be confirmed");
      return respond({ success: true, ...details });
    }

    return respond({ success: false, error: "Unknown PMS API route" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "PMS request failed";
    if (activeEventId) {
      // A multi-step operation may be partially applied. Never automatically
      // replay it or describe it as successful; leave an auditable failure.
      await finishEvent(admin, activeEventId, "dead_letter", { reconciliation_required: true }, message).catch(() => {});
    }
    console.error("hotel-pms-api", { integration_id: integration.integration_id, route, error: message });
    await admin.from("hotel_integrations").update({ last_error: message, updated_at: new Date().toISOString() }).eq("integration_id", integration.integration_id);
    return respond({ success: false, error: message }, 500);
  }
});
