import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { completeApartmentTenancy, confirmApartmentHandover } from '@/lib/supabase/reservations';
import InlineFilterChips from '@/components/InlineFilterChips';
import WeHouseSelect from '@/components/WeHouseSelect';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useConfirm } from '@/hooks/useConfirm';

type Filter = 'reserved' | 'occupied' | 'available' | 'maintenance' | 'closed' | 'all';
const STATUS: Record<string, { label: string; cls: string }> = {
  available: { label: 'Available', cls: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' },
  reserved: { label: 'Reserved', cls: 'border-amber-500/20 bg-amber-500/10 text-amber-300' },
  occupied: { label: 'Occupied', cls: 'border-violet-500/20 bg-violet-500/10 text-violet-300' },
  maintenance: { label: 'Maintenance', cls: 'border-orange-500/20 bg-orange-500/10 text-orange-300' },
  closed: { label: 'Closed', cls: 'border-white/10 bg-white/[.04] text-[#8B909E]' },
};

export default function HousingOperationsWorkspace() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<any | null>(null);
  const [bookingCode, setBookingCode] = useState('');
  const [search, setSearch] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [checkingCode, setCheckingCode] = useState(false);
  const [verifiedBooking, setVerifiedBooking] = useState<any | null>(null);
  const [verifiedMoveInCode, setVerifiedMoveInCode] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_my_housing_operations');
    if (error) toast.error(error.message);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function verifyCode() {
    const code = bookingCode.trim().toUpperCase();
    if (!code) { setLookupError('Enter the customer booking code.'); return; }
    setLookupError('');
    setCheckingCode(true);
    const { data, error } = await supabase.rpc('verify_branch_booking_code', { p_code: code });
    setCheckingCode(false);
    if (error) { setVerifiedBooking(null); setVerifiedMoveInCode(null); setLookupError(error.message); return; }
    if (!data) { setVerifiedBooking(null); setVerifiedMoveInCode(null); setLookupError('No booking with that code was found in this branch.'); return; }
    setVerifiedBooking(data);
    setVerifiedMoveInCode(null);
  }

  const filtered = useMemo(() => rows.filter(row => {
    if (filter !== 'all' && row.listing_status !== filter) return false;
    const query=search.trim().toLowerCase();
    if(!query)return true;
    return [row.listing_title,row.customer_name,row.customer_username,row.address,row.lga,row.state,row.listing_status,row.reservation_status,row.rent_payment_status].filter(Boolean).join(' ').toLowerCase().includes(query);
  }), [rows, filter, search]);
  const verifiedHousingRow = useMemo(() => {
    if (verifiedBooking?.kind !== 'housing') return null;
    return rows.find(row => String(row.current_reservation_id) === String(verifiedBooking.reservation_id)) || null;
  }, [rows, verifiedBooking]);

  if (selected) return <HousingCase row={selected} bookingCode={verifiedMoveInCode} back={() => { setSelected(null); setVerifiedBooking(null); setVerifiedMoveInCode(null); setBookingCode(''); void load(); }} />;

  return <div className="space-y-5">
    <div><h3 className="text-base font-bold">Booking lookup</h3><p className="mt-1 text-[10px] leading-5 text-[#707687]">Verify a customer’s booking before handover, or search current arrivals and tenancies. Publication work stays in Properties.</p></div>

    <section className="rounded-2xl border border-violet-500/10 bg-violet-500/[.03] p-4">
      <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-violet-300">Exact booking verification</p>
      <h4 className="mt-1 text-sm font-semibold">Enter the code shown by the customer</h4>
      <p className="mt-1 text-[9px] leading-5 text-[#747A8B]">The code opens one matching booking in this branch. Compare the displayed customer, property, status and payment before handing over access. It does not confirm ownership or publish a property.</p>
      <div className="mt-3 flex gap-2"><input value={bookingCode} onChange={event => { setBookingCode(event.target.value.toUpperCase().replace(/\s/g,'')); setVerifiedBooking(null); setVerifiedMoveInCode(null); setLookupError(''); }} aria-label="WeHouse booking code" autoComplete="off" placeholder="Enter booking code" maxLength={14} className="h-11 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#11151E] px-3 text-xs font-semibold uppercase tracking-wider outline-none focus:border-violet-500/40"/><button disabled={checkingCode} onClick={() => void verifyCode()} className="h-11 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-50">{checkingCode ? 'Checking…' : 'Verify'}</button></div>
      {lookupError&&<p className="mt-2 rounded-xl bg-red-500/[.06] px-3 py-2 text-[9px] leading-5 text-red-300" role="alert">{lookupError}</p>}
      {verifiedBooking && <div className="mt-3 rounded-xl border border-emerald-500/15 bg-emerald-500/[.04] p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold tracking-wide text-emerald-300">{verifiedBooking.code}</p><p className="mt-1 text-[10px] font-semibold">{verifiedBooking.property_name}</p></div><span className="rounded-full border border-emerald-500/20 px-2 py-1 text-[8px] capitalize text-emerald-300">{verifiedBooking.kind}</span></div><div className="mt-3 grid grid-cols-2 gap-2"><Info label="Customer" value={verifiedBooking.customer_name || '—'} /><Info label="Phone" value={verifiedBooking.customer_phone || '—'} /><Info label="Booking status" value={String(verifiedBooking.status || '—').replace(/_/g,' ')} /><Info label="Payment" value={String(verifiedBooking.payment_status || '—').replace(/_/g,' ')} /></div>{verifiedBooking.kind === 'housing' && verifiedHousingRow && <button type="button" onClick={() => { setVerifiedMoveInCode(String(verifiedBooking.code)); setSelected(verifiedHousingRow); }} className="mt-3 h-11 w-full rounded-xl bg-emerald-500 text-[10px] font-semibold text-[#03100B]">Continue to verified property handover</button>}{verifiedBooking.kind === 'housing' && !verifiedHousingRow && <p className="mt-3 rounded-xl bg-amber-500/[.06] p-3 text-[9px] leading-5 text-amber-200">This booking is valid, but its property is not in the current operations list. Refresh the desk before confirming handover.</p>}{verifiedBooking.kind === 'hotel' && <p className="mt-3 text-[9px] text-[#8A909F]">Stay: {verifiedBooking.check_in ? new Date(verifiedBooking.check_in).toLocaleDateString() : '—'} → {verifiedBooking.check_out ? new Date(verifiedBooking.check_out).toLocaleDateString() : '—'} · {verifiedBooking.guest_count || 1} guest(s)</p>}</div>}
    </section>

    <section className="space-y-3 border-t border-white/[.06] pt-4"><div className="flex items-end justify-between gap-3"><div><h4 className="text-sm font-semibold">Current arrivals and tenancies</h4><p className="mt-1 text-[9px] text-[#707687]">Search by customer, property, area or a real stored status.</p></div><span className="shrink-0 text-[9px] text-[#656B7D]">{rows.length} record{rows.length===1?'':'s'}</span></div><div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#606576]">⌕</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search customer or property" className="h-11 w-full rounded-2xl border border-white/[.07] bg-[#141820] pl-9 pr-3 text-xs outline-none focus:border-violet-500/35"/></div></section>
    <InlineFilterChips value={filter} options={[{value:'all',label:'All'},{value:'available',label:'Available'},{value:'reserved',label:'Reserved'},{value:'occupied',label:'Occupied'},{value:'maintenance',label:'Maintenance'},{value:'closed',label:'Closed'}]} onChange={(value)=>setFilter(value as Filter)} ariaLabel="Show properties by lifecycle"/>
    {loading ? <Loading /> : filtered.length === 0 ? <Empty /> : <div className="space-y-2">{filtered.map(row => <button key={row.listing_id} onClick={() => { setVerifiedMoveInCode(null); setSelected(row); }} className="w-full rounded-2xl border border-white/[.06] bg-[#10131B] p-4 text-left hover:border-violet-500/20"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-semibold">{row.listing_title}</p><p className="mt-1 truncate text-[9px] text-[#686D7E]">{[row.address,row.lga,row.state].filter(Boolean).join(', ')}</p></div><Badge status={row.listing_status} /></div>{row.current_reservation_id && <div className="mt-3 flex items-center justify-between border-t border-white/[.05] pt-3"><div><p className="text-[9px] text-[#626778]">{row.customer_name || 'Customer'}</p><p className="mt-0.5 text-[8px] capitalize text-violet-300">{String(row.reservation_status || '').replace(/_/g,' ')} · rent {String(row.rent_payment_status || 'not started').replace(/_/g,' ')}</p></div>{row.tenancy_end_date && <p className="text-[8px] text-[#777C8C]">Ends {new Date(row.tenancy_end_date).toLocaleDateString()}</p>}</div>}</button>)}</div>}
  </div>;
}

function HousingCase({ row, bookingCode, back }: { row: any; bookingCode: string | null; back: () => void }) {
  const { ask, dialogProps } = useConfirm();
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [nextStatus, setNextStatus] = useState<'maintenance' | 'available' | 'closed'>('maintenance');
  const [busy, setBusy] = useState(false);
  const rentReady = ['paid','upfront_paid'].includes(String(row.rent_payment_status || ''));
  const canMoveIn = Boolean(row.current_reservation_id && row.reservation_status === 'ready_for_move_in' && row.reservation_fee_paid && rentReady);

  async function activate() {
    if (!bookingCode) return toast.error('Verify the customer booking code before confirming handover');
    if (!await ask({title:'Confirm property handover?',description:`Booking code ${bookingCode} matches ${row.customer_name || 'this customer'} and this property. Confirm only after access has been handed over.`,confirmLabel:'Confirm handover',variant:'info'})) return;
    setBusy(true);
    const { error } = await confirmApartmentHandover(bookingCode, startDate);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Tenancy activated. Property is now Occupied.');
    back();
  }

  async function complete() {
    if (!row.current_reservation_id) return;
    if (!await ask({title:'Complete tenancy?',description:`Confirm the customer has moved out. The property will move to ${nextStatus}.`,confirmLabel:'Complete tenancy',variant:'warning'})) return;
    setBusy(true);
    const { error } = await completeApartmentTenancy(row.current_reservation_id, nextStatus);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Tenancy completed. Property moved to ${nextStatus}.`);
    back();
  }

  return <div className="space-y-4">
    <button onClick={back} className="text-[10px] font-semibold text-violet-300">← Back to live housing</button>
    <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-base font-bold">{row.listing_title}</h3><p className="mt-1 text-[10px] text-[#6D7283]">{[row.address,row.lga,row.state].filter(Boolean).join(', ')}</p></div><Badge status={row.listing_status} /></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Info label="Annual rent" value={`₦${Number(row.annual_rent || 0).toLocaleString()}`} /><Info label="Property" value={String(row.sub_type || row.property_type || 'apartment').replace(/_/g,' ')} /><Info label="Reservation" value={row.reservation_status ? String(row.reservation_status).replace(/_/g,' ') : 'None'} /><Info label="Reservation fee" value={row.reservation_fee_paid ? 'Confirmed' : 'Not paid'} /></div></section>

    {row.current_reservation_id && <section className="rounded-2xl border border-violet-500/10 bg-violet-500/[.035] p-4"><p className="text-[9px] font-semibold uppercase tracking-wide text-violet-300">Current resident workflow</p><h4 className="mt-2 text-sm font-semibold">{row.customer_name || 'Customer'}</h4>{row.customer_username && <p className="mt-1 text-[9px] text-[#6C7182]">@{row.customer_username}</p>}<div className="mt-3 grid grid-cols-2 gap-2"><Info label="Tenure" value={`${row.rental_plan_years || 1} year${Number(row.rental_plan_years || 1) === 1 ? '' : 's'}`} /><Info label="Rent" value={String(row.rent_payment_status || 'not_started').replace(/_/g,' ')} /><Info label="Year 1 due" value={`₦${Number(row.upfront_rent_required || row.annual_rent || 0).toLocaleString()}`} /><Info label="Future plan" value={Number(row.rental_plan_years || 1) > 1 ? 'Months 5–12' : 'Not needed'} /></div>{Number(row.rental_plan_years || 1) > 1 && <p className="mt-3 text-[9px] leading-5 text-emerald-300">Year 1 is paid in full. After move-in, the customer gets four full months without future-year contributions; months 5–12 then build the next year’s rent gradually. The cycle repeats for each additional year.</p>}{row.hold_expires_at && <p className="mt-3 text-[9px] text-amber-300">Reservation hold expires {new Date(row.hold_expires_at).toLocaleString()}</p>}{row.tenancy_start_date && <div className="mt-3 rounded-xl bg-white/[.025] p-3"><SmallRow label="Started" value={new Date(row.tenancy_start_date).toLocaleDateString()} /><SmallRow label="Tenancy ends" value={row.tenancy_end_date ? new Date(row.tenancy_end_date).toLocaleDateString() : '—'} /><SmallRow label="Grace until" value={row.move_out_grace_until ? new Date(row.move_out_grace_until).toLocaleDateString() : '—'} /></div>}</section>}

    {row.reservation_status === 'ready_for_move_in' && !rentReady && <section className="rounded-2xl border border-amber-500/15 bg-amber-500/[.035] p-4"><h4 className="text-sm font-semibold text-amber-300">Waiting for verified Year 1 rent</h4><p className="mt-1 text-[10px] leading-5 text-[#85808A]">The inspection passed, but Operations cannot activate occupancy until the full first-year rent is verified server-side.</p></section>}

    {canMoveIn && bookingCode && <section className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[.035] p-4"><h4 className="text-sm font-semibold text-emerald-300">Confirm property handover</h4><p className="mt-1 text-[10px] leading-5 text-[#788090]">Booking code <span className="font-bold text-emerald-200">{bookingCode}</span> has been matched to this customer and property. Confirm only after the customer receives access.</p><label className="mt-3 block"><span className="mb-1 block text-[9px] text-[#757B8C]">Move-in date</span><input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#151923] px-3 text-xs" /></label><button disabled={busy} onClick={() => void activate()} className="mt-3 h-11 w-full rounded-xl bg-emerald-500 text-xs font-semibold text-[#03100B] disabled:opacity-50">{busy ? 'Updating…' : 'Confirm handover → Occupied'}</button></section>}
    {canMoveIn && !bookingCode && <section className="rounded-2xl border border-amber-500/15 bg-amber-500/[.035] p-4"><h4 className="text-sm font-semibold text-amber-300">Booking code required</h4><p className="mt-1 text-[10px] leading-5 text-[#85808A]">Return to the Reservation Desk and verify the code shown by the customer. A property cannot become Occupied from this record alone.</p></section>}

    {row.listing_status === 'occupied' && <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.035] p-4"><h4 className="text-sm font-semibold text-violet-300">Complete tenancy</h4><p className="mt-1 text-[10px] leading-5 text-[#788090]">When the customer has moved out, close the tenancy and choose what happens to the property next.</p><div className="mt-3"><WeHouseSelect value={nextStatus} options={[{value:'maintenance',label:'Maintenance',description:'Inspect before returning it to the market'},{value:'available',label:'Available',description:'Return it to users immediately'},{value:'closed',label:'Closed',description:'Remove it from the market'}]} onChange={setNextStatus} eyebrow="Tenancy completion" title="What happens next?" ariaLabel="Choose property state after move-out"/></div><button disabled={busy} onClick={() => void complete()} className="mt-3 h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50">{busy ? 'Updating…' : 'Complete tenancy'}</button></section>}

    {row.listing_status === 'maintenance' && <section className="rounded-2xl border border-orange-500/15 bg-orange-500/[.035] p-4"><p className="text-xs font-semibold text-orange-300">Property is in maintenance</p><p className="mt-1 text-[10px] leading-5 text-[#7C8190]">Do not mark this property Reserved or Occupied manually. Return it to Available only after the operational checks are complete.</p></section>}
    <ConfirmDialog {...dialogProps}/>
  </div>;
}

function Badge({ status }: { status: string }) { const item = STATUS[status] || STATUS.closed; return <span className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-semibold ${item.cls}`}>{item.label}</span>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-white/[.025] p-3"><p className="text-[8px] uppercase text-[#5E6373]">{label}</p><p className="mt-1 truncate text-[10px] font-semibold capitalize text-[#C4C7D0]">{value}</p></div>; }
function SmallRow({ label, value }: { label: string; value: string }) { return <div className="mt-1 flex justify-between gap-3 text-[9px]"><span className="text-[#717687]">{label}</span><span className="font-semibold text-[#C5C8D2]">{value}</span></div>; }
function Loading() { return <div className="grid min-h-48 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>; }
function Empty() { return <div className="rounded-2xl border border-dashed border-white/[.08] p-10 text-center"><p className="text-xs font-semibold">No arrival or tenancy records match</p><p className="mt-1 text-[9px] text-[#626778]">Try another search or status. New records appear after a real reservation reaches branch operations.</p></div>; }
