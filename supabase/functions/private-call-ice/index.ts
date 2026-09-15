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

function base64(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);

  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!token || !url || !serviceKey)
    return json({ error: "Call access required" }, 401);

  const body = await request.json().catch(() => ({}));
  const callId = String(body?.call_id || "");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      callId,
    )
  )
    return json({ error: "Invalid call" }, 400);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user)
    return json({ error: "Call access expired" }, 401);

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
  if (
    !call ||
    ![call.caller_id, call.callee_id].includes(profile.user_id) ||
    !["ringing", "accepted"].includes(call.status)
  )
    return json({ error: "This call is not available" }, 403);

  const urls = (Deno.env.get("TURN_URLS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^turns?:/i.test(value));
  const sharedSecret = Deno.env.get("TURN_SHARED_SECRET") || "";
  if (!urls.length || !sharedSecret)
    return json({ error: "TURN relay is not configured" }, 503);

  // TURN REST credentials are deliberately short-lived.  The permanent shared
  // secret never leaves the Edge Function and credentials are issued only to a
  // signed-in participant of this exact active call.
  const expires = Math.floor(Date.now() / 1000) + 60 * 60;
  const username = `${expires}:${profile.user_id}:${callId}`;
  const signingKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sharedSecret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const credential = base64(
    await crypto.subtle.sign(
      "HMAC",
      signingKey,
      new TextEncoder().encode(username),
    ),
  );

  return json({
    ice_servers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls, username, credential },
    ],
    relay_ready: true,
    expires_at: new Date(expires * 1000).toISOString(),
  });
});
