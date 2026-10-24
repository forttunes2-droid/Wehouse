import { useEffect,useMemo,useRef,useState } from 'react';
import { toast } from 'sonner';
import SearchableSelect from '@/components/SearchableSelect';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { withTimeout } from '@/lib/withTimeout';

type Bank={code:string;name:string};
type Saved={id:string;bank_name:string;bank_code:string|null;account_number:string;account_name:string;verified_at:string|null};
type Resolved={bank:{code:string;name:string};account_number:string;account_name:string;replacement?:boolean;replacement_allowed?:boolean;addition_allowed:boolean;matched_names:number;needs_full_name:boolean;saved_count?:number};
type PendingChange={request_id:string;started_at:number};
type PayoutResult={success?:boolean;pending?:boolean;status?:string;account?:Saved;error?:string;banks?:Bank[]} & Record<string,unknown>;

async function payoutRequest(body:Record<string,unknown>){
 try{
 const{data,error}=await supabase.functions.invoke('payout-account',{body});
 if(!error)return{data:(data||{}) as PayoutResult,error:''};
 let detail=String((data as any)?.error||'');
 const response=(error as any)?.context;
 if(!detail&&response){try{const payload=await response.clone().json();detail=String(payload?.error||'')}catch{}}
 return{data:(data||{}) as PayoutResult,error:detail||error.message||'Payout request failed'};
 }catch{return{data:{} as PayoutResult,error:'Could not connect to payout services. Check your connection.'}}
}

