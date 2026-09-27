import { useEffect, useRef, useState } from 'react';
import BackButton from '@/components/BackButton';
import type { Profile } from '@/types';
import type { NavPage } from '@/types/nav';
import { getMySavedSearches, removeSavedSearch, setSavedSearchAlerts, type SavedSearch } from '@/lib/supabase/saved-searches';
import { toast } from 'sonner';

type Props = { profile: Profile; onBack: () => void; onNavigate: (page: NavPage) => void };

export default function FollowedSearches({ profile, onBack, onNavigate }: Props) {
  const [rows, setRows] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setRows([]);
    setLoading(true);
    setError('');
    void getMySavedSearches().then(({ searches, error: loadError }) => {
      if (!active) return;
      if (loadError) setError('Followed searches could not be loaded. Try again.');
      else setRows(searches.filter(row => row.user_id === profile.user_id));
      setLoading(false);
    }).catch(() => {
      if (active) { setError('Followed searches could not be loaded. Try again.'); setLoading(false); }
    });
    return () => { active = false; };
  }, [profile.user_id, reload]);

  async function change(row: SavedSearch, operation: 'toggle' | 'remove') {
    if (busyRef.current) return;
    busyRef.current = row.id;
    setBusy(row.id);
    try {
      const result = operation === 'remove'
        ? await removeSavedSearch(row.id)
        : await setSavedSearchAlerts(row.id, !row.notifications_enabled);
      if (result.error) throw result.error;
      setRows(current => operation === 'remove'
        ? current.filter(item => item.id !== row.id)
        : current.map(item => item.id === row.id ? { ...item, notifications_enabled: !row.notifications_enabled } : item));
      toast.success(operation === 'remove' ? 'Search removed' : row.notifications_enabled ? 'Alerts paused' : 'Alerts resumed');
    } catch { toast.error('Search alerts could not be updated. Try again.'); }
    finally { busyRef.current = null; setBusy(null); }
  }

  function open(row: SavedSearch) {
    try { sessionStorage.setItem('wehouse:open-followed-search', JSON.stringify({ kind: row.search_kind, criteria: row.criteria })); }
    catch { /* Search still opens without restored filters. */ }
    onNavigate(row.search_kind === 'hotels' ? 'hotels' : 'search');
  }

  return <div className="min-h-screen bg-[#090B10] pb-12 text-white">
    <header className="sticky top-0 z-30 border-b border-white/[.06] bg-[#090B10]/95 px-4 py-4 backdrop-blur-xl sm:px-6">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <BackButton onClick={onBack} />
        <div><h1 className="text-xl font-semibold">Followed searches</h1><p className="mt-1 text-sm text-[#AAA3B3]">Alerts for matching homes and hotels.</p></div>
      </div>
    </header>
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      {loading ? <p role="status" className="text-sm text-[#AAA3B3]">Loading followed searches…</p>
        : error ? <div role="alert"><p className="text-sm">{error}</p><button type="button" className="mt-4 min-h-11 text-violet-300" onClick={() => setReload(value => value + 1)}>Try again</button></div>
        : rows.length ? <ul className="divide-y divide-white/[.07] border-y border-white/[.07]">
          {rows.map(row => <li key={row.id} className="flex flex-wrap items-center gap-3 py-5">
            <button type="button" onClick={() => open(row)} className="min-w-0 flex-1 text-left">
              <span className="text-xs font-semibold uppercase tracking-wide text-violet-300">{row.search_kind === 'hotels' ? 'Hotels' : 'Homes'}</span>
              <span className="mt-1 block break-words text-base font-semibold">{row.name}</span>
              <span className="mt-1 block text-xs text-[#AAA3B3]">{row.notifications_enabled ? 'Alerts on' : 'Alerts paused'} · Open matching search</span>
            </button>
            <button type="button" disabled={busy !== null} onClick={() => void change(row, 'toggle')}
              className="min-h-11 rounded-xl border border-violet-400/25 px-3 text-sm text-violet-300 disabled:opacity-40">
              {row.notifications_enabled ? 'Pause alerts' : 'Resume alerts'}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => void change(row, 'remove')}
              aria-label={`Remove ${row.name}`} className="min-h-11 px-2 text-sm text-[#AAA3B3] disabled:opacity-40">Remove</button>
          </li>)}
        </ul> : <div className="py-12 text-center">
          <h2 className="text-base font-semibold">No followed searches yet</h2>
          <p className="mt-2 text-sm text-[#AAA3B3]">Set filters in Homes or Hotels, then choose Follow search. Saved places stay separate.</p>
          <button type="button" onClick={() => onNavigate('search')} className="mt-5 min-h-11 rounded-xl border border-violet-400/30 px-4 text-violet-300">Explore homes</button>
        </div>}
    </main>
  </div>;
}
