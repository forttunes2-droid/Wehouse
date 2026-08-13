import { supabase } from './client';
import type { Conversation,Message } from '@/types';

export type RoommatePeer={user_id:string;name:string;avatar:string|null};

// Canonical generic chat is now roommate-only.
// Worker booking chat and human WeHouse Support use their own workflow APIs.
export async function getConversations(userId:string){
  const{data,error}=await supabase.rpc('get_user_conversations',{p_user_id:userId});
  return{conversations:(data||[]) as Conversation[],error};
}

// Safe peer identity comes from the roommate-match backend projection instead
// of granting cross-user reads on the full profiles table.
export async function getRoommateConversationPeople(){
  const{data,error}=await supabase.rpc('get_my_roommate_matches');
  const people:Record<string,RoommatePeer>={};
  for(const row of data||[]){
    if(!row.matched_user_id)continue;
    people[row.matched_user_id]={
      user_id:row.matched_user_id,
      name:row.full_name||row.username||'Roommate',
      avatar:row.avatar_url||null,
    };
  }
  return{people,error};
}

export async function getMessages(conversationId:string){
  const{data,error}=await supabase.rpc('get_conversation_messages',{p_conversation_id:conversationId});
  return{messages:(data||[]) as Message[],error};
}

export async function sendMessage(conversationId:string,content:string){
  const{data,error}=await supabase.rpc('send_my_roommate_message',{p_conversation_id:conversationId,p_content:content});
  return{message:(data||null) as Message|null,error};
}

export async function markMessagesSeen(conversationId:string){
  const{error}=await supabase.rpc('mark_my_conversation_seen',{p_conversation_id:conversationId});
  return{error};
}
