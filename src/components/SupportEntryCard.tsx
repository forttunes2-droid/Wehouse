import { useCallback,useEffect,useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getMySupportConversations } from '@/lib/supabase/support';
import type { Profile } from '@/types';

type Props={profile:Profile;compact?:boolean};

export default function SupportEntryCard({profile,compact=false}:Props){
 const[preview,setPreview]=useState('Message a real WeHouse support team member.'),[unread,setUnread]=useState(0),[time,setTime]=useState<string|null>(null),[conversationId,setConversationId]=useState<string|null>(null);
 const load=useCallback(async()=>{const{conversations}=await getMySupportConversations();const row=conversations?.[0];setConversationId(row?.conversation_id||null);setPreview(row?.last_message||'Message a real WeHouse support team member.');setUnread(Number(row?.unread_count||0));setTime(row?.last_message_time||row?.created_at||null)},[profile.user_id]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{if(!conversationId)return;const channel=supabase.channel(`support-entry:${conversationId}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'partner_support_messages',filter:`conversation_id=eq.${conversationId}`},()=>void load()).on('postgres_changes',{event:'UPDATE',schema:'public',table:'partner_support_messages',filter:`conversation_id=eq.${conversationId}`},()=>void load()).subscribe();return()=>{void supabase.removeChannel(channel)}},[conversationId,load]);
 function open(){window.dispatchEvent(new CustomEvent('openSupportChat'))}
 const inner=<><div className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 font-bold text-white shadow-lg shadow-violet-500/10">S<span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[#11141C] bg-emerald-400"/></div><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-white">WeHouse Support</p><p className={`mt-1 truncate text-[11px] ${unread?'font-medium text-[#E3E5EB]':'text-[#777C8D]'}`}>{preview}</p><p className="mt-0.5 truncate text-[9px] text-[#5F6474]">Human support · text, photos and documents</p></div><div className="shrink-0 self-start pt-0.5 text-right">{time&&<p className={`text-[8px] ${unread?'text-violet-300':'text-[#555A6B]'}`}>{formatTime(time)}</p>}{unread>0&&<span className="ml-auto mt-2 grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold text-white">{unread>99?'99+':unread}</span>}</div></>;
 return <button onClick={open} className={compact?'flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[.025]':'flex w-full items-center gap-3 rounded-2xl border border-white/[.06] bg-[#11141C] p-4 text-left transition hover:border-violet-500/20'}>{inner}</button>
}
function formatTime(value:string){const d=new Date(value),now=new Date();if(d.toDateString()===now.toDateString())return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});const days=Math.floor((now.getTime()-d.getTime())/86400000);if(days===1)return'Yesterday';if(days<7)return d.toLocaleDateString([],{weekday:'short'});return d.toLocaleDateString([],{month:'short',day:'numeric'})}
