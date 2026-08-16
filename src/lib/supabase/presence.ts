import { supabase } from './client';

export type ChatPresence={visible:boolean;online:boolean;last_seen:string|null};

export async function touchMyPresence(online=true){
  const{data,error}=await supabase.rpc('touch_my_presence',{p_online:online});
  return{at:data as string|null,error};
}

export async function getChatPeerPresence(peerUserId:string){
  const{data,error}=await supabase.rpc('get_chat_peer_presence',{p_peer_user_id:peerUserId});
  const raw=(data||{}) as any;
  return{presence:{visible:raw.visible===true,online:raw.online===true,last_seen:raw.last_seen||null} as ChatPresence,error};
}

export function chatPresenceLabel(presence:ChatPresence|null){
  if(!presence?.visible)return null;
  if(presence.online)return'Online';
  if(!presence.last_seen)return'Last seen recently';
  const date=new Date(presence.last_seen),now=new Date();
  const sameDay=date.toDateString()===now.toDateString();
  if(sameDay)return`Last seen ${date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`;
  const yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
  if(date.toDateString()===yesterday.toDateString())return`Last seen yesterday ${date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`;
  return`Last seen ${date.toLocaleDateString([],{month:'short',day:'numeric'})}`;
}
