import { supabase } from './client';
import { compressImageFile } from './utils';
import type { Conversation,Message } from '@/types';

export type RoommatePeer={user_id:string;name:string;avatar:string|null};

export async function getConversations(userId:string){
  const{data,error}=await supabase.rpc('get_user_conversations',{p_user_id:userId});
  return{conversations:(data||[]) as Conversation[],error};
}

export async function getRoommateConversationPeople(){
  const{data,error}=await supabase.rpc('get_my_roommate_conversation_people');
  const people:Record<string,RoommatePeer>={};
  for(const row of data||[]){
    if(!row.user_id)continue;
    people[row.user_id]={user_id:row.user_id,name:row.full_name||row.username||'Roommate',avatar:row.avatar_url||null};
  }
  return{people,error};
}

async function signChatPath(path:string){
  if(!path||path.startsWith('http'))return path;
  const{data}=await supabase.storage.from('chat-files').createSignedUrl(path,3600);
  return data?.signedUrl||path;
}

export async function getMessages(conversationId:string){
  const{data,error}=await supabase.rpc('get_roommate_messages_v2',{p_conversation_id:conversationId});
  if(error||!data)return{messages:(data||[]) as Message[],error};
  const messages=await Promise.all((data as any[]).map(async row=>{
    const attachments=await Promise.all(((row.attachments||[]) as string[]).map(signChatPath));
    const legacy=row.file_url?[await signChatPath(String(row.file_url))]:[];
    return{...row,attachments:attachments.length?attachments:legacy,attachment_types:attachments.length?(row.attachment_types||[]):legacy.length?[row.file_type||'']:[]} as Message;
  }));
  return{messages,error};
}

export async function sendMessage(conversationId:string,content:string,attachments:string[]=[],attachmentTypes:string[]=[]){
  const{data,error}=await supabase.rpc('send_my_roommate_message_v2',{p_conversation_id:conversationId,p_content:content,p_attachments:attachments,p_attachment_types:attachmentTypes});
  return{message:(data||null) as Message|null,error};
}

export async function uploadRoommateChatAttachment(file:File,conversationId:string){
  try{
    if(!file.type.startsWith('image/')&&!file.type.startsWith('audio/'))return{path:null,error:{message:'Roommate chat supports photos and voice notes only'} as any};
    if(file.size>25*1024*1024)return{path:null,error:{message:'Attachment must be 25MB or smaller'} as any};
    let upload:Blob|File=file,contentType=file.type||'application/octet-stream',extension=(file.name.split('.').pop()||'bin').replace(/[^a-zA-Z0-9]/g,'').toLowerCase()||'bin';
    if(file.type.startsWith('image/')){upload=await compressImageFile(file,1920,.85);contentType='image/jpeg';extension='jpg'}
    const safeBase=file.name.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,48)||'attachment';
    const path=`${conversationId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeBase}.${extension}`;
    const{error}=await supabase.storage.from('chat-files').upload(path,upload,{contentType,upsert:false});
    return{path:error?null:path,type:contentType,error};
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

export async function markMessagesSeen(conversationId:string){
  const{error}=await supabase.rpc('mark_my_conversation_seen',{p_conversation_id:conversationId});
  return{error};
}
