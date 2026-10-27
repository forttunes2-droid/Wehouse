import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase/client';
import {withTimeout} from '@/lib/withTimeout';
import {Button} from '@/components/ui/button';
import LaterRentHistory from '@/components/LaterRentHistory';
type Setup={listing_id:string;bank_account_id:string|null;bank_name:string|null;last4:string|null;ready:boolean};
type Account={plan_id:string;reservation_id:string;tenant_name:string;status:string};
type Page={items:Account[];has_more:boolean;next_id:string|null};
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f\d-]{36}$/i.test(v);
type Props={listingId:string;userId:string;onDiscuss:()=>void};
export default function PartnerRentAccounts(props:Props){return <Accounts key={props.userId+':'+props.listingId} {...props}/>;}
function Accounts({listingId,userId,onDiscuss}:Props){
 const [open,setOpen]=useState(false),[setup,setSetup]=useState<Setup|null>(null),[accounts,setAccounts]=useState<Page|null>(null),[selected,setSelected]=useState<string|null>(null),[attempt,setAttempt]=useState(0),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[setupPage,setSetupPage]=useState(1);
 const generation=useRef(0),lock=useRef(false);
 async function rpc(name:string,args:Record<string,unknown>){const {data,error}=await withTimeout(supabase.rpc(name,args),15000,'Rent accounts took too long. Refresh before retrying.');if(error)throw error;return data;}
 async function readSetup(){const r=await rpc('get_my_rent_settlement_setup',{p_listing_id:listingId}) as Setup;if(!r||r.listing_id!==listingId||typeof r.ready!=='boolean'||r.bank_account_id!==null&&!uuid(r.bank_account_id))throw Error('Settlement setup could not be confirmed.');return r;}
 async function readAccounts(after:string|null=null){const r=await rpc('get_my_property_later_rent_accounts',{p_listing_id:listingId,p_after_id:after,p_limit:16}) as Page&{listing_id:string};if(!r||r.listing_id!==listingId||!Array.isArray(r.items)||r.items.length>16||r.items.some(a=>!uuid(a.plan_id)||typeof a.reservation_id!=='string'||!a.reservation_id||typeof a.tenant_name!=='string'||typeof a.status!=='string')||typeof r.has_more!=='boolean'||r.has_more&&!uuid(r.next_id)||!r.has_more&&r.next_id!==null)throw Error('Rent accounts could not be confirmed.');return r;}
 useEffect(()=>{if(!open)return;const current=++generation.current;setLoading(true);setError('');void Promise.all([readSetup(),readAccounts()]).then(([s,a])=>{if(current===generation.current){setSetup(s);setAccounts(a);}}).catch(c=>{if(current===generation.current)setError(message(c));}).finally(()=>{if(current===generation.current)setLoading(false);});return()=>{generation.current++;};},[open,attempt,listingId]);
 async function prepare(){if(lock.current||!setup?.bank_account_id)return;lock.current=true;setBusy(true);setError('');setNotice('');const current=generation.current;
  try{const{data,error}=await withTimeout(supabase.functions.invoke('rent-settlement-setup',{body:{bank_account_id:setup.bank_account_id,page:setupPage}}),25000,'Setup result is unknown. Check saved setup before retrying.');if(current!==generation.current)return;
   if(error||data?.ready!==true){let details=data;if(error)try{details=await error.context?.json();}catch{/* Missing response is unknown. */}if(details?.pending===true&&Number.isInteger(details.next_page)&&details.next_page>0)setSetupPage(details.next_page);throw Error(details?.error||'Settlement setup could not be confirmed. Refresh before retrying.');}
   const saved=await readSetup();if(current!==generation.current)return;setSetup(saved);setNotice('Partner settlement setup verified. Accepted tenant rent and fees remain unchanged.');setSetupPage(1);
  }catch(c){if(current===generation.current)setError(message(c));}finally{lock.current=false;if(current===generation.current)setBusy(false);}
 }
 async function more(){if(lock.current||!accounts?.has_more)return;lock.current=true;setBusy(true);const current=generation.current;try{const next=await readAccounts(accounts.next_id);if(current===generation.current)setAccounts(old=>old?{...next,items:[...old.items,...next.items]}:next);}catch(c){if(current===generation.current)setError(message(c));}finally{lock.current=false;if(current===generation.current)setBusy(false);}}
 return <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4"><Button type="button" variant="outline" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>Rent payments and settlement</Button>
  {open&&<div className="mt-4 space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Later-year rent accounts</h3><Button type="button" variant="outline" disabled={loading||busy} onClick={()=>setAttempt(n=>n+1)}>Refresh rent accounts</Button></div>
   {loading&&<p role="status" className="text-sm">Loading your rent accounts...</p>}{error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
   {setup&&!loading&&<div className="space-y-3 rounded-xl bg-[var(--wh-elevated)] p-3"><p className="text-sm">{setup.bank_account_id?`${setup.bank_name||'Verified bank'} · ending ${setup.last4}`:'Verify your default bank in Wallet before preparing monthly settlement.'}</p><p className="text-sm leading-6 text-[var(--wh-text-secondary)]">{setup.ready?'Direct Partner settlement is ready. Charges and confirmed settlements have separate records.':'Monthly rent requires verified settlement setup. Preparation does not charge a tenant or change an accepted agreement.'}</p>{setup.bank_account_id&&!setup.ready&&<Button type="button" disabled={busy} onClick={()=>void prepare()}>Prepare or check settlement setup</Button>}</div>}
   {!loading&&accounts?.items.length===0&&<p className="text-sm text-[var(--wh-text-secondary)]">Later-year rent accounts appear after a tenant pays Year 1 under an accepted monthly agreement.</p>}
   <div className="flex flex-wrap gap-2">{accounts?.items.map(a=><Button type="button" variant={selected===a.reservation_id?'default':'outline'} key={a.plan_id} onClick={()=>setSelected(a.reservation_id)}>{a.tenant_name} · {a.status}</Button>)}</div>
   {accounts?.has_more&&<Button type="button" variant="outline" disabled={busy} onClick={()=>void more()}>More rent accounts</Button>}
   {selected&&<LaterRentHistory reservationId={selected} userId={userId} onDiscuss={onDiscuss}/>}
  </div>}
 </section>;
}
function message(c:unknown){return c instanceof Error?c.message:(c as {message?:string})?.message||'Rent accounts could not be confirmed. Refresh before retrying.';}
