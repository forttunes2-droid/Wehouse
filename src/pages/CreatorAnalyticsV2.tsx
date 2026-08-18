import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Period = 7 | 30 | 90;
type Tab = 'trends' | 'pipelines';
type Series = 'signups' | 'published_listings' | 'worker_bookings' | 'verified_payments';
type Analytics = any;

const SERIES: Array<{ key: Series; label: string }> = [
  { key: 'signups', label: 'Sign-ups' },
  { key: 'published_listings', label: 'Published properties' },
  { key: 'worker_bookings', label: 'Worker bookings' },
  { key: 'verified_payments', label: 'Verified payments' },
];

export default function CreatorAnalyticsV2({ profile }: { profile: Profile | null }) {
  const [period, setPeriod] = useState<Period>(30);
  const [tab, setTab] = useState<Tab>('trends');
  const [series, setSeries] = useState<Series>('signups');
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.role !== 'creator') return;
    let active = true;
    void (async () => {
      setLoading(true);
      const { data: result, error } = await supabase.rpc('creator_get_platform_analytics', { p_days: period });
      if (!active) return;
      if (error) toast.error(error.message);
      setData(result || null);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [period, profile?.role]);

  if (profile?.role !== 'creator') return <Empty text="Creator analytics only." />;
  if (loading) return <Loading />;
  const summary = data?.summary || {};

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.08] via-[#11141D] to-[#0D1017] p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[8px] font-bold uppercase tracking-[.18em] text-violet-300">PLATFORM ANALYTICS</p><h2 className="mt-2 text-lg font-bold">Trends and lifecycle movement</h2><p className="mt-1 text-[10px] text-[#73798A]">Analytics measures movement. Management history now lives in Audit.</p></div><div className="flex rounded-xl border border-white/[.06] bg-black/10 p-1">{([7,30,90] as Period[]).map((value) => <button key={value} onClick={() => setPeriod(value)} className={`rounded-lg px-3 py-2 text-[9px] font-semibold ${period === value ? 'bg-violet-500 text-white' : 'text-[#74798A]'}`}>{value} days</button>)}</div></div>
      </section>

      <div className="flex rounded-xl border border-white/[.06] bg-[#0D1017] p-1 sm:w-fit"><button onClick={() => setTab('trends')} className={`rounded-lg px-4 py-2.5 text-[10px] font-semibold ${tab === 'trends' ? 'bg-violet-500 text-white' : 'text-[#777D8D]'}`}>Trends</button><button onClick={() => setTab('pipelines')} className={`rounded-lg px-4 py-2.5 text-[10px] font-semibold ${tab === 'pipelines' ? 'bg-violet-500 text-white' : 'text-[#777D8D]'}`}>Pipelines</button></div>

      {tab === 'trends' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 border-y border-white/[.065] md:grid-cols-3 xl:grid-cols-6">
            <Metric label="New users" value={summary.new_users} />
            <Metric label="New Workers" value={summary.new_workers} />
            <Metric label="New partners" value={summary.new_partners} />
            <Metric label="Published properties" value={summary.published_listings} />
            <Metric label="Worker bookings" value={summary.worker_bookings} />
            <Metric label="Verified payments" value={summary.verified_payments} />
          </div>
          <div className="grid border-b border-white/[.065] sm:grid-cols-2"><Money label="Verified payment volume" value={summary.verified_payment_volume} /><Money label="Commission recorded" value={summary.commission_earned} /></div>
          <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-sm font-semibold">Daily movement</h3><p className="mt-1 text-[9px] text-[#666D7E]">{SERIES.find((item) => item.key === series)?.label}</p></div><div className="flex gap-1 overflow-x-auto scrollbar-hide">{SERIES.map((item) => <button key={item.key} onClick={() => setSeries(item.key)} className={`shrink-0 rounded-lg px-2.5 py-2 text-[9px] font-semibold ${series === item.key ? 'bg-violet-500/15 text-violet-300' : 'text-[#666B7C]'}`}>{item.label}</button>)}</div></div><Trend rows={data?.daily || []} series={series} /></section>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          <Pipeline title="Property lifecycle" values={data?.listing_pipeline || {}} preferred={['pending_approval','available','reserved','occupied','completed','maintenance','rejected']} />
          <Pipeline title="Worker lifecycle" values={data?.worker_pipeline || {}} preferred={['pending','verification_paid','profile_under_review','verified','rejected','suspended']} worker />
          <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4 xl:col-span-2"><h3 className="text-sm font-semibold">Available inventory by market</h3><p className="mt-1 text-[9px] text-[#666D7E]">Current available listings by State/LGA.</p><div className="mt-4 space-y-3">{(data?.top_markets || []).length ? data.top_markets.map((row: any) => <Bar key={`${row.state}-${row.lga}`} label={`${row.lga}, ${row.state}`} value={Number(row.available_listings || 0)} max={Math.max(1,...(data.top_markets || []).map((item:any)=>Number(item.available_listings||0)))} />) : <Empty text="No available markets yet." />}</div></section>
        </div>
      )}
    </div>
  );
}

