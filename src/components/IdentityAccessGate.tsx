import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AccountShell from '@/components/AccountShell';
import WorkerIdentityCheck from '@/components/WorkerIdentityCheck';
import type { Profile } from '@/types';

type Status={current:boolean;enrolled:boolean;due_at:string|null;recheck_days:number;status:string};

export default function IdentityAccessGate({profile,children}:{profile:Profile;children:React.ReactNode}){
 const[state,setState]=useState<Status|null>(null),[loading,setLoading]=useState(true);
 const refresh=useCallback(async()=>{const{data,error}=await supabase.rpc('get_my_account_identity_status');if(!error&&data)setState(data as Status);setLoading(false)},[]);
 useEffect(()=>{void refresh()},[refresh]);
 if(loading)return <div className="grid min-h-[100dvh] place-items-center bg-[#0A0A0F]"><div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>;
 if(state&&!state.current){const label=profile.role==='property_partner'?'Property Partner':'Worker';return <AccountShell profile={profile} title="Identity check due" description={`Complete the quick private live check to continue to your ${label} workspace.`}><section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.045] p-4"><p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">ACCOUNT PROTECTION</p><p className="mt-2 text-xs leading-6 text-[#9AA0AF]">This check repeats every {state.recheck_days||30} days. Your existing work, conversations, properties and earnings remain unchanged.</p></section><WorkerIdentityCheck profile={profile} status={state.enrolled?'due':'not_started'} onSaved={refresh}/></AccountShell>}
 return <>{children}</>;
}
