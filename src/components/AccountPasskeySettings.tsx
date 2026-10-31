import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { isWebPasskeyEnabled, supabase } from "@/lib/supabase";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Passkey = {
  id: string;
  friendly_name?: string;
  created_at: string;
  last_used_at?: string;
};

export default function AccountPasskeySettings() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(isWebPasskeyEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<boolean | null>(null);
  const [passkeyToRemove, setPasskeyToRemove] = useState<Passkey | null>(null);

  const load = useCallback(async () => {
    if (!isWebPasskeyEnabled) return;
    setLoading(true);
    setError("");
    try {
      const [{ data: rows, error: listError }, { data: userData, error: userError }] = await Promise.all([
        supabase.auth.passkey.list(),
        supabase.auth.getUser(),
      ]);
      if (listError) throw listError;
      if (userError) throw userError;
      setPasskeys((rows || []) as Passkey[]);
      // The first-time-device confirmation path is email based. Keep passkey
      // enrollment aligned with that recovery path until phone confirmation is
      // supported end to end.
      setConfirmed(Boolean(userData.user?.email_confirmed_at));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Passkeys could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function addPasskey() {
    if (!isWebPasskeyEnabled || !confirmed || busy) return;
    setBusy(true);
    try {
      const { error: registerError } = await supabase.auth.registerPasskey();
      if (registerError) throw registerError;
      toast.success("Passkey added to your account");
      await load();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Passkey could not be added.");
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(passkey: Passkey) {
    if (busy) return;
    setBusy(true);
    try {
      const { error: deleteError } = await supabase.auth.passkey.delete({ passkeyId: passkey.id });
      if (deleteError) throw deleteError;
      setPasskeys(current => current.filter(item => item.id !== passkey.id));
      setPasskeyToRemove(null);
      toast.success("Passkey removed");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Passkey could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  if (!isWebPasskeyEnabled) return null;

  return (
    <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Passkeys</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--wh-text-secondary)]">
            Sign in with your device or password manager. Keep another sign-in or recovery method available.
          </p>
        </div>
        <button type="button" disabled={busy || loading || !confirmed} onClick={() => void addPasskey()} className="min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-500">
          {busy ? "Working…" : "Add a passkey"}
        </button>
      </div>
      {confirmed === false && <p className="mt-3 text-xs text-[var(--wh-text-secondary)]">Confirm your email before adding a passkey. WeHouse uses it to confirm a sign-in from a new device.</p>}
      {loading ? <p className="mt-4 text-sm text-[var(--wh-text-secondary)]">Loading passkeys…</p> : error ? <div className="mt-4 text-sm"><p role="alert" className="text-red-600 dark:text-red-300">Passkeys could not be loaded. Check that passkeys are enabled for this WeHouse sign-in service.</p><button type="button" onClick={() => void load()} className="mt-2 min-h-10 rounded-lg px-2 text-sm font-semibold text-violet-700 underline dark:text-violet-300">Try again</button></div> : passkeys.length === 0 ? <p className="mt-4 text-sm text-[var(--wh-text-secondary)]">No passkeys added yet.</p> : (
        <ul className="mt-4 divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
          {passkeys.map(passkey => <li key={passkey.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{passkey.friendly_name || "Passkey"}</p>
              <p className="mt-1 text-xs text-[var(--wh-text-secondary)]">Added {new Date(passkey.created_at).toLocaleDateString()}{passkey.last_used_at ? ` · Used ${new Date(passkey.last_used_at).toLocaleDateString()}` : ""}</p>
            </div>
            <button type="button" disabled={busy} onClick={() => setPasskeyToRemove(passkey)} className="min-h-10 rounded-lg border border-[var(--wh-border-subtle)] px-3 text-sm font-medium text-[var(--wh-text-secondary)] disabled:opacity-50">Remove</button>
          </li>)}
        </ul>
      )}
      <AlertDialog open={Boolean(passkeyToRemove)} onOpenChange={(open) => { if (!open && !busy) setPasskeyToRemove(null); }}>
        <AlertDialogContent className="border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] text-[var(--wh-text)]">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this passkey?</AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--wh-text-secondary)]">
              You will no longer be able to sign in with {passkeyToRemove?.friendly_name || "this passkey"}. Keep another sign-in or recovery method available.
              {' '}This does not remove an encrypted chat backup or delete the passkey from your device. Manage chat recovery in Private chat encryption before deleting a backup passkey from your password manager.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} className="min-h-11">Keep passkey</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                if (passkeyToRemove) void removePasskey(passkeyToRemove);
              }}
              className="min-h-11 bg-red-600 text-white hover:bg-red-700"
            >
              {busy ? "Removing…" : "Remove passkey"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
