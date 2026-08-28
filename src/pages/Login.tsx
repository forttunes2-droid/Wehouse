import { useEffect, useRef, useState } from "react";
import {
  supabase,
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  resetPassword,
  runDiagnostics,
  getProfileByAuthId,
} from "@/lib/supabase";
import { Input } from "@/components/ui/input";

type PublicRole = "user" | "worker" | "property_partner";
type Mode =
  | "waitlist"
  | "choose"
  | "choose_role"
  | "signin"
  | "signup"
  | "forgot"
  | "recover";
type PendingMethod = "authenticated" | "email" | null;
interface LoginProps {
  onLoginSuccess: (authId: string, email: string, role?: PublicRole) => void;
  serverError: string;
  kickedOut?: boolean;
}

function recoveryRequested() {
  try {
    return (
      new URLSearchParams(window.location.search).get("auth") === "recovery"
    );
  } catch {
    return false;
  }
}
function friendlyError(raw: string) {
  const msg = raw.toLowerCase();
  if (msg.includes("api key") || msg.includes("invalid key"))
    return "Authentication service is not configured correctly.";
  if (msg.includes("banned"))
    return "Your account has been permanently banned. Contact support for assistance.";
  if (msg.includes("suspended"))
    return "Your account has been suspended. Contact support for assistance.";
  if (msg.includes("deleted"))
    return "This account has been deleted. Contact support if you believe this is an error.";
  if (
    msg.includes("invalid login credentials") ||
    msg.includes("invalid credentials")
  )
    return "Invalid email or password. Please check and try again.";
  if (msg.includes("email not confirmed") || msg.includes("not confirmed"))
    return "Please confirm your email address before signing in.";
  if (msg.includes("already registered"))
    return "An account with this email already exists. Try signing in instead.";
  if (
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("connection")
  )
    return "Connection failed. Please check your internet and try again.";
  if (msg.includes("timeout")) return "Request timed out. Please try again.";
  if (
    msg.includes("password") &&
    (msg.includes("weak") || msg.includes("short"))
  )
    return "Password is too weak. Use at least 8 characters.";
  if (msg.includes("expired") || msg.includes("invalid token"))
    return "This reset link has expired. Request a new password reset link.";
  if (msg.includes("for security"))
    return "Too many attempts. Please wait a moment and try again.";
  return raw.length > 140 ? "Something went wrong. Please try again." : raw;
}
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), ms),
    ),
  ]);
}

