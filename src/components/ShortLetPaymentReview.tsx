import { shortLetPayment } from '@/lib/shortLetPayment';

const money = (value: number) => `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

export default function ShortLetPaymentReview({ row }: { row: any }) {
  if (row.stay_type !== 'short_let') return null;
  const feePaid = row.reservation_fee_status === 'paid' || ['paid','completed'].includes(String(row.manual_payment_status || ''));
  if (!feePaid) return null;
  const bill = shortLetPayment(row);
  if (!bill) return null;
  const reservationFee = Number(row.reservation_fee_snapshot || row.amount || 0);
  return (
    <section aria-label="Short Let payment summary" className="mt-4 border-y border-[var(--wh-border-subtle)] py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold">Stay payment</p>
        <p className="text-sm font-bold">{money(bill.total)}</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--wh-text-secondary)]">
        <span>Stay {money(bill.rent)}</span>
        <span>Caution {bill.deposit > 0 ? money(bill.deposit) : 'None'}</span>
        {reservationFee > 0 ? <span>Reserve date paid {money(reservationFee)}</span> : null}
      </div>
      {row.short_stay_balance_due_at ? (
        <p className="mt-2 text-[10px] text-amber-200">
          Due by {new Date(row.short_stay_balance_due_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      ) : null}
    </section>
  );
}
