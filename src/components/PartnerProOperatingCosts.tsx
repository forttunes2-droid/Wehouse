import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/withTimeout';
import { requestKeyFor, releaseRequestKey } from '@/lib/safeAction';
import { OPERATING_COST_CATEGORIES, operatingCostAmount, operatingCostsCsv, parseOperatingReport, type OperatingCost, type OperatingReport } from '@/lib/partnerOperatingCosts';
type Asset = { kind: 'home' | 'hotel'; id: string; title: string };
const field='min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 py-2 text-sm text-[var(--wh-text)]';
const button='min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 py-2 text-sm font-semibold disabled:opacity-50';
const key=(asset: Asset)=>`${asset.kind}:${asset.id}`;
const money=(value: number)=>new Intl.NumberFormat(undefined,{style:'currency',currency:'NGN',maximumFractionDigits:2}).format(value);
const today=()=>{const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;};
const message=(error: unknown)=>(error as {message?:string})?.message || 'The cost action could not be confirmed. Refresh the report before trying again.';

export default function PartnerProOperatingCosts({ accountId, assets, selected }: {accountId:string;assets:Asset[];selected:string}) {
  const [month,setMonth]=useState(today().slice(0,7));
  const [report,setReport]=useState<OperatingReport|null>(null);
  const [error,setError]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [costAsset,setCostAsset]=useState('');
  const [category,setCategory]=useState('cleaning');
  const [title,setTitle]=useState('');
  const [amount,setAmount]=useState('');
  const [costDate,setCostDate]=useState(today);
  const [voiding,setVoiding]=useState<string|null>(null);
  const [reason,setReason]=useState('');
  const generation=useRef(0);const actionPending=useRef(false);
  const target=assets.find(asset=>key(asset)===selected);
  const targetKind=target?.kind || null; const targetId=target?.id || null;
  const load=useCallback(async(cursor?:{on:string;id:string})=>{
    const request=++generation.current;setLoading(true);
    try{
      const {data,error:failure}=await withTimeout(supabase.rpc('get_my_partner_operating_report',{p_month:`${month}-01`,p_kind:targetKind,p_asset_id:targetId,p_before_on:cursor?.on||null,p_before_id:cursor?.id||null}),15000,'The operating report took too long to load.');
      if(failure)throw failure;const value=parseOperatingReport(data);
      if(request!==generation.current)return;
      setError(false);setReport(previous=>cursor&&previous?{...value,costs:[...previous.costs,...value.costs.filter(row=>!previous.costs.some(old=>old.id===row.id))]}:value);
    }catch{if(request===generation.current){setError(true);setReport(null);}}
    finally{if(request===generation.current)setLoading(false);}
  },[accountId,month,targetKind,targetId]);
  useEffect(()=>{setReport(null);setVoiding(null);setReason('');void load();return()=>{++generation.current};},[load]);
  useEffect(()=>{setTitle('');setAmount('');setCostDate(today());setCostAsset('');},[accountId,targetKind,targetId]);
  const inputAsset=target||assets.find(asset=>key(asset)===costAsset);
  async function record(event: React.FormEvent){
    event.preventDefault();if(actionPending.current||!inputAsset)return;
    const value=operatingCostAmount(amount);if(value===null)return toast.error('Enter a positive NGN amount with at most two decimal places.');
    actionPending.current=true;setBusy(true);const current=generation.current;
    try{
      const payload={p_kind:inputAsset.kind,p_asset_id:inputAsset.id,p_category:category,p_title:title.trim(),p_amount_ngn:value,p_incurred_on:costDate};
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)))),n=>n.toString(16).padStart(2,'0')).join('');
      const signature=`partner-cost:${accountId}:${hash}`;
      const result=await withTimeout(supabase.rpc('record_my_partner_operating_cost',{...payload,p_request_key:requestKeyFor(signature)}),15000,'Cost confirmation timed out. Refresh the report before retrying the same details.');
      if(result.error)throw result.error;if(!result.data?.id || result.data.voided_at)throw new Error('The current cost record could not be confirmed.');
      releaseRequestKey(signature);
      if(current!==generation.current)return;
      setTitle('');setAmount('');toast.success('Operating cost recorded.');await load();
    }catch(failure){if(current===generation.current){toast.error(message(failure));await load();}}
    finally{actionPending.current=false;setBusy(false);}
  }
  async function voidCost(cost: OperatingCost){
    if(actionPending.current)return;actionPending.current=true;setBusy(true);const current=generation.current;
    try{
      const result=await withTimeout(supabase.rpc('void_my_partner_operating_cost',{p_cost_id:cost.id,p_reason:reason}),15000,'Void confirmation timed out. Refresh the report before retrying.');
      if(result.error)throw result.error;if(!result.data?.voided_at)throw new Error('Voiding was not confirmed.');
      if(current!==generation.current)return;
      setVoiding(null);setReason('');toast.success('Cost record voided. Its history is retained.');await load();
    }catch(failure){if(current===generation.current){toast.error(message(failure));await load();}}
    finally{actionPending.current=false;setBusy(false);}
  }
  function download(){
    if(!report)return;
    const text=operatingCostsCsv(report.costs,(kind,id)=>assets.find(asset=>asset.kind===kind&&asset.id===id)?.title||`${kind} ${id}`);
    const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`wehouse-operating-costs-${month}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section aria-label="Operating costs" className="space-y-5 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 sm:p-6">
    <header><h2 className="text-lg font-semibold">Operating costs and recorded margin</h2><p className="mt-2 text-sm leading-6 text-[var(--wh-text-secondary)]">Record cleaning, repairs, utilities and other property costs. These are your business records, not wallet payments or proof of payment. Recorded margin is released WeHouse income less the costs you enter; it excludes unrecorded costs, unreleased earnings, outside income and tax adjustments.</p></header>
    <div className="flex flex-wrap items-end gap-3"><label className="block text-sm">Reporting month<input type="month" max={today().slice(0,7)} min="2000-01" value={month} disabled={busy} onChange={event=>{if(event.target.value)setMonth(event.target.value)}} className={`${field} mt-2`}/></label><button type="button" disabled={busy||loading} className={button} onClick={()=>void load()}>Refresh report</button></div>
    <p className="text-xs leading-5 text-[var(--wh-text-secondary)]">Released income is grouped by UTC reporting month. Recorded costs use the cost date you entered. Amounts are NGN.</p>
    {loading&&!report?<p role="status" className="text-sm">Loading operating report…</p>:error?<p role="alert" className="text-sm text-red-700 dark:text-red-300">The report could not be loaded. Refresh to try again; no zero totals have been assumed.</p>:report&&<>
      <div className="grid gap-4 sm:grid-cols-3">{[['Released income',report.released_income_ngn],['Recorded costs',report.recorded_costs_ngn],['Recorded margin',report.recorded_margin_ngn]].map(([label,value])=><div key={String(label)}><p className="text-xs text-[var(--wh-text-secondary)]">{label}</p><p className="mt-1 break-words text-xl font-semibold">{typeof value==='number'?money(value):'Unavailable'}</p></div>)}</div>
      {report.mixed_currency&&<p role="alert" className="text-sm text-amber-700 dark:text-amber-300">This income includes another or unknown currency. Income and margin totals are unavailable; currencies have not been added together.</p>}
      {report.unattributed_earnings>0&&<p className="text-sm leading-6 text-[var(--wh-text-secondary)]">{report.unattributed_earnings} released earning record(s) lack a property link. They appear only in the portfolio total.</p>}
    </>}
    <form onSubmit={event=>void record(event)} className="grid gap-3 rounded-xl border border-[var(--wh-border-subtle)] p-4 sm:grid-cols-2"><h3 className="font-semibold sm:col-span-2">Record a cost</h3>
      {!target&&<label className="block text-sm">Property<select aria-label="Cost property" value={costAsset} disabled={busy} required onChange={event=>setCostAsset(event.target.value)} className={`${field} mt-2`}><option value="">Choose an owned property</option>{assets.map(asset=><option key={key(asset)} value={key(asset)}>{asset.title}</option>)}</select></label>}
      <label className="block text-sm">Cost category<select aria-label="Cost category" value={category} disabled={busy} onChange={event=>setCategory(event.target.value)} className={`${field} mt-2`}>{OPERATING_COST_CATEGORIES.map(value=><option key={value} value={value}>{value.charAt(0).toUpperCase()+value.slice(1)}</option>)}</select></label>
      <label className="block text-sm">Description<input value={title} minLength={3} maxLength={180} required disabled={busy} onChange={event=>setTitle(event.target.value)} className={`${field} mt-2`}/></label>
      <label className="block text-sm">Amount (NGN)<input value={amount} inputMode="decimal" required disabled={busy} onChange={event=>setAmount(event.target.value)} className={`${field} mt-2`}/></label>
      <label className="block text-sm">Cost date<input type="date" min="2000-01-01" max={today()} value={costDate} required disabled={busy} onChange={event=>setCostDate(event.target.value)} className={`${field} mt-2`}/></label>
      <button type="submit" className={`${button} bg-violet-600 text-white sm:col-span-2`} disabled={busy||!inputAsset||title.trim().length<3||operatingCostAmount(amount)===null}>Record operating cost</button>
    </form>
    {report&&!error&&<><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm">Showing {report.costs.length} of {report.cost_count} current cost records</p><button type="button" disabled={busy||loading||!report.costs.length} className={button} onClick={download}>Export shown costs</button></div>
      {!report.costs.length?<p className="text-sm text-[var(--wh-text-secondary)]">No costs recorded for this month and property selection.</p>:<div className="divide-y divide-[var(--wh-border-subtle)]">{report.costs.map(cost=><article key={cost.id} className="space-y-3 py-4"><div className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><h4 className="break-words text-sm font-semibold">{cost.title}</h4><p className="mt-1 break-words text-xs text-[var(--wh-text-secondary)]">{assets.find(asset=>asset.kind===cost.asset_kind&&asset.id===cost.asset_id)?.title||'Previously owned property'} · {cost.incurred_on} · {cost.category}</p></div><strong className="text-sm">{money(cost.amount_ngn)}</strong></div>
        {voiding===cost.id?<div className="space-y-2"><label className="block text-sm">Reason for voiding<input value={reason} maxLength={1000} disabled={busy} className={`${field} mt-2`} onChange={event=>setReason(event.target.value)}/></label><div className="flex gap-2"><button type="button" disabled={busy||reason.trim().length<5} className={button} onClick={()=>void voidCost(cost)}>Confirm void</button><button type="button" disabled={busy} className={button} onClick={()=>{setVoiding(null);setReason('')}}>Keep record</button></div></div>:<button type="button" disabled={busy} className={button} onClick={()=>{setVoiding(cost.id);setReason('')}}>Void record</button>}
      </article>)}</div>}
      {report.next_before_id&&report.next_before_on&&<button type="button" className={button} disabled={busy||loading} onClick={()=>void load({id:report.next_before_id!,on:report.next_before_on!})}>{loading?'Loading…':'Load more costs'}</button>}
    </>}
    {busy&&<p role="status" className="text-sm">Confirming cost record…</p>}
  </section>;
}
