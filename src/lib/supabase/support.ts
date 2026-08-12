import { supabase } from './client';

export type SupportThread = {
  conversation_id:string;
  subject:string;
  status:string;
  category:string;
  context_type:string;
  context_id:string|null;
  context_snapshot:Record<string,unknown>;
  priority:string;
  assigned_staff_name:string|null;
  last_message:string|null;
  last_message_time:string|null;
  unread_count:number;
  created_at:string;
};

export async function createSupportConversation(input:{subject:string;category?:string;contextType?:string;contextId?:string|null;contextSnapshot?:Record<string,unknown>;priority?:string}){
  const {data,error}=await supabase.rpc('create_support_conversation',{
    p_subject:input.subject,
    p_category:input.category||'general',
    p_context_type:input.contextType||'general',
    p_context_id:input.contextId||null,
    p_context_snapshot:input.contextSnapshot||{},
    p_priority:input.priority||'normal',
  });
  return {conversationId:data as string|null,error};
}

export async function getMySupportConversations(){
  const {data,error}=await supabase.rpc('get_my_support_conversations');
  return {conversations:(data||[]) as SupportThread[],error};
}

export async function getSupportMessages(conversationId:string){
  const {data,error}=await supabase.rpc('get_support_messages',{p_conversation_id:conversationId});
  return {messages:data||[],error};
}

export async function sendSupportMessage(conversationId:string,content:string,attachments:string[]=[],attachmentTypes:string[]=[]){
  const {data,error}=await supabase.rpc('send_support_message',{
    p_conversation_id:conversationId,
    p_content:content,
    p_attachments:attachments,
    p_attachment_types:attachmentTypes,
  });
  return {messageId:data as string|null,error};
}

export async function markSupportMessagesRead(conversationId:string){
  const {error}=await supabase.rpc('mark_support_messages_read',{p_conversation_id:conversationId});
  return {error};
}

export async function getSupportInbox(){
  const {data,error}=await supabase.rpc('support_inbox');
  return {conversations:data||[],error};
}

export async function uploadSupportAttachment(userId:string,file:File){
  const ext=file.name.split('.').pop()||'bin';
  const path=`support/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const {error}=await supabase.storage.from('chat-files').upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type||undefined});
  if(error)return {url:null,error};
  const {data}=supabase.storage.from('chat-files').getPublicUrl(path);
  return {url:data.publicUrl,error:null};
}
