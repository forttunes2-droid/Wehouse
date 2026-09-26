import GuestBrowseEntry from "@/components/GuestBrowseEntry";
import { useRecordScreenBack } from "@/hooks/useRecordScreenBack";
import { useEffect, useRef, useState } from "react";
import { withTimeout } from "@/lib/withTimeout";
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
import "./login.css";
import "./public-entry.css";
import { isTestEnvironment } from '@/lib/supabase/client';
import { getCurrentLegalDocuments, type CurrentLegalDocuments } from '@/lib/supabase/legal';
import { hasLegalConsent, legalDocumentKey, type LegalChoices } from '@/lib/legalConsent';
import LegalReview from '@/components/LegalReview';
import BackButton from '@/components/BackButton';
import {
  clearGoogleVerification,
  googleVerificationReturnContext,
  readGoogleVerification,
  saveGoogleVerification,
} from "@/lib/googleVerification";

type PublicRole = "user" | "worker" | "property_partner";
type Mode =
  | "browse"
  | "choose"
  | "signin"
  | "signup"
  | "verify_email"
  | "confirm_device"
  | "google_mismatch"
  | "forgot"
  | "recover";
type VerificationContext = "signup" | "password_recovery" | "new_device";

const primaryAction = "wh-auth-primary flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const secondaryAction = "wh-auth-secondary flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const textAction = "wh-auth-text-action min-h-11 rounded-md px-2 text-sm font-semibold disabled:opacity-50";
const inputStyle = "wh-auth-input h-12 rounded-xl text-base focus-visible:ring-violet-500/20";

