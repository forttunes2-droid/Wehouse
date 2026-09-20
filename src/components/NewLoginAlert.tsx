import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";

type LoginAlert = {
  notificationId: string;
  sessionId: string;
  device: string;
  os: string;
  browser: string;
  loginTime: string;
};

export default function NewLoginAlert({ profile }: { profile: Profile }) {
  const [alert, setAlert] = useState<LoginAlert | null>(null);
  const generation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const request = ++generation.current;
    const { data, error: loadError } = await supabase.rpc("get_my_pending_device_login_alert");
    if (request !== generation.current || loadError) return;
    setError("");
    setAlert(data as LoginAlert | null);
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
      generation.current += 1;
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

  if (!alert || typeof document === "undefined") return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100200] flex justify-center px-3 pt-[max(.75rem,env(safe-area-inset-top))]">
    <section className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border border-amber-400/15 bg-[#11141C] text-white shadow-2xl shadow-black/70" role="region" aria-live="polite" aria-labelledby="new-login-title" aria-describedby="new-login-description">
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-300/10 text-amber-200"><DeviceShieldIcon /></div>
        <div className="min-w-0 flex-1">
          <h2 id="new-login-title" className="text-sm font-semibold">Someone signed in to your account</h2>
          <p id="new-login-description" className="mt-1 text-xs leading-5 text-[#A4A7B0]">
            {alert.device} · {alert.browser}. Was this you?
          </p>
          <p className="mt-1 text-[11px] text-[#8B91A0]">{new Date(alert.loginTime).toLocaleString()}</p>
        </div>
      </div>
      {error && <p className="mx-4 mb-3 rounded-xl bg-red-500/10 px-3 py-2 text-[10px] text-red-300">{error}</p>}
      <div className="grid grid-cols-2 border-t border-white/[.06]">
        <button onClick={() => void answer(true)} disabled={busy} className="min-h-11 text-xs font-semibold text-emerald-300 disabled:opacity-40">{busy ? "Checking…" : "Yes, it’s me"}</button>
        <button onClick={() => void answer(false)} disabled={busy} className="min-h-11 border-l border-white/[.06] text-xs font-semibold text-red-300 disabled:opacity-40">No, it’s not me</button>
      </div>
    </section>
    </div>,
    document.body,
  );
}

function DeviceShieldIcon() {
  return <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="16" rx="2"/><path d="M10 15h4M12 22s5-2.4 5-6v-2l-5-2-5 2v2c0 3.6 5 6 5 6Z"/></svg>;
}
