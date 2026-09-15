export type GoogleVerificationContext = "signup" | "password_recovery" | "new_device";
export type GoogleVerificationRole = "user" | "worker" | "property_partner";

export type GoogleVerificationTransaction = {
  context: GoogleVerificationContext;
  email: string;
  identifier?: string;
  recoveryAttemptId?: string;
  role?: GoogleVerificationRole;
  pendingDeviceSessionId?: string;
  device?: string;
  os?: string;
  browser?: string;
  location?: string;
  createdAt: number;
};

const TRANSACTION_KEY = "wh_google_verification";
export const PASSWORD_RECOVERY_MAX_AGE_MS = 10 * 60 * 1000;
const OTHER_VERIFICATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function maximumAge(context: GoogleVerificationContext) {
  return context === "password_recovery"
    ? PASSWORD_RECOVERY_MAX_AGE_MS
    : OTHER_VERIFICATION_MAX_AGE_MS;
}

function isContext(value: unknown): value is GoogleVerificationContext {
  return value === "signup" || value === "password_recovery" || value === "new_device";
}

export function saveGoogleVerification(
  input: Omit<GoogleVerificationTransaction, "createdAt"> & { createdAt?: number },
) {
  const transaction: GoogleVerificationTransaction = {
    ...input,
    email: input.email.trim().toLowerCase(),
    identifier: input.identifier?.trim().toLowerCase(),
    createdAt: input.createdAt || Date.now(),
  };
  // Recovery state is deliberately tab-scoped. Persistent browser storage
  // must not keep a reusable account-recovery transaction after the tab ends.
  try { sessionStorage.setItem(TRANSACTION_KEY, JSON.stringify(transaction)); } catch {}
  try { localStorage.removeItem(TRANSACTION_KEY); } catch {}
  return transaction;
}

export function readGoogleVerification(): GoogleVerificationTransaction | null {
  try {
    // Remove transactions created by the former 24-hour localStorage flow.
    try { localStorage.removeItem(TRANSACTION_KEY); } catch {}
    const raw = sessionStorage.getItem(TRANSACTION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GoogleVerificationTransaction>;
      if (
        isContext(parsed.context) &&
        typeof parsed.email === "string" &&
        typeof parsed.createdAt === "number" &&
        Date.now() - parsed.createdAt <= maximumAge(parsed.context)
      ) {
        return parsed as GoogleVerificationTransaction;
      }
      sessionStorage.removeItem(TRANSACTION_KEY);
    }
  } catch {}
  return null;
}

export function clearGoogleVerification() {
  try { sessionStorage.removeItem(TRANSACTION_KEY); } catch {}
  try { localStorage.removeItem(TRANSACTION_KEY); } catch {}
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("verify")) {
      url.searchParams.delete("verify");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {}
}

export function googleVerificationReturnContext(): GoogleVerificationContext | null {
  try {
    const value = new URLSearchParams(window.location.search).get("verify");
    return isContext(value) ? value : null;
  } catch {
    return null;
  }
}

export function verificationRedirectUrl(context?: GoogleVerificationContext) {
  const url = new URL("/", window.location.origin);
  if (context) url.searchParams.set("verify", context);
  return url.toString();
}
