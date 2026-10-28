import {confirmAdminReview} from '@/lib/reviewStepUp';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase/client';
import {withTimeout} from '@/lib/withTimeout';
import {workspaceName} from '@/lib/accountRecovery';
import {useCreatorAuth} from '@/hooks/useCreatorAuth';
type Review={case_id:string;case_number:number;user_id:string;workspace:string;explanation:string;status:string;decision:string|null;public_decision:string|null;updated_at:string;assigned_user_id:string|null;username:string|null;restriction_version:string;current_version:string;restricted:boolean;updates:Array<{public_note:string|null;internal_note:string|null;created_at:string}>};
export default function AccountReviewQueue({actorId,actorRole='creator'}:{actorId:string;actorRole?:'creator'|'admin'|'staff'}){
 const {requestElevation}=useCreatorAuth();const [rows,setRows]=useState<Review[]>([]),[open,setOpen]=useState(false),[selected,setSelected]=useState<string|null>(null),[more,setMore]=useState(false);
 const [publicNote,setPublicNote]=useState(''),[privateNote,setPrivateNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false);
 const [mfaCode,setMfaCode]=useState('');
 const generation=useRef(0),lock=useRef(false);useEffect(()=>()=>{generation.current++;},[actorId]);
 async function load(append=false){if(lock.current)return;lock.current=true;setBusy(true);setError('');const current=generation.current;try{const last=append?rows.at(-1):null;const r=await withTimeout(supabase.rpc('list_account_review_queue',{p_before:last?.updated_at??null,p_before_id:last?.case_id??null}),15000,'Review queue took too long.');if(r.error||!Array.isArray(r.data)||r.data.some((a:Review)=>typeof a.case_id!=='string'||typeof a.workspace!=='string'||typeof a.updated_at!=='string'))throw Error('Review queue unavailable');if(current!==generation.current)return;setRows(previous=>append?[...previous,...r.data.filter((a:Review)=>!previous.some(p=>p.case_id===a.case_id))]:r.data);setMore(r.data.length===50);setUncertain(false);setOpen(true);if(!append){setSelected(null);setPublicNote('');setPrivateNote('');}}catch{if(current===generation.current)setError('Account reviews could not be loaded. Refresh to confirm the current queue.');}finally{lock.current=false;if(current===generation.current)setBusy(false);}}
 async function decide(row:Review,action:string,elevation:string|null,current:number){
  if(lock.current||current!==generation.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
  try{const r=await withTimeout(supabase.rpc('decide_account_review',{p_case_id:row.case_id,p_action:action,p_public_note:publicNote.trim(),p_private_note:privateNote.trim(),p_expected_updated_at:row.updated_at,p_elevation:elevation}),20000,'Review result is uncertain. Refresh before retrying.');if(r.error||r.data?.success!==true||r.data.case_id!==row.case_id||r.data.action!==action)throw Error('Decision not confirmed');if(current!==generation.current)return;setNotice('Review update saved. Refresh the queue to see its current state.');setUncertain(true);setSelected(null);}
  catch{if(current===generation.current){setError('The review update could not be confirmed. Refresh before retrying. The restriction or case may have changed, or required evidence checks may still be incomplete.');setUncertain(true);}}
  finally{lock.current=false;if(current===generation.current)setBusy(false);}
 }
 async function confirmDecision(row:Review,action:string){
  if(lock.current)return;const current=generation.current;
  if(actorRole==='creator'){requestElevation('all_sensitive',id=>void decide(row,action,id,current));return;}
  if(actorRole==='staff'){await decide(row,action,null,current);return;}
  lock.current=true;setBusy(true);setError('');
  try{if(!['claim','request_information','escalate'].includes(action)){await confirmAdminReview(mfaCode);setMfaCode('');}lock.current=false;await decide(row,action,null,current);}
  catch(cause){if(current===generation.current)setError(cause instanceof Error?cause.message:'Security confirmation failed');}
  finally{lock.current=false;if(current===generation.current)setBusy(false);}
 }
 return <section aria-label="Account review queue" className="space-y-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
  <header><h2 className="text-base font-semibold">Account and workspace appeals</h2><p className="mt-1 text-sm leading-6 text-[var(--wh-text-secondary)]">Review the existing restriction and evidence. Restore only the relevant access. Reuse existing evidence where it is still valid. Public updates and internal notes are separate.</p></header>
  <button type="button" disabled={busy} onClick={()=>void load()} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold">{busy?'Loading…':open?'Refresh account reviews':'Open account reviews'}</button>
  {error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
  {open&&!error&&rows.length===0&&<p className="text-sm">No account reviews are recorded.</p>}
  {open&&rows.map(row=>{const stale=row.current_version!==row.restriction_version||!row.restricted;return <article key={row.case_id} className="space-y-3 border-t border-[var(--wh-border-subtle)] pt-4">
   <button type="button" disabled={busy} className="min-h-11 w-full text-left" onClick={()=>{setSelected(selected===row.case_id?null:row.case_id);setPublicNote('');setPrivateNote('');}}><strong className="block text-sm">Case #{row.case_number} · {workspaceName(row.workspace)}</strong><span className="text-xs text-[var(--wh-text-secondary)]">{row.username||row.user_id} · {row.decision||row.status.replaceAll('_',' ')}</span></button>
   {selected===row.case_id&&<><p className="whitespace-pre-wrap text-sm">{row.explanation}</p>{row.updates?.map((u,i)=><div key={i} className="space-y-1 border-l-2 border-violet-400 pl-3 text-sm">{u.public_note&&<p className="whitespace-pre-wrap">Public: {u.public_note}</p>}{u.internal_note&&<p className="whitespace-pre-wrap text-[var(--wh-text-secondary)]">Internal: {u.internal_note}</p>}</div>)}{row.public_decision&&<p className="text-sm">{row.public_decision}</p>}{stale&&<p className="text-sm text-amber-800 dark:text-amber-300">This restriction changed or was lifted. Do not restore a different restriction.</p>}
    <label className="block text-sm">Public update to the person<textarea rows={3} maxLength={2000} value={publicNote} onChange={e=>setPublicNote(e.target.value)} disabled={busy} className="mt-1 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-bg)] p-3"/></label>
    <label className="block text-sm">Internal review note<textarea rows={3} maxLength={2000} value={privateNote} onChange={e=>setPrivateNote(e.target.value)} disabled={busy} className="mt-1 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-bg)] p-3"/></label>
    {actorRole==='admin'&&<label className="block text-sm">Authenticator code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={e=>setMfaCode(e.target.value.replace(/[^0-9]/g,''))} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-bg)] p-3"/></label>}
    <div className="flex flex-wrap gap-2">{(row.decision?[]:row.assigned_user_id!==actorId?['claim']:actorRole==='staff'?['request_information','escalate']:stale?['superseded']:['request_information','upheld','restored']).map(action=><button key={action} type="button" disabled={busy||uncertain||publicNote.trim().length<10} onClick={()=>void confirmDecision(row,action)} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-3 text-sm font-semibold disabled:opacity-50">{{claim:'Assign review to me',request_information:'Request relevant information',escalate:'Send to Admin for decision',upheld:'Keep restriction',restored:'Restore reviewed access',superseded:'Close superseded review'}[action]}</button>)}</div></>}
  </article>;})}
  {open&&more&&<button type="button" disabled={busy} onClick={()=>void load(true)} className="min-h-11 px-3 text-sm font-semibold">Load older account reviews</button>}
 </section>;
}
