export type HotelCancellationPreview={booking_id:number;kind:'full_refund'|'unpaid'|'review_required'|'already_cancelled';can_cancel:boolean;message:string;currency?:'NGN';refund_amount_ngn?:number;fee_ngn?:number;deadline?:string;timezone?:string;refund_status?:string|null};
export function hotelCancellationPreview(value:unknown,bookingId:number):HotelCancellationPreview{
 const row=value as HotelCancellationPreview;
 if(!row||row.booking_id!==bookingId||!Number.isSafeInteger(bookingId)||bookingId<1||!['full_refund','unpaid','review_required','already_cancelled'].includes(row.kind)||typeof row.can_cancel!=='boolean'||typeof row.message!=='string'||!row.message.trim()||row.can_cancel!==['full_refund','unpaid'].includes(row.kind))throw Error('Cancellation details could not be confirmed. Try again.');
 if(row.can_cancel){
  if(row.currency!=='NGN'||typeof row.refund_amount_ngn!=='number'||!Number.isFinite(row.refund_amount_ngn)||row.fee_ngn!==0||(row.kind==='full_refund'?row.refund_amount_ngn<=0:row.refund_amount_ngn!==0))throw Error('Cancellation amounts could not be confirmed. Try again.');
 }
 if(row.kind==='full_refund'){
  if(typeof row.deadline!=='string'||!Number.isFinite(Date.parse(row.deadline))||typeof row.timezone!=='string')throw Error('The cancellation deadline could not be confirmed. Try again.');
  try{new Intl.DateTimeFormat(undefined,{timeZone:row.timezone});}catch{throw Error('The property timezone could not be confirmed. Try again.');}
 }
 if(row.kind==='already_cancelled'&&row.refund_status!=null&&!['pending','processing','provider_pending','provider_attention','manual_review','failed','completed'].includes(row.refund_status))throw Error('The refund status could not be confirmed. Refresh the booking.');
 return row;
}
