import { useState, useEffect, useCallback, useRef } from "react";
import {
  supabase,
  getProfileByAuthId,
  createProfile,
  trackSession,
  endSession,
  createUserSession,
  deactivateUserSession,
  getStoredSessionId,
  clearStoredSessionId,
  getUserSessionState,
  updateSessionLastSeen,
} from "@/lib/supabase";
import type { Profile, Page } from "@/types";
import type { User } from "@supabase/supabase-js";
interface AuthState {
  page: Page;
  profile: Profile | null;
  isLoading: boolean;
  error: string;
  kickedOut?: boolean;
}
type PublicRole = "user" | "worker" | "property_partner";
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
export const canCreateListings = (r: string) =>
  ["staff", "admin", "creator"].includes(r);
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
    profileLoadRef = useRef<Promise<void> | null>(null),
    aliveRef = useRef(true),
    kickoutBusyRef = useRef(false);
  const determinePage = useCallback((p: Profile | null): Page => {
    if (!p) return "login";
    if (p.role === "worker") return "worker_dashboard";
    if (!p.profile_complete) return "setup";
    if (isCreator(p.role)) return "creator";
    if (p.role === "admin") return "admin";
    if (p.role === "staff") return "staff_dashboard";
    if (p.role === "property_partner") return "property_partner";
    return "dashboard";
  }, []);
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
          if (await allowEntry(profile, maintenanceEnabled)) {
            syncIdentityNavigation(profile);
            setState({
              profile,
              page: determinePage(profile),
              isLoading: false,
              error: "",
              kickedOut: false,
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
    async function restore() {
      setState((s) => ({ ...s, isLoading: true }));
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!alive) return;
        if (passwordRecoveryRequested()) {
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
          await loadProfile(data.session.user.id, { user: data.session.user });
          return;
        }
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
          (event === "PASSWORD_RECOVERY" || passwordRecoveryRequested()) &&
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
        if (
          [
            "INITIAL_SESSION",
            "SIGNED_IN",
            "TOKEN_REFRESHED",
            "USER_UPDATED",
          ].includes(event) &&
          session?.user
        ) {
          if (handlingLoginRef.current && event === "SIGNED_IN") return;
          void loadProfile(session.user.id, { preserveOnFailure: true, user: session.user });
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
        passwordRecoveryRequested() ||
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
          syncIdentityNavigation(p);
          setState({
            profile: p,
            page: determinePage(p),
            isLoading: false,
            error: "",
            kickedOut: false,
          });
          void trackSession(p.user_id, authId);
          void createUserSession(p.user_id, authId);
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
    window.location.replace(`${window.location.origin}/#login`);
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
    const visible = () => {
      if (document.visibilityState === "visible") void ensure();
    };
    window.addEventListener("online", ensure);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      clearInterval(timer);
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
