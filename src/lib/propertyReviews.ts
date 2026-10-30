import {supabase} from './supabase/client';
import {withTimeout} from './withTimeout';
export type PropertyReview = {review_id:string;reservation_id:string;rating:number;comment:string|null;created_at:string};
export type BookingReview = {reservation_id:string;stay_type:'short_let'|'long_stay';eligible:boolean;review:PropertyReview|null};
export function propertyReviewReceipt(value:unknown,reservationId:string):PropertyReview {
 const r=value as PropertyReview;
 if(!r||typeof r.review_id!=='string'||!r.review_id||r.reservation_id!==reservationId||!Number.isInteger(r.rating)||r.rating<1||r.rating>5||(r.comment!==null&&typeof r.comment!=='string')||typeof r.created_at!=='string'||!Number.isFinite(Date.parse(r.created_at)))throw Error('Your saved review could not be confirmed. Refresh before retrying.');
 return r;
}
export async function getBookingReview(reservationId:string):Promise<BookingReview>{
 const {data,error}=await withTimeout(supabase.rpc('get_my_property_booking_review',{p_reservation_id:reservationId}),15000,'Your review took too long to load.');
 if(error)throw error;
 if(!data||data.reservation_id!==reservationId||typeof data.eligible!=='boolean'||!['short_let','long_stay'].includes(data.stay_type)||data.review===undefined)throw Error('Review eligibility could not be confirmed.');
 return {...data,review:data.review===null?null:propertyReviewReceipt(data.review,reservationId)};
}
export async function submitBookingReview(reservationId:string,rating:number,comment:string){
 const text=comment.trim()||null;
 const {data,error}=await withTimeout(supabase.rpc('submit_my_property_booking_review',{p_reservation_id:reservationId,p_rating:rating,p_comment:text}),15000,'Review confirmation took too long. Refresh this booking before retrying.');
 if(error)throw error;
 const saved=propertyReviewReceipt(data,reservationId);
 if(saved.rating!==rating||saved.comment!==text)throw Error('The submitted review was not confirmed. Refresh before retrying.');
 return saved;
}
