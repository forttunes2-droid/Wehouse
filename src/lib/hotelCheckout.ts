import type {HotelBooking} from '@/types';
export type HotelCheckoutScope={personId:string;hotelId:number;roomId:number;ratePlanId:number;requestKey:string};
export type HotelHold=HotelBooking&{request_key:string;guest_name:string;guest_phone:string;payment_status:string;payment_recorded?:boolean;payment_expires_at:string|null;cancellation_snapshot:{refundable:boolean;deadline:string|null;timezone:string;refund_amount_ngn:number}};
const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const moment=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
function calendar(value:unknown):value is string{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&moment(value+'T12:00:00Z')&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
export function hotelCalendarDay(value:string,days=1){if(!calendar(value)||!Number.isInteger(days))return '';const day=new Date(value+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+days);return day.toISOString().slice(0,10);}
export function hotelCheckoutSignature(scope:Omit<HotelCheckoutScope,'requestKey'>){return `hotel-hold:${scope.personId}:${scope.hotelId}:${scope.roomId}:${scope.ratePlanId}`;}
export function validHotelPhone(value:string){return /^[+0-9() .-]+$/.test(value)&&value.replace(/[^0-9]/g,'').length>=7&&value.replace(/[^0-9]/g,'').length<=15;}
export function hotelHoldReceipt(value:unknown,scope:HotelCheckoutScope):HotelHold|null{
 if(value===null)return null;
 const row=record(value),terms=record(row.cancellation_snapshot);
 if(!Number.isInteger(row.booking_id)||Number(row.booking_id)===0||row.user_id!==scope.personId||row.hotel_id!==scope.hotelId||row.room_id!==scope.roomId||row.rate_plan_id!==scope.ratePlanId||row.request_key!==scope.requestKey||
  !calendar(row.check_in)||!calendar(row.check_out)||row.check_out<=row.check_in||!Number.isInteger(row.total_nights)||Number(row.total_nights)<1||
  (Date.parse(row.check_out+'T12:00:00Z')-Date.parse(row.check_in+'T12:00:00Z'))/86400000!==row.total_nights||
  !Number.isSafeInteger(row.total_price)||Number(row.total_price)<=0||!Number.isInteger(row.guest_count)||Number(row.guest_count)<1||
  typeof row.guest_name!=='string'||!row.guest_name.trim()||typeof row.guest_phone!=='string'||!row.guest_phone.trim()||
  typeof row.status!=='string'||!['pending','confirmed','checked_in','checked_out','completed','cancelled','refunded','expired','payment_conflict'].includes(row.status)||
  row.payment_recorded!==undefined&&typeof row.payment_recorded!=='boolean'||typeof row.payment_status!=='string'||!['unpaid','payment_pending','paid','expired','refunded','refund_pending','partially_refunded','failed'].includes(row.payment_status)||
  row.status==='pending'&&!moment(row.payment_expires_at)||typeof terms.refundable!=='boolean'||typeof terms.timezone!=='string'||
  typeof terms.refund_amount_ngn!=='number'||!Number.isFinite(terms.refund_amount_ngn)||terms.refund_amount_ngn<0||terms.refund_amount_ngn>Number(row.total_price)||
  terms.refundable&&!moment(terms.deadline))throw Error('The saved room hold and terms could not be confirmed. Refresh the hold before paying.');
 try{new Intl.DateTimeFormat('en',{timeZone:terms.timezone});}catch{throw Error('The booking timezone could not be confirmed.');}
 return value as HotelHold;
}
export function hotelQuoteReceipt(value:unknown){
 const row=record(value);
 if(row.same_day_booking_cutoff_at!=null&&!moment(row.same_day_booking_cutoff_at))throw Error('The same-day booking deadline could not be confirmed. Please retry.');
 if(typeof row.available!=='boolean'||row.currency!==undefined&&row.currency!=='NGN'||row.available&&(!Number.isInteger(row.nights)||Number(row.nights)<1||Number(row.nights)>365||typeof row.total_price!=='number'||!Number.isFinite(row.total_price)||row.total_price<=0))throw Error('Live availability and price could not be confirmed. Please retry.');
 return row as {available:boolean;nights?:number;total_price?:number;blocked_date?:string;rate_plan_name?:string;cancellation_deadline?:string|null;cancellation_timezone?:string;refund_amount_ngn?:number;original_price?:number;discount_percent?:number;discount_amount?:number;wehouse_discount_percent?:number;same_day_booking_cutoff_at?:string|null};
}
export function hotelCheckoutState(booking:HotelHold,now=Date.now()){
 const recorded=booking.payment_recorded===true||booking.payment_status==='paid'||Boolean(booking.payment_protection_id)||['refunded','refund_pending','partially_refunded'].includes(booking.payment_status);
 const expired=!recorded&&(booking.status==='expired'||booking.status==='pending'&&Date.parse(booking.payment_expires_at||'')<=now);
 const canPay=!recorded&&!expired&&booking.status==='pending'&&['unpaid','payment_pending','failed'].includes(booking.payment_status);
 const established=recorded&&['confirmed','checked_in','checked_out','completed'].includes(booking.status);
 const cancelled=booking.status==='cancelled';
 return {canPay,canStartNew:expired||cancelled||booking.status==='refunded'||established,
  newLabel:established?'Book another room':'Check availability again',
  title:expired?'Room hold expired':cancelled?(recorded?'Booking cancelled':'Unpaid room hold released'):booking.status==='confirmed'&&recorded?'Booking already confirmed':established?'Payment already recorded':'Check your booking status',
  explanation:expired?'No new payment can start from this hold. Check availability before starting another checkout.':recorded?'This checkout already has a recorded payment. Open the booking for its current stay, receipt, cancellation and refund status.':'This checkout is no longer awaiting a new payment. Open your bookings for its current status and any review.'};
}
