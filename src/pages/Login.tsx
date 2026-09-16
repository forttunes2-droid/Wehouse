import { useEffect, useRef, useState } from "react";
import {
  supabase,
  signUpWithEmail,
  signInWithIdentifier,
  signInWithGoogle,
  getProfileByAuthId,
  deactivateUserSession,
} from "@/lib/supabase";
import type { DeviceRegistration } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import {
  clearGoogleVerification,
  googleVerificationReturnContext,
  readGoogleVerification,
  saveGoogleVerification,
} from "@/lib/googleVerification";

type PublicRole = "user" | "worker" | "property_partner";
type Mode =
  | "choose"
  | "signin"
  | "signup"
  | "verify_email"
  | "confirm_device"
  | "google_mismatch"
  | "forgot"
  | "recover";
type VerificationContext = "signup" | "password_recovery" | "new_device";

interface LoginProps {
  onLoginSuccess: (authId: string, email: string, role?: PublicRole) => void;
  serverError: string;
  kickedOut?: boolean;
  pendingDevice?: DeviceRegistration | null;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === "object" && error && "message" in error)
    return String((error as { message?: unknown }).message || fallback);
  return String(error || fallback);
}

function legacyRecoveryRequested() {
  try {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return (
      query.get("auth") === "recovery" ||
      query.get("type") === "recovery" ||
      hash.get("type") === "recovery"
    );
  } catch {
    return false;
  }
}

function googleRecoveryRequested() {
  return readGoogleVerification()?.context === "password_recovery";
}

function googleVerificationContext(): VerificationContext | null {
  return readGoogleVerification()?.context || googleVerificationReturnContext();
}

function oauthCallbackCode() {
  try {
    return new URLSearchParams(window.location.search).get("code") || "";
  } catch {
    return "";
  }
}

function clearOauthCallbackCode() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("code");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {}
}

function cancelledGoogleMessage(context: VerificationContext | null) {
  if (context === "signup")
    return "Email confirmation was cancelled. Try again when you’re ready.";
  if (context === "password_recovery")
    return "Confirmation was cancelled. Your password was not changed.";
  if (context === "new_device")
    return "Confirmation was cancelled. This login was not completed.";
  return "Google confirmation was cancelled.";
}

function friendlyError(raw: string) {
  const msg = raw.toLowerCase();
  if (msg.includes("api key") || msg.includes("invalid key"))
    return "Authentication service is not configured correctly.";
  if (msg.includes("banned"))
    return "Your account has been permanently banned. Contact WeHouse for assistance.";
  if (msg.includes("suspended"))
    return "Your account has been suspended. Contact WeHouse for assistance.";
  if (msg.includes("deleted"))
    return "This account has been deleted. Contact WeHouse if you believe this is an error.";
  if (msg.includes("invalid login credentials") || msg.includes("invalid credentials"))
    return "Invalid username, email or password. Please check and try again.";
  if (msg.includes("email not confirmed") || msg.includes("not confirmed"))
    return "Finish the Google email verification for this account.";
  if (msg.includes("already registered"))
    return "An account with this email already exists. Try signing in instead.";
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("connection"))
    return "Connection failed. Please check your internet and try again.";
  if (msg.includes("timeout")) return "Request timed out. Please try again.";
  if (msg.includes("password") && (msg.includes("weak") || msg.includes("short")))
    return "Password is too weak. Use at least 8 characters.";
  if (msg.includes("same password") || msg.includes("different from the old"))
    return "Choose a new password you have not used for this account.";
  if (msg.includes("session") && (msg.includes("missing") || msg.includes("expired")))
    return "Your Google confirmation expired. Confirm the account again.";
  if (msg.includes("rate limit") || msg.includes("too many"))
    return "Too many attempts. Wait briefly, then try again.";
  if (msg.includes("expired") || msg.includes("invalid token"))
    return "This verification session has expired. Start again.";
  return "We couldn’t complete that. Please try again.";
}

