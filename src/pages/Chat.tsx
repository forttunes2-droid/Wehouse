import { useCallback,useEffect,useRef,useState } from 'react';
import { supabase,getConversations,getMessages,sendMessage,markMessagesSeen } from '@/lib/supabase';
import { getRoommateConversationPeople } from '@/lib/supabase/chat';
import OfficialChannel from '@/components/OfficialChannel';
import OfficialEntryCard from '@/components/OfficialEntryCard';
import SupportEntryCard from '@/components/SupportEntryCard';
import { toast } from 'sonner';
import type { Conversation,Message,Profile } from '@/types';

type Props={profile:Profile;onNavigate:(page:string)=>void;conversationId?:string|null};
type Person={name:string;avatar:string|null};

export default function Chat({profile,onNavigate,conversationId}:Props){
 const[conversations,setConversations]=useState<Conversation[]>([]),[active,setActive]=useState<Conversation|null>(null),[messages,setMessages]=useState<Message[]>([]),[people,setPeople]=useState<Record<string,Person>>({}),[input,setInput]=useState(''),[loading,setLoading]=useState(true),[sending,setSending]=useState(false),[officialOpen,setOfficialOpen]=useState(false);
 const bottomRef=useRef<HTMLDivElement>(null);
 const otherId=(conv:Conversation)=>conv.participant_a===profile.user_id?conv.participant_b:conv.participant_a;
 const unread=(conv:Conversation)=>Number(conv.participant_a===profile.user_id?conv.unread_a:conv.unread_b)||0;

 const loadConversations=useCallback(async()=>{
  const[convResult,peerResult]=await Promise.all([getConversations(profile.user_id),getRoommateConversationPeople()]);
  if(convResult.error){toast.error(convResult.error.message||'Unable to load messages');setConversations([]);setPeople({});setLoading(false);return[] as Conversation[]}
  const rows=(convResult.conversations||[]).filter(row=>row.conversation_type==='roommate');
  setConversations(rows);setPeople(peerResult.people||{});setLoading(false);return rows;
 },[profile.user_id]);

 useEffect(()=>{void loadConversations()},[loadConversations]);
 useEffect(()=>{if(!conversationId)return;void(async()=>{const rows=await loadConversations();const found=rows.find(row=>row.id===conversationId);if(found)setActive(found)})()},[conversationId,loadConversations]);
 useEffect(()=>{if(!active){setMessages([]);return}void openConversation(active);const channel=supabase.channel(`roommate-chat-${active.id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`conversation_id=eq.${active.id}`},payload=>{const next=payload.new as Message;setMessages(current=>current.some(row=>row.id===next.id)?current:[...current,next]);void markMessagesSeen(active.id)}).subscribe();return()=>{void supabase.removeChannel(channel)}},[active?.id]);
 useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:'smooth'})},[messages.length]);

 async function openConversation(conv:Conversation){setActive(conv);const result=await getMessages(conv.id);if(result.error){toast.error(result.error.message||'Unable to open conversation');return}setMessages(result.messages||[]);await markMessagesSeen(conv.id)}
 async function submit(){const text=input.trim();if(!active||!text||sending)return;setSending(true);const result=await sendMessage(active.id,text);setSending(false);if(result.error||!result.message){toast.error(result.error?.message||'Message could not be sent');return}setInput('');setMessages(current=>current.some(row=>row.id===result.message!.id)?current:[...current,result.message!])}

 if(officialOpen)return <OfficialChannel profile={profile} onBack={()=>setOfficialOpen(false)}/>;
 if(active){const person=people[otherId(active)];return <div className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-[#090A0F] text-white"><header className="flex items-center gap-3 border-b border-white/[.06] bg-[#10131B] px-3 py-3 sm:px-4"><button onClick={()=>setActive(null)} className="grid h-10 w-10 place-items-center rounded-full text-[#9699A8] hover:bg-white/[.05]">←</button><Avatar person={person}/><div className="min-w-0"><p className="truncate text-sm font-semibold">{person?.name||'Roommate match'}</p><p className="mt-0.5 text-[9px] text-[#676B7B]">Roommate conversation</p></div></header><main className="flex-1 space-y-2 overflow-y-auto px-3 py-4 sm:px-4">{messages.length===0&&<Empty title="Start your conversation" text="You both accepted the roommate match. Use this chat to discuss living plans directly."/>}{messages.map(msg=>{const mine=msg.sender_id===profile.user_id;return <div key={msg.id} className={`flex ${mine?'justify-end':'justify-start'}`}><div className={`max-w-[84%] rounded-[19px] px-3.5 py-2.5 text-xs leading-relaxed sm:max-w-[68%] ${mine?'rounded-br-md bg-blue-500':'rounded-bl-md border border-white/[.06] bg-[#151821]'}`}><p className="whitespace-pre-wrap">{msg.content}</p><p className={`mt-1 text-[8px] ${mine?'text-blue-100/70':'text-[#626677]'}`}>{time(msg.created_at)}{mine&&msg.seen?' · Seen':''}</p></div></div>})}<div ref={bottomRef}/></main><footer className="border-t border-white/[.06] bg-[#10131B] px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-4"><div className="flex items-end gap-2"><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void submit()}}} rows={1} placeholder="Message" className="max-h-28 min-h-11 min-w-0 flex-1 resize-none rounded-[22px] border border-white/[.08] bg-[#181B24] px-3 py-3 text-sm outline-none focus:border-blue-500/40"/><button onClick={()=>void submit()} disabled={!input.trim()||sending} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-500 disabled:opacity-35">➤</button></div></footer></div>}

 const totalUnread=conversations.reduce((sum,row)=>sum+unread(row),0);
 return <div className="min-h-[100dvh] bg-[#090A0F] pb-24 text-white"><header className="border-b border-white/[.06] bg-[#0E1118] px-4 py-4"><div className="mx-auto flex max-w-3xl items-center gap-3"><button onClick={()=>onNavigate('home')} className="grid h-10 w-10 place-items-center rounded-full text-[#8C909F] hover:bg-white/[.05]">←</button><div className="min-w-0 flex-1"><h1 className="text-lg font-bold">Messages</h1><p className="mt-0.5 text-[10px] text-[#65697A]">Official updates, Human Support and roommate conversations</p></div>{totalUnread>0&&<span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[9px] font-semibold text-blue-300">{totalUnread} new</span>}</div></header><main className="mx-auto max-w-3xl px-4 py-4"><section className="overflow-hidden rounded-2xl border border-white/[.06] bg-[#11141C]"><OfficialEntryCard profile={profile} compact onOpen={()=>setOfficialOpen(true)}/><Divider/><SupportEntryCard profile={profile} compact/>{conversations.length>0&&<Divider/>}{loading?<Loading/>:conversations.map((conv,index)=>{const person=people[otherId(conv)],count=unread(conv);return <div key={conv.id}>{index>0&&<Divider/>}<button onClick={()=>void openConversation(conv)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[.025]"><Avatar person={person}/><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold">{person?.name||'Roommate match'}</p><p className={`mt-1 truncate text-[11px] ${count?'font-medium text-[#E3E5EB]':'text-[#777C8D]'}`}>{conv.last_message||'Start the conversation'}</p><p className="mt-0.5 text-[9px] text-[#5F6474]">Roommate match</p></div>{count>0&&<span className="grid h-5 min-w-5 place-items-center rounded-full bg-blue-500 px-1 text-[8px] font-bold">{count>9?'9+':count}</span>}</button></div>})}</section>{!loading&&conversations.length===0&&<p className="mt-4 text-[9px] leading-relaxed text-[#555A69]">Roommate conversations appear after both people accept a match.</p>}</main></div>;
}

function Avatar({person}:{person?:Person}){return <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-500/15 font-semibold text-blue-300">{person?.avatar?<img src={person.avatar} alt="" className="h-full w-full object-cover"/>:(person?.name||'R')[0]}</div>}
function Divider(){return <div className="ml-[4.5rem] h-px bg-white/[.05]"/>}
function Loading(){return <div className="grid min-h-24 place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"/></div>}
function Empty({title,text}:{title:string;text:string}){return <div className="mx-auto mt-12 max-w-sm rounded-2xl border border-dashed border-white/[.08] px-5 py-10 text-center"><p className="text-sm font-semibold">{title}</p><p className="mt-2 text-[10px] leading-relaxed text-[#666A7A]">{text}</p></div>}
function time(value:string){return new Date(value).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
