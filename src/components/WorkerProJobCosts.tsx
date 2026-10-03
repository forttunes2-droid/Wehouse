import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
type Job = {id:string;booking_code:string|null;service_type:string|null;scheduled_date:string;status:string;released_earnings_ngn:number|null;cost_ngn:number|null;note:string};
const money=(value:number)=>'₦'+Number(value).toLocaleString('en-NG');
export default function WorkerProJobCosts() {
 const [rows,setRows]=useState<Job[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(false),[busy,setBusy]=useState<string|null>(null);
 const [drafts,setDrafts]=useState<Record<string,{amount:string;note:string}>>({});
 const load=useCallback(async()=>{
  setLoading(true);
  try { const r=await supabase.rpc('get_my_worker_pro_job_costs'); if(r.error||!Array.isArray(r.data)) throw new Error();
   setRows(r.data);setDrafts(Object.fromEntries(r.data.map((j:Job)=>[j.id,{amount:j.cost_ngn===null?'':String(j.cost_ngn),note:j.note}])));setError(false);
  } catch {setRows([]);setError(true);} finally {setLoading(false);}
 },[]);
 useEffect(()=>{void load();},[load]);
 async function save(row:Job) {
  if(busy) return;const d=drafts[row.id],amount=Number(d.amount);
  if(!d.amount.trim()||!Number.isFinite(amount)||amount<0||amount>10000000) return toast.error('Enter a cost from ₦0 to ₦10,000,000');
  setBusy(row.id);
  try {const r=await supabase.rpc('save_my_worker_pro_job_cost',{p_booking_id:row.id,p_amount:amount,p_note:d.note});if(r.error)throw r.error;await load();toast.success('Job cost saved');}
  catch {toast.error('Job cost could not be saved');} finally {setBusy(null);}
 }
 function exportCsv() {
  const cell=(value:unknown)=>'"'+String(value??'').replaceAll('"','""')+'"';
  const table=[['Job','Scheduled date','Status','Released earnings NGN','Recorded costs NGN','Net after recorded costs NGN'],
   ...rows.map(j=>[j.booking_code||j.id,j.scheduled_date,j.status,j.released_earnings_ngn,j.cost_ngn,j.released_earnings_ngn!==null&&j.cost_ngn!==null?Number(j.released_earnings_ngn)-Number(j.cost_ngn):null])];
  const url=URL.createObjectURL(new Blob(['\uFEFF'+table.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='wehouse-job-costs.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <section aria-label="Job costs and profit" className="space-y-3"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-base font-semibold">Job costs and profit</h3><button type="button" disabled={loading||error||!rows.length} onClick={exportCsv} className="min-h-11 rounded-xl border px-3 text-sm disabled:opacity-40">Export costs CSV</button></div>
 <p className="text-xs leading-5 text-[var(--wh-text-secondary)]">Record materials, transport and other job costs as a total. Net uses released Worker earnings minus costs you entered; it is not tax profit or proof of payout. Latest 150 jobs are shown. Blank cost means unrecorded, not zero.</p>
 {loading?<p role="status">Loading job costs…</p>:error?<p role="alert">Could not load job costs. <button onClick={()=>void load()} className="underline">Try again</button></p>:!rows.length?<p>No eligible jobs yet.</p>:rows.map(row=>{
 const d=drafts[row.id]||{amount:'',note:''};const net=row.released_earnings_ngn!==null&&row.cost_ngn!==null?Number(row.released_earnings_ngn)-Number(row.cost_ngn):null;
 return <form key={row.id} onSubmit={e=>{e.preventDefault();void save(row);}} className="rounded-2xl border border-[var(--wh-border-subtle)] p-4"><h4 className="text-sm font-semibold">{row.service_type||'Service job'} · #{row.booking_code||row.id.slice(0,8)}</h4>
 <p className="mt-1 text-xs">{row.released_earnings_ngn===null?'Earnings not released':`Released earnings ${money(row.released_earnings_ngn)}`}{net!==null?` · Net after recorded costs ${money(net)}`:''}</p>
 <label className="mt-3 block text-sm">Total job costs (₦)<input type="number" required min="0" max="10000000" step="0.01" value={d.amount} onChange={e=>setDrafts(v=>({...v,[row.id]:{...d,amount:e.target.value}}))} className="mt-1 min-h-11 w-full rounded-xl border bg-[var(--wh-surface)] px-3"/></label>
 <label className="mt-3 block text-sm">Cost details<textarea maxLength={600} value={d.note} onChange={e=>setDrafts(v=>({...v,[row.id]:{...d,note:e.target.value}}))} className="mt-1 w-full rounded-xl border bg-[var(--wh-surface)] p-3"/></label>
 <button disabled={busy!==null} type="submit" className="mt-3 min-h-11 rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-40">Save job cost</button></form>;
 })}</section>;
}
