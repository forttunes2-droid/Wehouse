import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase/client';
import {withTimeout} from '@/lib/withTimeout';
import type {AuthenticationRequirement} from '@/lib/accountAuthentication';
import AuthenticatorRecoveryHelp from '@/components/AuthenticatorRecoveryHelp';

type Factor={id:string;friendly_name?:string;status:string};
export default function AccountAuthenticatorGate({requirement,onVerified,onSignOut}:{requirement:AuthenticationRequirement;onVerified:()=>Promise<void>;onSignOut:()=>Promise<unknown>}){
 const [factors,setFactors]=useState<Factor[]>([]),[unfinished,setUnfinished]=useState<Factor[]>([]),[selected,setSelected]=useState('');
 const [enrollment,setEnrollment]=useState<{id:string;qr:string;secret:string}|null>(null),[manual,setManual]=useState(false),[code,setCode]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const generation=useRef(0),lock=useRef(false);const setup=requirement.stage==='setup';
 useEffect(()=>{const current=++generation.current;setLoading(true);setError('');
  void withTimeout(supabase.auth.getUser(),15000,'Security check took too long.').then(async user=>{
   if(user.error||user.data.user?.id!==requirement.auth_id)throw Error('Your sign-in changed. Sign out and try again.');
   const result=await withTimeout(supabase.auth.mfa.listFactors(),15000,'Authenticators could not be loaded.');
   if(result.error)throw Error('Authenticators could not be loaded. Try again.');
   if(current!==generation.current)return;
   const verified=result.data.totp.filter(f=>f.status==='verified');
   setFactors(verified);setSelected(verified[0]?.id||'');setUnfinished(result.data.all.filter(f=>f.factor_type==='totp'&&f.status==='unverified'));
   if(setup&&verified.length)await onVerified();
   if(!setup&&!verified.length)throw Error('Your authenticator settings changed. Sign out and sign in again.');
  }).catch(cause=>{if(current===generation.current)setError(cause instanceof Error?cause.message:'Account security could not be loaded.');})
   .finally(()=>{if(current===generation.current)setLoading(false);});
  return()=>{generation.current++;};
 },[requirement.auth_id,setup,attempt,onVerified]);
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');const current=generation.current;
  try{await action();}catch(cause){if(current===generation.current)setError(cause instanceof Error?cause.message:'Verification could not be completed. Try again.');}
  finally{lock.current=false;if(current===generation.current)setBusy(false);}
 }
 async function start(){await run(async()=>{
  // Explicit restart removes only unfinished TOTP setups, never verified factors.
  for(const factor of unfinished){const removed=await withTimeout(supabase.auth.mfa.unenroll({factorId:factor.id}),15000,'Unfinished setup could not be restarted.');if(removed.error)throw Error('Unfinished setup could not be restarted. Try again.');}
  const result=await withTimeout(supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'WeHouse authenticator'}),15000,'Authenticator setup could not start.');
  if(result.error||!result.data||!('totp' in result.data)||!result.data.totp.secret)throw Error('Authenticator setup could not be confirmed. Refresh this screen before trying again.');
  setEnrollment({id:result.data.id,qr:result.data.totp.qr_code,secret:result.data.totp.secret});setUnfinished([]);setCode('');
 });}
 async function verify(){await run(async()=>{
  const factorId=enrollment?.id||selected;if(!factorId||!/^\d{6}$/.test(code))return;
  const result=await withTimeout(supabase.auth.mfa.challengeAndVerify({factorId,code}),20000,'Verification result is uncertain. Sign out and sign in again to check it.');
  if(result.error)throw Error('That code was not accepted. Check your authenticator’s current code and try again.');
  setCode('');setEnrollment(null);await onVerified();
 });}
 const field='mt-2 min-h-12 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-bg)] p-3 text-base text-[var(--wh-text)]';
 return <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--wh-bg)] p-5 text-[var(--wh-text)]"><section className="w-full max-w-md space-y-5 rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-6 sm:p-8">
  <img src="/brand/v4/wehouse-app-icon.svg" alt="WeHouse" className="h-11 w-11 rounded-xl"/>
  <header><h1 className="text-xl font-semibold">{setup?'Set up your authenticator':'Enter your authenticator code'}</h1><p className="mt-2 text-sm leading-6 text-[var(--wh-text-secondary)]">{setup?'Required before using a WeHouse Team workspace. One authenticator protects your account across all workspaces.':'Use the authenticator already connected to your WeHouse account. You do not need to set up another one for this workspace.'}</p></header>
  {error&&<div role="alert" className="space-y-2 text-sm"><p>{error}</p>{!busy&&<button type="button" onClick={()=>setAttempt(n=>n+1)} className="min-h-11 font-semibold underline">Refresh security check</button>}</div>}
  {loading?<p role="status" className="text-sm">Checking your authenticators…</p>:setup&&!enrollment?<button type="button" disabled={busy||!!error} onClick={()=>void start()} className="min-h-12 w-full rounded-xl bg-violet-600 px-4 font-semibold text-white disabled:opacity-50">{busy?'Starting…':unfinished.length?'Restart unfinished setup':'Set up authenticator'}</button>:<form className="space-y-4" onSubmit={e=>{e.preventDefault();void verify();}}>
   {enrollment&&<div className="space-y-3"><p className="text-sm">Scan this code in your authenticator app.</p><img src={enrollment.qr} alt="Authenticator setup QR code" className="mx-auto h-48 w-48 rounded-xl bg-white p-2"/><button type="button" onClick={()=>setManual(v=>!v)} className="min-h-11 text-sm font-semibold underline">{manual?'Hide setup key':'Enter a setup key instead'}</button>{manual&&<p className="break-all rounded-xl border border-[var(--wh-border-subtle)] p-3 font-mono text-sm">{enrollment.secret}</p>}<p className="text-xs leading-5 text-[var(--wh-text-secondary)]">Keep the setup key private. Finish setup by entering a current code below.</p></div>}
   {!setup&&factors.length>1&&<label className="block text-sm">Authenticator<select value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)} className={field}>{factors.map((factor,index)=><option key={factor.id} value={factor.id}>{factor.friendly_name||`Authenticator ${index+1}`}</option>)}</select></label>}
   <label className="block text-sm">6-digit authenticator code<input autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} disabled={busy} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} className={`${field} tracking-[.25em]`}/></label>
   <button type="submit" disabled={busy||code.length!==6||!enrollment&&!selected} className="min-h-12 w-full rounded-xl bg-violet-600 px-4 font-semibold text-white disabled:opacity-50">{busy?'Verifying…':setup?'Verify and continue':'Continue securely'}</button>
  </form>}
  <button type="button" disabled={busy} onClick={()=>void run(async()=>{if(enrollment){const result=await supabase.auth.mfa.unenroll({factorId:enrollment.id});if(result.error)throw Error('Setup cancellation could not be confirmed. Try again.');}await onSignOut();})} className="min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold">Sign out</button>
  {!setup&&<AuthenticatorRecoveryHelp/>}
 </section></main>;
}
