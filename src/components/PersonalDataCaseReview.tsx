import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase/client';
import {withTimeout} from '@/lib/withTimeout';
import {useCreatorAuth} from '@/hooks/useCreatorAuth';
import {confirmAdminReview} from '@/lib/reviewStepUp';
import {personalDataReview,type PersonalDataReview,type PersonalDataOutcome} from '@/lib/personalDataReview';
import {Button} from '@/components/ui/button';
import PersonalDataExportDownload from '@/components/PersonalDataExportDownload';

type Command={id:string;revision:string;outcome:PersonalDataOutcome;completed:string;retained:string};
type ExportCommand={id:string;revision:string;allowed:boolean};
export default function PersonalDataCaseReview({conversationId,creator,onResolved}:{conversationId:string;creator:boolean;onResolved:()=>void}){
 const {requestElevation}=useCreatorAuth();
 const [review,setReview]=useState<PersonalDataReview|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
 const [outcome,setOutcome]=useState<PersonalDataOutcome>('partly_completed'),[completed,setCompleted]=useState(''),[retained,setRetained]=useState(''),[code,setCode]=useState('');
 const lock=useRef(false),generation=useRef(0),pending=useRef<Command|null>(null);
 const pendingExport=useRef<ExportCommand|null>(null);
 useEffect(()=>{const current=++generation.current;setLoading(true);setError('');
  void withTimeout(supabase.rpc('get_personal_data_case_review',{p_conversation_id:conversationId}),15000,'Review took too long. Refresh this request.').then(({data,error})=>{
   if(error)throw error;const result=personalDataReview(data,conversationId);
   if(current===generation.current){setReview(result);if(result.response?.request_id===pending.current?.id)pending.current=null;if(result.export?.decision_id===pendingExport.current?.id)pendingExport.current=null;}
  }).catch(cause=>{if(current===generation.current){setReview(null);setError(message(cause));}}).finally(()=>{if(current===generation.current)setLoading(false);});
  return()=>{generation.current++;};
 },[conversationId,attempt]);
 async function send(command:Command,elevation:string|null){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');const current=generation.current;
  try{
   if(!creator)await confirmAdminReview(code);
   if(current!==generation.current)return;
   // Retain this exact command after an uncertain transport result. Editing the
   // form is disabled until its server receipt has been checked.
   pending.current=command;
   const {data,error}=await withTimeout(supabase.rpc('respond_to_personal_data_case',{p_request_id:command.id,p_conversation_id:conversationId,p_revision:command.revision,p_outcome:command.outcome,p_completed:command.completed,p_retained:command.retained,p_creator_elevation_id:elevation}),15000,'Response result is unknown. Refresh the request before retrying.');
   if(error){if(['22023','42501','40001'].includes(error.code))pending.current=null;throw error;}const result=personalDataReview(data,conversationId);
   if(result.response?.request_id!==command.id||result.response.outcome!==command.outcome||result.response.completed!==command.completed||result.response.retained!==command.retained||result.status!=='resolved')throw Error('The response receipt could not be confirmed. Refresh the request.');
   if(current===generation.current){pending.current=null;setReview(result);setCode('');onResolved();}
  }catch(cause){if(current===generation.current){setCode('');setError(message(cause));}}
  finally{lock.current=false;if(current===generation.current)setBusy(false);}
 }
 function submit(){
  if(lock.current||pendingExport.current||!review?.can_respond)return;
  const command=pending.current||{id:crypto.randomUUID(),revision:review.revision,outcome,completed:outcome==='not_completed'?'':completed.trim(),retained:outcome==='completed'?'':retained.trim()};
  const current=generation.current;
  if(creator)requestElevation('all_sensitive',elevation=>{if(current===generation.current)void send(command,elevation);});else void send(command,null);
 }
 async function sendExport(command:ExportCommand,elevation:string|null){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');const current=generation.current;
  try{
   if(!creator)await confirmAdminReview(code);
   if(current!==generation.current)return;pendingExport.current=command;
   const {data,error}=await withTimeout(supabase.rpc('set_personal_data_export_access',{p_request_id:command.id,p_conversation_id:conversationId,p_revision:command.revision,p_allowed:command.allowed,p_creator_elevation_id:elevation}),15000,'Export approval result is unknown. Refresh the request before retrying.');
   if(error){if(['22023','42501','40001'].includes(error.code))pendingExport.current=null;throw error;}
   const result=personalDataReview(data,conversationId);
   if(result.export?.decision_id!==command.id||Boolean(result.export.approval_id)!==command.allowed)throw Error('The export decision could not be confirmed. Refresh the request.');
   if(current===generation.current){pendingExport.current=null;setReview(result);setCode('');onResolved();}
  }catch(cause){if(current===generation.current){setCode('');setError(message(cause));}}
  finally{lock.current=false;if(current===generation.current)setBusy(false);}
 }
 function changeExportAccess(allowed:boolean){
  if(lock.current||pending.current||!review?.can_respond)return;
  const command=pendingExport.current||{id:crypto.randomUUID(),revision:review.revision,allowed},current=generation.current;
  if(creator)requestElevation('all_sensitive',elevation=>{if(current===generation.current)void sendExport(command,elevation);});else void sendExport(command,null);
 }
 const unresolved=Boolean(pending.current||pendingExport.current),valid=outcome==='completed'?completed.trim().length>=20:outcome==='not_completed'?retained.trim().length>=20:completed.trim().length>=20&&retained.trim().length>=20;
 return <section aria-label="Personal-data review" className="space-y-4 border-b border-[var(--wh-border)] bg-[var(--wh-surface)] px-4 py-5 text-sm text-[var(--wh-text)]">
  <div className="mx-auto max-w-4xl space-y-4"><header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Personal-data review</h2><p className="mt-1 max-w-2xl leading-6 text-[var(--wh-text-secondary)]">Record the outcome after verifying the completed work.</p></div><Button className="min-h-11" variant="outline" disabled={busy||loading} onClick={()=>setAttempt(n=>n+1)}>Refresh review</Button></header>
  {loading&&<p role="status">Loading review…</p>}{error&&<p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
  {!loading&&review?.export?.can_download&&<PersonalDataExportDownload key={conversationId+review.export.approval_id} conversationId={conversationId} access={review.export}/>}
  {!loading&&review?.can_respond&&review.reason_code==='personal_data_access'&&<div className="space-y-3 rounded-xl border border-[var(--wh-border)] p-4"><h3 className="font-semibold">Account-record download</h3><p className="leading-6 text-[var(--wh-text-secondary)]">Approve a private download for the requester after reviewing access. This prepares account records; supplementary information and original media remain in this case review. Approval does not resolve the request or erase data.</p><Button type="button" variant="outline" className="min-h-11" disabled={busy||Boolean(pending.current)} onClick={()=>changeExportAccess(!review.export?.approval_id)}>{pendingExport.current?'Retry same export decision':review.export?.approval_id?'Withdraw download access':'Approve account-record download'}</Button></div>}
  {!loading&&review?.response&&<div role="status" className="space-y-2 rounded-xl border border-[var(--wh-border)] p-4"><p className="font-semibold">Review response recorded · {review.response.outcome.replaceAll('_',' ')}</p>{review.response.completed&&<p className="whitespace-pre-wrap break-words">Work completed: {review.response.completed}</p>}{review.response.retained&&<p className="whitespace-pre-wrap break-words">Retained or not completed: {review.response.retained}</p>}</div>}
  {!loading&&review?.can_respond&&<form className="space-y-4" onSubmit={event=>{event.preventDefault();submit();}}>
   <p className="leading-6 text-[var(--wh-text-secondary)]">Describe completed work and any retained information with reasons. Erasure or exports must be completed and checked before recording the response. Keep internal notes and other people's data out of the reply.</p>
   <label className="block space-y-2"><span>Review outcome</span><select className="min-h-12 w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] px-3" disabled={busy||unresolved} value={outcome} onChange={event=>setOutcome(event.target.value as PersonalDataOutcome)}><option value="partly_completed">Partly completed</option><option value="completed">Completed</option><option value="not_completed">Not completed</option></select></label>
   {outcome!=='not_completed'&&<label className="block space-y-2"><span>Work completed and checked</span><textarea className="w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] p-3" rows={3} minLength={20} maxLength={4000} required disabled={busy||unresolved} value={completed} onChange={event=>setCompleted(event.target.value)}/></label>}
   {outcome!=='completed'&&<label className="block space-y-2"><span>Information retained or work not completed, and why</span><textarea className="w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] p-3" rows={3} minLength={20} maxLength={4000} required disabled={busy||unresolved} value={retained} onChange={event=>setRetained(event.target.value)}/></label>}
   {!creator&&<label className="block space-y-2"><span>Authenticator code, if fresh confirmation is needed</span><input className="min-h-12 w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] px-3" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} disabled={busy} onChange={event=>setCode(event.target.value.replace(/\D/g,''))}/></label>}
   {unresolved&&<p role="status">The previous response needs confirmation. Refresh the review or retry the same response.</p>}
   <Button className="min-h-11" type="submit" disabled={busy||Boolean(pendingExport.current)||(!unresolved&&!valid)}>{busy?'Recording response…':pending.current?'Retry same response':'Confirm and record review response'}</Button>
  </form>}
  {!loading&&review&&!review.can_respond&&!review.response&&<p className="leading-6 text-[var(--wh-text-secondary)]">Use the case messages to request information or escalate the review. The assigned Admin or Creator records the final response after completing the work.</p>}
  </div>
 </section>;
}
function message(cause:unknown){return cause instanceof Error?cause.message:(cause as {message?:string})?.message||'The personal-data review could not be confirmed.';}
