import { useState, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react';
import { toast } from 'sonner';
import { useAuth, canCreateListings, isCreator as checkCreator } from '@/hooks/useAuth';
import { CreatorAuthProvider } from '@/hooks/useCreatorAuth';
import { AdminAuthProvider } from '@/hooks/useAdminAuth';
import { getSavedListings, saveListing, unsaveListing, supabase } from '@/lib/supabase';
import CreatorAuthModal from '@/components/CreatorAuthModal';
import AdminAuthModal from '@/components/AdminAuthModal';
import SupportChat from '@/components/SupportChat';
import DesktopLayout from '@/components/DesktopLayout';
import { getNavForRole } from '@/lib/desktop-nav';
import Login from '@/pages/Login';
import Setup from '@/pages/Setup';
import WalletPage from '@/pages/WalletPage';
import type { NavPage } from '@/types/nav';

const Home = lazy(() => import('@/pages/Home'));
const Search = lazy(() => import('@/pages/Search'));
const Saved = lazy(() => import('@/pages/Saved'));
const ListingDetail = lazy(() => import('@/pages/ListingDetail'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const CreatorDashboard = lazy(() => import('@/pages/CreatorDashboard'));
const AdminDashboard = lazy(() => import('@/pages/AdminDashboard'));
const StaffDashboard = lazy(() => import('@/pages/StaffDashboard'));
const WorkerDashboard = lazy(() => import('@/pages/WorkerDashboard'));
const PropertyPartnerDashboard = lazy(() => import('@/pages/PropertyOwnerDashboard'));
const Roommate = lazy(() => import('@/pages/Roommate'));
const Chat = lazy(() => import('@/pages/Chat'));
const ProfileEdit = lazy(() => import('@/pages/ProfileEdit'));
const AccountCenter = lazy(() => import('@/pages/AccountCenter'));
const PrivacySettings = lazy(() => import('@/pages/PrivacySettings'));
const SecuritySettings = lazy(() => import('@/pages/SecuritySettings'));
const CreateListing = lazy(() => import('@/pages/CreateListing'));
const WorkerSetup = lazy(() => import('@/pages/WorkerSetup'));
const WorkerVerification = lazy(() => import('@/pages/WorkerVerification'));
const WorkerDiscovery = lazy(() => import('@/pages/WorkerDiscovery'));
const WorkerCategories = lazy(() => import('@/pages/WorkerCategories'));
const Activity = lazy(() => import('@/pages/Activity'));
const HotelsHome = lazy(() => import('@/pages/HotelsHome'));
const HotelDetail = lazy(() => import('@/pages/HotelDetail'));
const HotelBooking = lazy(() => import('@/pages/HotelBooking'));
const HotelReservation = lazy(() => import('@/pages/HotelReservation'));
const MyBookings = lazy(() => import('@/pages/MyBookings'));
const MyReservations = lazy(() => import('@/pages/MyReservations'));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage'));
const PrivacyPolicyPage = lazy(() => import('@/pages/PrivacyPolicyPage'));
const TermsPage = lazy(() => import('@/pages/TermsPage'));

function PageSkeleton() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] p-5 space-y-4">
      <div className="h-12 rounded-xl shimmer" />
      <div className="h-40 rounded-2xl shimmer" />
      <div className="grid grid-cols-2 gap-3"><div className="h-48 rounded-2xl shimmer" /><div className="h-48 rounded-2xl shimmer" /></div>
      <div className="h-48 rounded-2xl shimmer" />
    </div>
  );
}

function ErrorFallback({ reset }: { reset: () => void }) {
  return (
    <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center px-5">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg></div>
        <h2 className="text-lg font-semibold text-white mb-2">Something went wrong</h2>
        <p className="text-sm text-[#5C5E72] mb-6">The app encountered an error. Please try again.</p>
        <button onClick={reset} className="h-11 px-6 rounded-xl bg-[#3B82F6] text-white text-sm font-semibold">Reload App</button>
      </div>
    </div>
  );
}

