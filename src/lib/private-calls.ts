import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/withTimeout';

export type PrivateCallType='audio'|'video';
export type PrivateCallContext='roommate'|'worker_booking';
export type PrivateCallStatus='ringing'|'accepted'|'declined'|'missed'|'ended'|'failed';
export type PrivateCall={id:string;context_type:PrivateCallContext;context_id:string;caller_id:string;callee_id:string;call_type:PrivateCallType;status:PrivateCallStatus;created_at:string;answered_at?:string|null;ended_at?:string|null;peer_id?:string;peer_name?:string;peer_avatar?:string|null;incoming?:boolean};
export type CallCapabilities={peer_id:string;peer_name:string;peer_avatar:string|null;allow_audio_calls:boolean;allow_video_calls:boolean};
export type CallPreferences={allow_audio_calls:boolean;allow_video_calls:boolean};
export type CallSignal={id:string;call_id:string;sender_id:string;signal_type:'offer'|'answer'|'ice';payload:any;created_at:string};
export type PrivateCallIce={iceServers:RTCIceServer[];relayReady:boolean};

export function launchPrivateCall(contextType:PrivateCallContext,contextId:string,callType:PrivateCallType){
  window.dispatchEvent(new CustomEvent('wehouse:start-private-call',{detail:{contextType,contextId,callType}}));
}

type Receipt={data:any;error:any};
async function bounded(task:()=>PromiseLike<Receipt>):Promise<Receipt>{
 try{return await withTimeout(task(),12000,'Call request timed out. Check the call status before trying again.');}
 catch(reason){return {data:null,error:{message:reason instanceof Error?reason.message:'Call request failed'}};}
}
const preferencesValid=(value:any):value is CallPreferences=>value && typeof value.allow_audio_calls==='boolean' && typeof value.allow_video_calls==='boolean';
const callValid=(value:any):value is PrivateCall=>value && typeof value.id==='string' && typeof value.caller_id==='string' && typeof value.callee_id==='string'
 && ['audio','video'].includes(value.call_type) && ['ringing','accepted','declined','missed','ended','failed'].includes(value.status);
const invalid=()=>({message:'The call response could not be confirmed. Refresh and try again.'});
async function callRpc(name:string,args?:Record<string,unknown>){
 const result=await bounded(()=>supabase.rpc(name,args));
 const valid=callValid(result.data)&&(!args?.p_call_id||result.data.id===args.p_call_id)
  &&(!args?.p_context_id||(result.data.context_id===args.p_context_id&&result.data.context_type===args.p_context_type&&result.data.call_type===args.p_call_type));
 return {call:!result.error && valid?result.data:null,error:result.error||(!valid?invalid():null)};
}
export async function getCallCapabilities(contextType:PrivateCallContext,contextId:string){
 const {data,error}=await bounded(()=>supabase.rpc('get_private_call_capabilities',{p_context_type:contextType,p_context_id:contextId}));
 const valid=preferencesValid(data)&&typeof (data as CallCapabilities).peer_id==='string';
 return {capabilities:!error&&valid?data as CallCapabilities:null,error:error||(!valid?invalid():null)};
}
export async function getCallPreferences(){
 const {data,error}=await bounded(()=>supabase.rpc('get_my_private_call_preferences'));
 return {preferences:!error&&preferencesValid(data)?data:null,error:error||(!preferencesValid(data)?invalid():null)};
}
export async function setCallPreferences(allowAudio:boolean,allowVideo:boolean){
 const {data,error}=await bounded(()=>supabase.rpc('set_my_private_call_preferences',{p_allow_audio:allowAudio,p_allow_video:allowVideo}));
 return {preferences:!error&&preferencesValid(data)?data:null,error:error||(!preferencesValid(data)?invalid():null)};
}
export const startPrivateCall=(contextType:PrivateCallContext,contextId:string,callType:PrivateCallType)=>callRpc('start_private_call',{p_context_type:contextType,p_context_id:contextId,p_call_type:callType});
export const getCallDetails=(callId:string)=>callRpc('get_private_call_details',{p_call_id:callId});
export const respondPrivateCall=(callId:string,accept:boolean)=>callRpc('respond_private_call',{p_call_id:callId,p_accept:accept});
export const endPrivateCall=(callId:string)=>callRpc('end_private_call',{p_call_id:callId});
export async function getActiveCalls(){
 const {data,error}=await bounded(()=>supabase.rpc('get_my_active_private_calls'));
 const valid=Array.isArray(data)&&data.every(callValid);
 return {calls:!error&&valid?data as PrivateCall[]:[],error:error||(!valid?invalid():null)};
}
export async function listCallSignals(callId:string){
 const {data,error}=await bounded(()=>supabase.from('private_call_signals').select('id,call_id,sender_id,signal_type,payload,created_at').eq('call_id',callId).order('created_at',{ascending:true}));
 const valid=Array.isArray(data)&&data.every(item=>item.call_id===callId&&typeof item.id==='string'&&['offer','answer','ice'].includes(item.signal_type)&&item.payload&&typeof item.payload==='object');
 return {signals:!error&&valid?data as CallSignal[]:[],error:error||(!valid?invalid():null)};
}
export async function sendCallSignal(callId:string,senderId:string,signalType:CallSignal['signal_type'],payload:any){
 return bounded(()=>supabase.from('private_call_signals').insert({call_id:callId,sender_id:senderId,signal_type:signalType,payload}));
}
export async function getPrivateCallIceServers(callId:string):Promise<PrivateCallIce>{
 const fallback:PrivateCallIce={iceServers:[{urls:'stun:stun.l.google.com:19302'}],relayReady:false};
 const {data,error}=await bounded(()=>supabase.functions.invoke('private-call-ice',{body:{call_id:callId}}));
 if(error||!Array.isArray(data?.ice_servers))return fallback;
 const iceServers=(data.ice_servers as RTCIceServer[]).filter(server=>Boolean(server?.urls));
 return iceServers.length?{iceServers,relayReady:Boolean(data.relay_ready)}:fallback;
}
