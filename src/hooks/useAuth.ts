import { useState, useEffect, useCallback, useRef } from "react";
import {
  supabase,
  getProfileByAuthId,
  createProfile,
  trackSession,
  endSession,
  createUserSession,
  registerUserSession,
  confirmCurrentDeviceWithGoogle,
  deactivateUserSession,
  getStoredSessionId,
  clearStoredSessionId,
  getUserSessionState,
  updateSessionLastSeen,
} from "@/lib/supabase";
import type { Profile, Page } from "@/types";
import type { User } from "@supabase/supabase-js";
import type { DeviceRegistration } from "@/lib/supabase";
import {
  clearGoogleVerification,
  readGoogleVerification,
  saveGoogleVerification,
} from "@/lib/googleVerification";
interface AuthState {
  page: Page;
  profile: Profile | null;
  isLoading: boolean;
  error: string;
  kickedOut?: boolean;
  pendingDevice?: DeviceRegistration | null;
}
type PublicRole = "user" | "worker" | "property_partner";
const LEGACY_PROFILE_SNAPSHOT_KEY = "wh_profile_snapshot_v1";
const PROFILE_SNAPSHOT_PREFIX = "wh_profile_snapshot_v2:";
const PROFILE_SNAPSHOT_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const SNAPSHOT_EXCLUDED_FIELDS = new Set([
  "bank_name",
  "bank_code",
  "bank_account_number",
  "paystack_subaccount_code",
  "paystack_transfer_recipient",
  "worker_gov_id_url",
  "worker_cert_url",
  "precise_latitude",
  "precise_longitude",
  "precise_address",
  "precise_location_accuracy_m",
]);

function pageForProfile(p: Profile | null): Page {
  if (!p) return "login";
  if (p.role === "worker") return "worker_dashboard";
  if (!p.profile_complete) return "setup";
  if (isCreator(p.role)) return "creator";
  if (p.role === "admin") return "admin";
  if (p.role === "staff") return "staff_dashboard";
  if (p.role === "property_partner") return "property_partner";
  return "dashboard";
}

function profileSnapshotKey(authId: string) {
  return `${PROFILE_SNAPSHOT_PREFIX}${authId}`;
}

function readProfileSnapshot(authId: string): Profile | null {
  try {
    // A cached role is read only after Supabase has confirmed the active auth id.
    // Never use the old shared snapshot to decide which workspace to render.
    localStorage.removeItem(LEGACY_PROFILE_SNAPSHOT_KEY);
    const parsed = JSON.parse(localStorage.getItem(profileSnapshotKey(authId)) || "null");
    const profile = parsed?.profile as Profile | undefined;
    if (
      profile?.auth_id !== authId ||
      !profile.user_id ||
      !profile.role ||
      Date.now() - Number(parsed.saved_at || 0) > PROFILE_SNAPSHOT_MAX_AGE
    ) {
      localStorage.removeItem(profileSnapshotKey(authId));
      return null;
    }
    return profile;
  } catch {
    return null;
  }
}

function saveProfileSnapshot(profile: Profile) {
  try {
    const safeProfile = Object.fromEntries(
      Object.entries(profile).filter(([key]) => !SNAPSHOT_EXCLUDED_FIELDS.has(key)),
    );
    localStorage.setItem(
      profileSnapshotKey(profile.auth_id),
      JSON.stringify({ profile: safeProfile, saved_at: Date.now() }),
    );
  } catch {}
}

function clearProfileSnapshot(authId?: string) {
  try {
    localStorage.removeItem(LEGACY_PROFILE_SNAPSHOT_KEY);
    if (authId) {
      localStorage.removeItem(profileSnapshotKey(authId));
      return;
    }
    const cachedKeys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(PROFILE_SNAPSHOT_PREFIX)) cachedKeys.push(key);
    }
    cachedKeys.forEach((key) => localStorage.removeItem(key));
  } catch {}
}

