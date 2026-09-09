import { useEffect, useRef, useState, type CSSProperties } from "react";
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

export default function SecureChatOnboarding({
  status,
  personName,
  onReady,
}: Props) {
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const mine =
    status.state === "setup_required" || status.state === "unlock_required";
  const creating = status.state === "setup_required";

  useEffect(() => {
    setPin("");
    setConfirmation("");
    setConfirming(false);
  }, [status.state]);

  async function continueToChat() {
    if (!/^\d{6}$/.test(pin))
      return toast.error("Enter your 6-digit recovery passcode");
    if (creating && !confirming) {
      setConfirming(true);
      return;
    }
    if (creating && !/^\d{6}$/.test(confirmation))
      return toast.error("Confirm your 6-digit recovery passcode");
    if (creating && pin !== confirmation)
      return toast.error("Those passcodes do not match");
    setBusy(true);
    try {
      if (creating) await createEncryptionIdentity(pin);
      else await unlockEncryptionIdentity(pin);
      setPin("");
      setConfirmation("");
      onReady();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Private chat could not be unlocked",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/[.07] bg-[#11141C] p-3 shadow-[0_12px_35px_rgba(0,0,0,.22)]">
      <div className="flex items-start gap-2.5">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/12 text-violet-300"
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="10" width="14" height="10" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">
            {creating
              ? "Protect your private chats"
              : status.state === "unlock_required"
                ? "Unlock private chats"
                : status.state === "peer_setup_required"
                  ? `Waiting for ${personName}`
                  : "Secure chat unavailable"}
          </p>
          <p className="mt-1 text-[9px] leading-4 text-[#8D92A2]">
            {creating
              ? confirming
                ? "Enter it once more to make sure you can recover this chat."
                : "Choose a 6-digit recovery passcode for private chats on this and new devices."
              : status.state === "peer_setup_required"
                ? `${personName} will be asked to protect private chats when they open this conversation.`
                : status.message}
          </p>
        </div>
      </div>
      {mine ? (
        <div className="mt-3 border-t border-white/[.06] pt-3">
          <div className="mx-auto max-w-xs">
            <PinInput
              label={creating ? (confirming ? "Confirm recovery passcode" : "New recovery passcode") : "Recovery passcode"}
              value={creating && confirming ? confirmation : pin}
              onChange={creating && confirming ? setConfirmation : setPin}
              onEnter={() => void continueToChat()}
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void continueToChat()}
            className="mt-3 min-h-11 w-full rounded-xl bg-violet-500 text-[11px] font-semibold shadow-[0_8px_24px_rgba(139,92,246,.18)] disabled:opacity-45"
          >
            {busy
              ? "Securing chat…"
              : creating
                ? confirming ? "Protect chat" : "Continue"
                : "Unlock and continue"}
          </button>
          {creating && confirming ? <button type="button" onClick={() => { setConfirmation(""); setConfirming(false); }} className="mt-2 w-full py-1 text-[9px] font-medium text-[#858B9B]">Use a different passcode</button> : null}
        </div>
      ) : (
        <div className="mt-3 border-t border-white/[.06] pt-3">
          <button
            type="button"
            onClick={onReady}
            className="min-h-10 w-full rounded-xl border border-white/[.08] text-[10px] font-semibold text-violet-300"
          >
            Check again
          </button>
        </div>
      )}
    </section>
  );
}

function PinInput({
  label,
  value,
  onChange,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <label className="block">
      <span className="mb-2 block text-center text-[8px] font-semibold uppercase tracking-[.16em] text-[#777D8D]">
        {label}
      </span>
      <span className="relative block" onClick={() => inputRef.current?.focus()}>
        <span className="grid grid-cols-6 gap-1.5" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className={`grid aspect-square max-h-11 place-items-center rounded-xl border bg-[#0B0E14] text-base transition ${index === value.length ? "border-violet-400/70 shadow-[0_0_0_2px_rgba(139,92,246,.08)]" : "border-white/[.08]"}`}>
              {index < value.length ? <span className="h-2 w-2 rounded-full bg-violet-300" /> : null}
            </span>
          ))}
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(event) => { if (event.key === "Enter") onEnter(); }}
          inputMode="numeric"
          type="text"
          autoComplete="off"
          enterKeyHint="done"
          style={{ WebkitTextSecurity: "disc" } as CSSProperties}
          aria-label={label}
          className="absolute inset-0 h-full w-full cursor-text opacity-0"
        />
      </span>
    </label>
  );
}
