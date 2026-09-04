import { useEffect, useRef, useState } from "react";
import {
  supabase,
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  runDiagnostics,
  getProfileByAuthId,
} from "@/lib/supabase";
import type { DeviceRegistration } from "@/lib/supabase";
import { Input } from "@/components/ui/input";

type PublicRole = "user" | "worker" | "property_partner";
type Mode =
  | "choose"
  | "choose_role"
  | "signin"
  | "signup"
  | "verify_email"
  | "confirm_device"
  | "google_mismatch"
  | "forgot"
  | "recover";
type PendingMethod = "authenticated" | "email" | null;
interface LoginProps {
  onLoginSuccess: (authId: string, email: string, role?: PublicRole) => void;
  serverError: string;
  kickedOut?: boolean;
  pendingDevice?: DeviceRegistration | null;
}

function legacyRecoveryRequested() {
  try {
    return (
      new URLSearchParams(window.location.search).get("auth") === "recovery"
    );
  } catch {
    return false;
  }
}
function googleRecoveryRequested() {
  try {
    return sessionStorage.getItem("wh_google_verify_context") === "password_recovery";
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
    return "This verification session has expired. Start again.";
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
  pendingDevice,
}: LoginProps) {
  const [mode, setMode] = useState<Mode>(() =>
      googleRecoveryRequested() ? "recover" : legacyRecoveryRequested() ? "forgot" : "choose",
    ),
    [signupRole, setSignupRole] = useState<PublicRole>("user"),
    [pendingMethod, setPendingMethod] = useState<PendingMethod>(null),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [info, setInfo] = useState(""),
    [diag, setDiag] = useState<string | null>(null),
    [recoveryReady, setRecoveryReady] = useState(false);
  const [googleMismatchEmail,setGoogleMismatchEmail]=useState('');
  const authenticatedIdentityRef = useRef<string | null>(null);

  useEffect(()=>{
    if(!pendingDevice)return;
    setMode('confirm_device');
    void supabase.auth.getUser().then(({data})=>{if(data.user?.email)setEmail(data.user.email)});
  },[pendingDevice]);

  useEffect(()=>{
    const sessionId=pendingDevice?.sessionId;
    if(!sessionId)return;
    let active=true;
    async function apply(status:string){
      if(!active)return;
      if(status==='trusted'){
        const{data}=await supabase.auth.getUser();
        if(data.user)await onLoginSuccess(data.user.id,data.user.email||'');
      }else if(status==='rejected'){
        await supabase.auth.signOut({scope:'local'});
        if(!active)return;
        setMode('choose');setPassword('');setError('That sign-in was rejected. Your account remains protected.');
      }
    }
    const channel=supabase.channel(`pending-device:${sessionId}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'user_sessions',filter:`id=eq.${sessionId}`},payload=>void apply(String((payload.new as{trust_status?:string}).trust_status||''))).subscribe();
    return()=>{active=false;void supabase.removeChannel(channel)};
  },[onLoginSuccess,pendingDevice?.sessionId]);

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
      setRecoveryReady(false);
      const expectedEmail = sessionStorage.getItem("wh_google_verify_email")?.trim().toLowerCase() || "";
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!alive || sessionError || !data.session?.user) return;
      const returnedEmail = data.session.user.email?.trim().toLowerCase() || "";
      if (!expectedEmail || returnedEmail !== expectedEmail) {
        setEmail(expectedEmail);
        setGoogleMismatchEmail(returnedEmail);
        setMode("google_mismatch");
        return;
      }
      const { data: verified, error: verifyError } = await supabase.rpc("verify_google_password_recovery");
      if (!alive) return;
      if (verifyError || !(verified as { success?: boolean } | null)?.success) {
        sessionStorage.removeItem("wh_google_verify_email");
        sessionStorage.removeItem("wh_google_verify_context");
        await supabase.auth.signOut({ scope: "local" });
        if (!alive) return;
        setMode("forgot");
        setError("That Google account is not connected to an existing WeHouse account.");
        return;
      }
      setEmail(expectedEmail);
      setRecoveryReady(true);
    }
    void check();
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!alive) return;
        if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user)
          window.setTimeout(() => { if (alive) void check(); }, 0);
      },
    );
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
      setInfo("Password recovery now uses your matching Google account instead of an emailed code or link.");
    })();
    return () => { active = false; };
  }, []);

  // Only unaffiliated authenticated identities need role selection here. Existing
  // WeHouse profiles are routed by useAuth, not by this screen.
  useEffect(() => {
    if (mode === "recover" || legacyRecoveryRequested() || googleRecoveryRequested()) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (cancelled || !user) return;
      if(user.email&&!user.email_confirmed_at){setEmail(user.email);setMode('verify_email');return;}
      const expectedGoogleEmail=sessionStorage.getItem('wh_google_verify_email');
      const pendingGoogleRole=sessionStorage.getItem('wh_google_verify_role') as PublicRole|null;
      if(expectedGoogleEmail&&user.email?.toLowerCase()!==expectedGoogleEmail){
        setEmail(expectedGoogleEmail);setGoogleMismatchEmail(user.email||'');setMode('google_mismatch');
        return;
      }
      if (authenticatedIdentityRef.current === user.id) return;
      const { profile } = await getProfileByAuthId(user.id);
      if (cancelled || profile) return;
      authenticatedIdentityRef.current = user.id;
      const metadataRole = (user.user_metadata?.signup_role||pendingGoogleRole) as PublicRole|undefined;
      if (
        metadataRole &&
        ["user", "worker", "property_partner"].includes(metadataRole)
      ) {
        sessionStorage.removeItem('wh_google_verify_email');sessionStorage.removeItem('wh_google_verify_role');
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
        sessionStorage.setItem('wh_google_verify_email',clean.toLowerCase());
        sessionStorage.setItem('wh_google_verify_role',signupRole);
        sessionStorage.setItem('wh_google_verify_context','signup');
        sessionStorage.setItem('wh_login_method','signup');
        const { data, error: err } = await withTimeout(
          signUpWithEmail(clean, password, signupRole),
          15000,
        );
        if (err) {
          if(err.message.toLowerCase().includes('email not confirmed'))setMode('verify_email');
          else{
            sessionStorage.removeItem('wh_google_verify_email');
            sessionStorage.removeItem('wh_google_verify_role');
            sessionStorage.removeItem('wh_google_verify_context');
            sessionStorage.removeItem('wh_login_method');
          }
          return setError(friendlyError(err.message));
        }
        if (data.session?.user) {
          setMode('verify_email');
          return;
        }
        if (data.user) {
          setMode('verify_email');
          return;
        }
        setError("Signup incomplete. Please try again.");
      } else {
        sessionStorage.setItem('wh_login_method','password');
        const { data, error: err } = await withTimeout(
          signInWithEmail(clean, password),
          15000,
        );
        if (err){sessionStorage.removeItem('wh_login_method');return setError(friendlyError(err.message));}
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
    if(mode==='verify_email'||mode==='confirm_device'){
      sessionStorage.setItem('wh_google_verify_email',email.trim().toLowerCase());
      sessionStorage.setItem('wh_google_verify_role',signupRole);
      sessionStorage.setItem('wh_google_verify_context',mode==='confirm_device'?'new_device':'signup');
    }else{
      sessionStorage.removeItem('wh_google_verify_email');
      sessionStorage.removeItem('wh_google_verify_role');
      sessionStorage.removeItem('wh_google_verify_context');
      sessionStorage.removeItem('wh_login_method');
    }
    setWorking(true);
    const { error: err } = await signInWithGoogle();
    if (err) {
      setError(friendlyError(err.message));
      setWorking(false);
    }
  }
  async function chooseOriginalGoogleEmail(){
    const context=sessionStorage.getItem('wh_google_verify_context');
    const role=(sessionStorage.getItem('wh_google_verify_role') as PublicRole|null)||signupRole;
    setWorking(true);await supabase.auth.signOut({scope:'local'});setWorking(false);
    setMode(context==='new_device'?'confirm_device':context==='password_recovery'?'recover':'verify_email');setGoogleMismatchEmail('');clearMessages();
    sessionStorage.setItem('wh_google_verify_email',email.trim().toLowerCase());
    if(context!=='password_recovery')sessionStorage.setItem('wh_google_verify_role',role);
    else sessionStorage.removeItem('wh_google_verify_role');
    sessionStorage.setItem('wh_google_verify_context',context||'signup');
    setWorking(true);const{error:googleError}=await signInWithGoogle();
    if(googleError){setWorking(false);setError(friendlyError(googleError.message));}
  }
  async function cancelDeviceConfirmation(){
    setWorking(true);
    await supabase.auth.signOut({scope:'local'});
    sessionStorage.removeItem('wh_google_verify_email');
    sessionStorage.removeItem('wh_google_verify_role');
    sessionStorage.removeItem('wh_google_verify_context');
    sessionStorage.removeItem('wh_pending_device_session');
    sessionStorage.removeItem('wh_login_method');
    setWorking(false);setMode('choose');setPassword('');clearMessages();
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
      sessionStorage.setItem("wh_google_verify_email", email.trim().toLowerCase());
      sessionStorage.setItem("wh_google_verify_context", "password_recovery");
      sessionStorage.removeItem("wh_google_verify_role");
      sessionStorage.removeItem("wh_login_method");
      const { error: err } = await signInWithGoogle();
      if (err) {
        sessionStorage.removeItem("wh_google_verify_email");
        sessionStorage.removeItem("wh_google_verify_context");
        setError(friendlyError(err.message));
      }
    } catch (recoveryError: unknown) {
      sessionStorage.removeItem("wh_google_verify_email");
      sessionStorage.removeItem("wh_google_verify_context");
      setError(friendlyError(errorMessage(recoveryError, "Google verification could not start")));
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
          "Google verification is not ready. Start password recovery again.",
        );
      const expectedEmail = sessionStorage.getItem("wh_google_verify_email")?.trim().toLowerCase() || "";
      if (!expectedEmail || session.user.email?.trim().toLowerCase() !== expectedEmail)
        return setError("The Google account must match the WeHouse account email exactly.");
      const { data: verified, error: verifyError } = await supabase.rpc("verify_google_password_recovery");
      if (verifyError || !(verified as { success?: boolean } | null)?.success)
        return setError("Google could not verify this WeHouse account. Start recovery again.");
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) return setError(friendlyError(err.message));
      sessionStorage.removeItem("wh_google_verify_email");
      sessionStorage.removeItem("wh_google_verify_context");
      await supabase.auth.signOut({ scope: "local" });
      window.history.replaceState({}, "", window.location.pathname);
      setPassword("");
      setConfirmPassword("");
      setRecoveryReady(false);
      setMode("signin");
      setInfo("Password changed. Sign in with your new password.");
    } catch (error: unknown) {
      setError(friendlyError(errorMessage(error, "Password reset failed")));
    } finally {
      setWorking(false);
    }
  }
  async function cancelRecovery() {
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    sessionStorage.removeItem("wh_google_verify_email");
    sessionStorage.removeItem("wh_google_verify_context");
    window.history.replaceState({}, "", window.location.pathname);
    setPassword("");
    setConfirmPassword("");
    setRecoveryReady(false);
    setMode("signin");
    clearMessages();
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

        {mode === "recover" && (
          <form onSubmit={handleRecovery} className="space-y-4">
            <div className="mb-5">
              <p className="text-lg font-semibold">Create a new password</p>
              <p className="mt-1 text-xs leading-relaxed text-[#73788A]">
                Google confirmed <span className="font-semibold text-white">{email}</span> as the same email on this WeHouse account.
              </p>
            </div>
            {!recoveryReady && (
              <div className="rounded-xl border border-amber-500/15 bg-amber-500/[.05] p-3 text-[10px] text-amber-300">
                Confirming the Google account and matching WeHouse account…
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
              disabled={
                working ||
                !recoveryReady ||
                password.length < 8 ||
                password !== confirmPassword
              }
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

        {mode === 'verify_email'&&<div className="space-y-4"><div className="text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-violet-400/15 bg-violet-500/10 text-violet-300"><ShieldCheckIcon/></div><p className="mt-4 text-[9px] font-bold uppercase tracking-[.2em] text-violet-300">CONFIRM YOUR EMAIL</p><h2 className="mt-2 text-xl font-semibold">Prove this email is yours</h2><p className="mt-2 text-xs leading-5 text-[#858B9A]">Continue with the Google account for <span className="font-semibold text-white">{email.trim()}</span>. WeHouse will confirm ownership and finish this same email-and-password account.</p></div><button type="button" onClick={()=>void handleGoogle()} disabled={working} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-[#0A0A0F] disabled:opacity-50"><GoogleIcon/>Confirm with Google</button><p className="text-center text-[9px] leading-4 text-[#666C7D]">The Google email must match exactly. After confirmation, either Google or your password opens the same WeHouse account.</p><button type="button" onClick={()=>{setMode('signup');setPassword('');clearMessages()}} disabled={working} className="w-full text-center text-xs text-[#73798A]">Change signup email</button></div>}

        {mode==='confirm_device'&&pendingDevice&&<div className="space-y-4"><section className="overflow-hidden rounded-[28px] border border-white/[.08] bg-gradient-to-b from-[#151925] to-[#10131B] shadow-2xl"><div className="border-b border-white/[.06] p-5"><div className="flex items-start justify-between gap-3"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/12 text-violet-300"><ShieldCheckIcon/></div><span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[8px] font-bold tracking-[.14em] text-amber-300">NEW DEVICE</span></div><h2 className="mt-5 text-xl font-bold">Confirm this sign-in</h2><p className="mt-2 text-[10px] leading-5 text-[#858B9A]">Your password was correct. Confirm the same email with Google before this device can enter WeHouse.</p></div><div className="space-y-3 p-5"><SecurityDetail label="Device" value={pendingDevice.device}/><SecurityDetail label="System" value={`${pendingDevice.os} · ${pendingDevice.browser}`}/><SecurityDetail label="Approximate location" value={pendingDevice.location}/><SecurityDetail label="Time" value={new Date().toLocaleString()}/></div></section><button type="button" onClick={()=>void handleGoogle()} disabled={working} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-[#0A0A0F] disabled:opacity-50"><GoogleIcon/>Confirm with Google</button><button type="button" onClick={()=>void cancelDeviceConfirmation()} disabled={working} className="h-11 w-full rounded-xl border border-red-500/15 bg-red-500/[.04] text-xs font-semibold text-red-300 disabled:opacity-50">This was not me</button></div>}

        {mode==='google_mismatch'&&<div className="space-y-4"><div className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-4"><p className="text-sm font-semibold text-amber-200">That Google account does not match</p><p className="mt-2 text-[10px] leading-5 text-[#A4A8B3]">WeHouse must confirm <strong className="text-white">{email}</strong>, but Google returned <strong className="text-white">{googleMismatchEmail}</strong>. Access remains blocked.</p></div><button type="button" onClick={()=>void chooseOriginalGoogleEmail()} disabled={working} className="h-12 w-full rounded-xl bg-white text-sm font-semibold text-[#0A0A0F] disabled:opacity-50">Choose the correct Google account</button><button type="button" onClick={()=>void (googleRecoveryRequested()?cancelRecovery():cancelDeviceConfirmation())} disabled={working} className="w-full text-center text-xs text-[#73798A]">Cancel and return to sign in</button></div>}

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
              disabled={
                working ||
                !email.trim() ||
                !email.includes("@") ||
                password.length < 8
              }
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
                className="w-full text-center text-xs text-violet-400"
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
                Enter your WeHouse email, then use the same Google account to confirm it belongs to you.
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
              disabled={working || !email.trim() || !email.includes("@")}
              className="h-12 w-full rounded-xl bg-white text-sm font-semibold text-[#0A0A0F] disabled:opacity-50"
            >
              <span className="inline-flex items-center justify-center gap-2"><GoogleIcon />{working ? "Opening Google…" : "Continue with Google"}</span>
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
      className="w-full rounded-2xl border border-white/[.07] bg-[#141720] p-4 text-left transition hover:border-violet-500/25"
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
function ShieldCheckIcon(){
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z"/><path d="m9 12 2 2 4-4"/></svg>;
}
function SecurityDetail({label,value}:{label:string;value:string}){
  return <div className="flex items-start justify-between gap-5"><span className="text-[9px] text-[#656C7D]">{label}</span><strong className="text-right text-[10px] font-semibold text-[#D7DAE3]">{value}</strong></div>;
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
        : "border-violet-500/20 bg-violet-500/10 text-violet-300";
  return (
    <div
      className={`mb-4 rounded-xl border p-3 text-center text-xs leading-relaxed ${cls}`}
    >
      {title && <p className="mb-1 font-semibold">{title}</p>}
      {children}
    </div>
  );
}
