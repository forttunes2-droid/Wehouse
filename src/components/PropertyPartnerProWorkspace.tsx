import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, ClipboardList, Download, Plus, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Asset = { kind: 'home' | 'hotel'; id: string; title: string };
type Stay = { kind: Asset['kind']; asset_id: string; asset_title: string; booking_id: string; check_in: string; check_out: string; status: string };
type Income = { month_key: string; net_amount: number; earnings: number };
type Task = { id: string; asset_kind: Asset['kind']; asset_id: string; title: string; due_on: string | null; status: 'open' | 'done' };
type Overview = { assets: Asset[]; stays: Stay[]; income: Income[]; tasks: Task[]; stays_limited: boolean; tasks_limited: boolean };
type Section = 'calendar' | 'income' | 'tasks';
const key = (kind: string, id: string) => `${kind}:${id}`;
const money = (amount: number) => `₦${Number(amount || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
const csvCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;

export default function PropertyPartnerProWorkspace({ profile }: { profile: Profile }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [section, setSection] = useState<Section>('calendar');
  const [asset, setAsset] = useState('all');
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const result = await supabase.rpc('get_my_partner_pro_overview');
    if (result.error || !result.data || !Array.isArray(result.data.assets) || !Array.isArray(result.data.stays)) {
      setError(true); setData(null);
    } else { setData(result.data as Overview); setError(false); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load, profile.user_id]);

  const assets = data?.assets || [];
  const stays = useMemo(() => (data?.stays || []).filter(row => asset === 'all' || key(row.kind, row.asset_id) === asset), [data, asset]);
  const tasks = useMemo(() => (data?.tasks || []).filter(row => asset === 'all' || key(row.asset_kind, row.asset_id) === asset), [data, asset]);
  const income = data?.income || [];
  const selectedAsset = assets.find(row => key(row.kind, row.id) === asset);
  const periods = useMemo(() => Array.from({ length: 12 }, (_, index) => {
    const day = new Date(); day.setDate(1); day.setMonth(day.getMonth() - index);
    const month = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`;
    return { month, net_amount: Number(income.find(row => row.month_key === month)?.net_amount || 0), earnings: Number(income.find(row => row.month_key === month)?.earnings || 0) };
  }), [data]);

  async function saveTask(row?: Task) {
    if (busy) return;
    const target = row ? assets.find(item => item.kind === row.asset_kind && item.id === row.asset_id) : selectedAsset;
    if (!target || (!row && title.trim().length < 3)) return;
    setBusy(true);
    const result = await supabase.rpc('save_my_partner_pro_task', {
      p_kind: target.kind, p_asset_id: target.id, p_title: row ? null : title.trim(),
      p_due_on: row ? null : dueOn || null, p_task_id: row?.id || null,
      p_done: row?.status === 'open',
    });
    setBusy(false);
    if (result.error) return toast.error('Task could not be saved. Check your property access and try again.');
    if (!row) { setTitle(''); setDueOn(''); }
    await load();
  }

  function exportIncome() {
    const rows = [['Month', 'Available net earnings (NGN)', 'Earning entries'], ...periods.map(row => [row.month, row.net_amount, row.earnings])];
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'wehouse-partner-available-earnings.csv'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <main className="mx-auto max-w-5xl space-y-5 px-4 pb-10 pt-2 text-white sm:px-6">
    <header className="rounded-[28px] border border-white/10 bg-[#121720] p-5 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-300">WeHouse Pro · Property Partner</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Your portfolio</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#AFBAC8]">Stays, earnings and property work in one place.</p>
      <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 text-center sm:gap-4">
        <Stat value={String(assets.length)} label="Owned places" />
        <Stat value={String(stays.length)} label="Stays in view" />
        <Stat value={String(tasks.filter(row => row.status === 'open').length)} label="Open tasks" />
      </div>
    </header>
    <nav aria-label="Property Pro tools" className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-[#11151D] p-1">
      {([['calendar','Calendar',CalendarDays],['income','Income',TrendingUp],['tasks','Tasks',ClipboardList]] as const).map(([id,label,Icon]) =>
        <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-2 text-xs font-semibold sm:text-sm ${section === id ? 'bg-violet-500 text-white' : 'text-[#AFB8C8] hover:bg-white/[.06]'}`}><Icon size={17} /><span>{label}</span></button>)}
    </nav>
    {loading ? <p role="status" className="py-12 text-center text-sm text-[#AAB4C4]">Loading your portfolio…</p> : error ? <section role="alert" className="rounded-2xl border border-red-400/20 p-5 text-sm">Portfolio tools could not load. <button type="button" onClick={() => void load()} className="ml-2 text-violet-300 underline">Try again</button></section> : <>
      {section !== 'income' && <label className="block text-sm text-[#AEB8C8]">Property
        <select value={asset} onChange={event => setAsset(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#171D27] px-3 text-base text-white outline-none focus:border-violet-400 sm:max-w-md">
          <option value="all">All owned properties and hotels</option>
          {assets.map(item => <option key={key(item.kind,item.id)} value={key(item.kind,item.id)}>{item.title} · {item.kind === 'home' ? 'Home' : 'Hotel'}</option>)}
        </select>
      </label>}
      {section === 'calendar' && <section aria-label="Portfolio calendar" className="rounded-2xl border border-white/10 bg-[#121720] p-4 sm:p-6">
        <div className="flex items-center gap-3"><CalendarDays className="text-violet-300" size={20} /><div><h2 className="text-lg font-semibold">Upcoming stays</h2><p className="text-xs text-[#9FAABA]">Confirmed or paid stays, from 30 days ago through the next 180 days.</p></div></div>
        {data?.stays_limited && <p className="mt-3 text-xs text-amber-200">Only the first 1,000 stays are shown. Open the property record for its complete schedule.</p>}
        {!stays.length ? <Empty>No eligible stays in this period.</Empty> : <div className="mt-4 divide-y divide-white/[.08]">{stays.map(row => <article key={`${row.kind}:${row.booking_id}`} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><p className="truncate text-sm font-semibold">{row.asset_title}</p><p className="mt-1 text-xs text-[#9FAABA]">{date(row.check_in)} → {date(row.check_out)} · {row.kind === 'hotel' ? 'Hotel' : 'Home'}</p></div><span className="rounded-full bg-violet-400/10 px-3 py-1 text-xs capitalize text-violet-200">{row.status.replaceAll('_',' ')}</span></article>)}</div>}
      </section>}
      {section === 'income' && <section aria-label="Portfolio income" className="rounded-2xl border border-white/10 bg-[#121720] p-4 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Available earnings</h2><p className="mt-1 text-xs text-[#9FAABA]">Net earnings released to you. Protected and disputed money is excluded.</p></div><button type="button" onClick={exportIncome} className="flex min-h-11 items-center gap-2 rounded-xl border border-white/15 px-3 text-sm font-semibold"><Download size={16}/> Download CSV</button></div><div className="mt-5 border-y border-white/10 py-4"><p className="text-xs text-[#AAB4C4]">Last 12 months</p><p className="mt-1 text-2xl font-semibold">{money(periods.reduce((sum,row)=>sum+row.net_amount,0))}</p></div><div className="mt-2 divide-y divide-white/[.08]">{periods.map(row => <div key={row.month} className="flex items-center justify-between gap-3 py-3 text-sm"><div><span>{new Date(`${row.month}-01T12:00:00`).toLocaleDateString('en-NG',{month:'long',year:'numeric'})}</span><p className="text-xs text-[#8E9AAB]">{row.earnings} earning entries</p></div><strong>{money(row.net_amount)}</strong></div>)}</div></section>}
      {section === 'tasks' && <section aria-label="Property tasks" className="rounded-2xl border border-white/10 bg-[#121720] p-4 sm:p-6"><h2 className="text-lg font-semibold">Maintenance and turnover</h2><p className="mt-1 text-xs text-[#9FAABA]">Track work for places you own. These tasks do not assign staff or change booking availability.</p>
        {selectedAsset ? <form onSubmit={event => { event.preventDefault(); void saveTask(); }} className="mt-5 grid gap-2 sm:grid-cols-[1fr_auto_auto]"><input aria-label="Task title" value={title} onChange={event => setTitle(event.target.value.slice(0,160))} placeholder="e.g. Inspect room after checkout" className="min-h-12 min-w-0 rounded-xl border border-white/10 bg-[#1C2330] px-3 text-base outline-none focus:border-violet-400"/><input aria-label="Due date" type="date" value={dueOn} onChange={event => setDueOn(event.target.value)} className="min-h-12 rounded-xl border border-white/10 bg-[#1C2330] px-3 text-base"/><button type="submit" disabled={busy || title.trim().length < 3} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 text-sm font-semibold disabled:opacity-40"><Plus size={17}/> Add task</button></form> : <p className="mt-4 text-xs text-[#AAB4C4]">Choose one property to add a task.</p>}
        {data?.tasks_limited && <p className="mt-3 text-xs text-amber-200">Only the first 200 tasks are shown.</p>}
        {!tasks.length ? <Empty>No tasks here yet.</Empty> : <div className="mt-5 divide-y divide-white/[.08]">{tasks.map(row => <article key={row.id} className="flex items-center gap-3 py-3"><button type="button" disabled={busy} onClick={() => void saveTask(row)} aria-label={row.status === 'open' ? `Complete ${row.title}` : `Reopen ${row.title}`} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border ${row.status === 'done' ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200' : 'border-white/20'}`}>{row.status === 'done' && <Check size={18}/>}</button><div className="min-w-0"><p className={`break-words text-sm ${row.status === 'done' ? 'text-[#8995A5] line-through' : 'font-medium'}`}>{row.title}</p><p className="mt-1 text-xs text-[#8E9AAB]">{assets.find(item => item.kind === row.asset_kind && item.id === row.asset_id)?.title || 'Owned property'}{row.due_on ? ` · Due ${date(row.due_on)}` : ''}</p></div></article>)}</div>}
      </section>}
    </>}
  </main>;
}
function Stat({ value, label }: { value: string; label: string }) { return <div><p className="text-xl font-semibold sm:text-2xl">{value}</p><p className="mt-1 text-[11px] text-[#AAB4C4]">{label}</p></div>; }
function Empty({ children }: { children: React.ReactNode }) { return <p className="py-12 text-center text-sm text-[#9FAABA]">{children}</p>; }
