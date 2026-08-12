import { useCallback,useEffect,useState } from 'react';
import { getAnnouncementsForUser,supabase } from '@/lib/supabase';
import VerifiedBadge from './VerifiedBadge';
import type { Profile } from '@/types';

type Props={profile:Profile;onOpen:()=>void;compact?:boolean};

export default function OfficialEntryCard({profile,onOpen,compact=false}:Props){
 const[title,setTitle]=useState('Announcements & updates'),[preview,setPreview]=useState('Official platform updates from WeHouse.'),[unread,setUnread]=useState(0),[loading,setLoading]=useState(true);
 const load=useCallback(async()=>{const{messages}=await getAnnouncementsForUser(profile.user_id);const rows=(messages||[]) as any[];setUnread(rows.filter(row=>!row.read_status).length);const latest=rows[0]?.announcements||rows[0]?.announcement;setTitle(latest?.title||'Announcements & updates');setPreview(latest?.content||'Official platform updates from WeHouse.');setLoading(false)},[profile.user_id]);
 useEffect(()=>{void load();const channel=supabase.channel(`official-entry:${profile.user_id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'announcement_recipients',filter:`user_id=eq.${profile.user_id}`},()=>void load()).on('postgres_changes',{event:'UPDATE',schema:'public',table:'announcement_recipients',filter:`user_id=eq.${profile.user_id}`},()=>void load()).subscribe();return()=>{supabase.removeChannel(channel)}},[profile.user_id,load]);
 return <button onClick={onOpen} className={`flex w-full items-center gap-3 text-left transition hover:border-blue-500/25 ${compact?'rounded-2xl border border-blue-500/10 bg-blue-500/[.045] p-3':'rounded-3xl border border-blue-500/12 bg-gradient-to-r from-blue-500/[.09] via-[#11151E] to-[#10131B] p-4'}`}><div className={`${compact?'h-11 w-11 rounded-xl':'h-12 w-12 rounded-2xl'} grid shrink-0 place-items-center bg-gradient-to-br from-blue-500 to-indigo-600 font-bold text-white shadow-lg shadow-blue-500/10`}>W</div><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><p className="truncate text-sm font-semibold">WeHouse Official</p><VerifiedBadge size={12}/></div><p className={`mt-1 truncate ${loading?'text-[#5F6374]':'text-[#C4C7D1]'} text-[10px] font-medium`}>{loading?'Checking updates…':title}</p>{!compact&&<p className="mt-1 line-clamp-1 text-[9px] text-[#686D7D]">{preview}</p>}</div>{unread>0&&<span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-full bg-blue-500 px-1.5 text-[9px] font-bold text-white">{unread>99?'99+':unread}</span>}<span className="shrink-0 text-[#5B6070]">›</span></button>
}