function Trend({ rows, series }: { rows: any[]; series: Series }) { const values = rows.map((row) => Number(row[series] || 0)); const max = Math.max(1,...values); const points = values.map((value,index)=>`${rows.length <= 1 ? 50 : (index/(rows.length-1))*100},${92-(value/max)*78}`).join(' '); return <div className="mt-4">{rows.length === 0 ? <Empty text="No trend data for this period." /> : <div className="overflow-hidden rounded-xl border border-white/[.05] bg-black/10 p-3"><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-44 w-full"><line x1="0" y1="92" x2="100" y2="92" stroke="currentColor" className="text-white/10" vectorEffect="non-scaling-stroke"/><polyline points={points} fill="none" stroke="currentColor" className="text-violet-400" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"/></svg></div>}</div>; }
function Pipeline({ title, values, preferred, worker = false }: { title: string; values: Record<string,number>; preferred: string[]; worker?: boolean }) { const entries = [...preferred.filter((key)=>values[key]!==undefined).map((key)=>[key,Number(values[key]||0)] as const),...Object.entries(values).filter(([key])=>!preferred.includes(key)).map(([key,value])=>[key,Number(value||0)] as const)]; const max=Math.max(1,...entries.map(([,value])=>value)); return <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-[9px] text-[#666D7E]">{worker ? 'Internal statuses are translated into the Worker journey.' : 'Current lifecycle distribution.'}</p><div className="mt-4 space-y-3">{entries.length ? entries.map(([key,value])=><Bar key={key} label={worker ? workerLabel(key) : friendly(key)} value={value} max={max}/>) : <Empty text="No records in this pipeline." />}</div></section>; }
function Bar({label,value,max}:{label:string;value:number;max:number}){const width=Math.max(value?5:0,Math.min(100,(value/Math.max(1,max))*100));return <div><div className="mb-1.5 flex justify-between gap-3"><p className="truncate text-[10px] text-[#B9BCC8]">{label}</p><p className="text-[10px] font-semibold">{value}</p></div><div className="h-1.5 overflow-hidden rounded-full bg-white/[.05]"><div className="h-full rounded-full bg-violet-500" style={{width:`${width}%`}}/></div></div>}
function Metric({label,value}:{label:string;value:any}){return <div className="border-b border-r border-white/[.055] px-3 py-4"><p className="text-xl font-bold">{Number(value||0).toLocaleString()}</p><p className="mt-1 text-[9px] text-[#717787]">{label}</p></div>}
function Money({label,value}:{label:string;value:any}){return <div className="border-r border-white/[.055] px-3 py-4"><p className="text-xl font-bold text-emerald-300">₦{Number(value||0).toLocaleString('en-NG')}</p><p className="mt-1 text-[9px] text-[#717787]">{label}</p></div>}
function workerLabel(value:string){const map:Record<string,string>={pending:'Work profile / setup',verification_paid:'Work verification',profile_under_review:'WeHouse review',verified:'Reviewed / live',rejected:'Needs changes',suspended:'Suspended'};return map[value]||friendly(value)}
function friendly(value:string){return String(value||'').replace(/_/g,' ').replace(/\b\w/g,(c)=>c.toUpperCase())}
function Loading(){return <div className="grid min-h-48 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>}
function Empty({text}:{text:string}){return <div className="rounded-xl border border-dashed border-white/[.08] px-4 py-8 text-center text-[10px] text-[#666C7D]">{text}</div>}
