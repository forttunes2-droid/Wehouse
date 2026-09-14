import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

const responseHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return json({ success: false, error: "Method not allowed" }, 405);

  const authorization = request.headers.get("authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "") || "";
  if (!token)
    return json({ success: false, error: "Confirmation session required" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey)
    return json(
      { success: false, error: "Password recovery is temporarily unavailable" },
      503,
    );

  try {
    const body = await request.json().catch(() => ({}));
    const attemptId = String(body?.attempt_id || "").trim();
    const newPassword = String(body?.new_password || "");
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        attemptId,
      ) ||
      newPassword.length < 15 ||
      newPassword.length > 128
    ) {
      return json({ success: false, error: "Invalid recovery request" }, 400);
    }

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: current, error: currentError } = await admin.auth.getUser(token);
    if (currentError || !current.user)
      return json(
        { success: false, error: "Confirmation expired. Start recovery again." },
        401,
      );

    const actor = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: claimedAuthId, error: claimError } = await actor.rpc(
      "claim_identity_provider_password_recovery",
      { p_attempt_id: attemptId },
    );
    if (claimError || String(claimedAuthId || "") !== current.user.id)
      return json(
        {
          success: false,
          error: "This confirmation cannot change that account. Start recovery again.",
        },
        403,
      );

    const { error: updateError } = await admin.auth.admin.updateUserById(
      current.user.id,
      { password: newPassword },
    );
    if (updateError) {
      await admin.rpc("finish_identity_provider_password_recovery", {
        p_attempt_id: attemptId,
        p_auth_id: current.user.id,
        p_succeeded: false,
      });
      return json(
        { success: false, error: "Password could not be changed. Try again." },
        400,
      );
    }

    const { data: finished, error: finishError } = await admin.rpc(
      "finish_identity_provider_password_recovery",
      {
        p_attempt_id: attemptId,
        p_auth_id: current.user.id,
        p_succeeded: true,
      },
    );
    if (finishError || finished !== true) {
      console.error("[provider-password-recovery] completion audit failed", {
        auth_id: current.user.id,
        attempt_id: attemptId,
      });
    }

    const closedAt = new Date().toISOString();
    const { error: sessionCloseError } = await admin
      .from("user_sessions")
      .update({ is_active: false, is_current: false, logout_time: closedAt })
      .eq("auth_id", current.user.id)
      .eq("is_active", true);
    if (sessionCloseError)
      console.error("[provider-password-recovery] device-session close failed", {
        auth_id: current.user.id,
      });

    const { data: profile } = await admin
      .from("profiles")
      .select("user_id")
      .eq("auth_id", current.user.id)
      .maybeSingle();
    if (profile?.user_id)
      await admin.from("user_activity").insert({
        user_id: profile.user_id,
        auth_id: current.user.id,
        action_type: "password_change",
        details: { source: "linked_identity_recovery" },
      });

    // A recovered credential invalidates refresh sessions everywhere. The user
    // signs in again deliberately with the new password or a linked provider.
    await admin.auth.admin.signOut(token, "global").catch(() => {});
    return json({ success: true });
  } catch (error) {
    console.error("[provider-password-recovery] failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return json(
      { success: false, error: "Password recovery could not be completed" },
      500,
    );
  }
});
