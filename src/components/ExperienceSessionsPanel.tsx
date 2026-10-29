import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import ExperienceSessionDiscount from '@/components/ExperienceDiscountControls';
import type { ExperienceActivity } from '@/lib/experienceActivities';
import { archiveExperienceSession, currencyScale, listExperienceSessions, saveExperienceSession, sessionCurrency, sessionPriceMinor, type ExperienceSession } from '@/lib/experienceSessions';
import { dateTimeInputInZone, formatMoney, zonedInputToISO } from '@/lib/regional';

const control = 'min-h-11 w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] px-3 py-2 text-sm dark:[color-scheme:dark]';
export default function ExperienceSessionsPanel({ activity, onDirtyChange, review = false }: { activity: ExperienceActivity; onDirtyChange: (dirty: boolean) => void; review?: boolean }) {
  const [rows, setRows] = useState<ExperienceSession[]>([]), [currency, setCurrency] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ExperienceSession | null>(null), [start, setStart] = useState(''), [capacity, setCapacity] = useState(''), [price, setPrice] = useState('');
  const [discountSession,setDiscountSession]=useState<string|null>(null),[discountDirty,setDiscountDirty]=useState(false);
  const [hasMore, setHasMore] = useState(false), [attempt, setAttempt] = useState(0), [baseline, setBaseline] = useState('["","",""]');
  const cursor = useRef<ExperienceSession | undefined>(undefined);
  const lock = useRef(false), generation = useRef(0), requestId = useRef(crypto.randomUUID());
  const dirty = JSON.stringify([start, capacity, price]) !== baseline||discountDirty;
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const request = ++generation.current; setLoading(true); setError(''); setRows([]); setCurrency('');
    void Promise.all([listExperienceSessions(activity.id, undefined, review ? activity.revision : undefined), review ? Promise.resolve('') : sessionCurrency(activity.details.country_code)])
      .then(([items, code]) => { if (request === generation.current) { setRows(items); cursor.current=items.at(-1); setHasMore(items.length === 20); setCurrency(code); } })
      .catch(cause => { if (request === generation.current) setError(message(cause)); })
      .finally(() => { if (request === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [activity.id, activity.revision, activity.details.country_code, review, attempt]);
  function reset() { setSelected(null); requestId.current = crypto.randomUUID(); setStart(''); setCapacity(''); setPrice(''); setBaseline('["","",""]'); }
  async function save() {
    if (lock.current || !currency || !editable) return;
    lock.current = true; setBusy(true); setError(''); setNotice(''); const request = generation.current;
    try {
      const instant = zonedInputToISO(start, activity.details.timezone);
      if (dateTimeInputInZone(new Date(instant), activity.details.timezone) !== start) throw new Error('This local time does not exist. Choose another time.');
      const row = await saveExperienceSession(activity, selected?.id || requestId.current, selected?.revision || 0, instant, Number(capacity), sessionPriceMinor(price, currency), currency);
      if (request !== generation.current) return;
      setRows(previous => [row, ...previous.filter(item => item.id !== row.id)].sort((a,b) => Date.parse(a.starts_at)-Date.parse(b.starts_at) || a.id.localeCompare(b.id)));
      reset(); setNotice('Session saved privately. It is not open for bookings.');
    } catch (cause) { if (request === generation.current) setError(message(cause)); }
    finally { lock.current = false; if (request === generation.current) setBusy(false); }
  }
  async function archive(row: ExperienceSession) {
    if (lock.current || !editable) return; lock.current = true; setBusy(true); setError(''); const request = generation.current;
    try { await archiveExperienceSession(row); if (request !== generation.current) return; setRows(previous => previous.filter(item => item.id !== row.id)); setNotice('Prepared session archived.'); }
    catch (cause) { if (request === generation.current) setError(message(cause)); }
    finally { lock.current = false; if (request === generation.current) setBusy(false); }
  }
  async function more() {
    if (lock.current || !cursor.current) return; lock.current = true; setBusy(true); setError(''); const request = generation.current;
    try { const next = await listExperienceSessions(activity.id, cursor.current, review ? activity.revision : undefined); if (request !== generation.current) return; cursor.current=next.at(-1); setRows(previous => [...previous, ...next.filter(row => !previous.some(item => item.id === row.id))]); setHasMore(next.length === 20); }
    catch (cause) { if (request === generation.current) setError(message(cause)); }
    finally { lock.current = false; if (request === generation.current) setBusy(false); }
  }
  function edit(row: ExperienceSession) {
    if (!editable) return;
    const values = [dateTimeInputInZone(new Date(row.starts_at), row.timezone), String(row.capacity), String(row.price_minor/currencyScale(row.currency))];
    setSelected(row); setStart(values[0]); setCapacity(values[1]); setPrice(values[2]); setBaseline(JSON.stringify(values)); setNotice('');
  }
  const editable = !review && ['draft','changes_required','withdrawn'].includes(activity.status);
  return <section aria-label="Experience sessions" className="space-y-4 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4">
    <header><h3 className="font-semibold">Dates and prices</h3><p className="mt-1 text-sm leading-6 text-[var(--wh-text-secondary)]">{review ? 'Review the dates, capacity and standard price prepared before this application was submitted.' : activity.status === 'submitted' ? 'Dates and standard prices are locked during review. Withdraw the application before changing them.' : 'Prepare individual sessions for this activity. Approved sessions can have an optional discount.'} Times use {activity.details.timezone}. Dates become bookable while the approved activity is published.</p></header>
    {loading && <p role="status">Loading prepared sessions...</p>}
    {error && <div role="alert" className="space-y-2 text-sm text-red-700 dark:text-red-300"><p>{error}</p><Button variant="outline" type="button" disabled={busy||dirty} onClick={() => setAttempt(n=>n+1)}>Refresh sessions</Button></div>}
    {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
    {!loading && currency && editable && <form onSubmit={e=>{e.preventDefault();void save();}} className="space-y-3">
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm"><span>Start date and time</span><input required type="datetime-local" className={control} value={start} onChange={e=>setStart(e.target.value)}/></label>
        <label className="space-y-1 text-sm"><span>Places available</span><input required type="number" min={1} max={activity.details.max_group_size||100} step={1} className={control} value={capacity} onChange={e=>setCapacity(e.target.value)}/></label>
        <label className="space-y-1 text-sm"><span>Price per participant ({currency})</span><input required inputMode="decimal" className={control} value={price} onChange={e=>setPrice(e.target.value)}/></label>
      </fieldset>
      <p className="text-xs text-[var(--wh-text-secondary)]">Duration: {activity.details.duration_minutes ?? 'not set'} minutes. Save activity changes before preparing sessions.</p>
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy}>{busy?'Saving...':selected?'Save session changes':'Save prepared session'}</Button>{(selected||dirty)&&<Button type="button" variant="outline" disabled={busy} onClick={reset}>Discard session edits</Button>}</div>
    </form>}
    {!loading && !error && rows.length===0 && <p className="text-sm text-[var(--wh-text-secondary)]">No prepared sessions yet.</p>}
    <ul className="divide-y divide-[var(--wh-border)]">{rows.map(row=><li key={row.id} className="space-y-2 py-4">
      <p className="font-medium">{new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:row.timezone}).format(new Date(row.starts_at))} ({row.timezone})</p>
      <p className="text-sm text-[var(--wh-text-secondary)]">{row.capacity} places · {formatMoney(row.price_minor/currencyScale(row.currency),{currency:row.currency,maxFraction:Math.log10(currencyScale(row.currency))})} per participant · {activity.status==='approved'?'Approved date':'Private'}</p>
      {row.activity_revision!==(activity.status==='approved'?(activity.approved_from_revision||activity.revision)-1:activity.status==='submitted'?activity.revision-1:activity.revision)&&<p className="text-sm text-amber-800 dark:text-amber-200">Activity changed since this date was prepared. {editable?'Review and save the session again.':'The host must withdraw the application and update this session before publication.'}</p>}
      {editable&&<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy||dirty} onClick={()=>edit(row)}>Edit session</Button><Button type="button" variant="outline" disabled={busy||dirty} onClick={()=>void archive(row)}>Archive prepared session</Button></div>}
      {!review&&activity.status==='approved'&&Date.parse(row.starts_at)>Date.now()&&<Button type="button" variant="outline" disabled={busy||dirty} onClick={()=>setDiscountSession(current=>current===row.id?null:row.id)}>{discountSession===row.id?'Close session discount':'Manage session discount'}</Button>}
      {discountSession===row.id&&!review&&activity.status==='approved'&&<ExperienceSessionDiscount key={row.id} sessionId={row.id} onDirtyChange={setDiscountDirty}/>}
    </li>)}</ul>
    {hasMore&&<Button type="button" variant="outline" disabled={busy||dirty} onClick={()=>void more()}>More sessions</Button>}
  </section>;
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : (cause as {message?:string})?.message || 'Session action could not be confirmed.'; }
