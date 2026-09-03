import { useEffect,useMemo,useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { BOOKING_STATUS_LABELS } from '@/lib/supabase/worker-bookings';
import InlineFilterChips from '@/components/InlineFilterChips';
import { canonicalStatusOptions } from '@/lib/status';

type BookingRow={
 booking_code:string;
 service_type:string|null;
 status:string;
 negotiated_amount:number|null;
 scheduled_date:string|null;
 created_at:string;
 updated_at:string;
 worker_name:string;
 customer_name:string;
 needs_attention:boolean;
 has_dispute:boolean;
 payment_review_required:boolean;
};

type Props={title?:string;note?:string};
export default function ServiceBookingOversight({title='Worker service bookings',note='Oversight only. Each job keeps its own lifecycle and status.'}:Props){
 const[rows,setRows]=useState<BookingRow[]>([]),[loading,setLoading]=useState(true),[search,setSearch]=useState(''),[statusFilter,setStatusFilter]=useState('all');
 async function load(){setLoading(true);const{data,error}=await supabase.rpc('admin_get_my_branch_worker_booking_summaries');if(error){toast.error(error.message||'Unable to load service bookings');setRows([])}else setRows((Array.isArray(data)?data:[]) as BookingRow[]);setLoading(false)}
 useEffect(()=>{void load()},[]);
 const statusOptions=useMemo(()=>canonicalStatusOptions(rows.map(row=>row.status)),[rows]);
 useEffect(()=>{if(!statusOptions.some(option=>option.value===statusFilter))setStatusFilter('all')},[statusFilter,statusOptions]);
 const shown=useMemo(()=>{const q=search.trim().toLowerCase();return rows.filter(row=>{if(statusFilter!=='all'&&row.status!==statusFilter)return false;if(!q)return true;return[row.booking_code,row.service_type,row.worker_name,row.customer_name,row.status].filter(Boolean).join(' ').toLowerCase().includes(q)})},[rows,search,statusFilter]);
 return <div className="space-y-4">
  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-bold">{title}</h2><p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[#707687]">{note}</p></div><button onClick={()=>void load()} className="h-10 w-fit rounded-xl border border-white/[.07] bg-white/[.025] px-4 text-[9px] font-semibold text-[#A4A9B6]">Refresh</button></div>
  <InlineFilterChips value={statusFilter} options={statusOptions} onChange={setStatusFilter} ariaLabel="Show service bookings by lifecycle"/>
  <div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#606677]">⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search booking, service, Worker or customer" className="h-11 w-full rounded-2xl border border-white/[.07] bg-[#12161E] pl-9 pr-3 text-xs outline-none focus:border-violet-500/35"/></div>
  {loading?<Loading/>:shown.length===0?<Empty hasAny={rows.length>0}/>:<div className="space-y-2.5">{shown.map(row=><BookingCard key={`${row.booking_code}-${row.updated_at}`} row={row}/>)}</div>}
 </div>
}

function BookingCard({row}:{row:BookingRow}){const status=BOOKING_STATUS_LABELS[row.status],amount=Number(row.negotiated_amount||0);return <article className={`rounded-2xl border bg-[#10131B] p-4 ${row.has_dispute?'border-red-500/20':row.payment_review_required?'border-amber-500/25':row.needs_attention?'border-amber-500/15':'border-white/[.06]'}`}><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{row.service_type||'Worker service'}</p><span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${status?.color||'bg-white/[.05] text-[#A2A7B5]'}`}>{status?.label||String(row.status||'recorded').replace(/_/g,' ')}</span></div><p className="mt-1.5 truncate text-[10px] text-[#687081]">#{row.booking_code} · {row.customer_name} ↔ {row.worker_name}</p></div>{amount>0&&<p className="shrink-0 text-sm font-bold text-[#E6E8ED]">₦{amount.toLocaleString('en-NG')}</p>}</div><div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[.05] pt-3"><div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-[#5E6575]">{row.scheduled_date&&<span>Scheduled {new Date(row.scheduled_date).toLocaleDateString()}</span>}<span>Updated {formatWhen(row.updated_at)}</span></div>{row.payment_review_required?<span className="rounded-full bg-amber-500/[.1] px-2.5 py-1 text-[8px] font-semibold text-amber-300">Payment review required</span>:row.has_dispute?<span className="rounded-full bg-red-500/[.08] px-2.5 py-1 text-[8px] font-semibold text-red-300">Financial review required</span>:row.needs_attention?<span className="rounded-full bg-amber-500/[.08] px-2.5 py-1 text-[8px] font-semibold text-amber-300">Next action required</span>:null}</div>{row.payment_review_required?<p className="mt-2 text-[9px] leading-relaxed text-[#777D8D]">Paystack verified a charge, but this booking could not be finalized automatically. Keep the job frozen for WeHouse review; no second payment, refund or payout action is exposed here.</p>:row.has_dispute?<p className="mt-2 text-[9px] leading-relaxed text-[#777D8D]">The job is frozen for review. No refund or payout action is exposed here until the financial resolution path is verified.</p>:null}</article>}
function formatWhen(value:string){const d=new Date(value),now=new Date(),diff=Math.max(0,now.getTime()-d.getTime());if(diff<60000)return'just now';if(diff<3600000)return`${Math.floor(diff/60000)}m ago`;if(diff<86400000)return`${Math.floor(diff/3600000)}h ago`;return d.toLocaleDateString()}
function Loading(){return <div className="grid min-h-48 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>}
function Empty({hasAny}:{hasAny:boolean}){return <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-12 text-center text-[10px] text-[#666C7D]">{hasAny?'No service bookings match this status.':'No Worker service bookings yet.'}</div>}
