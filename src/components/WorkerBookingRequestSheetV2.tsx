import { useEffect,useMemo,useState } from 'react';
import { toast } from 'sonner';
import SearchableSelect from '@/components/SearchableSelect';
import { createBookingRequest } from '@/lib/supabase/worker-bookings';
import { supabase } from '@/lib/supabase';
import { WORKER_OCCUPATION_LABELS } from '@/types';
import type { Profile } from '@/types';

type Props={worker:Profile;profile:Profile;onClose:()=>void;onCreated:(conversationId:string,bookingId:string)=>void};

export default function WorkerBookingRequestSheetV2({worker,profile,onClose,onCreated}:Props){
 const[description,setDescription]=useState(''),[address,setAddress]=useState(''),[date,setDate]=useState(''),[message,setMessage]=useState(''),[submitting,setSubmitting]=useState(false),[services,setServices]=useState<string[]>([]),[service,setService]=useState(''),[servicesLoading,setServicesLoading]=useState(true),[serviceLoadFailed,setServiceLoadFailed]=useState(false);
 const min=useMemo(()=>{const now=new Date();const local=new Date(now.getTime()-now.getTimezoneOffset()*60000);return local.toISOString().slice(0,10)},[]);
 const serviceOptions=useMemo(()=>services.map(item=>({value:item,label:item})),[services]);

 useEffect(()=>{let cancelled=false;void (async()=>{
  setServicesLoading(true);setServiceLoadFailed(false);setServices([]);setService('');
  const{data,error}=await supabase.from('worker_services').select('service_name').eq('worker_id',worker.user_id).order('service_name');
  if(cancelled)return;
  const skills=Array.isArray(worker.worker_skills)?worker.worker_skills.filter((item):item is string=>typeof item==='string'&&Boolean(item.trim())):[];
  if(error&&skills.length===0){setServiceLoadFailed(true);setServicesLoading(false);return}
  const specific=[...(data||[]).map((row:any)=>String(row.service_name||'').trim()),...skills.map(item=>item.trim())].filter(Boolean);
  const seen=new Set<string>();
  const unique=specific.filter(item=>{const key=item.toLowerCase();if(seen.has(key))return false;seen.add(key);return true});
  const fallback=WORKER_OCCUPATION_LABELS[worker.worker_occupation||'']||worker.worker_occupation||'';
  const next=unique.length?unique:(fallback?[fallback]:[]);
  setServices(next);setService(next[0]||'');setServicesLoading(false);
 })();return()=>{cancelled=true}},[worker.user_id,worker.worker_occupation,worker.worker_skills]);

 async function submit(){
  if(servicesLoading)return toast.error('Worker services are still loading');
  if(serviceLoadFailed)return toast.error('Worker services could not be loaded. Try again.');
  if(!service)return toast.error('Choose a service');
  if(!description.trim()||!address.trim()||!date)return toast.error('Service, description, address and preferred date are required');
  if(date<min)return toast.error('Choose today or a future date');
  setSubmitting(true);
  const{booking,error}=await createBookingRequest(worker.user_id,service,description.trim(),address.trim(),date,message.trim());
  setSubmitting(false);
  if(error||!booking)return toast.error(error?.message||'Booking request failed');
  toast.success('Booking request sent');
  onCreated(booking.conversation_id,booking.booking_id);
 }

 return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}><section onClick={e=>e.stopPropagation()} className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] border border-white/[.08] bg-[#11141C] p-5 sm:rounded-[28px]"><div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">NEW SERVICE REQUEST</p><h2 className="mt-1 text-lg font-bold">{worker.full_name||worker.username||'Professional'}</h2><p className="mt-1 text-[10px] leading-relaxed text-[#6D7282]">Choose the exact service you need. You and the professional can agree the final date and price before payment.</p></div><button onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[.04] text-[#777C8B]">×</button></div><div className="mt-5 space-y-3">{servicesLoading?<FieldMessage>Loading services…</FieldMessage>:serviceLoadFailed?<FieldMessage error>Could not load this Worker’s services. Close and try again.</FieldMessage>:services.length===0?<FieldMessage>No bookable service is available.</FieldMessage>:<SearchableSelect label="Service" value={service} onChange={setService} options={serviceOptions} placeholder="Choose service" searchPlaceholder="Search this Worker’s services…" emptyText="No matching service"/>}<Input value={description} set={setDescription} placeholder="Describe the work needed"/><Input value={address} set={setAddress} placeholder="Service address"/><label className="block rounded-2xl border border-white/[.08] bg-[#181B24] px-4 py-3"><span className="mb-1.5 block text-[9px] font-semibold uppercase tracking-wide text-[#6D7282]">Preferred date</span><input type="date" min={min} value={date} onChange={e=>setDate(e.target.value)} className="w-full bg-transparent text-sm text-white outline-none [color-scheme:dark]"/></label><textarea value={message} onChange={e=>setMessage(e.target.value)} rows={3} placeholder="Anything else the professional should know? (optional)" className="w-full resize-none rounded-2xl border border-white/[.08] bg-[#181B24] px-4 py-3 text-sm outline-none focus:border-violet-500/40"/><button onClick={()=>void submit()} disabled={submitting||!profile.user_id||servicesLoading||serviceLoadFailed||!service} className="h-12 w-full rounded-2xl bg-violet-500 text-sm font-semibold disabled:opacity-40">{submitting?'Sending…':'Send booking request'}</button></div></section></div>;
}

function Input({value,set,placeholder}:{value:string;set:(value:string)=>void;placeholder:string}){return <input value={value} onChange={e=>set(e.target.value)} placeholder={placeholder} className="h-12 w-full rounded-2xl border border-white/[.08] bg-[#181B24] px-4 text-sm outline-none focus:border-violet-500/40"/>}
function FieldMessage({children,error=false}:{children:React.ReactNode;error?:boolean}){return <div className={`rounded-2xl border px-4 py-4 text-xs ${error?'border-red-500/15 bg-red-500/[.04] text-red-300':'border-white/[.08] bg-[#181B24] text-[#8B91A0]'}`}>{children}</div>}
