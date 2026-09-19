// These public identifiers define the production boundary, not credentials.
const PRODUCTION_BACKEND = "https://rkrhnkhppeihvmuwvsvn.supabase.co";
const PRODUCTION_HOSTS = new Set(["wehouse.com.ng", "www.wehouse.com.ng"]);

export function resolvePaymentReturnUrl(
  backendUrl: string,
  configuredAppUrl: string | undefined,
  paystackKey: string,
  destination: "payment-return" | "worker_dashboard",
): string | null {
  // The destination must come from server configuration, never request headers
  // or a caller-supplied URL. Missing preview configuration must fail closed.
  if (!configuredAppUrl || !/^sk_(test|live)_/.test(paystackKey)) return null;
  const production = backendUrl.replace(/\/$/, "") === PRODUCTION_BACKEND;
  if (!production && !paystackKey.startsWith("sk_test_")) return null;
  try {
    const app = new URL(configuredAppUrl.trim());
    if (app.protocol !== "https:" || app.username || app.password || app.port ||
        app.pathname !== "/" || app.search || app.hash) return null;
    if (PRODUCTION_HOSTS.has(app.hostname) !== production) return null;
    return `${app.origin}/#${destination}`;
  } catch {
    return null;
  }
}
