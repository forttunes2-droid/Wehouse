import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase/client';
import {withTimeout} from '@/lib/withTimeout';
import {useCreatorAuth} from '@/hooks/useCreatorAuth';
import {Button} from '@/components/ui/button';
type Rates={short:number|null;long:number|null;hotel:number|null;service:number|null;shortExtra:number|null;longExtra:number|null};
type Receipt={etag:string;rates:Rates};
const round=(value:number)=>Math.round(value*100)/100;
function parse(value:unknown):Receipt{
 const r=value as {source_of_truth?:string;etag?:string;active?:Record<string,{version:number;value:{percent:number}}>};
 if(!r||r.source_of_truth!=='creator_policy_versions'||typeof r.etag!=='string'||!/^[a-f\d]{64}$/.test(r.etag)||!r.active||Array.isArray(r.active))throw Error('Commission rates could not be confirmed.');
 const percent=(key:string)=>{const p=r.active![key];if(p===undefined)return null;if(!p||!Number.isInteger(p.version)||p.version<1||typeof p.value?.percent!=='number'||!Number.isFinite(p.value.percent)||p.value.percent<0||p.value.percent>50||round(p.value.percent)!==p.value.percent)throw Error('A saved commission rate could not be confirmed.');return p.value.percent;};
 const short=percent('commission_short_let'),long=percent('commission_long_let'),shortManaged=percent('commission_short_let_wehouse_managed'),longManaged=percent('commission_long_let_wehouse_managed');
 return{etag:r.etag,rates:{short,long,hotel:percent('commission_hotel'),service:percent('commission_worker'),shortExtra:short===null||shortManaged===null||shortManaged<short?null:round(shortManaged-short),longExtra:long===null||longManaged===null||longManaged<long?null:round(longManaged-long)}};
}
export default function CreatorCommissionRules(){
 const {requestElevation}=useCreatorAuth();const [receipt,setReceipt]=useState<Receipt|null>(null),[draft,setDraft]=useState<Rates|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reason,setReason]=useState(''),[effective,setEffective]=useState(''),[attempt,setAttempt]=useState(0);
 const generation=useRef(0),lock=useRef(false);
 useEffect(()=>{const current=++generation.current;setLoading(true);setError('');setReceipt(null);setDraft(null);
  void withTimeout(supabase.rpc('creator_get_booking_money_rules_v4'),15000,'Commission rates took too long to load.').then(({data,error})=>{if(error)throw error;const r=parse(data);if(current===generation.current){setReceipt(r);setDraft(r.rates);}})
   .catch(cause=>{if(current===generation.current)setError(message(cause));}).finally(()=>{if(current===generation.current)setLoading(false);});return()=>{generation.current++;};
 },[attempt]);
 const dirty=Boolean(draft&&receipt&&JSON.stringify(draft)!==JSON.stringify(receipt.rates));
 const valid=Boolean(draft&&Object.values(draft).every(n=>n!==null&&Number.isFinite(n)&&n>=0&&n<=50&&round(n)===n)&&round(Number(draft.short)+Number(draft.shortExtra))<=50&&round(Number(draft.long)+Number(draft.longExtra))<=50);
 function publish(){if(!draft||!receipt||!dirty||!valid||reason.trim().length<5||lock.current)return;const current=generation.current;
  requestElevation('policy_publish',id=>{void(async()=>{if(current!==generation.current||lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
   try{const {data,error}=await withTimeout(supabase.rpc('creator_publish_booking_money_rules_v4',{
    p_creator_elevation_id:id,p_expected_digest:receipt.etag,p_effective_from:effective?new Date(effective).toISOString():new Date().toISOString(),p_reason:reason.trim(),
    p_rules:{commissions:{short_let_percent:draft.short,long_let_percent:draft.long,hotel_percent:draft.hotel,service_worker_percent:draft.service,short_let_wehouse_percent:round(Number(draft.short)+Number(draft.shortExtra)),long_let_wehouse_percent:round(Number(draft.long)+Number(draft.longExtra))}},
   }),20000,'Publication result is unknown. Refresh the saved commission rates before retrying.');if(error)throw error;
   if(!data||!Number.isInteger(data.changed_policy_count)||data.changed_policy_count<0||!data.published||typeof data.published!=='object'||Array.isArray(data.published))throw Error('Commission publication receipt could not be confirmed. Refresh before retrying.');
   if(current===generation.current){setNotice(effective?'Commission changes scheduled. Accepted bookings retain their saved rates.':'Commission changes recorded. Partners must accept updated property rates before new bookings.');setReason('');setEffective('');setAttempt(n=>n+1);}
   }catch(cause){if(current===generation.current)setError(message(cause));}finally{lock.current=false;if(current===generation.current)setBusy(false);}})();});
 }
 function field(label:string,key:keyof Rates,max=50){return <label className="block space-y-2 text-sm"><span>{label}</span><input type="number" min={0} max={max} step="0.01" required disabled={busy} value={draft?.[key]??''} onChange={event=>{const next=event.target.value===''?null:Number(event.target.value);setDraft(old=>old?{...old,[key]:next}:old);}} className="min-h-11 w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] px-3"/>{draft?.[key]===null&&<span className="block text-xs text-[var(--wh-text-secondary)]">Not configured. Choose the actual rate.</span>}</label>;}
 return <section aria-label="Platform commissions" className="space-y-5 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4 sm:p-5"><header className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Platform commissions</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--wh-text-secondary)]">Commission is deducted from eligible Provider earnings. Refundable deposits are excluded. Home management additions are included in the managed total.</p></div><Button type="button" variant="outline" disabled={loading||busy} onClick={()=>setAttempt(n=>n+1)}>Refresh commissions</Button></header>
 {loading&&<p role="status">Loading actual commission rates...</p>}{error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}{notice&&<p role="status" className="text-sm text-[var(--wh-accent-text)]">{notice}</p>}
 {draft&&<form className="space-y-5" onSubmit={event=>{event.preventDefault();publish();}}><fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
  <section className="space-y-3 rounded-xl border border-[var(--wh-border)] p-4"><h3 className="font-semibold">Short Let</h3>{field('Short Let base commission (%)','short')}{field('Short Let additional management (%)','shortExtra',50-Number(draft.short))}<p className="text-sm text-[var(--wh-text-secondary)]">{draft.short!==null&&draft.shortExtra!==null?`WeHouse-managed total: ${round(draft.short+draft.shortExtra)}%`:'Managed total is not configured.'}</p></section>
  <section className="space-y-3 rounded-xl border border-[var(--wh-border)] p-4"><h3 className="font-semibold">Long Let</h3>{field('Long Let base commission (%)','long')}{field('Long Let additional management (%)','longExtra',50-Number(draft.long))}<p className="text-sm text-[var(--wh-text-secondary)]">{draft.long!==null&&draft.longExtra!==null?`WeHouse-managed total: ${round(draft.long+draft.longExtra)}%`:'Managed total is not configured.'}</p></section>
  <section className="space-y-3 rounded-xl border border-[var(--wh-border)] p-4"><h3 className="font-semibold">Hotels</h3>{field('Hotel commission (%)','hotel')}</section><section className="space-y-3 rounded-xl border border-[var(--wh-border)] p-4"><h3 className="font-semibold">Requested services</h3>{field('Service commission (%)','service')}</section>
 </fieldset><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-2 text-sm"><span>Commission effective time (optional)</span><input type="datetime-local" disabled={busy} value={effective} onChange={event=>setEffective(event.target.value)} className="min-h-11 w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] px-3"/></label><label className="space-y-2 text-sm"><span>Commission change reason</span><input required minLength={5} maxLength={2000} disabled={busy} value={reason} onChange={event=>setReason(event.target.value)} className="min-h-11 w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] px-3"/></label></div><Button type="submit" disabled={busy||!valid||!dirty||reason.trim().length<5}>{busy?'Confirming...':effective?'Confirm and schedule commissions':'Confirm and publish commissions'}</Button></form>}
 </section>;
}
function message(cause:unknown){return cause instanceof Error?cause.message:(cause as {message?:string})?.message||'Commission rates could not be confirmed. Refresh before continuing.';}
