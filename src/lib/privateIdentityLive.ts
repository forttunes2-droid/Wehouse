import {supabase} from './supabase/client';
import {invalidatePrivateMessagingSession} from './privateMessagingSession';

/** One private signal per identity rotation; no per-message/PIN/typing polling. */
export function subscribeToPrivateIdentityChanges(peerUserId:string,onChange:()=>void){
 let disposed=false,lastVersion=0;
 let channel:ReturnType<typeof supabase.channel>|undefined;
 void (async()=>{
  try{
   const {data,error}=await supabase.auth.getSession();
   if(disposed||error||!data.session?.user.id)return;
   await supabase.realtime.setAuth();if(disposed)return;
   channel=supabase.channel(`wehouse:e2ee-key:${peerUserId}`,{config:{private:true}})
    .on('broadcast',{event:'e2ee_identity_changed'},({payload})=>{
     if(disposed||payload?.user_id!==peerUserId||!Number.isSafeInteger(payload.key_version)||payload.key_version<=lastVersion)return;
     lastVersion=payload.key_version;invalidatePrivateMessagingSession('identity');onChange();
    }).subscribe();
  }catch{/* Existing visible/focus recovery remains available if Realtime is offline. */}
 })();
 return()=>{disposed=true;if(channel)void supabase.removeChannel(channel);};
}
