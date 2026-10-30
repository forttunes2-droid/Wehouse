import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { approveExperienceActivity, EXPERIENCE_APPROVAL_CHECKS, getExperienceApprovalReadiness, type ExperienceActivity, type ExperienceApprovalReadiness } from '@/lib/experienceActivities';

export default function ExperienceApprovalPanel({activity,note,disabled=false,refreshToken=0,onApproved,onBusyChange}:{activity:ExperienceActivity;note:string;disabled?:boolean;refreshToken?:number;onApproved:(activity:ExperienceActivity)=>void;onBusyChange:(busy:boolean)=>void}){
 const [readiness,setReadiness]=useState<ExperienceApprovalReadiness|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
 const lock=useRef(false),generation=useRef(0);
 useEffect(()=>{onBusyChange(busy);return()=>onBusyChange(false);},[busy,onBusyChange]);
 useEffect(()=>{
  const request=++generation.current;setLoading(true);setReadiness(null);setError('');
  void getExperienceApprovalReadiness(activity).then(data=>{if(request===generation.current)setReadiness(data);}).catch(cause=>{if(request===generation.current)setError(message(cause));}).finally(()=>{if(request===generation.current)setLoading(false);});
  return()=>{generation.current++;};
 },[activity.id,activity.revision,attempt,refreshToken]);
 async function approve(){
  if(lock.current||disabled||!readiness?.can_approve||note.trim().length<20)return;
  lock.current=true;setBusy(true);setError('');const request=generation.current;
  try{const saved=await approveExperienceActivity(activity,note);if(request===generation.current)onApproved(saved);}
  catch(cause){if(request===generation.current)setError(message(cause));}
  finally{lock.current=false;if(request===generation.current)setBusy(false);}
 }
 return <section aria-label="Activity approval" className="space-y-3 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Activity approval</h3><Button type="button" variant="outline" disabled={busy||disabled} onClick={()=>setAttempt(n=>n+1)}>Refresh approval checks</Button></div>
  <p className="text-sm leading-6 text-[var(--wh-text-secondary)]">Approve the activity review only after its required checks pass. Public availability and checkout need their own activation checks.</p>
  {loading&&<p role="status" className="text-sm">Checking activity readiness...</p>}
  {error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
  {readiness&&<ul className="grid gap-2 sm:grid-cols-2">{Object.entries(EXPERIENCE_APPROVAL_CHECKS).map(([key,label])=><li key={key} className="flex items-start justify-between gap-3 rounded-xl bg-[var(--wh-elevated)] p-3 text-sm"><span>{label}</span><span className={`shrink-0 font-medium ${readiness.checks[key as keyof typeof EXPERIENCE_APPROVAL_CHECKS]?'text-emerald-700 dark:text-emerald-300':'text-amber-800 dark:text-amber-200'}`}>{readiness.checks[key as keyof typeof EXPERIENCE_APPROVAL_CHECKS]?'Complete':'Needed'}</span></li>)}</ul>}
  {activity.status==='submitted'&&<><p className="text-xs leading-5 text-[var(--wh-text-secondary)]">Use the shared feedback field above to record the approval basis in at least 20 characters. The server rechecks eligibility when you approve.</p><Button type="button" disabled={busy||disabled||loading||!readiness?.can_approve||note.trim().length<20} onClick={()=>void approve()}>{busy?'Approving...':'Approve activity'}</Button></>}
  {activity.status==='approved'&&<p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Activity review approved. The host manages publication separately.</p>}
 </section>;
}
function message(cause:unknown){return cause instanceof Error?cause.message:(cause as {message?:string})?.message||'Activity approval could not be confirmed. Refresh before retrying.';}
