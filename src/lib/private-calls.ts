import { supabase } from '@/lib/supabase';

export type PrivateCallType='audio'|'video';
export type PrivateCallContext='roommate'|'worker_booking';
export type PrivateCallStatus='ringing'|'accepted'|'declined'|'missed'|'ended'|'failed';
export type PrivateCall={id:string;context_type:PrivateCallContext;context_id:string;caller_id:string;callee_id:string;call_type:PrivateCallType;status:PrivateCallStatus;created_at:string;answered_at?:string|null;ended_at?:string|null;peer_id?:string;peer_name?:string;peer_avatar?:string|null;incoming?:boolean};
export type CallCapabilities={peer_id:string;peer_name:string;peer_avatar:string|null;allow_audio_calls:boolean;allow_video_calls:boolean};
export type CallPreferences={allow_audio_calls:boolean;allow_video_calls:boolean};
export type CallSignal={id:string;call_id:string;sender_id:string;signal_type:'offer'|'answer'|'ice';payload:any;created_at:string};

export function launchPrivateCall(contextType:PrivateCallContext,contextId:string,callType:PrivateCallType){
  window.dispatchEvent(new CustomEvent('wehouse:start-private-call',{detail:{contextType,contextId,callType}}));
}
export async function getCallCapabilities(contextType:PrivateCallContext,contextId:string){const{data,error}=await supabase.rpc('get_private_call_capabilities',{p_context_type:contextType,p_context_id:contextId});return{capabilities:(data||null) as CallCapabilities|null,error}}
export async function getCallPreferences(){const{data,error}=await supabase.rpc('get_my_private_call_preferences');return{preferences:(data||null) as CallPreferences|null,error}}
export async function setCallPreferences(allowAudio:boolean,allowVideo:boolean){const{data,error}=await supabase.rpc('set_my_private_call_preferences',{p_allow_audio:allowAudio,p_allow_video:allowVideo});return{preferences:(data||null) as CallPreferences|null,error}}
export async function startPrivateCall(contextType:PrivateCallContext,contextId:string,callType:PrivateCallType){const{data,error}=await supabase.rpc('start_private_call',{p_context_type:contextType,p_context_id:contextId,p_call_type:callType});return{call:(data||null) as PrivateCall|null,error}}
export async function getCallDetails(callId:string){const{data,error}=await supabase.rpc('get_private_call_details',{p_call_id:callId});return{call:(data||null) as PrivateCall|null,error}}
export async function getActiveCalls(){const{data,error}=await supabase.rpc('get_my_active_private_calls');return{calls:(Array.isArray(data)?data:[]) as PrivateCall[],error}}
export async function respondPrivateCall(callId:string,accept:boolean){const{data,error}=await supabase.rpc('respond_private_call',{p_call_id:callId,p_accept:accept});return{call:(data||null) as PrivateCall|null,error}}
export async function endPrivateCall(callId:string){const{data,error}=await supabase.rpc('end_private_call',{p_call_id:callId});return{call:(data||null) as PrivateCall|null,error}}
export async function listCallSignals(callId:string){const{data,error}=await supabase.from('private_call_signals').select('id,call_id,sender_id,signal_type,payload,created_at').eq('call_id',callId).order('created_at',{ascending:true});return{signals:(data||[]) as CallSignal[],error}}
export async function sendCallSignal(callId:string,senderId:string,signalType:CallSignal['signal_type'],payload:any){return supabase.from('private_call_signals').insert({call_id:callId,sender_id:senderId,signal_type:signalType,payload})}
