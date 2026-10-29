import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { withTimeout } from '@/lib/withTimeout';

export type ProviderActivityWork={booking_id:string;title:string;starts_at:string;ends_at:string;timezone:string;participants:number;host_finished:boolean};
function validActivityWork(value:unknown):value is ProviderActivityWork[]{
  if(!Array.isArray(value)||value.length>3)return false;
  const seen=new Set<string>();
  return value.every(row=>{
    if(!row||typeof row!=='object'||typeof row.booking_id!=='string'||!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(row.booking_id)||seen.has(row.booking_id)||
      typeof row.title!=='string'||!row.title.trim()||row.title.length>120||
      typeof row.starts_at!=='string'||typeof row.ends_at!=='string'||!Number.isFinite(Date.parse(row.starts_at))||!Number.isFinite(Date.parse(row.ends_at))||Date.parse(row.ends_at)<=Date.parse(row.starts_at)||
      typeof row.timezone!=='string'||!row.timezone||!Number.isInteger(row.participants)||row.participants<1||row.participants>100||typeof row.host_finished!=='boolean')return false;
    try{new Intl.DateTimeFormat('en',{timeZone:row.timezone});}catch{return false;}
    seen.add(row.booking_id);return true;
  });
}
type Capabilities = {
  person_id: string;
  service_reviewed: boolean;
  has_existing_jobs: boolean;
  can_manage_jobs: boolean;
  can_manage_showcase: boolean;
  can_apply_experiences: boolean;
  can_access_inbox: boolean;
  can_access_earnings: boolean;
  experience_next?:ProviderActivityWork[];
  has_activity_bookings?:boolean;
};

export function useProviderWorkspaceCapabilities(personId: string, reviewVersion: string) {
  const [receipt,setReceipt]=useState<Capabilities|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [attempt,setAttempt]=useState(0);
  const refresh=useCallback(()=>setAttempt(value=>value+1),[]);
  useEffect(()=>{
    let active=true;setReceipt(null);setError('');setLoading(true);
    void (async()=>{
      try{
        const {data,error:failure}=await withTimeout(supabase.rpc('get_my_provider_workspace_capabilities'),15000,'Workspace access took too long to confirm. Please try again.');
        if(failure)throw failure;
        const keys=['service_reviewed','has_existing_jobs','can_manage_jobs','can_manage_showcase','can_apply_experiences','can_access_inbox','can_access_earnings'];
        if(!data||data.person_id!==personId||keys.some(key=>typeof data[key]!=='boolean')||
          data.can_manage_jobs!==(data.service_reviewed||data.has_existing_jobs)||
          data.can_manage_showcase!==data.service_reviewed)throw new Error('Workspace access could not be confirmed. Please try again.');
        if(data.experience_next!==undefined&&!validActivityWork(data.experience_next))throw new Error('Your activity work could not be confirmed. Refresh the workspace.');
        if(data.has_activity_bookings!==undefined&&(typeof data.has_activity_bookings!=='boolean'||data.has_activity_bookings===false&&data.experience_next?.length>0))throw new Error('Your activity history could not be confirmed. Refresh the workspace.');
        if(active)setReceipt(data as Capabilities);
      }catch(cause){if(active)setError(cause instanceof Error?cause.message:(cause as {message?:string})?.message||'Workspace access could not be confirmed.');}
      finally{if(active)setLoading(false);}
    })();
    return()=>{active=false;};
  },[personId,reviewVersion,attempt]);
  return {capabilities:receipt?.person_id===personId?receipt:null,error,loading,refresh};
}
