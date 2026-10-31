import { useCallback, useEffect, useRef, useState } from "react";
import {
  encryptionIdentityStatus,
  onPrivateMessageAccessChange,
  rememberPrivateMessagingProfile,
  type PrivateConversationReadiness,
} from "@/lib/e2ee";

export default function useSecureInboxAccess(profileId: string, enabled = true) {
  const [access, setAccess] = useState<{
    profileId: string;
    status: PrivateConversationReadiness;
  } | null>(null);
  const generation = useRef(0);
  const status = enabled && access?.profileId === profileId ? access.status : null;

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    rememberPrivateMessagingProfile(profileId);
    const identity = await encryptionIdentityStatus().catch(reason=>({enabled:false,unlocked:false,error:{message:reason instanceof Error?reason.message:'Private chats could not be checked. Try again.'}}));
    const next: PrivateConversationReadiness = identity.error
      ? {
          state: "unavailable",
          message:
            identity.error.message || "Private messages could not be checked",
        }
      : !identity.enabled
        ? {
            state: "setup_required",
            message:
              "Set up private chats before opening private messages.",
          }
        : !identity.unlocked
          ? {
              state: "unlock_required",
              message:
                "Restore your chat backup or continue without previous history on this device.",
            }
          : { state: "ready", message: "Private messages unlocked" };
    if (request === generation.current) setAccess({ profileId, status: next });
    return next;
  }, [profileId]);

  useEffect(() => {
    if (enabled) void refresh();
    else setAccess(null);
    return () => { generation.current += 1; };
  }, [enabled, refresh]);

  useEffect(() => enabled ? onPrivateMessageAccessChange(() => void refresh()) : undefined, [enabled, refresh]);

  return { status, refresh };
}
