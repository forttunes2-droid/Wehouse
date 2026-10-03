import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

export default function WorkerCustomerRecordConsent({ workerId }: { workerId: string }) {
  const [consent,setConsent]=useState(false);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{
    let current=true;setLoading(true);
    void supabase.rpc('get_my_worker_customer_record_consent',{p_worker_id:workerId}).then(({data,error})=>{
      if(current){if(!error)setConsent(data===true);setLoading(false);}
    });
    return()=>{current=false;};
  },[workerId]);
  async function change() {
    if(saving)return;setSaving(true);
    const {data,error}=await supabase.rpc('set_my_worker_customer_record_consent',{p_worker_id:workerId,p_consent:!consent});
    setSaving(false);
    if(error){toast.error('Could not update permission. Try again.');return;}
    setConsent(data===true);
    toast.success(data?'Customer record enabled':'Customer record removed');
  }
  return <section className="mt-4 rounded-2xl border border-[var(--wh-border-subtle)] p-4">
    <h3 className="text-sm font-semibold">Your Worker customer record</h3>
    <p className="mt-1 text-xs leading-5 text-[var(--wh-text-secondary)]">Allow this Worker to keep a private repeat-customer record and note from your completed WeHouse jobs. You can revoke this at any time; revoking deletes their private note. Your booking history remains in WeHouse.</p>
    <button type="button" disabled={loading||saving} onClick={()=>void change()} aria-pressed={consent} className="mt-3 min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold disabled:opacity-40">{loading?'Checking…':saving?'Saving…':consent?'Remove permission':'Allow customer record'}</button>
  </section>;
}
