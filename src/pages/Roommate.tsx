import { useState, useEffect, useCallback, useRef } from 'react';
import {
  saveRoommatePreferences,
  getRoommatePreferences,
  startRoommateSearch,
  stopRoommateSearch,
  refreshRoommateSearch,
  getSavedMatchResults,
  updateMatchStatus,
  checkSearchExpiry,
} from '@/lib/supabase';
import InstitutionSelector from '@/components/InstitutionSelector';
import RoommateLocationSelector from '@/components/RoommateLocationSelector';
import DualRangeSlider from '@/components/DualRangeSlider';
import { Toaster, toast } from 'sonner';
import type { Profile, RoommatePreferences } from '@/types';

interface RoommateProps {
  profile: Profile;
}

type View = 'preview' | 'edit' | 'matches' | 'active_search';

const GENDER_PREF_OPTIONS = [
  { value: 'no_preference', label: 'Any' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

const BUDGET_FLOOR = 180000;
const BUDGET_CEILING = 5000000;
const BUDGET_STEP = 10000;

const CLEANLINESS_OPTIONS = [
  { value: 'neat', label: 'Neat', icon: '✨' },
  { value: 'moderate', label: 'Moderate', icon: '👍' },
  { value: 'relaxed', label: 'Relaxed', icon: '😎' },
];

const NOISE_OPTIONS = [
  { value: 'quiet', label: 'Quiet', icon: '🔇' },
  { value: 'moderate', label: 'Moderate', icon: '🔉' },
  { value: 'loud', label: 'Social', icon: '🔊' },
];

const SLEEP_OPTIONS = [
  { value: '9pm-10pm', label: 'Early' },
  { value: '10pm-11pm', label: 'Normal' },
  { value: '11pm-12am', label: 'Late' },
  { value: '12am-1am', label: 'Night Owl' },
];

const VISITOR_OPTIONS = [
  { value: 'rarely', label: 'Rarely' },
  { value: 'sometimes', label: 'Sometimes' },
  { value: 'often', label: 'Often' },
];

const DURATION_OPTIONS = [
  { value: '3_months', label: '3 Mo' },
  { value: '6_months', label: '6 Mo' },
  { value: '1_year', label: '1 Yr' },
  { value: '1_year+', label: '1+ Yrs' },
];

// ═══════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════

export default function Roommate({ profile }: RoommateProps) {
  const [view, setView] = useState<View>('preview');
  const [prefs, setPrefs] = useState<RoommatePreferences | null>(null);
  const [savedMatches, setSavedMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState<string>('');
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Load preferences ───────────────────────────
  const loadPrefs = useCallback(async () => {
    setLoading(true);
    const { prefs: data } = await getRoommatePreferences(profile.user_id);
    setPrefs(data);
    setLoading(false);
  }, [profile.user_id]);

  // ─── Load saved match results ───────────────────
  const loadSavedMatches = useCallback(async () => {
    const { matches } = await getSavedMatchResults(profile.user_id);
    setSavedMatches(matches || []);
  }, [profile.user_id]);

  // ─── Check expiry and load everything ───────────
  const fullRefresh = useCallback(async () => {
    const { prefs: freshPrefs } = await checkSearchExpiry(profile.user_id);
    setPrefs(freshPrefs);
    await loadSavedMatches();
    setLoading(false);
  }, [profile.user_id, loadSavedMatches]);

  useEffect(() => {
    fullRefresh();
  }, [fullRefresh]);

  // ─── Countdown timer ────────────────────────────
  useEffect(() => {
    if (prefs?.search_status !== 'active' || !prefs.search_expires_at) {
      setTimeLeft('');
      return;
    }

    const updateTimer = () => {
      const now = new Date().getTime();
      const expiry = new Date(prefs.search_expires_at!).getTime();
      const diff = expiry - now;

      if (diff <= 0) {
        setTimeLeft('');
        checkSearchExpiry(profile.user_id).then(({ prefs: fresh }) => {
          setPrefs(fresh);
        });
        return;
      }

      const hrs = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeLeft(`${hrs}h ${mins}m ${secs}s`);
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [prefs?.search_status, prefs?.search_expires_at, profile.user_id]);

  // ─── Auto-refresh matches during active search ──
  useEffect(() => {
    // Clear any existing timer
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    if (prefs?.search_status === 'active') {
      // Refresh matches every 2 minutes during active search
      refreshTimerRef.current = setInterval(async () => {
        const { matches } = await refreshRoommateSearch(profile.user_id);
        if (matches && matches.length > 0) {
          await loadSavedMatches();
        }
      }, 2 * 60 * 1000);
    }

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, [prefs?.search_status, profile.user_id, loadSavedMatches]);

  // ─── Handle save preferences ────────────────────
  const handleSave = async (formData: any) => {
    const isEditingDuringActiveSearch = prefs?.search_status === 'active';

    const { error } = await saveRoommatePreferences({
      user_id: profile.user_id,
      auth_id: profile.auth_id,
      ...formData,
      area_preference: formData.area_preference || profile.city || '',
      active: true,
    });
    if (error) {
      toast.error('Save failed: ' + error.message);
      return;
    }

    toast.success('Preferences saved!');

    if (isEditingDuringActiveSearch) {
      // Re-run match with new preferences
      toast.success('Re-matching with updated preferences...');
      const { matches } = await refreshRoommateSearch(profile.user_id);
      await loadSavedMatches();
      if (matches && matches.length > 0) {
        toast.success(`Found ${matches.length} new match(es)!`);
      } else {
        toast.info('Search updated — checking for new matches...');
      }
      setView('active_search');
    } else {
      await loadPrefs();
      setView('preview');
    }
  };

  // ─── Start search ───────────────────────────────
  const handleStartSearch = async () => {
    setLoading(true);
    const { error } = await startRoommateSearch(profile.user_id);
    if (error) {
      toast.error('Failed to start search');
      setLoading(false);
      return;
    }
    // Run initial match
    const { matches } = await refreshRoommateSearch(profile.user_id);
    await loadSavedMatches();
    await loadPrefs();
    setLoading(false);
    setView('active_search');
    if (matches && matches.length > 0) {
      toast.success(`Found ${matches.length} initial match(es)!`);
    }
  };

  // ─── Stop search ────────────────────────────────
  const handleStopSearch = async () => {
    setLoading(true);
    await stopRoommateSearch(profile.user_id);
    await loadPrefs();
    setLoading(false);
    setView('preview');
    toast.success('Search stopped');
  };

  // ─── Refresh matches manually ───────────────────
  const handleRefreshMatches = async () => {
    setLoading(true);
    const { matches } = await refreshRoommateSearch(profile.user_id);
    await loadSavedMatches();
    setLoading(false);
    if (matches && matches.length > 0) {
      toast.success(`Found ${matches.length} match(es)!`);
    } else {
      toast.info('No new matches yet — search is still active');
    }
  };

  if (loading && view !== 'edit') {
    return <RoommateSkeleton />;
  }

  if (!prefs && view !== 'edit') {
    return <EditView onSave={handleSave} onCancel={() => {}} isFirstTime />;
  }

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <Toaster position="top-center" richColors />
      {view === 'preview' && (
        <PreviewView
          profile={profile}
          prefs={prefs}
          savedMatches={savedMatches}
          onChangeView={setView}
          onStartSearch={handleStartSearch}
          onStopSearch={handleStopSearch}
          loading={loading}
        />
      )}
      {view === 'edit' && (
        <EditView
          existingPrefs={prefs}
          onSave={handleSave}
          onCancel={() => setView(prefs?.search_status === 'active' ? 'active_search' : 'preview')}
          isFirstTime={!prefs}
        />
      )}
      {view === 'matches' && (
        <MatchesView
          savedMatches={savedMatches}
          loading={loading}
          onChangeView={setView}
          onRefresh={handleRefreshMatches}
          onUpdateStatus={async (id: string, status: any) => {
            await updateMatchStatus(id, status);
            await loadSavedMatches();
          }}
          searchStatus={prefs?.search_status || 'idle'}
          timeLeft={timeLeft}
        />
      )}
      {view === 'active_search' && (
        <ActiveSearchView
          prefs={prefs}
          savedMatches={savedMatches}
          timeLeft={timeLeft}
          loading={loading}
          onChangeView={setView}
          onStopSearch={handleStopSearch}
          onRefresh={handleRefreshMatches}
          onUpdateStatus={async (id: string, status: any) => {
            await updateMatchStatus(id, status);
            await loadSavedMatches();
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// PREVIEW VIEW
// ═══════════════════════════════════════════════════════

function PreviewView({
  profile,
  prefs,
  savedMatches,
  onChangeView,
  onStartSearch,
  onStopSearch,
  loading,
}: {
  profile: Profile;
  prefs: RoommatePreferences | null;
  savedMatches: any[];
  onChangeView: (v: View) => void;
  onStartSearch: () => void;
  onStopSearch: () => void;
  loading: boolean;
}) {
  const budget = prefs
    ? `₦${prefs.budget_min?.toLocaleString()} – ₦${prefs.budget_max?.toLocaleString()}`
    : 'Not set';
  const isSearchActive = prefs?.search_status === 'active';
  const hasExpired = prefs?.search_status === 'expired';
  const hasMatches = savedMatches.length > 0;

  const essentialCards = [
    { label: 'Budget', value: budget, icon: '💰' },
    { label: 'Location', value: prefs?.area_preference || 'Not set', icon: '📍' },
    { label: 'Gender', value: prefs?.gender ? prefs.gender.charAt(0).toUpperCase() + prefs.gender.slice(1) : 'Not set', icon: '👤' },
    { label: 'Roommate', value: GENDER_PREF_OPTIONS.find((o) => o.value === prefs?.gender_preference)?.label || 'Any', icon: '🔍' },
  ];

  const studentCards = prefs?.school_name
    ? [
        { label: 'School', value: prefs.school_name, icon: '🎓' },
        { label: 'Campus', value: prefs.campus || 'Main', icon: '🏫' },
        { label: 'Level', value: prefs.level ? `${prefs.level}L` : 'Not set', icon: '📚' },
        { label: 'Department', value: prefs.department || 'Not set', icon: '🔬' },
      ]
    : [];

  const lifestyleCards = [
    { label: 'Cleanliness', value: CLEANLINESS_OPTIONS.find((o) => o.value === prefs?.cleanliness)?.label || 'Moderate', icon: '✨' },
    { label: 'Noise', value: NOISE_OPTIONS.find((o) => o.value === prefs?.noise_level)?.label || 'Moderate', icon: '🔊' },
    { label: 'Sleep', value: SLEEP_OPTIONS.find((o) => o.value === prefs?.sleep_time)?.label || 'Normal', icon: '🌙' },
    { label: 'Visitors', value: VISITOR_OPTIONS.find((o) => o.value === prefs?.visitors)?.label || 'Sometimes', icon: '🚪' },
  ];

  return (
    <>
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5">
        <div className="max-w-lg mx-auto">
          <h1 className="text-lg font-bold text-white mb-1">Roommate</h1>
          <p className="text-xs text-[#5C5E72]">Your profile and matches</p>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-5 space-y-4">
        {/* Profile Card */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white">Your Profile</h2>
            <button
              onClick={() => onChangeView('edit')}
              className="text-[10px] text-[#3B82F6] font-semibold px-3 py-1.5 rounded-lg bg-[#3B82F6]/10 hover:bg-[#3B82F6]/20 transition-colors"
            >
              Edit
            </button>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-lg font-bold glow-blue-sm">
              {(profile.username || profile.email[0]).charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-semibold text-white">@{profile.username || 'user'}</div>
              <div className="text-[10px] text-[#5C5E72] flex items-center gap-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                {profile.city || prefs?.area_preference || 'No location'}
              </div>
            </div>
          </div>

          {prefs?.bio && (
            <p className="text-xs text-[#8A8B9C] mb-4 leading-relaxed italic">&ldquo;{prefs.bio}&rdquo;</p>
          )}

          {/* Essential */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {essentialCards.map((card) => (
              <div key={card.label} className="bg-[#1A1A24] rounded-xl p-3">
                <div className="text-[10px] text-[#5C5E72] mb-0.5">{card.label}</div>
                <div className="text-xs text-white font-medium truncate">{card.value}</div>
              </div>
            ))}
          </div>

          {/* Student */}
          {studentCards.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              {studentCards.map((card) => (
                <div key={card.label} className="bg-[#1A1A24] rounded-xl p-3 border border-[#3B82F6]/10">
                  <div className="text-[10px] text-[#3B82F6] mb-0.5">{card.label}</div>
                  <div className="text-xs text-white font-medium truncate">{card.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Lifestyle */}
          <div className="grid grid-cols-2 gap-2">
            {lifestyleCards.map((card) => (
              <div key={card.label} className="bg-[#1A1A24] rounded-xl p-3">
                <div className="text-[10px] text-[#5C5E72] mb-0.5">{card.label}</div>
                <div className="text-xs text-white font-medium">{card.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Search Status Banner */}
        {isSearchActive && (
          <div className="bg-gradient-to-r from-emerald-500/10 to-green-500/5 border border-emerald-500/20 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-semibold text-emerald-400">Search Active</span>
            </div>
            <p className="text-[10px] text-[#8A8B9C] mb-3">Finding roommates for you. You can edit your preferences anytime.</p>
            <div className="flex gap-2">
              <button
                onClick={() => onChangeView('active_search')}
                className="flex-1 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition-colors"
              >
                View Search ({savedMatches.length} matches)
              </button>
              <button
                onClick={onStopSearch}
                className="h-9 px-3 rounded-xl text-[10px] text-[#5C5E72] hover:text-white transition-colors"
              >
                Stop
              </button>
            </div>
          </div>
        )}

        {hasExpired && (
          <div className="bg-[#1A1A24] border border-amber-500/20 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
              <span className="text-xs font-semibold text-amber-400">Search Expired</span>
            </div>
            <p className="text-[10px] text-[#8A8B9C] mb-3">
              Your 8-hour search window ended. Start a new search to find more roommates.
            </p>
            {hasMatches && (
              <button
                onClick={() => onChangeView('matches')}
                className="w-full h-9 rounded-xl bg-amber-500/10 text-amber-400 text-xs font-medium mb-2"
              >
                View {savedMatches.length} Saved Matches
              </button>
            )}
          </div>
        )}

        {/* Main Action Button */}
        {!isSearchActive && (
          <button
            onClick={() => {
              if (hasExpired && hasMatches) {
                onChangeView('matches');
              } else {
                onStartSearch();
              }
            }}
            disabled={loading}
            className="w-full h-12 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white font-semibold shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {hasExpired && hasMatches ? 'View Saved Matches' : 'Find Roommate'}
          </button>
        )}

        {/* Recent Matches Preview */}
        {hasMatches && !isSearchActive && (
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Recent Matches</h3>
              <button onClick={() => onChangeView('matches')} className="text-[10px] text-[#3B82F6] font-medium">
                See All
              </button>
            </div>
            <div className="space-y-2">
              {savedMatches.slice(0, 3).map((m) => (
                <div key={m.id} className="flex items-center gap-3 bg-[#1A1A24] rounded-xl p-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#1E3A5F] flex items-center justify-center text-white text-sm font-bold">
                    {(m.matched_profile?.username || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white truncate">
                      @{m.matched_profile?.username || 'user'}
                    </div>
                    <div className="text-[10px] text-[#8A8B9C]">
                      {m.match_score}% match · {m.matched_profile?.city || 'Nigeria'}
                    </div>
                  </div>
                  <div
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      m.match_score >= 70 ? 'bg-green-500/10 text-green-400' : m.match_score >= 40 ? 'bg-amber-500/10 text-amber-400' : 'bg-red-400/10 text-red-400'
                    }`}
                  >
                    {m.match_score}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════
// ACTIVE SEARCH VIEW
// ═══════════════════════════════════════════════════════

function ActiveSearchView({
  prefs,
  savedMatches,
  timeLeft,
  loading,
  onChangeView,
  onStopSearch,
  onRefresh,
  onUpdateStatus,
}: {
  prefs: RoommatePreferences | null;
  savedMatches: any[];
  timeLeft: string;
  loading: boolean;
  onChangeView: (v: View) => void;
  onStopSearch: () => void;
  onRefresh: () => void;
  onUpdateStatus: (id: string, status: 'new' | 'viewed' | 'accepted' | 'declined') => void;
}) {
  const [activeTab, setActiveTab] = useState<'matches' | 'status'>('matches');
  const newMatchCount = savedMatches.filter((m) => m.status === 'new').length;

  return (
    <>
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button onClick={() => onChangeView('preview')} className="text-[#8A8B9C] hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-white">Active Search</h1>
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <p className="text-[10px] text-[#5C5E72]">{savedMatches.length} matches found</p>
          </div>
        </div>
        <button
          onClick={() => onChangeView('edit')}
          className="text-[10px] text-[#3B82F6] font-medium px-2.5 py-1.5 rounded-lg bg-[#3B82F6]/10 hover:bg-[#3B82F6]/20 transition-colors"
        >
          Edit Preferences
        </button>
      </header>

      <div className="max-w-lg mx-auto px-5 py-4 space-y-4">
        {/* Countdown Timer */}
        <div className="bg-gradient-to-r from-[#12121A] to-[#1A1A24] border border-emerald-500/20 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Time Remaining</span>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-emerald-400 font-medium">Live</span>
            </div>
          </div>
          <div className="text-2xl font-bold text-white tabular-nums tracking-tight">{timeLeft || '0h 0m 0s'}</div>
          <div className="mt-2 h-1.5 rounded-full bg-[#2A2A3A] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-green-500 transition-all"
              style={{
                width: `${
                  prefs?.search_started_at && prefs?.search_expires_at
                    ? Math.max(
                        0,
                        (new Date(prefs.search_expires_at).getTime() - new Date().getTime()) /
                          (new Date(prefs.search_expires_at).getTime() - new Date(prefs.search_started_at).getTime()) *
                          100
                      )
                    : 0
                }%`,
              }}
            />
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex-1 h-9 rounded-xl bg-[#3B82F6]/10 text-[#3B82F6] text-xs font-medium hover:bg-[#3B82F6]/20 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? 'animate-spin' : ''}>
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              {loading ? 'Searching...' : 'Check Now'}
            </button>
            <button
              onClick={onStopSearch}
              className="h-9 px-4 rounded-xl text-xs text-[#5C5E72] hover:text-white transition-colors border border-white/[0.06]"
            >
              Stop
            </button>
          </div>
        </div>

        {/* New Match Alert */}
        {newMatchCount > 0 && (
          <div className="bg-gradient-to-r from-[#3B82F6]/10 to-[#3B82F6]/5 border border-[#3B82F6]/20 rounded-2xl p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/20 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-white">{newMatchCount} New Match{newMatchCount > 1 ? 'es' : ''}</p>
              <p className="text-[10px] text-[#8A8B9C]">Found since your last check</p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-[#1A1A24]">
          <button
            onClick={() => setActiveTab('matches')}
            className={`flex-1 h-8 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'matches' ? 'bg-[#2A2A3A] text-white' : 'text-[#5C5E72] hover:text-white'
            }`}
          >
            Matches ({savedMatches.length})
          </button>
          <button
            onClick={() => setActiveTab('status')}
            className={`flex-1 h-8 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'status' ? 'bg-[#2A2A3A] text-white' : 'text-[#5C5E72] hover:text-white'
            }`}
          >
            Search Status
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'matches' ? (
          <MatchList
            matches={savedMatches}
            loading={loading}
            onUpdateStatus={onUpdateStatus}
            onEditPrefs={() => onChangeView('edit')}
            isActiveSearch
          />
        ) : (
          <SearchStatusDetails prefs={prefs} timeLeft={timeLeft} />
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════
// MATCHES VIEW
// ═══════════════════════════════════════════════════════

function MatchesView({
  savedMatches,
  loading,
  onChangeView,
  onRefresh,
  onUpdateStatus,
  searchStatus,
  timeLeft,
}: {
  savedMatches: any[];
  loading: boolean;
  onChangeView: (v: View) => void;
  onRefresh: () => void;
  onUpdateStatus: (id: string, status: any) => void;
  searchStatus: string;
  timeLeft: string;
}) {
  return (
    <>
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button onClick={() => onChangeView('preview')} className="text-[#8A8B9C] hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-base font-semibold text-white">Matches</h1>
            <p className="text-[10px] text-[#5C5E72]">{savedMatches.length} saved</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {searchStatus === 'active' && timeLeft && (
            <span className="text-[10px] text-emerald-400 font-medium mr-1">{timeLeft}</span>
          )}
          <button
            onClick={() => onChangeView('edit')}
            className="text-[10px] text-[#3B82F6] font-medium px-2.5 py-1.5 rounded-lg bg-[#3B82F6]/10 hover:bg-[#3B82F6]/20 transition-colors"
          >
            Edit
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-5 py-4">
        <MatchList
          matches={savedMatches}
          loading={loading}
          onUpdateStatus={onUpdateStatus}
          onEditPrefs={() => onChangeView('edit')}
          onRefresh={onRefresh}
        />
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════
// MATCH LIST (shared between ActiveSearch and MatchesView)
// ═══════════════════════════════════════════════════════

function MatchList({
  matches,
  loading,
  onUpdateStatus,
  onEditPrefs,
  onRefresh,
  isActiveSearch,
}: {
  matches: any[];
  loading: boolean;
  onUpdateStatus: (id: string, status: any) => void;
  onEditPrefs: () => void;
  onRefresh?: () => void;
  isActiveSearch?: boolean;
}) {
  const scoreColor = (s: number) => (s >= 70 ? 'bg-green-500' : s >= 40 ? 'bg-amber-500' : 'bg-red-400');
  const scoreLabel = (s: number) => (s >= 70 ? 'High' : s >= 40 ? 'Good' : 'Low');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-[#12121A] border border-white/[0.04] rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-[#1A1A24] shimmer" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-[#1A1A24] shimmer rounded w-1/3" />
                <div className="h-2.5 bg-[#1A1A24] shimmer rounded w-1/2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-14 h-14 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="1.5">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </div>
        <p className="text-sm text-[#8A8B9C]">
          {isActiveSearch ? 'No matches yet — search is still running!' : 'No saved matches'}
        </p>
        <p className="text-xs text-[#8A8B9C]/70 mt-1 mb-4">
          {isActiveSearch ? 'Check back soon or try updating your preferences' : 'Start a search to find roommates'}
        </p>
        <div className="flex gap-2 justify-center">
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="h-9 px-4 rounded-xl bg-[#3B82F6]/10 text-[#3B82F6] text-xs font-medium hover:bg-[#3B82F6]/20 transition-colors"
            >
              Check Now
            </button>
          )}
          <button
            onClick={onEditPrefs}
            className="h-9 px-4 rounded-xl bg-[#1A1A24] text-[#8A8B9C] text-xs font-medium hover:text-white transition-colors"
          >
            Update Preferences
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {matches.map((m) => (
        <div
          key={m.id}
          className={`bg-[#12121A] border rounded-2xl p-4 transition-all ${
            m.status === 'new' ? 'border-[#3B82F6]/30 shadow-lg shadow-blue-500/5' : 'border-white/[0.04] hover:border-[#3B82F6]/20'
          }`}
        >
          {/* Header */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#1E3A5F] flex items-center justify-center text-white text-sm font-bold relative">
              {(m.matched_profile?.username || 'U').charAt(0).toUpperCase()}
              {m.status === 'new' && (
                <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#3B82F6] border-2 border-[#12121A]" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white truncate">@{m.matched_profile?.username || 'user'}</span>
                {m.status === 'new' && (
                  <span className="text-[9px] font-bold text-[#3B82F6] bg-[#3B82F6]/10 px-1.5 py-0.5 rounded-full">NEW</span>
                )}
              </div>
              <div className="text-[10px] text-[#8A8B9C] capitalize">
                {m.matched_profile?.gender || 'Unknown'} · {m.matched_profile?.city || 'Nigeria'}
              </div>
            </div>
            <div className={`text-white text-[10px] font-bold px-2 py-1 rounded-full ${scoreColor(m.match_score)}`}>{m.match_score}%</div>
          </div>

          {/* Score Bar */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 h-2 rounded-full bg-[#1A1A24] overflow-hidden">
              <div className={`h-full rounded-full ${scoreColor(m.match_score)}`} style={{ width: `${m.match_score}%` }} />
            </div>
            <span className="text-[10px] text-[#8A8B9C]">{scoreLabel(m.match_score)}</span>
          </div>

          {/* Bio */}
          {m.matched_profile?.bio && (
            <p className="text-[10px] text-[#8A8B9C] mb-3 italic leading-relaxed">&ldquo;{m.matched_profile.bio}&rdquo;</p>
          )}

          {/* Expand/Collapse Details */}
          <button
            onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
            className="w-full text-[10px] text-[#5C5E72] hover:text-white transition-colors mb-2 flex items-center justify-center gap-1"
          >
            {expandedId === m.id ? 'Less' : 'More'} details
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transition-transform ${expandedId === m.id ? 'rotate-180' : ''}`}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {expandedId === m.id && (
            <div className="grid grid-cols-2 gap-2 text-[10px] text-[#8A8B9C] mb-3 bg-[#1A1A24] rounded-xl p-3">
              <div>
                <span className="text-white font-medium">Score:</span> {m.match_score}%
              </div>
              <div>
                <span className="text-white font-medium">State:</span> {m.matched_profile?.state || 'N/A'}
              </div>
              <div>
                <span className="text-white font-medium">City:</span> {m.matched_profile?.city || 'N/A'}
              </div>
              {m.matched_profile?.school && (
                <div>
                  <span className="text-white font-medium">School:</span> {m.matched_profile.school}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => onUpdateStatus(m.id, 'accepted')}
              className={`flex-1 h-8 rounded-xl text-xs font-medium transition-all ${
                m.status === 'accepted'
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-green-500/10 text-green-400/80 hover:bg-green-500/20'
              }`}
            >
              {m.status === 'accepted' ? 'Interested ✓' : 'Interested'}
            </button>
            <button
              onClick={() => onUpdateStatus(m.id, 'declined')}
              className={`flex-1 h-8 rounded-xl text-xs font-medium transition-all ${
                m.status === 'declined'
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-red-500/10 text-red-400/80 hover:bg-red-500/20'
              }`}
            >
              {m.status === 'declined' ? 'Pass ✓' : 'Pass'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SEARCH STATUS DETAILS
// ═══════════════════════════════════════════════════════

function SearchStatusDetails({ prefs, timeLeft }: { prefs: RoommatePreferences | null; timeLeft: string }) {
  if (!prefs) return null;

  const started = prefs.search_started_at ? new Date(prefs.search_started_at).toLocaleString() : '—';
  const expires = prefs.search_expires_at ? new Date(prefs.search_expires_at).toLocaleString() : '—';

  return (
    <div className="glass rounded-2xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-white">Search Details</h3>

      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-[#5C5E72]">Status</span>
          <span className="text-emerald-400 font-medium capitalize">{prefs.search_status}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-[#5C5E72]">Time Remaining</span>
          <span className="text-white font-medium tabular-nums">{timeLeft || '—'}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-[#5C5E72]">Started</span>
          <span className="text-white">{started}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-[#5C5E72]">Expires</span>
          <span className="text-white">{expires}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-[#5C5E72]">Total Matches</span>
          <span className="text-white font-medium">{prefs.search_match_count || 0}</span>
        </div>
      </div>

      <div className="border-t border-white/[0.04] pt-3">
        <p className="text-[10px] text-[#5C5E72] leading-relaxed">
          Your search runs for 8 hours. You can edit your preferences anytime during this period to get re-matched.
          Results are saved automatically and you can view them even after the search ends.
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// EDIT VIEW
// ═══════════════════════════════════════════════════════

function EditView({
  existingPrefs,
  onSave,
  onCancel,
  isFirstTime,
}: {
  existingPrefs?: RoommatePreferences | null;
  onSave: (data: any) => void;
  onCancel: () => void;
  isFirstTime?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [showStudent, setShowStudent] = useState(!!existingPrefs?.school_name);

  const [form, setForm] = useState({
    gender: existingPrefs?.gender || '',
    gender_preference: existingPrefs?.gender_preference || 'no_preference',
    budget_min: existingPrefs?.budget_min || BUDGET_FLOOR,
    budget_max: existingPrefs?.budget_max || 1000000,
    study_level: existingPrefs?.study_level || '',
    noise_level: existingPrefs?.noise_level || 'moderate',
    cleanliness: existingPrefs?.cleanliness || 'moderate',
    sleep_time: existingPrefs?.sleep_time || '10pm-11pm',
    visitors: existingPrefs?.visitors || 'sometimes',
    stay_duration: existingPrefs?.stay_duration || '1_year',
    area_preference: existingPrefs?.area_preference || '',
    preferred_state: existingPrefs?.preferred_state || '',
    preferred_lga: existingPrefs?.preferred_lga || '',
    preferred_area: existingPrefs?.preferred_area || '',
    bio: existingPrefs?.bio || '',
    school_name: existingPrefs?.school_name || '',
    campus: existingPrefs?.campus || '',
    faculty: existingPrefs?.faculty || '',
    department: existingPrefs?.department || '',
    level: existingPrefs?.level || '',
    school_match: existingPrefs?.school_match ?? true,
    campus_match: existingPrefs?.campus_match ?? true,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.budget_min || !form.budget_max) {
      toast.error('Set your budget range');
      return;
    }
    if (form.budget_min < BUDGET_FLOOR) {
      toast.error(`Minimum budget is ₦${BUDGET_FLOOR.toLocaleString()}`);
      return;
    }
    if (form.budget_max <= form.budget_min) {
      toast.error('Maximum budget must be greater than minimum');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        gender: form.gender || 'male',
        gender_preference: form.gender_preference,
        budget_min: Number(form.budget_min),
        budget_max: Number(form.budget_max),
        study_level: form.study_level,
        noise_level: form.noise_level,
        cleanliness: form.cleanliness,
        sleep_time: form.sleep_time,
        visitors: form.visitors,
        stay_duration: form.stay_duration,
        area_preference: form.preferred_lga || form.area_preference,
        preferred_state: form.preferred_state || null,
        preferred_lga: form.preferred_lga || null,
        preferred_area: form.preferred_area || null,
        bio: form.bio,
        school_name: showStudent ? form.school_name || null : null,
        campus: showStudent ? form.campus || null : null,
        faculty: showStudent ? form.faculty || null : null,
        department: showStudent ? form.department || null : null,
        level: showStudent ? form.level || null : null,
        school_match: showStudent ? form.school_match : false,
        campus_match: showStudent ? form.campus_match : false,
      });
    } catch (err: any) {
      toast.error('Something went wrong: ' + (err.message || 'Please try again'));
    } finally {
      setSaving(false);
    }
  }

  const update = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <>
      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          {!isFirstTime && (
            <button onClick={onCancel} className="text-[#8A8B9C] hover:text-white transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div>
            <h1 className="text-base font-semibold text-white">{isFirstTime ? 'Roommate Setup' : 'Edit Preferences'}</h1>
            <p className="text-[10px] text-[#5C5E72]">
              {existingPrefs?.search_status === 'active' ? 'Changes will re-run your active search' : 'Update your preferences'}
            </p>
          </div>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="max-w-lg mx-auto px-5 py-5 space-y-4">
        {/* ═════ STEP 1: ESSENTIALS ═════ */}
        <div className="glass rounded-2xl p-4">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-white">Essentials</h3>
            <p className="text-[10px] text-[#5C5E72] mt-0.5">Required for matching</p>
          </div>

          {/* Budget */}
          <div className="mb-4">
            <label className="text-[10px] text-[#5C5E72] mb-1 block font-medium">Budget Range *</label>
            <DualRangeSlider
              min={form.budget_min}
              max={form.budget_max}
              floor={BUDGET_FLOOR}
              ceiling={BUDGET_CEILING}
              step={BUDGET_STEP}
              onChange={(newMin, newMax) => {
                update('budget_min', newMin);
                update('budget_max', newMax);
              }}
            />
          </div>

          {/* Location */}
          <div className="mb-4">
            <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Location *</label>
            <RoommateLocationSelector
              value={{
                preferred_state: form.preferred_state,
                preferred_lga: form.preferred_lga,
                preferred_area: form.preferred_area,
              }}
              onChange={(v) => setForm((f) => ({ ...f, ...v }))}
            />
          </div>

          {/* Gender */}
          <div className="mb-4">
            <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Your Gender *</label>
            <div className="flex gap-2">
              {(['male', 'female'] as const).map((g) => (
                <Chip key={g} selected={form.gender === g} onClick={() => update('gender', g)}>
                  {g === 'male' ? '👨' : '👩'} {g.charAt(0).toUpperCase() + g.slice(1)}
                </Chip>
              ))}
            </div>
          </div>

          {/* Roommate Gender Preference */}
          <div>
            <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Roommate Gender</label>
            <div className="flex gap-2 flex-wrap">
              {GENDER_PREF_OPTIONS.map((opt) => (
                <Chip key={opt.value} selected={form.gender_preference === opt.value} onClick={() => update('gender_preference', opt.value)}>
                  {opt.label}
                </Chip>
              ))}
            </div>
          </div>
        </div>

        {/* ═════ STEP 2: STUDENT INFO ═════ */}
        <div className="glass rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowStudent(!showStudent)}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                  <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                  <path d="M6 12v5c0 1.66 4 3 9 3s9-1.34 9-3v-5" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Student Info</h3>
                <p className="text-[10px] text-[#5C5E72]">{showStudent ? 'Tap to hide' : 'Add school for better matches'}</p>
              </div>
            </div>
            <div className={`w-10 h-6 rounded-full transition-colors relative ${showStudent ? 'bg-[#3B82F6]' : 'bg-[#2A2A3A]'}`}>
              <div
                className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                style={{ transform: showStudent ? 'translateX(16px)' : 'translateX(0)' }}
              />
            </div>
          </button>

          {showStudent && (
            <div className="px-4 pb-4 animate-fadeIn">
              <div className="border-t border-[#1E1E2C] pt-4">
                <InstitutionSelector
                  value={{
                    school_name: form.school_name,
                    campus: form.campus,
                    faculty: form.faculty,
                    department: form.department,
                    level: form.level,
                  }}
                  onChange={(v) => setForm((f) => ({ ...f, ...v }))}
                />
                {form.school_name && (
                  <div className="mt-3 pt-3 border-t border-[#1E1E2C] space-y-2">
                    <p className="text-[10px] text-[#5C5E72] font-medium">Match Preferences</p>
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.school_match}
                        onChange={(e) => update('school_match', e.target.checked)}
                        className="w-4 h-4 rounded border-[#2A2A3A] bg-[#1A1A24] text-[#3B82F6]"
                      />
                      <span className="text-xs text-[#8A8B9C]">Prefer same school</span>
                    </label>
                    {form.campus && (
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.campus_match}
                          onChange={(e) => update('campus_match', e.target.checked)}
                          className="w-4 h-4 rounded border-[#2A2A3A] bg-[#1A1A24] text-[#3B82F6]"
                        />
                        <span className="text-xs text-[#8A8B9C]">Prefer same campus</span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ═════ STEP 3: LIFESTYLE ═════ */}
        <CollapsibleSection title="Lifestyle Preferences" subtitle="Cleanliness, sleep, visitors, duration">
          <div className="space-y-4">
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Cleanliness</label>
              <div className="flex gap-2">
                {CLEANLINESS_OPTIONS.map((opt) => (
                  <Chip key={opt.value} selected={form.cleanliness === opt.value} onClick={() => update('cleanliness', opt.value)}>
                    {opt.icon} {opt.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Noise Level</label>
              <div className="flex gap-2">
                {NOISE_OPTIONS.map((opt) => (
                  <Chip key={opt.value} selected={form.noise_level === opt.value} onClick={() => update('noise_level', opt.value)}>
                    {opt.icon} {opt.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Sleep Schedule</label>
              <div className="flex gap-2 flex-wrap">
                {SLEEP_OPTIONS.map((opt) => (
                  <Chip key={opt.value} selected={form.sleep_time === opt.value} onClick={() => update('sleep_time', opt.value)}>
                    {opt.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Visitors</label>
              <div className="flex gap-2">
                {VISITOR_OPTIONS.map((opt) => (
                  <Chip key={opt.value} selected={form.visitors === opt.value} onClick={() => update('visitors', opt.value)}>
                    {opt.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Stay Duration</label>
              <div className="flex gap-2">
                {DURATION_OPTIONS.map((opt) => (
                  <Chip key={opt.value} selected={form.stay_duration === opt.value} onClick={() => update('stay_duration', opt.value)}>
                    {opt.label}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
        </CollapsibleSection>

        {/* Bio */}
        <div className="glass rounded-2xl p-4">
          <label className="text-sm font-semibold text-white mb-1 block">About You</label>
          <p className="text-[10px] text-[#5C5E72] mb-3">Brief intro for potential roommates</p>
          <textarea
            value={form.bio}
            onChange={(e) => update('bio', e.target.value)}
            placeholder="Your habits, hobbies, what you're looking for..."
            rows={2}
            className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 py-3 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none resize-none"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={saving}
          className="w-full h-12 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white font-semibold shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {saving ? 'Saving...' : existingPrefs?.search_status === 'active' ? 'Update & Re-match' : isFirstTime ? 'Save & Continue' : 'Update Preferences'}
        </button>

        {!isFirstTime && (
          <button type="button" onClick={onCancel} className="w-full h-10 rounded-xl text-sm text-[#5C5E72] hover:text-white transition-colors">
            Cancel
          </button>
        )}
      </form>
    </>
  );
}

// ═══════════════════════════════════════════════════════
// COLLAPSIBLE SECTION
// ═══════════════════════════════════════════════════════

function CollapsibleSection({
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="glass rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-[10px] text-[#5C5E72] mt-0.5">{subtitle}</p>}
        </div>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#5C5E72"
          strokeWidth="2"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4 animate-fadeIn">{children}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 px-3.5 rounded-xl text-xs font-medium transition-all ${
        selected
          ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white shadow-lg shadow-blue-500/20'
          : 'bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function RoommateSkeleton() {
  return (
    <div className="min-h-screen bg-transparent pb-20">
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5">
        <div className="max-w-lg mx-auto">
          <div className="h-7 w-32 rounded-lg shimmer mb-2" />
          <div className="h-4 w-48 rounded shimmer" />
        </div>
      </header>
      <div className="max-w-lg mx-auto px-5 space-y-4">
        <div className="glass rounded-2xl p-5 space-y-4">
          <div className="h-5 w-40 rounded shimmer" />
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl shimmer" />
            <div className="space-y-2">
              <div className="h-4 w-24 rounded shimmer" />
              <div className="h-3 w-32 rounded shimmer" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-14 rounded-xl bg-[#1A1A24] shimmer" />
            ))}
          </div>
        </div>
        <div className="h-12 rounded-xl shimmer" />
      </div>
    </div>
  );
}
