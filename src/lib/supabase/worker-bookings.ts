import { supabase } from './client';
import { compressImageFile } from './utils';

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

async function signChatPath(path:string){
  if(!path||path.startsWith('http'))return path;
  const{data}=await supabase.storage.from('chat-files').createSignedUrl(path,3600);
  return data?.signedUrl||path;
}

export async function getBookingMessages(conversationId:string){
  const{data,error}=await supabase.rpc('get_booking_messages',{p_conversation_id:conversationId});
  if(error||!data)return{messages:data||[],error};
  const messages=await Promise.all((data as any[]).map(async msg=>{
    const raw=String(msg.content||'');
    const legacyFile=/\.(jpg|jpeg|png|gif|webp|pdf|mp3|wav|webm|m4a|mp4)(\?.*)?$/i.test(raw)&&!raw.startsWith('http')?await signChatPath(raw):raw;
    const attachments=await Promise.all(((msg.attachments||[]) as string[]).map(signChatPath));
    return{...msg,content:legacyFile,attachments};
  }));
  return{messages,error};
}

export async function sendBookingMessage(conversationId:string,content:string,attachments:string[]=[]){
  const{data,error}=await supabase.rpc('send_booking_message_v2',{p_conversation_id:conversationId,p_content:content,p_attachments:attachments});
  return{messageId:data,error};
}

export async function uploadBookingChatAttachment(file:File,conversationId:string){
  try{
    let upload:Blob|File=file;
    let contentType=file.type||'application/octet-stream';
    let extension=(file.name.split('.').pop()||'bin').replace(/[^a-zA-Z0-9]/g,'').toLowerCase()||'bin';
    if(file.type.startsWith('image/')){upload=await compressImageFile(file,1920,.85);contentType='image/jpeg';extension='jpg'}
    const safeBase=file.name.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,48)||'file';
    const path=`${conversationId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeBase}.${extension}`;
    const{error}=await supabase.storage.from('chat-files').upload(path,upload,{contentType,upsert:false});
    if(error)return{path:null,signedUrl:null,error};
    const{data:signed,error:signedError}=await supabase.storage.from('chat-files').createSignedUrl(path,3600);
    return{path,signedUrl:signed?.signedUrl||null,error:signedError};
  }catch(e:any){return{path:null,signedUrl:null,error:{message:e?.message||'Upload failed'} as any}}
}

export async function uploadBookingChatImage(file:File,conversationId:string){return uploadBookingChatAttachment(file,conversationId)}
export async function sendBookingImageMessage(conversationId:string,imagePath:string){return sendBookingMessage(conversationId,'',[imagePath])}

export async function workerAcceptBooking(bookingId:string,negotiatedAmount:number,scheduledDate?:string){const{data,error}=await supabase.rpc('worker_accept_booking',{p_booking_id:bookingId,p_negotiated_amount:negotiatedAmount,p_scheduled_date:scheduledDate||null});return{success:data,error}}
export async function createWorkerBookingPayment(bookingId:string){const{data,error}=await supabase.rpc('create_worker_booking_payment',{p_booking_id:bookingId});return{result:data,error}}
export async function workerStartJob(bookingId:string){const{data,error}=await supabase.rpc('worker_start_job',{p_booking_id:bookingId});return{success:data,error}}
export async function workerMarkComplete(bookingId:string){const{data,error}=await supabase.rpc('worker_mark_complete',{p_booking_id:bookingId});return{success:data,error}}
export async function customerConfirmCompletion(bookingId:string){const{data,error}=await supabase.rpc('customer_confirm_completion',{p_booking_id:bookingId});return{success:data,error}}
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
