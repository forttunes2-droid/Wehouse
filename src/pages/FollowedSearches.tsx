import WeHouseLoadingState from "@/components/WeHouseLoadingState";
import { useEffect, useRef, useState } from 'react';
import AccountShell from '@/components/AccountShell';
import type { Profile } from '@/types';
import type { NavPage } from '@/types/nav';
import { getMySavedSearches, removeSavedSearch, setSavedSearchAlerts, type SavedSearch } from '@/lib/supabase/saved-searches';
import { toast } from 'sonner';
import { withTimeout } from '@/lib/withTimeout';

type Props = { profile: Profile; onBack: () => void; onNavigate: (page: NavPage) => void };

export default function FollowedSearches(props:Props) {
  return <FollowedSearchesContent key={props.profile.user_id} {...props}/>;
}
function FollowedSearchesContent({ profile, onBack, onNavigate }: Props) {
  const [rows, setRows] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const [reload, setReload] = useState(0);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);

  useEffect(() => {
    let active = true;
    setRows([]);
    setLoading(true);
    setError('');
    void withTimeout(getMySavedSearches(),10000,'Followed searches took too long to load.').then(({ searches, error: loadError }) => {
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
      const result = await withTimeout(operation === 'remove'
        ? removeSavedSearch(row.id)
        : setSavedSearchAlerts(row.id, !row.notifications_enabled),10000,'The save outcome is unknown. Refresh followed searches before retrying.');
      if(!mounted.current)return;
      if (result.error) throw result.error;
      setRows(current => operation === 'remove'
        ? current.filter(item => item.id !== row.id)
        : current.map(item => item.id === row.id ? { ...item, notifications_enabled: !row.notifications_enabled } : item));
      toast.success(operation === 'remove' ? 'Search removed' : row.notifications_enabled ? 'Alerts paused' : 'Alerts resumed');
    } catch { if(mounted.current)toast.error('Search alerts could not be confirmed. Refresh followed searches before retrying.'); }
    finally { busyRef.current = null; if(mounted.current)setBusy(null); }
  }

  function open(row: SavedSearch) {
    try { sessionStorage.setItem('wehouse:open-followed-search', JSON.stringify({ kind: row.search_kind, criteria: row.criteria })); }
    catch { toast.error('The search filters could not be restored. Try again.'); return; }
    onNavigate(row.search_kind === 'hotels' ? 'hotels' : 'search');
  }

  return <AccountShell profile={profile} workspace="personal" title="Followed searches"
    description="Keep your search filters and find newly matching homes or hotels in Inbox Activity. Pause a search to stop new match alerts; existing Activity stays available." onBack={onBack} narrow>
    {loading ? <WeHouseLoadingState compact label="Loading followed searches" />
      : error ? <div role="alert" className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4"><p className="text-sm">{error}</p><button type="button" className="mt-2 min-h-11 text-sm text-violet-700 dark:text-violet-300" onClick={() => setReload(value => value + 1)}>Try again</button></div>
      : rows.length ? <ul className="divide-y divide-[var(--wh-border-subtle)] overflow-hidden rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)]">
        {rows.map(row => <li key={row.id} className="px-4 py-3">
          <button type="button" onClick={() => open(row)} className="flex min-h-11 w-full items-center justify-between gap-3 text-left">
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">{row.search_kind === 'hotels' ? 'Hotels' : 'Homes'}</span>
              <span className="mt-0.5 block break-words text-sm font-semibold">{row.name}</span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-[var(--wh-text-muted)]">›</span>
          </button>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[var(--wh-border-subtle)] pt-1">
            <span className="text-xs text-[var(--wh-text-secondary)]">{row.notifications_enabled ? 'Alerts on' : 'Alerts paused'}</span>
            <div className="flex items-center gap-3">
              <button type="button" disabled={busy !== null} onClick={() => void change(row, 'toggle')}
                className="min-h-11 text-xs font-semibold text-violet-700 dark:text-violet-300 disabled:opacity-40">
                {row.notifications_enabled ? 'Pause alerts' : 'Resume alerts'}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => void change(row, 'remove')}
                aria-label={`Remove ${row.name}`} className="min-h-11 text-xs text-[var(--wh-text-secondary)] disabled:opacity-40">Remove</button>
            </div>
          </div>
        </li>)}
      </ul> : <div className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] px-4 py-6">
        <h2 className="text-sm font-semibold">No followed searches yet</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--wh-text-secondary)]">Follow a filtered home or hotel search to see it here. Saved places stay separate.</p>
        <button type="button" onClick={() => onNavigate('search')} className="mt-3 min-h-11 text-xs font-semibold text-violet-700 dark:text-violet-300">Explore homes</button>
      </div>}
  </AccountShell>;
}
