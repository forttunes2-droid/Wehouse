import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, ClipboardList, Download, Plus, TrendingUp, BedDouble } from 'lucide-react';
import PartnerProArrivalTools from '@/components/PartnerProArrivalTools';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import WeHouseSelect from '@/components/WeHouseSelect';
import { isNative } from '@/lib/native';

type Asset = { kind: 'home' | 'hotel'; id: string; title: string };
type Stay = { kind: Asset['kind']; asset_id: string; asset_title: string; booking_id: string; check_in: string; check_out: string; status: string };
type Income = { month_key: string; net_amount: number; earnings: number };
type Task = { id: string; asset_kind: Asset['kind']; asset_id: string; title: string; due_on: string | null; status: 'open' | 'done' };
type Overview = { assets: Asset[]; stays: Stay[]; income: Income[]; tasks: Task[]; stays_limited: boolean; tasks_limited: boolean };
type PartnerPlan = { active: boolean; under_review?: boolean; current_period_end: string | null; sales_enabled: boolean;
  monthly_price_ngn: number; yearly_price_ngn: number; terms_version: string;
  terms_content: string; terms_accepted: boolean; auto_renews: false };
type Section = 'calendar' | 'income' | 'tasks' | 'occupancy';
const key = (kind: string, id: string) => `${kind}:${id}`;
const money = (amount: number) => `₦${Number(amount || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
const csvCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;

export default function PropertyPartnerProWorkspace({ profile }: { profile: Profile }) {
  const [plan, setPlan] = useState<PartnerPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [planError, setPlanError] = useState(false);
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [accepted, setAccepted] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [section, setSection] = useState<Section>('calendar');
  const [asset, setAsset] = useState('all');
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [busy, setBusy] = useState(false);
  const loadPlan = useCallback(async () => {
    setPlanLoading(true);
    const result = await supabase.rpc('get_my_partner_pro');
    setPlanLoading(false);
    if (result.error || !result.data || typeof result.data.active !== 'boolean') {
      setPlanError(true); setPlan(null); return;
    }
    setPlan(result.data as PartnerPlan); setPlanError(false);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    const result = await supabase.rpc('get_my_partner_pro_overview');
    if (result.error || !result.data || !Array.isArray(result.data.assets) || !Array.isArray(result.data.stays)) {
      setError(true); setData(null);
    } else { setData(result.data as Overview); setError(false); }
    setLoading(false);
  }, []);
  useEffect(() => { void loadPlan(); }, [loadPlan, profile.user_id]);
  useEffect(() => { if (plan?.active) void load(); }, [load, plan?.active, profile.user_id]);
  useEffect(() => { if (plan?.monthly_price_ngn === 0 && plan.yearly_price_ngn > 0) setPeriod('yearly'); }, [plan?.monthly_price_ngn, plan?.yearly_price_ngn]);

  async function purchase() {
    if (purchasing || !plan?.sales_enabled || plan.under_review || !accepted || isNative()) return;
    setPurchasing(true);
    try {
      const terms = await supabase.rpc('accept_my_partner_pro_terms');
      if (terms.error || terms.data !== true) throw new Error(terms.error?.message || 'Terms could not be accepted');
      const payment = await supabase.rpc('create_my_partner_pro_payment', { p_billing_period: period });
      if (payment.error || !payment.data?.reference) throw new Error(payment.error?.message || 'Checkout could not start');
      const initialized = await supabase.functions.invoke('partner-pro-payment-init', {
        body: { reference: payment.data.reference },
      });
      if (initialized.error || !initialized.data?.authorization_url)
        throw new Error(initialized.data?.error || initialized.error?.message || 'Paystack checkout could not start');
      window.location.assign(String(initialized.data.authorization_url));
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'Checkout could not start');
      setPurchasing(false);
    }
  }

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
  const earningMonths = periods.filter(row => row.earnings > 0 || row.net_amount !== 0);

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
  async function exportStatement() {
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      pdf.setFillColor(27, 22, 38); pdf.rect(0, 0, 210, 43, 'F');
      pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13);
      pdf.text('WEHOUSE  /  PROPERTY PARTNER', 17, 19);
      pdf.setFontSize(21); pdf.text('Earnings statement', 17, 32);
      pdf.setTextColor(41, 34, 49); pdf.setFontSize(12); pdf.text(profile.full_name || profile.username || 'Property Partner', 17, 58);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(106, 99, 113);
      pdf.text(`Prepared ${new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}`, 17, 65);
      pdf.text('Released net earnings only. Protected and disputed amounts are excluded.', 17, 73);
      pdf.setDrawColor(227, 222, 234); pdf.line(17, 81, 193, 81);
      let y = 91;
      pdf.setFont('helvetica', 'bold'); pdf.setTextColor(41, 34, 49); pdf.setFontSize(11);
      pdf.text('Last 12 months', 17, y); pdf.text(`NGN ${periods.reduce((sum,row) => sum + row.net_amount, 0).toLocaleString('en-NG')}`, 193, y, { align: 'right' });
      y += 12;
      pdf.setFontSize(9);
      for (const row of earningMonths) {
        pdf.setFont('helvetica', 'normal'); pdf.text(new Date(`${row.month}-01T12:00:00`).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' }), 17, y);
        pdf.text(`${row.earnings} entries`, 117, y);
        pdf.setFont('helvetica', 'bold'); pdf.text(`NGN ${row.net_amount.toLocaleString('en-NG')}`, 193, y, { align: 'right' });
        y += 10; pdf.setDrawColor(238, 234, 241); pdf.line(17, y - 5, 193, y - 5);
      }
      if (!earningMonths.length) { pdf.setFont('helvetica', 'normal'); pdf.text('No released earnings in this period.', 17, y); }
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(106, 99, 113);
      pdf.text('This operational statement is not a tax invoice or proof of bank payout.', 17, 280);
      pdf.save('wehouse-partner-earnings-statement.pdf');
    } catch { toast.error('Statement could not be prepared. Please try again.'); }
  }

  if (planLoading) return <main className="mx-auto max-w-5xl px-4 py-10 text-sm text-[var(--wh-text-secondary)]" role="status">Loading Property Partner Pro…</main>;
  if (planError || !plan) return <main className="mx-auto max-w-5xl px-4 py-10 text-sm text-[var(--wh-text)]" role="alert">Property Partner Pro could not load. <button type="button" onClick={() => void loadPlan()} className="ml-2 font-semibold text-violet-500">Try again</button></main>;
  if (!plan.active) return <main className="mx-auto max-w-5xl space-y-5 px-4 pb-10 pt-2 text-[var(--wh-text)] sm:px-6">
    <section className="overflow-hidden rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)]">
      <div className="border-b border-[var(--wh-border-subtle)] p-5 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[.14em] text-violet-500">WeHouse Pro · Property Partner</p>
        <h1 className="mt-3 max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">A clearer view of every place you own.</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--wh-text-secondary)]">Portfolio stays, released income, maintenance and turnover in one workspace. Your listings and normal bookings remain available without Pro.</p>
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-3 sm:p-8">
        {([[CalendarDays,'Portfolio schedule','See upcoming stays across owned homes and hotels.'],[TrendingUp,'Income reports','Review released earnings and download a CSV.'],[ClipboardList,'Property tasks','Track maintenance and turnover per place.']] as const).map(([Icon,title,detail]) => <article key={title} className="rounded-2xl bg-[var(--wh-elevated)] p-4"><Icon size={20} className="text-violet-500"/><h2 className="mt-3 text-sm font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-[var(--wh-text-secondary)]">{detail}</p></article>)}
      </div>
    </section>
    {plan.under_review ? <p role="status" className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-[var(--wh-text)]">Your Partner Pro payment is under review after a provider refund or dispute notice. Paid tools and new checkout are paused while Finance reconciles it. Your ordinary listings and bookings are still available.</p> : plan.sales_enabled && !isNative() && plan.terms_content ? <section className="rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 sm:p-8">
      <h2 className="text-lg font-semibold">Choose access</h2><p className="mt-1 text-xs text-[var(--wh-text-secondary)]">One month or one year, paid in advance. It does not renew automatically.</p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2" role="group" aria-label="Partner Pro access period">
        {(['monthly','yearly'] as const).map(value => <button type="button" key={value} disabled={!(value === 'monthly' ? plan.monthly_price_ngn : plan.yearly_price_ngn)} aria-pressed={period === value} onClick={() => setPeriod(value)} className={`min-h-20 rounded-2xl border p-4 text-left disabled:opacity-40 ${period === value ? 'border-violet-500 bg-violet-500/10' : 'border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)]'}`}><span className="block text-sm font-semibold">{value === 'monthly' ? 'One month' : 'One year'}</span><strong className="mt-1 block text-lg">{money(value === 'monthly' ? plan.monthly_price_ngn : plan.yearly_price_ngn)}</strong></button>)}
      </div>
      <details className="mt-5 text-sm"><summary className="cursor-pointer font-semibold">Read paid access terms ({plan.terms_version})</summary><p className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap leading-6 text-[var(--wh-text-secondary)]">{plan.terms_content}</p></details>
      <label className="mt-4 flex items-start gap-3 text-xs leading-5 text-[var(--wh-text-secondary)]"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} className="mt-1 accent-violet-500"/><span>I accept the current terms for this prepaid access period.</span></label>
      <button type="button" disabled={!accepted || purchasing || !(period === 'monthly' ? plan.monthly_price_ngn : plan.yearly_price_ngn)} onClick={() => void purchase()} className="mt-4 min-h-12 w-full rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-40">{purchasing ? 'Opening Paystack…' : 'Continue to secure checkout'}</button>
    </section> : <p className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-4 text-sm text-[var(--wh-text-secondary)]">New Partner Pro purchases are not currently open. Your normal Property Partner tools remain available.</p>}
  </main>;

  return <main className="mx-auto max-w-5xl space-y-5 px-4 pb-10 pt-2 text-[var(--wh-text)] sm:px-6">
    <header className="rounded-[28px] border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] bg-[radial-gradient(ellipse_at_top_right,rgba(124,82,204,.13),transparent_60%)] p-5 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-600 dark:text-violet-300">WeHouse Pro · Property Partner</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Your portfolio</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--wh-text-secondary)]">Stays, earnings and property work in one place. Access through {new Date(plan.current_period_end || '').toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' })}.</p>
      <div className="mt-5 grid grid-cols-3 gap-2 border-t border-[var(--wh-border-subtle)] pt-4 text-center sm:gap-4">
        <Stat value={String(assets.length)} label="Owned places" />
        <Stat value={String(stays.length)} label="Stays in view" />
        <Stat value={String(tasks.filter(row => row.status === 'open').length)} label="Open tasks" />
      </div>
    </header>
    <nav aria-label="Property Pro tools" className="grid grid-cols-2 gap-1 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-1 sm:grid-cols-4">
      {([['calendar','Calendar',CalendarDays],['income','Income',TrendingUp],['tasks','Tasks',ClipboardList],['occupancy','Occupancy',BedDouble]] as const).map(([id,label,Icon]) =>
        <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-2 text-xs font-semibold sm:text-sm ${section === id ? 'bg-violet-500 text-white' : 'text-[var(--wh-text-secondary)] hover:bg-[var(--wh-interactive)]'}`}><Icon size={17} /><span>{label}</span></button>)}
    </nav>
    {loading ? <p role="status" className="py-12 text-center text-sm text-[var(--wh-text-secondary)]">Loading your portfolio…</p> : error ? <section role="alert" className="rounded-2xl border border-red-400/20 p-5 text-sm">Portfolio tools could not load. <button type="button" onClick={() => void load()} className="ml-2 text-violet-600 underline dark:text-violet-300">Try again</button></section> : <>
      {section !== 'income' && section !== 'occupancy' && <div><p className="mb-2 text-sm text-[var(--wh-text-secondary)]">Property</p>
        <WeHouseSelect value={asset} onChange={setAsset} title="Choose a property" ariaLabel="Choose property"
          className="min-h-12 w-full text-[13px] sm:max-w-md"
          options={[{value:'all',label:'All owned properties and hotels'},...assets.map(item=>({value:key(item.kind,item.id),label:`${item.title} · ${item.kind === 'home' ? 'Home' : 'Hotel'}`}))]} />
      </div>}
      {section === 'occupancy' && <PartnerProArrivalTools assets={assets} />}
      {section === 'calendar' && <section aria-label="Portfolio calendar" className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-4 sm:p-6">
        <div className="flex items-center gap-3"><CalendarDays className="text-violet-600 dark:text-violet-300" size={20} /><div><h2 className="text-lg font-semibold">Upcoming stays</h2><p className="text-xs text-[var(--wh-text-secondary)]">Confirmed or paid stays, from 30 days ago through the next 180 days.</p></div></div>
        {data?.stays_limited && <p className="mt-3 text-xs text-amber-700 dark:text-amber-200">Only the first 1,000 stays are shown. Open the property record for its complete schedule.</p>}
        {!stays.length ? <Empty>No eligible stays in this period.</Empty> : <div className="mt-4 divide-y divide-[var(--wh-border-subtle)]">{stays.map(row => <article key={`${row.kind}:${row.booking_id}`} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><p className="truncate text-sm font-semibold">{row.asset_title}</p><p className="mt-1 text-xs text-[var(--wh-text-secondary)]">{date(row.check_in)} → {date(row.check_out)} · {row.kind === 'hotel' ? 'Hotel' : 'Home'}</p></div><span className="rounded-full bg-violet-400/10 px-3 py-1 text-xs capitalize text-violet-700 dark:text-violet-200">{row.status.replaceAll('_',' ')}</span></article>)}</div>}
      </section>}
      {section === 'income' && <section aria-label="Portfolio income" className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-4 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Available earnings</h2><p className="mt-1 text-xs text-[var(--wh-text-secondary)]">Net earnings released to you. Protected and disputed money is excluded.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={exportIncome} className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--wh-border-subtle)] px-3 text-sm font-semibold"><Download size={16}/> CSV</button><button type="button" onClick={() => void exportStatement()} className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--wh-border-subtle)] px-3 text-sm font-semibold"><Download size={16}/> Statement PDF</button></div></div><div className="mt-5 rounded-2xl bg-[var(--wh-surface)] p-5"><p className="text-xs text-[var(--wh-text-secondary)]">Released in the last 12 months</p><p className="mt-2 text-3xl font-semibold tracking-tight">{money(periods.reduce((sum,row)=>sum+row.net_amount,0))}</p><p className="mt-1 text-xs text-[var(--wh-text-secondary)]">{periods.reduce((sum,row)=>sum+row.earnings,0)} earning entries</p></div>{earningMonths.length ? <div className="mt-3 divide-y divide-[var(--wh-border-subtle)]">{earningMonths.map(row => <div key={row.month} className="flex items-center justify-between gap-3 py-3 text-sm"><div><span>{new Date(`${row.month}-01T12:00:00`).toLocaleDateString('en-NG',{month:'long',year:'numeric'})}</span><p className="text-xs text-[var(--wh-text-secondary)]">{row.earnings} earning entries</p></div><strong>{money(row.net_amount)}</strong></div>)}</div> : <Empty>No released earnings in the last 12 months. Your report will appear here when earnings become available.</Empty>}</section>}
      {section === 'tasks' && <section aria-label="Property tasks" className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-4 sm:p-6"><h2 className="text-lg font-semibold">Maintenance and turnover</h2><p className="mt-1 text-xs text-[var(--wh-text-secondary)]">Track work for places you own. These tasks do not assign staff or change booking availability.</p>
        {selectedAsset ? <form onSubmit={event => { event.preventDefault(); void saveTask(); }} className="mt-5 grid gap-2 sm:grid-cols-[1fr_auto_auto]"><input aria-label="Task title" value={title} onChange={event => setTitle(event.target.value.slice(0,160))} placeholder="e.g. Inspect room after checkout" className="min-h-12 min-w-0 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-base outline-none focus:border-violet-400"/><input aria-label="Due date" type="date" value={dueOn} onChange={event => setDueOn(event.target.value)} className="min-h-12 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-base"/><button type="submit" disabled={busy || title.trim().length < 3} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-40"><Plus size={17}/> Add task</button></form> : <p className="mt-4 text-xs text-[var(--wh-text-secondary)]">Choose one property to add a task.</p>}
        {data?.tasks_limited && <p className="mt-3 text-xs text-amber-700 dark:text-amber-200">Only the first 200 tasks are shown.</p>}
        {!tasks.length ? <Empty>No tasks here yet.</Empty> : <div className="mt-5 divide-y divide-[var(--wh-border-subtle)]">{tasks.map(row => <article key={row.id} className="flex items-center gap-3 py-3"><button type="button" disabled={busy} onClick={() => void saveTask(row)} aria-label={row.status === 'open' ? `Complete ${row.title}` : `Reopen ${row.title}`} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border ${row.status === 'done' ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-700 dark:text-emerald-200' : 'border-[var(--wh-border-subtle)]'}`}>{row.status === 'done' && <Check size={18}/>}</button><div className="min-w-0"><p className={`break-words text-sm ${row.status === 'done' ? 'text-[var(--wh-text-secondary)] line-through' : 'font-medium'}`}>{row.title}</p><p className="mt-1 text-xs text-[var(--wh-text-secondary)]">{assets.find(item => item.kind === row.asset_kind && item.id === row.asset_id)?.title || 'Owned property'}{row.due_on ? ` · Due ${date(row.due_on)}` : ''}</p></div></article>)}</div>}
      </section>}
    </>}
  </main>;
}
function Stat({ value, label }: { value: string; label: string }) { return <div><p className="text-xl font-semibold sm:text-2xl">{value}</p><p className="mt-1 text-[11px] text-[var(--wh-text-secondary)]">{label}</p></div>; }
function Empty({ children }: { children: React.ReactNode }) { return <p className="py-12 text-center text-sm text-[var(--wh-text-secondary)]">{children}</p>; }
