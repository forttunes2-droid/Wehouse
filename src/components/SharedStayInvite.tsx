import {useEffect,useRef,useState} from 'react';
import {ChevronDown,Users} from 'lucide-react';
import {listMyFriends,type Friend} from '@/lib/supabase/friends';
import {sharedAmounts} from '@/lib/sharedHousingPresentation';
import {formatRecordedMoney} from '@/lib/regional';
import {withTimeout} from '@/lib/withTimeout';
import WeHouseLoadingState from '@/components/WeHouseLoadingState';

/** One guest picker for stay costs; the booking command owns eligibility and amounts. */
export default function SharedStayInvite({bookingKey,userId,guests,rent,deposit=0,kind,description,onInvite}:{
 bookingKey:string;userId:string;guests:number;rent:number;deposit?:number;kind:'Hotel'|'Short Let';description:string;
 onInvite:(friendIds:string[])=>Promise<void>;
}){
 const [open,setOpen]=useState(false),[friends,setFriends]=useState<Friend[]>([]),[ids,setIds]=useState<string[]>([]);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const generation=useRef(0),inFlight=useRef(false),capacity=Math.min(guests,3);
 useEffect(()=>{const current=++generation.current;setFriends([]);setIds([]);setError('');if(!open)return;
  setLoading(true);
  void withTimeout(listMyFriends(),15000,'Friends took too long.').then(result=>{
   if(current!==generation.current)return;if(result.error)throw result.error;setFriends(result.friends.filter(friend=>friend.status==='accepted'));
  }).catch(()=>{if(current===generation.current)setError('Friends could not be loaded. Please refresh.');})
   .finally(()=>{if(current===generation.current)setLoading(false);});
  return()=>{generation.current++;};
 },[open,userId,bookingKey,attempt]);
 const selected=ids.map(id=>friends.find(friend=>friend.user_id===id)).filter((friend):friend is Friend=>Boolean(friend));
 const shares=selected.length?sharedAmounts(rent,deposit,selected.length+1):null;
 const name=(friend:Friend)=>friend.full_name||friend.username||'WeHouse member';
 const money=(value:number)=>formatRecordedMoney(value,'NGN');
 async function invite(){
  if(inFlight.current||loading||!shares||selected.length+1>capacity||error)return;
  inFlight.current=true;setBusy(true);setError('');const current=generation.current;
  try{await withTimeout(onInvite(selected.map(friend=>friend.user_id)),20000,'The invitation result is unknown. Refresh this booking before retrying.');}
  catch(cause){if(current===generation.current)setError(cause instanceof Error?cause.message:String((cause as {message?:string})?.message||'The invitation could not be confirmed. Refresh this booking.'));}
  finally{inFlight.current=false;if(current===generation.current)setBusy(false);}
 }
 if(capacity<2)return null;
 return <section aria-label={`Share ${kind} stay`} className="mt-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 text-[var(--wh-text)]">
  <button type="button" disabled={busy} onClick={()=>setOpen(value=>!value)} aria-expanded={open} className="flex min-h-12 w-full items-center gap-3 text-left disabled:opacity-50">
   <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--wh-accent-surface)] text-[var(--wh-accent-text)]"><Users size={19} aria-hidden="true"/></span>
   <span className="flex-1"><span className="block text-sm font-semibold">Share this stay</span><span className="mt-1 block text-xs leading-5 text-[var(--wh-text-secondary)]">Pay with Friends joining you · up to 3 payers</span></span>
   <ChevronDown size={18} aria-hidden="true" className={`shrink-0 text-[var(--wh-text-secondary)] transition-transform motion-reduce:transition-none ${open?'rotate-180':''}`}/>
  </button>
  {open&&<div className="mt-4 space-y-4 border-t border-[var(--wh-border-subtle)] pt-4">
   <p className="text-sm leading-6 text-[var(--wh-text-secondary)]">{description}</p>
   <p className="text-xs leading-5 text-[var(--wh-text-secondary)]">Select only accepted Friends who will stay with you. Each person reviews their share and confirms they are joining. All shares must be verified before the original booking deadline; accepting an invitation does not extend it.</p>
   <p className="text-sm font-medium">{selected.length+1} paying guests · {guests} reserved guests</p>
   {error&&<div role="alert" className="space-y-1 text-sm leading-6"><p>{error}</p><button type="button" disabled={busy} onClick={()=>setAttempt(value=>value+1)} className="min-h-11 font-semibold underline">Refresh friends</button></div>}
   {loading?<WeHouseLoadingState compact label="Loading your friends"/>:<div className="divide-y divide-[var(--wh-border-subtle)]">{friends.map(friend=><label key={friend.user_id} className="flex min-h-16 items-center gap-3 py-3">
    <input type="checkbox" aria-label={`Invite ${name(friend)}`} checked={ids.includes(friend.user_id)} disabled={busy||!ids.includes(friend.user_id)&&ids.length>=capacity-1}
     onChange={event=>setIds(current=>event.target.checked?[...current,friend.user_id]:current.filter(id=>id!==friend.user_id))} className="h-5 w-5 shrink-0"/>
    <span className="min-w-0"><span className="block break-words text-sm font-medium">{name(friend)}</span>{friend.username&&<span className="block break-words text-xs text-[var(--wh-text-secondary)]">@{friend.username}</span>}</span>
   </label>)}</div>}
   {!loading&&!friends.length&&!error&&<p className="text-sm leading-6 text-[var(--wh-text-secondary)]">Add Friends in Inbox, then return here to share the stay.</p>}
   {shares&&<div className="space-y-3 rounded-xl bg-[var(--wh-interactive)] p-4"><h3 className="text-sm font-semibold">Payment shares</h3>{shares.map((share,index)=><div key={index} className="text-sm leading-6">
    <div className="flex items-start justify-between gap-3"><span className="min-w-0 break-words">{index===0?'You':name(selected[index-1])}</span><strong className="shrink-0">{money(share.total)}</strong></div>
    {deposit>0&&<p className="text-xs text-[var(--wh-text-secondary)]">Stay {money(share.rent)} · Caution fee {money(share.deposit)}</p>}
   </div>)}<p className="border-t border-[var(--wh-border-subtle)] pt-3 text-xs leading-5 text-[var(--wh-text-secondary)]">One booking, separate payments and receipts. If the checkout expires before all shares are verified, received payments enter refund processing to each original payment method.</p></div>}
   <button type="button" disabled={busy||!shares||loading||Boolean(error)} onClick={()=>void invite()} className="min-h-12 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy?'Preparing invitation…':'Invite people'}</button>
  </div>}
 </section>;
}
