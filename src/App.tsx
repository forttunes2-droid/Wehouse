import { readPropertyLinkIntent, savePropertyLinkIntent } from "@/lib/propertyLinkIntent";
import { parsePropertyShareUrl, type SharedProperty } from "@/lib/propertyShare";
import SharedPropertyWorkspacePrompt from "@/components/SharedPropertyWorkspacePrompt";
import { publicPropertyDestination } from "@/lib/publicPropertyDestination";
import { workspaceEntryPage, accountBackPage } from "@/lib/workspaceNavigation";
import { createRefreshScheduler } from "@/lib/refreshScheduler";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  Suspense,
  lazy,
} from "react";
import {
  useAuth,
  canCreateListings,
  isCreator as checkCreator,
} from "@/hooks/useAuth";
import { CreatorAuthProvider } from "@/hooks/useCreatorAuth";
import {
  getSavedListings,
  saveListing,
  unsaveListing,
  supabase,
} from "@/lib/supabase";
import DesktopLayout from "@/components/DesktopLayout";
import NewLoginAlert from "@/components/NewLoginAlert";
import { getNavForRole } from "@/lib/desktop-nav";
import Login from "@/pages/Login";
import Setup from "@/pages/Setup";
import type { NavPage } from "@/types/nav";
import { toast } from "sonner";
import type { WorkspaceChoice } from "@/pages/AccountCenter";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { workspaceNavigationKey } from "@/lib/workspaceSession";
import { getCommunicationBookingConversations } from "@/lib/supabase/worker-bookings";
import { getMySupportConversations } from "@/lib/supabase/support";
import { getMyHotelConversations } from "@/lib/supabase/hotel-chat";
import {
  getAnnouncementsForUser,
  markAnnouncementRead,
} from "@/lib/supabase/announcements";
import {
  activityIsCurrent,
  resolveActivityDestination,
} from "@/lib/activityFeed";
import {
  getCanonicalActivity,
  getCanonicalActivitySummary,
  markCanonicalActivityRead,
  subscribeToCanonicalActivity,
} from "@/lib/supabase/activity";

type ConversationUnreadRow = {
  id: string;
  participant_a: string;
  unread_a: number | null;
  unread_b: number | null;
  last_message_at: string | null;
};
type IncomingMessageRow = {
  sender_id?: string;
  conversation_id?: string;
  content?: string | null;
  legacy_content?: string | null;
  attachments?: unknown[] | null;
};
type AnnouncementRecipientRow = { announcement_id?: string };

const Search = lazy(() => import("@/pages/Search"));
const Saved = lazy(() => import("@/pages/Saved"));
const ListingDetail = lazy(() => import("@/pages/ListingDetail"));
const CreatorDashboard = lazy(() => import("@/pages/CreatorDashboard"));
const AdminDashboard = lazy(() => import("@/pages/AdminDashboard"));
const Roommate = lazy(() => import("@/pages/Roommate"));
const Chat = lazy(() => import("@/pages/Chat"));
const ProfileEdit = lazy(() => import("@/pages/ProfileEdit"));
const AccountCenter = lazy(() => import("@/pages/AccountCenter"));
const PrivacySecuritySettings = lazy(
  () => import("@/pages/PrivacySecuritySettings"),
);
const CreateListing = lazy(() => import("@/pages/CreateListing"));
const WorkerSetup = lazy(() => import("@/pages/WorkerSetup"));
const WorkerVerification = lazy(() => import("@/pages/WorkerVerification"));
const WorkerDashboard = lazy(() => import("@/pages/WorkerDashboard"));
const WorkerDiscovery = lazy(() => import("@/pages/WorkerDiscovery"));
const StaffDashboard = lazy(() => import("@/pages/StaffDashboard"));
const HotelsHome = lazy(() => import("@/pages/HotelsHome"));
const HotelDetail = lazy(() => import("@/pages/HotelDetail"));
const HotelBooking = lazy(() => import("@/pages/HotelBooking"));
const PropertyPartnerDashboard = lazy(
  () => import("@/pages/PropertyPartnerDashboard"),
);
const HotelTeamDashboard = lazy(() => import("@/pages/HotelTeamDashboard"));
const MyReservations = lazy(() => import("@/pages/MyReservations"));
const PaymentReturn = lazy(() => import("@/pages/PaymentReturn"));
const PrivacyPolicyPage = lazy(() => import("@/pages/PrivacyPolicyPage"));
const TermsPage = lazy(() => import("@/pages/TermsPage"));
const CreatorAuthModal = lazy(() => import("@/components/CreatorAuthModal"));
const SupportChat = lazy(() => import("@/components/SupportChat"));
const PrivateCallCenter = lazy(() => import("@/components/PrivateCallCenter"));

