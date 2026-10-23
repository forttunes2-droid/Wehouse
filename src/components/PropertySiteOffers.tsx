import {savePublicBrowseDraft} from '@/lib/publicBrowseDraft';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {withTimeout} from '@/lib/withTimeout';
import {formatMoney} from '@/lib/regional';
import {homeStyleLabel} from '@/lib/homeStyles';
export type SiteOffer={id:string;title:string;price:number;currency:string;bedrooms:number|null;sub_type:'short_let'|'long_stay';space_scope:string;space_label:string|null;home_style:string|null;unit_id:string};
type Page={listing_id:string;grouped:boolean;items:SiteOffer[];has_more:boolean;next_id:string|null};
export function siteOfferPage(value:unknown,listingId:string):Page{
 const p=value as Page;
 if(!p||p.listing_id!==listingId||typeof p.grouped!=='boolean'||typeof p.has_more!=='boolean'||!Array.isArray(p.items)||p.items.length>12||p.items.some(r=>!r||typeof r.id!=='string'||r.id===listingId||typeof r.title!=='string'||typeof r.unit_id!=='string'||!['entire_unit','private_room'].includes(r.space_scope)||(r.space_label!==null&&typeof r.space_label!=='string')||(r.home_style!==null&&typeof r.home_style!=='string')||(r.bedrooms!==null&&(!Number.isInteger(r.bedrooms)||r.bedrooms<0))||typeof r.price!=='number'||!Number.isFinite(r.price)||r.price<0||!/^[A-Z]{3}$/.test(r.currency)||!['short_let','long_stay'].includes(r.sub_type))||new Set(p.items.map(r=>r.id)).size!==p.items.length|| (p.has_more?(typeof p.next_id!=='string'||p.next_id!==p.items.at(-1)?.id):p.next_id!==null))throw Error('Other homes could not be confirmed. Please retry.');
 return p;
}
export default function PropertySiteOffers({listingId,checkIn,checkOut,onOpen}:{listingId:string;checkIn:string;checkOut:string;onOpen:(id:string)=>void}){
 const [kind,setKind]=useState(''),[page,setPage]=useState<Page|null>(null),[rows,setRows]=useState<SiteOffer[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
 const generation=useRef(0),lock=useRef(false);
 const validDates=/^\d{4}-\d{2}-\d{2}$/.test(checkIn)&&/^\d{4}-\d{2}-\d{2}$/.test(checkOut)&&checkOut>checkIn;
 const from=validDates?checkIn:null,until=validDates?checkOut:null;
 useEffect(()=>{const current=++generation.current;lock.current=false;setPage(null);setRows([]);setError('');setBusy(true);
  void fetchPage(null).then(data=>{if(current===generation.current){setPage(data);setRows(data.items);}}).catch(e=>{if(current===generation.current)setError(message(e));}).finally(()=>{if(current===generation.current)setBusy(false);});
  return()=>{generation.current++;};
 },[listingId,kind,from,until,attempt]);
 async function fetchPage(after:string|null){const {data,error}=await withTimeout(supabase.rpc('get_property_site_offers',{p_listing_id:listingId,p_stay_type:kind||null,p_check_in:from,p_check_out:until,p_after_id:after}),15000,'Other homes took too long to load. Please retry.');if(error)throw error;return siteOfferPage(data,listingId);}
 async function more(){if(lock.current||busy||!page?.has_more)return;lock.current=true;setBusy(true);setError('');const current=generation.current;try{const next=await fetchPage(page.next_id);if(current!==generation.current)return;setPage(next);setRows(previous=>[...previous,...next.items.filter(r=>!previous.some(x=>x.id===r.id))]);}catch(e){if(current===generation.current)setError(message(e));}finally{if(current===generation.current){lock.current=false;setBusy(false);}}}
 if(page&&!page.grouped)return null;
 return <section aria-label="Other homes at this property" className="space-y-3 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 sm:p-5">
 <h3 className="font-semibold">Other homes at this property</h3><p className="text-sm text-[var(--wh-text-secondary)]">Choose a specific home or room in this compound or building. Each offer has its own rental terms.</p>
 <label className="block text-sm">Rental type<select aria-label="Rental type" value={kind} onChange={e=>setKind(e.target.value)} className="ml-2 min-h-11 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3"><option value="">All</option><option value="short_let">Short Let</option><option value="long_stay">Long Let</option></select></label>
 <p className="text-xs text-[var(--wh-text-secondary)]">{kind==='long_stay'?'Long Let offers have their own tenancy terms.':from?`Short Let options checked for ${from} to ${until}.`:'Choose stay dates to check Short Let availability.'} Availability is confirmed again when you book.</p>
 {busy&&<p role="status" className="text-sm">Loading other homes...</p>}{error&&<div role="alert" className="text-sm"><p>{error}</p><button type="button" disabled={busy} onClick={()=>setAttempt(x=>x+1)} className="min-h-11 underline">Retry other homes</button></div>}
 {!busy&&!error&&page&&rows.length===0&&<p className="text-sm text-[var(--wh-text-secondary)]">No other published offers match this selection.</p>}
 <div className="divide-y divide-[var(--wh-border-subtle)]">{rows.map(row=><button key={row.id} type="button" onClick={()=>{if(row.sub_type==='short_let'&&from&&until)savePublicBrowseDraft('listing',row.id,{checkIn:from,checkOut:until});onOpen(row.id);}} className="wh-motion-control block min-h-20 w-full space-y-1 py-4 text-left"><span className="block break-words font-medium">{row.space_label||row.title}</span><span className="block text-sm text-[var(--wh-text-secondary)]">{row.sub_type==='short_let'?'Short Let':'Long Let'} - {row.space_scope==='private_room'?'Private room with shared spaces':'Entire home or flat'}{row.home_style?` - ${homeStyleLabel(row.home_style)}`:''}{row.bedrooms===0&&row.space_scope!=='private_room'?' - Studio / self-contained':row.bedrooms?` - ${row.bedrooms} bedrooms`:''}</span><span className="block text-sm">{formatMoney(row.price,{currency:row.currency})} {row.sub_type==='short_let'?'per night':'per year'}</span><span className="block text-xs text-[var(--wh-accent-text)]">View home and terms</span></button>)}</div>
 {page?.has_more&&<button type="button" disabled={busy} onClick={()=>void more()} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm">More homes at this property</button>}
 </section>;
}
function message(error:unknown){return error instanceof Error?error.message:(error as {message?:string})?.message||'Other homes could not be loaded.';}
