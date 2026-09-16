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

type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

function filterBrowserBlockedUrls(server: IceServer): IceServer | null {
  const values = Array.isArray(server.urls) ? server.urls : [server.urls];
  const urls = values.filter(
    (value) => typeof value === "string" && !/:53(?:\?|$)/i.test(value),
  );
  if (!urls.length) return null;
  return {
    ...server,
    urls: Array.isArray(server.urls) ? urls : urls[0],
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);

  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!token || !url || !anonKey)
    return json({ error: "Call access required" }, 401);

  const body = await request.json().catch(() => ({}));
  const callId = String(body?.call_id || "");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      callId,
    )
  )
    return json({ error: "Invalid call" }, 400);

  // Use the caller JWT for database reads. RLS plus the explicit participant
  // check below ensure relay credentials are issued only to a participant of
  // this exact active WeHouse call.
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user)
    return json({ error: "Call access expired" }, 401);

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("user_id,deleted,suspended,banned")
    .eq("auth_id", auth.user.id)
    .maybeSingle();
  if (
    profileError ||
    !profile ||
    profile.deleted ||
    profile.suspended ||
    profile.banned
  )
    return json({ error: "Active account required" }, 403);

  const { data: call, error: callError } = await client
    .from("private_calls")
    .select("caller_id,callee_id,status")
    .eq("id", callId)
    .maybeSingle();
  if (
    callError ||
    !call ||
    ![call.caller_id, call.callee_id].includes(profile.user_id) ||
    !["ringing", "accepted"].includes(call.status)
  )
    return json({ error: "This call is not available" }, 403);

  // Cloudflare's TURN token is a long-lived server secret. Never return it to
  // the browser. Exchange it here for short-lived ICE credentials instead.
  const turnKeyId = Deno.env.get("CLOUDFLARE_TURN_KEY_ID") || "";
  const turnApiToken = Deno.env.get("CLOUDFLARE_TURN_API_TOKEN") || "";
  if (!turnKeyId || !turnApiToken)
    return json({ error: "TURN relay is not configured" }, 503);

  const ttlSeconds = 60 * 60;
  let response: Response;
  try {
    response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turnKeyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${turnApiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ttl: ttlSeconds,
          customIdentifier: `wehouse:${profile.user_id}`,
        }),
      },
    );
  } catch (reason) {
    console.error(
      "Cloudflare TURN credential request failed",
      reason instanceof Error ? reason.message : reason,
    );
    return json({ error: "TURN relay is temporarily unavailable" }, 503);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(payload?.iceServers)) {
    console.error(
      "Cloudflare TURN credential response rejected",
      response.status,
      typeof payload?.error === "string" ? payload.error : "invalid response",
    );
    return json({ error: "TURN relay is temporarily unavailable" }, 503);
  }

  const iceServers = (payload.iceServers as IceServer[])
    .map(filterBrowserBlockedUrls)
    .filter((server): server is IceServer => Boolean(server?.urls));
  const hasRelay = iceServers.some((server) => {
    const values = Array.isArray(server.urls) ? server.urls : [server.urls];
    return values.some((value) => /^turns?:/i.test(value));
  });
  if (!hasRelay)
    return json({ error: "TURN relay credentials were incomplete" }, 503);

  return json({
    ice_servers: iceServers,
    relay_ready: true,
    expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  });
});
