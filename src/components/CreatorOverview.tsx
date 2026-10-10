import { useRpcRead } from '@/hooks/useRpcRead';
import './creator-overview.css';

type Summary = {
  accounts: number; partners: number; workers: number; team: number;
  apartments: number; hotels: number; hotel_team: number;
  pending_reviews: number; workers_reviewed?: number; workers_under_review?: number; workers_onboarding?: number; inspections: number; payouts: number;
};
type Destination = 'people' | 'team' | 'properties' | 'workers' | 'finance';

const number = (value: unknown) => Number(value || 0).toLocaleString('en-NG');

export default function CreatorOverview({ userId, onOpen }: { userId: string; onOpen: (destination: Destination, id?: string) => void }) {
  const { data, loading, error, refresh } = useRpcRead<Summary>('creator_get_dashboard_summary', userId);

  if (loading) return <section role="status" aria-label="Loading platform overview" data-overview-state="loading" className="space-y-5">
    <div className="wh-creator-hero"><div className="shimmer h-2.5 w-28 rounded-full" /><div className="shimmer mt-4 h-8 w-64 max-w-full rounded-lg" /><div className="shimmer mt-3 h-3 w-80 max-w-full rounded-full" /></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0,1,2,3].map(item => <div key={item} className="wh-creator-kpi"><div className="shimmer h-3 w-20 rounded-full"/><div className="shimmer mt-4 h-8 w-16 rounded-lg"/></div>)}</div>
    <div className="space-y-3">{[0,1,2].map(item => <div key={item} className="shimmer h-16 rounded-xl"/>)}</div>
  </section>;

  if (error || !data) return <section role="alert" className="rounded-2xl border border-amber-500/25 bg-amber-500/[.05] p-5">
    <p className="text-sm font-semibold">Platform overview unavailable</p><p className="mt-2 text-xs leading-5 text-[var(--wh-text-secondary)]">{error || 'The summary returned no data.'}</p>
    <button type="button" onClick={() => void refresh()} className="mt-4 min-h-10 rounded-xl border border-[var(--wh-border)] px-4 text-sm font-semibold">Try again</button>
  </section>;

  const metrics = [
    { label: 'Personal accounts', value: data.accounts, note: 'Customer accounts', tone: 'violet', destination: 'people' as Destination },
    { label: 'Property partners', value: data.partners, note: 'Accommodation supply', tone: 'blue', destination: 'people' as Destination, id: 'property_partner' },
    { label: 'Service Workers', value: data.workers, note: 'Service marketplace', tone: 'teal', destination: 'workers' as Destination },
    { label: 'Published inventory', value: Number(data.apartments || 0) + Number(data.hotels || 0), note: `${number(data.apartments)} apartments · ${number(data.hotels)} hotels`, tone: 'amber', destination: 'properties' as Destination },
  ];
  const work = [
    { title: 'Worker verification', description: data.pending_reviews ? `${number(data.pending_reviews)} profiles waiting for a decision` : 'No Worker reviews waiting', count: data.pending_reviews, tag: data.pending_reviews ? 'Needs review' : 'Clear', destination: 'workers' as Destination, accent: 'violet' },
    { title: 'Property inspections', description: `${number(data.inspections)} inspections in the current pipeline`, count: data.inspections, tag: 'Property lifecycle', destination: 'properties' as Destination, accent: 'blue' },
    { title: 'Payout requests', description: 'Review requests before financial actions are processed', count: data.payouts, tag: data.payouts ? 'Finance queue' : 'No pending count', destination: 'finance' as Destination, accent: 'amber' },
  ];
  const reviewed = Math.max(0, Number(data.workers_reviewed || 0));
  const reviewTotal = Math.max(0, Number(data.workers || 0));
  const reviewedPct = reviewTotal ? Math.min(100, Math.round(reviewed / reviewTotal * 100)) : 0;

  return <section data-overview-state="ready" className="wh-creator-overview space-y-6">
    <header className="wh-creator-hero">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="wh-eyebrow"><span className="wh-live-dot"/> GLOBAL CONTROL PLANE</span>
        <span className="wh-hero-caption">Creator workspace · Live summary</span>
      </div>
      <div className="mt-5 max-w-2xl"><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Platform overview</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[var(--wh-text-secondary)]">A clear view of marketplace supply, account growth and the work that needs your attention.</p></div>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onOpen('people')} className="wh-primary-action">Explore accounts <span aria-hidden="true">↗</span></button>
        <button type="button" onClick={() => onOpen('analytics')} className="wh-secondary-action">Platform analytics <span aria-hidden="true">→</span></button>
      </div>
    </header>

    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {metrics.map((metric, index) => <button key={metric.label} type="button" onClick={() => onOpen(metric.destination, 'id' in metric ? metric.id : undefined)} className={`wh-creator-kpi wh-kpi-${metric.tone}`} style={{ animationDelay: `${index * 45}ms` }}>
        <span className="flex items-center justify-between gap-2"><span className="wh-kpi-label">{metric.label}</span><span className="wh-kpi-mark" aria-hidden="true">{['↗','⌂','✳','▦'][index]}</span></span>
        <strong className="mt-4 block text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">{number(metric.value)}</strong>
        <span className="mt-2 block text-xs leading-5 text-[var(--wh-text-muted)]">{metric.note}</span>
        <span className="wh-kpi-footer">Open workspace <span aria-hidden="true">→</span></span>
      </button>)}
    </div>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,.8fr)]">
      <section className="wh-overview-panel">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--wh-border-subtle)] pb-4"><div><p className="wh-section-kicker">OPERATIONS</p><h3 className="mt-1 text-lg font-semibold">Work queues</h3><p className="mt-1 text-xs text-[var(--wh-text-muted)]">Jump directly into the operational workspace.</p></div><span className="text-xs text-[var(--wh-text-muted)]">3 work areas</span></div>
        <div className="divide-y divide-[var(--wh-border-subtle)]">
          {work.map(item => <button key={item.title} type="button" onClick={() => onOpen(item.destination)} className="wh-work-row">
            <span className={`wh-work-icon wh-work-${item.accent}`} aria-hidden="true">{item.accent === 'violet' ? '✓' : item.accent === 'blue' ? '⌂' : '₦'}</span>
            <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong className="text-sm font-semibold">{item.title}</strong><span className={item.count ? 'wh-status-pill wh-status-attention' : 'wh-status-pill'}>{item.tag}</span></span><span className="mt-1.5 block text-xs leading-5 text-[var(--wh-text-muted)]">{item.description}</span></span>
            <span className="wh-work-count">{number(item.count)}<span aria-hidden="true">→</span></span>
          </button>)}
        </div>
      </section>

      <aside className="space-y-5">
        <section className="wh-overview-panel">
          <div className="flex items-start justify-between gap-3"><div><p className="wh-section-kicker">MARKETPLACE HEALTH</p><h3 className="mt-1 text-lg font-semibold">Worker coverage</h3></div><span className="wh-health-icon" aria-hidden="true">✳</span></div>
          <div className="mt-6 flex items-end justify-between gap-4"><div><strong className="text-3xl font-semibold tabular-nums">{number(reviewed)}</strong><p className="mt-1 text-xs text-[var(--wh-text-muted)]">Reviewed profiles</p></div><div className="text-right"><strong className="text-lg font-semibold tabular-nums">{reviewedPct}%</strong><p className="mt-1 text-xs text-[var(--wh-text-muted)]">of all Workers</p></div></div>
          <div className="wh-progress-track mt-4"><span style={{width: `${reviewedPct}%`}}/></div>
          <div className="mt-4 flex justify-between gap-3 text-xs text-[var(--wh-text-muted)]"><span>{number(data.workers_under_review || 0)} under review</span><span>{number(data.workers_onboarding || 0)} onboarding</span></div>
          <button type="button" onClick={() => onOpen('workers')} className="wh-panel-link mt-5">Manage Worker lifecycle <span aria-hidden="true">→</span></button>
        </section>
        <section className="wh-overview-panel">
          <p className="wh-section-kicker">WeHouse team</p><div className="mt-2 flex items-end justify-between gap-3"><div><h3 className="text-lg font-semibold">People behind the platform</h3><p className="mt-1 text-xs leading-5 text-[var(--wh-text-muted)]">Admins and assigned Operations members.</p></div><strong className="text-3xl font-semibold tabular-nums">{number(data.team)}</strong></div>
          <button type="button" onClick={() => onOpen('team')} className="wh-panel-link mt-5">Manage team access <span aria-hidden="true">→</span></button>
        </section>
      </aside>
    </div>
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--wh-border-subtle)] pt-4 text-xs text-[var(--wh-text-muted)]"><span>Counts reflect the Creator summary service; detailed trends live in Analytics.</span><button type="button" onClick={() => void refresh()} className="rounded-lg px-3 py-2 font-semibold text-[var(--wh-accent-text)] hover:bg-[var(--wh-interactive)]">Refresh summary ↻</button></footer>
  </section>;
}
