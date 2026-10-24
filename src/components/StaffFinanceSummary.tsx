import { useEffect,useState } from 'react';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/withTimeout';
import { financeQueueSummary } from '@/lib/financeQueueSummary';
import WeHouseLoadingState from '@/components/WeHouseLoadingState';

export default function StaffFinanceSummary({open}:{open:(id:'payments'|'payouts'|'ledger')=>void}){
 const [counts,setCounts]=useState<ReturnType<typeof financeQueueSummary>|null>(null);
 const [error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  void (async()=>{
   try{
    const {data,error}=await withTimeout(supabase.rpc('get_my_staff_finance_queue'),15000,'Finance summary could not be loaded.');
    if(error)throw error;
    const next=financeQueueSummary(data);if(active)setCounts(next);
   }catch(reason){if(active){setCounts(null);setError((reason as {message?:string})?.message||'Finance summary could not be loaded.');}}
   finally{if(active)setLoading(false);}
  })();
  return()=>{active=false;};
 },[retry]);
 if(loading)return <WeHouseLoadingState label="Loading Finance summary"/>;
 if(error||!counts)return <section role="alert" className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 text-[var(--wh-text)]"><h2 className="text-base font-semibold">Finance summary unavailable</h2><p className="mt-2 text-sm text-[var(--wh-text-secondary)]">{error} No zero balance or empty queue has been confirmed.</p><button type="button" onClick={()=>setRetry(value=>value+1)} className="wh-motion-control mt-3 min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold">Retry Finance summary</button></section>;
 return <div className="space-y-5 text-[var(--wh-text)]"><section className="rounded-3xl border border-emerald-500/15 bg-[var(--wh-surface)] p-5 sm:p-6"><p className="text-xs font-bold tracking-[.12em] text-emerald-700 dark:text-emerald-300">FINANCE OPERATIONS</p><h2 className="mt-3 text-2xl font-bold">Money movement and review</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--wh-text-secondary)]">Review payments, withdrawals, refund processing and the ledger.</p><p className="mt-2 text-xs leading-5 text-[var(--wh-text-secondary)]">Counts cover loaded records within your access, up to 100 per record type. They are not balances or lifetime totals.</p></section><div className="grid gap-3 md:grid-cols-3"><Card title="Payments" value={counts.payments} onClick={()=>open('payments')}/><Card title="Payouts & refunds" value={counts.payouts} onClick={()=>open('payouts')}/><Card title="Ledger & Audit" value={counts.ledger} onClick={()=>open('ledger')}/></div></div>;
}
function Card({title,value,onClick}:{title:string;value:number;onClick:()=>void}){return <button type="button" onClick={onClick} className="wh-motion-control rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 text-left hover:border-emerald-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"><p className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</p><p className="mt-1 text-sm font-semibold">{title}</p><p className="mt-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300">Review records →</p></button>}
