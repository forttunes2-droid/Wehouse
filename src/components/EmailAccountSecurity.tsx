import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getDeviceId } from '@/lib/supabase/session';
import { withTimeout } from '@/lib/withTimeout';

type Props={purpose:'device_confirmation'|'password_recovery';sessionId?:string;onComplete:(message:string)=>void|Promise<void>};
export default function EmailAccountSecurity(props:Props) {
  return <EmailAccountSecurityForm key={`${props.purpose}:${props.sessionId||''}`} {...props}/>;
}
function EmailAccountSecurityForm({purpose,sessionId,onComplete}:Props) {
  const recovery=purpose==='password_recovery';
  const [identifier,setIdentifier]=useState(''),[code,setCode]=useState(''),[password,setPassword]=useState(''),[repeat,setRepeat]=useState('');
  const [challenge,setChallenge]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [resendAt,setResendAt]=useState(0),[now,setNow]=useState(Date.now());
  const locked=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{if(resendAt<=Date.now())return;const timer=window.setInterval(()=>{setNow(Date.now());if(Date.now()>=resendAt)window.clearInterval(timer);},1000);return()=>window.clearInterval(timer);},[resendAt]);
  const cooldown=Math.max(0,Math.ceil((resendAt-now)/1000));
  const input='wh-auth-input min-h-12 w-full rounded-xl border border-[var(--auth-border)] px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30';
  const button='wh-auth-primary min-h-12 w-full rounded-xl px-4 text-sm font-semibold disabled:opacity-40';
  async function perform(action:'start'|'complete') {
    if(locked.current)return;
    if(action==='complete'&&(!/^\d{8}$/.test(code)||(recovery&&(password.length<8||password.length>128||password!==repeat)))) {
      setError('Enter the eight-digit code. Passwords must match and contain 8 to 128 characters.');return;
    }
    locked.current=true;setBusy(true);setError('');setNotice('');
    try {
      const {data,error:failure}=await withTimeout(supabase.functions.invoke('email-account-security',{body:{action,purpose,
        ...(action==='start'?{identifier,session_id:sessionId}:{challenge_id:challenge,code,...(recovery?{new_password:password}:{})}),
        ...(recovery?{}:{device_id:getDeviceId()}),
      }}),20000,'Confirmation took too long. The outcome is unknown; try signing in before requesting another code.');
      let message=data?.error;
      if(failure&&failure.context instanceof Response) {
        const response=await failure.context.clone().json().catch(()=>null);message=response?.error||message;
      }
      if(!alive.current)return;
      if(data?.password_changed===true) {
        setCode('');setPassword('');setRepeat('');setChallenge('');
        await onComplete(data.success?'Password changed. Sign in with your new password.':String(data.error));return;
      }
      if(failure||data?.success!==true)throw new Error(message||'Confirmation could not finish. Try again.');
      if(action==='start') {
        if(typeof data.challenge_id!=='string')throw new Error('The code request could not be confirmed.');
        setChallenge(data.challenge_id);setCode('');setResendAt(Date.now()+60000);setNow(Date.now());
        setNotice('If this account is eligible, a code will arrive at its verified email address. It expires in 10 minutes.');
      } else {
        if(data.session_id!==sessionId||data.trust_status!=='trusted')throw new Error('The confirmed device could not be checked. Sign in again.');
        setCode('');setChallenge('');await onComplete('Device confirmed.');
      }
    } catch(failure) {
      if(alive.current)setError(failure instanceof Error?failure.message:'Confirmation could not finish.');
    } finally {locked.current=false;if(alive.current)setBusy(false);}
  }
  return <div className="space-y-4" aria-label={recovery?'Email password recovery':'Email device confirmation'}>
    {recovery&&<label className="block text-sm font-medium">Username or email<input value={identifier} onChange={event=>{setIdentifier(event.target.value);setChallenge('');setCode('');setNotice('');}} disabled={busy} autoComplete="username" autoCapitalize="none" autoCorrect="off" maxLength={254} className={`${input} mt-2`}/></label>}
    {notice&&<p role="status" className="break-words text-sm leading-6 text-[var(--auth-muted)]">{notice}</p>}
    {error&&<p role="alert" className="break-words text-sm leading-6 text-[var(--wh-danger-text)]">{error}</p>}
    {challenge&&<form className="space-y-4" onSubmit={event=>{event.preventDefault();void perform('complete');}}>
      <label className="block text-sm font-medium">Email code<input value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,'').slice(0,8))} disabled={busy} inputMode="numeric" autoComplete="one-time-code" maxLength={8} className={`${input} mt-2`} aria-describedby="email-code-help"/></label>
      <p id="email-code-help" className="text-xs leading-5 text-[var(--auth-muted)]">Use the code for this action only. Never share it with support or another person.</p>
      {recovery&&<>
        <label className="block text-sm font-medium">New password<input type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} disabled={busy} className={`${input} mt-2`}/></label>
        <label className="block text-sm font-medium">Confirm new password<input type="password" value={repeat} onChange={event=>setRepeat(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} disabled={busy} className={`${input} mt-2`}/></label>
      </>}
      <button type="submit" className={button} disabled={busy||code.length!==8||(recovery&&(password.length<8||password!==repeat))}>{busy?'Confirming…':recovery?'Change password':'Confirm this device'}</button>
    </form>}
    <button type="button" onClick={()=>void perform('start')} disabled={busy||cooldown>0||(recovery&&!identifier.trim())||(!recovery&&!sessionId)} className={challenge?'wh-auth-text-action min-h-11 w-full rounded-xl px-3 text-sm disabled:opacity-40':button}>
      {busy?'Please wait…':cooldown>0?`Send another code in ${cooldown}s`:challenge?'Send another code':'Send email code'}
    </button>
  </div>;
}