const NAV_STORAGE_KEY = 'wh_navpage';
const DETAIL_STORAGE_KEY = 'wh_detailid';

const RESTORABLE_PAGES: NavPage[] = [
  'home', 'search', 'saved', 'roommate', 'activity', 'profile', 'account', 'privacy', 'security',
  'creator', 'admin', 'staff_dashboard', 'worker_dashboard', 'worker_discovery', 'worker_categories',
  'worker_verification', 'worker_setup', 'new_listing', 'analytics',
  'hotels', 'hotel_detail', 'hotel_booking', 'hotel_reservation', 'property_partner',
  'my_bookings', 'my_reservations', 'messages', 'wallet', 'detail', 'chat', 'profile_edit',
  'privacy_policy', 'terms_of_service',
];

function isRestorable(page: string): page is NavPage {
  return RESTORABLE_PAGES.includes(page as NavPage);
}

function canonicalDashboard(role: string): NavPage {
  switch (role) {
    case 'creator': return 'creator';
    case 'admin': return 'admin';
    case 'staff': return 'staff_dashboard';
    case 'worker': return 'worker_dashboard';
    case 'property_partner': return 'property_partner';
    default: return 'home';
  }
}

function pageAllowedForRole(page: NavPage, role: string): boolean {
  if (page === 'privacy_policy' || page === 'terms_of_service') return true;

  const accountPages: NavPage[] = ['profile', 'account', 'privacy', 'security'];
  if (accountPages.includes(page)) return true;

  switch (role) {
    case 'creator':
      return ['home', 'creator', 'analytics', 'new_listing'].includes(page);
    case 'admin':
      return ['home', 'admin', 'new_listing'].includes(page);
    case 'staff':
      return ['home', 'staff_dashboard'].includes(page);
    case 'worker':
      return ['home', 'worker_dashboard', 'worker_setup', 'worker_verification', 'messages', 'chat', 'wallet', 'my_bookings'].includes(page);
    case 'property_partner':
      return ['home', 'property_partner'].includes(page);
    default:
      return ['home', 'search', 'saved', 'roommate', 'activity', 'messages', 'chat', 'profile_edit', 'detail', 'worker_discovery', 'worker_categories', 'hotels', 'hotel_detail', 'hotel_booking', 'hotel_reservation', 'my_bookings', 'my_reservations'].includes(page);
  }
}

