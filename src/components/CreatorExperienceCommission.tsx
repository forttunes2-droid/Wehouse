import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {withTimeout} from '@/lib/withTimeout';
import {useCreatorAuth} from '@/hooks/useCreatorAuth';

type Receipt={configured:boolean;policy:null|{policy_key:string;version:number;value:{percent:number}}};
export function experienceCommissionReceipt(value:unknown):Receipt {
 const row=value as Receipt;
 if(!row||typeof row.configured!=='boolean')throw Error('Activity commission could not be confirmed.');
 if(!row.configured){if(row.policy!==null)throw Error('Invalid commission receipt.');return row;}
 const p=row.policy;
 if(!p||p.policy_key!=='commission_experience'||!Number.isSafeInteger(p.version)||p.version<1||typeof p.value?.percent!=='number'||!Number.isFinite(p.value.percent)||p.value.percent<0||p.value.percent>50)throw Error('Invalid commission receipt.');
 return row;
}
export default function CreatorExperienceCommission(){
 const {requestElevation}=useCreatorAuth();
 const [receipt,setReceipt]=useState<Receipt|null>(null),[percent,setPercent]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const locked=useRef(false),generation=useRef(0);
 async function load(){const request=++generation.current;setBusy(true);setError('');setReceipt(null);try{
  const result=await withTimeout(supabase.rpc('creator_get_experience_commission'),15000,'Commission lookup timed out. Retry to confirm its status.');
  if(result.error)throw result.error;const saved=experienceCommissionReceipt(result.data);
  if(request!==generation.current)return;setReceipt(saved);setPercent(saved.policy?String(saved.policy.value.percent):'');
 }catch(e){if(request===generation.current)setError(message(e));}finally{if(request===generation.current)setBusy(false);}}
 useEffect(()=>{void load();return()=>{generation.current++;};},[]);
 async function publish(elevation:string){if(locked.current||!receipt)return;locked.current=true;setBusy(true);setError('');setNotice('');const request=generation.current;
  try{const expected=receipt.policy?.version||0,value=Number(percent);
   if(!percent.trim()||!Number.isFinite(value)||value<0||value>50||Math.abs(value*100-Math.round(value*100))>0.000001||reason.trim().length<5)throw Error('Enter a percentage from 0 to 50 with at most two decimal places and a reason.');
   const result=await withTimeout(supabase.rpc('creator_publish_experience_commission',{p_creator_elevation_id:elevation,p_expected_version:expected,p_percent:value,p_reason:reason.trim()}),20000,'Publication outcome is unknown. Refresh the saved policy before retrying.');
   if(result.error)throw result.error;const saved=experienceCommissionReceipt(result.data);
   if(!saved.policy||saved.policy.version!==expected+1||saved.policy.value.percent!==value)throw Error('Publication could not be confirmed. Refresh before retrying.');
   if(request!==generation.current)return;setReceipt(saved);setReason('');setNotice('Activity commission published for new bookings. Existing booking terms are unchanged.');
  }catch(e){if(request===generation.current){setError(message(e));setReceipt(null);}}
  finally{locked.current=false;if(request===generation.current)setBusy(false);}
 }
 const input='mt-2 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 py-2 text-base';
 return <section aria-label="Activity commission" className="space-y-3 rounded-2xl border border-[var(--wh-border-subtle)] p-4">
  <h4 className="font-semibold">Activity commission</h4><p className="text-sm text-[var(--wh-text-secondary)]">Set WeHouse's percentage for new Activity bookings. Publishing a rate does not enable Activity sales.</p>
  {error&&<p role="alert" className="text-sm text-[var(--wh-danger-text)]">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
  {receipt?<><p className="text-sm">{receipt.policy?`Published: ${receipt.policy.value.percent}% - Version ${receipt.policy.version}`:'Not configured. No commission rate has been assumed.'}</p>
  <label className="block text-sm">WeHouse commission (%)<input type="number" min="0" max="50" step="0.01" disabled={busy} value={percent} onChange={e=>setPercent(e.target.value)} className={input}/></label>
  <label className="block text-sm">Reason for change<textarea maxLength={2000} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)} className={input}/></label>
  <button type="button" disabled={busy||!percent.trim()||reason.trim().length<5} onClick={()=>requestElevation('policy_publish',id=>{void publish(id);})} className="min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy?'Publishing...':'Confirm and publish commission'}</button></>:<button type="button" disabled={busy} onClick={()=>void load()} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm">{busy?'Loading commission...':'Refresh commission'}</button>}
 </section>;
}
function message(error:unknown){return error instanceof Error?error.message:(error as {message?:string})?.message||'Commission could not be confirmed. Refresh before retrying.';}
