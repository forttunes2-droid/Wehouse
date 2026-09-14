import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

const headers = {
  ...corsHeaders,
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!token || !url || !serviceKey) return json({ error: "Call access required" }, 401);

  const body = await request.json().catch(() => ({}));
  const callId = String(body?.call_id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(callId))
    return json({ error: "Invalid call" }, 400);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: "Call access expired" }, 401);
  const { data: profile } = await admin
    .from("profiles")
    .select("user_id,deleted,suspended,banned")
    .eq("auth_id", auth.user.id)
    .maybeSingle();
  if (!profile || profile.deleted || profile.suspended || profile.banned)
    return json({ error: "Active account required" }, 403);
  const { data: call } = await admin
    .from("private_calls")
    .select("caller_id,callee_id,status")
    .eq("id", callId)
    .maybeSingle();
  if (!call || ![call.caller_id, call.callee_id].includes(profile.user_id) || !["ringing", "accepted"].includes(call.status))
    return json({ error: "This call is not available" }, 403);

  const iceServers: Array<Record<string, unknown>> = [
    { urls: "stun:stun.l.google.com:19302" },
  ];
  const urls = (Deno.env.get("WEBRTC_TURN_URLS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^turns?:/i.test(value));
  const username = Deno.env.get("WEBRTC_TURN_USERNAME") || "";
  const credential = Deno.env.get("WEBRTC_TURN_CREDENTIAL") || "";
  if (urls.length && username && credential)
    iceServers.push({ urls, username, credential });

  return json({ ice_servers: iceServers, relay_ready: iceServers.length > 1 });
});
