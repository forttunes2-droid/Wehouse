import {useEffect,useRef,useState} from 'react';
import {listMyCompanions,sendCompanionRequestByUsername,respondToCompanionRequest,friendlyFriendMessage,type Companion} from '@/lib/supabase/companions';
import {createSharedShortLet,type SharedHousingGroup} from '@/lib/supabase/shared-housing';
import {shortLetPayment} from '@/lib/shortLetPayment';
import {sharedAmounts} from '@/lib/sharedHousingPresentation';
import {withTimeout} from '@/lib/withTimeout';
import {ChevronDown, Users} from 'lucide-react';
const money=(n:number)=>`₦${n.toLocaleString('en-NG',{minimumFractionDigits:0,maximumFractionDigits:2})}`;
type Row=Parameters<typeof shortLetPayment>[0]&{id:string;guest_count?:number;status?:string;payment_reference?:unknown;rent_payment_reference?:unknown;shared_payment_group_id?:unknown;payment_expires_at?:string;reservation_fee_status?:string;manual_payment_status?:string;short_stay_balance_due_at?:string;rent_payment_status?:string};
export default function ShortLetSplitCosts({row,userId,onCreated}:{row:Row;userId:string;onCreated:(group:SharedHousingGroup)=>void}) {
  const [open,setOpen]=useState(false),[people,setPeople]=useState<Companion[]>([]),[ids,setIds]=useState<string[]>([]);
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const generation=useRef(0), inFlight=useRef(false);
  const bill=shortLetPayment(row), capacity=Math.min(Number(row.guest_count||0),3),[username,setUsername]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{const current=++generation.current;setPeople([]);setIds([]);setError('');if(!open)return;
    setLoading(true);
    void withTimeout(listMyCompanions(),15000,'Friends took too long.').then(result=>{
      if(current!==generation.current)return;
      if(result.error)throw result.error;
      setPeople(result.companions);
    }).catch(()=>{if(current===generation.current)setError('Friends could not be loaded. Please refresh.');}).finally(()=>{if(current===generation.current)setLoading(false);});
    return()=>{generation.current+=1;};
  },[open,userId,row.id,attempt]);
  const accepted=people.filter(person=>person.status==='accepted'),waiting=people.filter(person=>person.status==='pending');
  const chosen=ids.map(id=>accepted.find(person=>person.user_id===id)).filter((person):person is Companion=>Boolean(person));
  const nameOf=(person:Companion)=>person.full_name||person.username||'WeHouse member';
  async function addCompanion(){
    const name=username.trim().replace(/^@/,'');if(!name||busy)return;
    setError('');setNotice('');
    const result=await sendCompanionRequestByUsername(name);
    if(result.error){setError('That person cannot receive a friend request.');return;}
    setUsername('');setNotice('Request sent. They must accept before you can invite them.');setAttempt(n=>n+1);
  }
  async function answer(person:Companion,accept:boolean){
    setError('');const result=await respondToCompanionRequest(person.companion_id,accept);
    if(result.error){setError('That request could not be updated. Refresh and try again.');return;}
    setAttempt(n=>n+1);
  }
  const shares=bill&&chosen.length ? sharedAmounts(bill.rent,bill.deposit,chosen.length+1):null;
  async function create(){
    if(!bill||!chosen.length||chosen.length+1>capacity||busy||inFlight.current)return;
    inFlight.current=true;setBusy(true);setError('');const current=generation.current;
    try{const result=await withTimeout(createSharedShortLet(row.id,chosen.map(person=>person.user_id)),20000,'The invitation could not be confirmed. Refresh this booking before retrying.');
      if(result.error||!result.group?.id||result.group.reservation_id!==row.id)throw result.error||new Error('The shared reservation could not be confirmed.');
      if(current===generation.current)onCreated(result.group);
    }catch(failure){if(current===generation.current)setError(friendlyFriendMessage(failure instanceof Error?failure.message:String((failure as {message?:string})?.message||'Invitation could not be confirmed. Refresh before retrying.')));}
    finally{inFlight.current=false;if(current===generation.current)setBusy(false);}
  }
  const reserveDatePaid=row.reservation_fee_status==='paid'||['paid','completed'].includes(String(row.manual_payment_status||''));
  const balanceDeadline=row.short_stay_balance_due_at?new Date(row.short_stay_balance_due_at).getTime():0;
  if(!bill||capacity<2||!reserveDatePaid||!['reserved','ready_for_move_in'].includes(String(row.status||''))||!balanceDeadline||balanceDeadline<=Date.now()||row.rent_payment_status==='payment_pending'||row.rent_payment_status==='paid'||row.rent_payment_reference||row.shared_payment_group_id)return null;
  return <section className="mt-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 shadow-[var(--wh-shadow-sm)]" aria-label="Share Short Let stay">
    <button type="button" disabled={busy} onClick={()=>setOpen(v=>!v)} aria-expanded={open} className="flex min-h-12 w-full items-center gap-3 text-left disabled:opacity-50">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-300"><Users size={18} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Share this stay</span><span className="mt-0.5 block text-xs leading-4 text-[var(--wh-text-secondary)]">Pay together with companions you trust (up to 3 people paying)</span></span>
      <ChevronDown size={18} aria-hidden="true" className={`shrink-0 text-violet-300 ${open?'rotate-180':''}`} />
    </button>
    {open&&<div className="mt-4 space-y-4 border-t border-[var(--wh-border-subtle)] pt-4">
      <p className="text-xs leading-5 text-[var(--wh-text-secondary)]">Your Reserve date fee is already paid. Invite accepted friends to join the same reservation. The stay is shared; each participant completes the amount assigned to them before the reservation is confirmed.</p>
      <p className="text-xs font-medium text-[var(--wh-text-secondary)]">{chosen.length+1} participants · up to {row.guest_count} reserved guests</p>
      {error&&<div role="alert" className="text-sm leading-6 text-amber-200"><p>{error}</p><button type="button" disabled={busy} onClick={()=>setAttempt(n=>n+1)} className="min-h-11 font-semibold underline">Refresh friends</button></div>}
      {loading?<p role="status" className="text-sm">Loading your friends…</p>:<div className="divide-y divide-[var(--wh-border-subtle)]">{accepted.map(person=><label key={person.user_id} className="flex min-h-16 items-center gap-3 py-3">
        <input type="checkbox" aria-label={`Invite ${nameOf(person)}`} checked={ids.includes(person.user_id)} disabled={busy||(!ids.includes(person.user_id)&&ids.length>=capacity-1)} onChange={e=>setIds(current=>e.target.checked?[...current,person.user_id]:current.filter(id=>id!==person.user_id))} className="h-5 w-5 shrink-0"/>
        <span className="min-w-0"><span className="block break-words text-base font-medium">{nameOf(person)}</span>{person.username&&<span className="block break-words text-sm text-[var(--wh-text-secondary)]">@{person.username}</span>}</span>
      </label>)}{waiting.map(person=><div key={person.user_id} className="flex min-h-14 items-center gap-3 py-3 text-sm"><span className="min-w-0 flex-1 break-words">{nameOf(person)}</span>{person.requested_by_me?<span className="text-[var(--wh-text-secondary)]">Waiting for them to accept</span>:<span className="flex gap-2"><button type="button" onClick={()=>void answer(person,true)} className="min-h-11 font-semibold underline">Accept</button><button type="button" onClick={()=>void answer(person,false)} className="min-h-11 underline">Decline</button></span>}</div>)}</div>}
      {!loading&&!people.length&&!error&&<p className="text-sm leading-6 text-[var(--wh-text-secondary)]">You have no friends yet. Add someone you already know by their WeHouse username. Friends are separate from Roommates.</p>}
      <div className="flex items-center gap-2"><input value={username} onChange={e=>setUsername(e.target.value)} aria-label="Friend username" placeholder="Their WeHouse username" maxLength={40} className="min-h-12 min-w-0 flex-1 rounded-xl border border-[var(--wh-border-subtle)] bg-transparent px-3 text-sm"/><button type="button" disabled={busy||!username.trim()} onClick={()=>void addCompanion()} className="min-h-12 shrink-0 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold disabled:opacity-40">Add friend</button></div>
      {notice&&<p role="status" className="text-sm leading-6 text-emerald-300">{notice}</p>}
      {shares&&<div className="space-y-3 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] p-3"><h4 className="text-xs font-semibold uppercase tracking-wide text-violet-300">Shared reservation</h4>{shares.map((share,index)=><div key={index} className="text-xs leading-5"><div className="flex items-start justify-between gap-3"><strong className="min-w-0 break-words">{index===0?'You':nameOf(chosen[index-1])}</strong><strong className="shrink-0">{money(share.total)}</strong></div><p className="text-[var(--wh-text-secondary)]">Stay {money(share.rent)} · Caution fee {share.deposit?money(share.deposit):'not required'}</p></div>)}<p className="border-t border-[var(--wh-border-subtle)] pt-2 text-xs leading-5 text-[var(--wh-text-secondary)]">These amounts come from the reservation. Each participant sees their assigned amount before completing payment.</p></div>}
      <button type="button" disabled={busy||!shares||loading} onClick={()=>void create()} className="min-h-12 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold disabled:opacity-40">{busy?'Preparing invitation…':'Invite people'}</button>
    </div>}
  </section>;
}
