import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getSavedListings, saveListing, unsaveListing, getRoommatePreferences } from '@/lib/supabase';
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
import Chat from '@/pages/Chat';
import ProfileEdit from '@/pages/ProfileEdit';

type NavPage = 'home' | 'search' | 'saved' | 'roommate' | 'profile' | 'detail' | 'creator' | 'chat' | 'profile_edit';

export default function App() {
  const auth = useAuth();
  const [navPage, setNavPage] = useState<NavPage>('home');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [roommateMode, setRoommateMode] = useState<'setup' | 'matches'>('setup');
  const isCreator = auth.profile?.role === 'creator_admin';

  // Load saved listings
  useEffect(() => {
    if (auth.profile?.user_id) {
      getSavedListings(auth.profile.user_id).then(({ saved }) => {
        if (saved) setSavedIds(new Set(saved.map((s) => s.listing_id)));
      });
    }
  }, [auth.profile?.user_id]);

  // Check roommate profile
  useEffect(() => {
    if (navPage === 'roommate' && auth.profile?.user_id) {
      getRoommatePreferences(auth.profile.user_id).then(({ prefs }) => {
        setRoommateMode(prefs ? 'matches' : 'setup');
      });
    }
  }, [navPage, auth.profile?.user_id]);

  const handleToggleSave = useCallback(
    async (listingId: string) => {
      if (!auth.profile) return;
      const userId = auth.profile.user_id;
      if (savedIds.has(listingId)) {
        await unsaveListing(userId, listingId);
        setSavedIds((prev) => { const n = new Set(prev); n.delete(listingId); return n; });
      } else {
        await saveListing(userId, listingId);
        setSavedIds((prev) => { const n = new Set(prev); n.add(listingId); return n; });
      }
    },
    [auth.profile, savedIds]
  );

  // Navigate to a tab
  const goTo = useCallback((page: NavPage) => {
    setNavPage(page);
  }, []);

  // Navigate to listing detail
  const goToDetail = useCallback((id: string) => {
    setDetailId(id);
    setNavPage('detail');
  }, []);

  // Go back from detail
  const goBack = useCallback(() => {
    setDetailId(null);
    setNavPage('home');
  }, []);

  // Go to chat
  const goToChat = useCallback(() => {
    setNavPage('chat');
  }, []);

  // Go to profile edit
  const goToProfileEdit = useCallback(() => {
    setNavPage('profile_edit');
  }, []);

  // ─── Loading ──────────────────────────────────────
  if (auth.isLoading) {
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

  // ─── PAGE ROUTER ──────────────────────────────────
  const renderPage = () => {
    switch (navPage) {
      case 'home':
        return <Home profile={profile} onNavigate={(p, id) => id ? goToDetail(id) : goTo(p as NavPage)} savedIds={savedIds} onToggleSave={handleToggleSave} />;
      case 'search':
        return <Search onNavigate={(p, id) => id ? goToDetail(id) : goTo(p as NavPage)} savedIds={savedIds} onToggleSave={handleToggleSave} />;
      case 'saved':
        return <Saved profile={profile} onNavigate={(p, id) => id ? goToDetail(id) : goTo(p as NavPage)} savedIds={savedIds} onToggleSave={handleToggleSave} />;
      case 'roommate':
        return roommateMode === 'setup'
          ? <RoommateSetup profile={profile} onComplete={() => setRoommateMode('matches')} />
          : <RoommateMatches profile={profile} />;
      case 'profile':
        return <Dashboard profile={profile} onLogout={auth.logout} onNavigate={(p) => goTo(p as NavPage)} onGoToChat={goToChat} onGoToProfileEdit={goToProfileEdit} />;
      case 'creator':
        return <CreatorDashboard profile={profile} onLogout={auth.logout} />;
      case 'detail':
        return detailId
          ? <ListingDetail listingId={detailId} onNavigate={goBack} isSaved={savedIds.has(detailId)} onToggleSave={() => handleToggleSave(detailId)} />
          : null;
      case 'chat':
        return <Chat profile={profile} onNavigate={(p) => goTo(p as NavPage)} />;
      case 'profile_edit':
        return <ProfileEdit profile={profile} onUpdate={(updated) => auth.handleSetupComplete(updated)} onBack={() => goTo('profile')} />;
      default:
        return <Home profile={profile} onNavigate={(p, id) => id ? goToDetail(id) : goTo(p as NavPage)} savedIds={savedIds} onToggleSave={handleToggleSave} />;
    }
  };

  // Bottom nav tabs
  const tabs = [
    { id: 'home' as NavPage, label: 'Home', icon: HomeIcon },
    { id: 'search' as NavPage, label: 'Search', icon: SearchIcon },
    { id: 'saved' as NavPage, label: 'Saved', icon: HeartIcon },
    { id: 'roommate' as NavPage, label: 'Roommate', icon: UsersIcon },
    ...(isCreator ? [{ id: 'creator' as NavPage, label: 'Creator', icon: CreatorIcon }] : [{ id: 'profile' as NavPage, label: 'Profile', icon: UserIcon }]),
  ];

  return (
    <>
      {renderPage()}

      {/* Bottom Nav — hidden on detail and setup pages */}
      {navPage !== 'detail' && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#f0eeea] z-40">
          <div className="max-w-lg mx-auto flex items-center justify-around">
            {tabs.map((tab) => {
              const isActive = navPage === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => goTo(tab.id)}
                  className={`flex flex-col items-center gap-0.5 py-2 px-3 min-w-[56px] transition-colors ${
                    isActive ? 'text-[#C8A45A]' : 'text-[#8B8680]'
                  }`}
                >
                  <tab.icon size={22} active={isActive} />
                  <span className="text-[9px] font-medium leading-none">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
}

// ─── ICONS ─────────────────────────────────────────
function HomeIcon({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#C8A45A' : '#8B8680'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function SearchIcon({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#C8A45A' : '#8B8680'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function HeartIcon({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={active ? '#C8A45A' : 'none'} stroke={active ? '#C8A45A' : '#8B8680'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function UsersIcon({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#C8A45A' : '#8B8680'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function UserIcon({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#C8A45A' : '#8B8680'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function CreatorIcon({ size, active }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#C8A45A' : '#8B8680'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
