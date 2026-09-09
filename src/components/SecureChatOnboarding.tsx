import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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

  if (mine) {
    return createPortal(
      <div
        className="fixed inset-0 z-[100080] flex items-end justify-center bg-black/70 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-passcode-title"
      >
        <section className="w-full max-w-md rounded-[28px] border border-white/[.08] bg-[#131720] p-5 shadow-2xl sm:p-6">
          <span
            className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/12 text-violet-300"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-5 w-5"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <rect x="5" y="10" width="14" height="10" rx="3" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          <h2
            id="recovery-passcode-title"
            className="mt-4 text-center text-lg font-bold"
          >
            {creating
              ? confirming
                ? "Confirm your passcode"
                : "Create a recovery passcode"
              : "Enter your passcode"}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-center text-[11px] leading-5 text-[#9298A8]">
            {creating
              ? confirming
                ? "Enter the same six digits again."
                : "Use six digits you will remember. You will need them when you open messages on a new device."
              : "Unlock your messages on this device with the six digits you created."}
          </p>
          <div className="mx-auto mt-5 max-w-xs">
            <PinInput
              label={
                creating
                  ? confirming
                    ? "Confirm passcode"
                    : "New passcode"
                  : "Recovery passcode"
              }
              value={creating && confirming ? confirmation : pin}
              onChange={creating && confirming ? setConfirmation : setPin}
              onEnter={() => void continueToChat()}
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void continueToChat()}
            className="mt-5 min-h-12 w-full rounded-2xl bg-violet-500 text-[12px] font-semibold shadow-[0_8px_24px_rgba(139,92,246,.22)] disabled:opacity-45"
          >
            {busy
              ? "Please wait…"
              : creating
                ? confirming
                  ? "Finish setup"
                  : "Continue"
                : "Continue"}
          </button>
          {creating && confirming ? (
            <button
              type="button"
              onClick={() => {
                setConfirmation("");
                setConfirming(false);
              }}
              className="mt-2 min-h-10 w-full text-[10px] font-medium text-[#8A90A0]"
            >
              Use different digits
            </button>
          ) : null}
        </section>
      </div>,
      document.body,
    );
  }

  return (
    <section className="rounded-2xl border border-white/[.07] bg-[#11141C] p-3 shadow-[0_12px_35px_rgba(0,0,0,.22)]">
      <div className="flex items-start gap-2.5">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/12 text-violet-300"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-4 w-4"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <rect x="5" y="10" width="14" height="10" rx="3" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">
            {status.state === "peer_setup_required"
              ? `Waiting for ${personName}`
              : "Messages are temporarily unavailable"}
          </p>
          <p className="mt-1 text-[9px] leading-4 text-[#8D92A2]">
            {status.state === "peer_setup_required"
              ? `${personName} will be asked to protect private chats when they open this conversation.`
              : status.message}
          </p>
        </div>
      </div>
      <div className="mt-3 border-t border-white/[.06] pt-3">
        <button
          type="button"
          onClick={onReady}
          className="min-h-10 w-full rounded-xl border border-white/[.08] text-[10px] font-semibold text-violet-300"
        >
          Check again
        </button>
      </div>
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
  return (
    <label className="block">
      <span className="mb-3 block text-center text-[9px] font-semibold text-[#9AA0AF]">
        {label}
      </span>
      <span className="relative block">
        <span className="grid grid-cols-6 gap-2" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => {
            const filled = index < value.length;
            const active = index === value.length && value.length < 6;
            return (
              <span
                key={index}
                className={`grid aspect-square place-items-center rounded-xl border text-lg transition ${
                  active
                    ? "border-violet-400 bg-violet-500/[.08] ring-4 ring-violet-500/10"
                    : filled
                      ? "border-white/[.14] bg-[#0B0E14]"
                      : "border-white/[.08] bg-[#0B0E14]"
                }`}
              >
                {filled ? "•" : ""}
              </span>
            );
          })}
        </span>
        <input
          autoFocus
          value={value}
          onChange={(event) =>
            onChange(event.target.value.replace(/\D/g, "").slice(0, 6))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") onEnter();
          }}
          inputMode="numeric"
          type="password"
          autoComplete="one-time-code"
          enterKeyHint="done"
          aria-label={label}
          className="absolute inset-0 h-full w-full cursor-text opacity-0"
        />
      </span>
      <span className="mt-3 block text-center text-[8px] leading-4 text-[#666D7E]">
        This protects private messages. It is not a property booking code.
      </span>
    </label>
  );
}
