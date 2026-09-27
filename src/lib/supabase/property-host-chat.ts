import { validateChatUpload, normaliseChatMediaType } from "@/lib/chatMediaPolicy";
import { prepareChatImageFile } from "./utils";
import { supabase } from "./client";

export type PropertyHostConversation = {
  conversation_id: string;
  reservation_id: string;
  status: string;
  updated_at: string;
  stay_type: string;
  booking_status: string;
  stay_check_in?: string | null;
  stay_check_out?: string | null;
  requested_move_in_at?: string | null;
  listing_title: string;
  listing_address?: string | null;
  listing_city?: string | null;
  listing_state?: string | null;
  other_person_id: string;
  other_person_name: string;
  other_person_avatar?: string | null;
  last_message?: string | null;
  last_attachment_types?: string[] | null;
  last_message_time?: string | null;
  unread_count: number;
};

export type PropertyHostMessage = {
  id: string;
  sender_id: string;
  content?: string | null;
  attachments: string[];
  attachment_types: string[];
  reply_to_id?: string | null;
  reactions?: Record<string,string>;
  is_read: boolean;
  created_at: string;
};

export async function getMyPropertyHostConversations() {
  const {data,error}=await supabase.rpc("get_my_property_host_conversations");
  return {
    conversations: ((data || []) as PropertyHostConversation[]).map(row=>({...row,unread_count:Number(row.unread_count||0)})),
    error,
  };
}

export async function ensurePropertyHostConversation(reservationId:string) {
  const {data,error}=await supabase.rpc("ensure_property_host_conversation",{p_reservation_id:reservationId});
  return {conversationId:data as string|null,error};
}

export async function getPropertyHostMessages(conversationId:string) {
  const {data,error}=await supabase.rpc("get_property_host_messages",{p_conversation_id:conversationId});
  if(error)return {messages:[] as PropertyHostMessage[],error};
  const rows=(data||[]) as any[];
  const messages=await Promise.all(rows.map(async row=>{
    const files=await Promise.all((row.attachments||[]).map(async(path:string,index:number)=>{
      const {data:signed,error:signedError}=await supabase.storage.from("property-host-chat-files").createSignedUrl(path,300);
      return signedError||!signed?.signedUrl?null:{url:signed.signedUrl,type:row.attachment_types?.[index]||""};
    }));
    const available=files.filter((file):file is {url:string;type:string}=>Boolean(file));
    return {
      id:String(row.message_id),
      sender_id:String(row.sender_id),
      content:row.content,
      attachments:available.map(file=>file.url),
      attachment_types:available.map(file=>file.type),
      reply_to_id:row.reply_to_id,
      reactions:row.reactions||{},
      is_read:Boolean(row.is_read),
      created_at:String(row.created_at),
    } satisfies PropertyHostMessage;
  }));
  return {messages,error:null};
}

export async function sendPropertyHostMessage(conversationId:string,content:string,attachments:string[]=[],types:string[]=[],replyToId:string|null=null){
  const {data,error}=await supabase.rpc("send_property_host_message",{
    p_conversation_id:conversationId,p_content:content,p_attachments:attachments,p_attachment_types:types,p_reply_to_id:replyToId
  });
  return {messageId:data as string|null,error};
}

export async function uploadPropertyHostMedia(conversationId:string,userId:string,file:File){
  try{await validateChatUpload(file)}catch(error){return {path:null,type:null,error:{message:error instanceof Error?error.message:"Choose a photo or video."}}}
  let upload:Blob|File=file;
  let contentType=normaliseChatMediaType(file.type);
  let extension=(file.name.split(".").pop()||"bin").replace(/[^a-zA-Z0-9]/g,"").toLowerCase();
  if(file.type.startsWith("image/")){
    const prepared=await prepareChatImageFile(file);
    upload=prepared.body;contentType=prepared.contentType;extension=prepared.extension;
  }
  const path=`${conversationId}/${userId}/${Date.now()}-${crypto.randomUUID()}.${extension||"bin"}`;
  const {error}=await supabase.storage.from("property-host-chat-files").upload(path,upload,{contentType,cacheControl:"3600",upsert:false});
  return {path:error?null:path,type:contentType,error};
}

export async function deletePropertyHostMedia(path:string){
  const {error}=await supabase.storage.from("property-host-chat-files").remove([path]);
  return {error};
}
