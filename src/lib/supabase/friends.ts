import { supabase } from './client';
import { prepareChatVideo, validateChatUpload } from '@/lib/chatMediaPolicy';
import { prepareChatImageFile } from './utils';
import { decryptPrivateAttachment, encryptPrivateAttachment, type EncryptedAttachment } from '@/lib/e2ee';

export type Friend = {friend_id:string;user_id:string;full_name:string|null;username:string|null;status:'pending'|'accepted'|'blocked';requested_by_me:boolean};

export async function listMyFriends(){
  const {data,error}=await supabase.rpc('list_my_friends');
  return {friends:(Array.isArray(data)?data:[]) as Friend[],error};
}
export type FriendRecipient = {user_id:string;username:string;full_name:string|null};
export async function previewFriendRecipient(username:string){
  const {data,error}=await supabase.rpc('preview_friend_recipient',{p_username:username});
  if(error||data?.error)return {recipient:null,error:error||{message:String(data.error)}};
  if(typeof data?.user_id!=='string'||typeof data.username!=='string'||!(data.full_name===null||typeof data.full_name==='string'))
    return {recipient:null,error:{message:'The recipient could not be confirmed. Try again.'}};
  return {recipient:data as FriendRecipient,error:null};
}
export async function sendFriendRequest(userId:string){
  const {data,error}=await supabase.rpc('send_friend_request',{p_user_id:userId});
  if(error)return {error};
  if(typeof data?.id!=='string'||!['pending','accepted'].includes(data.status))
    return {error:{message:'The request outcome could not be confirmed. Refresh Friends before retrying.'}};
  return {error:null};
}
export async function respondToFriendRequest(friendId:string,accept:boolean){
  const {error}=await supabase.rpc('respond_to_friend_request',{p_friend_id:friendId,p_accept:accept});
  return {error};
}
export async function removeFriend(userId:string){
  const {error}=await supabase.rpc('remove_friend',{p_user_id:userId});
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
// Friend chat uses the same ciphertext and iv as other private chats; the server never sees plaintext.
export async function sendFriendEncryptedMessage(friendId:string,ciphertext:string,iv:string,attachments:unknown[]=[],replyToId?:string,clientMessageId?:string){
  const {data,error}=await supabase.rpc('send_friend_encrypted_message',{p_friend_id:friendId,p_ciphertext:ciphertext,p_encryption_iv:iv,p_encrypted_attachments:attachments,p_reply_to_id:replyToId??null,p_client_message_id:clientMessageId??null});
  return {id:data as string|null,error};
}
export async function getFriendEncryptedMessages(friendId:string){
  const {data,error}=await supabase.rpc('get_friend_encrypted_messages',{p_friend_id:friendId});
  return {messages:(Array.isArray(data)?data:[]) as {id:string;sender_id:string;ciphertext:string;encryption_iv:string;encryption_version:number;encrypted_attachments:unknown[];reply_to_id:string|null;created_at:string;reactions?:Record<string,string>}[],error};
}

export async function uploadFriendChatAttachment(file:File,friendId:string,peerUserId:string){
  try{
    await validateChatUpload(file);
    let upload:Blob|File=file,contentType=file.type||'application/octet-stream',extension=(file.name.split('.').pop()||'bin').replace(/[^a-zA-Z0-9]/g,'').toLowerCase();
    if(file.type.startsWith('image/')){const prepared=await prepareChatImageFile(file);upload=prepared.body;contentType=prepared.contentType;extension=prepared.extension}
    else if(file.type.startsWith('video/')){const prepared=await prepareChatVideo(file);upload=prepared.body;contentType=prepared.contentType;extension=prepared.extension}
    const safeBase=file.name.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,48)||'attachment';
    const encrypted=await encryptPrivateAttachment('friend',friendId,peerUserId,upload,{name:`${safeBase}.${extension}`,type:contentType});
    const path=`e2ee/friend/${friendId}/${Date.now()}-${crypto.randomUUID()}.bin`;
    const {error}=await supabase.storage.from('chat-files').upload(path,encrypted.blob,{contentType:'application/octet-stream',upsert:false});
    if(error)throw error;
    return {attachment:{path,file_iv:encrypted.file_iv,metadata_ciphertext:encrypted.metadata_ciphertext,metadata_iv:encrypted.metadata_iv} as EncryptedAttachment,error:null as Error|null};
  }catch(error){return {attachment:null,error:error instanceof Error?error:new Error('Upload failed')}}
}
export async function openFriendChatAttachment(friendId:string,peerUserId:string,item:EncryptedAttachment){
  return decryptPrivateAttachment('friend',friendId,peerUserId,item);
}
export async function reactToFriendMessage(friendId:string,messageId:string,emoji:string|null){
  const {data,error}=await supabase.rpc('set_friend_message_reaction',{p_friend_id:friendId,p_message_id:messageId,p_emoji:emoji});
  return {reactions:(data||{}) as Record<string,string>,error};
}
export async function deleteFriendMessageForMe(friendId:string,messageId:string){
  const {error}=await supabase.rpc('delete_friend_message_for_me',{p_friend_id:friendId,p_message_id:messageId});
  return {error};
}
