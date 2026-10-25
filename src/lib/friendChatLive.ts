import {supabase} from './supabase/client';

/** Signals are hints only. Always reload through the authorized encrypted RPC. */
export function subscribeToFriendChatChanges(friendId:string,onChange:()=>void,onHealth:(healthy:boolean)=>void=()=>{}){
  let disposed=false;
  let channel:ReturnType<typeof supabase.channel>|undefined;
  void (async()=>{
    try{
      const {data,error}=await supabase.auth.getSession();
      if(disposed||error||!data.session?.user.id)return;
      await supabase.realtime.setAuth();
      if(disposed)return;
      channel=supabase.channel(`wehouse:friend:${data.session.user.id}`,{config:{private:true}})
        .on('broadcast',{event:'friend_chat_changed'},({payload})=>{
          if(!disposed&&payload?.friend_id===friendId&&['message','reaction'].includes(payload.kind))onChange();
        }).subscribe(status=>{
          if(disposed)return;
          onHealth(status==='SUBSCRIBED');
          if(status==='SUBSCRIBED')onChange();
        });
    }catch{if(!disposed)onHealth(false);/* Visible/focus reconciliation remains available. */}
  })();
  return()=>{disposed=true;if(channel)void supabase.removeChannel(channel);};
}
