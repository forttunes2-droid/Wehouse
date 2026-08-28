import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { getActivityLabel, getActionVerb, parseAuditDetails } from '@/lib/activity-formatter';
import type { Profile } from '@/types';

type Tab = 'trends' | 'pipelines' | 'activity';
type Period = 7 | 30 | 90;
type Series = 'signups' | 'published_listings' | 'worker_bookings' | 'verified_payments';
type DailyPoint = { date: string; signups: number; published_listings: number; worker_bookings: number; verified_payments: number };
type Summary = { new_users: number; new_workers: number; new_partners: number; published_listings: number; worker_bookings: number; verified_payments: number; verified_payment_volume: number; commission_earned: number };
type Market = { state: string; lga: string; available_listings: number };
type Activity = { id: string; action: string; target_type: string | null; target_id: string | null; details: string | null; created_at: string; admin_id: string | null; actor_username: string | null; actor_role: string | null };
type Analytics = { days: number; period_start: string; period_end: string; summary: Summary; daily: DailyPoint[]; listing_pipeline: Record<string, number>; worker_pipeline: Record<string, number>; top_markets: Market[]; activity: Activity[] };

const EMPTY: Analytics = {
  days: 30,
  period_start: '',
  period_end: '',
  summary: { new_users: 0, new_workers: 0, new_partners: 0, published_listings: 0, worker_bookings: 0, verified_payments: 0, verified_payment_volume: 0, commission_earned: 0 },
  daily: [], listing_pipeline: {}, worker_pipeline: {}, top_markets: [], activity: [],
};

const SERIES: Array<{ key: Series; label: string }> = [
  { key: 'signups', label: 'Sign-ups' },
  { key: 'published_listings', label: 'Published properties' },
  { key: 'worker_bookings', label: 'Worker bookings' },
  { key: 'verified_payments', label: 'Verified payments' },
];

export default function AnalyticsPage({ profile }: { profile: Profile | null }) {
  const [tab, setTab] = useState<Tab>('trends');
  const [period, setPeriod] = useState<Period>(30);
  const [series, setSeries] = useState<Series>('signups');
  const [data, setData] = useState<Analytics>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.role !== 'creator') return;
    let active = true;
    void (async () => {
      setLoading(true);
      const { data: result, error } = await supabase.rpc('creator_get_platform_analytics', { p_days: period });
      if (!active) return;
      if (error) {
        toast.error(error.message || 'Unable to load analytics');
        setData({ ...EMPTY, days: period });
      } else setData({ ...EMPTY, ...(result || {}) } as Analytics);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [period, profile?.role]);

  if (profile?.role !== 'creator') return <Empty title="Creator analytics only" text="This reporting surface is restricted to the Creator workspace." />;

  const currentSeries = SERIES.find(item => item.key === series)!;
  return <div className="space-y-5">
    <section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.09] via-[#11141D] to-[#0D1017] p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[.2em] text-violet-300">PLATFORM ANALYTICS</p>
          <h2 className="mt-2 text-xl font-bold sm:text-2xl">Movement, pipelines and audit history</h2>
          <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-[#777C8E]">Overview tells you what exists now. Analytics shows how the platform is moving, where inventory sits in its lifecycle and what changed.</p>
        </div>
        <div className="flex rounded-xl border border-white/[.06] bg-black/15 p-1">{([7, 30, 90] as Period[]).map(value => <button key={value} onClick={() => setPeriod(value)} className={`rounded-lg px-3 py-2 text-[9px] font-semibold ${period === value ? 'bg-violet-500 text-white' : 'text-[#74798A]'}`}>{value} days</button>)}</div>
      </div>
    </section>

    <div className="overflow-x-auto scrollbar-hide"><div className="flex min-w-max gap-1 rounded-2xl border border-white/[.05] bg-[#0D1017] p-1">{([['trends', 'Trends'], ['pipelines', 'Pipelines'], ['activity', 'Activity']] as const).map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`rounded-xl px-4 py-2.5 text-[10px] font-semibold ${tab === id ? 'bg-violet-500 text-white' : 'text-[#757A8C]'}`}>{label}</button>)}</div></div>

    {loading ? <Loading /> : tab === 'trends' ? <Trends data={data} series={series} setSeries={setSeries} currentSeries={currentSeries} /> : tab === 'pipelines' ? <Pipelines data={data} /> : <ActivityView rows={data.activity} />}
  </div>;
}

