import { useCallback, useEffect, useState } from "react";
import { getStoredSessionId, supabase } from "@/lib/supabase";
import type { Profile } from "@/types";

type LoginAlert = {
  notificationId: string;
  sessionId: string;
  device: string;
  os: string;
  browser: string;
  location: string;
  loginTime: string;
};

export default function NewLoginAlert({ profile }: { profile: Profile }) {
  const [alert, setAlert] = useState<LoginAlert | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const currentSessionId = getStoredSessionId();
    const { data } = await supabase
      .from("notifications")
      .select("id,source_id,created_at,destination_params")
      .eq("recipient_id", profile.user_id)
      .eq("type", "new_device_login")
      .eq("read", false)
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(12);

    const row = (data || []).find((item) => {
      const params = (item.destination_params || {}) as Record<string, unknown>;
      const sessionId = String(params.session_id || item.source_id || "");
      const decision = String(params.decision || "");
      return sessionId && sessionId !== currentSessionId && ["unreviewed", "verified_with_google"].includes(decision);
    });
    if (!row) return setAlert(null);

    const params = (row.destination_params || {}) as Record<string, unknown>;
    const sessionId = String(params.session_id || row.source_id || "");
    const { data: session } = await supabase
      .from("user_sessions")
      .select("device,os,browser,login_time,is_active")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session?.is_active) {
      await supabase.rpc("mark_my_notification_read", { p_notification_id: row.id });
      return void load();
    }
    setError("");
    setAlert({
      notificationId: row.id,
      sessionId,
      device: String(session.device || params.device || "Unknown device"),
      os: String(session.os || params.os || "Unknown system"),
      browser: String(session.browser || params.browser || "Unknown browser"),
      location: String(params.location || "Location unavailable"),
      loginTime: String(session.login_time || params.login_time || row.created_at),
    });
  }, [profile.user_id]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`new-login-alert:${profile.user_id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${profile.user_id}` }, () => void load())
      .subscribe();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      void supabase.removeChannel(channel);
    };
  }, [load, profile.user_id]);

  async function answer(wasMe: boolean) {
    if (!alert || busy) return;
    setBusy(true);
    setError("");
    const { error: reviewError } = await supabase.rpc("review_new_device_login", {
      p_session_id: alert.sessionId,
      p_was_me: wasMe,
    });
    setBusy(false);
    if (reviewError) {
      setError("We couldn't update this login. Check your connection and try again.");
      return;
    }
    setAlert(null);
    void load();
  }

  if (!alert) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-amber-400/15 bg-amber-300/[.055] text-white" role="alert" aria-labelledby="new-login-title" aria-describedby="new-login-description">
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-300/10 text-amber-200"><DeviceShieldIcon /></div>
        <div className="min-w-0 flex-1">
          <h2 id="new-login-title" className="text-sm font-semibold">Someone signed in to your account</h2>
          <p id="new-login-description" className="mt-1 text-[10px] leading-4 text-[#A4A7B0]">
            {alert.device} · {alert.os} · {alert.browser} · {alert.location}. Was this you?
          </p>
          <p className="mt-1 text-[8px] text-[#686E7E]">{new Date(alert.loginTime).toLocaleString()}</p>
        </div>
      </div>
      {error && <p className="mx-4 mb-3 rounded-xl bg-red-500/10 px-3 py-2 text-[10px] text-red-300">{error}</p>}
      <div className="grid grid-cols-2 border-t border-white/[.06]">
        <button onClick={() => void answer(true)} disabled={busy} className="min-h-11 text-[11px] font-semibold text-emerald-300 disabled:opacity-40">{busy ? "Checking…" : "Yes, it’s me"}</button>
        <button onClick={() => void answer(false)} disabled={busy} className="min-h-11 border-l border-white/[.06] text-[11px] font-semibold text-red-300 disabled:opacity-40">No, it’s not me</button>
      </div>
    </section>
  );
}

function DeviceShieldIcon() {
  return <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="16" rx="2"/><path d="M10 15h4M12 22s5-2.4 5-6v-2l-5-2-5 2v2c0 3.6 5 6 5 6Z"/></svg>;
}
