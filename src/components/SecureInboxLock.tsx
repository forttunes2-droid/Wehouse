import SecureChatOnboarding from "@/components/SecureChatOnboarding";
import type { PrivateConversationReadiness } from "@/lib/e2ee";
import BackButton from "@/components/BackButton";

export default function SecureInboxLock({
  status,
  onReady,
  onBack,
}: {
  status: PrivateConversationReadiness | null;
  onReady: () => void;
  onBack?: () => void;
}) {
  return (
    <div className="grid min-h-[68dvh] place-items-center px-5 py-12 text-center text-[var(--wh-text)]">
      <div className="max-w-sm">
        {onBack && status !== null && <BackButton onClick={onBack} ariaLabel="Back to Inbox" className="mx-auto mb-6" />}
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/12 text-violet-300">
          {status ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-5 w-5"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <rect x="5" y="10" width="14" height="10" rx="3" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          ) : (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
          )}
        </span>
        <h2 className="mt-4 text-base font-bold">
          {status ? "Encrypted chat is locked" : "Checking encrypted chat…"}
        </h2>
        <p className="mt-2 text-[10px] leading-5 text-[var(--wh-text-muted)]">
          {status?.message || "Checking this device before opening the encrypted conversation."}
        </p>
      </div>
      {status && status.state !== "ready" ? (
        <SecureChatOnboarding
          status={status}
          personName="your conversations"
          onReady={onReady}
        />
      ) : null}
    </div>
  );
}
