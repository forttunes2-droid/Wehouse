import { hasLiveSession } from "../_shared/liveSession.ts";
import { consumeUserAction } from "../_shared/rateLimit.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

function jwtSessionId(token: string): string {
  try {
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(
      atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")),
    );
    return String(payload?.session_id || "");
  } catch {
    return "";
  }
}

async function paystack(path: string, secret: string, init?: RequestInit) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    signal: AbortSignal.timeout(12000),
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || !body?.status) {
    throw new Error(body?.message || `Paystack request failed (${response.status})`);
  }
  return body.data;
}

function ngnBalanceKobo(data: any) {
  if (!Array.isArray(data)) return null;
  const row = data.find((item: any) => String(item?.currency || "").toUpperCase() === "NGN");
  if (!row || row.balance === null || row.balance === undefined || row.balance === "") return null;
  const balance = Number(row.balance);
  return Number.isSafeInteger(balance) && balance >= 0 ? balance : null;
}

function assertTransferReceipt(transfer: any, reference: string, amount: number) {
  if (!transfer || transfer.reference !== reference ||
    !Number.isSafeInteger(transfer.amount) || transfer.amount !== Math.round(amount * 100) ||
    transfer.currency !== "NGN" || typeof transfer.status !== "string" || !transfer.status.trim()) {
    throw new Error("Paystack transfer details do not match the stored withdrawal. Funds remain held for reconciliation.");
  }
}