function PageTransitionFallback({ signingIn = false }: { signingIn?: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 25000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div
      className="wh-auth-to-app min-h-[100dvh] bg-[#0A0A0F] px-4 py-5 text-[#F6F2FC]"
      role="status"
      aria-label="Loading WeHouse"
    >
      <div className="mx-auto flex min-h-[calc(100dvh-2.5rem)] max-w-md flex-col">
        <div className="wh-auth-to-app-brand flex items-center gap-3 pt-3">
          <img src="/app-icon.svg?v=3" alt="" className="h-10 w-10 rounded-[12px]" />
          <div>
            <p className="text-base font-semibold tracking-tight">WeHouse</p>
            <p className="mt-0.5 text-[10px] text-[#777E8E]">{signingIn ? "Signing you in" : "Opening your account"}</p>
          </div>
        </div>
        {!slow ? (
          <div className="wh-auth-to-app-shell mt-10 flex flex-1 flex-col">
            <div className="h-3 w-28 rounded-full bg-white/[.08]" />
            <div className="mt-3 h-7 w-48 rounded-xl bg-white/[.055]" />
            <div className="mt-8 grid grid-cols-2 gap-3">
              <div className="h-24 rounded-[20px] bg-white/[.045]" />
              <div className="h-24 rounded-[20px] bg-violet-500/[.08]" />
            </div>
            <div className="mt-3 h-20 rounded-[20px] bg-white/[.035]" />
            <div className="mt-3 h-16 rounded-[18px] bg-white/[.03]" />
            <div className="mt-auto flex justify-around border-t border-white/[.05] pb-2 pt-4">
              {[0,1,2,3].map((item) => <span key={item} className="h-8 w-8 rounded-full bg-white/[.045]" />)}
            </div>
          </div>
        ) : (
          <div className="grid flex-1 place-items-center text-center">
            <div className="max-w-xs">
              <p className="text-sm text-[#AAA3B3]">Taking longer than usual.</p>
              <p className="mt-2 text-sm leading-6 text-[#AAA3B3]">Check your connection or try again.</p>
              <button type="button" onClick={() => window.location.reload()} className="mt-4 min-h-12 rounded-xl bg-violet-600 px-6 text-white text-sm font-semibold hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300">Try again</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RouteTransitionFallback() {
  return (
    <div
      className="grid min-h-[45vh] place-items-center bg-[#0A0A0F] px-6 text-white"
      role="status"
      aria-label="Opening page"
    >
      <div className="text-center">
        <div aria-hidden="true" className="mx-auto h-[22px] w-[22px] animate-spin motion-reduce:animate-none rounded-full border-2 border-violet-300/20 border-t-violet-400" />
        <p className="mt-3 text-sm text-[#A7AEBD]">Opening page…</p>
      </div>
    </div>
  );
}
function ErrorFallback({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0A0A0F] px-5 text-white">
      <div className="max-w-sm text-center">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="mb-6 mt-2 text-sm text-[#5C5E72]">
          The app encountered an error. Please try again.
        </p>
        <button
          onClick={reset}
          className="h-11 rounded-xl bg-violet-500 px-6 text-sm font-semibold"
        >
          Reload App
        </button>
      </div>
    </div>
  );
}

const NAV_STORAGE_KEY = "wh_navpage";
const RESTORABLE_PAGES: NavPage[] = [
  "search",
  "saved",
  "roommate",
  "activity",
  "profile",
  "account",
  "privacy",
  "security",
  "devices",
  "creator",
  "admin",
  "staff_dashboard",
  "worker_dashboard",
  "worker_verification",
  "worker_setup",
  "worker_discovery",
  "worker_categories",
  "new_listing",
  "hotels",
  "property_partner",
  "hotel_operations",
  "my_bookings",
  "my_reservations",
  "conversation",
  "messages",
  "notifications",
  "chat",
  "profile_edit",
  "privacy_policy",
  "terms_of_service",
];
const ACCOUNT_PAGES = new Set<NavPage>([
  "profile",
  "account",
  "privacy",
  "security",
  "devices",
  "profile_edit",
]);
const USER_PAGES = new Set<NavPage>([
  "search",
  "saved",
  "roommate",
  "activity",
  "conversation",
  "notifications",
  "chat",
  "detail",
  "hotels",
  "hotel_detail",
  "hotel_booking",
  "worker_discovery",
  "worker_categories",
  "my_bookings",
  "my_reservations",
]);
function isRestorable(p: string): p is NavPage {
  return RESTORABLE_PAGES.includes(p as NavPage);
}
function roleRootFor(role: string): NavPage {
  return role === "creator"
    ? "creator"
    : role === "admin"
      ? "admin"
      : role === "staff"
        ? "staff_dashboard"
        : role === "worker"
          ? "worker_dashboard"
          : role === "property_partner"
            ? "property_partner"
            : role === "hotel_staff"
              ? "hotel_operations"
              : "search";
}
function normalizePageForRole(
  role: string,
  page: NavPage,
  workerProfileComplete = true,
): NavPage {
  if (["messages", "chat", "notifications", "activity"].includes(page))
    page = "conversation";
  // Preserve old deep links without keeping a second booking destination.
  if (page === "my_bookings") page = "my_reservations";
  if (
    page === "privacy_policy" ||
    page === "terms_of_service" ||
    page === "payment_return"
  )
    return page;
  if (role === "worker" && !workerProfileComplete)
    return ["worker_dashboard", "worker_setup", "worker_verification"].includes(
      page,
    )
      ? page
      : "worker_dashboard";
  if (ACCOUNT_PAGES.has(page)) return page;
  if (role === "creator")
    return page === "creator" || page === "new_listing" ? page : "creator";
  if (role === "admin")
    return page === "admin" || page === "new_listing" ? page : "admin";
  if (role === "staff") return "staff_dashboard";
  if (role === "worker")
    return ["worker_dashboard", "worker_setup", "worker_verification"].includes(
      page,
    )
      ? page
      : "worker_dashboard";
  if (role === "property_partner")
    return page === "property_partner" ? page : "property_partner";
  if (role === "hotel_staff")
    return page === "hotel_operations" ? page : "hotel_operations";
  if (role === "user") return USER_PAGES.has(page) ? page : "search";
  return "search";
}

export default function App() {
  const auth = useAuth();
  const [propertyIntent, setPropertyIntent] = useState<SharedProperty | null>(() => {
    try { return readPropertyLinkIntent(window.location.href, sessionStorage); }
    catch { return parsePropertyShareUrl(window.location.href); }
  });
  const consumePropertyIntent = useCallback(() => setPropertyIntent(null), []);
  useEffect(() => { try { savePropertyLinkIntent(propertyIntent, sessionStorage); } catch {} }, [propertyIntent]);
  useEffect(() => {
    const readLink = () => { const next = parsePropertyShareUrl(window.location.href); if (next) setPropertyIntent(next); };
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);
  return <AppSession key={auth.profile?.auth_id || "signed-out"} auth={auth} propertyIntent={propertyIntent} consumePropertyIntent={consumePropertyIntent} />;
}

function AppSession({ auth, propertyIntent, consumePropertyIntent }: { auth: ReturnType<typeof useAuth>; propertyIntent: SharedProperty | null; consumePropertyIntent: () => void }) {
  const [navPage, setNavPage] = useState<NavPage>("search"),
    [conversationOpen, setConversationOpen] = useState(false),
    [detailId, setDetailId] = useState<string | null>(null),
    [hotelId, setHotelId] = useState<number | null>(null),
    [hotelRoomId, setHotelRoomId] = useState<number | null>(null),
    [hotelRatePlanId, setHotelRatePlanId] = useState<number | null>(null),
    [hotelCheckIn, setHotelCheckIn] = useState(""),
    [hotelCheckOut, setHotelCheckOut] = useState(""),
    [chatConvId, setChatConvId] = useState<string | null>(null),
    [chatPeerId, setChatPeerId] = useState<string | null>(null),
    [bookingContextId, setBookingContextId] = useState<string | null>(null),
    [roommateContextId, setRoommateContextId] = useState<string | null>(null),
    [workerCategory, setWorkerCategory] = useState<string | null>(null),
    [savedIds, setSavedIds] = useState<Set<string>>(new Set()),
    [unreadCount, setUnreadCount] = useState(0),
    [supportUnreadCount, setSupportUnreadCount] = useState(0),
    [notificationCount, setNotificationCount] = useState(0),
    [nestedScreen, setNestedScreen] = useState(false),
    [error, setError] = useState<Error | null>(null);
  const baseProfile = auth.profile;
  const { access: workspaceAccess, active: activeWorkspace, setActive: setActiveWorkspace, error: workspaceError, reload: reloadWorkspaces } = useWorkspaceAccess(baseProfile?.user_id);
  const workspaceReady = Boolean(baseProfile && workspaceAccess?.identity?.user_id === baseProfile.user_id);
  const navigationKey = baseProfile ? workspaceNavigationKey(baseProfile.user_id, activeWorkspace) : NAV_STORAGE_KEY;
  useEffect(() => {
    const update = (event: Event) =>
      setNestedScreen(
        Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open),
      );
    window.addEventListener("wehouse:nested-screen", update);
    return () => window.removeEventListener("wehouse:nested-screen", update);
  }, []);
  const effectiveRole = useMemo(() => {
    if (!baseProfile) return "";
    // Wait for confirmed access and the saved workspace before rendering any role.
    if (workspaceAccess?.identity?.user_id !== baseProfile.user_id)
      return "";
    return activeWorkspace === "personal"
      ? "user"
      : activeWorkspace === "hotel"
        ? "hotel_staff"
        : activeWorkspace;
  }, [baseProfile, activeWorkspace, workspaceAccess]);
  const activeWorkspaceGrant = workspaceAccess?.privileged_workspaces?.find(
    (item) => item.role === activeWorkspace,
  );
  const profile = useMemo(() => {
    if (!baseProfile) return null;
    const internalWorkspace = ["staff", "admin", "creator"].includes(activeWorkspace);
    return {
      ...baseProfile,
      role: effectiveRole as typeof baseProfile.role,
      ...(internalWorkspace && activeWorkspaceGrant
        ? {
            assigned_state: activeWorkspaceGrant.state ?? null,
            assigned_lga:
              activeWorkspaceGrant.scope_type === "branch"
                ? activeWorkspaceGrant.lga ?? null
                : null,
          }
        : {}),
    };
  }, [baseProfile, effectiveRole, activeWorkspace, activeWorkspaceGrant]);
  const canList = canCreateListings(effectiveRole),
    isCreator = checkCreator(effectiveRole),
    userRole = effectiveRole,
    isStaffRole = userRole === "staff",
    isAdminRole = userRole === "admin",
    isPropertyPartner = userRole === "property_partner",
    isHotelTeamRole = userRole === "hotel_staff",
    isWorkerRole = userRole === "worker",
    isUserRole = userRole === "user",
    isCreatorRole = checkCreator(userRole);
  const tabs = useMemo(
    () =>
      isUserRole
        ? [
            { id: "search" as NavPage, label: "Explore", icon: SearchSvg },
            {
              id: "my_reservations" as NavPage,
              label: "Bookings",
              icon: ReservationSvg,
            },
            {
              id: "conversation" as NavPage,
              label: "Inbox",
              icon: InboxSvg,
            },
            { id: "profile" as NavPage, label: "Account", icon: ProfileSvg },
          ]
        : [],
    [isUserRole],
  );
  const navHistoryRef = useRef<NavPage[]>(["search"]),
    restoredRef = useRef(false),
    [navigationReady, setNavigationReady] = useState(false),
    seenMessagesRef = useRef(new Map<string, string>()),
    pageScrollRef = useRef<HTMLDivElement>(null),
    pageScrollPositionsRef = useRef(new Map<NavPage, number>());
  const roleRoot = useCallback(
    (): NavPage => roleRootFor(userRole),
    [userRole],
  );

  const switchWorkspace = useCallback(
    (workspace: WorkspaceChoice) => {
      if (!baseProfile) return;
      const allowed =
        workspace === "personal"
          ? Boolean(workspaceAccess?.personal_workspace)
          : Boolean(
              workspaceAccess?.privileged_workspaces?.some(
                (item) => item.role === workspace,
              ),
            );
      if (!allowed)
        return void toast.error(
          "That workspace is not available for this account.",
        );
      setChatConvId(null);
      setChatPeerId(null);
      setBookingContextId(null);
      setRoommateContextId(null);
      setConversationOpen(false);
      setNestedScreen(false);
      pageScrollPositionsRef.current.clear();
      setActiveWorkspace(workspace);
      window.dispatchEvent(new Event("wehouse:navigation"));
      try {
        localStorage.setItem(`wh_workspace_${baseProfile.user_id}`, workspace);
      } catch {}
      const targetRole =
        workspace === "personal" ? "user" : workspace === "hotel" ? "hotel_staff" : workspace;
      // An explicit switch enters the workspace itself. Restoring Account here
      // hid Personal navigation and left the root-level Back button pointing at itself.
      const destination = normalizePageForRole(
        targetRole,
        workspaceEntryPage(targetRole),
        Boolean(baseProfile.profile_complete),
      );
      setNavPage(destination);
      navHistoryRef.current = [destination];
      window.history.replaceState({ page: destination, workspace }, "", `#${destination}`);
      try {
        localStorage.setItem(workspaceNavigationKey(baseProfile.user_id, workspace), destination);
      } catch {}
    },
    [baseProfile, workspaceAccess],
  );

  const openActivatedWorkspace = useCallback(
    (workspace: "worker" | "property_partner") => {
      if (!baseProfile) return;
      const destination: NavPage =
        workspace === "worker"
          ? baseProfile.worker_status === "profile_under_review" ? "worker_dashboard" : "worker_setup"
          : "property_partner";
      setChatConvId(null);
      setChatPeerId(null);
      setBookingContextId(null);
      setRoommateContextId(null);
      setConversationOpen(false);
      setNestedScreen(false);
      pageScrollPositionsRef.current.clear();
      setActiveWorkspace(workspace);
      setNavPage(destination);
      navHistoryRef.current = [destination];
      window.dispatchEvent(new Event("wehouse:navigation"));
      try {
        localStorage.setItem(`wh_workspace_${baseProfile.user_id}`, workspace);
        localStorage.setItem(workspaceNavigationKey(baseProfile.user_id, workspace), destination);
        window.history.replaceState(
          { page: destination, workspace },
          "",
          `#${destination}`,
        );
      } catch {}
    },
    [baseProfile],
  );

  useEffect(() => {
    if (auth.isLoading || !workspaceReady || restoredRef.current) return;
    restoredRef.current = true;
    if (!auth.profile) return;
    const role = effectiveRole;
    const hashRoute = (window.location.hash || "")
      .replace(/^#/, "")
      .split("?")[0];
    if (hashRoute === "payment-return" || hashRoute === "payment_return") {
      queueMicrotask(() => { setNavPage("payment_return"); setNavigationReady(true); });
      navHistoryRef.current = ["payment_return"];
      return;
    }
    let saved: NavPage | null = null;
    try {
      const raw = localStorage.getItem(navigationKey);
      if (raw && isRestorable(raw)) saved = raw;
    } catch {}
    const safe = normalizePageForRole(
      role,
      saved || roleRootFor(role),
      Boolean(auth.profile.profile_complete),
    );
    queueMicrotask(() => { setNavPage(safe); setNavigationReady(true); });
    navHistoryRef.current = [safe];
    try {
      localStorage.setItem(navigationKey, safe);
      window.history.replaceState({ page: safe, workspace: activeWorkspace }, "", `#${safe}`);
    } catch {}
  }, [auth.isLoading, auth.profile, workspaceReady, effectiveRole, navigationKey]);
  useEffect(() => {
    if (!userRole || auth.isLoading || !navigationReady) return;
    const safe = normalizePageForRole(
      userRole,
      navPage,
      Boolean(baseProfile?.profile_complete),
    );
    if (safe === navPage) return;
    setNavPage(safe);
    navHistoryRef.current = [safe];
    try {
      localStorage.setItem(navigationKey, safe);
      window.history.replaceState({ page: safe, workspace: activeWorkspace }, "", `#${safe}`);
    } catch {}
  }, [auth.isLoading, baseProfile?.profile_complete, navPage, userRole, navigationReady, navigationKey, activeWorkspace]);
  const handleSetNavPage = useCallback(
    (page: NavPage) => {
      window.dispatchEvent(new Event("wehouse:navigation"));
      pageScrollPositionsRef.current.set(
        navPage,
        pageScrollRef.current?.scrollTop || 0,
      );
      const safe = normalizePageForRole(
        userRole,
        page,
        Boolean(baseProfile?.profile_complete),
      );
      const current = navHistoryRef.current.at(-1);
      if (safe !== current) {
        // The signed-out landing page has no router state until its first link.
        // Preserve it so Back from a public legal page returns to sign-in.
        if (!window.history.state?.page) {
          window.history.replaceState({ page: current || "search", workspace: activeWorkspace }, "");
        }
        window.history.pushState({ page: safe, workspace: activeWorkspace }, "", `#${safe}`);
        navHistoryRef.current = [...navHistoryRef.current, safe];
      }
      setNavPage(safe);
      if (isRestorable(safe)) localStorage.setItem(navigationKey, safe);
    },
    [baseProfile?.profile_complete, userRole, navPage, navigationKey, activeWorkspace],
  );
  useEffect(() => {
    const h = (e: PopStateEvent) => {
      const s = e.state as { page?: NavPage; workspace?: WorkspaceChoice } | null;
      if (!s?.page) return;
      // Browser Back must never silently change persona. Workspace switching is
      // deliberate; old history entries are normalized inside the current workspace.
      const safe = normalizePageForRole(
        userRole,
        s.page,
        Boolean(baseProfile?.profile_complete),
      );
      pageScrollPositionsRef.current.set(
        navPage,
        pageScrollRef.current?.scrollTop || 0,
      );
      if (safe !== s.page || s.workspace !== activeWorkspace)
        window.history.replaceState({ page: safe, workspace: activeWorkspace }, "", `#${safe}`);
      setNavPage(safe);
      navHistoryRef.current =
        navHistoryRef.current.length > 1
          ? [...navHistoryRef.current.slice(0, -1), safe]
          : [safe];
      if (isRestorable(safe)) localStorage.setItem(navigationKey, safe);
    };
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, [baseProfile?.profile_complete, userRole, navPage, navigationKey, activeWorkspace]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (pageScrollRef.current)
        pageScrollRef.current.scrollTop =
          pageScrollPositionsRef.current.get(navPage) || 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [navPage]);
  useEffect(() => {
    const h = (e: ErrorEvent) => {
      setError(e.error);
      e.preventDefault();
    };
    window.addEventListener("error", h);
    return () => window.removeEventListener("error", h);
  }, []);
  useEffect(() => {
    const h = (event: Event) =>
      setConversationOpen(
        Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open),
      );
    window.addEventListener("wehouse:conversation-open", h);
    return () => window.removeEventListener("wehouse:conversation-open", h);
  }, []);
  useEffect(() => {
    if (profile?.user_id)
      getSavedListings(profile.user_id)
        .then(
          ({ saved }) =>
            saved && setSavedIds(new Set(saved.map((s) => s.listing_id))),
        )
        .catch(() => {});
  }, [profile?.user_id]);
  useEffect(() => {
    if (!profile?.user_id || !isUserRole) {
      queueMicrotask(() => setUnreadCount(0));
      queueMicrotask(() => setSupportUnreadCount(0));
      queueMicrotask(() => setNotificationCount(0));
      seenMessagesRef.current.clear();
      return;
    }
    const uid = profile.user_id;
    async function loadCounts(isCurrent: () => boolean) {
      const [
        { data },
        bookingResult,
        supportResult,
        hotelChatResult,
        activityResult,
        announcementResult,
      ] = await Promise.all([
        supabase
          .from("conversations")
          .select("id,participant_a,unread_a,unread_b,last_message_at")
          .or(`participant_a.eq.${uid},participant_b.eq.${uid}`),
        getCommunicationBookingConversations(uid, "personal"),
        getMySupportConversations(),
        getMyHotelConversations(),
        getCanonicalActivitySummary("personal"),
        getAnnouncementsForUser(uid),
      ]);
      if (!isCurrent()) return;
      let roommate = 0;
      ((data || []) as ConversationUnreadRow[]).forEach((c) => {
        if (Number(c.participant_a === uid ? c.unread_a : c.unread_b) > 0)
          roommate += 1;
        if (!seenMessagesRef.current.has(c.id))
          seenMessagesRef.current.set(c.id, String(c.last_message_at || ""));
      });
      const worker = (bookingResult.conversations || []).reduce(
        (sum: number, row: { unread_count?: number }) =>
          sum + (Number(row.unread_count || 0) > 0 ? 1 : 0),
        0,
      );
      const support = (supportResult.conversations || []).reduce(
        (sum: number, row: { unread_count?: number }) =>
          sum + (Number(row.unread_count || 0) > 0 ? 1 : 0),
        0,
      );
      const hotel = (hotelChatResult.conversations || []).reduce(
        (sum: number, row: { unread_count?: number }) =>
          sum + (Number(row.unread_count || 0) > 0 ? 1 : 0),
        0,
      );
      const activity = activityResult.error ? 0 : activityResult.summary.unread;
      const announcementUnread = (announcementResult.messages || []).filter(
        (delivery: any) => {
          const announcement = Array.isArray(delivery.announcements)
            ? delivery.announcements[0]
            : delivery.announcement || delivery.message;
          return (
            !delivery.read_status &&
            activityIsCurrent({
              type: "announcement",
              source: "announcement",
              created_at: announcement?.created_at || delivery.delivered_at,
            })
          );
        },
      ).length;
      setUnreadCount(roommate + worker + hotel);
      setSupportUnreadCount(support);
      setNotificationCount(activity + announcementUnread);
    }
    const countScheduler = createRefreshScheduler(
      loadCounts,
      () => document.visibilityState === "visible",
    );
    const count = countScheduler.request;
    count();
    const openMessages = (conversationId?: string) => {
      setChatConvId(conversationId || null);
      setChatPeerId(null);
      handleSetNavPage("conversation");
    };
    const openNotifications = () => handleSetNavPage("activity");
    const refreshUnread = () => void count();
    window.addEventListener("wehouse:unread-changed", refreshUnread);
    const chatChannel = supabase
      .channel(`app-incoming-chat:${uid}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const message = payload.new as IncomingMessageRow;
          if (String(message.sender_id || "") === uid) return;
          void count();
          if (profile.pref_push_notif === false) return;
          toast("New message", {
            description: String(
              message.content ||
                ((message.attachments || []).length
                  ? "New attachment"
                  : "Open Inbox to read it."),
            ).slice(0, 110),
            action: {
              label: "View",
              onClick: () => openMessages(message.conversation_id),
            },
            classNames: {
              toast:
                "!rounded-2xl !border !border-violet-400/20 !bg-[#121621]/95 !text-white !shadow-2xl !backdrop-blur-xl",
              title: "!text-[13px] !font-semibold",
              description: "!text-[10px] !text-[#9AA1B2]",
              actionButton:
                "!rounded-full !bg-violet-500 !px-3 !text-[9px] !font-semibold !text-white",
            },
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "booking_messages" },
        (payload) => {
          const message = payload.new as IncomingMessageRow;
          if (String(message.sender_id || "") === uid) return;
          void count();
          if (profile.pref_push_notif === false) return;
          toast("New service message", {
            description: String(
              message.content ||
                message.legacy_content ||
                "Open the conversation to read it.",
            ).slice(0, 110),
            action: {
              label: "View",
              onClick: () => openMessages(message.conversation_id),
            },
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "hotel_booking_messages" },
        (payload) => {
          const message = payload.new as IncomingMessageRow;
          if (String(message.sender_id || "") === uid) return;
          void count();
          if (profile.pref_push_notif === false) return;
          toast("New hotel message", {
            description: String(message.content || "Open Inbox to read it.").slice(0, 110),
            action: {
              label: "View",
              onClick: () => openMessages(message.conversation_id),
            },
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "partner_support_messages" },
        (payload) => {
          const message = payload.new as IncomingMessageRow;
          if (String(message.sender_id || "") === uid) return;
          void count();
        },
      )
      .subscribe();
    const officialChannel = subscribeToCanonicalActivity(
      uid,
      `app-unread-official:${uid}`,
      async () => {
        void count();
      },
    )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "activity_event_audiences",
          filter: `recipient_user_id=eq.${uid}`,
        },
        async (payload) => {
          void count();
          const audience = payload.new as {
            activity_event_id?: string;
            workspace?: string;
          };
          if (!audience.activity_event_id) return;
          if (!["personal", "account"].includes(String(audience.workspace || "")))
            return;
          const result = await getCanonicalActivity("personal", 25);
          if (result.error) return;
          const event = result.rows.find(
            (row) => row.id === audience.activity_event_id,
          );
          if (!event) return;
          const type = String(event.type || "");
          if (["new_device_login", "device_confirmation_pending"].includes(type))
            return;
          const destination = resolveActivityDestination(event);
          const opensInbox = destination.route === "conversation";
          if (
            opensInbox &&
            ["roommate_message", "customer_message", "worker_replied"].includes(type)
          )
            return;
          if (profile.pref_push_notif === false) return;
          const viewActivity = () => {
            void markCanonicalActivityRead(event.id, "personal").then((result) => {
              if (!result.error)
                window.dispatchEvent(new Event("wehouse:unread-changed"));
            });
            if (opensInbox) openMessages(destination.id);
            else openNotifications();
          };
          toast(event.title || "WeHouse update", {
            description: event.message || "Open WeHouse to view the update.",
            action: {
              label: "View",
              onClick: viewActivity,
            },
            classNames: {
              toast:
                "!rounded-2xl !border !border-violet-400/20 !bg-[#121621]/95 !text-white !shadow-2xl !backdrop-blur-xl",
              title: "!text-[13px] !font-semibold",
              description: "!text-[10px] !text-[#9AA1B2]",
              actionButton:
                "!rounded-full !bg-violet-500 !px-3 !text-[9px] !font-semibold !text-white",
            },
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "announcement_recipients",
          filter: `user_id=eq.${uid}`,
        },
        async (payload) => {
          void count();
          if (payload.eventType !== "INSERT") return;
          const announcementId = (payload.new as AnnouncementRecipientRow)
            .announcement_id;
          if (!announcementId) return;
          const { data } = await supabase
            .from("announcements")
            .select("title,content")
            .eq("id", announcementId)
            .maybeSingle();
          if (profile.pref_push_notif !== false)
            toast(data?.title || "Official WeHouse update", {
              description: data?.content
                ? String(data.content).slice(0, 140)
                : "Open Inbox to read the official update.",
              action: {
                label: "Read",
                onClick: () => {
                  void markAnnouncementRead(Number(announcementId), uid).then(
                    (result) => {
                      if (!result.error)
                        window.dispatchEvent(
                          new Event("wehouse:unread-changed"),
                        );
                    },
                  );
                  openNotifications();
                },
              },
              classNames: {
                toast:
                  "!rounded-2xl !border !border-blue-400/20 !bg-[#121621]/95 !text-white !shadow-2xl !backdrop-blur-xl",
                title: "!text-[13px] !font-semibold",
                description: "!text-[10px] !text-[#9AA1B2]",
                actionButton:
                  "!rounded-full !bg-blue-500 !px-3 !text-[9px] !font-semibold !text-white",
              },
            });
        },
      )
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState === "visible") void count();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const unreadTimer = window.setInterval(() => void count(), 60_000);
    return () => {
      countScheduler.dispose();
      window.clearInterval(unreadTimer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("wehouse:unread-changed", refreshUnread);
      supabase.removeChannel(chatChannel);
      supabase.removeChannel(officialChannel);
    };
  }, [
    profile?.user_id,
    profile?.pref_push_notif,
    isUserRole,
    handleSetNavPage,
  ]);
  const toggle = useCallback(
    async (id: string) => {
      if (!profile) return;
      const removing = savedIds.has(id);
      const result = removing
        ? await unsaveListing(profile.user_id, id)
        : await saveListing(profile.user_id, id);
      if (result.error)
        return toast.error(
          removing
            ? "Could not remove saved apartment"
            : "Could not save apartment",
        );
      setSavedIds((current) => {
        const next = new Set(current);
        if (removing) next.delete(id);
        else next.add(id);
        return next;
      });
      toast.success(removing ? "Removed from Saved" : "Apartment saved");
    },
    [profile, savedIds],
  );
  const goTo = useCallback(
    (p: NavPage, c?: string) => {
      if (c) setWorkerCategory(c);
      if (p === "conversation" || p === "messages" || p === "chat") {
        setChatConvId(null);
        setChatPeerId(null);
      }
      if (p !== "my_reservations") setBookingContextId(null);
      if (p !== "roommate") setRoommateContextId(null);
      handleSetNavPage(p);
    },
    [handleSetNavPage],
  );
  const consumeBookingContext = useCallback(
    () => setBookingContextId(null),
    [],
  );
  const goToDetail = useCallback(
    (id: string) => {
      setDetailId(id);
      handleSetNavPage("detail");
    },
    [handleSetNavPage],
  );
  const goBack = useCallback(() => {
    setDetailId(null);
    if (navHistoryRef.current.length > 1) window.history.back();
    else handleSetNavPage("search");
  }, [handleSetNavPage]);
  const goToChat = useCallback(
    (id?: string, peerId?: string) => {
      if (!isUserRole) {
        handleSetNavPage(roleRoot());
        return;
      }
      setChatConvId(id || null);
      setChatPeerId(peerId || null);
      handleSetNavPage("conversation");
    },
    [isUserRole, handleSetNavPage, roleRoot],
  );
  const openUserDestination = useCallback(
    (page: string, id?: string) => {
      const route = page.toLowerCase().replace(/-/g, "_");
      const property = publicPropertyDestination(route, id);
      if (property?.kind === "listing") return goToDetail(property.id);
      if (property?.kind === "hotel") {
        setHotelId(property.id);
        return goTo("hotel_detail");
      }
      if (["detail", "listing_detail", "hotel_detail"].includes(route)) {
        toast.error("This property link is invalid. Open it again from Saved or Explore.");
        return;
      }
      if (
        ["conversation", "conversations", "message", "messages", "chat"].includes(
          route,
        )
      )
        return goToChat(id);
      if (
        route === "my_reservations" ||
        route === "my_bookings" ||
        route === "reservation" ||
        route === "property_booking" ||
        route === "hotel_booking" ||
        route === "operations_bookings"
      ) {
        setBookingContextId(id || null);
        return goTo("my_reservations");
      }
      if (route === "roommate") {
        setRoommateContextId(id || null);
        return goTo("roommate");
      }
      if (route === "security" && id) return goTo("devices");
      goTo(route as NavPage);
    },
    [goTo, goToChat, goToDetail],
  );
  useEffect(() => {
    if (!propertyIntent || !isUserRole || !navigationReady || !workspaceReady || !baseProfile?.profile_complete || ["loading", "login", "setup", "worker_setup"].includes(auth.page)) return;
    openUserDestination(propertyIntent.kind === "hotel" ? "hotel_detail" : "detail", propertyIntent.id);
    consumePropertyIntent();
  }, [propertyIntent, isUserRole, navigationReady, workspaceReady, baseProfile?.profile_complete, auth.page, openUserDestination, consumePropertyIntent]);
  const goToProfileEdit = useCallback(
      () => handleSetNavPage("profile_edit"),
      [handleSetNavPage],
    ),
    goToPrivacy = useCallback(
      () => handleSetNavPage("privacy"),
      [handleSetNavPage],
    ),
    goToSecurity = useCallback(
      () => handleSetNavPage("security"),
      [handleSetNavPage],
    );
  const subpageBack = useCallback(() => {
    if (navHistoryRef.current.length > 1) window.history.back();
    else handleSetNavPage(accountBackPage(navPage, roleRoot()));
  }, [handleSetNavPage, navPage, roleRoot]);

  if (auth.isLoading) return <PageTransitionFallback signingIn />;
  if (baseProfile && !workspaceReady) return workspaceError ? (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-[#0A0A0F] p-6 text-center text-white">
      <h1 className="text-xl font-semibold">Unable to open your account</h1>
      <p className="max-w-sm text-sm text-[#B5AFC1]" role="alert">{workspaceError}</p>
      <button onClick={() => void reloadWorkspaces()} className="min-h-11 rounded-xl bg-violet-600 px-6 font-semibold">Try again</button>
      <button onClick={() => void auth.logout()} className="min-h-11 text-violet-300">Sign out</button>
    </main>
  ) : <PageTransitionFallback />;
  if (baseProfile && !navigationReady) return <PageTransitionFallback />;
  if (auth.page === "login" && (navPage === "privacy_policy" || navPage === "terms_of_service"))
    return (
      <Suspense fallback={<RouteTransitionFallback />}>
        {navPage === "privacy_policy" ? <PrivacyPolicyPage /> : <TermsPage />}
      </Suspense>
    );
  if (auth.page === "login")
    return (
      <Login
        onLoginSuccess={auth.handleLoginSuccess}
        onOpenLegal={(page) => goTo(page)}
        serverError={auth.error}
        kickedOut={auth.kickedOut}
        pendingDevice={auth.pendingDevice}
      />
    );
  if (auth.page === "setup" && profile)
    return (
      <Setup profile={profile} onSetupComplete={auth.handleSetupComplete} />
    );
  if (auth.page === "worker_setup" && profile)
    return (
      <WorkerSetup
        profile={profile}
        onComplete={() => auth.handleSetupComplete(profile)}
        onContinueVerification={() => {
          try {
            localStorage.setItem(NAV_STORAGE_KEY, "worker_verification");
            window.history.replaceState(
              { page: "worker_verification" },
              "",
              "#worker_verification",
            );
          } catch {}
          window.location.reload();
        }}
      />
    );
  if (error)
    return (
      <ErrorFallback
        reset={() => {
          setError(null);
          window.location.reload();
        }}
      />
    );

  const renderRoleRoot = () => {
    if (!profile) return null;
    if (isCreatorRole)
      return (
        <CreatorDashboard
          profile={profile}
          onLogout={auth.logout}
          onNavigate={(p, id) => {
            if (id && (p === "detail" || p === "listing_detail"))
              return goToDetail(id);
            if (
              id &&
              (p === "conversation" || p === "messages" || p === "chat")
            )
              return goToChat(id);
            goTo(p as NavPage);
          }}
          onGoToChat={goToChat}
          workspaceAccess={workspaceAccess}
          activeWorkspace={activeWorkspace}
          onSwitchWorkspace={switchWorkspace}
        />
      );
    if (isAdminRole)
      return (
        <AdminDashboard
          profile={profile}
          onLogout={auth.logout}
          onNavigate={(p, id) => openUserDestination(p, id)}
          onGoToChat={goToChat}
        />
      );
    if (isStaffRole)
      return (
        <StaffDashboard
          profile={profile}
          onLogout={auth.logout}
          onGoToChat={goToChat}
          onNavigate={(p, id) => openUserDestination(p, id)}
        />
      );
    if (isWorkerRole)
      return (
        <WorkerDashboard
          profile={profile}
          onGoToSetup={() => goTo("worker_setup")}
          onLogout={auth.logout}
          onNavigate={(p, id) => openUserDestination(p, id)}
          workspaceAccess={workspaceAccess}
          activeWorkspace={activeWorkspace}
          onSwitchWorkspace={switchWorkspace}
        />
      );
    if (isPropertyPartner)
      return (
        <PropertyPartnerDashboard
          profile={profile}
          onLogout={auth.logout}
          onNavigate={(p, id) => openUserDestination(p, id)}
          workspaceAccess={workspaceAccess}
          activeWorkspace={activeWorkspace}
          onSwitchWorkspace={switchWorkspace}
        />
      );
    if (isHotelTeamRole)
      return (
        <HotelTeamDashboard
          profile={profile}
          onLogout={auth.logout}
          onNavigate={(p, id) => openUserDestination(p, id)}
        />
      );
    return null;
  };
  const renderPage = () => {
    if (navPage === "privacy_policy") return <PrivacyPolicyPage />;
    if (navPage === "terms_of_service") return <TermsPage />;
    if (!profile)
      return (
        <Login
          onLoginSuccess={auth.handleLoginSuccess}
          onOpenLegal={(page) => goTo(page)}
          serverError={auth.error}
          pendingDevice={auth.pendingDevice}
        />
      );
    const props = { profile, savedIds, onToggleSave: toggle };
    switch (navPage) {
      case "payment_return":
        return <PaymentReturn profile={profile} onNavigate={(page, id) => {
          if (page === "my_reservations") setBookingContextId(id || null);
          goTo(page);
        }} />;
      case "search":
        return isUserRole ? (
          <Search
            onNavigate={(p: string, id?: string) =>
              id ? goToDetail(id) : goTo(p as NavPage)
            }
            savedIds={savedIds}
            onToggleSave={toggle}
          />
        ) : (
          renderRoleRoot()
        );
      case "saved":
        return isUserRole ? (
          <Saved
            {...props}
            onBack={subpageBack}
            onNavigate={openUserDestination}
          />
        ) : (
          renderRoleRoot()
        );
      case "roommate":
        return isUserRole ? (
          <Roommate
            profile={profile}
            onGoToChat={goToChat}
            onNavigate={openUserDestination}
            onEditProfile={goToProfileEdit}
            onOpenListing={goToDetail}
            initialContextId={roommateContextId}
          />
        ) : (
          renderRoleRoot()
        );
      case "profile":
      case "account":
        return (
          <AccountCenter
            profile={profile}
            onBack={subpageBack}
            onGoToSaved={() => goTo("saved")}
            onGoToPrivacy={goToPrivacy}
            onGoToSecurity={goToSecurity}
            onGoToProfileEdit={goToProfileEdit}
            onNavigate={(page) => goTo(page as NavPage)}
            onLogout={auth.logout}
            workspaceAccess={workspaceAccess}
            activeWorkspace={activeWorkspace}
            onSwitchWorkspace={switchWorkspace}
            onWorkspaceActivated={openActivatedWorkspace}
          />
        );
      case "privacy":
      case "security":
        return (
          <PrivacySecuritySettings
            profile={profile}
            onUpdate={(u) => auth.handleSetupComplete(u)}
            onBack={subpageBack}
          />
        );
      case "devices":
        return (
          <PrivacySecuritySettings
            profile={profile}
            onUpdate={(u) => auth.handleSetupComplete(u)}
            onBack={subpageBack}
            initialSection="devices"
          />
        );
      case "profile_edit":
        return isWorkerRole ? (
          <WorkerSetup
            profile={profile}
            onComplete={() => goTo("worker_dashboard")}
            onContinueVerification={() => goTo("worker_verification")}
            onBack={subpageBack}
          />
        ) : (
          <ProfileEdit
            profile={profile}
            onUpdate={(u) => auth.handleSetupComplete(u)}
            onBack={subpageBack}
          />
        );
      case "creator":
      case "admin":
      case "staff_dashboard":
      case "worker_dashboard":
      case "property_partner":
      case "hotel_operations":
        return renderRoleRoot();
      case "detail":
        return isUserRole && detailId ? (
          <ListingDetail
            listingId={detailId}
            onNavigate={goBack}
            isSaved={savedIds.has(detailId)}
            onToggleSave={() => toggle(detailId)}
            profile={profile}
            onGoToChat={goToChat}
            onOpenBooking={(id) =>
              openUserDestination("my_reservations", id)
            }
          />
        ) : (
          renderRoleRoot()
        );
      case "activity":
      case "notifications":
      case "chat":
      case "conversation":
      case "messages":
        return isUserRole ? (
          <Chat
            profile={profile}
            onNavigate={openUserDestination}
            conversationId={chatConvId}
            peerUserId={chatPeerId}
            onConversationClose={() => {
              setChatConvId(null);
              setChatPeerId(null);
            }}
            chatUnreadCount={unreadCount + supportUnreadCount}
            activityUnreadCount={notificationCount}
            onActivityUnreadChange={setNotificationCount}
          />
        ) : (
          renderRoleRoot()
        );
      case "worker_discovery":
      case "worker_categories":
        return isUserRole ? (
          <WorkerDiscovery
            userCity={profile.city}
            profile={profile}
            preSelectedCategory={workerCategory}
            onNavigate={(p) => goTo(p as NavPage)}
          />
        ) : (
          renderRoleRoot()
        );
      case "worker_setup":
        return isWorkerRole ? (
          <WorkerSetup
            profile={profile}
            onComplete={() => goTo("worker_dashboard")}
            onContinueVerification={() => goTo("worker_verification")}
            onBack={subpageBack}
          />
        ) : (
          renderRoleRoot()
        );
      case "worker_verification":
        return isWorkerRole ? (
          <WorkerVerification
            profile={profile}
            onBack={subpageBack}
            onEditProfile={() => goTo("worker_setup")}
          />
        ) : (
          renderRoleRoot()
        );
      case "new_listing":
        return canList ? (
          <CreateListing
            profile={profile}
            onBack={subpageBack}
            onSuccess={() => handleSetNavPage(roleRoot())}
          />
        ) : (
          renderRoleRoot()
        );
      case "hotels":
        return isUserRole ? (
          <HotelsHome onNavigate={openUserDestination} />
        ) : (
          renderRoleRoot()
        );
      case "hotel_detail":
        return isUserRole && hotelId ? (
          <HotelDetail
            onGoToChat={goToChat}
            hotelId={hotelId}
            onBack={subpageBack}
            onBook={(h, r, ratePlanId, ci, co) => {
              setHotelId(h);
              setHotelRoomId(r);
              setHotelRatePlanId(ratePlanId);
              setHotelCheckIn(ci || "");
              setHotelCheckOut(co || "");
              goTo("hotel_booking");
            }}
            profile={profile}
          />
        ) : (
          renderRoleRoot()
        );
      case "hotel_booking":
        return isUserRole && hotelId && hotelRoomId && hotelRatePlanId ? (
          <HotelBooking
            hotelId={hotelId}
            roomId={hotelRoomId}
            ratePlanId={hotelRatePlanId}
            checkIn={hotelCheckIn}
            checkOut={hotelCheckOut}
            profile={profile}
            onBack={subpageBack}
            onComplete={() => goTo("hotels")}
          />
        ) : (
          renderRoleRoot()
        );
      case "my_reservations":
        return isUserRole ? (
          <MyReservations
            profile={profile}
            initialBookingId={bookingContextId}
            onInitialBookingConsumed={consumeBookingContext}
            onOpenConversation={goToChat}
            onOpenListing={goToDetail}
          />
        ) : (
          renderRoleRoot()
        );
      default:
        return (
          renderRoleRoot() || (
            <Search
              onNavigate={(p: string, id?: string) =>
                id ? goToDetail(id) : goTo(p as NavPage)
              }
              savedIds={savedIds}
              onToggleSave={toggle}
            />
          )
        );
    }
  };
  const desktopNavItems = getNavForRole(
    userRole,
    unreadCount + supportUnreadCount,
    notificationCount,
  );
  const hide = [
    "profile",
    "account",
    "detail",
    "chat",
    "saved",
    "profile_edit",
    "privacy",
    "security",
    "devices",
    "new_listing",
    "worker_setup",
    "hotel_detail",
    "hotel_booking",
    "worker_verification",
    "payment_return",
  ] as NavPage[];
  const showBottomNav =
      isUserRole &&
      !conversationOpen &&
      !nestedScreen &&
      !hide.includes(navPage),
    supportRole = ["user", "worker", "property_partner", "hotel_staff"].includes(
      profile?.role || "",
    );
  return (
    <CreatorAuthProvider>
      {propertyIntent && profile && !isUserRole && <SharedPropertyWorkspacePrompt onConfirm={() => switchWorkspace("personal")} onDismiss={consumePropertyIntent} />}
      <Suspense fallback={<RouteTransitionFallback />}>
        <Suspense fallback={null}>
          <PrivateCallCenter />
        </Suspense>
        {profile && <NewLoginAlert profile={profile} />}
        <DesktopLayout
          navItems={desktopNavItems}
          activePage={navPage}
          onNavigate={goTo}
          userName={profile?.full_name || profile?.username || undefined}
          userRole={profile?.role || undefined}
          userAvatar={profile?.avatar_url || undefined}
          onLogout={auth.logout}
        >
          <div
            key={`${baseProfile?.user_id}:${activeWorkspace}`}
            ref={pageScrollRef}
            className="page-transition wh-workspace-enter min-h-[100dvh] w-full min-w-0 overflow-x-hidden overflow-y-auto bg-[#0A0A0F] scrollable-content"
          >
            {renderPage()}
          </div>
        </DesktopLayout>
        {isCreator && (
          <Suspense fallback={null}>
            <CreatorAuthModal />
          </Suspense>
        )}
        {supportRole && profile && (
          <Suspense fallback={null}>
            <SupportChat
              key={`${baseProfile?.user_id}:${activeWorkspace}`}
              onOpenListing={goToDetail}
              onOpenBooking={
                isUserRole
                  ? (id) => {
                      setBookingContextId(null);
                      goTo("my_reservations");
                      window.setTimeout(() => setBookingContextId(id), 0);
                    }
                  : undefined
              }
              profile={{
                user_id: profile.user_id,
                username: profile.username,
                email: profile.email,
                role: profile.role,
              }}
            />
          </Suspense>
        )}
        <div className="lg:hidden">
          {showBottomNav && (
            <nav className="bottom-nav fixed bottom-0 left-0 right-0 z-50">
              <div className="mx-auto flex max-w-lg items-center justify-around py-1">
                {tabs.map((tab) => {
                  const active = navPage === tab.id;
                  const badgeCount =
                    tab.id === "conversation"
                      ? unreadCount + supportUnreadCount + notificationCount
                      : 0;
                  return (
                    <button
                      key={tab.id}
                      aria-label={tab.label}
                      onClick={() => goTo(tab.id)}
                      className={`relative flex min-w-[56px] flex-col items-center gap-0.5 rounded-xl px-3 py-2 ${active ? "text-violet-400" : "text-[#5C5E72]"}`}
                    >
                      <tab.icon size={22} active={active} />
                      {
                        <span className="text-[9px] font-medium">
                          {tab.label}
                        </span>
                      }
                      {active && (
                        <span className="h-1 w-1 rounded-full bg-violet-400" />
                      )}
                      {badgeCount > 0 && (
                        <span className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-bold text-white">
                          {badgeCount > 99 ? "99+" : badgeCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </nav>
          )}
        </div>
      </Suspense>
    </CreatorAuthProvider>
  );
}

function SearchSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? "#A78BFA" : "currentColor"}
      strokeWidth="2"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}
function ProfileSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? "#A78BFA" : "currentColor"}
      strokeWidth="2"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function ReservationSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? "#A78BFA" : "currentColor"}
      strokeWidth="2"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18M8 15l2 2 5-5" />
    </svg>
  );
}
function InboxSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? "#A78BFA" : "currentColor"}
      strokeWidth="2"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m4 4-3 9v6a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2v-6l-3-9H4Zm-3 9h6l2 3h6l2-3h6" />
    </svg>
  );
}
