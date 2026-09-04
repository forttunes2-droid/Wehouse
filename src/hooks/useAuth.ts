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
interface AuthState {
  page: Page;
  profile: Profile | null;
  isLoading: boolean;
  error: string;
  kickedOut?: boolean;
  pendingDevice?: DeviceRegistration | null;
}
type PublicRole = "user" | "worker" | "property_partner";
const PROFILE_SNAPSHOT_KEY = "wh_profile_snapshot_v1";
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

function readProfileSnapshot(): Profile | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILE_SNAPSHOT_KEY) || "null");
    const profile = parsed?.profile as Profile | undefined;
    if (
      !profile?.auth_id ||
      !profile.user_id ||
      !profile.role ||
      Date.now() - Number(parsed.saved_at || 0) > PROFILE_SNAPSHOT_MAX_AGE
    ) {
      localStorage.removeItem(PROFILE_SNAPSHOT_KEY);
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
      PROFILE_SNAPSHOT_KEY,
      JSON.stringify({ profile: safeProfile, saved_at: Date.now() }),
    );
  } catch {}
}

function clearProfileSnapshot() {
  try {
    localStorage.removeItem(PROFILE_SNAPSHOT_KEY);
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
  try {
    return sessionStorage.getItem("wh_google_verify_context") === "password_recovery";
  } catch {
    return false;
  }
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
  const initialProfileRef = useRef<Profile | null>(readProfileSnapshot());
  const initialProfile = initialProfileRef.current;
  const [state, setState] = useState<AuthState>({
    page: initialProfile ? pageForProfile(initialProfile) : "loading",
    profile: initialProfile,
    isLoading: !initialProfile,
    error: "",
    kickedOut: false,
  });
  const handlingLoginRef = useRef(false),
    explicitSignOutRef = useRef(false),
    profileLoadRef = useRef<Promise<void> | null>(null),
    aliveRef = useRef(true),
    kickoutBusyRef = useRef(false);
  const determinePage = useCallback(pageForProfile, []);
  useEffect(() => {
    if (!state.isLoading || state.profile) return;
    let verificationActive = false;
    try {
      verificationActive = Boolean(sessionStorage.getItem("wh_google_verify_context"));
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
      if (profileLoadRef.current) return profileLoadRef.current;
      profileLoadRef.current = (async () => {
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
          const expectedGoogleEmail=sessionStorage.getItem('wh_google_verify_email');
          if(expectedGoogleEmail&&email.toLowerCase()!==expectedGoogleEmail){
            setState({page:'login',profile:null,isLoading:false,error:'',kickedOut:false});
            return;
          }
          if(sessionStorage.getItem('wh_google_verify_context')==='signup'&&!user?.identities?.some(identity=>identity.provider==='google')){
            setState({page:'login',profile:null,isLoading:false,error:'',kickedOut:false});
            return;
          }
          if(sessionStorage.getItem('wh_google_verify_context')==='new_device'){
            const pendingSession=sessionStorage.getItem('wh_pending_device_session');
            if(!pendingSession)throw new Error('The pending device confirmation expired. Sign in again.');
            const confirmed=await confirmCurrentDeviceWithGoogle(pendingSession);
            if(confirmed.error)throw confirmed.error;
            sessionStorage.removeItem('wh_google_verify_context');
            sessionStorage.removeItem('wh_google_verify_email');
            sessionStorage.removeItem('wh_pending_device_session');
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
            const role = publicRole(user?.user_metadata?.signup_role)||publicRole(sessionStorage.getItem('wh_google_verify_role'));
            if (role) {
              if (maintenanceEnabled)
                throw new Error("WeHouse is currently under maintenance.");
              if (await registrationClosed())
                throw new Error("New registrations are currently closed.");
              const created = await createProfile(authId, email, role);
              if (created.error || !created.profile)
                throw created.error || new Error("Could not create account");
              profile = created.profile;
              sessionStorage.removeItem('wh_google_verify_email');
              sessionStorage.removeItem('wh_google_verify_role');
              sessionStorage.removeItem('wh_google_verify_context');
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
          const registration=await registerUserSession(profile.user_id,authId);
          if(sessionStorage.getItem('wh_login_method')==='password'&&registration.trustStatus==='pending'){
            if(registration.sessionId)sessionStorage.setItem('wh_pending_device_session',registration.sessionId);
            setState({page:'login',profile:null,isLoading:false,error:'',kickedOut:false,pendingDevice:registration});
            return;
          }
          sessionStorage.removeItem('wh_login_method');
          if (await allowEntry(profile, maintenanceEnabled)) {
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
          if (!preserveOnFailure)
            setState((s) => ({
              ...s,
              isLoading: false,
              error:
                e?.message ||
                "Connection interrupted. Your session is still being restored.",
            }));
        } finally {
          profileLoadRef.current = null;
        }
      })();
      return profileLoadRef.current;
    },
    [allowEntry, determinePage],
  );
  useEffect(() => {
    aliveRef.current = true;
    let alive = true;
    let authEventTimer: number | undefined;
    async function restore() {
      setState((s) => (s.profile ? s : { ...s, isLoading: true }));
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!alive) return;
        if (passwordRecoveryRequested() || googlePasswordRecoveryRequested()) {
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
          const snapshotMatches =
            initialProfileRef.current?.auth_id === data.session.user.id;
          if (!snapshotMatches) {
            clearProfileSnapshot();
            initialProfileRef.current = null;
            setState((s) => ({ ...s, profile: null, page: "loading", isLoading: true }));
          }
          await loadProfile(data.session.user.id, {
            preserveOnFailure: snapshotMatches,
            user: data.session.user,
          });
          return;
        }
        clearProfileSnapshot();
        initialProfileRef.current = null;
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
              e?.message ||
              "Unable to restore your session. Check your connection and try again.",
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
        passwordRecoveryRequested() || googlePasswordRecoveryRequested() ||
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
            if(registration.sessionId)sessionStorage.setItem('wh_pending_device_session',registration.sessionId);
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
          error: e?.message || "Login failed. Please try again.",
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
    await Promise.race([
      supabase.auth.signOut({ scope: "local" }).catch(() => {}),
      new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
    ]);
    await wipeOnLogout();
  }, [state.profile]);
  useEffect(() => {
    if (!state.profile) return;
    let sid = getStoredSessionId(),
      stopped = false,
      running = false;
    const uid = state.profile.user_id,
      aid = state.profile.auth_id;
    async function ensure() {
      if (stopped || running) return;
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
