import {useEffect,useRef,useState} from 'react';
import AccountShell from '@/components/AccountShell';
import {Button} from '@/components/ui/button';
import {getPaidPlanBilling,openWorkSubscriptionManagement,type PaidPlanBilling as Plan} from '@/lib/paidPlanBilling';
import {formatRecordedMoney} from '@/lib/regional';
import type {Profile} from '@/types';
import type {WorkspaceName} from '@/lib/workspacePresentation';
export default function PaidPlanBilling({profile,workspace,onBack}:{profile:Profile;workspace:WorkspaceName;onBack:()=>void}){
 const [plans,setPlans]=useState<Plan[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[busy,setBusy]=useState(false);
 const generation=useRef(0),lock=useRef(false);
 useEffect(()=>{const current=++generation.current;setLoading(true);setError('');void getPaidPlanBilling(profile.user_id).then(rows=>{if(current===generation.current)setPlans(rows);}).catch(cause=>{if(current===generation.current){setPlans([]);setError(message(cause));}}).finally(()=>{if(current===generation.current)setLoading(false);});return()=>{generation.current++;};},[profile.user_id,attempt]);
 async function manage(plan:Plan){
  if(lock.current||!plan.can_manage||plan.provider==='prepaid')return;lock.current=true;setBusy(true);setError('');const current=generation.current;
  try{const destination=await openWorkSubscriptionManagement(plan.provider);if(current===generation.current){if(plan.provider==='paystack')window.location.assign(destination);else window.open(destination,'_blank','noopener,noreferrer');}}
  catch(cause){if(current===generation.current)setError(message(cause));}finally{lock.current=false;if(current===generation.current)setBusy(false);}
 }
 function help(){window.dispatchEvent(new CustomEvent('openSupportChat',{detail:{subject:'Paid plan billing',category:'payment',contextType:'contextual_help',contextId:profile.user_id,contextSnapshot:{reason_code:'paid_plan_billing',subject_type:'account',source_id:profile.user_id,requester_workspace:workspace}}}));}
 return <AccountShell profile={profile} workspace={workspace} title="Billing & subscriptions" description="Review your existing paid plans and manage renewal." onBack={onBack}>
  <div className="flex flex-wrap gap-3"><Button className="min-h-11" variant="outline" disabled={loading||busy} onClick={()=>setAttempt(n=>n+1)}>Refresh billing</Button><Button className="min-h-11" variant="outline" disabled={busy} onClick={help}>Get billing help</Button></div>
  {loading&&<p role="status" className="text-sm">Loading billing records…</p>}{error&&<p role="alert" className="rounded-xl border border-red-500/25 p-4 text-sm text-red-700 dark:text-red-300">{error}</p>}
  {!loading&&!error&&!plans.length&&<p className="rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-5 text-sm text-[var(--wh-text-secondary)]">No paid plans are recorded for this account.</p>}
  <div className="grid gap-4 lg:grid-cols-2">{plans.map(plan=><article key={plan.kind} className="space-y-4 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-5"><header><h2 className="text-base font-semibold">{plan.name}</h2><p className="mt-1 text-sm capitalize text-[var(--wh-text-secondary)]">{plan.status.replaceAll('_',' ')}</p></header>
   <dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-xs text-[var(--wh-text-secondary)]">Billing provider</dt><dd className="mt-1">{plan.provider==='prepaid'?'WeHouse prepaid access':plan.provider==='apple'?'Apple App Store':plan.provider==='google'?'Google Play':'Paystack'}</dd></div><div><dt className="text-xs text-[var(--wh-text-secondary)]">Paid period ends</dt><dd className="mt-1">{plan.period_end?new Date(plan.period_end).toLocaleString():'Not recorded'}</dd></div>{plan.price!==null&&plan.currency&&<div><dt className="text-xs text-[var(--wh-text-secondary)]">Recorded plan price</dt><dd className="mt-1">{formatRecordedMoney(plan.price,plan.currency)} {plan.billing_period==='monthly'?'per month':plan.billing_period==='yearly'?'per year':''}</dd></div>}<div><dt className="text-xs text-[var(--wh-text-secondary)]">Recorded renewal</dt><dd className="mt-1">{plan.provider==='prepaid'?'Does not renew automatically':plan.cancel_at_period_end?'Cancellation at period end':plan.auto_renews?'On':'Off'}</dd></div></dl>
   {plan.last_verified_at&&<p className="text-xs leading-5 text-[var(--wh-text-secondary)]">Last provider confirmation: {new Date(plan.last_verified_at).toLocaleString()}</p>}
   {!plan.workspace_access&&<p className="rounded-xl bg-[var(--wh-elevated)] p-3 text-sm leading-6">This workspace is unavailable. You can still manage existing billing here; doing so does not restore workspace access.</p>}
   {plan.can_manage&&<Button className="min-h-11 w-full" disabled={busy} onClick={()=>void manage(plan)}>{busy?'Opening billing provider…':'Manage or cancel subscription'}</Button>}
  </article>)}</div>
  <p className="text-xs leading-5 text-[var(--wh-text-secondary)]">Provider records confirm changes to renewal and paid access. Opening a management page does not itself cancel a plan. Property tools use prepaid access.</p>
 </AccountShell>;
}
function message(cause:unknown){return cause instanceof Error?cause.message:(cause as {message?:string})?.message||'Billing could not be confirmed. Refresh or contact WeHouse.';}
