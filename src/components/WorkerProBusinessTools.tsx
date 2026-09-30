import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import WeHouseChoice from '@/components/WeHouseChoice';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Job = { id: string; booking_code: string | null; service_type: string | null; scheduled_date: string; status: string; customer_name: string };
type Customer = { customer_id: string; customer_name: string; completed_jobs: number; last_job_at: string; last_service: string | null; note: string };
type Package = { id: string; title: string; description: string; price_ngn: number; active: boolean; created_at: string };
type Reminder = { id: string; booking_id: string; due_at: string; note: string; done_at: string | null };
type Receipt = { booking_id: string; booking_code: string | null; service_type: string | null; customer_name: string; total_ngn: number; worker_earnings_ngn: number; completed_at: string; note: string };
type Book = { schedule: Job[]; customers: Customer[]; packages: Package[]; reminders: Reminder[]; receipts: Receipt[] };
type Tab = 'schedule' | 'customers' | 'packages' | 'receipts';
const empty = { schedule: [], customers: [], packages: [], reminders: [], receipts: [] } as Book;
const money = (value: number) => `₦${Number(value || 0).toLocaleString('en-NG')}`;
const label = (value: string) => new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
const card = 'rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-4';
const field = 'min-h-11 w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-surface)] px-3 py-2 text-sm text-[var(--wh-text)]';
const action = 'min-h-11 rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-40';

