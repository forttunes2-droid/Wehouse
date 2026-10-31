import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import SearchableSelect from '@/components/SearchableSelect';
import {supabase} from '@/lib/supabase';
import {withTimeout} from '@/lib/withTimeout';
import {useCreatorAuth} from '@/hooks/useCreatorAuth';
import {formatRecordedMoney} from '@/lib/regional';

type Pricing={original_price_per_participant_minor:number;total_minor:number;host_discount_minor:number;wehouse_discount_minor:number;commission_base_minor:number;commission_gross_minor:number;commission_minor:number;host_receives_minor:number};
type Receipt={revision:number;percent:number;ends_on:string|null;base_price_minor?:number;currency?:string;commission_percent?:number|null;pricing?:Pricing|null};
type Scope={kind:'activity'|'state';target:string};
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
async function rpc(name:string,args:Record<string,unknown>={}){const {data,error}=await withTimeout(supabase.rpc(name,args),15000,'Discount result could not be confirmed. Refresh before retrying.');if(error)throw error;return data;}
function receipt(value:unknown,identity:{session?:string;scope?:Scope}):Receipt{
 const r=value as Receipt&{version?:number;session_id?:string;kind?:string;target?:string};
 const revision=identity.scope?r?.version:r?.revision;
 if(!r||!Number.isSafeInteger(revision)||Number(revision)<0||typeof r.percent!=='number'||!Number.isFinite(r.percent)||(r.percent!==0&&(r.percent<(identity.scope?0.01:5)||r.percent>50))||r.ends_on!==null&&(typeof r.ends_on!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.ends_on))||identity.session&&(r.session_id!==identity.session||!Number.isSafeInteger(r.base_price_minor)||Number(r.base_price_minor)<=0||!/^[A-Z]{3}$/.test(r.currency||''))||identity.scope&&(r.kind!==identity.scope.kind||r.target!==identity.scope.target||r.commission_percent!==null&&(typeof r.commission_percent!=='number'||!Number.isFinite(r.commission_percent)||r.commission_percent<0||r.commission_percent>50)))throw Error('Discount receipt could not be confirmed.');
 if(r.pricing){const p=r.pricing,values=[p.original_price_per_participant_minor,p.total_minor,p.host_discount_minor,p.wehouse_discount_minor,p.commission_base_minor,p.commission_gross_minor,p.commission_minor,p.host_receives_minor];if(!identity.session||values.some(n=>!Number.isSafeInteger(n)||n<0)||p.original_price_per_participant_minor!==r.base_price_minor||p.original_price_per_participant_minor-p.host_discount_minor!==p.commission_base_minor||p.commission_base_minor-p.wehouse_discount_minor!==p.total_minor||p.commission_gross_minor-p.wehouse_discount_minor!==p.commission_minor||p.total_minor-p.commission_minor!==p.host_receives_minor)throw Error('Host price preview could not be confirmed.');}
 return {...r,revision:Number(revision)};
}
type EditorProps={load:()=>Promise<Receipt>;save:(r:Receipt,percent:number,ends:string|null,reason:string,elevation?:string)=>Promise<Receipt>;funded?:boolean;confirm?:(action:(elevation?:string)=>void)=>void;onDirtyChange?:(dirty:boolean)=>void};
function DiscountEditor({load,save,funded=false,confirm,onDirtyChange}:EditorProps){
 const [row,setRow]=useState<Receipt|null>(null),[percent,setPercent]=useState(''),[ends,setEnds]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0),[baseline,setBaseline]=useState('');
 const generation=useRef(0),lock=useRef(false);
 const dirty=Boolean(baseline&&JSON.stringify([percent,ends,reason])!==baseline);
 useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
 useEffect(()=>{const current=++generation.current;setBusy(true);setError('');setRow(null);void load().then(r=>{if(current===generation.current){setRow(r);setPercent(String(r.percent));setEnds(r.ends_on||'');setReason('');setBaseline(JSON.stringify([String(r.percent),r.ends_on||'','']));}}).catch(e=>{if(current===generation.current)setError(message(e));}).finally(()=>{if(current===generation.current)setBusy(false);});return()=>{generation.current++;};},[load,attempt]);
 function requestSave(){if(lock.current||!row)return;const value=Number(percent),current=generation.current;
  if(!percent.trim()||!Number.isFinite(value)||value!==Math.round(value*100)/100||value!==0&&(value<(funded?0.01:5)||value>ceiling)||funded&&reason.trim().length<5){setError(`Choose 0 to remove or ${funded?'0.01':'5'}–${ceiling}%${funded?' and a reason':''}.`);return;}
  const action=(elevation?:string)=>{if(current!==generation.current||lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');void save(row,value,ends||null,reason.trim(),elevation).then(r=>{
   if(r.revision!==row.revision+1||r.percent!==value||r.ends_on!==(ends||null))throw Error('Saved discount could not be confirmed. Refresh before retrying.');
   if(current===generation.current){setRow(r);setReason('');setBaseline(JSON.stringify([percent,ends,'']));setNotice(value===0?'Discount removed for new bookings.':'Discount saved for new bookings.');}
  }).catch(e=>{if(current===generation.current){setError(message(e));setRow(null);}}).finally(()=>{lock.current=false;if(current===generation.current)setBusy(false);});};
  if(confirm)confirm(action);else action();
 }
 const ceiling=funded?Number(row?.commission_percent||0):50,field='mt-1 min-h-11 w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] px-3 py-2 text-base';
 return <div className="space-y-3">
  {error&&<p role="alert" className="text-sm text-[var(--wh-danger-text)]">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
  {row&&<><p className="text-sm text-[var(--wh-text-secondary)]">Saved offer: {row.percent===0?'No discount':`${row.percent}%`}{row.ends_on?` · Sessions through ${row.ends_on}`:''}. {funded?`Funding ceiling: ${ceiling}% commission.`:'This discount reduces the session price before WeHouse commission.'}</p>
   {row.base_price_minor&&<p className="text-sm">Standard price: {formatRecordedMoney(row.base_price_minor/100,row.currency!)}</p>}
   {!funded&&row.pricing&&<section aria-label="Current host price preview" className="space-y-2 rounded-xl bg-[var(--wh-elevated)] p-4 text-sm"><h5 className="font-medium">Current price per participant</h5><dl className="space-y-2">{[['Customer pays',row.pricing.total_minor],['Your discount',row.pricing.host_discount_minor],['WeHouse-funded discount',row.pricing.wehouse_discount_minor],['WeHouse commission after funding',row.pricing.commission_minor],['Your net earnings',row.pricing.host_receives_minor]].map(([label,amount])=><div key={label} className="flex flex-wrap justify-between gap-2"><dt className="text-[var(--wh-text-secondary)]">{label}</dt><dd className="font-medium">{formatRecordedMoney(Number(amount)/100,row.currency!)}</dd></div>)}</dl><p className="text-xs leading-5 text-[var(--wh-text-secondary)]">WeHouse funds its offer from its commission, preserving your earnings. Refresh to check current offers. Bookings retain their accepted price and earnings.</p></section>}
   {!funded&&row.pricing===null&&<p className="text-sm text-[var(--wh-text-secondary)]">The price and earnings preview becomes available when WeHouse’s Activity commission is configured.</p>}
   <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Discount (%)<input inputMode="decimal" type="number" min={0} max={ceiling} step="0.01" value={percent} onChange={e=>setPercent(e.target.value)} className={field}/></label><label className="block text-sm">Last session date (optional)<input type="date" value={ends} onChange={e=>setEnds(e.target.value)} className={field}/></label>{funded&&<label className="block text-sm sm:col-span-2">Reason for offer<textarea maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} className={field}/></label>}</fieldset>
   <p className="text-xs leading-5 text-[var(--wh-text-secondary)]">Use 0 to remove this offer. Session dates use the activity’s timezone. Existing bookings keep their accepted price. Combined offers cannot exceed 50%.</p>
   <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy||!dirty||funded&&Number(percent)>0&&ceiling<0.01} onClick={requestSave}>{busy?'Saving...':funded?'Confirm funded discount':'Save discount'}</Button>{dirty&&<Button type="button" variant="outline" disabled={busy} onClick={()=>{setPercent(String(row.percent));setEnds(row.ends_on||'');setReason('');}}>Discard discount edits</Button>}</div>
  </>}
  <Button type="button" variant="outline" disabled={busy||dirty&&row!==null} onClick={()=>setAttempt(n=>n+1)}>{busy?'Loading discount...':'Refresh discount'}</Button>
 </div>;
}