async function wipeOnLogout() {
  try {
    const keys: string[] = [];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (
        k &&
        (k.includes("sb-") || k.includes("supabase") || k.startsWith("wh_"))
      )
        keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
  } catch {}
}
function publicRole(value: unknown): PublicRole | undefined {
  return value === "user" || value === "worker" || value === "property_partner"
    ? value
    : undefined;
}
function safeAuthMessage(error: unknown, fallback = "We couldn’t complete sign-in. Please try again.") {
  const message = error instanceof Error ? error.message : String(error || "");
  const value = message.toLowerCase();
  if (value.includes("maintenance")) return "WeHouse is currently under maintenance. Please check back later.";
  if (value.includes("registrations") && value.includes("closed")) return "New registrations are currently closed.";
  if (value.includes("pending device") || value.includes("confirmation expired")) return "This confirmation has expired. Sign in again.";
  if (value.includes("network") || value.includes("fetch") || value.includes("connection")) return "Check your connection and try again.";
  if (value.includes("banned")) return "This account is unavailable. Contact WeHouse support.";
  if (value.includes("suspended")) return "This account is suspended. Contact WeHouse support.";
  return fallback;
}
function passwordRecoveryRequested() {
  try {
    return (
      new URLSearchParams(window.location.search).get("auth") === "recovery"
    );
  } catch {
    return false;
  }
}
function googlePasswordRecoveryRequested() {
  return readGoogleVerification()?.context === "password_recovery";
}
function googleVerificationCallbackFailed() {
  try {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return Boolean(query.get("error") || query.get("error_description") || hash.get("error") || hash.get("error_description"));
  } catch {
    return false;
  }
}
function googleVerificationActive() {
  return Boolean(readGoogleVerification());
}
function roleRoot(p: Profile) {
  return p.role === "creator"
    ? "creator"
    : p.role === "admin"
      ? "admin"
      : p.role === "staff"
        ? "staff_dashboard"
        : p.role === "worker"
          ? "worker_dashboard"
          : p.role === "property_partner"
            ? "property_partner"
            : "search";
}
function syncIdentityNavigation(p: Profile) {
  try {
    const key = "wh_auth_identity";
    const previous = localStorage.getItem(key);
    localStorage.setItem(key, p.auth_id);
    if (previous === p.auth_id) return;
    const page = roleRoot(p);
    localStorage.setItem("wh_navpage", page);
    window.history.replaceState({ page }, "", `#${page}`);
    window.dispatchEvent(new PopStateEvent("popstate", { state: { page } }));
  } catch {}
}
async function ensurePropertyPartnerRecord() {
  const { error } = await supabase.rpc("get_or_create_my_property_partner");
  if (error) throw error;
}
const ADMIN_ROLES = new Set(["creator", "admin"]);
export const hasAdminAccess = (r: string) => ADMIN_ROLES.has(r);
export const isStaff = (r: string) => r === "staff";
export const canCreateListings = (r: string) => hasAdminAccess(r);
export const isAdmin = (r: string) => r === "admin";
export const isCreator = (r: string) => r === "creator";
export const canSendAnnouncements = (r: string) => isCreator(r) || isAdmin(r);
export function getScope(r: string): "global" | "local" | null {
  return isCreator(r) ? "global" : isAdmin(r) || r === "staff" ? "local" : null;
}
export const isGlobal = (r: string) => getScope(r) === "global";
export function canModifyRole(m: string, t: string) {
  if (isCreator(m)) return ["user", "staff", "admin"].includes(t);
  if (isAdmin(m)) return ["user", "staff"].includes(t);
  return false;
}
export function validateRoleTransition(
  m: string,
  c: string,
  n: string,
): { allowed: boolean; reason?: string } {
  if (isCreator(c))
    return { allowed: false, reason: "Creator role cannot be modified" };
  if (isCreator(n))
    return { allowed: false, reason: "Creator role cannot be assigned" };
  if (c === "worker" || n === "worker")
    return {
      allowed: false,
      reason: "Worker role is managed through worker registration.",
    };
  if (c === "property_partner" || n === "property_partner")
    return {
      allowed: false,
      reason: "Property Partner role is managed through partner registration.",
    };
  if (
    isCreator(m) &&
    ["user", "staff", "admin"].includes(c) &&
    ["user", "staff", "admin"].includes(n)
  )
    return { allowed: true };
  if (
    isAdmin(m) &&
    ["user", "staff"].includes(c) &&
    ["user", "staff"].includes(n)
  )
    return { allowed: true };
  return { allowed: false, reason: "You cannot make that role change" };
}
async function setting(key: string) {
  try {
    const { data } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    return data?.value == null ? null : String(data.value);
  } catch {
    return null;
  }
}
async function maintenance() {
  const v = await setting("maintenance_mode");
  return v === "true" || v === "on" || v === "1";
}
async function registrationClosed() {
  const v = await setting("registration_open");
  return v === "false" || v === "closed" || v === "0";
}
export function useAuth() {
  const [state, setState] = useState<AuthState>({
    page: "loading",
    profile: null,
    isLoading: true,
    error: "",
    kickedOut: false,
  });
  const handlingLoginRef = useRef(false),
    explicitSignOutRef = useRef(false),
    logoutBusyRef = useRef(false),
    profileLoadRef = useRef<{ authId: string; promise: Promise<void> } | null>(null),
    profileRequestRef = useRef(0),
    confirmedAuthIdRef = useRef<string | null>(null),
    aliveRef = useRef(true),
    kickoutBusyRef = useRef(false);
  const determinePage = useCallback(pageForProfile, []);
  useEffect(() => {
    if (!state.isLoading || state.profile) return;
    let verificationActive = false;
    try {
      verificationActive = Boolean(readGoogleVerification());
    } catch {}
    if (!verificationActive) return;
    const timer = window.setTimeout(() => {
      setState((current) =>
        current.isLoading && !current.profile
          ? {
              page: "login",
              profile: null,
              isLoading: false,
              error: "Google verification did not finish. Choose the matching account and try again.",
              kickedOut: false,
            }
          : current,
      );
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [state.isLoading, state.profile]);
  const allowEntry = useCallback(async (p: Profile, maintenanceEnabled?: boolean) => {
    if (p.banned || p.suspended || p.deleted) {
      explicitSignOutRef.current = true;
      await supabase.auth.signOut({ scope: "local" });
      await wipeOnLogout();
      setState({
        page: "login",
        profile: null,
        isLoading: false,
        error: p.banned
          ? "Your account has been permanently banned. Contact support for assistance."
          : p.suspended
            ? "Your account has been suspended. Contact support for assistance."
            : "This account has been deleted.",
      });
      return false;
    }
    if (
      !isCreator(p.role) &&
      !(p as any).maintenance_exempt &&
      (maintenanceEnabled ?? (await maintenance()))
    ) {
      setState({
        page: "login",
        profile: null,
        isLoading: false,
        error:
          "WeHouse is currently under maintenance. Please check back later.",
      });
      return false;
    }
    return true;
  }, []);
  const loadProfile = useCallback(
    async (
      authId: string,
      {
        preserveOnFailure = false,
        user: suppliedUser,
      }: { preserveOnFailure?: boolean; user?: User } = {},
    ) => {
      if (profileLoadRef.current?.authId === authId) return profileLoadRef.current.promise;
      const request = ++profileRequestRef.current;
      const isCurrentIdentity = () =>
        confirmedAuthIdRef.current === authId && profileRequestRef.current === request;
      const task = (async () => {
        try {
          if (googlePasswordRecoveryRequested()) {
            setState({ page: "login", profile: null, isLoading: false, error: "", kickedOut: false });
            return;
          }
          const user = suppliedUser ?? (await supabase.auth.getUser()).data?.user;
          const email = user?.email || "";
          if(user?.email&&!user.email_confirmed_at){
            setState({page:'login',profile:null,isLoading:false,error:'',kickedOut:false});
            return;
          }
          const verification = readGoogleVerification();
          const expectedGoogleEmail=verification?.email;
          if(expectedGoogleEmail&&email.trim().toLowerCase()!==expectedGoogleEmail.trim().toLowerCase()){
            explicitSignOutRef.current = true;
            confirmedAuthIdRef.current = null;
            await supabase.auth.signOut({scope:'local'}).catch(()=>{});
            setState({
              page:'login',
              profile:null,
              isLoading:false,
              error:`${email || 'The selected Google account'} cannot verify ${expectedGoogleEmail}. Choose ${expectedGoogleEmail} to continue. No WeHouse account or password was changed.`,
              kickedOut:false,
            });
            return;
          }
          if(verification?.context==='signup'&&!user?.identities?.some(identity=>identity.provider==='google')){
            setState({page:'login',profile:null,isLoading:false,error:'',kickedOut:false});
            return;
          }
          if(verification?.context==='new_device'){
            const pendingSession=verification.pendingDeviceSessionId;
            if(!pendingSession)throw new Error('The pending device confirmation expired. Sign in again.');
            const confirmed=await confirmCurrentDeviceWithGoogle(pendingSession);
            if(confirmed.error)throw confirmed.error;
            clearGoogleVerification();
          }
          const [profileResult, maintenanceEnabled] = await Promise.all([
            getProfileByAuthId(authId, email),
            maintenance(),
          ]);
          const { profile: existing, error } = profileResult;
          if (error) {
            if (!preserveOnFailure)
              setState((s) => ({
                ...s,
                isLoading: false,
                error:
                  "We could not load your account. Check your connection and try again.",
              }));
            return;
          }
          let profile = existing;
          if (!profile) {
            const role = publicRole(user?.user_metadata?.signup_role)||publicRole(verification?.role);
            if (role) {
              if (maintenanceEnabled)
                throw new Error("WeHouse is currently under maintenance.");
              if (await registrationClosed())
                throw new Error("New registrations are currently closed.");
              const created = await createProfile(authId, email, role);
              if (created.error || !created.profile)
                throw created.error || new Error("Could not create account");
              profile = created.profile;
              clearGoogleVerification();
              if (role === "property_partner")
                await ensurePropertyPartnerRecord();
            } else {
              setState({
                page: "login",
                profile: null,
                isLoading: false,
                error: "",
                kickedOut: false,
              });
              return;
            }
          }
          if (verification?.context === "signup" && user?.identities?.some(identity => identity.provider === "google"))
            clearGoogleVerification();
          const registration=await registerUserSession(profile.user_id,authId);
          if(sessionStorage.getItem('wh_login_method')==='password'&&registration.trustStatus==='pending'){
            if(registration.sessionId)saveGoogleVerification({context:'new_device',email:profile.email||email,pendingDeviceSessionId:registration.sessionId,device:registration.device,os:registration.os,browser:registration.browser,location:registration.location});
            setState({page:'login',profile:null,isLoading:false,error:'',kickedOut:false,pendingDevice:registration});
            return;
          }
          sessionStorage.removeItem('wh_login_method');
          if (isCurrentIdentity() && await allowEntry(profile, maintenanceEnabled)) {
            saveProfileSnapshot(profile);
            syncIdentityNavigation(profile);
            setState({
              profile,
              page: determinePage(profile),
              isLoading: false,
              error: "",
              kickedOut: false,
              pendingDevice: null,
            });
          }
        } catch (e: any) {
          if (!preserveOnFailure && isCurrentIdentity())
            setState((s) => ({
              ...s,
              isLoading: false,
              error:
                safeAuthMessage(e, "We couldn’t restore your session. Please sign in again."),
            }));
        } finally {
          if (profileLoadRef.current?.authId === authId && profileRequestRef.current === request)
            profileLoadRef.current = null;
        }
      })();
      profileLoadRef.current = { authId, promise: task };
      return task;
    },
    [allowEntry, determinePage],
  );
  useEffect(() => {
    aliveRef.current = true;
    let alive = true;
    let authEventTimer: number | undefined;
    async function restore() {
      setState((s) => (s.profile ? s : { ...s, page: "loading", isLoading: true }));
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!alive) return;
        if (passwordRecoveryRequested() || googlePasswordRecoveryRequested() || googleVerificationCallbackFailed()) {
          setState({
            page: "login",
            profile: null,
            isLoading: false,
            error: "",
            kickedOut: false,
          });
          return;
        }
        if (data.session?.user) {
          const authId = data.session.user.id;
          confirmedAuthIdRef.current = authId;
          const snapshot = readProfileSnapshot(authId);
          const snapshotMatches = Boolean(snapshot);
          if (snapshot) {
            setState({profile:snapshot,page:pageForProfile(snapshot),isLoading:false,error:"",kickedOut:false});
          } else {
            setState((s) => ({ ...s, profile: null, page: "loading", isLoading: true }));
          }
          await loadProfile(data.session.user.id, {
            preserveOnFailure: snapshotMatches,
            user: data.session.user,
          });
          return;
        }
        confirmedAuthIdRef.current = null;
        clearProfileSnapshot();
        setState({
          page: "login",
          profile: null,
          isLoading: false,
          error: "",
          kickedOut: false,
        });
      } catch (e: any) {
        if (alive)
          setState({
            page: "login",
            profile: null,
            isLoading: false,
            error:
              safeAuthMessage(e, "Unable to restore your session. Please sign in again."),
            kickedOut: false,
          });
      }
    }
    void restore();
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!alive) return;
        if (
          (event === "PASSWORD_RECOVERY" || passwordRecoveryRequested() || googlePasswordRecoveryRequested()) &&
          session?.user
        ) {
          setState({
            page: "login",
            profile: null,
            isLoading: false,
            error: "",
            kickedOut: false,
          });
          return;
        }
        if (["SIGNED_IN", "USER_UPDATED"].includes(event) && session?.user) {
          if (handlingLoginRef.current && event === "SIGNED_IN") return;
          const nextAuthId = session.user.id;
          confirmedAuthIdRef.current = nextAuthId;
          setState((current) => {
            if (!current.profile || current.profile.auth_id === nextAuthId) return current;
            clearProfileSnapshot(current.profile.auth_id);
            return {page:"loading",profile:null,isLoading:true,error:"",kickedOut:false};
          });
          // Supabase can deadlock when another client call starts inside this
          // callback. Let the callback return before refreshing the profile.
          if (authEventTimer !== undefined) window.clearTimeout(authEventTimer);
          authEventTimer = window.setTimeout(() => {
            if (!alive) return;
            void loadProfile(session.user.id, {
              preserveOnFailure: true,
              user: session.user,
            });
          }, 0);
          return;
        }
        if (event === "SIGNED_OUT") {
          confirmedAuthIdRef.current = null;
          if (explicitSignOutRef.current) {
            explicitSignOutRef.current = false;
            return;
          }
          void wipeOnLogout().then(() => {
            if (alive)
              setState({
                page: "login",
                profile: null,
                isLoading: false,
                error: "",
                kickedOut: false,
              });
          });
        }
      },
    );
    const refresh = () => {
      if (
        passwordRecoveryRequested() || googleVerificationActive() ||
        (document.visibilityState === "hidden" && !navigator.onLine)
      )
        return;
      void supabase.auth
        .getSession()
        .then(({ data }) => {
          if (data.session?.user)
            void loadProfile(data.session.user.id, { preserveOnFailure: true, user: data.session.user });
        })
        .catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      aliveRef.current = false;
      listener.subscription.unsubscribe();
      if (authEventTimer !== undefined) window.clearTimeout(authEventTimer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadProfile]);
  const handleLoginSuccess = useCallback(
    async (
      authId: string,
      email: string,
      role?: "user" | "worker" | "property_partner",
    ) => {
      handlingLoginRef.current = true;
      confirmedAuthIdRef.current = authId;
      setState((s) => ({ ...s, isLoading: true, error: "" }));
      try {
        const [profileResult, maintenanceEnabled] = await Promise.all([
          getProfileByAuthId(authId, email),
          maintenance(),
        ]);
        const { profile: byAuth, error: profileError } = profileResult;
        if (profileError) throw profileError;
        let p = byAuth;
        if (!p) {
          if (maintenanceEnabled)
            throw new Error("WeHouse is currently under maintenance.");
          if (await registrationClosed())
            throw new Error("New registrations are currently closed.");
          const { profile: newProfile, error } = await createProfile(
            authId,
            email,
            role || "user",
          );
          if (error || !newProfile)
            throw error || new Error("Could not create account");
          p = newProfile;
          if ((role || "user") === "property_partner")
            await ensurePropertyPartnerRecord();
        }
        if (await allowEntry(p, maintenanceEnabled)) {
          const registration=await registerUserSession(p.user_id,authId);
          if(sessionStorage.getItem('wh_login_method')==='password'&&registration.trustStatus==='pending'){
            if(registration.sessionId)saveGoogleVerification({context:'new_device',email:p.email||email,pendingDeviceSessionId:registration.sessionId,device:registration.device,os:registration.os,browser:registration.browser,location:registration.location});
            setState({page:'login',profile:null,isLoading:false,error:'',kickedOut:false,pendingDevice:registration});
            return;
          }
          sessionStorage.removeItem('wh_login_method');
          saveProfileSnapshot(p);
          syncIdentityNavigation(p);
          setState({
            profile: p,
            page: determinePage(p),
            isLoading: false,
            error: "",
            kickedOut: false,
            pendingDevice: null,
          });
          void trackSession(p.user_id, authId);
        }
      } catch (e: any) {
        setState({
          page: "login",
          profile: null,
          isLoading: false,
          error: safeAuthMessage(e, "Login failed. Please try again."),
        });
      } finally {
        handlingLoginRef.current = false;
      }
    },
    [allowEntry, determinePage],
  );
  const handleSetupComplete = useCallback(
    (p: Profile) => {
      saveProfileSnapshot(p);
      syncIdentityNavigation(p);
      setState({
        profile: p,
        page: determinePage(p),
        isLoading: false,
        error: "",
      });
    },
    [determinePage],
  );
  const logout = useCallback(async () => {
    if (logoutBusyRef.current) return;
    logoutBusyRef.current = true;
    const userId = state.profile?.user_id,
      authId = state.profile?.auth_id,
      sid = getStoredSessionId();
    explicitSignOutRef.current = true;
    setState({
      page: "login",
      profile: null,
      isLoading: false,
      error: "",
      kickedOut: false,
    });
    window.history.replaceState({ page: "login" }, "", "#login");
    const remoteCleanup: Promise<unknown>[] = [];
    if (sid) remoteCleanup.push(deactivateUserSession(sid).catch(() => {}));
    if (userId && authId)
      remoteCleanup.push(endSession(userId, authId).catch(() => {}));
    void Promise.allSettled(remoteCleanup);
    try {
      await Promise.race([
        supabase.auth.signOut({ scope: "local" }).catch(() => {}),
        new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
      ]);
      await wipeOnLogout();
    } finally {
      logoutBusyRef.current = false;
    }
  }, [state.profile]);
  useEffect(() => {
    if (!state.profile) return;
    let sid = getStoredSessionId(),
      stopped = false,
      running = false;
    const uid = state.profile.user_id,
      aid = state.profile.auth_id;
    async function ensure() {
      if (stopped || running || logoutBusyRef.current) return;
      running = true;
      try {
        if (sid) {
          const current = await getUserSessionState(sid, uid, aid);
          if (current.state === "active") {
            await updateSessionLastSeen(sid);
            return;
          }
          if (current.state === "inactive") {
            if (!kickoutBusyRef.current) {
              kickoutBusyRef.current = true;
              explicitSignOutRef.current = true;
              try {
                await supabase.auth.signOut({ scope: "local" });
              } catch {}
              await wipeOnLogout();
              if (aliveRef.current)
                setState({
                  page: "login",
                  profile: null,
                  isLoading: false,
                  error: "",
                  kickedOut: true,
                });
              kickoutBusyRef.current = false;
            }
            return;
          }
          if (current.state === "foreign" || current.state === "missing") {
            clearStoredSessionId();
            sid = null;
          } else if (current.state === "error") return;
        }
        sid = await createUserSession(uid, aid);
      } finally {
        running = false;
      }
    }
    void ensure();
    const timer = setInterval(() => void ensure(), 30000);
    const sessionChannel = supabase
      .channel(`session-guard:${uid}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "user_sessions",
          filter: `user_id=eq.${uid}`,
        },
        (payload) => {
          if (sid && (payload.new as { id?: string }).id === sid) void ensure();
        },
      )
      .subscribe();
    const visible = () => {
      if (document.visibilityState === "visible") void ensure();
    };
    window.addEventListener("online", ensure);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      clearInterval(timer);
      void supabase.removeChannel(sessionChannel);
      window.removeEventListener("online", ensure);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [state.profile?.user_id, state.profile?.auth_id]);
  const clearError = useCallback(
    () => setState((s) => ({ ...s, error: "" })),
    [],
  );
  return {
    ...state,
    handleLoginSuccess,
    handleSetupComplete,
    logout,
    clearError,
    kickedOut: state.kickedOut,
  };
}
