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
export type SharedHousingMember = {user_id:string;name:string;invitation_status:string;share_amount:number;eligible_partner_share?:number;refundable_share?:number;payment_status:string};
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
export type SharedHousingGroup = {id:string;canonical_group_id?:string;created_by:string;listing_id:string;reservation_id?:string|null;conversation_id?:string|null;status:string;booking_status?:string|null;product_type?:string;payment_phase:string;expires_at:string;created_at?:string;guest_count?:number;stay_check_in?:string;stay_check_out?:string;total_amount?:number;checkout_attempt?:number;rent_agreement?:SharedRentAgreement|null;arrival?:SharedHomeArrival|null;members:SharedHousingMember[];listing:{id:string;title:string;image?:string|null;city?:string;state?:string}};
export async function createSharedShortLet(reservationId:string, friendUserIds:string[]) {
  const {data,error}=await supabase.rpc('create_my_shared_short_let',{p_reservation_id:reservationId,p_user_ids:friendUserIds});
  return {group:data as SharedHousingGroup|null,error};
}
export async function getSharedHousingGroup(groupId:string,userId?:string) {
  const {data,error}=await supabase.rpc('get_my_shared_housing_group',{p_group_id:groupId});
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
