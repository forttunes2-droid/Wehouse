import { shortLetPayment } from '@/lib/shortLetPayment';
const money = (value: number) => `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
export default function ShortLetPaymentReview({ row }: { row: any }) {
  if (row.stay_type !== 'short_let') return null;
  const feePaid = row.reservation_fee_status === 'paid' || ['paid','completed'].includes(String(row.manual_payment_status || ''));
  if (!feePaid) return <section aria-label="Short Let Reserve date review" className="mt-5 border-y border-white/10 py-4">
    <h3 className="text-base font-semibold">Reserve date</h3>
    <p className="mt-2 text-sm leading-6 text-[#AAA3B3]">Complete the reservation fee first. Your stay charge and any refundable security deposit are shown only after the dates are reserved.</p>
  </section>;
  const bill = shortLetPayment(row);
  const reservationFee = Number(row.reservation_fee_snapshot || row.amount || 0);
  return <section aria-label="Short Let payment review" className="mt-5 border-y border-white/10 py-4">
    <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-violet-300">Dates reserved</p><h3 className="mt-1 text-base font-semibold">Review your stay</h3></div>{reservationFee > 0 ? <span className="text-xs text-[#A8ADBA]">Reserve date paid · {money(reservationFee)}</span> : null}</div>
    {bill ? <><dl className="mt-4 divide-y divide-white/10 text-sm"><div className="flex justify-between gap-4 py-3"><dt>Stay charge</dt><dd className="font-semibold">{money(bill.rent)}</dd></div>
    <div className="flex justify-between gap-4 py-3"><dt>Refundable security deposit</dt><dd className="font-semibold">{bill.deposit > 0 ? money(bill.deposit) : 'Not required'}</dd></div>
    <div className="flex justify-between gap-4 py-3 text-base"><dt>Pay now</dt><dd className="font-semibold">{money(bill.total)}</dd></div></dl>
    {row.short_stay_balance_due_at ? <p className="mt-3 text-sm text-amber-200">Complete the stay payment by {new Date(row.short_stay_balance_due_at).toLocaleString()} to keep the reserved dates.</p> : null}
    {bill.deposit > 0 && <p className="mt-3 text-sm leading-6 text-[#AAA3B3]">The deposit is separate from the stay charge and remains refundable subject to the booking’s evidence-backed deposit rules.</p>}</>
    : <p role="alert" className="mt-3 text-sm leading-6 text-amber-200">The confirmed stay price could not be loaded. Refresh this booking before paying.</p>}
  </section>;
}
