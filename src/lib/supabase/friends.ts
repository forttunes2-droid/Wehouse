import { supabase } from './client';
import { prepareChatVideo, validateChatUpload } from '@/lib/chatMediaPolicy';
import { prepareChatImageFile } from './utils';
import { decryptPrivateAttachment, encryptPrivateAttachment, type EncryptedAttachment } from '@/lib/e2ee';

// Friends are called "companions" in the database (tables, functions, columns). This file is the
// only place in the app that knows that; everything else says Friend. The names are stored data and
// encryption keys, so they are kept as they are until a database migration renames them.
export type Friend = {friend_id:string;user_id:string;full_name:string|null;username:string|null;status:'pending'|'accepted'|'blocked';requested_by_me:boolean};
type FriendRow = Omit<Friend,'friend_id'> & {companion_id:string};

export async function listMyFriends(){
  const {data,error}=await supabase.rpc('list_my_companions');
  const friends=(Array.isArray(data)?data as FriendRow[]:[]).map(({companion_id,...rest})=>({...rest,friend_id:companion_id})) as Friend[];
  return {friends,error};
}
export async function sendFriendRequestByUsername(username:string){
  const {error}=await supabase.rpc('send_companion_request_by_username',{p_username:username});
  return {error};
}
export async function respondToFriendRequest(friendId:string,accept:boolean){
  const {error}=await supabase.rpc('respond_to_companion_request',{p_companion_id:friendId,p_accept:accept});
  return {error};
}
export async function removeFriend(userId:string){
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
// Friend chat uses the same ciphertext and iv as other private chats; the server never sees plaintext.
export async function sendFriendEncryptedMessage(friendId:string,ciphertext:string,iv:string,attachments:unknown[]=[],replyToId?:string,clientMessageId?:string){
  const {data,error}=await supabase.rpc('send_companion_encrypted_message',{p_companion_id:friendId,p_ciphertext:ciphertext,p_encryption_iv:iv,p_encrypted_attachments:attachments,p_reply_to_id:replyToId??null,p_client_message_id:clientMessageId??null});
  return {id:data as string|null,error};
}
export async function getFriendEncryptedMessages(friendId:string){
  const {data,error}=await supabase.rpc('get_companion_encrypted_messages',{p_companion_id:friendId});
  return {messages:(Array.isArray(data)?data:[]) as {id:string;sender_id:string;ciphertext:string;encryption_iv:string;encryption_version:number;encrypted_attachments:unknown[];reply_to_id:string|null;created_at:string;reactions?:Record<string,string>}[],error};
}

// The database still uses the original name in its error text; people see "Friend".
export function friendlyFriendMessage(message?: string | null): string {
  return (message || "").replace(/\bCompanions\b/g, "Friends").replace(/\bCompanion\b/g, "Friend").replace(/\bcompanions\b/g, "friends").replace(/\bcompanion\b/g, "friend");
}

// The "companion" kind and storage folder below are part of existing encrypted data; do not rename.
export async function uploadFriendChatAttachment(file:File,friendId:string,peerUserId:string){
  try{
    await validateChatUpload(file);
    let upload:Blob|File=file,contentType=file.type||'application/octet-stream',extension=(file.name.split('.').pop()||'bin').replace(/[^a-zA-Z0-9]/g,'').toLowerCase();
    if(file.type.startsWith('image/')){const prepared=await prepareChatImageFile(file);upload=prepared.body;contentType=prepared.contentType;extension=prepared.extension}
    else if(file.type.startsWith('video/')){const prepared=await prepareChatVideo(file);upload=prepared.body;contentType=prepared.contentType;extension=prepared.extension}
    const safeBase=file.name.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,48)||'attachment';
    const encrypted=await     encryptPrivateAttachment('companion',friendId,peerUserId,upload,{name:`${safeBase}.${extension}`,type:contentType});
        const path=`e2ee/companion/${friendId}/${Date.now()}-${crypto.randomUUID()}.bin`;
    const {error}=await supabase.storage.from('chat-files').upload(path,encrypted.blob,{contentType:'application/octet-stream',upsert:false});
    if(error)throw error;
    return {attachment:{path,file_iv:encrypted.file_iv,metadata_ciphertext:encrypted.metadata_ciphertext,metadata_iv:encrypted.metadata_iv} as EncryptedAttachment,error:null as Error|null};
  }catch(error){return {attachment:null,error:error instanceof Error?error:new Error('Upload failed')}}
}
export async function openFriendChatAttachment(friendId:string,peerUserId:string,item:EncryptedAttachment){
  return decryptPrivateAttachment('companion',friendId,peerUserId,item);
}
export async function reactToFriendMessage(friendId:string,messageId:string,emoji:string|null){
  const {data,error}=await supabase.rpc('set_companion_message_reaction',{p_companion_id:friendId,p_message_id:messageId,p_emoji:emoji});
  return {reactions:(data||{}) as Record<string,string>,error};
}
export async function deleteFriendMessageForMe(friendId:string,messageId:string){
  const {error}=await supabase.rpc('delete_companion_message_for_me',{p_companion_id:friendId,p_message_id:messageId});
  return {error};
}
