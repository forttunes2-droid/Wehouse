import { supabase } from './client';

export type Companion = {companion_id:string;user_id:string;full_name:string|null;username:string|null;status:'pending'|'accepted'|'blocked';requested_by_me:boolean};

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
export async function blockFriend(userId:string){
  const {error}=await supabase.rpc('block_friend',{p_user_id:userId});
  return {error};
}
export async function unblockFriend(userId:string){
  const {error}=await supabase.rpc('unblock_friend',{p_user_id:userId});
  return {error};
}
// Companion chat uses the same ciphertext and iv as other private chats; the server never sees plaintext.
export async function sendCompanionEncryptedMessage(companionId:string,ciphertext:string,iv:string,attachments:unknown[]=[],replyToId?:string){
  const {data,error}=await supabase.rpc('send_companion_encrypted_message',{p_companion_id:companionId,p_ciphertext:ciphertext,p_encryption_iv:iv,p_encrypted_attachments:attachments,p_reply_to_id:replyToId??null});
  return {id:data as string|null,error};
}
export async function getCompanionEncryptedMessages(companionId:string){
  const {data,error}=await supabase.rpc('get_companion_encrypted_messages',{p_companion_id:companionId});
  return {messages:(Array.isArray(data)?data:[]) as {id:string;sender_id:string;ciphertext:string;encryption_iv:string;encryption_version:number;encrypted_attachments:unknown[];reply_to_id:string|null;created_at:string}[],error};
}

// The database still uses the original name in its error text; people see "Friend".
export function friendlyFriendMessage(message?: string | null): string {
  return (message || "").replace(/\bCompanions\b/g, "Friends").replace(/\bCompanion\b/g, "Friend").replace(/\bcompanions\b/g, "friends").replace(/\bcompanion\b/g, "friend");
}
