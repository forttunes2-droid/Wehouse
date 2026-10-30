import { useEffect,useState } from 'react';
import { getChatPeerPresence,touchMyPresence,type ChatPresence } from '@/lib/supabase/presence';

export default function useChatPresence(peerUserId?:string|null){
  const[presence,setPresence]=useState<ChatPresence|null>(null);
  useEffect(()=>{
    if(!peerUserId){setPresence(null);return}
    let live=true,pending=false;
    setPresence(null);
    async function refresh(markOnline=true){
      if(!live||pending||document.visibilityState!=='visible')return;
      pending=true;
      try{
        if(markOnline)await touchMyPresence(true);
        if(!live||document.visibilityState!=='visible')return;
        const{presence:next,error}=await getChatPeerPresence(peerUserId!);
        if(live)setPresence(error?null:next);
      }catch{if(live)setPresence(null);}finally{pending=false;}
    }
    void refresh(true);
    const timer=window.setInterval(()=>void refresh(true),45000);
    const visibility=()=>{
      if(document.visibilityState==='visible')void refresh(true);
      else {setPresence(null);void touchMyPresence(false).catch(()=>{});}
    };
    document.addEventListener('visibilitychange',visibility);
    return()=>{
      live=false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange',visibility);
      void touchMyPresence(false).catch(()=>{});
    };
  },[peerUserId]);
  return presence;
}
