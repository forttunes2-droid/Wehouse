import { supabase } from './client';

export async function getMySharedHousingGroups(){const{data,error}=await supabase.rpc('get_my_shared_housing_groups');return{groups:Array.isArray(data)?data:[],error}}
export async function createSharedHousingGroup(listingId:string,conversationId:string){const{data,error}=await supabase.rpc('create_my_shared_housing_group',{p_listing_id:listingId,p_conversation_id:conversationId});return{group:data||null,error}}
export async function respondToSharedHousingInvite(groupId:string,accept:boolean){const{data,error}=await supabase.rpc('respond_to_shared_housing_invite',{p_group_id:groupId,p_accept:accept});return{group:data||null,error}}
export async function initializeSharedHousingPayment(groupId:string){
  const{data:bootstrap,error:bootstrapError}=await supabase.rpc('create_my_shared_housing_payment',{p_group_id:groupId});
  if(bootstrapError)return{result:null,error:bootstrapError};
  if(bootstrap?.already_paid)return{result:bootstrap,error:null};
  const reference=String(bootstrap?.reference||'');if(!reference)return{result:null,error:{message:'Shared payment reference is missing'} as any};
  const{data,error}=await supabase.functions.invoke('payment-init',{body:{reference}});
  if(!error)return{result:data||null,error:null};
  let message=error.message||'Shared payment could not start';try{const body=await(error as any).context?.json?.();if(body?.error)message=String(body.error)}catch{/* Non-JSON network response. */}
  return{result:null,error:{message} as any};
}
export async function startSharedHousingContractSplit(groupId:string){const{data,error}=await supabase.rpc('start_my_shared_contract_split',{p_group_id:groupId});return{group:data||null,error}}

export type SharedHousingMember = {user_id:string;name:string;invitation_status:string;share_amount:number;eligible_partner_share?:number;refundable_share?:number;payment_status:string};
export type SharedHousingGroup = {id:string;created_by:string;listing_id:string;reservation_id?:string|null;conversation_id?:string|null;status:string;booking_status?:string|null;product_type?:string;payment_phase:string;expires_at:string;created_at?:string;guest_count?:number;stay_check_in?:string;stay_check_out?:string;total_amount?:number;members:SharedHousingMember[];listing:{id:string;title:string;image?:string|null;city?:string;state?:string}};
export async function createSharedShortLet(reservationId:string, conversationIds:string[]) {
  const {data,error}=await supabase.rpc('create_my_shared_short_let',{p_reservation_id:reservationId,p_conversation_ids:conversationIds});
  return {group:data as SharedHousingGroup|null,error};
}
export async function getSharedHousingGroup(groupId:string) {
  const {data,error}=await supabase.rpc('get_my_shared_housing_group',{p_group_id:groupId});
  return {group:data as SharedHousingGroup|null,error};
}
