import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase/client';
import {withTimeout} from '@/lib/withTimeout';
import {providerFeeReceipt,type ProviderFeeDisclosure,type ProviderFeeProduct} from '@/lib/providerFees';
import {ProviderFeeTerms} from '@/components/ProviderFeeDisclosure';
import {Button} from '@/components/ui/button';

export default function PropertyFeeAcceptance({requestId,listingId}:{requestId?:string;listingId?:string}){
 const [fee,setFee]=useState<ProviderFeeDisclosure|null>(null),[accepted,setAccepted]=useState(false),[digest,setDigest]=useState<string|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const generation=useRef(0),lock=useRef(false);
 useEffect(()=>{const current=++generation.current;setLoading(true);setError('');setFee(null);setAccepted(false);setDigest(null);
  void withTimeout(supabase.rpc('get_my_property_fee_terms',{p_request_id:requestId||null,p_listing_id:listingId||null}),15000,'Your accepted fees took too long to load.')
   .then(({data,error})=>{if(error)throw error;if(!data||typeof data.accepted!=='boolean'||!['short_let','long_stay'].includes(data.current?.product)||!['host','wehouse'].includes(data.current?.management_mode))throw Error('Property fee terms could not be confirmed.');
    const row=providerFeeReceipt(data.current,data.current.product as ProviderFeeProduct,data.current.management_mode);if(current===generation.current){setFee(row);setAccepted(data.accepted);setDigest(data.accepted?row?.digest||null:null);}})
   .catch(cause=>{if(current===generation.current)setError(message(cause));}).finally(()=>{if(current===generation.current)setLoading(false);});return()=>{generation.current++;};
 },[requestId,listingId,attempt]);
 async function accept(){if(lock.current||!fee||digest!==fee.digest||accepted)return;lock.current=true;setBusy(true);setError('');const current=generation.current;
  try{const {data,error}=await withTimeout(supabase.rpc('accept_my_property_fees',{p_request_id:requestId||null,p_listing_id:listingId||null,p_digest:digest}),15000,'Acceptance result is unknown. Refresh these fees before retrying.');if(error)throw error;
   const saved=providerFeeReceipt(data,fee.product,fee.management_mode);if(saved?.digest!==digest)throw Error('Acceptance was not confirmed. Refresh these fees before retrying.');if(current===generation.current)setAccepted(true);
  }catch(cause){if(current===generation.current)setError(message(cause));}finally{lock.current=false;if(current===generation.current)setBusy(false);}}
 return <div className="space-y-3"><ProviderFeeTerms fee={fee} loading={loading} error={error} refresh={()=>setAttempt(n=>n+1)} acceptedDigest={digest} onAccepted={setDigest} locked={accepted||busy}/>
  {accepted?<p role="status" className="text-sm text-[var(--wh-text-secondary)]">Your acceptance of these rates is recorded. Existing bookings retain their saved terms.</p>:fee&&!loading&&!error?<><p className="text-sm leading-6 text-[var(--wh-text-secondary)]">Review updated rates before publication or new bookings. This records your fee acceptance and does not change existing bookings.</p><Button type="button" disabled={busy||digest!==fee.digest} onClick={()=>void accept()}>{busy?'Recording acceptance...':'Accept current property fees'}</Button></>:null}
 </div>;
}
function message(cause:unknown){return cause instanceof Error?cause.message:(cause as {message?:string})?.message||'Property fee acceptance could not be confirmed.';}
