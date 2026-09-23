import { shortLetPayment } from '@/lib/shortLetPayment';
const money = (value: number) => `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
export default function ShortLetPaymentReview({ row }: { row: Parameters<typeof shortLetPayment>[0] }) {
  if (row.stay_type !== 'short_let') return null;
  const bill = shortLetPayment(row);
  return <section aria-label="Short Let payment review" className="mt-5 border-y border-white/10 py-4">
    <h3 className="text-base font-semibold">Review your stay</h3>
    {bill ? <><dl className="mt-3 space-y-3 text-sm"><div className="flex justify-between gap-4"><dt>Stay charge</dt><dd className="font-semibold">{money(bill.rent)}</dd></div>
    <div className="flex justify-between gap-4"><dt>Refundable security deposit</dt><dd className="font-semibold">{bill.deposit > 0 ? money(bill.deposit) : 'Not required'}</dd></div>
    <div className="flex justify-between gap-4 border-t border-white/10 pt-3 text-base"><dt>Total payable</dt><dd className="font-semibold">{money(bill.total)}</dd></div></dl>
    {bill.deposit > 0 && <p className="mt-3 text-sm leading-6 text-[#AAA3B3]">The deposit is separate from the stay charge. Any deposit review remains attached to this booking after checkout.</p>}</>
    : <p role="alert" className="mt-3 text-sm leading-6 text-amber-200">The confirmed price could not be loaded. Refresh this booking before paying.</p>}
  </section>;
}
