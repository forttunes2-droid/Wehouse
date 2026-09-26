import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import BackButton from "@/components/BackButton";
import ChatAttachmentPicker from "@/components/ChatAttachmentPicker";
import MessageMedia, { PendingMessageMedia } from "@/components/MessageMedia";
import MessagePress from "@/components/MessagePress";
import { CHAT_MEDIA_ONLY_MESSAGE, isChatVisualType } from "@/lib/chatMediaPolicy";
import { useRecordScreenBack } from "@/hooks/useRecordScreenBack";
import { supabase } from "@/lib/supabase";
import {
  deletePropertyHostMedia,
  getPropertyHostMessages,
  sendPropertyHostMessage,
  uploadPropertyHostMedia,
  type PropertyHostConversation,
  type PropertyHostMessage,
} from "@/lib/supabase/property-host-chat";
import type { Profile } from "@/types";

type Props={conversation:PropertyHostConversation;profile:Profile;onClose:()=>void;onUpdated?:()=>void};
const MAX_FILE_SIZE=25*1024*1024;

export default function PropertyHostBookingChat({conversation,profile,onClose,onUpdated}:Props){
  const [messages,setMessages]=useState<PropertyHostMessage[]>([]);
  const [input,setInput]=useState("");
  const [files,setFiles]=useState<File[]>([]);
  const [replyingTo,setReplyingTo]=useState<PropertyHostMessage|null>(null);
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState("");
  const [sending,setSending]=useState(false);
  const sendingRef=useRef(false);
  const bottomRef=useRef<HTMLDivElement>(null);
  const closeRef=useRef(onClose);closeRef.current=onClose;
  const dismiss=useRecordScreenBack(()=>closeRef.current());
  const byId=useMemo(()=>new Map(messages.map(message=>[message.id,message])),[messages]);

  const load=useCallback(async(quiet=false)=>{
    if(!quiet)setLoading(true);
    setLoadError("");
    const result=await getPropertyHostMessages(conversation.conversation_id);
    if(result.error){setLoadError("Messages could not be refreshed.");setLoading(false);return}
    setMessages(result.messages);setLoading(false);
  },[conversation.conversation_id]);

  useEffect(()=>{void load();},[load]);
  useEffect(()=>{
    const channel=supabase.channel(`property-host-chat:${conversation.conversation_id}`).on("postgres_changes",{
      event:"*",schema:"public",table:"property_host_messages",filter:`conversation_id=eq.${conversation.conversation_id}`
    },()=>{void load(true);onUpdated?.()}).subscribe();
    return()=>{void supabase.removeChannel(channel)};
  },[conversation.conversation_id,load,onUpdated]);
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth",block:"end"})},[messages.length,files.length]);

  function chooseFiles(list:FileList|null){
    if(!list)return;
    const incoming=Array.from(list).filter(file=>{
      if(!isChatVisualType(file.type)){toast.error(CHAT_MEDIA_ONLY_MESSAGE);return false}
      if(file.size>MAX_FILE_SIZE){toast.error(`${file.name} is larger than 25MB`);return false}
      return true;
    });
    setFiles(current=>[...current,...incoming].slice(0,6));
  }

  async function send(){
    if(sendingRef.current||sending||(!input.trim()&&!files.length))return;
    sendingRef.current=true;setSending(true);
    const text=input.trim(),queued=[...files],reply=replyingTo;
    setInput("");setFiles([]);setReplyingTo(null);
    const paths:string[]=[],types:string[]=[];
    try{
      for(const file of queued){
        const upload=await uploadPropertyHostMedia(conversation.conversation_id,profile.user_id,file);
        if(upload.error||!upload.path||!upload.type)throw new Error(upload.error?.message||`Could not upload ${file.name}`);
        paths.push(upload.path);types.push(file.type.startsWith("image/")?"image":"video");
      }
      const result=await sendPropertyHostMessage(conversation.conversation_id,text,paths,types,reply?.id||null);
      if(result.error||!result.messageId)throw new Error(result.error?.message||"Message could not be sent");
      await load(true);onUpdated?.();
    }catch(error){
      await Promise.allSettled(paths.map(path=>deletePropertyHostMedia(path)));
      setInput(text);setFiles(queued);setReplyingTo(reply);
      toast.error(error instanceof Error?error.message:"Message could not be sent");
    }finally{sendingRef.current=false;setSending(false)}
  }

  const context=[conversation.listing_title,conversation.stay_type==="short_let"?"Short Let":"Long Let"].filter(Boolean).join(" · ");
  return createPortal(<div role="dialog" aria-modal="true" aria-label={conversation.other_person_name} className="fixed inset-0 z-[100030] flex h-[100dvh] flex-col bg-[#090B10] text-white">
    <header className="shrink-0 border-b border-white/[.07] bg-[#0E1118]/95 px-3 py-2.5 backdrop-blur-xl"><div className="mx-auto flex max-w-3xl items-center gap-2">
      <BackButton onClick={dismiss} ariaLabel="Back to Inbox" className="!ml-0 !w-10"/>
      <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-sm font-bold text-violet-200">{conversation.other_person_avatar?<img src={conversation.other_person_avatar} alt="" className="h-full w-full object-cover"/>:(conversation.other_person_name||"H")[0]}</div>
      <div className="min-w-0 flex-1"><h1 className="truncate text-sm font-semibold">{conversation.other_person_name}</h1><p className="mt-0.5 truncate text-xs text-[#73798A]">{context}</p></div>
    </div></header>
    <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4"><div className="mx-auto max-w-3xl space-y-2">
      {loadError?<div role="alert" className="text-sm text-amber-200">{loadError}<button type="button" onClick={()=>void load()} className="ml-2 min-h-10 font-semibold text-violet-300">Try again</button></div>:null}
      {loading?<div className="min-h-48" role="status" aria-label="Loading host messages"/>:messages.length===0?<div className="py-16 text-center"><p className="text-sm font-semibold">Start the booking conversation</p><p className="mt-2 text-sm text-[#6E7484]">Coordinate arrival, access or the stay here.</p></div>:messages.map(message=>{
        const mine=message.sender_id===profile.user_id;
        const quoted=message.reply_to_id?byId.get(message.reply_to_id):null;
        return <MessagePress key={message.id} onOpen={() => setReplyingTo(message)} onReply={()=>setReplyingTo(message)} className={`flex ${mine?"justify-end":"justify-start"}`}>
          <div className={`max-w-[84%] rounded-2xl px-3 py-2.5 ${mine?"rounded-br-md bg-violet-500":"rounded-bl-md bg-[#171B24]"}`}>
            {quoted?<div className="mb-2 border-l-2 border-violet-300/70 bg-black/10 px-2 py-1.5"><p className="truncate text-xs opacity-75">{quoted.content||"Media"}</p></div>:null}
            {message.content?<p className="whitespace-pre-wrap break-words text-sm leading-5">{message.content}</p>:null}
            <MessageMedia items={message.attachments.map((url,index)=>({url,type:message.attachment_types[index]||""}))}/>
            <span className={`mt-1.5 block text-right text-xs ${mine?"text-violet-100/75":"text-[#697080]"}`}>{new Date(message.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
          </div>
        </MessagePress>;
      })}
      <div ref={bottomRef}/>
    </div></main>
    <footer className="shrink-0 border-t border-white/[.07] bg-[#0E1118] px-3 pb-[max(.65rem,env(safe-area-inset-bottom))] pt-2.5"><div className="mx-auto max-w-3xl">
      <PendingMessageMedia files={files} onRemove={index=>setFiles(current=>current.filter((_,i)=>i!==index))}/>
      {replyingTo?<div className="mb-2 flex items-center gap-3 border-l-2 border-violet-400 bg-white/[.035] px-3 py-2"><p className="min-w-0 flex-1 truncate text-sm text-[#A1A6B4]">{replyingTo.content||"Media"}</p><button type="button" onClick={()=>setReplyingTo(null)} className="h-8 w-8">×</button></div>:null}
      <div className="flex items-end gap-2"><ChatAttachmentPicker onFiles={chooseFiles}/><textarea rows={1} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send()}}} placeholder="Message" className="max-h-28 min-h-11 flex-1 resize-none rounded-3xl border border-white/[.08] bg-[#171B24] px-4 py-3 text-base outline-none focus:border-violet-500/40"/><button type="button" onClick={()=>void send()} disabled={sending||(!input.trim()&&!files.length)} aria-label="Send message" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 text-lg disabled:opacity-40">↑</button></div>
    </div></footer>
  </div>,document.body);
}
