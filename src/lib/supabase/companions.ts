import { supabase } from './client';

export type Companion = {companion_id:string;user_id:string;full_name:string|null;username:string|null;status:'pending'|'accepted';requested_by_me:boolean};

export async function listMyCompanions(){
  const {data,error}=await supabase.rpc('list_my_companions');
  return {companions:(Array.isArray(data)?data:[]) as Companion[],error};
}
export async function sendCompanionRequestByUsername(username:string){
  const {error}=await supabase.rpc('send_companion_request_by_username',{p_username:username});
  return {error};
}
export async function respondToCompanionRequest(companionId:string,accept:boolean){
  const {error}=await supabase.rpc('respond_to_companion_request',{p_companion_id:companionId,p_accept:accept});
  return {error};
}
export async function removeCompanion(userId:string){
  const {error}=await supabase.rpc('remove_companion',{p_user_id:userId});
  return {error};
}
