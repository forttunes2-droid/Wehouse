import { supabase } from './client';
import { prepareChatImageFile } from './utils';
import { decryptPrivateAttachment, decryptPrivateMessage, encryptPrivateAttachment, encryptPrivateMessage, preparePrivateConversation, type EncryptedAttachment } from '@/lib/e2ee';
import { normalizeWorkerBookingRow } from '@/lib/workerBookingContract';

export async function createBookingRequest(workerId:string,serviceType:string,description:string,address:string,scheduledDate:string,customerMessage?:string){
  const{data,error}=await supabase.rpc('create_booking_request',{p_worker_id:workerId,p_service_type:serviceType,p_description:description,p_address:address,p_scheduled_date:scheduledDate,p_customer_message:customerMessage||null});
  return{booking:error?null:data||null,error};
}

function normalizeConversation(row:any){
  const normalized=normalizeWorkerBookingRow(row);
  return{...normalized,negotiated_amount:Number(normalized.negotiated_amount||0),unread_count:Number(normalized.unread_count||0)};
}

export async function getMyBookingConversations(userId:string){
  return getCommunicationBookingConversations(userId,'personal');
}

export async function getCommunicationBookingConversations(userId:string,workspace:'personal'|'worker'='worker'){
  void userId; // The server derives the person from the authenticated session.
  const{data,error}=await supabase.rpc('get_my_workspace_inbox',{p_workspace:workspace,p_kind:'service'});
  return{conversations:(data||[]).map(normalizeConversation),error};
}

export async function markBookingMessagesRead(conversationId:string){
  const{error}=await supabase.rpc('mark_my_booking_messages_read',{p_conversation_id:conversationId});
  if(!error&&typeof window!=='undefined')window.dispatchEvent(new Event('wehouse:unread-changed'));
  return{error};
}

export async function hideBookingConversation(conversationId:string){
  const{data,error}=await supabase.rpc('hide_my_booking_conversation',{p_conversation_id:conversationId});
  return{hidden:data===true,error};
}

export async function getUserActiveBookings(userId:string){
  const{conversations,error}=await getMyBookingConversations(userId);
  if(error)return{bookings:[],error};
  const terminal=new Set(['cancelled','refunded','approved_released']);
  const bookings=(conversations||[]).filter((row:any)=>!terminal.has(row.booking_status)).map((row:any)=>({id:row.booking_id,worker_id:row.other_person_id,status:row.booking_status,money_state:row.money_state}));
  return{bookings,error:null};
}

export async function getBookingMessages(conversationId:string,peerUserId?:string|null){
  if(peerUserId)preparePrivateConversation('worker',conversationId,peerUserId);
  const{data,error}=await supabase.rpc('get_private_encrypted_messages',{p_conversation_kind:'worker',p_conversation_id:conversationId});
  if(error||!data)return{messages:data||[],error};
  const legacyPaths=Array.from(new Set((data as any[]).flatMap(msg=>Array.isArray(msg.legacy_attachments)?msg.legacy_attachments.filter(Boolean):[]))) as string[];
  const signed=legacyPaths.length?await supabase.storage.from('chat-files').createSignedUrls(legacyPaths,300):{data:[],error:null};
  const legacyUrls=new Map((signed.data||[]).map(item=>[item.path,item.signedUrl||'']));
  const messages=await Promise.all((data as any[]).map(async msg=>{
    let content=String(msg.legacy_content||'');
    let decryptionFailed=false;
    if(msg.ciphertext&&msg.encryption_iv&&peerUserId){
      try{content=await decryptPrivateMessage('worker',conversationId,peerUserId,msg.ciphertext,msg.encryption_iv)}catch{decryptionFailed=true;content='🔒 Message locked on this device'}
    }
    // Keep authenticated metadata next to the decrypted URL. Blob URLs have no
    // extension: discarding MIME turns voice notes and photos into documents.
    const media:{url:string;type:string;name:string}[]=(Array.isArray(msg.legacy_attachments)?msg.legacy_attachments:[])
      .flatMap((path:string)=>{const url=legacyUrls.get(path);return url?[{url,type:'',name:''}]:[]});
    let attachmentFailed=Boolean(signed.error && msg.legacy_attachments?.length) || media.length < (Array.isArray(msg.legacy_attachments)?msg.legacy_attachments.length:0);
    if(peerUserId){
      const decrypted=await Promise.all((Array.isArray(msg.encrypted_attachments)?msg.encrypted_attachments:[]).map(async(item:any)=>{
        try{return await decryptPrivateAttachment('worker',conversationId,peerUserId,item as EncryptedAttachment)}
        catch{return null}
      }));
      for(const item of decrypted){
        if(!item?.url){attachmentFailed=true;continue}
        media.push({url:item.url,type:typeof item.type==='string'?item.type:'',name:typeof item.name==='string'?item.name:''});
      }
    }
    return{...msg,content,decryption_failed:decryptionFailed,attachments:media.map(item=>item.url),attachment_types:media.map(item=>item.type),attachment_names:media.map(item=>item.name),attachment_failed:attachmentFailed,is_read:Boolean(msg.is_read)};
  }));
  return{messages,error};
}

