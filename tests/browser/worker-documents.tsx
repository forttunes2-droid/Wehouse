import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import WorkerProPanel from '@/components/WorkerProPanel';
import type { Profile, WorkerProEntitlement } from '@/types';
const state = (window as any).__documents;
function Fixture() {
  const [active,setActive]=useState(state.mode==='active'||state.mode==='jobs-error'||state.mode==='lapse');
  const [user,setUser]=useState('worker-a');
  (window as any).__expire=()=>setActive(false);
  (window as any).__switchWorker=()=>setUser('worker-b');
  const pro={product_name:'WeHouse Works',active,sales_enabled:false,features:['Quotes and invoices'],plans:[],status:active?'active':'expired',provider:null,monthly_price_ngn:0} as unknown as WorkerProEntitlement;
  return <main className="mx-auto max-w-2xl p-4 text-foreground"><WorkerProPanel profile={{user_id:user,full_name:'Test Worker'} as Profile} pro={state.mode==='unknown'?null:pro} loading={state.mode==='loading'} error={state.mode==='unknown'?'Plan status unavailable':''} onRefresh={async()=>{}} /></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
