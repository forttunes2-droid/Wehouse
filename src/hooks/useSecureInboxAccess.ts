import { useCallback, useEffect, useState } from "react";
import {
  encryptionIdentityStatus,
  rememberPrivateMessagingProfile,
  type PrivateConversationReadiness,
} from "@/lib/e2ee";

export default function useSecureInboxAccess(profileId: string) {
  const [status, setStatus] =
    useState<PrivateConversationReadiness | null>(null);

  const refresh = useCallback(async () => {
    rememberPrivateMessagingProfile(profileId);
    const identity = await encryptionIdentityStatus();
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
              "Create your recovery passcode before opening private messages.",
          }
        : !identity.unlocked
          ? {
              state: "unlock_required",
              message:
                "Unlock private messages with your recovery passcode on this device.",
            }
          : { state: "ready", message: "Private messages unlocked" };
    setStatus(next);
    return next;
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, refresh };
}
