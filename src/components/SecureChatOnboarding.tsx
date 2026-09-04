import { useState } from "react";
import { toast } from "sonner";
import {
  createEncryptionIdentity,
  unlockEncryptionIdentity,
  type PrivateConversationReadiness,
} from "@/lib/e2ee";

type Props = {
  status: PrivateConversationReadiness;
  personName: string;
  onReady: () => void;
};

export default function SecureChatOnboarding({ status, personName, onReady }: Props) {
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = status.state === "setup_required" || status.state === "unlock_required";
  const creating = status.state === "setup_required";

  async function continueToChat() {
    if (!/^\d{6}$/.test(pin)) return toast.error("Enter a 6-digit Recovery PIN");
    if (creating && pin !== confirmation) return toast.error("The PINs do not match");
    setBusy(true);
    try {
      if (creating) await createEncryptionIdentity(pin);
      else await unlockEncryptionIdentity(pin);
      setPin("");
      setConfirmation("");
      onReady();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Private chat could not be unlocked");
    } finally {
      setBusy(false);
    }
  }

  return <section className="overflow-hidden rounded-2xl border border-violet-500/20 bg-[#151522]">
    <div className="flex items-start gap-3 p-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-500/15 text-base" aria-hidden="true">⌾</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">{creating ? "Protect your private chats" : status.state === "unlock_required" ? "Unlock private chats" : status.state === "peer_setup_required" ? `Waiting for ${personName}` : "Secure chat unavailable"}</p>
        <p className="mt-1 text-[9px] leading-5 text-[#8D92A2]">{creating ? "Create one Recovery PIN before your first private message. You will use it to recover encrypted chats on another device." : status.state === "peer_setup_required" ? `${personName} will be asked to protect private chats when they open this conversation.` : status.message}</p>
      </div>
    </div>
    {mine ? <div className="border-t border-white/[.06] p-4 pt-3">
      <div className={`grid gap-2 ${creating ? "grid-cols-2" : "grid-cols-1"}`}>
        <PinInput label={creating ? "Create PIN" : "Recovery PIN"} value={pin} onChange={setPin}/>
        {creating ? <PinInput label="Confirm PIN" value={confirmation} onChange={setConfirmation}/> : null}
      </div>
      <button type="button" disabled={busy} onClick={() => void continueToChat()} className="mt-3 min-h-11 w-full rounded-xl bg-violet-500 text-[11px] font-semibold disabled:opacity-45">{busy ? "Securing chat…" : creating ? "Protect and continue" : "Unlock and continue"}</button>
      <p className="mt-2 text-center text-[8px] leading-4 text-[#626879]">WeHouse cannot read private roommate or worker messages.</p>
    </div> : <div className="border-t border-white/[.06] p-3">
      <button type="button" onClick={onReady} className="min-h-10 w-full rounded-xl border border-white/[.08] text-[10px] font-semibold text-violet-300">Check again</button>
    </div>}
  </section>;
}

function PinInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label><span className="mb-1 block text-[8px] font-medium text-[#777D8D]">{label}</span><input value={value} onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" type="password" autoComplete="off" aria-label={label} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#0F1118] px-3 text-center text-sm tracking-[.3em] outline-none focus:border-violet-500/45"/></label>;
}