export async function reactToBookingMessage(
  conversationId: string,
  messageId: string,
  emoji: string | null,
) {
  const { data, error } = await supabase.rpc("set_private_message_reaction", {
    p_conversation_kind: "worker",
    p_conversation_id: conversationId,
    p_message_id: messageId,
    p_emoji: emoji,
  });
  return { reactions: (data || {}) as Record<string, string>, error };
}

export async function sendBookingMessage(conversationId:string,peerUserId:string,content:string,attachments:EncryptedAttachment[]=[],replyToId:string|null=null){
  try{
    const encrypted=await encryptPrivateMessage('worker',conversationId,peerUserId,content);
    const{data,error}=await supabase.rpc('send_private_encrypted_message',{p_conversation_kind:'worker',p_conversation_id:conversationId,p_ciphertext:encrypted.ciphertext,p_encryption_iv:encrypted.iv,p_encrypted_attachments:attachments,p_reply_to_id:replyToId});
    return{messageId:data,error};
  }catch(error:any){return{messageId:null,error:{message:error?.message||'Encrypted message could not be sent'} as any}}
}

export async function uploadBookingChatAttachment(file:File,conversationId:string,peerUserId:string){
  try{
    let upload:Blob|File=file;
    let contentType=file.type||'application/octet-stream';
    let extension=(file.name.split('.').pop()||'bin').replace(/[^a-zA-Z0-9]/g,'').toLowerCase()||'bin';
    if(file.type.startsWith('image/')){const prepared=await prepareChatImageFile(file);upload=prepared.body;contentType=prepared.contentType;extension=prepared.extension}
    const safeBase=file.name.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,48)||'file';
    const encrypted=await encryptPrivateAttachment('worker',conversationId,peerUserId,upload,{name:`${safeBase}.${extension}`,type:contentType});
    const path=`e2ee/worker/${conversationId}/${Date.now()}-${crypto.randomUUID()}.bin`;
    const{error}=await supabase.storage.from('chat-files').upload(path,encrypted.blob,{contentType:'application/octet-stream',upsert:false});
    return{path:error?null:path,attachment:error?null:{path,file_iv:encrypted.file_iv,metadata_ciphertext:encrypted.metadata_ciphertext,metadata_iv:encrypted.metadata_iv},signedUrl:null,error};
  }catch(e:any){return{path:null,signedUrl:null,error:{message:e?.message||'Upload failed'} as any}}
}

export async function workerAcceptBooking(bookingId:string,negotiatedAmount:number,scheduledDate?:string){const{data,error}=await supabase.rpc('worker_accept_booking',{p_booking_id:bookingId,p_negotiated_amount:negotiatedAmount,p_scheduled_date:scheduledDate||null});return{success:data,error}}
export async function createWorkerBookingPayment(bookingId:string){const{data,error}=await supabase.rpc('create_worker_booking_payment',{p_booking_id:bookingId});return{result:data,error}}
export async function workerStartJob(bookingId:string){const{data,error}=await supabase.rpc('worker_start_job',{p_booking_id:bookingId});return{success:data,error}}
export async function workerMarkComplete(bookingId:string){const{data,error}=await supabase.rpc('worker_mark_complete',{p_booking_id:bookingId});return{success:data,error}}
export async function customerConfirmCompletion(bookingId:string){const{data,error}=await supabase.rpc('customer_confirm_completion',{p_booking_id:bookingId});return{success:data,error}}
export async function getMyWorkerBookingReview(bookingId:string){const{data,error}=await supabase.rpc('get_my_worker_booking_review',{p_booking_id:bookingId});return{review:data||null,error}}
export async function submitWorkerBookingReview(bookingId:string,rating:number,comment:string){const{data,error}=await supabase.rpc('submit_my_worker_booking_review',{p_booking_id:bookingId,p_rating:rating,p_comment:comment||null});return{review:data||[],error}}
export async function getPublicWorkerReviews(workerId:string){const{data,error}=await supabase.rpc('get_public_worker_reviews',{p_worker_id:workerId,p_limit:20});return{reviews:data||[],error}}
export async function customerRaiseDispute(bookingId:string,reason:string){const{data,error}=await supabase.rpc('customer_raise_dispute',{p_booking_id:bookingId,p_reason:reason});return{success:data,error}}
export async function cancelBooking(bookingId:string,reason:string){const{data,error}=await supabase.rpc('cancel_booking',{p_booking_id:bookingId,p_reason:reason});return{success:data,error}}

export async function getBookingDetails(bookingId:string){
  const{data,error}=await supabase.rpc('get_my_worker_booking_details',{p_booking_id:bookingId});
  return{booking:error||!data?null:normalizeWorkerBookingRow(data as any),error};
}

export { BOOKING_STATUS_LABELS } from '@/lib/workerBookingContract';
