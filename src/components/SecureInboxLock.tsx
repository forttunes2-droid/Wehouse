import SecureChatOnboarding from "@/components/SecureChatOnboarding";
import type { PrivateConversationReadiness } from "@/lib/e2ee";

export default function SecureInboxLock({
  status,
  onReady,
}: {
  status: PrivateConversationReadiness | null;
  onReady: () => void;
}) {
  return (
    <div className="grid min-h-[68dvh] place-items-center px-5 py-12 text-center text-white">
      <div className="max-w-sm">
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
          {status ? "Private messages are locked" : "Checking private messages…"}
        </h2>
        <p className="mt-2 text-[10px] leading-5 text-[#777E8F]">
          {status?.message || "This device must be checked before Inbox opens."}
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
