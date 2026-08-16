import { useEffect,useState } from 'react';
import { getChatPeerPresence,touchMyPresence,type ChatPresence } from '@/lib/supabase/presence';

export default function useChatPresence(peerUserId?:string|null){
  const[presence,setPresence]=useState<ChatPresence|null>(null);
  useEffect(()=>{
    if(!peerUserId){setPresence(null);return}
    let live=true;
    async function refresh(markOnline=true){
      if(markOnline)await touchMyPresence(true);
      const{presence:next}=await getChatPeerPresence(peerUserId!);
      if(live)setPresence(next);
    }
    void refresh(true);
    const timer=window.setInterval(()=>void refresh(true),45000);
    const visibility=()=>{
      if(document.visibilityState==='visible')void refresh(true);
      else void touchMyPresence(false);
    };
    document.addEventListener('visibilitychange',visibility);
    return()=>{
      live=false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange',visibility);
      void touchMyPresence(false);
    };
  },[peerUserId]);
  return presence;
}
