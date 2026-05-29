import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { useAuth, canCreateListings, isCreator as checkCreator } from '@/hooks/useAuth';
import { CreatorAuthProvider } from '@/hooks/useCreatorAuth';
import { getSavedListings, saveListing, unsaveListing, supabase } from '@/lib/supabase';
import CreatorAuthModal from '@/components/CreatorAuthModal';
import SupportChat from '@/components/SupportChat';
import Login from '@/pages/Login';
import Setup from '@/pages/Setup';
import type { NavPage } from '@/types/nav';

// Lazy load pages for performance
const Home = lazy(() => import('@/pages/Home'));
const Search = lazy(() => import('@/pages/Search'));
const Saved = lazy(() => import('@/pages/Saved'));
const ListingDetail = lazy(() => import('@/pages/ListingDetail'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const CreatorDashboard = lazy(() => import('@/pages/CreatorDashboard'));
const AdminDashboard = lazy(() => import('@/pages/AdminDashboard'));
const Roommate = lazy(() => import('@/pages/Roommate'));
const Chat = lazy(() => import('@/pages/Chat'));
const ProfileEdit = lazy(() => import('@/pages/ProfileEdit'));
const AccountCenter = lazy(() => import('@/pages/AccountCenter'));
const PrivacySettings = lazy(() => import('@/pages/PrivacySettings'));
const SecuritySettings = lazy(() => import('@/pages/SecuritySettings'));
const CreateListing = lazy(() => import('@/pages/CreateListing'));
const WorkerSetup = lazy(() => import('@/pages/WorkerSetup'));
const WorkerDashboard = lazy(() => import('@/pages/WorkerDashboard'));
const WorkerDiscovery = lazy(() => import('@/pages/WorkerDiscovery'));
const Activity = lazy(() => import('@/pages/Activity'));
const StaffDashboard = lazy(() => import('@/pages/StaffDashboard'));
const HeadOfStaffDashboard = lazy(() => import('@/pages/HeadOfStaffDashboard'));
const DirectorDashboard = lazy(() => import('@/pages/DirectorDashboard'));
const HotelsHome = lazy(() => import('@/pages/HotelsHome'));
const HotelDetail = lazy(() => import('@/pages/HotelDetail'));
const HotelBooking = lazy(() => import('@/pages/HotelBooking'));
const PremiumPage = lazy(() => import('@/pages/PremiumPage'));

// ─── SKELETON LOADER ──────────────────────────────
function PageSkeleton() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] p-5 space-y-4">
      <div className="h-12 rounded-xl shimmer" />
      <div className="h-40 rounded-2xl shimmer" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-48 rounded-2xl shimmer" />
        <div className="h-48 rounded-2xl shimmer" />
      </div>
      <div className="h-48 rounded-2xl shimmer" />
    </div>
  );
}

// ─── ERROR BOUNDARY ───────────────────────────────
function ErrorFallback({ reset }: { reset: () => void }) {
  return (
    <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center px-5">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-white mb-2">Something went wrong</h2>
        <p className="text-sm text-[#5C5E72] mb-6">The app encountered an error. Please try again.</p>
        <button onClick={reset} className="h-11 px-6 rounded-xl bg-[#3B82F6] text-white text-sm font-semibold hover:bg-[#2563EB] transition-colors">
          Reload App
        </button>
      </div>
    </div>
  );
}

// Key for persisting navigation page across refreshes
const NAV_STORAGE_KEY = 'wh_navpage';
const DETAIL_STORAGE_KEY = 'wh_detailid';

// Pages that can be safely restored after refresh
const RESTORABLE_PAGES: NavPage[] = ['home', 'search', 'saved', 'roommate', 'activity', 'profile', 'account', 'privacy', 'security', 'premium', 'creator', 'admin', 'state_admin', 'assistant_state_admin', 'worker_dashboard', 'worker_discovery', 'staff_dashboard', 'new_listing', 'hotels', 'director'];

function isRestorable(page: string): page is NavPage {
  return RESTORABLE_PAGES.includes(page as NavPage);
}

