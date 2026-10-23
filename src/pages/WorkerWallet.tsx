import WalletWithdrawalNotice from '@/components/WalletWithdrawalNotice';
import { validWalletSnapshot } from '@/lib/walletSnapshot';
import { useWalletWithdrawal } from '@/hooks/useWalletWithdrawal';
import { walletActivity, type WalletActivity } from '@/lib/walletActivity';
import { withTimeout } from '@/lib/withTimeout';
import WeHouseLoadingState from "@/components/WeHouseLoadingState";
import WithdrawalConfirmDialog from "@/components/WithdrawalConfirmDialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";
import { formatMoney, currencySymbol } from "@/lib/regional";

type Wallet={id:string;available_balance:number;pending_balance:number;frozen_balance:number;total_withdrawn:number;is_frozen:boolean;frozen_reason:string|null};
type Bank={id:string;bank_name:string;account_number:string;account_name:string;is_default:boolean};
type Movement=WalletActivity;
type View="wallet"|"withdraw"|"activity";
const money=(n:number)=>`${formatMoney(Number(n||0),{currency:'NGN'})}`;

export default function WorkerWallet({profile}:{profile:Profile}){
 return <WorkerWalletContent key={profile.user_id} profile={profile}/>;
}
function WorkerWalletContent({profile}:{profile:Profile}){
 const amountKey=`wh_finance_amounts_visible_${profile.user_id}`;
 const[loadError,setLoadError]=useState('');
 const[confirming,setConfirming]=useState(false),[view,setView]=useState<View>("wallet"),[wallet,setWallet]=useState<Wallet|null>(null),[banks,setBanks]=useState<Bank[]>([]),[bankId,setBankId]=useState(""),[rows,setRows]=useState<Movement[]>([]),[amount,setAmount]=useState(""),[loading,setLoading]=useState(true),[show,setShow]=useState(()=>{try{return localStorage.getItem(amountKey)!=="false"}catch{return true}});
 const bank=useMemo(()=>banks.find(x=>x.id===bankId)||banks.find(x=>x.is_default)||banks[0],[banks,bankId]);
 const load=useCallback(async()=>{
  setLoading(true); setLoadError('');
  try {
   const [w,b]=await withTimeout(Promise.all([
    supabase.from('wallets').select('id,available_balance,pending_balance,frozen_balance,total_withdrawn,is_frozen,frozen_reason').eq('owner_id',profile.user_id).eq('owner_type','worker').maybeSingle(),
    supabase.from('bank_accounts').select('id,bank_name,account_number,account_name,is_default').eq('user_id',profile.user_id).eq('is_active',true).not('verified_at','is',null).order('is_default',{ascending:false}),
   ]),10000,'Wallet took too long to load');
   if(w.error||b.error) throw new Error('Your wallet and payout account could not be loaded.');
   if(w.data&&!validWalletSnapshot(w.data,'id'))throw new Error('Wallet balances could not be confirmed.');
   setWallet((w.data||null) as Wallet|null); setBanks((b.data||[]) as Bank[]);
   setBankId(previous=>b.data?.some(row=>row.id===previous)?previous:b.data?.[0]?.id||'');
   if(!w.data){setRows([]);return}
   const [t,d]=await withTimeout(Promise.all([
    supabase.from('wallet_transactions').select('id,description,transaction_type,created_at,amount,reference_id').eq('wallet_id',w.data.id).order('created_at',{ascending:false}).limit(30),
    supabase.from('withdrawals').select('id,amount,status,created_at').eq('wallet_id',w.data.id).order('created_at',{ascending:false}).limit(20),
   ]),10000,'Wallet activity took too long to load');
   if(t.error||d.error) throw new Error('Your wallet activity could not be loaded.');
   setRows(walletActivity(t.data||[],d.data||[]));
  } catch { setWallet(null);setRows([]);setLoadError('Your wallet could not be loaded. Check your connection and try again.'); }
  finally {setLoading(false)}
 },[profile.user_id]);
 const withdrawal=useWalletWithdrawal(profile.user_id,'worker',async()=>{setAmount('');setView('activity');await load()});
 const submitting=withdrawal.busy;
 const pendingNotice=<WalletWithdrawalNotice {...withdrawal}/>;
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{try{localStorage.setItem(amountKey,String(show))}catch{}},[amountKey,show]);
 function withdraw(){if(!wallet)return;const n=Number(amount);if(!n||n<=0)return toast.error("Enter a valid amount");if(n>Number(wallet.available_balance||0))return toast.error("Insufficient available balance");if(!bank)return toast.error("Connect a withdrawal account first");if(wallet.is_frozen)return toast.error(wallet.frozen_reason||"Wallet is unavailable");setConfirming(true)}
 async function doWithdraw(){setConfirming(false);if(!wallet||!bank)return;await withdrawal.submit(Number(amount),bank.id)}
 if(loading)return <Loading/>;if(loadError)return <section role="alert" className="rounded-2xl border border-red-500/20 p-5 text-sm">{pendingNotice}<p>{loadError}</p><button type="button" onClick={()=>void load()} className="mt-3 min-h-11 rounded-xl border px-3">Try again</button></section>;if(!wallet)return <div className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-5 text-xs text-amber-800 dark:text-amber-300">Your wallet will appear when your first job payment is recorded.</div>;
 const display=(n:number)=>show?money(n):`${currencySymbol('NGN')}••••••`;
 if(view==="withdraw")return <div className="space-y-4">{pendingNotice}<WithdrawalConfirmDialog open={confirming} email={profile.email} onVerified={()=>void doWithdraw()} onCancel={()=>setConfirming(false)}/><Back title="Withdraw earnings" back={()=>setView("wallet")}/><section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.1] to-[var(--wh-surface)] p-5"><p className="text-xs uppercase tracking-[.16em] text-[var(--wh-text-muted)]">Available</p><p className="mt-2 text-3xl font-bold">{display(wallet.available_balance)}</p><label className="mt-5 block"><span className="mb-1 block text-xs text-[var(--wh-text-muted)]">Amount</span><input inputMode="numeric" value={amount} onChange={e=>setAmount(e.target.value.replace(/[^0-9]/g,""))} className="h-12 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-lg font-semibold outline-none" placeholder="0"/></label><div className="mt-4"><p className="mb-2 text-xs text-[var(--wh-text-muted)]">Send to</p>{banks.length?banks.map(x=><button key={x.id} onClick={()=>setBankId(x.id)} className={`mb-2 flex w-full items-center gap-3 rounded-xl border p-3 text-left ${bank?.id===x.id?"border-violet-500/35 bg-violet-500/[.08]":"border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)]"}`}><BankLogo name={x.bank_name}/><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{x.bank_name}</span><span className="mt-1 block truncate text-xs text-[var(--wh-text-muted)]">•••• {x.account_number.slice(-4)} · {x.account_name}</span></span></button>):<p className="rounded-xl border border-dashed border-[var(--wh-border-subtle)] p-4 text-xs text-[var(--wh-text-muted)]">Add a verified payout account above before withdrawing.</p>}</div><button onClick={()=>void withdraw()} disabled={submitting||Boolean(withdrawal.pending)||Boolean(withdrawal.storageError)||!amount||!bank} className="mt-3 h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">{submitting?"Submitting…":"Request withdrawal"}</button></section></div>;
 if(view==="activity")return <div className="space-y-4">{pendingNotice}<Back title="Wallet activity" back={()=>setView("wallet")}/><Activity rows={rows} show={show}/></div>;
 return <div className="space-y-4">{pendingNotice}<section className="overflow-hidden rounded-3xl border border-violet-500/20 bg-gradient-to-br from-violet-600/30 via-violet-500/10 to-[var(--wh-surface)] p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--wh-text-secondary)]">Available balance</p><p className="mt-2 text-3xl font-bold">{display(wallet.available_balance)}</p><p className="mt-2 text-xs text-[var(--wh-text-secondary)]">Completed job earnings ready to withdraw</p></div><button onClick={()=>setShow(x=>!x)} aria-label={show?"Hide amounts":"Show amounts"} className="grid h-11 w-11 place-items-center rounded-full border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)]">{show?<Eye/>:<EyeOff/>}</button></div>{wallet.is_frozen?<p className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-200">{wallet.frozen_reason||"Wallet temporarily unavailable"}</p>:null}<div className="mt-6 grid grid-cols-3 gap-2"><Mini label="Payment protected" value={display(wallet.pending_balance)}/><Mini label="Payout processing" value={display(wallet.frozen_balance)}/><Mini label="Withdrawn" value={display(wallet.total_withdrawn)}/></div></section><section className="grid grid-cols-2 gap-3"><Action title="Withdraw" detail="Send available funds" icon="↓" onClick={()=>setView("withdraw")}/><Action title="Activity" detail="See every movement" icon="↗" onClick={()=>setView("activity")}/></section><section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold">Recent activity</p><p className="mt-1 text-xs text-[var(--wh-text-muted)]">Latest Worker earnings and withdrawals</p></div>{rows.length>3?<button onClick={()=>setView("activity")} className="text-xs text-violet-700 dark:text-violet-300">View all</button>:null}</div>{rows.length?<div className="mt-3 divide-y divide-[var(--wh-border-subtle)]">{rows.slice(0,3).map(x=><MovementRow key={x.id} row={x} show={show}/>)}</div>:<p className="py-8 text-center text-xs text-[var(--wh-text-muted)]">No wallet activity yet.</p>}</section></div>
}
function Back({title,back}:{title:string;back:()=>void}){return <div className="flex items-center gap-3"><button onClick={back} className="grid h-11 w-11 place-items-center rounded-xl border border-[var(--wh-border-subtle)]">←</button><h2 className="text-sm font-semibold">{title}</h2></div>}
function Mini({label,value}:{label:string;value:string}){return <div className="rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] p-3"><p className="text-xs uppercase text-[var(--wh-text-secondary)]">{label}</p><p className="mt-1 truncate text-xs font-semibold">{value}</p></div>}
function Action({title,detail,icon,onClick}:{title:string;detail:string;icon:string;onClick:()=>void}){return <button onClick={onClick} className="flex min-h-20 items-center gap-3 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 text-left"><span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300">{icon}</span><span><span className="block text-xs font-semibold">{title}</span><span className="mt-1 block text-xs text-[var(--wh-text-muted)]">{detail}</span></span></button>}
function Activity({rows,show}:{rows:Movement[];show:boolean}){return <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">{rows.length?<div className="divide-y divide-[var(--wh-border-subtle)]">{rows.map(x=><MovementRow key={x.id} row={x} show={show}/>)}</div>:<p className="py-10 text-center text-xs text-[var(--wh-text-muted)]">No wallet activity yet.</p>}</section>}
function MovementRow({row,show}:{row:Movement;show:boolean}){const n=Number(row.amount||0);return <div className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-xs font-medium">{row.title}</p><p className="mt-1 text-xs capitalize text-[var(--wh-text-muted)]">{new Date(row.date).toLocaleDateString()} · {friendly(row.status)}</p></div><p className={`shrink-0 text-xs font-semibold ${n<0?"text-red-300":"text-emerald-300"}`}>{show?`${n<0?"-":"+"}${money(Math.abs(n))}`:"••••"}</p></div>}
function BankLogo({name}:{name:string}){return <span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-500/10 text-xs font-bold text-violet-200">{name.slice(0,2).toUpperCase()}</span>}
function Loading(){return <WeHouseLoadingState compact label="Loading" />}
function friendly(v:string){return String(v||"").replace(/_/g," ")}
function Eye(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>}
function EyeOff(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m3 3 18 18"/><path d="M10.6 5.2A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-2.1 3.1M6.6 6.6C3.6 8.6 2 12 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>}