function Trends({ data, series, setSeries, currentSeries }: { data: Analytics; series: Series; setSeries: (value: Series) => void; currentSeries: { key: Series; label: string } }) {
  const s = data.summary || EMPTY.summary;
  const cards: Array<[string, number, string]> = [
    ['New users', s.new_users, 'Customer registrations in this period'],
    ['New workers', s.new_workers, 'Worker registrations in this period'],
    ['New partners', s.new_partners, 'Property Partner registrations'],
    ['Published properties', s.published_listings, 'Listings that reached publication'],
    ['Worker bookings', s.worker_bookings, 'Service bookings created'],
    ['Verified payments', s.verified_payments, 'Payments verified by WeHouse'],
  ];
  return <div className="space-y-5">
    <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{cards.map(([label, value, note]) => <Metric key={label} label={label} value={value} note={note} />)}</section>
    <section className="grid gap-3 md:grid-cols-2"><MoneyMetric label="Verified payment volume" value={s.verified_payment_volume} note="Verified payment value in this period" /><MoneyMetric label="Commission recorded" value={s.commission_earned} note="Commission ledger movement in this period" /></section>
    <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-sm font-semibold">{currentSeries.label} by day</h3><p className="mt-1 text-[9px] text-[#676C7E]">Daily movement across the selected period.</p></div><div className="flex gap-1 overflow-x-auto scrollbar-hide">{SERIES.map(item => <button key={item.key} onClick={() => setSeries(item.key)} className={`whitespace-nowrap rounded-lg px-2.5 py-2 text-[9px] font-semibold ${series === item.key ? 'bg-violet-500/15 text-violet-300' : 'text-[#666B7C]'}`}>{item.label}</button>)}</div></div>
      <TrendChart rows={data.daily || []} series={series} />
    </section>
  </div>;
}

function Pipelines({ data }: { data: Analytics }) {
  return <div className="grid gap-4 xl:grid-cols-2">
    <Pipeline title="Property lifecycle" note="Where prepared and published listings currently sit." values={data.listing_pipeline || {}} order={['pending_approval', 'available', 'reserved', 'closed', 'rejected']} />
    <Pipeline title="Worker verification pipeline" note="Current professional verification states." values={data.worker_pipeline || {}} order={['pending', 'verification_paid', 'profile_under_review', 'verified', 'rejected', 'suspended']} />
    <section className="xl:col-span-2 rounded-2xl border border-white/[.06] bg-[#10131B] p-4 sm:p-5"><h3 className="text-sm font-semibold">Available inventory by market</h3><p className="mt-1 text-[9px] text-[#676C7E]">Top State/LGA combinations by currently available listings.</p><MarketBars rows={data.top_markets || []} /></section>
  </div>;
}

function ActivityView({ rows }: { rows: Activity[] }) {
  return <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4 sm:p-5"><div className="mb-4"><h3 className="text-sm font-semibold">Recent platform activity</h3><p className="mt-1 text-[9px] text-[#676C7E]">Latest recorded management and system changes. Operational queues stay in Operations.</p></div>{rows.length === 0 ? <Empty title="No activity recorded" text="Audit events will appear here after platform changes are recorded." /> : <div className="divide-y divide-white/[.05]">{rows.map(row => <ActivityRow key={row.id} row={row} />)}</div>}</section>;
}

function ActivityRow({ row }: { row: Activity }) {
  const label = getActivityLabel(row.target_id || row.target_type || 'Platform');
  const verb = getActionVerb(row.action || 'UPDATE');
  const parsed = parseAuditDetails(row.details || '');
  const changed = parsed.oldValue !== undefined && parsed.newValue !== undefined && parsed.oldValue !== parsed.newValue;
  return <div className="flex gap-3 py-3.5"><div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-[10px] font-bold text-violet-300">{String(row.action || 'A')[0]}</div><div className="min-w-0 flex-1"><p className="break-words text-[11px] font-medium">{label} {verb}</p>{changed && <p className="mt-1 break-words text-[9px] text-[#777C8D]"><span className="text-[#5C6172]">{String(parsed.oldValue)}</span> <span className="text-violet-300">→</span> <span>{String(parsed.newValue)}</span></p>}<p className="mt-1 text-[9px] text-[#565B6D]">{row.actor_username ? `@${row.actor_username}` : row.admin_id ? 'Unknown account' : 'WeHouse System'}{row.actor_role ? ` · ${friendly(row.actor_role)}` : ''} · {dateTime(row.created_at)}</p></div></div>;
}

function TrendChart({ rows, series }: { rows: DailyPoint[]; series: Series }) {
  const values = rows.map(row => Number(row[series] || 0));
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => {
    const x = rows.length <= 1 ? 50 : (index / (rows.length - 1)) * 100;
    const y = 92 - (value / max) * 78;
    return `${x},${y}`;
  }).join(' ');
  const total = values.reduce((sum, value) => sum + value, 0);
  const peak = Math.max(0, ...values);
  return <div className="mt-5"><div className="mb-3 flex gap-5"><SmallStat label="Period total" value={total} /><SmallStat label="Peak day" value={peak} /></div>{rows.length === 0 ? <Empty title="No trend data" text="No daily records were returned for this period." /> : <div className="overflow-hidden rounded-2xl border border-white/[.05] bg-black/10 p-3"><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-48 w-full" role="img" aria-label="Daily analytics trend"><line x1="0" y1="92" x2="100" y2="92" stroke="currentColor" className="text-white/10" vectorEffect="non-scaling-stroke" /><polyline points={points} fill="none" stroke="currentColor" className="text-violet-400" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" /></svg><div className="mt-2 flex justify-between text-[8px] text-[#555A6A]"><span>{shortDate(rows[0]?.date)}</span><span>{shortDate(rows[Math.floor(rows.length / 2)]?.date)}</span><span>{shortDate(rows.at(-1)?.date)}</span></div></div>}</div>;
}

function Pipeline({ title, note, values, order }: { title: string; note: string; values: Record<string, number>; order: string[] }) {
  const entries = [...order.filter(key => values[key] !== undefined).map(key => [key, Number(values[key] || 0)] as const), ...Object.entries(values).filter(([key]) => !order.includes(key)).map(([key, value]) => [key, Number(value || 0)] as const)];
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  return <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4 sm:p-5"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-[9px] text-[#676C7E]">{note}</p><div className="mt-4 space-y-3">{entries.length === 0 ? <Empty title="No records" text="This pipeline is empty." /> : entries.map(([key, value]) => <Bar key={key} label={friendly(key)} value={value} max={Math.max(1, total)} />)}</div></section>;
}

function MarketBars({ rows }: { rows: Market[] }) {
  const max = Math.max(1, ...rows.map(row => Number(row.available_listings || 0)));
  return <div className="mt-4 space-y-3">{rows.length === 0 ? <Empty title="No available markets yet" text="Markets appear here when approved listings become available." /> : rows.map(row => <Bar key={`${row.state}-${row.lga}`} label={`${row.lga}, ${row.state}`} value={Number(row.available_listings || 0)} max={max} />)}</div>;
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) { const width = Math.max(value > 0 ? 5 : 0, Math.min(100, (value / Math.max(1, max)) * 100)); return <div><div className="mb-1.5 flex items-center justify-between gap-3"><p className="truncate text-[10px] text-[#B9BCC8]">{label}</p><p className="shrink-0 text-[10px] font-semibold">{value}</p></div><div className="h-1.5 overflow-hidden rounded-full bg-white/[.05]"><div className="h-full rounded-full bg-violet-500" style={{ width: `${width}%` }} /></div></div>; }
function Metric({ label, value, note }: { label: string; value: number; note: string }) { return <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4"><p className="text-2xl font-bold">{Number(value || 0).toLocaleString()}</p><p className="mt-1 text-[10px] font-semibold">{label}</p><p className="mt-1 text-[8px] leading-relaxed text-[#5F6475]">{note}</p></section>; }
function MoneyMetric({ label, value, note }: { label: string; value: number; note: string }) { return <section className="rounded-2xl border border-emerald-500/10 bg-emerald-500/[.03] p-4"><p className="text-xl font-bold text-emerald-300">{money(value)}</p><p className="mt-1 text-[10px] font-semibold">{label}</p><p className="mt-1 text-[8px] text-[#617067]">{note}</p></section>; }
function SmallStat({ label, value }: { label: string; value: number }) { return <div><p className="text-[8px] uppercase tracking-wide text-[#555A6A]">{label}</p><p className="mt-1 text-sm font-bold">{value.toLocaleString()}</p></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="rounded-2xl border border-dashed border-white/[.08] p-6 text-center"><p className="text-xs font-semibold">{title}</p><p className="mt-1 text-[9px] leading-relaxed text-[#616677]">{text}</p></div>; }
function Loading() { return <div className="grid min-h-64 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>; }
function friendly(value: unknown) { return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase()); }
function shortDate(value?: string) { if (!value) return ''; return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function dateTime(value: string) { return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function money(value: number) { return `₦${Number(value || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`; }