export default function WorkerProBusinessTools({ profile }: { profile: Profile }) {
  const [tab, setTab] = useState<Tab>('schedule');
  const [book, setBook] = useState<Book>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [editingPackage, setEditingPackage] = useState<string | null>(null);
  const [reminderJob, setReminderJob] = useState('');
  const [reminderAt, setReminderAt] = useState('');
  const [reminderNote, setReminderNote] = useState('');
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const alerted = useRef(new Set<string>());
  const load = useCallback(async () => {
    setLoading(true);
    let data: Book | null = null;
    let failure = false;
    try {
      const result = await supabase.rpc('get_my_worker_pro_business');
      data = result.data as Book | null;
      failure = Boolean(result.error);
    } catch { failure = true; }
    if (failure || !data || !['schedule', 'customers', 'packages', 'reminders', 'receipts'].every(key => Array.isArray(data[key as keyof Book]))) {
      setBook(empty); setError(true);
    } else {
      setBook(data as Book); setError(false);
      setDraftNotes(Object.fromEntries([
        ...(data.customers as Customer[]).map(row => [`customer:${row.customer_id}`, row.note || ''] as const),
        ...(data.receipts as Receipt[]).map(row => [`receipt:${row.booking_id}`, row.note || ''] as const),
      ]));
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load, profile.user_id]);
  useEffect(() => {
    const showDue = () => {
      for (const reminder of book.reminders) {
        if (!reminder.done_at && new Date(reminder.due_at).getTime() <= Date.now() && !alerted.current.has(reminder.id)) {
          alerted.current.add(reminder.id);
          toast.message('Work reminder', { description: reminder.note });
        }
      }
    };
    showDue();
    const timer = window.setInterval(showDue, 60_000);
    return () => window.clearInterval(timer);
  }, [book.reminders]);
  async function write(name: string, args: Record<string, unknown>, success: string) {
    if (busy) return false;
    setBusy(true);
    try {
      const result = await supabase.rpc(name, args);
      if (result.error) throw result.error;
      toast.success(success); await load();
      return true;
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'Could not save. Try again.');
      return false;
    } finally { setBusy(false); }
  }
  function editPackage(pkg: Package) {
    setEditingPackage(pkg.id); setTitle(pkg.title); setDescription(pkg.description); setPrice(String(pkg.price_ngn));
  }
  async function downloadReceipt(row: Receipt) {
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      pdf.setFillColor(27, 22, 38); pdf.rect(0, 0, 210, 43, 'F');
      pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13);
      pdf.text('WEHOUSE  /  WORKS', 17, 19); pdf.setFontSize(21); pdf.text('Service receipt', 17, 32);
      pdf.setTextColor(38, 32, 45); pdf.setFontSize(12); pdf.text(profile.full_name || profile.username || 'Service Worker', 17, 58);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
      pdf.text(`Job #${row.booking_code || row.booking_id.slice(0,8)}  ·  ${label(row.completed_at)}`, 17, 69);
      pdf.text(`Customer: ${row.customer_name}`, 17, 80);
      pdf.text(`Service: ${row.service_type || 'WeHouse service'}`, 17, 91);
      pdf.setDrawColor(225, 219, 232); pdf.line(17, 100, 193, 100);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15);
      pdf.text('Completed job amount', 17, 116);
      pdf.text(`NGN ${Number(row.total_ngn).toLocaleString('en-NG')}`, 193, 116, { align: 'right' });
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
      const note = row.note.trim();
      if (note) pdf.text(pdf.splitTextToSize(`Worker note: ${note}`, 175), 17, 136);
      pdf.setFontSize(8); pdf.setTextColor(107, 99, 113);
      pdf.text('Based on a completed, released WeHouse job. Not a tax invoice or bank payout confirmation.', 17, 278);
      pdf.save(`wehouse-service-${row.booking_code || row.booking_id.slice(0,8)}.pdf`);
    } catch { toast.error('Receipt PDF could not be prepared.'); }
  }
  const tabs: Array<[Tab,string]> = [['schedule','Schedule'],['customers','Customers'],['packages','Packages'],['receipts','Receipts']];
  return <section aria-label="Worker Pro business tools" className="space-y-4">
    <div role="group" aria-label="Business tools" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tabs.map(([id,name]) => <button key={id} type="button" aria-pressed={tab===id} onClick={() => setTab(id)}
        className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${tab===id ? 'bg-violet-500 text-white' : 'border border-[var(--wh-border-subtle)] text-[var(--wh-text-secondary)]'}`}>{name}</button>)}
    </div>
    {loading ? <p role="status" className="py-6 text-sm">Loading your business tools…</p> : error ?
      <div role="alert" className={card}>Business tools could not load. <button type="button" onClick={() => void load()} className="ml-2 underline">Try again</button></div> : <>
      {tab==='schedule' && <div className="space-y-4">
        <div className={card}><h3 className="text-base font-semibold">Upcoming work</h3><p className="mt-1 text-xs text-[var(--wh-text-secondary)]">Confirmed jobs use their existing scheduled date. Reminders appear while this business-tools screen is open. They are not background, email or push notifications.</p>
          {book.schedule.length ? <div className="mt-3 divide-y divide-[var(--wh-border-subtle)]">{book.schedule.map(job => <div key={job.id} className="py-3 text-sm"><strong>{job.service_type || 'Service job'} · #{job.booking_code || job.id.slice(0,8)}</strong><p className="text-[var(--wh-text-secondary)]">{job.customer_name} · {label(job.scheduled_date)} · {job.status.replaceAll('_',' ')}</p></div>)}</div> : <p className="mt-4 text-sm text-[var(--wh-text-secondary)]">No scheduled jobs in this period.</p>}</div>
        <form onSubmit={event => { event.preventDefault(); if (!Number.isFinite(new Date(reminderAt).getTime())) return; void write('save_my_worker_pro_reminder',{p_booking_id:reminderJob,p_due_at:new Date(reminderAt).toISOString(),p_note:reminderNote,p_done:false},'Reminder saved').then(saved=>{ if (saved) { setReminderAt(''); setReminderNote(''); } }); }} className={card}>
          <h3 className="text-base font-semibold">Set a work reminder</h3><div className="mt-3 grid gap-3">
            <label className="text-sm">Job<WeHouseChoice aria-label="Reminder job" value={reminderJob} onChange={event=>setReminderJob(event.target.value)} className={`${field} mt-1`}><option value="">Choose a job</option>{book.schedule.map(job=><option key={job.id} value={job.id}>{job.service_type || 'Service'} · #{job.booking_code || job.id.slice(0,8)}</option>)}</WeHouseChoice></label>
            <label className="text-sm">When<input required type="datetime-local" value={reminderAt} onChange={event=>setReminderAt(event.target.value)} className={`${field} mt-1`}/></label>
            <label className="text-sm">What to remember<input required minLength={3} maxLength={240} value={reminderNote} onChange={event=>setReminderNote(event.target.value)} className={`${field} mt-1`}/></label>
            <button type="submit" disabled={busy || !reminderJob || !reminderAt} className={action}>Save reminder</button>
          </div>
        </form>
        {book.reminders.filter(row=>!row.done_at).map(row=><div key={row.id} className={card}><p className="text-sm font-semibold">{row.note}</p><p className="mt-1 text-xs text-[var(--wh-text-secondary)]">{new Date(row.due_at).toLocaleString()}</p><button type="button" disabled={busy} onClick={()=>void write('save_my_worker_pro_reminder',{p_booking_id:row.booking_id,p_due_at:row.due_at,p_note:row.note,p_done:true},'Reminder completed')} className="mt-2 min-h-11 text-sm font-semibold text-violet-600 dark:text-violet-300">Mark done</button></div>)}
      </div>}
      {tab==='customers' && <div className="space-y-3"><p className="text-sm text-[var(--wh-text-secondary)]">Customers who allowed a private record after a completed WeHouse job. They can revoke access in their booking; revoking removes your note.</p>
        {book.customers.length ? book.customers.map(row=><article key={row.customer_id} className={card}><div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold">{row.customer_name}</h3><span className="text-xs text-[var(--wh-text-secondary)]">{row.completed_jobs} completed {row.completed_jobs===1?'job':'jobs'}</span></div><p className="mt-1 text-xs text-[var(--wh-text-secondary)]">Last job {label(row.last_job_at)} · {row.last_service || 'Service'}</p><textarea aria-label={`Private note for ${row.customer_name}`} maxLength={1000} value={draftNotes[`customer:${row.customer_id}`] ?? row.note} onChange={event=>setDraftNotes(notes=>({...notes,[`customer:${row.customer_id}`]:event.target.value}))} rows={2} className={`${field} mt-3`}/><button type="button" disabled={busy} onClick={()=>void write('save_my_worker_pro_customer_note',{p_customer_id:row.customer_id,p_note:draftNotes[`customer:${row.customer_id}`] ?? row.note},'Customer note saved')} className={`${action} mt-2`}>Save note</button></article>) : <p className={card}>Consenting repeat customers will appear here after a completed job.</p>}
      </div>}
      {tab==='packages' && <div className="space-y-3"><p className="text-sm text-[var(--wh-text-secondary)]">Publish up to six service packages on your public Worker profile. A package does not replace the customer’s normal booking and protected payment flow.</p>
        <form onSubmit={event=>{event.preventDefault();void write('save_my_worker_pro_package',{p_id:editingPackage,p_title:title,p_description:description,p_price_ngn:Number(price),p_active:true},'Package saved').then(saved=>{if(saved){setEditingPackage(null);setTitle('');setDescription('');setPrice('');}});}} className={`${card} space-y-3`}>
          <h3 className="text-base font-semibold">{editingPackage ? 'Edit service package' : 'New service package'}</h3>
          <label className="block text-sm">Title<input required minLength={3} maxLength={80} value={title} onChange={event=>setTitle(event.target.value)} className={`${field} mt-1`}/></label>
          <label className="block text-sm">What is included<textarea required minLength={10} maxLength={500} rows={3} value={description} onChange={event=>setDescription(event.target.value)} className={`${field} mt-1`}/></label>
          <label className="block text-sm">Starting price (₦)<input required type="number" min="0" max="10000000" step="0.01" value={price} onChange={event=>setPrice(event.target.value)} className={`${field} mt-1`}/></label>
          <div className="flex gap-2"><button type="submit" disabled={busy || !title || !price} className={action}>Save package</button>{editingPackage && <button type="button" onClick={()=>{setEditingPackage(null);setTitle('');setDescription('');setPrice('');}} className="min-h-11 rounded-xl border px-4 text-sm">Cancel</button>}</div>
        </form>
        {book.packages.map(pkg=><article key={pkg.id} className={card}><div className="flex justify-between gap-2"><h3 className="font-semibold">{pkg.title}</h3><strong>{money(pkg.price_ngn)}</strong></div><p className="mt-2 whitespace-pre-wrap text-sm text-[var(--wh-text-secondary)]">{pkg.description}</p><p className="mt-2 text-xs">{pkg.active?'Visible on profile':'Hidden from profile'}</p><div className="mt-2 flex gap-4"><button type="button" onClick={()=>editPackage(pkg)} className="min-h-11 text-sm font-semibold text-violet-600 dark:text-violet-300">Edit</button><button type="button" disabled={busy} onClick={()=>void write('save_my_worker_pro_package',{p_id:pkg.id,p_title:pkg.title,p_description:pkg.description,p_price_ngn:pkg.price_ngn,p_active:!pkg.active},pkg.active?'Package hidden':'Package published')} className="min-h-11 text-sm font-semibold">{pkg.active?'Hide':'Publish'}</button></div></article>)}
      </div>}
      {tab==='receipts' && <div className="space-y-3"><p className="text-sm text-[var(--wh-text-secondary)]">Branded service receipts use completed, released jobs. Save an optional Worker note before downloading. This does not alter the WeHouse payment record.</p>
        {book.receipts.length ? book.receipts.map(row=><article key={row.booking_id} className={card}><div className="flex justify-between gap-2"><div><h3 className="text-sm font-semibold">#{row.booking_code || row.booking_id.slice(0,8)} · {row.service_type || 'Service'}</h3><p className="text-xs text-[var(--wh-text-secondary)]">{row.customer_name} · {label(row.completed_at)}</p></div><strong>{money(row.total_ngn)}</strong></div><textarea aria-label={`Receipt note for ${row.booking_code || row.booking_id.slice(0,8)}`} maxLength={600} value={draftNotes[`receipt:${row.booking_id}`] ?? row.note} onChange={event=>setDraftNotes(notes=>({...notes,[`receipt:${row.booking_id}`]:event.target.value}))} rows={2} placeholder="Optional work details or aftercare" className={`${field} mt-3`}/><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={()=>void write('save_my_worker_pro_receipt_note',{p_booking_id:row.booking_id,p_note:draftNotes[`receipt:${row.booking_id}`] ?? row.note},'Receipt note saved')} className={action}>Save note</button><button type="button" onClick={()=>void downloadReceipt(row)} className="min-h-11 rounded-xl border border-[var(--wh-border)] px-4 text-sm font-semibold">Download PDF</button></div></article>) : <p className={card}>Released jobs will appear here for receipts.</p>}
      </div>}
    </>}
    <p className="text-xs leading-5 text-[var(--wh-text-secondary)]">Pro support cases submitted through Account → Help receive priority routing. Safety and payment issues remain ahead of ordinary plan support.</p>
  </section>;
}
