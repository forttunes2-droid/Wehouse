import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getSavedListings, saveListing, unsaveListing } from '@/lib/supabase';
import Login from '@/pages/Login';
import Setup from '@/pages/Setup';
import Home from '@/pages/Home';
import Search from '@/pages/Search';
import ListingDetail from '@/pages/ListingDetail';
import Saved from '@/pages/Saved';
import Dashboard from '@/pages/Dashboard';
import CreatorDashboard from '@/pages/CreatorDashboard';
import RoommateSetup from '@/pages/RoommateSetup';
import RoommateMatches from '@/pages/RoommateMatches';

type NavPage = 'home' | 'search' | 'saved' | 'roommate' | 'profile' | 'detail' | 'creator';

export default function App() {
  const auth = useAuth();
  const [navPage, setNavPage] = useState<NavPage>('home');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [, setSavedLoading] = useState(false);
  const [roommateMode, setRoommateMode] = useState<'setup' | 'matches'>('setup');

  // Load saved listings when logged in
  useEffect(() => {
    if (auth.profile?.user_id) {
      loadSaved(auth.profile.user_id);
    }
  }, [auth.profile?.user_id]);

  async function loadSaved(userId: string) {
    setSavedLoading(true);
    const { saved } = await getSavedListings(userId);
    if (saved) {
      setSavedIds(new Set(saved.map((s) => s.listing_id)));
    }
    setSavedLoading(false);
  }

  const handleToggleSave = useCallback(
    async (listingId: string) => {
      if (!auth.profile) return;
      const userId = auth.profile.user_id;

      if (savedIds.has(listingId)) {
        await unsaveListing(userId, listingId);
        setSavedIds((prev) => {
          const next = new Set(prev);
          next.delete(listingId);
          return next;
        });
      } else {
        await saveListing(userId, listingId);
        setSavedIds((prev) => {
          const next = new Set(prev);
          next.add(listingId);
          return next;
        });
      }
    },
    [auth.profile, savedIds]
  );

  const handleNavigate = useCallback(
    (page: string, listingId?: string) => {
      if (page === 'detail' && listingId) {
        setDetailId(listingId);
        setNavPage('detail');
      } else if (['home', 'search', 'saved', 'roommate', 'profile', 'creator'].includes(page)) {
        setNavPage(page as NavPage);
      }
    },
    []
  );

  // ─── Loading ──────────────────────────────────────
  if (auth.isLoading && auth.page === 'loading') {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3">
        <div className="w-6 h-6 border-2 border-[#C8A45A] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-[#8B8680]">Loading WeHouse...</p>
      </div>
    );
  }

  // ─── Login ────────────────────────────────────────
  if (auth.page === 'login') {
    return <Login onLoginSuccess={auth.handleLoginSuccess} serverError={auth.error} />;
  }

  // ─── Setup ────────────────────────────────────────
  if (auth.page === 'setup' && auth.profile) {
    return <Setup profile={auth.profile} onSetupComplete={auth.handleSetupComplete} />;
  }

  const profile = auth.profile;
  if (!profile) return <Login onLoginSuccess={auth.handleLoginSuccess} serverError={auth.error} />;

  // ─── Creator Dashboard ────────────────────────────
  if (navPage === 'creator' || auth.page === 'creator') {
    return (
      <>
        <CreatorDashboard profile={profile} onLogout={auth.logout} />
        <BottomNav navPage={navPage} onNavigate={handleNavigate} isCreator={profile.role === 'creator_admin'} />
      </>
    );
  }

  // ─── Main app with bottom nav ─────────────────────
  return (
    <>
      {navPage === 'home' && (
        <Home profile={profile} onNavigate={handleNavigate} savedIds={savedIds} onToggleSave={handleToggleSave} />
      )}
      {navPage === 'search' && (
        <Search onNavigate={handleNavigate} savedIds={savedIds} onToggleSave={handleToggleSave} />
      )}
      {navPage === 'saved' && (
        <Saved profile={profile} onNavigate={handleNavigate} savedIds={savedIds} onToggleSave={handleToggleSave} />
      )}
      {navPage === 'roommate' && (
        roommateMode === 'setup' ? (
          <RoommateSetup profile={profile} onComplete={() => setRoommateMode('matches')} />
        ) : (
          <RoommateMatches profile={profile} />
        )
      )}
      {navPage === 'profile' && (
        <Dashboard profile={profile} onLogout={auth.logout} onNavigate={handleNavigate} />
      )}
      {navPage === 'detail' && detailId && (
        <ListingDetail
          listingId={detailId}
          onNavigate={handleNavigate}
          isSaved={savedIds.has(detailId)}
          onToggleSave={() => handleToggleSave(detailId)}
        />
      )}

      <BottomNav navPage={navPage} onNavigate={handleNavigate} isCreator={profile.role === 'creator_admin'} />
    </>
  );
}

// ─── BOTTOM NAV ────────────────────────────────────
function BottomNav({
  navPage,
  onNavigate,
  isCreator,
}: {
  navPage: NavPage;
  onNavigate: (page: string) => void;
  isCreator: boolean;
}) {
  // Hide bottom nav on detail page (has its own back button)
  if (navPage === 'detail') return null;

  const tabs = [
    { id: 'home', label: 'Home', icon: HomeIcon },
    { id: 'search', label: 'Search', icon: SearchIcon },
    { id: 'saved', label: 'Saved', icon: HeartIcon },
    { id: 'roommate', label: 'Roommate', icon: UsersIcon },
    { id: isCreator ? 'creator' : 'profile', label: isCreator ? 'Creator' : 'Profile', icon: UserIcon },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#f0eeea] z-40">
      <div className="max-w-lg mx-auto flex items-center justify-around py-1">
        {tabs.map((tab) => {
          const isActive = navPage === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onNavigate(tab.id)}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-4 rounded-lg transition-colors ${
                isActive ? 'text-[#C8A45A]' : 'text-[#8B8680]'
              }`}
            >
              <tab.icon size={20} active={isActive} />
              <span className="text-[9px] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── ICONS ─────────────────────────────────────────
function HomeIcon({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#C8A45A' : '#8B8680'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function SearchIcon({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#C8A45A' : '#8B8680'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function HeartIcon({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={active ? '#C8A45A' : 'none'} stroke={active ? '#C8A45A' : '#8B8680'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function UserIcon({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#C8A45A' : '#8B8680'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function UsersIcon({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#C8A45A' : '#8B8680'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
