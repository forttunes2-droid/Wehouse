import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createEncryptionIdentity,
  encryptionIdentityStatus,
  unlockEncryptionIdentity,
} from "@/lib/e2ee";

export default function SecureMessagesPanel() {
  const [enabled, setEnabled] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const result = await encryptionIdentityStatus();
    if (result.error) toast.error(result.error.message);
    setEnabled(result.enabled);
    setUnlocked(result.unlocked);
  }
  useEffect(() => void refresh(), []);
  async function submit() {
    if (!/^\d{6}$/.test(pin)) return toast.error("Enter a 6-digit Recovery PIN");
    if (!enabled && pin !== confirmPin) return toast.error("The PINs do not match");
    setBusy(true);
    try {
      if (enabled) await unlockEncryptionIdentity(pin);
      else await createEncryptionIdentity(pin);
      setPin("");
      setConfirmPin("");
      toast.success(enabled ? "Private messages unlocked" : "End-to-end encryption enabled");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Secure messaging could not be updated");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-2xl border border-white/[.07] bg-[#11141C] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Private chat encryption</p>
          <p className="mt-1 text-[10px] leading-5 text-[#7B8191]">
            Roommate and service-worker chats are end-to-end encrypted. Reservation Desk and Support remain operational conversations so authorized WeHouse staff can assist.
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[8px] font-semibold ${enabled ? "bg-emerald-500/10 text-emerald-300" : "bg-white/[.05] text-[#7D8292]"}`}>
          {enabled ? (unlocked ? "UNLOCKED" : "LOCKED") : "OFF"}
        </span>
      </div>
      <div className="mt-4 space-y-2">
        <label className="block">
          <span className="mb-1 block text-[9px] text-[#747A8B]">{enabled ? "Recovery PIN" : "Create a 6-digit Recovery PIN"}</span>
          <input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" type="password" autoComplete="off" className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-sm tracking-[.35em] outline-none focus:border-violet-500/40" />
        </label>
        {!enabled && (
          <label className="block">
            <span className="mb-1 block text-[9px] text-[#747A8B]">Confirm Recovery PIN</span>
            <input value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" type="password" autoComplete="off" className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-sm tracking-[.35em] outline-none focus:border-violet-500/40" />
          </label>
        )}
      </div>
      <button type="button" disabled={busy || unlocked} onClick={() => void submit()} className="mt-3 min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-45">
        {busy ? "Securing…" : unlocked ? "Private messages unlocked" : enabled ? "Unlock private messages" : "Enable secure messages"}
      </button>
      <p className="mt-3 text-[9px] leading-4 text-[#626879]">
        The six-digit PIN unlocks an encrypted backup of your private messaging key on a new device. WeHouse stores only the encrypted backup, not the PIN or readable key. If you forget the PIN, old encrypted messages cannot be recovered.
      </p>
    </section>
  );
}
