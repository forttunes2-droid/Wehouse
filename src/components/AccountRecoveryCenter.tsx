import {useEffect,useRef,useState} from 'react';
import {recoveryRequest,reviewPortal,workspaceName,type ReviewPortal} from '@/lib/accountRecovery';

export default function AccountRecoveryCenter({signedIn=false,onAccessChanged}:{signedIn?:boolean;onAccessChanged?:()=>void}){
 const [token,setToken]=useState<string|null>(null),[email,setEmail]=useState(''),[code,setCode]=useState(''),[sent,setSent]=useState(false);
 const [portal,setPortal]=useState<ReviewPortal|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [scope,setScope]=useState(''),[explanation,setExplanation]=useState(''),[reply,setReply]=useState<Record<string,string>>({}),[uncertain,setUncertain]=useState(false);
 const generation=useRef(0),lock=useRef(false),replyKeys=useRef<Record<string,string>>({});
 const field='block w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-bg)] p-3 text-sm text-[var(--wh-text)]';
 useEffect(()=>()=>{generation.current++;},[]);
 async function run(action:()=>Promise<void>,mutating=false){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');const current=generation.current;
  try{await action();}catch(cause){if(current===generation.current){setError(cause instanceof Error?cause.message:'Review unavailable. Try again.');if(mutating)setUncertain(true);}}
  finally{lock.current=false;if(current===generation.current)setBusy(false);}
 }
 async function refresh(session=token){
  const current=generation.current;const data=await reviewPortal(session);
  if(current!==generation.current)return;
  setPortal(data);setUncertain(false);
 }
 useEffect(()=>{
  if(!signedIn)return;
  let active=true;setBusy(true);setError('');
  void reviewPortal(null).then(data=>{if(active){setPortal(data);setUncertain(false);}})
   .catch(()=>{if(active)setError('Review records could not be loaded. Refresh to try again.');})
   .finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;};
 },[signedIn]);
 function leave(){generation.current++;setBusy(false);setToken(null);setPortal(null);setSent(false);setCode('');setError('');setNotice('');setUncertain(false);}
 const selected=portal?.restrictions.find(r=>r.workspace===scope);
 return <section aria-label="Account and workspace reviews" className="space-y-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 text-[var(--wh-text)]">
  <header><h2 className="text-base font-semibold">Account and workspace reviews</h2><p className="mt-1 text-sm leading-6 text-[var(--wh-text-secondary)]">See why access was restricted, request a review and follow updates. A review does not automatically restore access or cancel bookings.</p></header>
  {error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
  {notice&&<p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
  {!signedIn&&!token?<div className="space-y-3">
   <p className="text-sm text-[var(--wh-text-secondary)]">Verify your existing account email to access reviews only. This does not sign you into the marketplace, create another account or reset your password.</p>
   <label className="block text-sm">Account email<input type="email" autoComplete="email" value={email} onChange={e=>{setEmail(e.target.value);setSent(false);setCode('');}} disabled={busy} className={field}/></label>
   <button type="button" disabled={busy||!email.trim()} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold disabled:opacity-50" onClick={()=>void run(async()=>{await recoveryRequest({action:'send_code',email});setSent(true);setNotice('If this email belongs to an existing account, check its inbox for the verification code.');})}>{busy?'Please wait…':sent?'Request another code':'Send verification code'}</button>
   {sent&&<><label className="block text-sm">Email verification code<input autoComplete="one-time-code" inputMode="numeric" maxLength={10} value={code} onChange={e=>setCode(e.target.value.replace(/[^0-9]/g,''))} className={field} disabled={busy}/></label>
    <button type="button" disabled={busy||code.length<6} className="min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={()=>void run(async()=>{const data=await recoveryRequest({action:'verify_code',email,code});if(typeof data.recovery_token!=='string'||!/^[0-9a-f]{64}$/.test(data.recovery_token))throw Error('Review session unavailable');setToken(data.recovery_token);setCode('');await refresh(data.recovery_token);})}>Verify and open reviews</button></>}
  </div>:<>
   <div className="flex flex-wrap gap-3"><button type="button" disabled={busy} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold" onClick={()=>void run(async()=>{await refresh();onAccessChanged?.();})}>{busy?'Loading…':'Refresh reviews'}</button>{!signedIn&&<button type="button" disabled={busy} onClick={()=>void run(async()=>{await recoveryRequest({action:'close',recovery_token:token});leave();})} className="min-h-11 px-3 text-sm">Close recovery session</button>}</div>
   {!portal?<p role="status">Load your review records to continue.</p>:<>
    {portal.restrictions.length===0?<p className="text-sm">No active restriction is recorded. If your review restored the entire account, sign in again; old device sessions remain closed.</p>:<div className="space-y-3">
     {portal.restrictions.map(r=><article key={r.version} className="rounded-xl border border-[var(--wh-border-subtle)] p-3"><h3 className="text-sm font-semibold">{workspaceName(r.workspace)}</h3><p className="mt-1 text-sm text-[var(--wh-text-secondary)]">{r.reason}</p></article>)}
     <label className="block text-sm">Restriction to review<select value={scope} disabled={busy} onChange={e=>setScope(e.target.value)} className={field}><option value="">Choose a restriction</option>{portal.restrictions.map(r=><option key={r.version} value={r.workspace}>{workspaceName(r.workspace)}</option>)}</select></label>
     <label className="block text-sm">Why should WeHouse review this decision?<textarea value={explanation} onChange={e=>setExplanation(e.target.value)} disabled={busy} maxLength={2000} rows={4} className={field}/></label>
     <p className="text-xs text-[var(--wh-text-secondary)]">Explain what is incorrect or what has changed. Refer to existing evidence when relevant. Do not include passwords, codes, full identity numbers or bank details.</p>
     <button type="button" disabled={busy||uncertain||!selected||explanation.trim().length<10} className="min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={()=>void run(async()=>{const current=generation.current;const data=await reviewPortal(token,{workspace:scope,version:selected?.version,explanation:explanation.trim()});if(current!==generation.current)return;setPortal(data);setExplanation('');setNotice('Review request received. Keep the case reference below.');},true)}>Submit review request</button>
    </div>}
    <h3 className="text-sm font-semibold">Your latest 20 reviews</h3>
    {portal.appeals.length===0?<p className="text-sm text-[var(--wh-text-secondary)]">You have not submitted a review request.</p>:portal.appeals.map(a=><article key={a.case_id} className="space-y-3 rounded-xl border border-[var(--wh-border-subtle)] p-3">
     <div><h4 className="text-sm font-semibold">Case #{a.case_number} · {workspaceName(a.workspace)}</h4><p className="mt-1 text-xs capitalize text-[var(--wh-text-secondary)]">{a.decision||a.status.replaceAll('_',' ')}</p></div>
     <p className="whitespace-pre-wrap text-sm">{a.explanation}</p>
     {a.updates.map((u,i)=><div key={i} className="border-l-2 border-violet-400 pl-3 text-sm"><p className="whitespace-pre-wrap">{u.note}</p><time className="text-xs text-[var(--wh-text-secondary)]">{new Date(u.created_at).toLocaleString()}</time></div>)}
     {!['restored','superseded'].includes(a.decision||'')&&<><label className="block text-sm">Additional information for case #{a.case_number}<textarea rows={3} maxLength={2000} value={reply[a.case_id]||''} disabled={busy} onChange={e=>setReply(v=>({...v,[a.case_id]:e.target.value}))} className={field}/></label>
      <button type="button" disabled={busy||uncertain||(reply[a.case_id]||'').trim().length<10} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-3 text-sm font-semibold disabled:opacity-50" onClick={()=>void run(async()=>{const key=replyKeys.current[a.case_id]||crypto.randomUUID();replyKeys.current[a.case_id]=key;const current=generation.current;const data=await reviewPortal(token,{case_id:a.case_id,reply:reply[a.case_id].trim(),reply_key:key});if(current!==generation.current)return;setPortal(data);delete replyKeys.current[a.case_id];setReply(v=>({...v,[a.case_id]:''}));setNotice('Additional information received.');},true)}>Send additional information</button></>}
    </article>)}
   </>}
  </>}
 </section>;
}
