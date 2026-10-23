import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/withTimeout';
import { displayDate } from '@/lib/displayDate';

type ScheduleEvent = { event_id:string; kind:'stay'|'closure'; status:string; starts_on:string|null; ends_on:string|null };
type ScheduleRow = { listing_id:string; title:string|null; space_label:string|null; space_scope:string|null; sub_type:string; events:ScheduleEvent[]; events_truncated:boolean };
const eventLabels:Record<string,string>={payment_pending:'Payment pending',reserved:'Reserved',inspection_pending:'Inspection pending',ready_for_move_in:'Awaiting arrival',occupied:'Occupied',closed:'Closed dates'};
function currentMonth(){const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;}
function windowFor(month:string){const [year,number]=month.split('-').map(Number);const next=new Date(year,number,1);return {from:`${month}-01`,until:`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-01`};}
function validRows(value:unknown):value is ScheduleRow[]{return Array.isArray(value)&&value.every(row=>row&&typeof row.listing_id==='string'&&typeof row.sub_type==='string'&&typeof row.events_truncated==='boolean'&&Array.isArray(row.events)&&row.events.every((event:ScheduleEvent)=>event&&typeof event.event_id==='string'&&['stay','closure'].includes(event.kind)&&typeof event.status==='string'&&(event.starts_on===null||typeof event.starts_on==='string')&&(event.ends_on===null||typeof event.ends_on==='string')));}

export default function PropertySiteSchedule({siteId,accountId}:{siteId:string;accountId:string}){
 const [open,setOpen]=useState(false),[month,setMonth]=useState(currentMonth),[revision,setRevision]=useState(0);
 const [rows,setRows]=useState<ScheduleRow[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),pending=useRef(false);
 useEffect(()=>{
  const request=++generation.current;pending.current=false;setRows([]);setCursor(null);setError('');setLoading(false);
  if(!open)return;
  const range=windowFor(month);pending.current=true;setLoading(true);
  void (async()=>{try{
   const {data,error:failure}=await withTimeout(supabase.rpc('get_my_property_site_schedule',{p_site_id:siteId,p_from:range.from,p_until:range.until,p_after_id:null}),15000,'The building schedule could not be confirmed. Try again.');
   if(request!==generation.current)return;if(failure)throw failure;
   if(!data||data.site_id!==siteId||data.from!==range.from||data.until!==range.until||!validRows(data.items)||typeof data.has_more!=='boolean'||(data.has_more&&typeof data.next_id!=='string'))throw new Error('The building schedule could not be confirmed.');
   setRows(data.items);setCursor(data.has_more?data.next_id:null);
  }catch(cause){if(request===generation.current)setError(cause instanceof Error?cause.message:'The building schedule could not be loaded.');}
  finally{if(request===generation.current){pending.current=false;setLoading(false);}}})();
  return()=>{generation.current++;};
 },[siteId,accountId,month,open,revision]);
 async function more(){
  if(!cursor||pending.current)return;const request=generation.current,range=windowFor(month),after=cursor;
  pending.current=true;setLoading(true);setError('');
  try{
   const {data,error:failure}=await withTimeout(supabase.rpc('get_my_property_site_schedule',{p_site_id:siteId,p_from:range.from,p_until:range.until,p_after_id:after}),15000,'More schedule entries could not be confirmed.');
   if(request!==generation.current)return;if(failure)throw failure;
   if(!data||data.site_id!==siteId||data.from!==range.from||data.until!==range.until||!validRows(data.items)||typeof data.has_more!=='boolean'||(data.has_more&&(typeof data.next_id!=='string'||data.next_id<=after)))throw new Error('More schedule entries could not be confirmed.');
   setRows(current=>[...new Map([...current,...data.items].map(row=>[row.listing_id,row])).values()]);setCursor(data.has_more?data.next_id:null);
  }catch(cause){if(request===generation.current)setError(cause instanceof Error?cause.message:'More schedule entries could not be loaded.');}
  finally{if(request===generation.current){pending.current=false;setLoading(false);}}
 }
 return <div className="mt-3">
  <button type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold">{open?'Hide building schedule':'View building schedule'}</button>
  {open&&<section aria-label="Building schedule" className="mt-3 space-y-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
   <div className="flex flex-wrap items-end justify-between gap-3"><label className="min-w-0 text-sm font-medium">Month<input type="month" value={month} onChange={event=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value))setMonth(event.target.value);}} className="[color-scheme:light] dark:[color-scheme:dark] mt-1 block min-h-11 max-w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-[var(--wh-text)]"/></label><button type="button" disabled={loading} onClick={()=>setRevision(value=>value+1)} className="min-h-11 px-3 text-sm font-semibold disabled:opacity-50">Refresh schedule</button></div>
   <p className="text-xs leading-5 text-[var(--wh-text-secondary)]">Recorded stays and closed dates for listings you can manage. Pending payments are holds, not confirmed stays. Undated tenancies appear separately. Empty dates do not guarantee availability; booking checks also protect shared rooms and whole homes.</p>
   {error&&<div role="alert" className="text-sm"><p>{error}</p><button type="button" disabled={loading} onClick={()=>cursor?void more():setRevision(value=>value+1)} className="min-h-11 font-semibold">Retry schedule</button></div>}
   {rows.map(row=><article key={row.listing_id} className="border-t border-[var(--wh-border-subtle)] pt-3"><h4 className="break-words text-sm font-semibold">{row.space_label||row.title||'Home'}</h4><p className="mt-1 text-xs text-[var(--wh-text-secondary)]">{row.sub_type==='short_let'?'Short Let':'Long Let'} · {row.space_scope==='private_room'?'Private bedroom':'Whole home or flat'}</p>
    {row.events.length?<ul className="mt-2 space-y-2">{row.events.map(event=><li key={event.event_id} className="rounded-xl bg-[var(--wh-elevated)] p-3 text-xs"><p className="font-semibold">{eventLabels[event.status]||'Recorded stay'}</p><p className="mt-1 text-[var(--wh-text-secondary)]">{event.starts_on&&event.ends_on?`${displayDate(event.starts_on)} – ${displayDate(event.ends_on)}${event.kind==='closure'?' (reopens)':' (check-out)'}`:'Dates not recorded — check the individual tenancy before accepting another booking.'}</p></li>)}</ul>:<p className="mt-2 text-xs text-[var(--wh-text-secondary)]">No stays or closed dates recorded for this month.</p>}
    {row.events_truncated&&<p role="status" className="mt-2 text-xs text-[var(--wh-text-secondary)]">Showing the first 100 entries. Open this property's booking history for the full record.</p>}
   </article>)}
   {loading&&<p role="status" className="text-sm">Loading schedule…</p>}
   {!loading&&!error&&!rows.length&&<p className="text-sm">No published listings are available in this schedule.</p>}
   {cursor&&<button type="button" disabled={loading} onClick={()=>void more()} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold disabled:opacity-50">Load more homes</button>}
  </section>}
 </div>;
}
