import { supabase } from './client';

export type DeviceRegistration = {
  sessionId: string | null;
  trustStatus: 'pending' | 'trusted' | 'rejected' | 'unknown';
  newDevice: boolean;
  device: string;
  os: string;
  browser: string;
  location: string;
};

export function parseDeviceInfo(ua:string=typeof navigator!=='undefined'?navigator.userAgent:''){
  let device='Desktop',os='Unknown',browser='Unknown';
  if(/Android/.test(ua)){const m=ua.match(/Android\s([\d.]+)/);os=m?`Android ${m[1]}`:'Android';const d=ua.match(/;\s*([^)]+)\s*Build/);device=d?d[1].trim():'Android Device'}
  else if(/iPhone/.test(ua)){os='iOS';device='iPhone'}
  else if(/iPad/.test(ua)){os='iPadOS';device='iPad'}
  else if(/Windows NT/.test(ua))os='Windows';
  else if(/Mac OS/.test(ua))os='macOS';
  else if(/Linux/.test(ua))os='Linux';
  if(/Chrome/.test(ua)&&!/Edg|OPR/.test(ua)){const m=ua.match(/Chrome\/([\d.]+)/);browser=m?`Chrome ${m[1].split('.')[0]}`:'Chrome'}
  else if(/Edg/.test(ua))browser='Edge';
  else if(/Firefox/.test(ua))browser='Firefox';
  else if(/Safari/.test(ua)&&!/Chrome/.test(ua))browser='Safari';
  else if(/OPR/.test(ua))browser='Opera';
  return{device,os,browser};
}

export function approximateDeviceLocation(){
  try{
    const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'';
    const locale=typeof navigator!=='undefined'?navigator.language:'';
    if(timezone==='Africa/Lagos'||/-NG$/i.test(locale))return 'Nigeria';
    const region=locale.match(/-([A-Z]{2})$/i)?.[1]?.toUpperCase();
    if(region){
      const names=new Intl.DisplayNames([locale||'en'],{type:'region'});
      return names.of(region)||'Location unavailable';
    }
  }catch{}
  return 'Location unavailable';
}

export async function trackSession(userId:string,authId:string){
  const{device,os,browser}=parseDeviceInfo();
  const{error}=await supabase.from('user_activity').insert({user_id:userId,auth_id:authId,action_type:'session_start',details:{device,os,browser,location:approximateDeviceLocation(),source:'login'}});
  return{error};
}
export async function endSession(userId:string,authId:string){const{error}=await supabase.from('user_activity').insert({user_id:userId,auth_id:authId,action_type:'session_end',details:{source:'logout'}});return{error}}
export async function getSessionHistory(userId:string,limit=20){const{data,error}=await supabase.from('user_activity').select('*').eq('user_id',userId).or('action_type.eq.session_start,action_type.eq.session_end').order('created_at',{ascending:false}).limit(limit);return{sessions:data||[],error}}

const SESSION_STORAGE_KEY='wh_session_id';
const DEVICE_STORAGE_KEY='wehouse_trusted_device_id';
export function getStoredSessionId(){try{return localStorage.getItem(SESSION_STORAGE_KEY)}catch{return null}}
export function clearStoredSessionId(){try{localStorage.removeItem(SESSION_STORAGE_KEY)}catch{}}
export function getDeviceId(){try{let value=localStorage.getItem(DEVICE_STORAGE_KEY);if(value)return value;value=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;localStorage.setItem(DEVICE_STORAGE_KEY,value);return value}catch{return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`}}
export async function getUserSessionState(sessionId:string,userId:string,authId:string):Promise<{state:'active'|'pending'|'inactive'|'missing'|'foreign'|'error';error:any}>{const{data,error}=await supabase.from('user_sessions').select('id,user_id,auth_id,is_active,is_current,trust_status').eq('id',sessionId).maybeSingle();if(error)return{state:'error',error};if(!data)return{state:'missing',error:null};if(data.user_id!==userId||data.auth_id!==authId)return{state:'foreign',error:null};if(data.trust_status==='pending')return{state:'pending',error:null};return{state:data.is_active&&data.trust_status!=='rejected'?'active':'inactive',error:null}}

export async function registerUserSession(userId:string,authId:string):Promise<DeviceRegistration>{
  const existing=getStoredSessionId();
  const {device,os,browser}=parseDeviceInfo();
  const location=approximateDeviceLocation();
  let result=await supabase.rpc('register_current_device_v2',{p_device_id:getDeviceId(),p_device:device,p_os:os,p_browser:browser,p_location:location,p_existing_session_id:existing||null});
  if(result.error&&/register_current_device_v2/i.test(result.error.message||'')){
    result=await supabase.rpc('register_current_device',{p_device_id:getDeviceId(),p_device:device,p_os:os,p_browser:browser,p_existing_session_id:existing||null});
  }
  if(!result.error&&result.data?.session_id){
    const sessionId=String(result.data.session_id);
    localStorage.setItem(SESSION_STORAGE_KEY,sessionId);
    return{sessionId,trustStatus:(result.data.trust_status||'unknown') as DeviceRegistration['trustStatus'],newDevice:Boolean(result.data.new_device),device,os,browser,location};
  }
  if(existing){
    const{state}=await getUserSessionState(existing,userId,authId);
    if(state==='active'){await updateSessionLastSeen(existing);return{sessionId:existing,trustStatus:'trusted',newDevice:false,device,os,browser,location}}
    if(state==='pending')return{sessionId:existing,trustStatus:'pending',newDevice:true,device,os,browser,location};
    if(state==='foreign'||state==='missing')clearStoredSessionId();
    if(state==='inactive')return{sessionId:null,trustStatus:'rejected',newDevice:false,device,os,browser,location};
  }
  if(result.error)console.error('[Session] Failed to register device:',result.error.message);
  return{sessionId:null,trustStatus:'unknown',newDevice:false,device,os,browser,location};
}

export async function createUserSession(userId:string,authId:string):Promise<string|null>{return(await registerUserSession(userId,authId)).sessionId}
export async function confirmCurrentDeviceWithGoogle(sessionId:string){return supabase.rpc('confirm_current_device_with_google',{p_session_id:sessionId,p_device_id:getDeviceId()})}
export async function deactivateUserSession(sessionId:string){await supabase.from('user_sessions').update({is_active:false,is_current:false,logout_time:new Date().toISOString()}).eq('id',sessionId);if(getStoredSessionId()===sessionId)clearStoredSessionId()}
export async function isSessionActive(sessionId:string){const{data}=await supabase.from('user_sessions').select('is_active').eq('id',sessionId).maybeSingle();return Boolean(data?.is_active)}
export async function updateSessionLastSeen(sessionId:string){await supabase.from('user_sessions').update({last_seen:new Date().toISOString()}).eq('id',sessionId).eq('is_active',true)}
