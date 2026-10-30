import {confirmAdminReview} from '@/lib/reviewStepUp';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase/client';
import {withTimeout} from '@/lib/withTimeout';
import {workspaceName} from '@/lib/accountRecovery';
import {useCreatorAuth} from '@/hooks/useCreatorAuth';
type Snapshot={protected:boolean;workspaces:string[];restrictions:Array<{workspace:string;restricted:boolean;version:string;public_reason:string}>};
export default function WorkspaceRestrictionControls({userId,actorRole='creator'}:{userId:string;actorRole?:'creator'|'admin'}){
 const {requestElevation}=useCreatorAuth();
 const [data,setData]=useState<Snapshot|null>(null),[open,setOpen]=useState(false),[scope,setScope]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false);
 const [mfaCode,setMfaCode]=useState('');
 const generation=useRef(0),lock=useRef(false);
 useEffect(()=>()=>{generation.current++;},[userId]);
 function parse(value:unknown){const d=value as Snapshot;if(!d||typeof d.protected!=='boolean'||!Array.isArray(d.workspaces)||d.workspaces.some(w=>typeof w!=='string')||!Array.isArray(d.restrictions)||d.restrictions.some(r=>typeof r.workspace!=='string'||typeof r.version!=='string'||typeof r.restricted!=='boolean'))throw Error('Workspace status could not be confirmed');return d;}
 async function load(){if(lock.current)return;lock.current=true;setBusy(true);setError('');const current=generation.current;try{const r=await withTimeout(supabase.rpc('review_workspace_access',{p_user_id:userId}),15000,'Workspace access took too long.');if(r.error)throw r.error;const next=parse(r.data);if(current===generation.current){setData(next);setUncertain(false);setConfirmed(false);}}catch{if(current===generation.current)setError('Workspace access could not be loaded. Refresh before making changes.');}finally{lock.current=false;if(current===generation.current)setBusy(false);}}
 const row=data?.restrictions.find(r=>r.workspace===scope),restricted=row?.restricted===true;
 async function change(elevation:string|null,current:number){
  if(lock.current||current!==generation.current||!confirmed||!data||data.protected)return;
  lock.current=true;setBusy(true);setError('');setNotice('');
  try{const r=await withTimeout(supabase.rpc('review_workspace_access',{p_user_id:userId,p_workspace:scope,p_restricted:!restricted,p_reason:reason.trim(),p_expected_version:row?.version??null,p_elevation:elevation}),20000,'Workspace result is uncertain. Refresh before retrying.');
   if(r.error)throw r.error;const next=parse(r.data);if(next.restrictions.find(r=>r.workspace===scope)?.restricted!==!restricted)throw Error('Saved status not confirmed');
   if(current===generation.current){setData(next);setReason('');setConfirmed(false);setNotice('Workspace access change saved. Other workspace restrictions and professional evidence are unchanged.');}
  }catch{if(current===generation.current){setError('Workspace access could not be confirmed. Refresh its saved status before retrying.');setUncertain(true);}}
  finally{lock.current=false;if(current===generation.current)setBusy(false);}
 }
 async function confirmChange(){
  if(lock.current)return;const current=generation.current;
  if(actorRole==='creator'){requestElevation('all_sensitive',id=>void change(id,current));return;}
  lock.current=true;setBusy(true);setError('');
  try{await confirmAdminReview(mfaCode);setMfaCode('');lock.current=false;await change(null,current);}
  catch(cause){if(current===generation.current)setError(cause instanceof Error?cause.message:'Security confirmation failed');}
  finally{lock.current=false;if(current===generation.current)setBusy(false);}
 }
 return <section aria-label="Workspace restrictions" className="space-y-3 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
  <h3 className="text-base font-semibold">Workspace restrictions</h3><p className="text-sm leading-6 text-[var(--wh-text-secondary)]">Restrict one workspace without suspending the person’s other workspaces. Evidence, approvals, bookings and money records are retained. Whole-account suspension is a separate security action.</p>
  <button type="button" disabled={busy} onClick={()=>{setOpen(true);void load();}} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-3 text-sm font-semibold">{busy?'Loading…':open?'Refresh workspace restrictions':'Open workspace restrictions'}</button>
  {error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
  {open&&data&&(data.protected?<p className="text-sm">You cannot restrict your own workspaces or Creator access here.</p>:<>
   <label className="block text-sm">Workspace<select value={scope} disabled={busy} onChange={e=>{setScope(e.target.value);setConfirmed(false);setReason('');}} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-bg)] p-3"><option value="">Choose a workspace</option>{data.workspaces.map(w=><option key={w} value={w}>{workspaceName(w)}</option>)}</select></label>
   {scope&&<><p className="text-sm font-medium">{workspaceName(scope)}: {restricted?'Restricted':'Not restricted'}</p><label className="block text-sm">Reason shown to this person<textarea maxLength={2000} rows={3} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)} className="mt-1 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-bg)] p-3"/></label>
    <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)} className="mt-1"/><span>I am changing only {workspaceName(scope)} access. This does not change other restrictions or delete professional evidence.</span></label>
    {actorRole==='admin'&&<label className="block text-sm">Authenticator code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={e=>setMfaCode(e.target.value.replace(/[^0-9]/g,''))} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-bg)] p-3"/><span className="text-xs">A recent authenticator confirmation is required for access changes.</span></label>}
    <button type="button" disabled={busy||uncertain||!confirmed||reason.trim().length<10} onClick={()=>void confirmChange()} className="min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{restricted?'Restore this workspace':'Restrict this workspace'}</button></>}
  </>)}
 </section>;
}
