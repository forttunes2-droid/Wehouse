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
    <div className="fixed inset-0 z-[180] flex items-end justify-center bg-black/70 px-3 pb-3 backdrop-blur-sm sm:items-center" role="presentation">
      <section className="w-full max-w-sm overflow-hidden rounded-[28px] border border-white/[.09] bg-[#12141B] text-white shadow-2xl" role="alertdialog" aria-modal="true" aria-labelledby="new-login-title" aria-describedby="new-login-description">
        <div className="px-5 pb-4 pt-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-violet-500/12 text-violet-300"><DeviceShieldIcon /></div>
          <p className="mt-4 text-[9px] font-bold uppercase tracking-[.2em] text-violet-300">Security alert</p>
          <h2 id="new-login-title" className="mt-2 text-xl font-bold">New login to your account</h2>
          <p id="new-login-description" className="mx-auto mt-2 max-w-xs text-[11px] leading-5 text-[#8B91A0]">A new device signed in. Was this you?</p>
        </div>
        <div className="mx-5 divide-y divide-white/[.06] border-y border-white/[.06]">
          <Detail label="Device" value={alert.device} />
          <Detail label="System" value={`${alert.os} · ${alert.browser}`} />
          <Detail label="Near" value={alert.location} />
          <Detail label="Time" value={new Date(alert.loginTime).toLocaleString()} />
        </div>
        {error && <p className="mx-5 mt-4 rounded-xl bg-red-500/10 px-3 py-2 text-center text-[10px] text-red-300">{error}</p>}
        <div className="grid grid-cols-2 gap-3 p-5">
          <button onClick={() => void answer(false)} disabled={busy} className="min-h-12 rounded-2xl border border-red-500/20 bg-red-500/[.07] px-3 text-[11px] font-semibold text-red-300 disabled:opacity-40">Not me</button>
          <button onClick={() => void answer(true)} disabled={busy} className="min-h-12 rounded-2xl bg-violet-500 px-3 text-[11px] font-semibold disabled:opacity-40">{busy ? "Checking…" : "Yes, it was me"}</button>
        </div>
        <p className="px-6 pb-5 text-center text-[9px] leading-4 text-[#686E7E]">Choosing “Not me” signs that device out.</p>
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="flex min-h-11 items-center justify-between gap-5 py-2"><span className="text-[9px] text-[#697080]">{label}</span><strong className="text-right text-[10px] font-semibold text-[#D7DAE3]">{value}</strong></div>;
}

function DeviceShieldIcon() {
  return <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="16" rx="2"/><path d="M10 15h4M12 22s5-2.4 5-6v-2l-5-2-5 2v2c0 3.6 5 6 5 6Z"/></svg>;
}
