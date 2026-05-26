import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { useAuth, hasAdminAccess } from '@/hooks/useAuth';
import { getSavedListings, saveListing, unsaveListing } from '@/lib/supabase';
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

// ─── MAIN APP ─────────────────────────────────────
export default function App() {
  const auth = useAuth();
  const [navPage, setNavPage] = useState<NavPage>('home');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  // Roommate is now a unified page — no mode state needed
  const [error, setError] = useState<Error | null>(null);
  const isAdmin = hasAdminAccess(auth.profile?.role || '');
  const isWorker = auth.profile?.role === 'worker';
  const isUser = !isAdmin && !isWorker;

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

  const goTo = useCallback((page: NavPage) => setNavPage(page), []);
  const goToDetail = useCallback((id: string) => { setDetailId(id); setNavPage('detail'); }, []);
  const goBack = useCallback(() => { setDetailId(null); setNavPage('home'); }, []);
  const goToChat = useCallback(() => setNavPage('chat'), []);
  const goToProfileEdit = useCallback(() => setNavPage('profile_edit'), []);
  const goToAccount = useCallback(() => setNavPage('account'), []);
  const goToPrivacy = useCallback(() => setNavPage('privacy'), []);
  const goToSecurity = useCallback(() => setNavPage('security'), []);
  const goToNewListing = useCallback(() => setNavPage('new_listing'), []);

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
    return <Login onLoginSuccess={auth.handleLoginSuccess} serverError={auth.error} />;
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
        return <Home {...props} onNavigate={(p: string, id?: string) => id ? goToDetail(id) : goTo(p as NavPage)} isAdmin={isAdmin} onGoToNewListing={goToNewListing} />;
      case 'search':
        return <Search onNavigate={(p: string, id?: string) => id ? goToDetail(id) : goTo(p as NavPage)} savedIds={savedIds} onToggleSave={handleToggleSave} />;
      case 'saved':
        return <Saved {...props} onNavigate={(p: string, id?: string) => id ? goToDetail(id) : goTo(p as NavPage)} />;
      case 'roommate':
        return <Roommate profile={profile} />;
      case 'profile':
        return <Dashboard profile={profile} onLogout={auth.logout} onNavigate={(p: string) => goTo(p as NavPage)} onGoToChat={goToChat} onGoToProfileEdit={goToProfileEdit} onGoToAccount={goToAccount} isAdmin={isAdmin} onGoToNewListing={goToNewListing} />;
      case 'creator':
        return <CreatorDashboard profile={profile} onLogout={auth.logout} onGoToNewListing={goToNewListing} />;
      case 'detail':
        return detailId ? <ListingDetail listingId={detailId} onNavigate={goBack} isSaved={savedIds.has(detailId)} onToggleSave={() => handleToggleSave(detailId)} /> : null;
      case 'chat':
        return <Chat profile={profile} onNavigate={(p: string) => goTo(p as NavPage)} />;
      case 'profile_edit':
        return <ProfileEdit profile={profile} onUpdate={(u) => auth.handleSetupComplete(u)} onBack={() => goTo('profile')} />;
      case 'account':
        return <AccountCenter profile={profile} onBack={() => goTo('profile')} onGoToPrivacy={goToPrivacy} onGoToSecurity={goToSecurity} onGoToProfileEdit={goToProfileEdit} />;
      case 'privacy':
        return <PrivacySettings profile={profile} onUpdate={(u) => auth.handleSetupComplete(u)} onBack={() => goTo('account')} />;
      case 'security':
        return <SecuritySettings profile={profile} onBack={() => goTo('account')} />;
      case 'new_listing':
        // Only staff and admin can create listings
        if (!isAdmin) {
          setNavPage('home');
          return null;
        }
        return <CreateListing profile={profile} onBack={() => goTo('home')} onSuccess={() => goTo('home')} />;
      case 'worker_dashboard':
        return <WorkerDashboard profile={profile} onGoToSetup={() => goTo('worker_setup')} onLogout={auth.logout} />;
      case 'worker_discovery':
        return <WorkerDiscovery userCity={profile.city} />;
      case 'worker_setup':
        return <WorkerSetup profile={profile} onComplete={() => goTo('worker_dashboard')} />;
      default:
        return <Home {...props} onNavigate={(p: string, id?: string) => id ? goToDetail(id) : goTo(p as NavPage)} />;
    }
  };

  // Bottom nav tabs — different for each role
  const tabs = [
    { id: 'home' as NavPage, label: 'Home', icon: HomeSvg },
    { id: 'search' as NavPage, label: 'Search', icon: SearchSvg },
    { id: 'saved' as NavPage, label: 'Saved', icon: HeartSvg },
    { id: 'roommate' as NavPage, label: 'Roommate', icon: UsersSvg },
    ...(isUser ? [{ id: 'worker_discovery' as NavPage, label: 'Workers', icon: WrenchSvg }] : []),
    ...(isWorker ? [{ id: 'worker_dashboard' as NavPage, label: 'Dashboard', icon: BriefcaseSvg }] : []),
    ...(isAdmin
      ? [{ id: 'creator' as NavPage, label: 'Admin', icon: AdminSvg }]
      : isUser ? [{ id: 'profile' as NavPage, label: 'Profile', icon: UserSvg }] : []),
  ];

  return (
    <Suspense fallback={<PageSkeleton />}>
      <div className="page-transition">
        {renderPage()}
      </div>

      {/* Bottom Nav */}
      {navPage !== 'detail' && navPage !== 'chat' && navPage !== 'profile_edit' && navPage !== 'account' && navPage !== 'privacy' && navPage !== 'security' && navPage !== 'new_listing' && navPage !== 'worker_setup' && (
        <nav className="bottom-nav fixed bottom-0 left-0 right-0 z-50">
          <div className="max-w-lg mx-auto flex items-center justify-around py-1">
            {tabs.map((tab) => {
              const isActive = navPage === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => goTo(tab.id)}
                  className={`flex flex-col items-center gap-0.5 py-2 px-3 min-w-[56px] rounded-xl transition-all duration-200 ${
                    isActive
                      ? 'text-[#3B82F6]'
                      : 'text-[#5C5E72] hover:text-[#8B8DA0]'
                  }`}
                >
                  <tab.icon size={22} active={isActive} />
                  <span className="text-[9px] font-medium leading-none">{tab.label}</span>
                  {isActive && <span className="w-1 h-1 rounded-full bg-[#3B82F6] mt-0.5" />}
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </Suspense>
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
function SearchSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  );
}
function HeartSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={active ? '#3B82F6' : 'none'} stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
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
function UserSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function AdminSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
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

function BriefcaseSvg({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}
