import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { withTimeout } from '@/lib/withTimeout';

type Capabilities = {
  person_id: string;
  service_reviewed: boolean;
  has_existing_jobs: boolean;
  can_manage_jobs: boolean;
  can_manage_showcase: boolean;
  can_apply_experiences: boolean;
  can_access_inbox: boolean;
  can_access_earnings: boolean;
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
        if(active)setReceipt(data as Capabilities);
      }catch(cause){if(active)setError(cause instanceof Error?cause.message:(cause as {message?:string})?.message||'Workspace access could not be confirmed.');}
      finally{if(active)setLoading(false);}
    })();
    return()=>{active=false;};
  },[personId,reviewVersion,attempt]);
  return {capabilities:receipt?.person_id===personId?receipt:null,error,loading,refresh};
}
