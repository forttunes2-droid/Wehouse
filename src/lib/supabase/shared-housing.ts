import { supabase } from './client';
import {initializePaymentReference} from './housing-payments';
import {sharedRentAgreementReceipt,type SharedRentAgreement} from '../sharedLongLetRent';

export async function getMySharedHousingGroups(){const{data,error}=await supabase.rpc('get_my_shared_housing_groups');return{groups:Array.isArray(data)?data:[],error}}
export async function createSharedHousingGroup(listingId:string,conversationId:string){const{data,error}=await supabase.rpc('create_my_shared_housing_group',{p_listing_id:listingId,p_conversation_id:conversationId});return{group:data||null,error}}
export async function respondToSharedHousingInvite(groupId:string,accept:boolean,rent?:{quote_digest:string;checkout_attempt:number}){
  const {data,error}=await supabase.rpc(rent?'respond_to_shared_rent_agreement':'respond_to_shared_housing_invite',{
    p_group_id:groupId,p_accept:accept,...(rent?{p_quote_digest:rent.quote_digest,p_checkout_attempt:rent.checkout_attempt}:{}),
  });return{group:data||null,error};
}
export async function initializeSharedHousingPayment(groupId:string){
  const{data:bootstrap,error:bootstrapError}=await supabase.rpc('create_my_shared_housing_payment',{p_group_id:groupId});
  if(bootstrapError)return{result:null,error:bootstrapError};
  if(bootstrap?.already_paid)return{result:bootstrap,error:null};
  const reference=String(bootstrap?.reference||'');if(!reference)return{result:null,error:{message:'Shared payment reference is missing'} as any};
  return initializePaymentReference(reference,'shared_housing_share');
}
export type SharedHousingMember = {user_id:string;name:string;invitation_status:string;share_amount:number;eligible_partner_share?:number;refundable_share?:number;payment_status:string;payment_reference?:string|null;refund_status?:string|null};
export type SharedHomeArrival={reservation_id:string;booking_code:string;status:'ready_for_move_in'|'occupied'|'completed';requested_move_in_at:string|null;tenancy_start_date:string|null;tenancy_end_date:string|null;address:string|null};
export function sharedHomeArrivalReceipt(value:unknown,reservationId:string):SharedHomeArrival|null{
  if(value==null)return null;
  const row=value as SharedHomeArrival;
  if(row.reservation_id!==reservationId||typeof row.booking_code!=='string'||!row.booking_code||row.booking_code.length>50
    ||!['ready_for_move_in','occupied','completed'].includes(row.status)
    ||[row.requested_move_in_at,row.tenancy_start_date,row.tenancy_end_date].some(date=>date!==null&&(typeof date!=='string'||!Number.isFinite(Date.parse(date))))
    ||row.address!==null&&(typeof row.address!=='string'||row.address.length>6000))throw Error('Shared arrival details could not be confirmed. Refresh before travelling.');
  return row;
}
export type SharedHousingGroup = {id:string;canonical_group_id?:string;created_by:string;listing_id:string|null;reservation_id?:string|null;conversation_id?:string|null;status:string;booking_status?:string|null;product_type?:string;payment_phase:string;expires_at:string;created_at?:string;guest_count?:number;stay_check_in?:string;stay_check_out?:string;total_amount?:number;checkout_attempt?:number;rent_agreement?:SharedRentAgreement|null;arrival?:SharedHomeArrival|null;members:SharedHousingMember[];listing:{id:string;title:string;image?:string|null;city?:string;state?:string};hotel_id?:number;hotel_booking_id?:number;cancellation_snapshot?:{refundable:boolean;deadline:string|null;timezone:string;refund_amount_ngn:number};hotel_arrival?:{booking_id:number;booking_code:string;address:string|null;check_in_time:string;check_out_time:string;timezone:string}|null};