export default function App() {
  const auth = useAuth();
  const [navPage, setNavPage] = useState<NavPage>('home');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [hotelId, setHotelId] = useState<number | null>(null);
  const [hotelRoomId, setHotelRoomId] = useState<number | null>(null);
  const [hotelCheckIn, setHotelCheckIn] = useState('');
  const [hotelCheckOut, setHotelCheckOut] = useState('');
  const [chatConvId, setChatConvId] = useState<string | null>(null);
  const [workerCategory, setWorkerCategory] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const profile = auth.profile;
  const userRole = profile?.role || '';
  const isUserRole = userRole === 'user';
  const isWorkerRole = userRole === 'worker';
  const isAdminRole = userRole === 'admin';
  const isStaffRole = userRole === 'staff';
  const isCreatorRole = checkCreator(userRole);
  const canList = canCreateListings(userRole);
  const isCreator = checkCreator(userRole);

  // Bottom navigation is a customer navigation system. Operational roles use their own dashboards.
  const tabs = useMemo(() => isUserRole ? [
    { id: 'home' as NavPage, label: 'Home', icon: HomeSvg },
    { id: 'search' as NavPage, label: 'Search', icon: SearchSvg },
    { id: 'saved' as NavPage, label: 'Saved', icon: BookmarkSvg },
    { id: 'messages' as NavPage, label: 'Messages', icon: MessagesSvg },
    { id: 'profile' as NavPage, label: 'Account', icon: ProfileSvg },
  ] : [], [isUserRole]);

  const restoredRef = useRef(false);
  useEffect(() => {
    if (auth.isLoading || restoredRef.current || !auth.profile) return;
    restoredRef.current = true;
    let savedPage: NavPage | null = null;
    try {
      const raw = localStorage.getItem(NAV_STORAGE_KEY);
      if (raw && isRestorable(raw)) savedPage = raw;
    } catch { /* ignore */ }
    if (savedPage && pageAllowedForRole(savedPage, auth.profile.role)) {
      setNavPage(savedPage);
    } else if (auth.profile.role !== 'user') {
      setNavPage(canonicalDashboard(auth.profile.role));
    }
  }, [auth.isLoading, auth.profile]);

  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (!hasRestoredRef.current) { hasRestoredRef.current = true; return; }
    if (isRestorable(navPage)) localStorage.setItem(NAV_STORAGE_KEY, navPage);
    if (detailId) localStorage.setItem(DETAIL_STORAGE_KEY, detailId);
  }, [navPage, detailId]);

  const navHistoryRef = useRef<NavPage[]>(['home']);
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const state = e.state as { page?: NavPage } | null;
      if (!state?.page) return;
      if (profile && !pageAllowedForRole(state.page, profile.role)) {
        setNavPage(canonicalDashboard(profile.role));
        return;
      }
      setNavPage(state.page);
      if (navHistoryRef.current.length > 1) navHistoryRef.current = navHistoryRef.current.slice(0, -1);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [profile]);

  const handleSetNavPage = useCallback((requestedPage: NavPage) => {
    const page = profile && !pageAllowedForRole(requestedPage, profile.role) ? canonicalDashboard(profile.role) : requestedPage;
    const currentPage = navHistoryRef.current[navHistoryRef.current.length - 1];
    if (page !== currentPage) {
      window.history.pushState({ page }, '', `#${page}`);
      navHistoryRef.current = [...navHistoryRef.current, page];
    }
    setNavPage(page);
    if (isRestorable(page)) localStorage.setItem(NAV_STORAGE_KEY, page);
  }, [profile]);

  useEffect(() => {
    const handler = (e: ErrorEvent) => { setError(e.error); e.preventDefault(); };
    window.addEventListener('error', handler);
    return () => window.removeEventListener('error', handler);
  }, []);

  useEffect(() => {
    if (!auth.profile?.user_id) return;
    getSavedListings(auth.profile.user_id).then(({ saved }) => {
      if (saved) setSavedIds(new Set(saved.map(s => s.listing_id)));
    }).catch(() => {});
  }, [auth.profile?.user_id]);

  useEffect(() => {
    if (!auth.profile?.user_id) return;
    const userId = auth.profile.user_id;
    async function countAllUnread() {
      const { data: convs } = await supabase.from('conversations').select('participant_a,unread_a,unread_b').or(`participant_a.eq.${userId},participant_b.eq.${userId}`);
      let chatUnread = 0;
      (convs || []).forEach((c: any) => { chatUnread += c.participant_a === userId ? (c.unread_a || 0) : (c.unread_b || 0); });
      const { count } = await supabase.from('announcement_recipients').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('read_status', false);
      setUnreadCount(chatUnread + (count || 0));
    }
    void countAllUnread();
    const convChannel = supabase.channel('global-unread-conv').on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, countAllUnread).subscribe();
    const announcementChannel = supabase.channel('global-unread-official').on('postgres_changes', { event: '*', schema: 'public', table: 'announcement_recipients', filter: `user_id=eq.${userId}` }, countAllUnread).subscribe();
    return () => { supabase.removeChannel(convChannel); supabase.removeChannel(announcementChannel); };
  }, [auth.profile?.user_id]);

  const handleToggleSave = useCallback(async (listingId: string) => {
    if (!auth.profile) return;
    const userId = auth.profile.user_id;
    if (savedIds.has(listingId)) {
      await unsaveListing(userId, listingId).catch(() => {});
      setSavedIds(prev => { const next = new Set(prev); next.delete(listingId); return next; });
    } else {
      await saveListing(userId, listingId).catch(() => {});
      setSavedIds(prev => new Set(prev).add(listingId));
    }
  }, [auth.profile, savedIds]);

  const goTo = useCallback((page: NavPage, category?: string) => { if (category) setWorkerCategory(category); handleSetNavPage(page); }, [handleSetNavPage]);
  const goToDetail = useCallback((id: string) => { setDetailId(id); handleSetNavPage('detail'); }, [handleSetNavPage]);
  const goBack = useCallback(() => { setDetailId(null); window.history.back(); }, []);
  const goToChat = useCallback((convId?: string) => { setChatConvId(convId || null); handleSetNavPage('chat'); }, [handleSetNavPage]);
  const goToProfileEdit = useCallback(() => handleSetNavPage('profile_edit'), [handleSetNavPage]);
  const goToAccount = useCallback(() => handleSetNavPage('account'), [handleSetNavPage]);
  const goToPrivacy = useCallback(() => handleSetNavPage('privacy'), [handleSetNavPage]);
  const goToSecurity = useCallback(() => handleSetNavPage('security'), [handleSetNavPage]);
  const goToNewListing = useCallback(() => handleSetNavPage('new_listing'), [handleSetNavPage]);
  const goToHotel = useCallback(() => { setHotelId(null); setHotelRoomId(null); setHotelCheckIn(''); setHotelCheckOut(''); handleSetNavPage('hotels'); }, [handleSetNavPage]);
  const goToHotelDetail = useCallback((id: number) => { setHotelId(id); setHotelRoomId(null); handleSetNavPage('hotel_detail'); }, [handleSetNavPage]);
  const goToHotelBooking = useCallback((hId: number, rId: number, checkIn?: string, checkOut?: string) => { setHotelId(hId); setHotelRoomId(rId); setHotelCheckIn(checkIn || ''); setHotelCheckOut(checkOut || ''); handleSetNavPage('hotel_booking'); }, [handleSetNavPage]);
  const goToHotelReservation = useCallback((hId: number, rId: number) => { setHotelId(hId); setHotelRoomId(rId); handleSetNavPage('hotel_reservation'); }, [handleSetNavPage]);

  if (auth.isLoading) return <PageSkeleton />;
  if (auth.page === 'login') return <Login onLoginSuccess={auth.handleLoginSuccess} serverError={auth.error} kickedOut={auth.kickedOut} />;
  if (auth.page === 'setup' && auth.profile) return <Setup profile={auth.profile} onSetupComplete={auth.handleSetupComplete} />;
  if (auth.page === 'worker_setup' && auth.profile) return <WorkerSetup profile={auth.profile} onComplete={() => auth.handleSetupComplete(auth.profile!)} />;
  if (error) return <ErrorFallback reset={() => { setError(null); window.location.reload(); }} />;

  const renderRoleDashboard = () => {
    if (!profile) return <Login onLoginSuccess={auth.handleLoginSuccess} serverError={auth.error} />;
    switch (profile.role) {
      case 'creator': return <CreatorDashboard profile={profile} onLogout={auth.logout} onGoToNewListing={goToNewListing} onNavigate={(p) => goTo(p as NavPage)} onGoToChat={goToChat} />;
      case 'admin': return <AdminDashboard profile={profile} onLogout={auth.logout} onNavigate={(p) => goTo(p as NavPage)} onGoToChat={goToChat} />;
      case 'staff': return <StaffDashboard profile={profile} onLogout={auth.logout} onGoToChat={goToChat} onNavigate={(p) => goTo(p as NavPage)} />;
      case 'worker': return <WorkerDashboard profile={profile} onGoToSetup={() => goTo('worker_setup')} onLogout={auth.logout} onNavigate={(p) => goTo(p as NavPage)} onGoToChat={goToChat} onGoToMessages={() => goTo('chat')} />;
      case 'property_partner': return <PropertyPartnerDashboard profile={profile} onLogout={auth.logout} onNavigate={(p) => goTo(p as NavPage)} onGoToChat={goToChat} />;
      default: return null;
    }
  };

  const renderPage = () => {
    if (navPage === 'privacy_policy') return <PrivacyPolicyPage />;
    if (navPage === 'terms_of_service') return <TermsPage />;
    if (!profile) return <Login onLoginSuccess={auth.handleLoginSuccess} serverError={auth.error} />;

    if (!pageAllowedForRole(navPage, profile.role)) return renderRoleDashboard();

    const props = { profile, savedIds, onToggleSave: handleToggleSave };
    switch (navPage) {
      case 'home':
        if (profile.role !== 'user') return renderRoleDashboard();
        return <Home {...props} onNavigate={(p: string, id?: string) => id ? goToDetail(id) : goTo(p as NavPage)} isAdmin={false} />;
      case 'creator': return renderRoleDashboard();
      case 'admin': return renderRoleDashboard();
      case 'staff_dashboard': return renderRoleDashboard();
      case 'worker_dashboard': return renderRoleDashboard();
      case 'property_partner': return renderRoleDashboard();
      case 'search': return <Search onNavigate={(p: string, id?: string) => id ? goToDetail(id) : goTo(p as NavPage)} savedIds={savedIds} onToggleSave={handleToggleSave} />;
      case 'saved': return <Saved {...props} onNavigate={(p: string, id?: string) => id ? goToDetail(id) : goTo(p as NavPage)} />;
      case 'roommate': return <Roommate profile={profile} />;
      case 'activity': return <Activity profile={profile} onNavigate={(p: string, id?: string) => id ? goToDetail(id) : goTo(p as NavPage)} onGoToChat={goToChat} />;
      case 'profile': return <Dashboard profile={profile} onLogout={auth.logout} onNavigate={(p: string) => goTo(p as NavPage)} onGoToChat={goToChat} onGoToProfileEdit={goToProfileEdit} onGoToAccount={goToAccount} isAdmin={false} />;
      case 'detail': return detailId ? <ListingDetail listingId={detailId} onNavigate={goBack} isSaved={savedIds.has(detailId)} onToggleSave={() => handleToggleSave(detailId)} profile={profile} onGoToChat={goToChat} /> : null;
      case 'chat': return <Chat profile={profile} onNavigate={(p: string) => goTo(p as NavPage)} conversationId={chatConvId} />;
      case 'messages': return <Chat profile={profile} onNavigate={(p: string) => goTo(p as NavPage)} />;
      case 'profile_edit': return <ProfileEdit profile={profile} onUpdate={u => auth.handleSetupComplete(u)} onBack={() => goTo('profile')} />;
      case 'account': return <AccountCenter profile={profile} onBack={() => goTo('profile')} onGoToPrivacy={goToPrivacy} onGoToSecurity={goToSecurity} onGoToProfileEdit={goToProfileEdit} />;
      case 'privacy': return <PrivacySettings profile={profile} onUpdate={u => auth.handleSetupComplete(u)} onBack={() => goTo('account')} />;
      case 'security': return <SecuritySettings profile={profile} onBack={() => goTo('account')} />;
      case 'new_listing':
        if (!canList) return renderRoleDashboard();
        return <CreateListing profile={profile} onBack={() => goTo(canonicalDashboard(profile.role))} onSuccess={() => goTo(canonicalDashboard(profile.role))} />;
      case 'worker_setup': return <WorkerSetup profile={profile} onComplete={() => goTo('worker_dashboard')} />;
      case 'worker_verification': return <WorkerVerification profile={profile} onBack={() => goTo('worker_dashboard')} />;
      case 'worker_discovery': return <WorkerDiscovery userCity={profile.city} profile={profile} preSelectedCategory={workerCategory} onNavigate={(p) => goTo(p as NavPage)} />;
      case 'worker_categories': return <WorkerCategories onNavigate={(p) => goTo(p as NavPage)} profile={profile} />;
      case 'hotels': return <HotelsHome onNavigate={(p: string, id?: string) => p === 'hotel_detail' && id ? goToHotelDetail(Number(id)) : goTo(p as NavPage)} />;
      case 'hotel_detail': return hotelId ? <HotelDetail hotelId={hotelId} onBack={goToHotel} onBook={goToHotelBooking} onReserve={goToHotelReservation} profile={profile} /> : null;
      case 'hotel_booking': return hotelId && hotelRoomId ? <HotelBooking hotelId={hotelId} roomId={hotelRoomId} checkIn={hotelCheckIn} checkOut={hotelCheckOut} profile={profile} onBack={() => goTo('hotel_detail')} onComplete={goToHotel} /> : null;
      case 'hotel_reservation': return hotelId && hotelRoomId ? <HotelReservation hotelId={hotelId} roomId={hotelRoomId} profile={profile} onBack={() => goTo('hotel_detail')} onProceedToBooking={goToHotelBooking} onComplete={goToHotel} /> : null;
      case 'wallet': return isWorkerRole ? <WalletPage profile={profile} onBack={() => goTo('worker_dashboard')} /> : renderRoleDashboard();
      case 'my_bookings': return <MyBookings profile={profile} onBack={() => goTo(profile.role === 'worker' ? 'worker_dashboard' : 'profile')} />;
      case 'my_reservations': return <MyReservations profile={profile} onBack={() => goTo('profile')} />;
      case 'analytics': return isCreatorRole ? <AnalyticsPage profile={profile} /> : renderRoleDashboard();
      default: return renderRoleDashboard() || <Home {...props} onNavigate={(p: string, id?: string) => id ? goToDetail(id) : goTo(p as NavPage)} />;
    }
  };

  const desktopNavItems = getNavForRole(userRole, unreadCount);
  const showBottomNav = isUserRole && !['detail', 'chat', 'profile_edit', 'account', 'privacy', 'security', 'hotel_detail', 'hotel_booking', 'hotel_reservation', 'worker_discovery'].includes(navPage);

  return (
    <CreatorAuthProvider>
      <AdminAuthProvider>
        <Suspense fallback={<PageSkeleton />}>
          <DesktopLayout navItems={desktopNavItems} activePage={navPage} onNavigate={goTo} userName={profile?.full_name || profile?.username || undefined} userRole={profile?.role || undefined} userAvatar={profile?.avatar_url || undefined} onLogout={auth.logout}>
            <div className="page-transition min-h-[100dvh] bg-[#0A0A0F] overflow-y-auto scrollable-content">{renderPage()}</div>
          </DesktopLayout>

          {isCreator && <CreatorAuthModal />}
          {(isAdminRole || isStaffRole) && <AdminAuthModal />}
          {profile?.role === 'user' && <SupportChat profile={{ user_id: profile.user_id, username: profile.username, email: profile.email, role: profile.role }} />}

          <div className="lg:hidden">
            {showBottomNav && (
              <nav className="bottom-nav fixed bottom-0 left-0 right-0 z-50">
                <div className="max-w-lg mx-auto flex items-center justify-around py-1">
                  {tabs.map(tab => {
                    const active = navPage === tab.id;
                    return <button key={tab.id} onClick={() => goTo(tab.id)} className={`flex flex-col items-center gap-0.5 py-2 px-3 min-w-[56px] rounded-xl relative ${active ? 'text-[#3B82F6]' : 'text-[#5C5E72]'}`}><tab.icon size={22} active={active}/><span className="text-[9px] font-medium leading-none">{tab.label}</span>{active && <span className="w-1 h-1 rounded-full bg-[#3B82F6] mt-0.5"/>}{tab.id === 'messages' && unreadCount > 0 && <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">{unreadCount > 9 ? '9+' : unreadCount}</span>}</button>;
                  })}
                </div>
              </nav>
            )}
          </div>
        </Suspense>
      </AdminAuthProvider>
    </CreatorAuthProvider>
  );
}

function HomeSvg({ size, active }: { size: number; active: boolean }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>; }
function SearchSvg({ size, active }: { size: number; active: boolean }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>; }
function BookmarkSvg({ size, active }: { size: number; active: boolean }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>; }
function MessagesSvg({ size, active }: { size: number; active: boolean }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>; }
function ProfileSvg({ size, active }: { size: number; active: boolean }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>; }
