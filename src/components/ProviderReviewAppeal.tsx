import {useEffect,useId,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {getReviewAppeal,submitReviewAppeal,type ReviewAppealState} from '@/lib/providerReviews';

export default function ProviderReviewAppeal({reviewId}:{reviewId:string}){
 const [state,setState]=useState<ReviewAppealState|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[explanation,setExplanation]=useState('');
 const generation=useRef(0),lock=useRef(false),request=useRef<{payload:string;id:string}|null>(null),inputId=useId();
 useEffect(()=>{const current=++generation.current;setLoading(true);setError('');setState(null);void getReviewAppeal(reviewId).then(data=>{if(current===generation.current)setState(data);}).catch(()=>{if(current===generation.current)setError('Your appeal status could not be loaded. Refresh before sending.');}).finally(()=>{if(current===generation.current)setLoading(false);});return()=>{generation.current++;};},[reviewId,attempt]);
 async function submit(){
  if(lock.current||!state?.eligible||!state.moderation_request_id)return;
  const payload=JSON.stringify([reviewId,state.moderation_request_id,explanation.trim()]);if(request.current?.payload!==payload)request.current={payload,id:crypto.randomUUID()};
  lock.current=true;setBusy(true);setError('');const current=generation.current;
  try{const data=await submitReviewAppeal(reviewId,state.moderation_request_id,explanation,request.current.id);if(current===generation.current)setState(data);}
  catch{if(current===generation.current)setError('Your appeal receipt could not be confirmed. Refresh its status before retrying.');}
  finally{lock.current=false;if(current===generation.current)setBusy(false);}
 }
 const appeal=state?.appeal;
 return <section aria-label="Review appeal" className="space-y-3 rounded-xl border border-[var(--wh-border)] p-4 text-sm leading-6">
  <h3 className="font-semibold">Ask WeHouse to review this decision</h3>
  <p className="text-[var(--wh-text-secondary)]">Editing does not restore a hidden review. An appeal sends your explanation to the moderation team and keeps a tracked decision.</p>
  {loading?<p role="status">Checking appeal status…</p>:<>
   {error&&<p role="alert">{error}</p>}
   {appeal?<div className="space-y-2" role="status"><p className="font-medium">{appeal.status==='open'?'Appeal received':appeal.status==='reviewing'?'Appeal under review':appeal.outcome==='restored'?'Review restored':appeal.outcome==='upheld'?'Decision upheld':'Appeal reviewed'}</p><p className="break-all text-xs">Appeal reference: {appeal.id}</p><p className="whitespace-pre-wrap break-words">Your explanation: {appeal.explanation}</p>{appeal.decision&&<p className="whitespace-pre-wrap break-words">WeHouse’s decision: {appeal.decision}</p>}</div>:state?.eligible?<form className="space-y-3" onSubmit={event=>{event.preventDefault();void submit();}}><label className="block" htmlFor={inputId}>Why should this decision be reviewed?</label><textarea id={inputId} value={explanation} onChange={event=>setExplanation(event.target.value)} disabled={busy} minLength={10} maxLength={1000} rows={3} required className="w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] p-3"/><p className="text-xs text-[var(--wh-text-secondary)]">Use 10–1000 characters. Do not include private identity, contact or payment details.</p><Button type="submit" disabled={busy||explanation.trim().length<10}>{busy?'Sending appeal…':'Send review appeal'}</Button></form>:state?<p>This review has no decision available to appeal. Refresh the booking to see its current visibility.</p>:null}
   <Button type="button" variant="outline" disabled={busy} onClick={()=>setAttempt(n=>n+1)}>Refresh appeal status</Button>
  </>}
 </section>;
}