export default function Login({
  onLoginSuccess,
  serverError,
  kickedOut,
  pendingDevice,
}: LoginProps) {
  const [storedVerification] = useState(() => readGoogleVerification());
  const [mode, setMode] = useState<Mode>(() =>
    storedVerification?.context === "password_recovery"
      ? "recover"
      : storedVerification?.context === "signup"
        ? "verify_email"
        : storedVerification?.context === "new_device"
          ? "confirm_device"
          : legacyRecoveryRequested()
            ? "forgot"
            : "choose",
  );
  const [email, setEmail] = useState(storedVerification?.email || "");
  const [loginIdentifier, setLoginIdentifier] = useState(
    storedVerification?.identifier || storedVerification?.email || "",
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [googleMismatchEmail, setGoogleMismatchEmail] = useState("");
  const [deviceDetails, setDeviceDetails] = useState<DeviceRegistration | null>(
    () => {
      if (
        !storedVerification ||
        storedVerification.context !== "new_device" ||
        !storedVerification.pendingDeviceSessionId
      )
        return null;
      return {
        sessionId: storedVerification.pendingDeviceSessionId,
        newDevice: true,
        trustStatus: "pending",
        device: storedVerification.device || "Unknown device",
        os: storedVerification.os || "Unknown system",
        browser: storedVerification.browser || "Unknown browser",
        location: storedVerification.location || "Location unavailable",
      };
    },
  );
  const authenticatedIdentityRef = useRef<string | null>(null);

  function clearMessages() {
    setError("");
    setInfo("");
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const oauthError = params.get("error_description") || hash.get("error_description");
    if (!oauthError) return;
    const context = googleVerificationContext();
    setWorking(false);
    setRecoveryReady(false);
    setError(cancelledGoogleMessage(context));
    if (context === "password_recovery") setMode("forgot");
    else if (context === "signup") setMode("verify_email");
    else if (context === "new_device") setMode("confirm_device");
    window.history.replaceState({}, "", window.location.pathname);
  }, [pendingDevice]);

  useEffect(() => {
    if (!pendingDevice) return;
    setDeviceDetails(pendingDevice);
    setInfo("");
    setError("");
    setMode("confirm_device");
    void supabase.auth.getUser().then(({ data }) => {
      const accountEmail = (data.user?.email || email).trim().toLowerCase();
      if (data.user?.email) setEmail(data.user.email);
      if (accountEmail)
        saveGoogleVerification({
          context: "new_device",
          email: accountEmail,
          pendingDeviceSessionId: pendingDevice.sessionId || undefined,
          device: pendingDevice.device,
          os: pendingDevice.os,
          browser: pendingDevice.browser,
          location: pendingDevice.location,
        });
    });
  }, [pendingDevice]);

  useEffect(() => {
    if (mode !== "recover") return;
    let alive = true;
    let checking = false;
    let verified = false;

    async function check() {
      if (checking || verified) return;
      checking = true;
      setRecoveryReady(false);
      const transaction = readGoogleVerification();
      const attemptId = transaction?.recoveryAttemptId || "";
      const expectedIdentifier = transaction?.identifier || transaction?.email || "";
      if (transaction?.context !== "password_recovery" || !attemptId) {
        checking = false;
        clearGoogleVerification();
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        if (!alive) return;
        setMode("forgot");
        setError("That recovery attempt is incomplete. Start again.");
        return;
      }

      let sessionResult;
      try {
        sessionResult = await supabase.auth.getSession();
      } catch {
        checking = false;
        if (!alive) return;
        setMode("forgot");
        setError("Google confirmation took too long. Confirm the account again.");
        return;
      }
      let { data, error: sessionError } = sessionResult;
      if (!alive) return;
      if (!data.session?.user) {
        const callbackCode = oauthCallbackCode();
        if (callbackCode) {
          try {
            const exchanged = await supabase.auth.exchangeCodeForSession(callbackCode);
            clearOauthCallbackCode();
            data = exchanged.data;
            sessionError = exchanged.error;
          } catch {
            clearOauthCallbackCode();
            checking = false;
            if (!alive) return;
            setMode("forgot");
            setError("Google confirmation expired. Start recovery again.");
            return;
          }
        }
      }
      if (sessionError || !data.session?.user) {
        clearOauthCallbackCode();
        checking = false;
        if (!alive) return;
        setMode("forgot");
        setError("Google returned without a usable confirmation. Try again.");
        return;
      }

      const returnedEmail = data.session.user.email?.trim().toLowerCase() || "";
      const { data: result, error: verifyError } = await supabase.rpc(
        "verify_identity_provider_password_recovery",
        { p_attempt_id: attemptId, p_provider: "google" },
      );
      checking = false;
      if (!alive) return;
      if (verifyError || !(result as { success?: boolean } | null)?.success) {
        setEmail(transaction.email || "");
        setLoginIdentifier(expectedIdentifier);
        setGoogleMismatchEmail(returnedEmail);
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        if (!alive) return;
        setMode("google_mismatch");
        return;
      }

      verified = true;
      setEmail(returnedEmail);
      setLoginIdentifier(expectedIdentifier || returnedEmail);
      setRecoveryReady(true);
      setError("");
      setInfo("");
    }

    void check();
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        alive &&
        (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
        session?.user
      ) {
        window.setTimeout(() => {
          if (alive) void check();
        }, 0);
      }
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [mode]);

  useEffect(() => {
    if (!legacyRecoveryRequested()) return;
    let active = true;
    void (async () => {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      if (!active) return;
      window.history.replaceState({}, "", window.location.pathname);
      setMode("forgot");
      setInfo(
        "Password recovery uses the Google identity linked to your WeHouse account. No reset link or code is sent.",
      );
    })();
    return () => {
      active = false;
    };
  }, []);

  // Any authenticated identity without a WeHouse profile becomes one Personal
  // identity. Browser metadata never chooses Worker, Partner, Staff, Admin or Creator.
  useEffect(() => {
    if (
      mode === "recover" ||
      legacyRecoveryRequested() ||
      googleRecoveryRequested()
    )
      return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (cancelled || !user) return;
      const verification = readGoogleVerification();
      const expectedGoogleEmail = verification?.email?.trim().toLowerCase() || "";
      const returnedEmail = user.email?.trim().toLowerCase() || "";

      if (expectedGoogleEmail && returnedEmail !== expectedGoogleEmail) {
        setEmail(expectedGoogleEmail);
        setLoginIdentifier(verification?.identifier || expectedGoogleEmail);
        setGoogleMismatchEmail(returnedEmail);
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        if (cancelled) return;
        setMode("google_mismatch");
        return;
      }

      if (verification?.context === "signup" && !user.identities?.some((identity) => identity.provider === "google")) {
        setEmail(expectedGoogleEmail || returnedEmail);
        setMode("verify_email");
        return;
      }

      if (authenticatedIdentityRef.current === user.id) return;
      const { profile } = await getProfileByAuthId(user.id);
      if (cancelled || profile) return;
      authenticatedIdentityRef.current = user.id;
      if (verification?.context === "signup") clearGoogleVerification();
      onLoginSuccess(user.id, returnedEmail, "user");
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, onLoginSuccess]);

  async function handleEmail(event: React.FormEvent, isSignup: boolean) {
    event.preventDefault();
    clearMessages();
    const clean = (isSignup ? email : loginIdentifier).trim().toLowerCase();
    if (isSignup && !clean.includes("@")) return setError("Enter a valid email address");
    if (!isSignup && !clean) return setError("Enter your username or email address");
    if (password.length < 8)
      return setError(isSignup ? "Password must be at least 8 characters" : "Enter your password");

    setWorking(true);
    try {
      if (isSignup) {
        saveGoogleVerification({ context: "signup", email: clean });
        sessionStorage.setItem("wh_login_method", "signup");
        const { data, error: signupError } = await signUpWithEmail(clean, password, "user");
        if (signupError) {
          if (signupError.message.toLowerCase().includes("email not confirmed")) {
            setMode("verify_email");
          } else {
            clearGoogleVerification();
            sessionStorage.removeItem("wh_login_method");
          }
          setError(friendlyError(signupError.message));
          return;
        }
        if (data.user) {
          setEmail(clean);
          setMode("verify_email");
          setInfo("Verify this email with the matching Google account to finish creating your Personal account.");
          return;
        }
        setError("Signup incomplete. Please try again.");
        return;
      }

      sessionStorage.setItem("wh_login_method", "password");
      const { data, error: signInError } = await signInWithIdentifier(clean, password);
      if (signInError) {
        sessionStorage.removeItem("wh_login_method");
        setError(friendlyError(signInError.message));
        return;
      }
      if (!data.session?.user) {
        setError("Login failed. Please try again.");
        return;
      }
      setInfo("Signing you in…");
    } catch (signInError: unknown) {
      setError(friendlyError(errorMessage(signInError, "Connection timeout")));
    } finally {
      setWorking(false);
    }
  }

  async function handleGoogle() {
    clearMessages();
    let context: VerificationContext | undefined;
    if (mode === "verify_email") {
      context = "signup";
      saveGoogleVerification({ context, email: email.trim().toLowerCase() });
    } else if (mode === "confirm_device") {
      context = "new_device";
      saveGoogleVerification({
        context,
        email: email.trim().toLowerCase(),
        pendingDeviceSessionId: deviceDetails?.sessionId || undefined,
        device: deviceDetails?.device,
        os: deviceDetails?.os,
        browser: deviceDetails?.browser,
        location: deviceDetails?.location,
      });
    } else {
      clearGoogleVerification();
      sessionStorage.removeItem("wh_login_method");
    }

    setWorking(true);
    const verificationEmail = context ? email.trim().toLowerCase() : undefined;
    const { error: googleError } = await signInWithGoogle(verificationEmail, context);
    if (googleError) {
      setError(friendlyError(googleError.message));
      setWorking(false);
    }
  }

  async function chooseOriginalGoogleEmail() {
    const transaction = readGoogleVerification();
    const context = transaction?.context || googleVerificationContext() || "signup";
    setWorking(true);
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    setWorking(false);
    setGoogleMismatchEmail("");
    clearMessages();
    if (context === "password_recovery") {
      if (transaction) saveGoogleVerification(transaction);
      setMode("forgot");
      return;
    }
    const expectedEmail = transaction?.email || email;
    saveGoogleVerification({
      ...(transaction || {}),
      context,
      email: expectedEmail,
    });
    setMode(context === "new_device" ? "confirm_device" : "verify_email");
    setWorking(true);
    const { error: googleError } = await signInWithGoogle(expectedEmail, context);
    if (googleError) {
      setWorking(false);
      setError(friendlyError(googleError.message));
    }
  }

  async function returnFromGoogleMismatch() {
    const transaction = readGoogleVerification();
    const context = transaction?.context || googleVerificationContext();
    setWorking(true);
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    setWorking(false);
    setGoogleMismatchEmail("");
    setPassword("");
    clearMessages();

    if (context === "new_device") {
      if (deviceDetails?.sessionId)
        await deactivateUserSession(deviceDetails.sessionId).catch(() => {});
      clearGoogleVerification();
      setDeviceDetails(null);
      setMode("signin");
      setInfo("That device login was cancelled. Sign in again when you are ready.");
      return;
    }

    if (transaction) {
      saveGoogleVerification(transaction);
      setEmail(transaction.email);
      setLoginIdentifier(transaction.identifier || transaction.email);
    }
    setMode(context === "password_recovery" ? "forgot" : "verify_email");
  }

  async function cancelDeviceConfirmation() {
    setWorking(true);
    if (deviceDetails?.sessionId)
      await deactivateUserSession(deviceDetails.sessionId).catch(() => {});
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    clearGoogleVerification();
    sessionStorage.removeItem("wh_login_method");
    setWorking(false);
    setMode("choose");
    setPassword("");
    clearMessages();
  }

  async function handleForgot(event: React.FormEvent) {
    event.preventDefault();
    clearMessages();
    const clean = loginIdentifier.trim().toLowerCase();
    const isEmail = clean.includes("@");
    if (!clean || (!isEmail && !/^[a-z0-9_]{3,20}$/.test(clean)))
      return setError("Enter your WeHouse username or email address");
    setWorking(true);
    try {
      clearGoogleVerification();
      const { data: attemptId, error: beginError } = await supabase.rpc(
        "begin_identity_provider_password_recovery",
        { p_identifier: clean, p_provider: "google" },
      );
      if (beginError || !attemptId) {
        setError("Password recovery could not start. Try again.");
        return;
      }
      saveGoogleVerification({
        context: "password_recovery",
        email: isEmail ? clean : "",
        identifier: clean,
        recoveryAttemptId: String(attemptId),
      });
      sessionStorage.removeItem("wh_login_method");
      const { error: googleError } = await signInWithGoogle(
        isEmail ? clean : undefined,
        "password_recovery",
      );
      if (googleError) {
        clearGoogleVerification();
        setError(friendlyError(googleError.message));
      }
    } catch (recoveryError: unknown) {
      clearGoogleVerification();
      setError(friendlyError(errorMessage(recoveryError, "Google confirmation could not start")));
    } finally {
      setWorking(false);
    }
  }

  async function handleRecovery(event: React.FormEvent) {
    event.preventDefault();
    clearMessages();
    if (password.length < 8) return setError("New password must be at least 8 characters");
    if (password !== confirmPassword) return setError("The two passwords do not match");
    setWorking(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const transaction = readGoogleVerification();
      const attemptId = transaction?.recoveryAttemptId || "";
      if (!recoveryReady || !session?.user || !attemptId) {
        setError("Google confirmation is not ready or has expired. Start recovery again.");
        return;
      }
      const { data: recovery, error: recoveryError } = await supabase.functions.invoke(
        "provider-password-recovery",
        { body: { attempt_id: attemptId, new_password: password } },
      );
      if (recoveryError || !recovery?.success) {
        setError(
          friendlyError(
            String(recovery?.error || recoveryError?.message || "Password reset failed"),
          ),
        );
        return;
      }
      clearGoogleVerification();
      window.history.replaceState({}, "", window.location.pathname);
      setPassword("");
      setConfirmPassword("");
      setLoginIdentifier(transaction?.identifier || session.user.email || "");
      setRecoveryReady(false);
      setMode("signin");
      setInfo("Password changed. Sign in with your new password.");
      void supabase.auth.signOut({ scope: "local" }).catch(() => {});
    } catch (recoveryError: unknown) {
      setError(friendlyError(errorMessage(recoveryError, "Password reset failed")));
    } finally {
      setWorking(false);
    }
  }

  async function cancelRecovery() {
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    clearGoogleVerification();
    window.history.replaceState({}, "", window.location.pathname);
    setPassword("");
    setConfirmPassword("");
    setRecoveryReady(false);
    setMode("signin");
    clearMessages();
  }

  const displayError = error || serverError;

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#07070A] text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-28 -top-20 h-80 w-80 rounded-full bg-violet-600/20 blur-[110px]" />
        <div className="absolute -bottom-32 right-[-5rem] h-[28rem] w-[28rem] rounded-full bg-fuchsia-700/10 blur-[140px]" />
        <div className="absolute inset-0 opacity-[.12]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)", backgroundSize: "46px 46px", maskImage: "linear-gradient(to bottom, black, transparent 78%)" }} />
      </div>
      <div className="relative mx-auto grid min-h-[100dvh] w-full max-w-[1500px] lg:grid-cols-[1.08fr_.92fr]">
        <AuthStory />
        <main className="flex items-center justify-center px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
          <section className="w-full max-w-[470px] overflow-hidden rounded-[30px] border border-white/[.08] bg-[#0E1017]/92 shadow-[0_30px_90px_rgba(0,0,0,.45)] backdrop-blur-2xl">
            <div className="border-b border-white/[.05] px-5 py-5 sm:px-8">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[9px] font-bold uppercase tracking-[.22em] text-violet-300">Secure WeHouse access</span>
                <span className="inline-flex items-center gap-1.5 text-[9px] text-[#7C8292]"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />One identity</span>
              </div>
            </div>
            <div className="px-5 py-6 sm:px-8 sm:py-8">
              <Brand compact={mode !== "choose" && mode !== "signin" && mode !== "signup"} />
        {kickedOut ? (
          <Notice tone="warning" title="This device was signed out">
            This device&apos;s WeHouse session is no longer active. Sign in again to continue.
          </Notice>
        ) : null}
        {displayError ? <Notice tone="error">{displayError}</Notice> : null}
        {info ? <Notice tone="info">{info}</Notice> : null}

        {mode === "choose" ? (
          <div className="space-y-3">
            <div className="pb-3 text-center lg:text-left">
              <p className="text-[9px] font-bold uppercase tracking-[.2em] text-violet-300">One Personal account</p>
              <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-[-.035em] text-white sm:text-[30px]">Everything starts here.</h1>
              <p className="mx-auto mt-2 max-w-sm text-[11px] leading-5 text-[#858B9A] lg:mx-0">Homes, hotels, roommates and WeHouse Services stay connected to one identity.</p>
            </div>
            <button
              type="button"
              onClick={() => void handleGoogle()}
              disabled={working}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-[#0A0A0F] shadow-[0_8px_30px_rgba(255,255,255,.08)] transition hover:-translate-y-0.5 hover:bg-[#F7F7FA] disabled:translate-y-0 disabled:opacity-50"
            >
              <GoogleIcon />
              Continue with Google
            </button>
            <Divider />
            <button
              type="button"
              onClick={() => { setMode("signin"); clearMessages(); }}
              className="h-12 w-full rounded-2xl border border-white/[.09] bg-white/[.035] text-sm font-medium text-[#E6E8EE] transition hover:border-violet-400/25 hover:bg-violet-500/[.06]"
            >
              Sign in with email
            </button>
            <button
              type="button"
              onClick={() => { setMode("signup"); clearMessages(); }}
              className="h-12 w-full rounded-2xl bg-violet-500 text-sm font-semibold shadow-[0_12px_34px_rgba(139,92,246,.25)] transition hover:-translate-y-0.5 hover:bg-violet-400"
            >
              Create account
            </button>
            <p className="pt-1 text-center text-[9px] leading-4 text-[#656B7B]">
              Every account starts with Personal. Worker and Property Partner workspaces can be added later.
            </p>
          </div>
        ) : null}

        {(mode === "signin" || mode === "signup") ? (
          <form onSubmit={(event) => void handleEmail(event, mode === "signup")} className="space-y-4">
            <div className="mb-2">
              <h1 className="text-lg font-semibold">
                {mode === "signup" ? "Create your Personal account" : "Welcome back"}
              </h1>
              {mode === "signup" ? (
                <p className="mt-1 text-[10px] leading-4 text-[#73798A]">
                  You can add Worker or Property Partner access later without creating another account.
                </p>
              ) : null}
            </div>
            <Field label={mode === "signup" ? "Email" : "Username or email"}>
              <Input
                type={mode === "signup" ? "email" : "text"}
                value={mode === "signup" ? email : loginIdentifier}
                onChange={(event) => mode === "signup" ? setEmail(event.target.value) : setLoginIdentifier(event.target.value)}
                placeholder={mode === "signup" ? "you@example.com" : "Username or email"}
                autoCapitalize="none"
                autoCorrect="off"
                required
                className="h-12 rounded-2xl border-white/[.08] bg-white/[.035] text-white shadow-inner shadow-black/10 focus-visible:border-violet-400/50 focus-visible:ring-violet-500/20"
              />
            </Field>
            <PasswordField
              label="Password"
              value={password}
              set={setPassword}
              visible={showPassword}
              toggle={() => setShowPassword((value) => !value)}
            />
            <button
              type="submit"
              disabled={working || !(mode === "signup" ? email : loginIdentifier).trim() || password.length < 8}
              className={`h-12 w-full rounded-xl text-sm font-semibold disabled:opacity-50 ${mode === "signup" ? "bg-violet-500" : "border border-white/[.08] bg-[#171A23]"}`}
            >
              {working ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
            </button>
            {mode === "signin" ? (
              <button
                type="button"
                onClick={() => { setMode("forgot"); clearMessages(); }}
                className="w-full text-center text-xs text-violet-400"
              >
                Forgot password?
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => { setMode("choose"); setPassword(""); setConfirmPassword(""); clearMessages(); }}
              className="w-full text-center text-xs text-[#676C7D]"
            >
              Back
            </button>
          </form>
        ) : null}

        {mode === "verify_email" ? (
          <div className="space-y-4">
            <section className="border-y border-white/[.08] py-5">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-violet-500/10 text-violet-300">
                <ShieldCheckIcon />
              </div>
              <p className="mt-5 text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">VERIFY EMAIL OWNERSHIP</p>
              <h2 className="mt-2 text-xl font-semibold">Confirm you own this email</h2>
              <p className="mt-2 text-xs leading-5 text-[#858B9A]">
                Continue with the Google account for <span className="font-semibold text-white">{email.trim()}</span>. A different address will be rejected.
              </p>
              <p className="mt-3 text-[10px] leading-4 text-[#666C7D]">
                No WeHouse verification code is sent. This only verifies the email; email-and-password sign-in remains available.
              </p>
            </section>
            <button
              type="button"
              onClick={() => void handleGoogle()}
              disabled={working}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-semibold text-[#0A0A0F] disabled:opacity-50"
            >
              <GoogleIcon />
              {working ? "Opening verification…" : "Verify with Google"}
            </button>
            <button
              type="button"
              onClick={() => { clearGoogleVerification(); setMode("signup"); setPassword(""); clearMessages(); }}
              disabled={working}
              className="w-full text-center text-xs text-[#73798A]"
            >
              Change email
            </button>
          </div>
        ) : null}

        {mode === "confirm_device" && deviceDetails ? (
          <div className="space-y-4">
            <section className="border-y border-white/[.08] py-5">
              <div className="flex items-center justify-between gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-violet-500/10 text-violet-300"><ShieldCheckIcon /></div>
                <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[8px] font-bold tracking-[.14em] text-amber-300">NEW DEVICE</span>
              </div>
              <h2 className="mt-5 text-xl font-bold">Verify this device login</h2>
              <p className="mt-2 text-xs leading-5 text-[#858B9A]">
                Continue with the Google account for <span className="font-semibold text-white">{email.trim()}</span>. This confirms this device only.
              </p>
              <div className="mt-5 divide-y divide-white/[.06] border-y border-white/[.06]">
                <SecurityDetail label="Device" value={deviceDetails.device} />
                <SecurityDetail label="System" value={`${deviceDetails.os} · ${deviceDetails.browser}`} />
                <SecurityDetail label="Near" value={deviceDetails.location} />
              </div>
            </section>
            <button
              type="button"
              onClick={() => void handleGoogle()}
              disabled={working}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-semibold text-[#0A0A0F] disabled:opacity-50"
            >
              <GoogleIcon />
              {working ? "Opening verification…" : "Verify with Google"}
            </button>
            <button
              type="button"
              onClick={() => void cancelDeviceConfirmation()}
              disabled={working}
              className="h-11 w-full rounded-xl text-xs font-semibold text-[#73798A] disabled:opacity-50"
            >
              Cancel this login
            </button>
          </div>
        ) : null}

        {mode === "google_mismatch" ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-4">
              <p className="text-sm font-semibold text-amber-200">That Google account does not match</p>
              <p className="mt-2 text-[10px] leading-5 text-[#A4A8B3]">
                This step can verify only <strong className="text-white">{loginIdentifier || email}</strong>. <strong className="text-white">{googleMismatchEmail || "The selected Google account"}</strong> was rejected and no account details were changed.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void chooseOriginalGoogleEmail()}
              disabled={working}
              className="h-12 w-full rounded-xl bg-white text-sm font-semibold text-[#0A0A0F] disabled:opacity-50"
            >
              Choose the matching Google account
            </button>
            <button
              type="button"
              onClick={() => void returnFromGoogleMismatch()}
              disabled={working}
              className="w-full text-center text-xs text-[#73798A]"
            >
              Cancel verification
            </button>
          </div>
        ) : null}

        {mode === "forgot" ? (
          <form onSubmit={(event) => void handleForgot(event)} className="space-y-4">
            <div className="mb-5">
              <p className="text-lg font-semibold">Create a new password</p>
              <p className="mt-1 text-xs leading-5 text-[#73788A]">
                Enter your username or email, then confirm with the Google identity already linked to that WeHouse account. No reset link or recovery code is sent.
              </p>
            </div>
            <Field label="Username or email">
              <Input
                type="text"
                value={loginIdentifier}
                onChange={(event) => setLoginIdentifier(event.target.value)}
                placeholder="Username or email"
                autoCapitalize="none"
                autoCorrect="off"
                required
                className="h-12 rounded-2xl border-white/[.08] bg-white/[.035] text-white shadow-inner shadow-black/10 focus-visible:border-violet-400/50 focus-visible:ring-violet-500/20"
              />
            </Field>
            <button
              type="submit"
              disabled={working || !loginIdentifier.trim()}
              className="h-12 w-full rounded-xl bg-white text-sm font-semibold text-[#0A0A0F] disabled:opacity-50"
            >
              <span className="inline-flex items-center justify-center gap-2"><GoogleIcon />{working ? "Opening Google…" : "Confirm with Google"}</span>
            </button>
            <button type="button" onClick={() => { setMode("signin"); clearMessages(); }} className="w-full text-center text-xs text-[#676C7D]">
              Back to sign in
            </button>
          </form>
        ) : null}

        {mode === "recover" ? (
          <form onSubmit={(event) => void handleRecovery(event)} className="space-y-4">
            <div className="mb-5">
              <p className="text-lg font-semibold">Create a new password</p>
              <p className="mt-1 text-xs leading-5 text-[#73788A]">
                Confirmed as <span className="font-semibold text-white">{loginIdentifier || email}</span>. Choose a new password.
              </p>
            </div>
            {!recoveryReady ? (
              <div className="rounded-xl border border-amber-500/15 bg-amber-500/[.05] p-3 text-[10px] text-amber-300">Finishing confirmation…</div>
            ) : null}
            <PasswordField label="New password" value={password} set={setPassword} visible={showPassword} toggle={() => setShowPassword((value) => !value)} />
            <PasswordField label="Confirm new password" value={confirmPassword} set={setConfirmPassword} visible={showPassword} toggle={() => setShowPassword((value) => !value)} />
            <button
              type="submit"
              disabled={working || !recoveryReady || password.length < 8 || password !== confirmPassword}
              className="h-12 w-full rounded-xl bg-violet-500 text-sm font-semibold disabled:opacity-40"
            >
              {working ? "Updating…" : "Save new password"}
            </button>
            <button type="button" onClick={() => void cancelRecovery()} className="w-full text-center text-xs text-[#6A6F80]">
              Cancel and return to sign in
            </button>
          </form>
        ) : null}
            </div>
            <div className="border-t border-white/[.05] px-5 py-4 sm:px-8">
              <div className="flex items-center justify-between gap-3 text-[8px] text-[#626979]">
                <span>find · connect · live better</span>
                <span>wehouse.com.ng</span>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function AuthStory() {
  return (
    <aside className="relative hidden min-h-[100dvh] overflow-hidden border-r border-white/[.05] lg:flex lg:items-center lg:px-14 xl:px-20">
      <div className="relative z-10 max-w-[620px]">
        <img src="/brand-lockup-dark.svg?v=2" alt="WeHouse" className="h-auto w-56" />
        <p className="mt-10 text-[10px] font-bold uppercase tracking-[.28em] text-violet-300">Find · connect · live better</p>
        <h1 className="mt-5 max-w-[590px] text-[clamp(2.8rem,4.8vw,5.4rem)] font-black leading-[.93] tracking-[-.055em] text-white">
          Your place, your people, your work — one account.
        </h1>
        <p className="mt-6 max-w-xl text-[15px] leading-7 text-[#969CAB]">
          Discover homes and hotels, meet compatible roommates, book trusted services and manage every real WeHouse journey without creating separate identities.
        </p>
        <div className="mt-10 grid grid-cols-3 gap-3">
          <AuthFeature index="01" title="Find a place" detail="Homes, Short Let and hotels" />
          <AuthFeature index="02" title="Connect safely" detail="Roommates and private conversations" />
          <AuthFeature index="03" title="Get things done" detail="Services and protected bookings" />
        </div>
        <div className="mt-8 flex items-center gap-3 text-[10px] text-[#747B8B]">
          <span className="h-px w-10 bg-violet-400/50" />
          <span>Built around real housing journeys, not disconnected dashboards.</span>
        </div>
      </div>
      <div aria-hidden="true" className="absolute bottom-[-12rem] left-[18%] h-[32rem] w-[32rem] rounded-full border border-violet-400/10" />
      <div aria-hidden="true" className="absolute bottom-[-8rem] left-[25%] h-[22rem] w-[22rem] rounded-full border border-violet-400/10" />
    </aside>
  );
}

function AuthFeature({ index, title, detail }: { index: string; title: string; detail: string }) {
  return (
    <div className="min-h-32 rounded-2xl border border-white/[.07] bg-white/[.025] p-4 backdrop-blur-sm">
      <p className="text-[8px] font-bold tracking-[.18em] text-violet-300">{index}</p>
      <p className="mt-6 text-[12px] font-semibold text-white">{title}</p>
      <p className="mt-1 text-[9px] leading-4 text-[#707787]">{detail}</p>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`${compact ? "mb-5" : "mb-6"} text-center lg:text-left`}>
      <img
        src="/brand-lockup-dark.svg?v=2"
        alt="WeHouse — Find. Connect. Live better."
        className={`h-auto max-w-full ${compact ? "mx-auto w-36 lg:mx-0" : "mx-auto w-48 lg:mx-0 lg:w-44"}`}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-[#8B90A0]">{label}</span>
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
  set: (value: string) => void;
  visible: boolean;
  toggle: () => void;
}) {
  return (
    <Field label={label}>
      <div className="relative">
        <Input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => set(event.target.value)}
          placeholder="Minimum 8 characters"
          minLength={8}
          required
          className="h-12 rounded-2xl border-white/[.08] bg-white/[.035] pr-12 text-white shadow-inner shadow-black/10 focus-visible:border-violet-400/50 focus-visible:ring-violet-500/20"
        />
        <button type="button" onClick={toggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#777C8C]">
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </Field>
  );
}

function Notice({
  children,
  title,
  tone,
}: {
  children: React.ReactNode;
  title?: string;
  tone: "error" | "warning" | "info";
}) {
  const className = tone === "error"
    ? "border-red-500/15 bg-red-500/[.05] text-red-200"
    : tone === "warning"
      ? "border-amber-500/15 bg-amber-500/[.05] text-amber-200"
      : "border-violet-500/15 bg-violet-500/[.05] text-violet-200";
  return (
    <div className={`mb-4 rounded-xl border p-3 text-[10px] leading-5 ${className}`}>
      {title ? <p className="mb-1 text-xs font-semibold">{title}</p> : null}
      {children}
    </div>
  );
}

function SecurityDetail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 text-[10px]">
      <span className="text-[#696F7F]">{label}</span>
      <span className="text-right font-medium text-[#D6D9E0]">{value || "Unavailable"}</span>
    </div>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-white/[.06]" />
      <span className="text-[8px] uppercase tracking-[.14em] text-[#5F6574]">or</span>
      <span className="h-px flex-1 bg-white/[.06]" />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.5L15.4 17c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.4 13.9A6 6 0 0 1 6 12c0-.7.1-1.3.4-1.9V7.5H3.1A10 10 0 0 0 2 12c0 1.6.4 3.1 1.1 4.5l3.3-2.6Z" />
      <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.7 9.7 0 0 0 12 2a10 10 0 0 0-8.9 5.5l3.3 2.6C7.2 7.8 9.4 6 12 6Z" />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
      <path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