// ─── MAIN APP ─────────────────────────────────────
export default function App() {
  const auth = useAuth();

  // Read saved page from localStorage BEFORE first render
  const savedPageInit = (() => {
    try {
      const saved = localStorage.getItem(NAV_STORAGE_KEY);
      return saved && isRestorable(saved) ? saved : null;
    } catch { return null; }
  })();

  const [navPage, setNavPage] = useState<NavPage>(savedPageInit || 'home');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [hotelId, setHotelId] = useState<number | null>(null);
  const [hotelRoomId, setHotelRoomId] = useState<number | null>(null);
  const [chatConvId, setChatConvId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const isWorker = auth.profile?.role === 'worker';
  const canList = canCreateListings(auth.profile?.role || '');
  const isCreator = checkCreator(auth.profile?.role || '');

  // ─── Validate restored page against user role ─────
  useEffect(() => {
    if (auth.isLoading || !auth.profile) return;

    const role = auth.profile.role;
    let valid = true;

    if (navPage === 'creator' && !checkCreator(role)) valid = false;
    if (navPage === 'admin' && role !== 'admin') valid = false;
    if (navPage === 'state_admin' && role !== 'state_admin') valid = false;
    if (navPage === 'assistant_state_admin' && role !== 'assistant_state_admin') valid = false;
    if (navPage === 'worker_dashboard' && role !== 'worker') valid = false;
    if (navPage === 'profile' && (role === 'worker' || checkCreator(role) || role === 'state_admin' || role === 'assistant_state_admin')) valid = false;
    // Profile sub-pages (account, privacy, security) same rules as profile
    if ((navPage === 'account' || navPage === 'privacy' || navPage === 'security') && (role === 'worker' || checkCreator(role) || role === 'state_admin' || role === 'assistant_state_admin')) valid = false;
    if (navPage === 'roommate' && role !== 'user' && role !== 'worker') valid = false;

    if (!valid) {
      setNavPage('home');
      localStorage.setItem(NAV_STORAGE_KEY, 'home');
    }
  }, [auth.isLoading, auth.profile]);

  // ─── Persist nav page to localStorage ─────────────
  useEffect(() => {
    if (isRestorable(navPage)) {
      localStorage.setItem(NAV_STORAGE_KEY, navPage);
    }
    if (detailId) {
      localStorage.setItem(DETAIL_STORAGE_KEY, detailId);
    }
  }, [navPage, detailId]);

  // ─── Clear stored nav on logout ───────────────────
  const handleSetNavPage = useCallback((page: NavPage) => {
    setNavPage(page);
    if (isRestorable(page)) {
      localStorage.setItem(NAV_STORAGE_KEY, page);
    }
  }, []);

  // Error boundary
  useEffect(() => {
    const handler = (e: ErrorEvent) => { setError(e.error); e.preventDefault(); };
    window.addEventListener('error', handler);
    return () => window.removeEventListener('error', handler);
  }, []);

  if (error) return <ErrorFallback reset={() => { setError(null); window.location.reload(); }} />;

  // Load saved listings
  useEffect(() => {
    if (auth.profile?.user_id) {
      getSavedListings(auth.profile.user_id).then(({ saved }) => {
        if (saved) setSavedIds(new Set(saved.map((s) => s.listing_id)));
      }).catch(() => {});
    }
  }, [auth.profile?.user_id]);

  // Global unread message count (conversations + official)
  useEffect(() => {
    if (!auth.profile?.user_id) return;
    const userId = auth.profile.user_id;

    async function countAllUnread() {
      // Count conversation unreads
      const { data: convs } = await supabase
        .from('conversations')
        .select('unread_a, unread_b')
        .or(`participant_a.eq.${userId},participant_b.eq.${userId}`);
      let chatUnread = 0;
      (convs || []).forEach((c: any) => {
        chatUnread += c.participant_a === userId ? (c.unread_a || 0) : (c.unread_b || 0);
      });

      // Count announcement unreads
      const { count: officialUnread } = await supabase
        .from('announcement_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read_status', false);

      setUnreadCount(chatUnread + (officialUnread || 0));
    }
    countAllUnread();

    // Subscribe to conversation updates
    const convChannel = supabase
      .channel('global-unread-conv')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        countAllUnread();
      })
      .subscribe();

    // Subscribe to announcement recipient updates
    const officialChannel = supabase
      .channel('global-unread-official')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'announcement_recipients', filter: `user_id=eq.${userId}` },
        () => {
          countAllUnread();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(convChannel);
      supabase.removeChannel(officialChannel);
    };
  }, [auth.profile?.user_id]);

  // Roommate page handles its own state internally

  const handleToggleSave = useCallback(async (listingId: string) => {
    if (!auth.profile) return;
    const userId = auth.profile.user_id;
    if (savedIds.has(listingId)) {
      await unsaveListing(userId, listingId).catch(() => {});
      setSavedIds((prev) => { const n = new Set(prev); n.delete(listingId); return n; });
    } else {
      await saveListing(userId, listingId).catch(() => {});
      setSavedIds((prev) => { const n = new Set(prev); n.add(listingId); return n; });
    }
  }, [auth.profile, savedIds]);

  const goTo = useCallback((page: NavPage) => handleSetNavPage(page), [handleSetNavPage]);
  const goToDetail = useCallback((id: string) => { setDetailId(id); setNavPage('detail'); }, []);
  const goBack = useCallback(() => { setDetailId(null); handleSetNavPage('home'); }, [handleSetNavPage]);
  const goToChat = useCallback((convId?: string) => { setChatConvId(convId || null); setNavPage('chat'); }, []);
  const goToProfileEdit = useCallback(() => setNavPage('profile_edit'), []);
  const goToAccount = useCallback(() => setNavPage('account'), []);
  const goToPrivacy = useCallback(() => setNavPage('privacy'), []);
  const goToSecurity = useCallback(() => setNavPage('security'), []);
  const goToPremium = useCallback(() => setNavPage('premium'), []);
  const goToNewListing = useCallback(() => setNavPage('new_listing'), []);
  const goToHotel = useCallback(() => { setHotelId(null); setHotelRoomId(null); setNavPage('hotels'); }, []);
  const goToHotelDetail = useCallback((id: number) => { setHotelId(id); setHotelRoomId(null); setNavPage('hotel_detail'); }, []);
  const goToHotelBooking = useCallback((hId: number, rId: number) => { setHotelId(hId); setHotelRoomId(rId); setNavPage('hotel_booking'); }, []);

  // ─── LOADING ──────────────────────────────────────
  if (auth.isLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-[#5C5E72]">Loading WeHouse...</p>
      </div>
    );
  }

  // ─── LOGIN ────────────────────────────────────────
  if (auth.page === 'login') {
    return <Login onLoginSuccess={auth.handleLoginSuccess} serverError={auth.error} kickedOut={auth.kickedOut} />;
  }

  // ─── SETUP ────────────────────────────────────────
  if (auth.page === 'setup' && auth.profile) {
    return <Setup profile={auth.profile} onSetupComplete={auth.handleSetupComplete} />;
  }

  // ─── WORKER SETUP ─────────────────────────────────
  if (auth.page === 'worker_setup' && auth.profile) {
    return <WorkerSetup profile={auth.profile} onComplete={() => { auth.handleSetupComplete(auth.profile!); }} />;
  }

  const profile = auth.profile;
  if (!profile) return <Login onLoginSuccess={auth.handleLoginSuccess} serverError={auth.error} />;

  // ─── PAGE ROUTER ──────────────────────────────────
  const renderPage = () => {
    const props = { profile, savedIds, onToggleSave: handleToggleSave };
    switch (navPage) {
      case 'home':
        return <Home {...props} onNavigate={(p: string, id?: string) => id ? goToDetail(id) : goTo(p as NavPage)} isAdmin={canList} onGoToNewListing={goToNewListing} />;
      case 'search':
        return <Search onNavigate={(p: string, id?: string) => id ? goToDetail(id) : goTo(p as NavPage)} savedIds={savedIds} onToggleSave={handleToggleSave} />;
      case 'saved':
        return <Saved {...props} onNavigate={(p: string, id?: string) => id ? goToDetail(id) : goTo(p as NavPage)} />;
      case 'roommate':
        // Only users and workers can access roommate matching
        if (!canAccessRoommate) {
          setNavPage('home');
          return null;
        }
        return <Roommate profile={profile} />;
      case 'activity':
        return <Activity profile={profile} onNavigate={(p: string, id?: string) => id ? goToDetail(id) : goTo(p as NavPage)} onGoToChat={goToChat} />;
      case 'profile':
        return <Dashboard profile={profile} onLogout={auth.logout} onNavigate={(p: string) => goTo(p as NavPage)} onGoToChat={goToChat} onGoToProfileEdit={goToProfileEdit} onGoToAccount={goToAccount} isAdmin={canList} onGoToNewListing={goToNewListing} />;
      case 'creator':
        return <CreatorDashboard profile={profile} onLogout={auth.logout} onGoToNewListing={goToNewListing} onNavigate={(p) => goTo(p as NavPage)} />;
      case 'director':
        return <DirectorDashboard profile={profile} onLogout={auth.logout} onNavigate={(p) => goTo(p as NavPage)} />;
      case 'admin':
        return <HeadOfStaffDashboard profile={profile} onLogout={auth.logout} onNavigate={(p) => goTo(p as NavPage)} />;
      case 'state_admin':
        return <AdminDashboard profile={profile} onLogout={auth.logout} onNavigate={(p) => goTo(p as NavPage)} isStateAdmin />;
      case 'assistant_state_admin':
        return <AdminDashboard profile={profile} onLogout={auth.logout} onNavigate={(p) => goTo(p as NavPage)} isAssistant />;
      case 'staff_dashboard':
        return <StaffDashboard profile={profile} onLogout={auth.logout} onGoToChat={goToChat} onNavigate={(p) => goTo(p as NavPage)} />;
      case 'detail':
        return detailId ? <ListingDetail listingId={detailId} onNavigate={goBack} isSaved={savedIds.has(detailId)} onToggleSave={() => handleToggleSave(detailId)} profile={profile} onGoToChat={goToChat} /> : null;
      case 'chat':
        return <Chat profile={profile} onNavigate={(p: string) => goTo(p as NavPage)} conversationId={chatConvId} />;
      case 'profile_edit':
        // Staff cannot edit their profile — location is assigned by admin/creator
        if (profile.role === 'staff') {
          return (
            <div className="min-h-screen bg-transparent flex items-center justify-center px-5">
              <div className="text-center max-w-sm">
                <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-white mb-2">Profile Locked</h2>
                <p className="text-sm text-[#8A8B9C] mb-4">As a staff member, your profile is managed by the admin. You cannot edit your location or other details directly.</p>
                <p className="text-xs text-[#5C5E72] mb-6">Contact your admin if you need any changes.</p>
                <button
                  onClick={() => goTo('profile')}
                  className="h-11 px-6 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  Back to Profile
                </button>
              </div>
            </div>
          );
        }
        return <ProfileEdit profile={profile} onUpdate={(u) => auth.handleSetupComplete(u)} onBack={() => goTo('profile')} />;
      case 'account':
        return <AccountCenter profile={profile} onBack={() => goTo('profile')} onGoToPrivacy={goToPrivacy} onGoToSecurity={goToSecurity} onGoToProfileEdit={goToProfileEdit} onGoToPremium={goToPremium} />;
      case 'privacy':
        return <PrivacySettings profile={profile} onUpdate={(u) => auth.handleSetupComplete(u)} onBack={() => goTo('account')} />;
      case 'security':
        return <SecuritySettings profile={profile} onBack={() => goTo('account')} />;
      case 'premium':
        return <PremiumPage profile={profile} onBack={() => goTo('account')} />;
      case 'new_listing':
        // Only staff, admin, creator can create listings
        if (!canList) {
          setNavPage('home');
          return null;
        }
        return <CreateListing profile={profile} onBack={() => goTo('home')} onSuccess={() => goTo('home')} />;
      case 'worker_dashboard':
        return <WorkerDashboard profile={profile} onGoToSetup={() => goTo('worker_setup')} onLogout={auth.logout} />;
      case 'worker_discovery':
        return <WorkerDiscovery userCity={profile.city} profile={profile} onGoToChat={goToChat} />;
      case 'worker_setup':
        return <WorkerSetup profile={profile} onComplete={() => goTo('worker_dashboard')} />;
      case 'hotels':
        return <HotelsHome onNavigate={(p: string, id?: string) => p === 'hotel_detail' && id ? goToHotelDetail(Number(id)) : goTo(p as NavPage)} />;
      case 'hotel_detail':
        return hotelId ? <HotelDetail hotelId={hotelId} onBack={goToHotel} onBook={goToHotelBooking} profile={profile} /> : null;
      case 'hotel_booking':
        return hotelId && hotelRoomId ? <HotelBooking hotelId={hotelId} roomId={hotelRoomId} profile={profile} onBack={() => setNavPage('hotel_detail')} onComplete={goToHotel} /> : null;
      default:
        return <Home {...props} onNavigate={(p: string, id?: string) => id ? goToDetail(id) : goTo(p as NavPage)} />;
    }
  };

  // ── Roommate access: only regular users and workers ──
  const canAccessRoommate = profile.role === 'user' || profile.role === 'worker';

  // Bottom nav — dynamically built per role
  const baseTabs = [
    { id: 'home' as NavPage, label: 'Home', icon: HomeSvg },
    { id: 'search' as NavPage, label: 'Listings', icon: ListingsSvg },
    { id: 'hotels' as NavPage, label: 'Hotels', icon: HotelSvg },
    ...(canAccessRoommate ? [{ id: 'roommate' as NavPage, label: 'Roommates', icon: UsersSvg }] : []),
    { id: 'worker_discovery' as NavPage, label: 'Workers', icon: WrenchSvg },
  ];

  const isStateAdminRole = profile.role === 'state_admin';
  const isAssistantRole = profile.role === 'assistant_state_admin';
  const isHeadOfStaffRole = profile.role === 'admin';
  const isDirectorRole = profile.role === 'director';

  const isStaffRole = profile.role === 'staff';

  const roleTab = isWorker
    ? { id: 'worker_dashboard' as NavPage, label: 'Profile', icon: ProfileSvg }
    : isCreator
    ? { id: 'creator' as NavPage, label: 'Creator', icon: AdminSvg }
    : isDirectorRole
    ? { id: 'director' as NavPage, label: 'Director', icon: AdminSvg }
    : isStateAdminRole
    ? { id: 'state_admin' as NavPage, label: 'Admin', icon: AdminSvg }
    : isAssistantRole
    ? { id: 'assistant_state_admin' as NavPage, label: 'Asst. Admin', icon: AdminSvg }
    : isHeadOfStaffRole
    ? { id: 'admin' as NavPage, label: 'Head of Staff', icon: AdminSvg }
    : isStaffRole
    ? { id: 'staff_dashboard' as NavPage, label: 'Staff', icon: StaffSvg }
    : { id: 'profile' as NavPage, label: 'Profile', icon: ProfileSvg };

  const tabs = [...baseTabs, roleTab];

  return (
    <CreatorAuthProvider>
      <Suspense fallback={<PageSkeleton />}>
        <div className="page-transition min-h-screen bg-[#0A0A0F]">
          {renderPage()}
        </div>

        {/* Creator Authorization Modal — only for creator, gates critical actions */}
        {isCreator && <CreatorAuthModal />}

        {/* AI Support Chat — always available for help */}
        <SupportChat profile={auth.profile ? {
          user_id: auth.profile.user_id,
          username: auth.profile.username,
          email: auth.profile.email,
          is_premium: auth.profile.is_premium,
          role: auth.profile.role,
        } : null} />

      {/* Bottom Nav — hidden on detail/sub-pages */}
      {navPage !== 'detail' && navPage !== 'chat' && navPage !== 'profile_edit' && navPage !== 'account' && navPage !== 'privacy' && navPage !== 'security' && navPage !== 'premium' && navPage !== 'new_listing' && navPage !== 'worker_setup' && navPage !== 'admin' && navPage !== 'state_admin' && navPage !== 'assistant_state_admin' && navPage !== 'saved' && navPage !== 'hotel_detail' && navPage !== 'hotel_booking' && (
        <nav className="bottom-nav fixed bottom-0 left-0 right-0 z-50">
          <div className="max-w-lg mx-auto flex items-center justify-around py-1">
            {tabs.map((tab) => {
              const isActive = navPage === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => goTo(tab.id)}
                  className={`flex flex-col items-center gap-0.5 py-2 px-3 min-w-[56px] rounded-xl transition-all duration-200 relative ${
                    isActive
                      ? 'text-[#3B82F6]'
                      : 'text-[#5C5E72] hover:text-[#8B8DA0]'
                  }`}
                >
                  <tab.icon size={22} active={isActive} />
                  <span className="text-[9px] font-medium leading-none">{tab.label}</span>
                  {isActive && <span className="w-1 h-1 rounded-full bg-[#3B82F6] mt-0.5" />}
                  {/* Unread badge on Profile tab */}
                  {tab.id === 'profile' && unreadCount > 0 && (
                    <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      )}
      </Suspense>
    </CreatorAuthProvider>
  );
}

// ─── SVG ICONS ─────────────────────────────────────
function HomeSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function ListingsSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function UsersSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function ProfileSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function WrenchSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function HotelSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z" />
      <path d="m2 20h20" />
      <path d="M12 11v-6" />
      <path d="M9 11v-2" />
      <path d="M15 11v-2" />
      <path d="M8 22v-5a2 2 0 0 1 4 0v5" />
      <path d="M12 22v-5a2 2 0 0 1 4 0v5" />
    </svg>
  );
}

function AdminSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function StaffSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#F59E0B' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 7h-4V4c0-1.103-.897-2-2-2h-4c-1.103 0-2 .897-2 2v3H4c-1.103 0-2 .897-2 2v11c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V9c0-1.103-.897-2-2-2zM9 7V4h6v3" />
    </svg>
  );
}