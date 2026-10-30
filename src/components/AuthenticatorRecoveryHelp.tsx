import {useState} from 'react';
import {supabase} from '@/lib/supabase/client';
import {withTimeout} from '@/lib/withTimeout';
export default function AuthenticatorRecoveryHelp(){
 const [busy,setBusy]=useState(false),[email,setEmail]=useState(''),[error,setError]=useState('');
 async function load(){if(busy)return;setBusy(true);setError('');try{
  const result=await withTimeout(supabase.rpc('get_public_account_support'),12000,'Support contact took too long. Try again.');
  const address=result.data?.email;
  if(result.error||typeof address!=='string'||!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(address))throw Error('The support contact could not be loaded. Try again.');
  setEmail(address);
 }catch(cause){setError(cause instanceof Error?cause.message:'Support contact could not be loaded.');}finally{setBusy(false);}}
 return <details className="rounded-xl border border-[var(--wh-border-subtle)] p-3 text-sm"><summary className="min-h-10 cursor-pointer font-medium">Lost access to your authenticator?</summary><div className="space-y-3 leading-6 text-[var(--wh-text-secondary)]"><p>Check the backup or recovery options in your authenticator app. If you cannot recover it, contact WeHouse for a security review. Never send your password, setup key or verification codes.</p><p>Email confirmation or resetting your password does not remove two-factor protection. Account recovery requires a separate review.</p>{error&&<p role="alert">{error}</p>}{email?<a href={`mailto:${email}?subject=WeHouse%20authenticator%20recovery`} className="inline-flex min-h-11 items-center break-all font-semibold underline">Email WeHouse about authenticator recovery</a>:<button type="button" disabled={busy} onClick={()=>void load()} className="min-h-11 font-semibold underline">{busy?'Loading contact…':'Get recovery support contact'}</button>}</div></details>;
}
