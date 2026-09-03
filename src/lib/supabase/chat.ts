import { supabase } from './client';
import { compressImageFile } from './utils';
import type { Conversation,Message } from '@/types';
import { decryptPrivateAttachment, decryptPrivateMessage, encryptPrivateAttachment, encryptPrivateMessage, type EncryptedAttachment } from '@/lib/e2ee';

export type RoommatePeer={user_id:string;name:string;avatar:string|null;bio:string;city:string;state:string;school:string;occupation:string;isStudent:boolean;isBlocked:boolean};

export async function getConversations(userId:string){
  const{data,error}=await supabase.rpc('get_user_conversations',{p_user_id:userId});
  return{conversations:(data||[]) as Conversation[],error};
}

export async function getRoommateConversationPeople(){
  const{data,error}=await supabase.rpc('get_my_roommate_peer_details');
  const people:Record<string,RoommatePeer>={};
  for(const row of data||[]){
    if(!row.user_id)continue;
    people[row.user_id]={user_id:row.user_id,name:row.full_name||row.username||'Roommate',avatar:row.avatar_url||null,bio:row.bio||'',city:row.city||'',state:row.state||'',school:row.school||'',occupation:row.occupation||'',isStudent:Boolean(row.is_student),isBlocked:Boolean(row.is_blocked)};
  }
  return{people,error};
}

export async function getMessages(conversationId:string,peerUserId?:string|null){
  const{data,error}=await supabase.rpc('get_private_encrypted_messages',{p_conversation_kind:'roommate',p_conversation_id:conversationId});
  if(error||!data)return{messages:(data||[]) as Message[],error};
  const messages=await Promise.all((data as any[]).map(async row=>{
    let content=String(row.legacy_content||'');
    if(row.ciphertext&&row.encryption_iv&&peerUserId){
      try{content=await decryptPrivateMessage('roommate',conversationId,peerUserId,row.ciphertext,row.encryption_iv)}catch{content='🔒 Encrypted message · unlock with your Recovery PIN'}
    }
    const attachments:string[]=[];const attachmentTypes:string[]=[];
    const legacyPaths=Array.isArray(row.legacy_attachments)?row.legacy_attachments.filter(Boolean):[];
    for(let index=0;index<legacyPaths.length;index++){
      const{data:signed,error:signedError}=await supabase.storage.from('chat-files').createSignedUrl(legacyPaths[index],300);
      if(!signedError&&signed?.signedUrl){
        attachments.push(signed.signedUrl);
        attachmentTypes.push(row.legacy_attachment_types?.[index]||'');
      }
    }
    if(peerUserId)for(const item of Array.isArray(row.encrypted_attachments)?row.encrypted_attachments:[]){try{const clear=await decryptPrivateAttachment('roommate',conversationId,peerUserId,item as EncryptedAttachment);attachments.push(clear.url);attachmentTypes.push(clear.type)}catch{/* Keep the readable message even when one file is unavailable. */}}
    return{...row,content,conversation_id:conversationId,seen:Boolean(row.is_read),attachments,attachment_types:attachmentTypes,reply_to_id:row.reply_to_id||null,reactions:row.reactions||{}} as Message;
  }));
  return{messages,error};
}

export async function sendMessage(conversationId:string,peerUserId:string,content:string,attachments:EncryptedAttachment[]=[],attachmentTypes:string[]=[],replyToId:string|null=null){
  void attachmentTypes;
  try{
    const encrypted=await encryptPrivateMessage('roommate',conversationId,peerUserId,content);
    const{data,error}=await supabase.rpc('send_private_encrypted_message',{p_conversation_kind:'roommate',p_conversation_id:conversationId,p_ciphertext:encrypted.ciphertext,p_encryption_iv:encrypted.iv,p_encrypted_attachments:attachments,p_reply_to_id:replyToId});
    return{message:error?null:{id:data,conversation_id:conversationId,sender_id:'',content,seen:false,created_at:new Date().toISOString()} as Message,error};
  }catch(error:any){return{message:null,error:{message:error?.message||'Encrypted message could not be sent'} as any}}
}

export async function reactToMessage(conversationId:string,messageId:string,emoji:string|null){
  const{data,error}=await supabase.rpc('set_private_message_reaction',{p_conversation_kind:'roommate',p_conversation_id:conversationId,p_message_id:messageId,p_emoji:emoji});
  return{reactions:(data||{}) as Record<string,string>,error};
}

export async function uploadRoommateChatAttachment(file:File,conversationId:string,peerUserId:string){
  try{
    if(!file.type.startsWith('image/')&&!file.type.startsWith('audio/'))return{path:null,error:{message:'Roommate chat supports photos and voice notes only'} as any};
    if(file.size>25*1024*1024)return{path:null,error:{message:'Attachment must be 25MB or smaller'} as any};
    let upload:Blob|File=file,contentType=file.type||'application/octet-stream',extension=(file.name.split('.').pop()||'bin').replace(/[^a-zA-Z0-9]/g,'').toLowerCase()||'bin';
    if(file.type.startsWith('image/')){upload=await compressImageFile(file,1920,.85);contentType='image/jpeg';extension='jpg'}
    const safeBase=file.name.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,48)||'attachment';
    const encrypted=await encryptPrivateAttachment('roommate',conversationId,peerUserId,upload,{name:`${safeBase}.${extension}`,type:contentType});
    const path=`e2ee/roommate/${conversationId}/${Date.now()}-${crypto.randomUUID()}.bin`;
    const{error}=await supabase.storage.from('chat-files').upload(path,encrypted.blob,{contentType:'application/octet-stream',upsert:false});
    return{path:error?null:path,attachment:error?null:{path,file_iv:encrypted.file_iv,metadata_ciphertext:encrypted.metadata_ciphertext,metadata_iv:encrypted.metadata_iv},type:contentType,error};
  }catch(error:any){return{path:null,type:null,error:{message:error?.message||'Upload failed'} as any}}
}

export async function deleteRoommateChatAttachment(path:string){
  if(!path||path.startsWith('http'))return{error:null};
  const{error}=await supabase.storage.from('chat-files').remove([path]);
  return{error};
}

export async function hideRoommateConversation(conversationId:string){
  const{data,error}=await supabase.rpc('hide_my_roommate_conversation',{p_conversation_id:conversationId});
  return{hidden:data===true,error};
}

export async function setRoommateBlock(userId:string,blocked:boolean){
  const{data,error}=await supabase.rpc('set_my_roommate_block',{p_user_id:userId,p_blocked:blocked});
  return{blocked:data===true,error};
}

export async function markMessagesSeen(conversationId:string){
  const{error}=await supabase.rpc('mark_my_conversation_seen',{p_conversation_id:conversationId});
  return{error};
}
