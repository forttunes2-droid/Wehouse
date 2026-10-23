import ExperienceApprovalPanel from '@/components/ExperienceApprovalPanel';
import ExperiencePhotosPanel from '@/components/ExperiencePhotosPanel';
import ExperienceSessionsPanel from '@/components/ExperienceSessionsPanel';
import ReviewedDocuments from '@/components/ReviewedDocuments';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useCreatorAuth } from '@/hooks/useCreatorAuth';
import ExperienceActivityHistory from '@/components/ExperienceActivityHistory';
import { EXPERIENCE_DETAIL_LABELS, getExperienceActivity, listExperienceActivities, reviewExperienceActivity, type ExperienceActivity, type ExperienceDraft } from '@/lib/experienceActivities';
import { displayMoment } from '@/lib/displayDate';

const ignoreSessionDirty = () => {};

/** Private application queue; it cannot approve publication or enable checkout. */
export default function ExperienceActivityReviewQueue({initialApplicationId}:{initialApplicationId?:string}) {
 const {requestElevation}=useCreatorAuth();
 const [open,setOpen]=useState(false),[rows,setRows]=useState<ExperienceActivity[]>([]),[selected,setSelected]=useState<ExperienceActivity|null>(null);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState(''),[notice,setNotice]=useState(''),[hasMore,setHasMore]=useState(false);
 const generation=useRef(0),acting=useRef(false);
 const [confirmDecline,setConfirmDecline]=useState(false);
 const [photoBusy,setPhotoBusy]=useState(false);
 const [approvalBusy,setApprovalBusy]=useState(false),[checksVersion,setChecksVersion]=useState(0);
 useEffect(()=>()=>{generation.current+=1;},[]);
 async function load(more=false){const request=++generation.current;setLoading(true);setError('');try{const next=await listExperienceActivities(true,more?rows.at(-1):undefined);if(request!==generation.current)return;setRows(previous=>more?[...previous,...next.filter(row=>!previous.some(item=>item.id===row.id))]:next);setHasMore(next.length===20);if(!more)setSelected(previous=>previous?next.find(row=>row.id===previous.id)||null:null);setOpen(true);}catch(cause){if(request===generation.current)setError(message(cause));}finally{if(request===generation.current)setLoading(false);}}
 function unlock(){requestElevation('private_evidence',()=>{void load();});}
 function openLinked(){requestElevation('private_evidence',()=>{void (async()=>{
  const request=++generation.current;setLoading(true);setError('');
  try{const row=await getExperienceActivity(initialApplicationId||'',true);if(request!==generation.current)return;setSelected(row);setNote('');setNotice('');setOpen(true);}
  catch(cause){if(request===generation.current)setError(message(cause));}
  finally{if(request===generation.current)setLoading(false);}
 })();});}
 async function decide(decision:'changes_required'|'declined'){if(!selected||selected.status!=='submitted'||acting.current||photoBusy||approvalBusy)return;if(note.trim().length<20){setError('Explain the decision in at least 20 characters.');return;}acting.current=true;setBusy(true);setError('');setNotice('');try{const saved=await reviewExperienceActivity(selected,decision,note.trim());setRows(previous=>previous.filter(row=>row.id!==saved.id));setSelected(null);setNote('');setNotice(decision==='changes_required'?'Changes requested. The host can read your feedback in the application history.':'Application declined. The host can read your decision in the application history.');}catch(cause){setError(message(cause));}finally{acting.current=false;setBusy(false);}}
 return <section className="space-y-4 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4"><header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold">Experience applications</h2><p className="mt-1 text-sm text-[var(--wh-text-secondary)]">Private activity submissions and review feedback.</p></div><Button type="button" variant="outline" disabled={loading||busy||photoBusy||approvalBusy} onClick={unlock}>{loading?'Loading...':open?'Confirm access and refresh':'Open review queue'}</Button></header>
  {initialApplicationId&&<Button type="button" variant="outline" disabled={loading||busy||photoBusy||approvalBusy} onClick={openLinked}>Review linked application</Button>}
  {error&&<p role="alert" className="break-words text-sm text-red-700 dark:text-red-300">{error}</p>}{notice&&<p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
  {selected?<div className="space-y-4"><Button type="button" variant="outline" disabled={busy||photoBusy||approvalBusy} onClick={()=>{setSelected(null);setNote('');setError('');}}>Back to applications</Button><h3 className="break-words text-lg font-semibold">{selected.details.title}</h3><p className="break-all text-xs text-[var(--wh-text-secondary)]">Reference {selected.id} · Revision {selected.revision}</p><p className="text-sm text-[var(--wh-text-secondary)]">Current status: {selected.status.replaceAll('_',' ')}. Review decisions are available only while submitted.</p><ActivityReviewDetails activity={selected}/><ExperiencePhotosPanel activity={selected} review disabled={busy||approvalBusy} onBusyChange={setPhotoBusy} onChanged={()=>setChecksVersion(n=>n+1)}/><ReviewedDocuments key={'evidence:'+selected.id+':'+selected.revision} onChanged={()=>setChecksVersion(n=>n+1)} requestId={selected.id} accountId={selected.host_user_id} kind="experience" operator/>{['submitted','approved'].includes(selected.status) && <ExperienceSessionsPanel key={'sessions:'+selected.id + ':' + selected.revision} activity={selected} review onDirtyChange={ignoreSessionDirty}/>} <label className="block space-y-2"><span className="text-sm font-medium">Feedback shared with the host</span><textarea aria-label="Feedback shared with the host" rows={4} minLength={20} maxLength={2000} disabled={busy||photoBusy||approvalBusy} value={note} onChange={event=>setNote(event.target.value)} className="w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] p-3 text-sm"/></label><div className="flex flex-wrap gap-3"><Button type="button" disabled={busy||photoBusy||approvalBusy||selected?.status!=='submitted'||note.trim().length<20} onClick={()=>void decide('changes_required')}>Request changes</Button><Button type="button" variant="outline" disabled={busy||photoBusy||approvalBusy||selected?.status!=='submitted'||note.trim().length<20} onClick={()=>setConfirmDecline(true)}>Decline application</Button></div>{['submitted','approved'].includes(selected.status)&&<ExperienceApprovalPanel key={'approval:'+selected.id+':'+selected.revision} activity={selected} note={note} disabled={busy||photoBusy} refreshToken={checksVersion} onBusyChange={setApprovalBusy} onApproved={saved=>{setSelected(saved);setRows(previous=>previous.filter(row=>row.id!==saved.id));setNote('');setNotice('Activity review approved. Public booking is not open.');}}/>}<ExperienceActivityHistory key={'history:'+selected.id+':'+selected.revision} id={selected.id}/></div>:open&&!loading&&rows.length===0?<p className="text-sm text-[var(--wh-text-secondary)]">No submitted applications in this queue.</p>:open?<div className="divide-y divide-[var(--wh-border)]">{rows.map(row=><button type="button" key={row.id} onClick={()=>{setSelected(row);setNote('');setNotice('');}} className="wh-motion-control block min-h-20 w-full py-4 text-left"><span className="block break-words text-sm font-semibold">{row.details.title}</span><span className="mt-1 block text-xs text-[var(--wh-text-secondary)]">{row.details.city}, {row.details.state} · Submitted {displayMoment(row.updated_at)}</span></button>)}</div>:null}
  {open&&!selected&&hasMore&&<Button type="button" variant="outline" disabled={loading} onClick={()=>void load(true)}>Load more applications</Button>}
  <Dialog open={confirmDecline} onOpenChange={setConfirmDecline}><DialogContent><DialogTitle>Decline this application?</DialogTitle><DialogDescription>Your decision and feedback will be retained in the application history and shared with the host. Request changes instead if the activity can be corrected.</DialogDescription><div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={busy||photoBusy||approvalBusy} onClick={()=>setConfirmDecline(false)}>Keep reviewing</Button><Button type="button" disabled={busy||photoBusy||approvalBusy||selected?.status!=='submitted'||note.trim().length<20} onClick={()=>{setConfirmDecline(false);void decide('declined');}}>Decline application</Button></div></DialogContent></Dialog>
 </section>;
}
function message(cause:unknown){return cause instanceof Error?cause.message:(cause as {message?:string})?.message||'The application could not be loaded. Confirm access and refresh.';}

function ActivityReviewDetails({activity}:{activity:ExperienceActivity}) {
 const groups: {title:string;keys:(keyof ExperienceDraft)[]}[]=[
  {title:'Activity and host expertise',keys:['what_to_expect','host_expertise']},
  {title:'Location and meeting point',keys:['country_code','state','local_area','city','meeting_area','timezone']},
  {title:'Participation and accessibility',keys:['participation_requirements','accessibility_information','inclusions','exclusions']},
 ];
 return <div className="space-y-3">
  <div className="grid grid-cols-2 gap-3 rounded-2xl bg-[var(--wh-elevated)] p-4 sm:grid-cols-4">
   {[['Category',activity.category_name||activity.details.category.replaceAll('_',' ')],['Location',activity.details.city],['Duration',activity.details.duration_minutes+' minutes'],['Group size',activity.details.max_group_size+' people']].map(([label,value])=><div key={label}><p className="text-xs text-[var(--wh-text-secondary)]">{label}</p><p className="mt-1 break-words text-sm font-semibold">{value}</p></div>)}
  </div>
  {groups.map((group,index)=><details key={group.title} open={index===0} className="group rounded-2xl border border-[var(--wh-border)] px-4"><summary className="cursor-pointer py-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">{group.title}</summary><dl className="grid gap-4 pb-4 sm:grid-cols-2">{group.keys.map(key=><div key={key} className="min-w-0"><dt className="text-xs font-medium text-[var(--wh-text-secondary)]">{EXPERIENCE_DETAIL_LABELS[key]}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{Array.isArray(activity.details[key])?(activity.details[key] as string[]).join('\n')||'None stated':String(activity.details[key]??'Not supplied')}</dd></div>)}</dl></details>)}
 </div>;
}
