import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

const responseHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await request.json();
    const identifier = String(body?.identifier || "").trim().toLowerCase();
    const password = String(body?.password || "");
    const isEmail = identifier.includes("@");
    if (
      password.length < 8 ||
      (isEmail
        ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)
        : !/^[a-z0-9_]{3,20}$/.test(identifier))
    ) {
      return json({ error: "Invalid username, email or password" }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey)
      return json({ error: "Authentication is temporarily unavailable" }, 503);

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const forwardedFor =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-real-ip") ||
      request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
      "unavailable";
    const fingerprint = await sha256Hex(
      `${forwardedFor}|${request.headers.get("user-agent") || "unknown"}`,
    );
    const { data: throttle, error: throttleError } = await admin.rpc(
      "consume_public_password_login_attempt_from_service",
      { p_fingerprint_hash: fingerprint },
    );
    if (throttleError)
      return json({ error: "Authentication is temporarily unavailable" }, 503);
    if (throttle?.allowed !== true)
      return json(
        {
          error: "Too many sign-in attempts. Wait briefly and try again.",
          retry_after_seconds: Number(throttle?.retry_after_seconds || 60),
        },
        429,
      );

    let email = identifier;
    if (!isEmail) {
      const { data: profile } = await admin
        .from("profiles")
        .select("email")
        .ilike("username", identifier)
        .or("deleted.is.null,deleted.eq.false")
        .maybeSingle();
      email = String(profile?.email || "").trim().toLowerCase();
    }

    if (!email) return json({ error: "Invalid username, email or password" }, 400);
    const auth = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await auth.auth.signInWithPassword({ email, password });
    if (error || !data.session)
      return json({ error: "Invalid username, email or password" }, 400);

    return json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch (error) {
    console.error("[login-with-identifier] failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ error: "Authentication is temporarily unavailable" }, 500);
  }
});