type Props={profile:Profile;onChanged?:()=>void;workspace?:'worker'|'property_partner'};
export default function PayoutAccountManager(props:Props){return <PayoutAccountManagerForAccount key={props.profile.user_id} {...props}/>}
function PayoutAccountManagerForAccount({profile,onChanged,workspace}:Props){
 const storageKey=`wehouse:payout-account-change:${profile.user_id}`;
 const completed=useRef(new Set<string>());
 const statusInFlight=useRef(false),nextStatusCheck=useRef(0),saveInFlight=useRef(false);
 const bankLoadInFlight=useRef(false),bankLoadAlive=useRef(true);
 const [bankError,setBankError]=useState('');
 useEffect(()=>{bankLoadAlive.current=true;return()=>{bankLoadAlive.current=false;};},[]);
 const[loadError,setLoadError]=useState(false),[storageError,setStorageError]=useState(false);
 const[current,setCurrent]=useState<Saved|null>(null),[editing,setEditing]=useState(false),[banks,setBanks]=useState<Bank[]>([]),[bankCode,setBankCode]=useState(''),[number,setNumber]=useState(''),[resolved,setResolved]=useState<Resolved|null>(null),[loading,setLoading]=useState(true),[loadingBanks,setLoadingBanks]=useState(false),[verifying,setVerifying]=useState(false),[saving,setSaving]=useState(false),[reconciling,setReconciling]=useState(false),[pendingChange,setPendingChange]=useState<PendingChange|null>(null);
 const options=useMemo(()=>banks.map(bank=>({value:bank.code,label:bank.name})),[banks]);
 async function loadCurrent(){setLoading(true);setLoadError(false);try{const{data,error}=await withTimeout(supabase.from('bank_accounts').select('id,bank_name,bank_code,account_number,account_name,verified_at').eq('user_id',profile.user_id).eq('is_default',true).eq('is_active',true).maybeSingle(),15000,'Payout account loading timed out');if(error)throw error;setCurrent((data||null) as Saved|null)}catch{setLoadError(true)}finally{setLoading(false)}}
 function rememberPending(change:PendingChange|null){try{if(change)window.localStorage.setItem(storageKey,JSON.stringify(change));else window.localStorage.removeItem(storageKey);window.sessionStorage.removeItem(storageKey);setPendingChange(change);setStorageError(false);return true}catch{setStorageError(true);return false}}
 function contactSupport(){window.dispatchEvent(new CustomEvent('openSupportChat',{detail:{subject:'Payout account help',category:'payment_issue',contextType:'support_case',contextId:pendingChange?.request_id||null,contextSnapshot:{source_type:'payout_account_change',request_id:pendingChange?.request_id||null,requester_workspace:workspace||profile.role}}}))}
 async function finishSuccess(requestId:string,account?:Saved){
  if(completed.current.has(requestId))return;
  completed.current.add(requestId);rememberPending(null);setSaving(false);setReconciling(false);setEditing(false);setResolved(null);setBankCode('');setNumber('');if(account)setCurrent(account);else await loadCurrent();toast.success(current?'Payout account changed':'Payout account added');onChanged?.();
 }
 async function reconcile(change:PendingChange,quiet=false){
  if(statusInFlight.current||Date.now()<nextStatusCheck.current){if(!quiet)toast.message('A status check is already running or was made recently. Automatic checks continue once a minute.');return;}
  statusInFlight.current=true;nextStatusCheck.current=Date.now()+60_000;
  try{
  const result=await withTimeout(payoutRequest({action:'get_change_status',request_id:change.request_id}),15000,'Payout status timed out');
  if(result.error){setReconciling(true);if(!quiet)toast.message('Payout account change is still being confirmed.');return}
  const status=String(result.data?.status||'');
  if(status==='succeeded'&&result.data?.account){await finishSuccess(change.request_id,result.data.account as Saved);return}
  if(status==='failed'){
   rememberPending(null);setSaving(false);setReconciling(false);if(!quiet)toast.error(String(result.data?.error||'Payout account change failed. You can safely try again.'));return;
  }
  // A missing ledger cannot prove that an in-flight provider request stopped.
  // Preserve this intent until the server confirms a terminal outcome.
  if(status==='not_found'&&!quiet)toast.message('This request is not confirmed yet. Check again or contact support before submitting another account.');
  setReconciling(true);
  }catch{setReconciling(true);if(!quiet)toast.message('This request is still unconfirmed. Your reference has been kept.')}finally{statusInFlight.current=false}
 }
 useEffect(()=>{void loadCurrent();try{const raw=window.localStorage.getItem(storageKey)||window.sessionStorage.getItem(storageKey);if(raw){const parsed=JSON.parse(raw) as PendingChange;if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed?.request_id)||!Number.isFinite(parsed?.started_at))throw new Error('Invalid saved request');if(rememberPending(parsed))setReconciling(true)}}catch{setStorageError(true)}},[profile.user_id]);
 useEffect(()=>{if(!pendingChange)return;void reconcile(pendingChange,true);const timer=window.setInterval(()=>void reconcile(pendingChange,true),60_000);return()=>window.clearInterval(timer)},[pendingChange?.request_id]);
 async function loadBanks(){
  if(banks.length||bankLoadInFlight.current)return;bankLoadInFlight.current=true;setLoadingBanks(true);setBankError('');
  try{
   const result=await withTimeout(payoutRequest({action:'banks'}),15000,'Bank list timed out');if(!bankLoadAlive.current)return;
   const rows=result.data?.banks;
   if(result.error||result.data?.success!==true||!Array.isArray(rows)||!rows.length||rows.some(bank=>typeof bank?.code!=='string'||typeof bank?.name!=='string'||!bank.code||!bank.name.trim()))throw new Error('Bank list could not be confirmed');
   setBanks(rows);
  }catch{if(bankLoadAlive.current){setBankError('Bank list unavailable. Retry loading the banks.');toast.error('Banks could not be loaded. Try again.');}}
  finally{bankLoadInFlight.current=false;if(bankLoadAlive.current)setLoadingBanks(false);}
 }
 function begin(){if(pendingChange)return toast.message('Your previous payout-account change is still being confirmed.');if(current)return contactSupport();setEditing(true);setBankCode('');setNumber('');setResolved(null);void loadBanks()}
 async function verify(){if(!bankCode)return toast.error('Choose a bank');if(!/^\d{10}$/.test(number))return toast.error('Enter a valid 10-digit account number');setVerifying(true);try{const result=await withTimeout(payoutRequest({action:'resolve',bank_code:bankCode,account_number:number}),15000,'Account verification timed out');if(result.error||!result.data?.success){setResolved(null);return toast.error(result.error||String(result.data?.error||'Unable to verify account'))}setResolved(result.data as unknown as Resolved);toast.success('Account name verified')}catch{setResolved(null);toast.error('Account verification could not finish. Please try again.')}finally{setVerifying(false)}}
 async function save(){
  if(!resolved||pendingChange||saveInFlight.current||storageError)return;
  const requestId=crypto.randomUUID(),change={request_id:requestId,started_at:Date.now()};if(!rememberPending(change))return;saveInFlight.current=true;setSaving(true);setReconciling(false);
  const slowTimer=window.setTimeout(()=>{setReconciling(true);toast.message('Still confirming your payout account. Do not submit it again.')},15000);
  try{
   const result=await payoutRequest({action:'save',request_id:requestId,bank_code:resolved.bank.code,account_number:resolved.account_number});
   if(result.error){setReconciling(true);return}
   if(result.data?.status==='succeeded'&&result.data?.account){await finishSuccess(requestId,result.data.account as Saved);return}
   if(result.data?.status==='failed'){rememberPending(null);setSaving(false);setReconciling(false);return toast.error(String(result.data?.error||'Unable to save payout account'))}
   setReconciling(true);
  }finally{window.clearTimeout(slowTimer);saveInFlight.current=false}
 }
 if(loading)return <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4"><div className="h-16 animate-pulse rounded-xl bg-[var(--wh-interactive)]"/></section>;
 if(loadError)return <section role="alert" className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4"><p className="text-sm font-semibold">Payout account could not be loaded</p><p className="mt-2 text-sm text-[var(--wh-text-secondary)]">Check again before adding or changing a bank account.</p><button type="button" onClick={()=>void loadCurrent()} className="mt-3 min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm">Try again</button><button type="button" onClick={contactSupport} className="min-h-11 px-4 text-sm">Contact support</button></section>;
 return <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold">Payout account</p><p className="mt-1 text-[9px] leading-relaxed text-[var(--wh-text-muted)]">Withdrawals are sent only to this verified bank account.</p></div>{!editing&&<button onClick={begin} disabled={Boolean(pendingChange)||storageError} className="shrink-0 rounded-xl border border-violet-500/20 bg-violet-500/[.07] px-3 py-2 text-[9px] font-semibold text-violet-300 disabled:opacity-40">{current?'Get help':'Add account'}</button>}</div>
 {storageError&&<div role="alert" className="mt-4 rounded-xl border border-amber-500/25 p-3 text-sm text-[var(--wh-text-secondary)]">Your saved payout request could not be accessed. No new request will be sent. Enable browser storage or contact support.<button type="button" onClick={contactSupport} className="mt-2 block min-h-11 font-semibold">Contact support</button></div>}
 {current&&<p className="mt-3 text-xs leading-5 text-[var(--wh-text-muted)]">Changing payout accounts is unavailable until additional sign-in verification is enabled.</p>}
 {pendingChange&&<div className="mt-4 rounded-xl border border-amber-500/15 bg-amber-500/[.05] p-3"><div className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-amber-300"/><p className="text-[10px] font-semibold text-amber-200">Confirming payout-account change</p></div><p className="mt-1 text-[9px] leading-4 text-[var(--wh-text-secondary)]">WeHouse checks this request once a minute. Keep the same reference until its outcome is confirmed.</p><button type="button" onClick={()=>void reconcile(pendingChange,false)} className="mt-2 text-[9px] font-semibold text-amber-200">Check status</button><p className="mt-2 break-all text-xs text-[var(--wh-text-secondary)]">Reference: {pendingChange.request_id}</p><button type="button" onClick={contactSupport} className="mt-2 min-h-11 text-sm font-semibold text-[var(--wh-accent-text)]">Contact support</button></div>}
 {current&&!editing&&<div className="mt-4 flex items-center gap-3 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] p-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-[10px] font-bold text-violet-200">{current.bank_name.slice(0,2).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{current.bank_name}</p><p className="mt-1 truncate text-[9px] text-[var(--wh-text-muted)]">•••• {current.account_number.slice(-4)} · {current.account_name}</p></div><span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[8px] text-emerald-300">Verified</span></div>}
 {!current&&!editing&&!pendingChange&&<div className="mt-4 rounded-xl border border-dashed border-[var(--wh-border-subtle)] p-4 text-[10px] leading-relaxed text-[var(--wh-text-muted)]">No payout account connected. Add one before requesting a withdrawal.</div>}
 {editing&&<div className="fixed inset-0 z-[100] flex flex-col bg-[var(--wh-bg)] text-[var(--wh-text)]"><header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--wh-border-subtle)] px-4"><button disabled={saving&&!pendingChange} onClick={()=>{setEditing(false);setResolved(null)}} className="grid h-10 w-10 place-items-center rounded-full bg-[var(--wh-interactive)] disabled:opacity-40" aria-label="Close payout account setup">←</button><div className="text-center"><p className="text-sm font-semibold">{current?'Change payout account':'Add payout account'}</p><p className="mt-0.5 text-[8px] text-[var(--wh-text-muted)]">Secure bank verification</p></div><span className="w-10"/></header><main className="mx-auto w-full max-w-lg flex-1 overflow-y-auto px-4 py-5"><div className="mb-6 grid grid-cols-3 gap-2 text-center text-[8px] font-semibold"><span className="text-violet-300">1 · Bank</span><span className={resolved?'text-violet-300':'text-[var(--wh-text-muted)]'}>2 · Verify</span><span className={pendingChange?'text-amber-300':'text-[var(--wh-text-muted)]'}>3 · Save</span></div><div className="space-y-4 rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5"><div><h2 className="text-lg font-bold">Where should we send your payouts?</h2><p className="mt-2 text-[10px] leading-5 text-[var(--wh-text-muted)]">Choose your bank and enter the account number. WeHouse verifies the account name directly with Paystack.</p></div><SearchableSelect label="Bank" value={bankCode} onChange={value=>{setBankCode(value);setResolved(null)}} options={options} placeholder={loadingBanks?'Loading banks…':'Choose bank'} searchPlaceholder="Search bank" disabled={loadingBanks||saving||Boolean(bankError)}/>{bankError&&<div role="alert" className="rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] p-3"><p className="text-sm text-[var(--wh-danger-text)]">{bankError}</p><button type="button" disabled={loadingBanks||saving} onClick={()=>void loadBanks()} className="mt-1 min-h-11 text-sm font-semibold text-[var(--wh-accent-text)] disabled:opacity-50">Retry bank list</button></div>}<label className="block"><span className="mb-1.5 block text-[10px] font-medium text-[var(--wh-text-muted)]">Account number</span><input inputMode="numeric" maxLength={10} disabled={saving} value={number} onChange={event=>{setNumber(event.target.value.replace(/\D/g,'').slice(0,10));setResolved(null)}} placeholder="10-digit account number" className="h-12 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-base tracking-[.12em] outline-none focus:border-violet-500/45 disabled:opacity-50"/></label><button onClick={()=>void verify()} disabled={verifying||saving||!bankCode||number.length!==10} className="h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">{verifying?'Verifying securely…':'Verify account'}</button>{resolved&&<div className={`rounded-2xl border p-4 ${resolved.addition_allowed?'border-emerald-500/20 bg-emerald-500/[.05]':'border-red-500/20 bg-red-500/[.05]'}`}><p className="text-[9px] uppercase tracking-wide text-[var(--wh-text-muted)]">Verified account name</p><p className="mt-1 text-base font-semibold">{resolved.account_name}</p><p className="mt-1 text-[9px] text-[var(--wh-text-muted)]">{resolved.bank.name} · •••• {resolved.account_number.slice(-4)}</p>{!resolved.addition_allowed&&<p className="mt-2 text-[9px] leading-relaxed text-red-300">{resolved.needs_full_name?'Complete your full name in Personal Details before changing your payout account.':'This account must match at least two names from your saved WeHouse full name.'}</p>}</div>}{resolved?.addition_allowed&&<button onClick={()=>void save()} disabled={saving||Boolean(pendingChange)} className="h-12 w-full rounded-xl bg-emerald-400 text-xs font-bold text-[#06100B] disabled:opacity-40">{saving?(reconciling?'Still confirming…':'Saving securely…'):current?'Confirm account change':'Save verified account'}</button>}{pendingChange&&<p className="text-center text-[9px] leading-4 text-amber-200">This request is being reconciled. You do not need to submit it again.</p>}</div></main></div>}
 </section>
}
