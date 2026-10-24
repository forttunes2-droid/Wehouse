import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { signInWithGoogle } from "@/lib/supabase/auth";

type Props = { open: boolean; email: string; onVerified: () => void; onCancel: () => void };

// Money leaves WeHouse only after a fresh sign-in. Password accounts re-enter the password;
// Google or Apple accounts sign in with their provider again. The server enforces the same freshness.
export default function WithdrawalConfirmDialog({ open, email, onVerified, onCancel }: Props) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const verified = useRef(onVerified);
  useEffect(() => {
    verified.current = onVerified;
  });
  const [mode, setMode] = useState<"checking" | "password" | "provider">("checking");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPassword("");
    setError("");
    setMode("checking");
    void supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      const providers: string[] = data.user?.app_metadata?.providers ?? [];
      if (providers.includes("email")) return setMode("password");
      const last = data.user?.last_sign_in_at ? Date.parse(data.user.last_sign_in_at) : 0;
      if (Date.now() - last < 8 * 60 * 1000) return verified.current();
      setMode("provider");
    });
    return () => {
      alive = false;
    };
  }, [open]);

  if (!open || mode === "checking") return null;

  async function confirmPassword() {
    if (!password) return setError("Enter your password");
    setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInError) return setError("That password is not correct");
    setPassword("");
    verified.current();
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Confirm withdrawal">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5">
        <h2 className="text-sm font-semibold text-[var(--wh-text)]">Confirm it is you</h2>
        {mode === "password" ? (
          <>
            <p className="mt-1 text-[11px] leading-5 text-[var(--wh-text-muted)]">Enter your WeHouse password to send this withdrawal.</p>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void confirmPassword()}
              className="mt-3 h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-xs outline-none focus:border-violet-500/40"
              aria-label="Password"
            />
          </>
        ) : (
          <p className="mt-1 text-[11px] leading-5 text-[var(--wh-text-muted)]">For your safety, sign in with Google again, then repeat the withdrawal.</p>
        )}
        {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button onClick={onCancel} className="flex-1 rounded-xl border border-[var(--wh-border-subtle)] px-4 py-3 text-xs font-semibold text-[var(--wh-text-secondary)]">Cancel</button>
          {mode === "password" ? (
            <button onClick={() => void confirmPassword()} disabled={busy} className="flex-1 rounded-xl bg-violet-500 px-4 py-3 text-xs font-semibold text-white disabled:opacity-60">{busy ? "Checking…" : "Confirm"}</button>
          ) : (
            <button onClick={() => void signInWithGoogle(email)} className="flex-1 rounded-xl bg-violet-500 px-4 py-3 text-xs font-semibold text-white">Sign in again</button>
          )}
        </div>
      </div>
    </div>
  );
}