interface LoginProps {
  onLoginSuccess: (authId: string, email: string, role?: PublicRole) => void;
  onOpenLegal: (page: "privacy_policy" | "terms_of_service") => void;
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
  if (msg.includes('provider') && (msg.includes('not enabled') || msg.includes('disabled') || msg.includes('unsupported')))
    return isTestEnvironment ? 'Google sign-in is not ready on this test preview yet. Use live WeHouse for your existing account.' : 'Google sign-in is temporarily unavailable. Please try again later.';
  if (msg.includes("banned"))
    return "Your account has been permanently banned. Contact WeHouse for assistance.";
  if (msg.includes("suspended"))
    return "Your account has been suspended. Contact WeHouse for assistance.";
  if (msg.includes("deleted"))
    return "This account has been deleted. Contact WeHouse if you believe this is an error.";
  if (msg.includes("invalid login credentials") || msg.includes("invalid credentials"))
    return "Invalid username, email or password. Please check and try again.";
  if (msg.includes("review the current") || msg.includes("registration is unavailable") || msg.includes("choose create account") || msg.includes("registrations are currently closed") || msg.includes("under maintenance"))
    return raw;
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
  onOpenLegal,
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
            : "browse",
  );
  const [email, setEmail] = useState(storedVerification?.email || "");
  const [loginIdentifier, setLoginIdentifier] = useState(
    storedVerification?.identifier || storedVerification?.email || "",
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [working, setWorkingState] = useState(false);
  const workingRef = useRef(false);
  const emailHandoff = useRef(false);
  function setWorking(value: boolean) {
    // Guard immediately, including two submits before React commits a render.
    workingRef.current = value;
    if (!value) emailHandoff.current = false;
    setWorkingState(value);
  }
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
  const [legalDocuments, setLegalDocuments] = useState<CurrentLegalDocuments>({ privacy: null, terms: null });
  const [legalChoices, setLegalChoices] = useState<LegalChoices>({});
  const [legalLoading, setLegalLoading] = useState(true);
  const [legalError, setLegalError] = useState(false);
  const [legalReload, setLegalReload] = useState(0);
  const legalReady = !legalLoading && !legalError && hasLegalConsent(legalDocuments, legalChoices);

  useEffect(() => {
    if (mode !== 'signup') return;
    let active = true;
    setLegalLoading(true); setLegalError(false);
    void getCurrentLegalDocuments().then(({ documents, error: readError }) => {
      if (!active) return;
      setLegalDocuments(documents); setLegalError(Boolean(readError)); setLegalLoading(false);
    }).catch(() => { if (active) { setLegalError(true); setLegalLoading(false); } });
    return () => { active = false; };
  }, [mode, legalReload]);

  useEffect(() => {
    // The account/device owner ends the handoff, not the password API response.
    if (serverError || kickedOut) { setWorking(false); setInfo(""); }
  }, [serverError, kickedOut]);

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
    setError(oauthError.toLowerCase().includes('choose create account') || oauthError.toLowerCase().includes('registration is unavailable') || oauthError.toLowerCase().includes('registrations are currently closed') || oauthError.toLowerCase().includes('under maintenance')
      ? oauthError : cancelledGoogleMessage(context));
    if (context === "password_recovery") setMode("forgot");
    else if (context === "signup") setMode("verify_email");
    else if (context === "new_device") setMode("confirm_device");
    window.history.replaceState({}, "", window.location.pathname);
  }, [pendingDevice]);

  useEffect(() => {
    if (!pendingDevice) return;
    setWorking(false);
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
    if (workingRef.current) return;
    clearMessages();
    const clean = (isSignup ? email : loginIdentifier).trim().toLowerCase();
    if (isSignup && !clean.includes("@")) return setError("Enter a valid email address");
    if (!isSignup && !clean) return setError("Enter your username or email address");
    if (password.length < 8)
      return setError(isSignup ? "Password must be at least 8 characters" : "Enter your password");

    setWorking(true);
    try {
      if (isSignup) {
        if (!legalReady) { setError('Review each published legal document before creating your account.'); return; }
        const { documents, error: documentError } = await getCurrentLegalDocuments();
        if (documentError || !hasLegalConsent(documents, legalChoices)) {
          setLegalDocuments(documents); setLegalChoices({});
          setError('The documents could not be confirmed or have changed. Review the current versions and try again.');
          return;
        }
        saveGoogleVerification({ context: "signup", email: clean });
        sessionStorage.setItem("wh_login_method", "signup");
        const { data, error: signupError } = await signUpWithEmail(clean, password, "user", legalChoices);
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
      emailHandoff.current = true;
      setInfo("Signing you in…");
    } catch (signInError: unknown) {
      setError(friendlyError(errorMessage(signInError, "Connection timeout")));
    } finally {
      // A verified password is not yet a loaded, authorised workspace.
      if (!emailHandoff.current) setWorking(false);
    }
  }

  async function handleGoogle() {
    if (workingRef.current) return;
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
    try {
      const { error: googleError } = await withTimeout(signInWithGoogle(verificationEmail, context), 15000, "Google sign-in could not open. Please try again.");
      if (googleError) throw googleError;
    } catch (cause) {
      setError(friendlyError(errorMessage(cause, "Google sign-in could not open")));
      setWorking(false);
    }
  }

  async function chooseOriginalGoogleEmail() {
    if (workingRef.current) return;
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
    if (workingRef.current) return;
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
    if (workingRef.current) return;
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
    if (workingRef.current) return;
    clearMessages();
    const clean = loginIdentifier.trim().toLowerCase();
    const isEmail = clean.includes("@");
    if (!clean || (!isEmail && !/^[a-z0-9_]{3,20}$/.test(clean)))
      return setError("Enter your WeHouse username or email address");
    setWorking(true);
    try {
      clearGoogleVerification();
      // Recovery must create a new provider session after the server request.
      // It is not a reuse of a bearer already stored on this browser.
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) throw new Error("Could not prepare a new confirmation. Please try again.");
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
    if (workingRef.current) return;
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
      if (recovery?.password_changed === true && !recovery.success) {
        clearGoogleVerification(); setPassword(""); setConfirmPassword(""); setRecoveryReady(false);
        window.history.replaceState({}, "", window.location.pathname);
        setMode("signin");
        setInfo(String(recovery.error));
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        return;
      }
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
    if (workingRef.current) return;
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
  const [browseResetKey, setBrowseResetKey] = useState(0);
  const returnToPlaces = useRecordScreenBack(() => {
    setBrowseResetKey((key) => key + 1);
    setMode("browse"); setPassword(""); setConfirmPassword(""); clearMessages();
  }, ["choose", "signin", "signup", "forgot"].includes(mode));

  return (
    <GuestBrowseEntry key={browseResetKey} active={mode === "browse"} busy={working}
      onSignIn={() => { if (!workingRef.current) { setMode("choose"); clearMessages(); } }}
      onOpenLegal={onOpenLegal}
      notice={displayError || (kickedOut ? "This device was signed out. Sign in again to continue." : "")}
    >
    <AuthSurface>
      <main className={`wh-auth-layout wh-auth-mode-${mode}`}>
        <header className="wh-auth-header"><Brand /></header>
        <section className="wh-auth-content">
        <div key={mode} className="wh-auth-form">
        <fieldset disabled={working} aria-busy={working} className="min-w-0 border-0 p-0">
        {isTestEnvironment ? <p className="mb-6 border-l-2 border-violet-400 pl-3 text-sm leading-6 text-[var(--auth-muted)]">Test preview · Live accounts don’t work here. <a href="https://www.wehouse.com.ng/" className="text-violet-300 underline underline-offset-4">Open live WeHouse</a></p> : null}
        {kickedOut ? (
          <Notice tone="warning" title="This device was signed out">
            This device&apos;s WeHouse session is no longer active. Sign in again to continue.
          </Notice>
        ) : null}
        {displayError ? <Notice tone="error">{displayError}</Notice> : null}
        {info ? <Notice tone="info">{info}</Notice> : null}

        {mode === "choose" ? (
          <div>
            <button type="button" onClick={returnToPlaces} className="wh-auth-text-action mb-5 inline-flex min-h-11 items-center gap-2 text-sm"><span aria-hidden="true">←</span> Back to places</button>
            <div className="mb-6">
              <h1 className="text-2xl font-semibold leading-tight tracking-tight">Welcome</h1>
              <p className="mt-2 text-sm leading-6 text-[var(--auth-muted)]">Sign in or create your WeHouse account.</p>
            </div>
            <button
              type="button"
              onClick={() => { setMode("signin"); clearMessages(); }}
              className={primaryAction}
            >
              Continue with email
            </button>
            <Divider />
            <button
              type="button"
              onClick={() => void handleGoogle()}
              disabled={working}
              className={secondaryAction}
            >
              <GoogleIcon />
              {working ? "Opening Google…" : "Continue with Google"}
            </button>
            <p className="mt-5 flex flex-wrap items-center justify-center text-sm text-[var(--auth-muted)]">
              New here?
              <button type="button" onClick={() => { setMode("signup"); clearMessages(); }} className={textAction}>Create account</button>
            </p>
          </div>
        ) : null}

        {(mode === "signin" || mode === "signup") ? (
          <form onSubmit={(event) => void handleEmail(event, mode === "signup")} className="space-y-4">
            <div className="pb-4">
              <div className="flex items-center gap-2">
              <BackButton onClick={() => { setMode('choose'); setPassword(''); setConfirmPassword(''); clearMessages(); }} ariaLabel="Back to welcome" />
              <h1 className="text-2xl font-semibold leading-tight tracking-tight">
                {mode === "signup" ? "Create your account" : "Welcome back"}
              </h1>
              </div>
              {mode === "signup" ? (
                <p className="mt-3 text-sm leading-6 text-[var(--auth-muted)]">
                  Start with your email and a password.
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
                autoComplete={mode === "signup" ? "email" : "username"}
                required
                className={inputStyle}
              />
            </Field>
            <PasswordField
              label="Password"
              value={password}
              set={setPassword}
              visible={showPassword}
              toggle={() => setShowPassword((value) => !value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
            {mode === 'signup' ? legalLoading ? <p role="status" className="text-sm text-[var(--auth-muted)]">Checking signup requirements…</p> : legalError ? <div role="alert" className="text-sm text-red-200">Signup requirements could not be checked. <button type="button" onClick={() => setLegalReload(value => value + 1)} className={textAction}>Try again</button></div> : <LegalReview key={legalDocumentKey(legalDocuments)} documents={legalDocuments} choices={legalChoices} onChange={setLegalChoices} /> : null}
            <button
              type="submit"
              disabled={working || (mode === 'signup' && !legalReady) || !(mode === "signup" ? email : loginIdentifier).trim() || password.length < 8}
              className={primaryAction}
            >
              {working ? (mode === "signup" ? "Creating account…" : "Signing in…") : mode === "signup" ? "Create account" : "Sign in"}
            </button>
            {mode === "signin" ? (
              <button
                type="button"
                onClick={() => { setMode("forgot"); clearMessages(); }}
                className={`${textAction} w-full`}
              >
                Forgot password?
              </button>
            ) : null}
          </form>
        ) : null}

        {mode === "verify_email" ? (
          <div className="space-y-4">
            <section className="pb-4">
              <h1 className="text-2xl font-semibold leading-tight tracking-tight">Confirm your email</h1>
              <p className="mt-3 text-sm leading-6 text-[var(--auth-muted)]">
                Use the Google account for <span className="break-words font-medium text-[var(--auth-ink)]">{email.trim()}</span> to confirm it belongs to you.
              </p>
              <p className="mt-3 text-sm leading-6 text-[var(--auth-muted)]">
                You can still sign in with your email and password afterwards.
              </p>
            </section>
            <button
              type="button"
              onClick={() => void handleGoogle()}
              disabled={working}
              className={primaryAction}
            >
              <GoogleIcon />
              {working ? "Opening verification…" : "Verify with Google"}
            </button>
            <button
              type="button"
              onClick={() => { clearGoogleVerification(); setMode("signup"); setPassword(""); clearMessages(); }}
              disabled={working}
              className={`${textAction} w-full`}
            >
              Change email
            </button>
          </div>
        ) : null}

        {mode === "confirm_device" && deviceDetails ? (
          <div className="space-y-4">
            <section className="pb-4">
              <h1 className="text-2xl font-semibold leading-tight tracking-tight">Confirm this device</h1>
              <p className="mt-3 text-sm leading-6 text-[var(--auth-muted)]">
                Use the Google account for <span className="break-words font-medium text-[var(--auth-ink)]">{email.trim()}</span> to approve this sign-in.
              </p>
              <div className="mt-5 divide-y divide-[var(--auth-border)] border-y border-[var(--auth-border)]">
                <SecurityDetail label="Device" value={deviceDetails.device} />
                <SecurityDetail label="System" value={`${deviceDetails.os} · ${deviceDetails.browser}`} />
                <SecurityDetail label="Near" value={deviceDetails.location} />
              </div>
            </section>
            <button
              type="button"
              onClick={() => void handleGoogle()}
              disabled={working}
              className={primaryAction}
            >
              <GoogleIcon />
              {working ? "Opening verification…" : "Verify with Google"}
            </button>
            <button
              type="button"
              onClick={() => void cancelDeviceConfirmation()}
              disabled={working}
              className={`${textAction} w-full`}
            >
              Cancel this login
            </button>
          </div>
        ) : null}

        {mode === "google_mismatch" ? (
          <div className="space-y-4">
            <div role="alert" className="pb-4">
              <h1 className="text-2xl font-semibold leading-tight tracking-tight">Choose the matching account</h1>
              <p className="mt-3 break-words text-sm leading-6 text-[var(--auth-muted)]">
                This step can verify only <strong className="text-[var(--auth-ink)]">{loginIdentifier || email}</strong>. <strong className="text-[var(--auth-ink)]">{googleMismatchEmail || "The selected Google account"}</strong> was rejected and no account details were changed.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void chooseOriginalGoogleEmail()}
              disabled={working}
              className={primaryAction}
            >
              Choose the matching Google account
            </button>
            <button
              type="button"
              onClick={() => void returnFromGoogleMismatch()}
              disabled={working}
              className={`${textAction} w-full`}
            >
              Cancel verification
            </button>
          </div>
        ) : null}

        {mode === "forgot" ? (
          <form onSubmit={(event) => void handleForgot(event)} className="space-y-4">
            <div className="mb-5">
              <h1 className="text-2xl font-semibold leading-tight tracking-tight">Reset your password</h1>
              <p className="mt-3 text-sm leading-6 text-[var(--auth-muted)]">
                Enter your username or email. You’ll confirm with the Google account linked to WeHouse.
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
                autoComplete="username"
                required
                className={inputStyle}
              />
            </Field>
            <button
              type="submit"
              disabled={working || !loginIdentifier.trim()}
              className={primaryAction}
            >
              <span className="inline-flex items-center justify-center gap-2"><GoogleIcon />{working ? "Opening Google…" : "Confirm with Google"}</span>
            </button>
            <button type="button" onClick={() => { setMode("signin"); clearMessages(); }} className={`${textAction} w-full`}>
              Back to sign in
            </button>
          </form>
        ) : null}

        {mode === "recover" ? (
          <form onSubmit={(event) => void handleRecovery(event)} className="space-y-4">
            <div className="mb-5">
              <h1 className="text-2xl font-semibold leading-tight tracking-tight">Choose a new password</h1>
              <p className="mt-3 text-sm leading-6 text-[var(--auth-muted)]">
                Confirmed as <span className="font-semibold text-[var(--auth-ink)]">{loginIdentifier || email}</span>. Choose a new password.
              </p>
            </div>
            {!recoveryReady ? (
              <p role="status" className="text-sm text-[var(--auth-muted)]">Finishing confirmation…</p>
            ) : null}
            <PasswordField label="New password" value={password} set={setPassword} visible={showPassword} toggle={() => setShowPassword((value) => !value)} />
            <PasswordField label="Confirm new password" value={confirmPassword} set={setConfirmPassword} visible={showPassword} toggle={() => setShowPassword((value) => !value)} />
            <button
              type="submit"
              disabled={working || !recoveryReady || password.length < 8 || password !== confirmPassword}
              className={primaryAction}
            >
              {working ? "Updating…" : "Save new password"}
            </button>
            <button type="button" onClick={() => void cancelRecovery()} className={`${textAction} w-full`}>
              Cancel and return to sign in
            </button>
          </form>
        ) : null}
        </fieldset>
        </div>
        <nav aria-label="Legal information" className="wh-auth-legal flex flex-wrap items-center justify-center gap-x-6 text-xs text-[var(--auth-muted)]">
          <button type="button" onClick={() => onOpenLegal("terms_of_service")} className="min-h-11 rounded-md hover:text-violet-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300">Terms of Service</button>
          <button type="button" onClick={() => onOpenLegal("privacy_policy")} className="min-h-11 rounded-md hover:text-violet-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300">Privacy Policy</button>
        </nav>
        </section>
      </main>
    </AuthSurface>
    </GuestBrowseEntry>
  );
}

function AuthSurface({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousTheme = theme?.content;
    document.documentElement.classList.add("wh-auth-open");
    document.body.classList.add("wh-auth-open");
    if (theme) theme.content = "#090B10";
    return () => {
      document.documentElement.classList.remove("wh-auth-open");
      document.body.classList.remove("wh-auth-open");
      if (theme && previousTheme !== undefined) theme.content = previousTheme;
    };
  }, []);
  return <div className="wh-auth-screen">{children}</div>;
}

function Brand() {
  return (
    <div className="wh-auth-brand">
      <div className="wh-auth-wordmark">
        <img src="/app-icon.svg?v=3" alt="" width={52} height={52} className="h-[52px] w-[52px]" />
        <p className="text-[30px] font-semibold tracking-tight">WeHouse</p>
      </div>
      <p className="wh-auth-tagline">Find. Connect. Live better.</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-[var(--auth-ink)]">{label}</span>
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
  autoComplete = "new-password",
}: {
  label: string;
  value: string;
  set: (value: string) => void;
  visible: boolean;
  toggle: () => void;
  autoComplete?: "current-password" | "new-password";
}) {
  return (
    <Field label={label}>
      <div className="relative">
        <Input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => set(event.target.value)}
          placeholder={autoComplete === "new-password" ? "At least 8 characters" : "Enter your password"}
          minLength={8}
          autoComplete={autoComplete}
          required
          className={`${inputStyle} pr-14`}
        />
        <button type="button" onClick={toggle} aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible} className="absolute right-1 top-1/2 min-h-11 min-w-11 -translate-y-1/2 rounded-lg text-xs text-[var(--auth-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">
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
    ? "border-red-500/25 bg-red-500/10 text-red-200"
    : tone === "warning"
      ? "border-amber-500/25 bg-amber-500/10 text-amber-200"
      : "border-violet-500/25 bg-violet-500/10 text-violet-200";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`mb-4 rounded-xl border p-3 text-sm leading-5 ${className}`}>
      {title ? <p className="mb-1 text-xs font-semibold">{title}</p> : null}
      {children}
    </div>
  );
}

function SecurityDetail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 text-xs">
      <span className="text-[var(--auth-muted)]">{label}</span>
      <span className="text-right font-medium text-[var(--auth-ink)]">{value || "Unavailable"}</span>
    </div>
  );
}

function Divider() {
  return (
    <div className="my-5 flex items-center gap-4" aria-hidden="true">
      <span className="h-px flex-1 bg-[var(--auth-border)]" />
      <span className="text-xs text-[var(--auth-muted)]">or</span>
      <span className="h-px flex-1 bg-[var(--auth-border)]" />
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
