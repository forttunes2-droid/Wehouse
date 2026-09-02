import { supabase } from './client';
import { compressImageFile } from './utils';
import { decryptPrivateAttachment, decryptPrivateMessage, encryptPrivateAttachment, encryptPrivateMessage, type EncryptedAttachment } from '@/lib/e2ee';

export async function createBookingRequest(workerId:string,serviceType:string,description:string,address:string,scheduledDate:string,customerMessage?:string){
  const{data,error}=await supabase.rpc('create_booking_request',{p_worker_id:workerId,p_service_type:serviceType,p_description:description,p_address:address,p_scheduled_date:scheduledDate,p_customer_message:customerMessage||null});
  return{booking:error?null:data||null,error};
}

export async function getMyBookingConversations(userId:string){
  const{data,error}=await supabase.rpc('get_my_booking_conversations_v2',{p_user_id:userId});
  return{conversations:(data||[]).map((row:any)=>({...row,negotiated_amount:Number(row.negotiated_amount||0),unread_count:Number(row.unread_count||0)})),error};
}

export async function getCommunicationBookingConversations(userId:string){
  const{data,error}=await supabase.rpc('get_my_booking_conversations_v2',{p_user_id:userId});
  return{conversations:(data||[]).map((row:any)=>({...row,negotiated_amount:Number(row.negotiated_amount||0),unread_count:Number(row.unread_count||0)})),error};
}

export async function markBookingMessagesRead(conversationId:string){
  const{error}=await supabase.rpc('mark_my_booking_messages_read',{p_conversation_id:conversationId});
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
  const bookings=(conversations||[]).filter((row:any)=>!terminal.has(row.booking_status)).map((row:any)=>({id:row.booking_id,worker_id:row.other_person_id,status:row.booking_status}));
  return{bookings,error:null};
}

export async function getBookingMessages(conversationId:string,peerUserId?:string|null){
  const{data,error}=await supabase.rpc('get_private_encrypted_messages',{p_conversation_kind:'worker',p_conversation_id:conversationId});
  if(error||!data)return{messages:data||[],error};
  const messages=await Promise.all((data as any[]).map(async msg=>{
    let content=String(msg.legacy_content||'');
    if(msg.ciphertext&&msg.encryption_iv&&peerUserId){
      try{content=await decryptPrivateMessage('worker',conversationId,peerUserId,msg.ciphertext,msg.encryption_iv)}catch{content='🔒 Encrypted message · unlock with your Recovery PIN'}
    }
    const attachments:string[]=[];
    if(peerUserId)for(const item of Array.isArray(msg.encrypted_attachments)?msg.encrypted_attachments:[]){try{const clear=await decryptPrivateAttachment('worker',conversationId,peerUserId,item as EncryptedAttachment);attachments.push(clear.url)}catch{/* Message content remains available if a file cannot be opened. */}}
    return{...msg,content,attachments,is_read:Boolean(msg.is_read)};
  }));
  return{messages,error};
}

export async function sendBookingMessage(conversationId:string,peerUserId:string,content:string,attachments:EncryptedAttachment[]=[]){
  try{
    const encrypted=await encryptPrivateMessage('worker',conversationId,peerUserId,content);
    const{data,error}=await supabase.rpc('send_private_encrypted_message',{p_conversation_kind:'worker',p_conversation_id:conversationId,p_ciphertext:encrypted.ciphertext,p_encryption_iv:encrypted.iv,p_encrypted_attachments:attachments});
    return{messageId:data,error};
  }catch(error:any){return{messageId:null,error:{message:error?.message||'Encrypted message could not be sent'} as any}}
}

export async function uploadBookingChatAttachment(file:File,conversationId:string,peerUserId:string){
  try{
    let upload:Blob|File=file;
    let contentType=file.type||'application/octet-stream';
    let extension=(file.name.split('.').pop()||'bin').replace(/[^a-zA-Z0-9]/g,'').toLowerCase()||'bin';
    if(file.type.startsWith('image/')){upload=await compressImageFile(file,1920,.85);contentType='image/jpeg';extension='jpg'}
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
export async function submitWorkerBookingReview(bookingId:string,rating:number,comment:string){const{data,error}=await supabase.rpc('submit_my_worker_booking_review',{p_booking_id:bookingId,p_rating:rating,p_comment:comment||null});return{review:data||null,error}}
export async function getPublicWorkerReviews(workerId:string){const{data,error}=await supabase.rpc('get_public_worker_reviews',{p_worker_id:workerId,p_limit:20});return{reviews:data||[],error}}
export async function customerRaiseDispute(bookingId:string,reason:string){const{data,error}=await supabase.rpc('customer_raise_dispute',{p_booking_id:bookingId,p_reason:reason});return{success:data,error}}
export async function cancelBooking(bookingId:string,reason:string){const{data,error}=await supabase.rpc('cancel_booking',{p_booking_id:bookingId,p_reason:reason});return{success:data,error}}

export async function getBookingDetails(bookingId:string){
  const{data,error}=await supabase.rpc('get_my_worker_booking_details',{p_booking_id:bookingId});
  return{booking:error?null:data||null,error};
}

export const BOOKING_STATUS_LABELS:Record<string,{label:string;color:string;description:string}>={
  booking_requested:{label:'Booking Requested',color:'bg-amber-500/10 text-amber-400',description:'Waiting for the Worker to respond'},
  negotiating:{label:'Negotiating',color:'bg-blue-500/10 text-blue-400',description:'Discussing the job, schedule and price'},
  waiting_payment:{label:'Waiting for Payment',color:'bg-purple-500/10 text-purple-400',description:'Worker accepted; customer needs to pay'},
  confirmed:{label:'Confirmed',color:'bg-emerald-500/10 text-emerald-400',description:'Payment received; ready to start'},
  in_progress:{label:'In Progress',color:'bg-indigo-500/10 text-indigo-400',description:'The job is underway'},
  completed_pending_approval:{label:'Pending Approval',color:'bg-orange-500/10 text-orange-400',description:'Worker marked complete; customer confirmation is pending'},
  approved_released:{label:'Completed',color:'bg-emerald-500/10 text-emerald-400',description:'Job completed and payment released'},
  disputed:{label:'Disputed',color:'bg-red-500/10 text-red-400',description:'WeHouse is reviewing the dispute'},
  cancelled:{label:'Cancelled',color:'bg-gray-500/10 text-gray-400',description:'Booking cancelled'},
  refunded:{label:'Refunded',color:'bg-gray-500/10 text-gray-400',description:'Payment refunded'},
};
