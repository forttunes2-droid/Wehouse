import SharedStayInvite from '@/components/SharedStayInvite';
import {createSharedShortLet,type SharedHousingGroup} from '@/lib/supabase/shared-housing';
import {shortLetPayment} from '@/lib/shortLetPayment';

type Row=Parameters<typeof shortLetPayment>[0]&{id:string;guest_count?:number;status?:string;payment_reference?:unknown;rent_payment_reference?:unknown;shared_payment_group_id?:unknown;payment_expires_at?:string;reservation_fee_status?:string;manual_payment_status?:string;short_stay_balance_due_at?:string;rent_payment_status?:string};
export default function ShortLetBookingShares({row,userId,onCreated}:{row:Row;userId:string;onCreated:(group:SharedHousingGroup)=>void}){
 const bill=shortLetPayment(row),capacity=Math.min(Number(row.guest_count||0),3);
 const reserveDatePaid=row.reservation_fee_status==='paid'||['paid','completed'].includes(String(row.manual_payment_status||''));
 const balanceDeadline=row.short_stay_balance_due_at?new Date(row.short_stay_balance_due_at).getTime():0;
 if(!bill||capacity<2||!reserveDatePaid||!['reserved','ready_for_move_in'].includes(String(row.status||''))||!balanceDeadline||balanceDeadline<=Date.now()||row.rent_payment_status==='payment_pending'||row.rent_payment_status==='paid'||row.rent_payment_reference||row.shared_payment_group_id)return null;
 return <SharedStayInvite key={userId+':'+row.id} bookingKey={row.id} userId={userId} kind="Short Let" guests={Number(row.guest_count)}
  rent={bill.rent} deposit={bill.deposit}
  description="Your Reserve date fee is already paid. Invite accepted Friends joining the same reservation to share the remaining stay cost."
  onInvite={async friendIds=>{const result=await createSharedShortLet(row.id,friendIds);
   if(result.error||!result.group?.id||result.group.reservation_id!==row.id)throw result.error||new Error('The shared reservation could not be confirmed.');
   onCreated(result.group);
  }}/>;
}
