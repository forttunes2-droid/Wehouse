import { supabase } from './client';
export type NotificationPreference = 'pref_email_notif' | 'pref_push_notif';
export async function saveNotificationPreference(userId:string,authId:string,key:NotificationPreference,value:boolean) {
  const {data,error}=await supabase.from('profiles').update({[key]:value,updated_at:new Date().toISOString()})
    .eq('user_id',userId).eq('auth_id',authId).select(`user_id,${key}`).maybeSingle();
  const receipt=data as {user_id?:string;pref_email_notif?:boolean;pref_push_notif?:boolean}|null;
  return {error:error||(receipt?.user_id===userId&&receipt[key]===value?null:{message:'The saved preference could not be confirmed. Reload Account before retrying.'})};
}
