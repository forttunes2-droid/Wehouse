import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase/client';
import {withTimeout} from '@/lib/withTimeout';
import {Button} from '@/components/ui/button';
type Status={reservation_id:string;status:'manual'|'pending'|'active'|'disabled'|'needs_action';last4:string|null;card_type:string|null;payment_pending:boolean;last_result:string|null};
function parse(value:unknown,id:string){const r=value as Status;if(!r||r.reservation_id!==id||!['manual','pending','active','disabled','needs_action'].includes(r.status)||typeof r.payment_pending!=='boolean'||r.last4!==null&&!/^\d{4}$/.test(r.last4)||r.last_result!==null&&typeof r.last_result!=='string')throw Error('Automatic payment status could not be confirmed.');return r;}
type Props={reservationId:string;agreementDigest:string;userId:string};
export default function LaterRentAutomaticPayment(props:Props){return <AutomaticPayment key={props.userId+':'+props.reservationId} {...props}/>;}
function AutomaticPayment({reservationId,agreementDigest}:Props){
 const [status,setStatus]=useState<Status|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[accepted,setAccepted]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const generation=useRef(0),lock=useRef(false);
 async function read(){const{data,error}=await withTimeout(supabase.rpc('get_my_later_rent_debit',{p_reservation_id:reservationId}),15000,'Automatic payment status took too long.');if(error)throw error;return parse(data,reservationId);}
 useEffect(()=>{const current=++generation.current;setLoading(true);setError('');setStatus(null);setAccepted(false);void read().then(r=>{if(current===generation.current)setStatus(r);}).catch(c=>{if(current===generation.current)setError(message(c));}).finally(()=>{if(current===generation.current)setLoading(false);});return()=>{generation.current++;};},[reservationId,attempt]);
 async function change(enable:boolean){if(lock.current||enable&&!accepted)return;lock.current=true;setBusy(true);setError('');const current=generation.current;
  try{
   if(enable){const r=await withTimeout(supabase.functions.invoke('rent-automatic-payment',{body:{reservation_id:reservationId,agreement_digest:agreementDigest,accept:true}}),25000,'Setup result is unknown. Refresh before trying again.');if(r.error||r.data?.success!==true)throw Error(r.data?.error||'A reusable card could not be confirmed. Refresh status; manual payment remains available.');}
   else{const r=await withTimeout(supabase.rpc('disable_my_later_rent_debit',{p_reservation_id:reservationId}),15000,'Disable result is unknown. Refresh before trying again.');if(r.error)throw r.error;const saved=parse(r.data,reservationId);if(saved.status!=='disabled')throw Error('Disabling automatic payment was not confirmed.');}
   const saved=await read();if(current===generation.current){setStatus(saved);setAccepted(false);}
  }catch(c){if(current===generation.current)setError(message(c));}finally{lock.current=false;if(current===generation.current)setBusy(false);}
 }
 return <section aria-label="Automatic rent payment" className="space-y-3 rounded-xl border border-[var(--wh-border-subtle)] p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">How you pay later-year rent</h4><Button type="button" variant="outline" disabled={busy||loading} onClick={()=>setAttempt(n=>n+1)}>Refresh automatic payment</Button></div>
  {loading&&<p role="status">Checking payment method...</p>}{error&&<p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
  {status&&!loading&&<><p className="leading-6 text-[var(--wh-text-secondary)]">{status.status==='active'?`Automatic payment is on · ${status.card_type||'Card'} ending ${status.last4}`:status.status==='pending'?'Automatic setup is not yet confirmed. No automatic payment is enabled.':status.status==='needs_action'?'Automatic payment needs your attention. Check the payment record before paying again.':'Manual payment. Choose each due payment in your booking.'}</p>
   {status.last_result&&<p className="leading-6 text-[var(--wh-text-secondary)]">{status.last_result}</p>}{status.payment_pending&&<p role="status" className="leading-6">An automatic payment is being reconciled. Do not pay it again. Turning off future debits does not undo a payment already sent.</p>}
   {['active','pending','needs_action'].includes(status.status)?<Button type="button" variant="outline" disabled={busy} onClick={()=>void change(false)}>Turn off future automatic payments</Button>:!status.payment_pending&&<details><summary className="min-h-10 cursor-pointer font-medium">Choose optional automatic payment</summary><div className="mt-2 space-y-3"><p className="leading-6 text-[var(--wh-text-secondary)]">Use an eligible reusable card from your verified rent payment. Setup makes no new charge. Only due payments in your saved later-year schedule may be charged, with the agreed fee and direct Partner settlement.</p><label className="flex items-start gap-3 leading-6"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-violet-600" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)}/>I authorize scheduled later-year rent charges to my saved eligible card. I can turn off future automatic payments; this does not cancel my tenancy or an in-flight payment.</label><Button type="button" disabled={busy||!accepted||Boolean(error)} onClick={()=>void change(true)}>Check card and enable automatic payment</Button></div></details>}
  </>}
 </section>;
}
function message(c:unknown){return c instanceof Error?c.message:(c as {message?:string})?.message||'Automatic payment could not be confirmed. Refresh before retrying.';}
