import {useEffect,useRef,useState} from 'react';
import AccommodationProtectionPanel,{ArrivalIssueDialog} from '@/components/AccommodationProtectionPanel';
import {getMyAccommodationProtection,reportMyAccommodationArrivalIssue,type AccommodationProtection} from '@/lib/supabase/accommodation-protection';
import {withTimeout} from '@/lib/withTimeout';

export default function SharedHotelArrivalProtection({bookingId,userId,bookingStatus,timezone,onChanged}:{
 bookingId:number;userId:string;bookingStatus:string;timezone:string;onChanged:()=>void;
}){
 const [protection,setProtection]=useState<AccommodationProtection|null>(null),[error,setError]=useState('');
 const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const generation=useRef(0),sequence=useRef(0),inFlight=useRef(false),refreshRef=useRef<()=>void>(()=>{});
 useEffect(()=>{
  const current=++generation.current;setProtection(null);setOpen(false);setReason('');setError('');setBusy(false);setLoading(true);inFlight.current=false;
  async function refresh(){
   if(inFlight.current)return;
   const request=++sequence.current;setLoading(true);
   try{
    const result=await withTimeout(getMyAccommodationProtection('hotel',String(bookingId)),15000,'Payment Protection took too long to load.');
    if(current!==generation.current||request!==sequence.current)return;
    if(result.error||!result.protection||result.protection.subject_type!=='hotel'||String(result.protection.subject_id)!==String(bookingId)){
     setProtection(null);throw Error('Payment Protection could not be loaded. Refresh before reporting.');
    }
    setProtection(result.protection);setError('');if(!result.protection.can_report_arrival_issue)setOpen(false);
   }catch{if(current===generation.current&&request===sequence.current)setError('Payment Protection could not be loaded. Refresh before reporting.');}
   finally{if(current===generation.current&&request===sequence.current)setLoading(false);}
  }
  refreshRef.current=()=>void refresh();void refresh();
  return()=>{generation.current++;sequence.current++;};
 },[bookingId,userId,bookingStatus]);
 async function report(){
  if(inFlight.current||!protection?.can_report_arrival_issue||error||reason.trim().length<10)return;
  inFlight.current=true;setBusy(true);const current=generation.current;sequence.current++;
  try{
   const result=await withTimeout(reportMyAccommodationArrivalIssue('hotel',String(bookingId),reason.trim()),15000,
    'The arrival report could not be confirmed. Refresh before retrying.');
   if(current!==generation.current)return;
   if(result.error||!result.caseId)throw Error('The arrival report could not be confirmed.');
   setProtection(value=>value?{...value,can_report_arrival_issue:false,arrival_issue_case_id:result.caseId,protection_state:'disputed'}:value);
   setOpen(false);setReason('');onChanged();
  }catch{if(current===generation.current)setError('The arrival report could not be confirmed. Your description is retained. Refresh to check the case before retrying.');}
  finally{if(current===generation.current){inFlight.current=false;setBusy(false);}}
 }
 return <section aria-label="Shared stay Payment Protection">
  {loading&&<p role="status" className="text-sm text-[var(--wh-text-secondary)]">Checking Payment Protection…</p>}
  {error&&<div role="alert" className="space-y-2 text-sm leading-6"><p>{error}</p><button type="button" disabled={busy||loading} onClick={()=>refreshRef.current()} className="min-h-11 font-semibold underline">Refresh Payment Protection</button></div>}
  {protection&&!error&&<AccommodationProtectionPanel protection={protection} timezone={timezone} onReport={()=>setOpen(true)}/>}
  <ArrivalIssueDialog open={open&&!error} label="your shared Hotel stay" reason={reason} busy={busy} onReason={setReason} onClose={()=>setOpen(false)} onSubmit={()=>void report()}/>
 </section>;
}
