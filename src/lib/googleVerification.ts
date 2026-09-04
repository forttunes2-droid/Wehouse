export type GoogleVerificationContext = "signup" | "password_recovery" | "new_device";
export type GoogleVerificationRole = "user" | "worker" | "property_partner";

export type GoogleVerificationTransaction = {
  context: GoogleVerificationContext;
  email: string;
  role?: GoogleVerificationRole;
  pendingDeviceSessionId?: string;
  device?: string;
  os?: string;
  browser?: string;
  location?: string;
  createdAt: number;
};

const TRANSACTION_KEY = "wh_google_verification";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isContext(value: unknown): value is GoogleVerificationContext {
  return value === "signup" || value === "password_recovery" || value === "new_device";
}

function syncLegacy(transaction: GoogleVerificationTransaction | null) {
  try {
    if (!transaction) {
      sessionStorage.removeItem("wh_google_verify_context");
      sessionStorage.removeItem("wh_google_verify_email");
      sessionStorage.removeItem("wh_google_verify_role");
      sessionStorage.removeItem("wh_pending_device_session");
      return;
    }
    sessionStorage.setItem("wh_google_verify_context", transaction.context);
    sessionStorage.setItem("wh_google_verify_email", transaction.email);
    if (transaction.role) sessionStorage.setItem("wh_google_verify_role", transaction.role);
    else sessionStorage.removeItem("wh_google_verify_role");
    if (transaction.pendingDeviceSessionId)
      sessionStorage.setItem("wh_pending_device_session", transaction.pendingDeviceSessionId);
  } catch {}
}

export function saveGoogleVerification(
  input: Omit<GoogleVerificationTransaction, "createdAt"> & { createdAt?: number },
) {
  const transaction: GoogleVerificationTransaction = {
    ...input,
    email: input.email.trim().toLowerCase(),
    createdAt: input.createdAt || Date.now(),
  };
  try { localStorage.setItem(TRANSACTION_KEY, JSON.stringify(transaction)); } catch {}
  syncLegacy(transaction);
  return transaction;
}

export function readGoogleVerification(): GoogleVerificationTransaction | null {
  try {
    const raw = localStorage.getItem(TRANSACTION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GoogleVerificationTransaction>;
      if (
        isContext(parsed.context) &&
        typeof parsed.email === "string" &&
        typeof parsed.createdAt === "number" &&
        Date.now() - parsed.createdAt <= MAX_AGE_MS
      ) {
        const transaction = parsed as GoogleVerificationTransaction;
        syncLegacy(transaction);
        return transaction;
      }
      localStorage.removeItem(TRANSACTION_KEY);
    }
  } catch {}

  // One release of backward compatibility for verification attempts that began
  // before the durable transaction was introduced.
  try {
    const context = sessionStorage.getItem("wh_google_verify_context");
    const email = sessionStorage.getItem("wh_google_verify_email") || "";
    if (!isContext(context) || !email) return null;
    return saveGoogleVerification({
      context,
      email,
      role: (sessionStorage.getItem("wh_google_verify_role") || undefined) as GoogleVerificationRole | undefined,
      pendingDeviceSessionId: sessionStorage.getItem("wh_pending_device_session") || undefined,
    });
  } catch {
    return null;
  }
}

export function clearGoogleVerification() {
  try { localStorage.removeItem(TRANSACTION_KEY); } catch {}
  syncLegacy(null);
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
