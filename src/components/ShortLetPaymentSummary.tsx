import {formatRecordedMoney} from '@/lib/regional';
import {hasProtectedAccommodationPayment} from '@/lib/propertyBookingLifecycle';
import {shortLetBookingPrice,type ShortLetBill} from '@/lib/shortLetPayment';

/** Display only the booking's saved quote, including both payment stages. */
export default function ShortLetPaymentSummary({row,bill}:{row:Record<string,any>;bill:ShortLetBill|null}){
 if(row.stay_type!=='short_let')return null;
 const price=shortLetBookingPrice(bill,row.reservation_fee_snapshot);
 const fee=price?.fee||0;
 const reservePaid=row.reservation_fee_status==='paid'||['paid','completed'].includes(String(row.manual_payment_status||''));
 const paid=hasProtectedAccommodationPayment(row);
 const money=(amount:number)=>formatRecordedMoney(amount,row.currency);
 return <section aria-label="Short Let payment" className="mt-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
  <h3 className="text-sm font-semibold">Your booking price</h3>
  {price&&bill?<>
   <dl className="mt-3 divide-y divide-[var(--wh-border-subtle)] text-sm">
    {[[`Reserve date fee${reservePaid?' · paid':''}`,fee],['Stay charge',bill.rent],['Refundable caution',bill.deposit],['Total booking cost',price.total]].map(([label,value])=><div key={label} className="flex justify-between gap-4 py-2.5"><dt>{label}</dt><dd className="shrink-0 font-semibold">{label==='Refundable caution'&&value===0?'Not required':money(Number(value))}</dd></div>)}
   </dl>
   <p className="mt-3 text-sm font-semibold">{paid?'Stay payment confirmed':reservePaid?`Stay balance to pay · ${money(bill.total)}`:`Reserve date payment now · ${money(fee)}`}</p>
   {!reservePaid&&<p className="mt-2 text-sm text-[var(--wh-text-secondary)]">After this payment, the stay balance is {money(bill.total)}. The Reserve date fee is separate from the stay charge.</p>}
   {bill.deposit>0&&<p className="mt-2 text-sm text-[var(--wh-text-secondary)]">The caution is refundable under your booking’s evidence and damage-claim rules. It is separate from the stay charge.</p>}
  </>:<p role="alert" className="mt-3 text-sm text-[var(--wh-text-secondary)]">The full saved booking price could not be confirmed. Refresh this booking before paying.</p>}
 </section>;
}
