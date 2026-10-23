import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { withTimeout } from '@/lib/withTimeout';
import { verificationRedirectUrl } from '@/lib/googleVerification';

export default function EmailSignupConfirmation({email,onConfirmed}:{email:string;onConfirmed:(authId:string,email:string)=>void}) {
  const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const lock=useRef(false);
  async function confirm() {
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try {
      const {data,error:failure}=await withTimeout(supabase.auth.verifyOtp({email,token:code,type:'signup'}),15000,'Confirmation took too long. Try signing in before entering the code again.');
      if(failure||!data.user?.email_confirmed_at||data.user.email?.toLowerCase()!==email.trim().toLowerCase())throw new Error('That signup code is invalid or expired. Check the latest email.');
      onConfirmed(data.user.id,data.user.email);
    } catch(failure) {setError(failure instanceof Error?failure.message:'Email confirmation failed.');}
    finally {lock.current=false;setBusy(false);}
  }
  async function resend() {
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
    try {
      const {error:failure}=await withTimeout(supabase.auth.resend({type:'signup',email,options:{emailRedirectTo:verificationRedirectUrl('signup')}}),15000,'The email request could not be confirmed. Wait before retrying.');
      if(failure)throw new Error('The email could not be resent. Wait briefly and try again.');
      setNotice('If confirmation is still needed, check the latest email, including spam.');
    } catch(failure) {setError(failure instanceof Error?failure.message:'The email could not be resent.');}
    finally {lock.current=false;setBusy(false);}
  }
  return <div className="space-y-3">
    <p className="text-sm leading-6 text-[var(--auth-muted)]">Open the confirmation link in your email, then sign in. If your email contains a signup code, you can enter it here instead. No Google or Apple account is required.</p>
    {error&&<p role="alert" className="text-sm text-[var(--wh-danger-text)]">{error}</p>}
    {notice&&<p role="status" className="text-sm text-[var(--auth-muted)]">{notice}</p>}
    <form onSubmit={event=>{event.preventDefault();void confirm();}} className="space-y-3">
      <label className="block text-sm font-medium">Signup email code<input value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,'').slice(0,10))} inputMode="numeric" autoComplete="one-time-code" maxLength={10} disabled={busy} className="wh-auth-input mt-2 min-h-12 w-full rounded-xl border border-[var(--auth-border)] px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30"/></label>
      <button type="submit" disabled={busy||code.length<6} className="wh-auth-primary min-h-12 w-full rounded-xl px-4 text-sm font-semibold disabled:opacity-40">{busy?'Checking…':'Confirm email code'}</button>
    </form>
    <button type="button" onClick={()=>void resend()} disabled={busy||!email} className="wh-auth-text-action min-h-11 w-full rounded-xl px-3 text-sm disabled:opacity-40">Resend confirmation email</button>
  </div>;
}
