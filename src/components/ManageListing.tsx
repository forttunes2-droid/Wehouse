import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { ListingMediaImage } from '@/components/ListingCandidateMedia';

type Props={
  listingId:string;
  source:{request_code?:string|null;owner_name?:string|null;owner_email?:string|null;owner_phone?:string|null;property_address?:string|null};
};

export default function ManageListing({listingId,source}:Props){
 const[listing,setListing]=useState<any|null>(null),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;void(async()=>{const{data,error}=await supabase.from('listings').select('*').eq('id',listingId).maybeSingle();if(!active)return;if(error)toast.error(error.message);setListing(data);setLoading(false)})();return()=>{active=false}},[listingId]);
 if(loading)return <div className="grid min-h-48 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>;
 if(!listing)return <div className="rounded-2xl border border-amber-500/15 bg-amber-500/[.04] p-4 text-[10px] text-amber-200">The published listing record could not be loaded.</div>;
 const photos=Array.isArray(listing.images)?listing.images:[];
 const location=[listing.address||source.property_address,listing.city,listing.state].filter(Boolean).join(', ');
 const facts=[
  ['Type',listing.sub_type||listing.property_type||'Property'],
  ['Bedrooms',listing.bedrooms??'—'],
  ['Bathrooms',listing.bathrooms??'—'],
  ['Reference',source.request_code||listing.listing_code||listing.id],
 ];
 return <div className="space-y-4">
  <section className="overflow-hidden rounded-[26px] border border-white/[.07] bg-[#10131B]">
   {photos.length?<div className="flex snap-x snap-mandatory overflow-x-auto bg-black scrollbar-hide">{photos.map((photo:string,index:number)=><div key={`${photo}-${index}`} className="relative aspect-[4/3] w-full shrink-0 snap-center sm:aspect-[16/9]"><ListingMediaImage reference={photo} alt={`${listing.title||'Published property'} photo ${index+1}`} className="h-full w-full object-cover"/><span className="absolute bottom-3 right-3 rounded-full bg-black/70 px-2.5 py-1 text-[8px] font-semibold">{index+1} / {photos.length}</span></div>)}</div>:<div className="grid aspect-[4/3] place-items-center bg-black/30 text-[10px] text-[#666D7E]">No public gallery</div>}
   <div className="p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-xl font-bold">{listing.title||source.property_address||'Published property'}</h2><p className="mt-1 text-[10px] text-[#73798A]">{location||'Location not recorded'}</p></div><span className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/[.08] px-2.5 py-1 text-[8px] font-semibold text-emerald-300">LIVE</span></div>
    <p className="mt-4 text-xl font-bold text-violet-200">₦{Number(listing.price||0).toLocaleString('en-NG')} <span className="text-[9px] font-medium text-[#747B8B]">/ year</span></p>
    <div className="mt-4 grid grid-cols-2 gap-x-4 sm:grid-cols-4">{facts.map(([label,value])=><div key={label} className="border-t border-white/[.06] py-3"><p className="text-[8px] uppercase tracking-wide text-[#5F6677]">{label}</p><p className="mt-1 break-words text-[10px] font-semibold capitalize">{String(value)}</p></div>)}</div>
    {listing.description&&<p className="border-t border-white/[.06] pt-4 text-[10px] leading-5 text-[#969BA9]">{listing.description}</p>}
   </div>
  </section>
  <section className="rounded-2xl border border-violet-500/12 bg-violet-500/[.035] p-4">
   <p className="text-[9px] font-bold uppercase tracking-[.15em] text-violet-300">Property Partner record</p>
   <p className="mt-2 text-xs font-semibold">{source.owner_name||source.owner_email||'Property Partner'}</p>
   <p className="mt-1 text-[9px] text-[#747B8B]">{[source.owner_email,source.owner_phone].filter(Boolean).join(' · ')||'Contact details unavailable'}</p>
   <p className="mt-3 text-[9px] leading-5 text-[#73798A]">Submitted facts stay read-only here. If something is wrong, handle it through the property review record instead of silently rewriting the Partner’s submission.</p>
  </section>
 </div>;
}
