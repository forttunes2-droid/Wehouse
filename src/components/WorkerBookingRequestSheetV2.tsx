import { useEffect,useMemo,useState } from 'react';
import { toast } from 'sonner';
import SearchableSelect from '@/components/SearchableSelect';
import { createBookingRequest } from '@/lib/supabase/worker-bookings';
import { supabase } from '@/lib/supabase';
import { WORKER_OCCUPATION_LABELS } from '@/types';
import type { Profile } from '@/types';

type Props={worker:Profile;profile:Profile;onClose:()=>void;onCreated:(conversationId:string,bookingId:string)=>void};

export default function WorkerBookingRequestSheetV2({worker,profile,onClose,onCreated}:Props){
 const[description,setDescription]=useState(''),[address,setAddress]=useState(''),[date,setDate]=useState(''),[message,setMessage]=useState(''),[step,setStep]=useState<1|2|3>(1),[submitting,setSubmitting]=useState(false),[services,setServices]=useState<string[]>([]),[service,setService]=useState(''),[servicesLoading,setServicesLoading]=useState(true),[serviceLoadFailed,setServiceLoadFailed]=useState(false);
 const min=useMemo(()=>{const now=new Date();const local=new Date(now.getTime()-now.getTimezoneOffset()*60000);return local.toISOString().slice(0,10)},[]);
 const serviceOptions=useMemo(()=>services.map(item=>({value:item,label:item})),[services]);
 const dates=useMemo(()=>Array.from({length:14},(_,index)=>{const value=new Date();value.setDate(value.getDate()+index);const local=new Date(value.getTime()-value.getTimezoneOffset()*60000);return{value:local.toISOString().slice(0,10),label:index===0?'Today':index===1?'Tomorrow':value.toLocaleDateString([],{weekday:'short',day:'numeric',month:'short'})}}),[]);

 useEffect(()=>{let cancelled=false;void (async()=>{
  setServicesLoading(true);setServiceLoadFailed(false);setServices([]);setService('');
  const{data,error}=await supabase.from('worker_services').select('service_name').eq('worker_id',worker.user_id).order('service_name');
  if(cancelled)return;
  const skills=Array.isArray(worker.worker_skills)?worker.worker_skills.filter((item):item is string=>typeof item==='string'&&Boolean(item.trim())):[];
  if(error&&skills.length===0){setServiceLoadFailed(true);setServicesLoading(false);return}
  const specific=[...((data||[]) as Array<{service_name:string|null}>).map(row=>String(row.service_name||'').trim()),...skills.map(item=>item.trim())].filter(Boolean);
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

 const detailsReady=Boolean(service&&description.trim()&&address.trim()),scheduleReady=Boolean(date&&date>=min);
 return <div className="fixed inset-0 z-[70] flex h-[100dvh] flex-col bg-[#0A0A0F]" role="dialog" aria-modal="true"><header className="shrink-0 border-b border-white/[.06] px-4 py-3"><div className="mx-auto flex max-w-lg items-center gap-3"><button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full text-[#8C91A0]" aria-label="Close request">←</button><div className="min-w-0 flex-1"><p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">REQUEST A SERVICE</p><h2 className="truncate text-sm font-semibold">{worker.full_name||worker.username||'Professional'}</h2></div><span className="text-[9px] text-[#666D7D]">{step} of 3</span></div></header><main className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-lg px-4 py-6">{step===1&&<section><h3 className="text-xl font-bold">What do you need?</h3><p className="mt-1 text-[11px] text-[#747A8A]">Give the professional the job and location. Price is agreed in the conversation.</p><div className="mt-6 space-y-3">{servicesLoading?<FieldMessage>Loading services…</FieldMessage>:serviceLoadFailed?<FieldMessage error>Could not load this Worker’s services. Close and try again.</FieldMessage>:services.length===0?<FieldMessage>No bookable service is available.</FieldMessage>:<SearchableSelect label="Service" value={service} onChange={setService} options={serviceOptions} placeholder="Choose service" searchPlaceholder="Search this Worker’s services…" emptyText="No matching service"/>}<Input value={description} set={setDescription} placeholder="Describe the work needed"/><Input value={address} set={setAddress} placeholder="Where should the professional come?"/></div></section>}{step===2&&<section><h3 className="text-xl font-bold">Choose a preferred day</h3><p className="mt-1 text-[11px] text-[#747A8A]">The professional can confirm or suggest another time in the conversation.</p><div className="mt-6 grid grid-cols-2 gap-2">{dates.map(item=><button key={item.value} onClick={()=>setDate(item.value)} className={`min-h-12 rounded-xl border px-3 text-left text-xs ${date===item.value?'border-violet-500 bg-violet-500/10 text-violet-200':'border-white/[.07] bg-white/[.025] text-[#ADB2BF]'}`}>{item.label}</button>)}</div><textarea value={message} onChange={e=>setMessage(e.target.value)} rows={3} placeholder="Extra details (optional)" className="mt-4 w-full resize-none rounded-2xl border border-white/[.08] bg-[#181B24] px-4 py-3 text-sm outline-none focus:border-violet-500/40"/></section>}{step===3&&<section><h3 className="text-xl font-bold">Review your request</h3><p className="mt-1 text-[11px] text-[#747A8A]">Nothing is charged now. Sending opens one job conversation with this professional.</p><div className="mt-6 divide-y divide-white/[.06] border-y border-white/[.06]"><Review label="Service" value={service}/><Review label="Job" value={description}/><Review label="Address" value={address}/><Review label="Preferred day" value={new Date(`${date}T12:00:00`).toLocaleDateString([],{weekday:'long',day:'numeric',month:'long'})}/>{message&&<Review label="Note" value={message}/>}</div></section>}</div></main><footer className="shrink-0 border-t border-white/[.06] bg-[#0A0A0F] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><div className="mx-auto flex max-w-lg gap-2">{step>1&&<button onClick={()=>setStep(current=>(current-1) as 1|2)} className="h-12 w-24 rounded-xl border border-white/[.08] text-xs font-semibold">Back</button>}{step===1&&detailsReady&&<button onClick={()=>setStep(2)} className="h-12 flex-1 rounded-xl bg-violet-500 text-sm font-semibold">Choose day</button>}{step===2&&scheduleReady&&<button onClick={()=>setStep(3)} className="h-12 flex-1 rounded-xl bg-violet-500 text-sm font-semibold">Review request</button>}{step===3&&<button onClick={()=>void submit()} disabled={submitting||!profile.user_id} className="h-12 flex-1 rounded-xl bg-violet-500 text-sm font-semibold disabled:opacity-40">{submitting?'Sending…':'Send request'}</button>}</div></footer></div>;
}

function Input({value,set,placeholder}:{value:string;set:(value:string)=>void;placeholder:string}){return <input value={value} onChange={e=>set(e.target.value)} placeholder={placeholder} className="h-12 w-full rounded-2xl border border-white/[.08] bg-[#181B24] px-4 text-sm outline-none focus:border-violet-500/40"/>}
function FieldMessage({children,error=false}:{children:React.ReactNode;error?:boolean}){return <div className={`rounded-2xl border px-4 py-4 text-xs ${error?'border-red-500/15 bg-red-500/[.04] text-red-300':'border-white/[.08] bg-[#181B24] text-[#8B91A0]'}`}>{children}</div>}
function Review({label,value}:{label:string;value:string}){return <div className="flex gap-5 py-4"><span className="w-24 shrink-0 text-[10px] text-[#6F7585]">{label}</span><span className="text-[12px] font-medium text-[#E3E5EB]">{value}</span></div>}