export default function Login({
  onLoginSuccess,
  serverError,
  kickedOut,
}: LoginProps) {
  const [mode, setMode] = useState<Mode>(() =>
      recoveryRequested() ? "recover" : "waitlist",
    ),
    [waitlistOpen, setWaitlistOpen] = useState(false),
    [signupRole, setSignupRole] = useState<PublicRole>("user"),
    [pendingMethod, setPendingMethod] = useState<PendingMethod>(null),
    [email, setEmail] = useState(""),
    [fullName, setFullName] = useState(""),
    [phone, setPhone] = useState(""),
    [city, setCity] = useState(""),
    [budget, setBudget] = useState(""),
    [interest, setInterest] = useState("housing"),
    [password, setPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [info, setInfo] = useState(""),
    [diag, setDiag] = useState<string | null>(null),
    [recoveryReady, setRecoveryReady] = useState(false);
  const authenticatedIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    runDiagnostics().then((result) => {
      console.log("[WeHouse Diagnostics]", result);
      if (result.authTest !== "ok")
        setDiag(
          `Auth: ${result.authTest}${result.authError ? ` — ${result.authError}` : ""}`,
        );
    });
  }, []);

  useEffect(() => {
    if (mode !== "recover") return;
    let alive = true;
    async function check() {
      const { data } = await supabase.auth.getSession();
      if (alive) setRecoveryReady(Boolean(data.session?.user));
    }
    void check();
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!alive) return;
        if (
          event === "PASSWORD_RECOVERY" ||
          event === "SIGNED_IN" ||
          event === "INITIAL_SESSION"
        )
          setRecoveryReady(Boolean(session?.user));
      },
    );
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [mode]);

  // Only unaffiliated authenticated identities need role selection here. Existing
  // WeHouse profiles are routed by useAuth, not by this screen.
  useEffect(() => {
    if (mode === "recover" || recoveryRequested()) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (cancelled || !user) return;
      if (authenticatedIdentityRef.current === user.id) return;
      const { profile } = await getProfileByAuthId(user.id);
      if (cancelled || profile) return;
      authenticatedIdentityRef.current = user.id;
      const metadataRole = user.user_metadata?.signup_role as
        PublicRole | undefined;
      if (
        metadataRole &&
        ["user", "worker", "property_partner"].includes(metadataRole)
      ) {
        onLoginSuccess(user.id, user.email || "", metadataRole);
        return;
      }
      setPendingMethod("authenticated");
      setMode("choose_role");
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, onLoginSuccess]);

  const displayError = error || serverError;
  function clearMessages() {
    setError("");
    setInfo("");
  }
  async function handleEmail(e: React.FormEvent, isSignup: boolean) {
    e.preventDefault();
    clearMessages();
    const clean = email.trim();
    if (!clean.includes("@")) return setError("Enter a valid email address");
    if (password.length < 8)
      return setError("Password must be at least 8 characters");
    setWorking(true);
    try {
      if (isSignup) {
        const { data, error: err } = await withTimeout(
          signUpWithEmail(clean, password, signupRole),
          15000,
        );
        if (err) return setError(friendlyError(err.message));
        if (data.session?.user) {
          setInfo("Finishing your WeHouse account…");
          return;
        }
        if (data.user) {
          setInfo(
            "Account created. Check your email to confirm your address. Your selected account type has been saved.",
          );
          return;
        }
        setError("Signup incomplete. Please try again.");
      } else {
        const { data, error: err } = await withTimeout(
          signInWithEmail(clean, password),
          15000,
        );
        if (err) return setError(friendlyError(err.message));
        if (!data.session?.user)
          return setError("Login failed. Please try again.");
        setInfo("Signing you in…");
      }
    } catch (err: unknown) {
      setError(friendlyError(errorMessage(err, "Connection timeout")));
    } finally {
      setWorking(false);
    }
  }
  async function handleGoogle() {
    clearMessages();
    setWorking(true);
    const { error: err } = await signInWithGoogle();
    if (err) {
      setError(friendlyError(err.message));
      setWorking(false);
    }
  }
  async function chooseRole(role: PublicRole) {
    setSignupRole(role);
    clearMessages();
    if (pendingMethod === "authenticated") {
      setWorking(true);
      try {
        const { data, error: authError } = await supabase.auth.getUser();
        if (authError || !data.user)
          throw (
            authError ||
            new Error("Your sign-in session expired. Please sign in again.")
          );
        await onLoginSuccess(data.user.id, data.user.email || "", role);
      } catch (error: unknown) {
        setError(
          friendlyError(errorMessage(error, "Could not finish account setup")),
        );
      } finally {
        setWorking(false);
      }
      return;
    }
    setMode("signup");
  }
  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    clearMessages();
    if (!email.trim().includes("@"))
      return setError("Enter a valid email address");
    setWorking(true);
    try {
      const { error: err } = await resetPassword(email.trim());
      if (err) setError(friendlyError(err.message));
      else
        setInfo(
          "Reset link sent. Open the link in your email to choose a new password.",
        );
    } finally {
      setWorking(false);
    }
  }
  async function handleRecovery(e: React.FormEvent) {
    e.preventDefault();
    clearMessages();
    if (password.length < 8)
      return setError("New password must be at least 8 characters");
    if (password !== confirmPassword)
      return setError("The two passwords do not match");
    setWorking(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user)
        return setError(
          "This reset link is not ready or has expired. Request a new reset link.",
        );
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) return setError(friendlyError(err.message));
      setInfo("Password updated. Signing you in…");
      window.history.replaceState({}, "", window.location.pathname);
      window.setTimeout(
        () => window.location.replace(`${window.location.origin}/`),
        350,
      );
    } catch (error: unknown) {
      setError(friendlyError(errorMessage(error, "Password reset failed")));
    } finally {
      setWorking(false);
    }
  }
  async function cancelRecovery() {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (error: unknown) {
      void error;
    }
    window.location.replace(`${window.location.origin}/`);
  }
  async function joinWaitlist(e: React.FormEvent) {
    e.preventDefault();
    clearMessages();
    const clean = email.trim().toLowerCase(),
      cleanPhone = phone.trim();
    if (!clean && !cleanPhone)
      return setError("Enter a phone number or email address");
    if (clean && !clean.includes("@"))
      return setError("Enter a valid email address");
    setWorking(true);
    const { error: joinError } = await supabase
      .from("waitlist_signups")
      .insert({
        email: clean || null,
        phone: cleanPhone || null,
        full_name: fullName.trim() || null,
        city: city.trim() || null,
        interest,
        budget: budget ? Number(budget) : null,
        source: "website",
      });
    setWorking(false);
    if (joinError) {
      if (joinError.code === "23505")
        return setInfo("You are already on the WeHouse waitlist.");
      return setError(friendlyError(joinError.message));
    }
    setInfo(
      "🎉 You’re on the list! We’ll notify you when WeHouse is ready in your area.",
    );
    setEmail("");
    setPhone("");
    setFullName("");
    setCity("");
    setBudget("");
    setWaitlistOpen(false);
  }
  function backToChoose() {
    setMode("choose");
    setPendingMethod(null);
    setPassword("");
    setConfirmPassword("");
    clearMessages();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-transparent px-5 text-white">
      <div className="w-full max-w-[380px]">
        <Brand />
        {diag && (
          <details className="mb-3">
            <summary className="cursor-pointer text-[10px] text-[#5C5E72]">
              Debug info
            </summary>
            <div className="mt-1 break-all rounded-xl border border-white/[.06] bg-[#141720] p-2 font-mono text-[10px] text-[#6F7485]">
              {diag}
            </div>
          </details>
        )}
        {kickedOut && (
          <Notice tone="warning" title="This device was signed out">
            This device's WeHouse session is no longer active. Sign in again to
            start a new session on this device.
          </Notice>
        )}
        {displayError && <Notice tone="error">{displayError}</Notice>}
        {info && <Notice tone="info">{info}</Notice>}

        {mode === "waitlist" && (
          <div>
            <div className="mb-6 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-[.22em] text-violet-300">
                WeHouse is coming
              </p>
              <h2 className="mt-3 text-3xl font-black leading-tight">
                Find your place.
                <br />
                Build your life.
              </h2>
              <p className="mx-auto mt-3 max-w-xs text-xs leading-5 text-[#787E90]">
                Finding a home, compatible roommate or trusted local
                professional should be easier. Be among the first to use WeHouse
                in your area.
              </p>
            </div>
            {!waitlistOpen ? (
              <button
                type="button"
                onClick={() => {
                  setWaitlistOpen(true);
                  clearMessages();
                }}
                className="h-13 w-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 px-5 py-3.5 text-sm font-bold"
              >
                Join the Waitlist
              </button>
            ) : (
              <form
                onSubmit={joinWaitlist}
                className="space-y-3 border-y border-white/[.08] py-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold">
                      Join WeHouse Early Access
                    </p>
                    <p className="mt-1 text-[9px] text-[#73798A]">
                      Tell us what you need in your area.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWaitlistOpen(false)}
                    className="grid h-9 w-9 place-items-center rounded-full border border-white/[.08] text-[#969CAA]"
                  >
                    ×
                  </button>
                </div>
                <Field label="Name">
                  <Input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your name"
                    maxLength={100}
                    className="h-11 rounded-xl border-white/[.08] bg-[#0D0F15] text-white"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Phone number">
                    <Input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="080…"
                      maxLength={30}
                      className="h-11 rounded-xl border-white/[.08] bg-[#0D0F15] text-white"
                    />
                  </Field>
                  <Field label="Email">
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Optional"
                      className="h-11 rounded-xl border-white/[.08] bg-[#0D0F15] text-white"
                    />
                  </Field>
                </div>
                <Field label="I’m looking for">
                  <select
                    value={interest}
                    onChange={(e) => setInterest(e.target.value)}
                    className="h-11 w-full rounded-xl border border-white/[.08] bg-[#0D0F15] px-3 text-xs text-white outline-none"
                  >
                    <option value="housing">🏠 House</option>
                    <option value="roommate">👥 Roommate</option>
                    <option value="worker">🛠️ Worker</option>
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Location">
                    <Input
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="City or LGA"
                      maxLength={100}
                      className="h-11 rounded-xl border-white/[.08] bg-[#0D0F15] text-white"
                    />
                  </Field>
                  <Field label="Budget (optional)">
                    <Input
                      type="number"
                      min="0"
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      placeholder="₦"
                      className="h-11 rounded-xl border-white/[.08] bg-[#0D0F15] text-white"
                    />
                  </Field>
                </div>
                <button
                  type="submit"
                  disabled={working}
                  className="h-12 w-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 text-sm font-bold disabled:opacity-50"
                >
                  {working ? "Joining…" : "Join WeHouse"}
                </button>
              </form>
            )}
            <button
              type="button"
              onClick={() => {
                setMode("choose");
                clearMessages();
              }}
              className="mt-5 w-full text-center text-xs text-[#777D8D]"
            >
              Already have a WeHouse account?{" "}
              <span className="font-semibold text-white">Sign in</span>
            </button>
          </div>
        )}

        {mode === "recover" && (
          <form onSubmit={handleRecovery} className="space-y-4">
            <div className="mb-5">
              <p className="text-lg font-semibold">Choose a new password</p>
              <p className="mt-1 text-xs leading-relaxed text-[#73788A]">
                This screen is only for the secure reset link sent to your
                email.
              </p>
            </div>
            {!recoveryReady && (
              <div className="rounded-xl border border-amber-500/15 bg-amber-500/[.05] p-3 text-[10px] text-amber-300">
                Preparing the secure reset session. If this remains here, the
                link may have expired.
              </div>
            )}
            <PasswordField
              label="New password"
              value={password}
              set={setPassword}
              visible={showPassword}
              toggle={() => setShowPassword((v) => !v)}
            />
            <PasswordField
              label="Confirm new password"
              value={confirmPassword}
              set={setConfirmPassword}
              visible={showPassword}
              toggle={() => setShowPassword((v) => !v)}
            />
            <button
              type="submit"
              disabled={working || !recoveryReady}
              className="h-12 w-full rounded-xl bg-violet-500 text-sm font-semibold disabled:opacity-40"
            >
              {working ? "Updating…" : "Update password"}
            </button>
            <button
              type="button"
              onClick={() => void cancelRecovery()}
              className="w-full text-center text-xs text-[#6A6F80]"
            >
              Cancel and return to sign in
            </button>
          </form>
        )}

        {mode === "choose" && (
          <div className="space-y-3">
            <button
              onClick={() => void handleGoogle()}
              disabled={working}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-[#0A0A0F] disabled:opacity-50"
            >
              <GoogleIcon />
              Continue with Google
            </button>
            <Divider />
            <button
              onClick={() => {
                setMode("signin");
                clearMessages();
              }}
              className="h-12 w-full rounded-xl border border-white/[.08] bg-[#171A23] text-sm font-medium"
            >
              Sign in with email
            </button>
            <button
              onClick={() => {
                setPendingMethod("email");
                setMode("choose_role");
                clearMessages();
              }}
              className="h-12 w-full rounded-xl bg-violet-500 text-sm font-semibold"
            >
              Create account
            </button>
          </div>
        )}

        {mode === "choose_role" && (
          <div className="space-y-3">
            <div className="mb-4 text-center">
              <p className="text-sm font-semibold">
                How do you want to use WeHouse?
              </p>
              <p className="mt-1 text-[10px] text-[#666B7C]">
                Choose once. Existing accounts never need to choose again.
              </p>
            </div>
            <RoleButton
              title="Find Housing"
              detail="Listings, roommates and local services"
              onClick={() => void chooseRole("user")}
            />
            <RoleButton
              title="Offer Services"
              detail="Register as a local service professional"
              onClick={() => void chooseRole("worker")}
            />
            <RoleButton
              title="List My Property"
              detail="Become a Property Partner"
              onClick={() => void chooseRole("property_partner")}
            />
            <button
              type="button"
              disabled={working}
              onClick={backToChoose}
              className="w-full pt-2 text-xs text-[#676C7D] disabled:opacity-50"
            >
              Back
            </button>
          </div>
        )}

        {(mode === "signin" || mode === "signup") && (
          <form
            onSubmit={(e) => handleEmail(e, mode === "signup")}
            className="space-y-4"
          >
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="h-12 rounded-xl border-white/[.08] bg-[#171A23] text-white"
              />
            </Field>
            <PasswordField
              label="Password"
              value={password}
              set={setPassword}
              visible={showPassword}
              toggle={() => setShowPassword((v) => !v)}
            />
            <button
              type="submit"
              disabled={working}
              className={`h-12 w-full rounded-xl text-sm font-semibold disabled:opacity-50 ${mode === "signup" ? "bg-violet-500" : "border border-white/[.08] bg-[#171A23]"}`}
            >
              {working
                ? "Please wait…"
                : mode === "signup"
                  ? "Create account"
                  : "Sign in"}
            </button>
            {mode === "signin" && (
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  clearMessages();
                }}
                className="w-full text-center text-xs text-blue-400"
              >
                Forgot password?
              </button>
            )}
            <button
              type="button"
              onClick={backToChoose}
              className="w-full text-center text-xs text-[#676C7D]"
            >
              Back
            </button>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={handleForgot} className="space-y-4">
            <div className="mb-5">
              <p className="text-lg font-semibold">Reset your password</p>
              <p className="mt-1 text-xs text-[#73788A]">
                We’ll email you a secure link.
              </p>
            </div>
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="h-12 rounded-xl border-white/[.08] bg-[#171A23] text-white"
              />
            </Field>
            <button
              type="submit"
              disabled={working}
              className="h-12 w-full rounded-xl bg-violet-500 text-sm font-semibold disabled:opacity-50"
            >
              {working ? "Sending…" : "Send reset link"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                clearMessages();
              }}
              className="w-full text-center text-xs text-[#676C7D]"
            >
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="mb-7 text-center">
      <img
        src="/brand-lockup-dark.svg?v=2"
        alt="WeHouse — Find. Connect. Live better."
        className="mx-auto h-auto w-64 max-w-full"
      />
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-[#8B90A0]">
        {label}
      </span>
      {children}
    </label>
  );
}
function PasswordField({
  label,
  value,
  set,
  visible,
  toggle,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  visible: boolean;
  toggle: () => void;
}) {
  return (
    <Field label={label}>
      <div className="relative">
        <Input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => set(e.target.value)}
          placeholder="Minimum 8 characters"
          minLength={8}
          required
          className="h-12 rounded-xl border-white/[.08] bg-[#171A23] pr-12 text-white"
        />
        <button
          type="button"
          onClick={toggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#777C8C]"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </Field>
  );
}
function RoleButton({
  title,
  detail,
  onClick,
}: {
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl border border-white/[.07] bg-[#141720] p-4 text-left transition hover:border-blue-500/25"
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-[10px] text-[#666B7C]">{detail}</p>
    </button>
  );
}
function Divider() {
  return (
    <div className="relative my-5">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-white/[.07]" />
      </div>
      <div className="relative flex justify-center">
        <span className="bg-[#0A0A0F] px-4 text-[9px] uppercase tracking-widest text-[#555A6B]">
          or
        </span>
      </div>
    </div>
  );
}
function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
function Notice({
  children,
  tone = "info",
  title,
}: {
  children: React.ReactNode;
  tone?: "info" | "error" | "warning";
  title?: string;
}) {
  const cls =
    tone === "error"
      ? "border-red-500/20 bg-red-500/10 text-red-300"
      : tone === "warning"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
        : "border-blue-500/20 bg-blue-500/10 text-blue-300";
  return (
    <div
      className={`mb-4 rounded-xl border p-3 text-center text-xs leading-relaxed ${cls}`}
    >
      {title && <p className="mb-1 font-semibold">{title}</p>}
      {children}
    </div>
  );
}