export async function createSharedHotel(bookingId:number,friendUserIds:string[]){
 const {data,error}=await supabase.rpc('create_my_shared_hotel',{p_booking_id:bookingId,p_user_ids:friendUserIds});
 if(error)return{group:null,error};
 try{return{group:sharedHotelReceipt(data,bookingId),error:null};}catch(cause){return{group:null,error:cause as Error};}
}
export function sharedHotelReceipt(value:unknown,bookingId?:number):SharedHousingGroup{
 const row=value as SharedHousingGroup;
 const ids=new Set(row?.members?.map(member=>member.user_id));
 if(!row||row.product_type!=='hotel'||typeof row.id!=='string'||!row.id||row.canonical_group_id!==row.id||row.listing_id!==null
  ||!Number.isSafeInteger(row.hotel_booking_id)||Number(row.hotel_booking_id)<1||bookingId!==undefined&&row.hotel_booking_id!==bookingId
  ||!Number.isSafeInteger(row.hotel_id)||Number(row.hotel_id)<1||!Number.isSafeInteger(row.guest_count)||Number(row.guest_count)<2
  ||!Array.isArray(row.members)||row.members.length<2||row.members.length>Math.min(3,Number(row.guest_count))||ids.size!==row.members.length
  ||!row.members.some(member=>member.user_id===row.created_by)||row.members.some(member=>typeof member.user_id!=='string'||!member.user_id||typeof member.share_amount!=='number'||!Number.isFinite(member.share_amount)||member.share_amount<=0)
  ||typeof row.total_amount!=='number'||!Number.isFinite(row.total_amount)||row.members.reduce((sum,member)=>sum+Math.round(member.share_amount*100),0)!==Math.round(row.total_amount*100)
  ||!Number.isFinite(Date.parse(row.expires_at))||!row.listing||typeof row.listing.title!=='string'||!row.cancellation_snapshot
  ||typeof row.cancellation_snapshot.refundable!=='boolean'||typeof row.cancellation_snapshot.timezone!=='string'
  ||row.cancellation_snapshot.refundable&&!Number.isFinite(Date.parse(row.cancellation_snapshot.deadline||'')))throw Error('Shared Hotel identity, terms and guest shares could not be confirmed. Refresh this booking.');
 if(row.hotel_arrival&&(row.hotel_arrival.booking_id!==row.hotel_booking_id||typeof row.hotel_arrival.booking_code!=='string'||!row.hotel_arrival.booking_code||row.status!=='paid'))throw Error('Shared Hotel arrival could not be confirmed. Refresh the booking.');
 return row;
}
export async function createSharedShortLet(reservationId:string, friendUserIds:string[]) {
  const {data,error}=await supabase.rpc('create_my_shared_short_let',{p_reservation_id:reservationId,p_user_ids:friendUserIds});
  return {group:data as SharedHousingGroup|null,error};
}
export async function getSharedHousingGroup(groupId:string,userId?:string) {
  const {data,error}=await supabase.rpc('get_my_shared_housing_group',{p_group_id:groupId});
  if(!error&&data?.product_type==='hotel')sharedHotelReceipt(data);
  if(!error&&data?.rent_agreement){
    if(typeof data.reservation_id!=='string'||!Number.isSafeInteger(data.checkout_attempt)||data.checkout_attempt<1)throw Error('Shared rental identity could not be confirmed.');
    data.rent_agreement=sharedRentAgreementReceipt(data.rent_agreement,data.reservation_id,userId);
  }
  if(!error&&data?.arrival)data.arrival=sharedHomeArrivalReceipt(data.arrival,data.reservation_id);
  return {group:data as SharedHousingGroup|null,error};
}

export async function createSharedLongLet(listingId:string, roommateConversationIds:string[], friendUserIds:string[]) {
  const {data,error}=await supabase.rpc('create_my_shared_long_let',{p_listing_id:listingId,p_roommate_conversation_ids:roommateConversationIds,p_friend_user_ids:friendUserIds});
  return {group:data,error};
}