export default function ExperienceSessionDiscount({sessionId,onDirtyChange}:{sessionId:string;onDirtyChange:(dirty:boolean)=>void}){
 const load=useCallback(async()=>receipt(await rpc('get_my_experience_session_discount',{p_session_id:sessionId}),{session:sessionId}),[sessionId]);
 const save=useCallback(async(r:Receipt,percent:number,ends:string|null)=>receipt(await rpc('set_my_experience_session_discount',{p_session_id:sessionId,p_expected_revision:r.revision,p_percent:percent,p_ends_on:ends}),{session:sessionId}),[sessionId]);
 return <section aria-label="Session discount" className="space-y-3 rounded-xl border border-[var(--wh-border)] p-4"><h4 className="font-semibold">Session discount (optional)</h4><DiscountEditor load={load} save={save} onDirtyChange={onDirtyChange}/></section>;
}
function FundedEditor({scope,onDirtyChange}:{scope:Scope;onDirtyChange:(dirty:boolean)=>void}){
 const {requestElevation}=useCreatorAuth();
 const load=useCallback(async()=>receipt(await rpc('creator_get_experience_discount',{p_kind:scope.kind,p_target:scope.target}),{scope}),[scope.kind,scope.target]);
 const save=useCallback(async(r:Receipt,percent:number,ends:string|null,reason:string,elevation?:string)=>receipt(await rpc('creator_set_experience_discount',{p_kind:scope.kind,p_target:scope.target,p_expected_version:r.revision,p_percent:percent,p_ends_on:ends,p_creator_elevation_id:elevation,p_reason:reason}),{scope}),[scope.kind,scope.target]);
 return <DiscountEditor load={load} save={save} funded onDirtyChange={onDirtyChange} confirm={action=>requestElevation('policy_publish',action)}/>;
}
export function CreatorExperienceDiscounts(){
 const [activities,setActivities]=useState<{id:string;title:string;state:string}[]>([]),[states,setStates]=useState<string[]>([]),[kind,setKind]=useState<Scope['kind']>('activity'),[target,setTarget]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[more,setMore]=useState(false),[attempt,setAttempt]=useState(0);
 const [dirty,setDirty]=useState(false);
 const generation=useRef(0),cursor=useRef<string|null>(null),lock=useRef(false),sequence=useRef(0);
 async function load(append=false){if(lock.current&&append)return;lock.current=true;setBusy(true);setError('');const current=generation.current,request=++sequence.current;try{
  const r=await rpc('creator_experience_discount_targets',{p_before:append?cursor.current:null});
  if(!r||!Array.isArray(r.activities)||r.activities.length>51||r.activities.some((a:{id:unknown;title:unknown;state:unknown})=>!uuid(a.id)||typeof a.title!=='string'||typeof a.state!=='string')||!Array.isArray(r.states)||r.states.length>100||r.states.some((s:unknown)=>typeof s!=='string'))throw Error('Discount targets could not be confirmed.');
  if(current!==generation.current||request!==sequence.current)return;const rows=r.activities.slice(0,50);setActivities(old=>append?[...new Map([...old,...rows].map(a=>[a.id,a])).values()]:rows);setStates(r.states);setMore(r.activities.length===51);cursor.current=rows.at(-1)?.id||null;
 }catch(e){if(current===generation.current&&request===sequence.current)setError(message(e));}finally{if(current===generation.current&&request===sequence.current){lock.current=false;setBusy(false);}}}
 useEffect(()=>{generation.current++;void load();return()=>{generation.current++;};},[attempt]);
 return <section aria-label="WeHouse-funded activity discounts" className="space-y-4 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4"><h3 className="font-semibold">WeHouse-funded activity discounts</h3><p className="text-sm leading-6 text-[var(--wh-text-secondary)]">Fund an activity or state offer from WeHouse’s Activity commission. Host earnings are unchanged. An activity offer takes priority over its state offer; they do not stack. Setting an activity to 0 also excludes it from the state offer.</p>
  {error&&<div role="alert" className="text-sm"><p>{error}</p><Button type="button" variant="outline" disabled={busy} onClick={()=>setAttempt(n=>n+1)}>Retry activity offers</Button></div>}
  <label className="block text-sm">Offer covers<select disabled={dirty} value={kind} onChange={e=>{setKind(e.target.value as Scope['kind']);setTarget('');}} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] px-3"><option value="activity">One activity</option><option value="state">A state in Nigeria</option></select></label>
  <SearchableSelect label={kind==='activity'?'Activity':'State'} value={target} onChange={setTarget} options={kind==='activity'?activities.map(a=>({value:a.id,label:a.title,meta:a.state})):states.map(s=>({value:s,label:s}))} disabled={busy||dirty} placeholder={busy?'Loading activities...':'Choose an offer scope'}/>
  {more&&kind==='activity'&&<Button type="button" variant="outline" disabled={busy} onClick={()=>void load(true)}>Load more activities</Button>}
  {!busy&&!error&&activities.length===0&&<p className="text-sm text-[var(--wh-text-secondary)]">No Nigerian activities to promote yet.</p>}
  {target&&<FundedEditor key={`${kind}:${target}`} scope={{kind,target}} onDirtyChange={setDirty}/>}
 </section>;
}
function message(e:unknown){return e instanceof Error?e.message:(e as {message?:string})?.message||'Discount could not be confirmed. Refresh before retrying.';}