function transferFeeBufferKobo() {
  // Provider fees can change. Keep the safety buffer configurable rather than
  // coupling wallet accounting to a hard-coded Paystack tariff.
  const configuredNaira = Number(Deno.env.get("PAYSTACK_NGN_TRANSFER_FEE_BUFFER") || "100");
  const safeNaira = Number.isFinite(configuredNaira)
    ? Math.max(0, Math.min(configuredNaira, 5000))
    : 100;
  return Math.round(safeNaira * 100);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ success: false, error: "Authorization required" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!supabaseUrl || !serviceKey || !paystackSecret)
      return json({ success: false, error: "Payout server configuration is incomplete" }, 503);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ success: false, error: "Invalid or expired session" }, 401);
    if (!await hasLiveSession(admin, user.id, token)) return json({success:false,error:'Session ended. Sign in again.'},401);
    const limit = await consumeUserAction(admin, user.id, "payout_withdrawal", 10, 600);
    if (!limit.allowed) return json({ success: false, error: "Too many withdrawal attempts. Please wait and try again.", retry_after_seconds: limit.retryAfterSeconds }, 429);
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("user_id,deleted,suspended,banned")
      .eq("auth_id", user.id)
      .maybeSingle();
    if (profileError) return json({ success: false, error: "Could not load finance account" }, 500);
    if (!profile || profile.deleted || profile.suspended || profile.banned)
      return json({ success: false, error: "Active finance team account required" }, 403);

    const { data: grants, error: grantReadError } = await admin
      .from("workspace_role_assignments")
      .select("workspace_role")
      .eq("user_id", profile.user_id)
      .eq("status", "active")
      .is("revoked_at", null)
      .in("workspace_role", ["creator", "admin", "staff", "finance_operations"]);
    if (grantReadError) return json({ success: false, error: "Could not confirm finance authority" }, 500);
    const activeGrants = new Set((grants || []).map((row: { workspace_role?: string | null }) => String(row.workspace_role || "")));
    const isCreator = activeGrants.has("creator");
    const isAdmin = activeGrants.has("admin");
    const isFinanceStaff = activeGrants.has("staff") && activeGrants.has("finance_operations");
    if (!isCreator && !isAdmin && !isFinanceStaff)
      return json({ success: false, error: "Active Finance Operations access required" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const withdrawalId = String(body?.withdrawal_id || "").trim();
    if (!withdrawalId) return json({ success: false, error: "Withdrawal ID is required" }, 400);

    if (isCreator && ["approve", "reject"].includes(action)) {
      const creatorElevationId = String(body?.creator_elevation_id || "").trim();
      const sessionId = jwtSessionId(token);
      if (
        !sessionId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          creatorElevationId,
        )
      ) {
        return json({ success: false, error: "Fresh Creator finance confirmation required" }, 403);
      }
      const { data: grant, error: grantError } = await admin
        .from("creator_elevation_grants")
        .select(
          "creator_user_id,auth_user_id,auth_session_id,action_classes,expires_at,revoked_at",
        )
        .eq("creator_elevation_id", creatorElevationId)
        .maybeSingle();
      const classes = Array.isArray(grant?.action_classes)
        ? grant.action_classes.map((value: unknown) => String(value))
        : [];
      const expiresAt = Date.parse(String(grant?.expires_at || ""));
      if (
        grantError ||
        !grant ||
        grant.creator_user_id !== profile.user_id ||
        String(grant.auth_user_id) !== user.id ||
        grant.auth_session_id !== sessionId ||
        grant.revoked_at ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now() ||
        (!classes.includes("finance_exception") &&
          !classes.includes("all_sensitive"))
      ) {
        return json({ success: false, error: "Fresh Creator finance confirmation required" }, 403);
      }
    }

    if (action === "reject") {
      const reason = String(body?.reason || "").trim();
      if (!reason) return json({ success: false, error: "A rejection reason is required" }, 400);
      const { data, error } = await admin.rpc("reject_withdrawal_for_payout", {
        p_withdrawal_id: withdrawalId,
        p_reviewer_id: profile.user_id,
        p_reason: reason,
      });
      if (error) return json({ success: false, error: error.message }, 409);
      return json({ success: true, ...(data || {}) });
    }

    if (action === "approve") {
      // Do not reserve/claim a withdrawal until Paystack's own NGN balance can
      // actually fund it. This lets a released Worker/Partner request a payout
      // immediately while safely waiting for Paystack Manual Payout settlement.
      const { data: pending, error: pendingError } = await admin
        .from("withdrawals")
        .select("id,amount,status,paystack_transfer_reference")
        .eq("id", withdrawalId)
        .maybeSingle();
      if (pendingError || !pending)
        return json({ success: false, error: "Withdrawal could not be loaded" }, 409);
      if (pending.status === "processing") {
        return json({
          success: false,
          error: "This withdrawal is already processing. Use Check Paystack status; do not send it again.",
        }, 409);
      }
      if (pending.status !== "awaiting_review")
        return json({ success: false, error: "Withdrawal is not awaiting review" }, 409);

      let balances: any;
      try {
        balances = await paystack("/balance", paystackSecret);
      } catch (error) {
        console.error("payout balance check failed", {
          withdrawal_id: withdrawalId,
          error: errorMessage(error, "Paystack balance check failed"),
        });
        return json({
          success: false,
          error: "Paystack balance could not be confirmed. The withdrawal remains awaiting review; try again later.",
        }, 502);
      }
      const availableKobo = ngnBalanceKobo(balances);
      if (availableKobo === null)
        return json({ success: false, error: "Paystack NGN balance could not be confirmed. The withdrawal remains awaiting review." }, 502);
      const transferKobo = Math.round(Number(pending.amount) * 100);
      const requiredKobo = transferKobo + transferFeeBufferKobo();
      if (!Number.isFinite(transferKobo) || transferKobo <= 0)
        return json({ success: false, error: "Withdrawal amount is invalid" }, 409);
      if (availableKobo < requiredKobo) {
        return json({
          success: false,
          provider_balance_pending: true,
          status: "awaiting_review",
          error: "Paystack has not settled enough NGN balance for this withdrawal yet. The request remains awaiting review and can be sent after settlement.",
        }, 409);
      }

      const { data: claim, error: claimError } = await admin.rpc("claim_withdrawal_for_payout", {
        p_withdrawal_id: withdrawalId,
        p_reviewer_id: profile.user_id,
      });
      if (claimError || !claim?.success)
        return json({ success: false, error: claim?.error || claimError?.message || "Withdrawal could not be reviewed" }, 409);
      if (claim.already_claimed)
        return json({ success: true, status: "processing", reconciliation_required: true });
      let transfer: any;
      try {
        transfer = await paystack("/transfer", paystackSecret, {
          method: "POST",
          body: JSON.stringify({
            source: "balance",
            currency: "NGN",
            amount: Math.round(Number(claim.amount) * 100),
            recipient: claim.recipient_code,
            reference: claim.reference,
            reason: `WeHouse ${claim.owner_type === "worker" ? "Worker" : "Property Partner"} withdrawal`,
          }),
        });
        assertTransferReceipt(transfer, claim.reference, Number(claim.amount));
      } catch (error) {
        console.error("payout transfer initiation failed", {
          withdrawal_id: withdrawalId,
          reference: claim.reference,
          error: errorMessage(error, "Paystack transfer failed"),
        });
        return json({
          success: false,
          error: "Paystack did not return a confirmed matching transfer. Funds remain held; use Check Paystack status before retrying.",
        }, 502);
      }
      const paystackStatus = String(transfer?.status || "pending").toLowerCase();
      const { error: recordError } = await admin.rpc("record_withdrawal_transfer_response", {
        p_withdrawal_id: withdrawalId,
        p_transfer_code: String(transfer?.transfer_code || "") || null,
        p_paystack_status: paystackStatus,
        p_response: transfer || {},
      });
      if (recordError) return json({ success: false, error: "Transfer started but its response could not be recorded. Reconcile this payout before any retry." }, 500);
      return json({
        success: true,
        status: "processing",
        paystack_status: paystackStatus,
        approval_required: paystackStatus === "otp",
      });
    }

    if (action === "reconcile") {
      const { data: snapshot, error: snapshotError } = await admin.rpc("get_withdrawal_payout_snapshot", {
        p_withdrawal_id: withdrawalId,
        p_reviewer_id: profile.user_id,
      });
      if (snapshotError || !snapshot?.success)
        return json({ success: false, error: snapshot?.error || snapshotError?.message || "Payout is unavailable" }, 409);
      if (snapshot.status !== "processing")
        return json({ success: true, status: snapshot.status, paystack_status: snapshot.paystack_status || null });
      let transfer: any;
      try {
        transfer = await paystack(`/transfer/verify/${encodeURIComponent(snapshot.reference)}`, paystackSecret);
        assertTransferReceipt(transfer, snapshot.reference, Number(snapshot.amount));
      } catch (error) {
        return json({ success: false, error: errorMessage(error, "Could not verify this transfer with Paystack") }, 502);
      }
      const status = String(transfer?.status || "pending").toLowerCase();
      const { error: recordError } = await admin.rpc("record_withdrawal_transfer_response", {
        p_withdrawal_id: withdrawalId,
        p_transfer_code: String(transfer?.transfer_code || snapshot.transfer_code || "") || null,
        p_paystack_status: status,
        p_response: transfer || {},
      });
      if (recordError) return json({ success: false, error: "Paystack status could not be recorded. Funds remain held; check the status again." }, 500);
      if (["success", "failed", "reversed"].includes(status)) {
        const { data: settled, error: settleError } = await admin.rpc("settle_withdrawal_transfer_event", {
          p_reference: snapshot.reference,
          p_transfer_code: String(transfer?.transfer_code || snapshot.transfer_code || "") || null,
          p_paystack_status: status,
          p_reason: String(transfer?.reason || transfer?.failures || "") || null,
          p_event_key: `verify:${snapshot.reference}:${status}`,
          p_payload: transfer || {},
        });
        if (settleError) return json({ success: false, error: settleError.message }, 500);
        return json({ success: true, status: settled?.status || status, paystack_status: status });
      }
      return json({ success: true, status: "processing", paystack_status: status, approval_required: status === "otp" });
    }

    return json({ success: false, error: "Unknown payout action" }, 400);
  } catch (error) {
    console.error("payout-withdrawal unhandled", { error: errorMessage(error, "unknown") });
    return json({ success: false, error: "Payout request failed. Please try again." }, 500);
  }
});
