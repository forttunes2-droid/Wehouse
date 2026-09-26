import {useEffect,useRef,useState} from 'react';
import {getConversations,getRoommateConversationPeople} from '@/lib/supabase/chat';
import {selectRoommateRecipients,type RoommateRecipient} from '@/lib/roommateRecipients';
import {createSharedShortLet,type SharedHousingGroup} from '@/lib/supabase/shared-housing';
import {shortLetPayment} from '@/lib/shortLetPayment';
import {sharedAmounts} from '@/lib/sharedHousingPresentation';
import {withTimeout} from '@/lib/withTimeout';
const money=(n:number)=>`₦${n.toLocaleString('en-NG',{minimumFractionDigits:0,maximumFractionDigits:2})}`;
type Row=Parameters<typeof shortLetPayment>[0]&{id:string;guest_count?:number;status?:string;payment_reference?:unknown;rent_payment_reference?:unknown;shared_payment_group_id?:unknown;payment_expires_at?:string;reservation_fee_status?:string;manual_payment_status?:string;short_stay_balance_due_at?:string;rent_payment_status?:string};
export default function ShortLetSplitCosts({row,userId,onCreated}:{row:Row;userId:string;onCreated:(group:SharedHousingGroup)=>void}) {
  const [open,setOpen]=useState(false),[people,setPeople]=useState<RoommateRecipient[]>([]),[ids,setIds]=useState<string[]>([]);
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const generation=useRef(0), inFlight=useRef(false);
  const bill=shortLetPayment(row), capacity=Math.min(Number(row.guest_count||0),12);
  useEffect(()=>{const current=++generation.current;setPeople([]);setIds([]);setError('');if(!open)return;
    setLoading(true);
    void withTimeout(Promise.all([getConversations(userId),getRoommateConversationPeople()]),15000,'Connections took too long.').then(([chats,peers])=>{
      if(current!==generation.current)return;
      if(chats.error||peers.error)throw new Error('Connections could not be loaded.');
      const result=selectRoommateRecipients(userId,chats.conversations,peers.people);setPeople(result.recipients);
      if(result.missingIdentityCount)setError('Some names could not be loaded. Refresh before selecting those people.');
    }).catch(()=>{if(current===generation.current)setError('Connections could not be loaded. Please refresh.');}).finally(()=>{if(current===generation.current)setLoading(false);});
    return()=>{generation.current+=1;};
  },[open,userId,row.id,attempt]);
  const chosen=ids.map(id=>people.find(person=>person.conversationId===id)).filter((person):person is RoommateRecipient=>Boolean(person));
  const shares=bill&&chosen.length ? sharedAmounts(bill.rent,bill.deposit,chosen.length+1):null;
  async function create(){
    if(!bill||!chosen.length||chosen.length+1>capacity||busy||inFlight.current)return;
    inFlight.current=true;setBusy(true);setError('');const current=generation.current;
    try{const result=await withTimeout(createSharedShortLet(row.id,chosen.map(person=>person.conversationId)),20000,'The invitation could not be confirmed. Refresh this booking before retrying.');
      if(result.error||!result.group?.id||result.group.reservation_id!==row.id)throw result.error||new Error('The shared reservation could not be confirmed.');
      if(current===generation.current)onCreated(result.group);
    }catch(failure){if(current===generation.current)setError(failure instanceof Error?failure.message:String((failure as {message?:string})?.message||'Invitation could not be confirmed. Refresh before retrying.'));}
    finally{inFlight.current=false;if(current===generation.current)setBusy(false);}
  }
  const reserveDatePaid=row.reservation_fee_status==='paid'||['paid','completed'].includes(String(row.manual_payment_status||''));
  const balanceDeadline=row.short_stay_balance_due_at?new Date(row.short_stay_balance_due_at).getTime():0;
  if(!bill||capacity<2||!reserveDatePaid||!['reserved','ready_for_move_in'].includes(String(row.status||''))||!balanceDeadline||balanceDeadline<=Date.now()||row.rent_payment_status==='payment_pending'||row.rent_payment_status==='paid'||row.rent_payment_reference||row.shared_payment_group_id)return null;
  return <section className="mt-4 border-t border-white/10 pt-4" aria-label="Split Short Let costs">
    <button type="button" disabled={busy} onClick={()=>setOpen(v=>!v)} aria-expanded={open} className="min-h-11 w-full rounded-xl border border-violet-400/25 px-4 py-3 text-sm font-semibold text-violet-300">{open?'Close cost sharing':'Split costs with connections'}</button>
    {open&&<div className="mt-4 space-y-4">
      <p className="text-sm leading-6 text-[#AAA3B3]">Reserve date is already paid by you. Choose people staying with you to split only the remaining stay charge and refundable deposit. Every person accepts and pays their own share.</p>
      <p className="text-sm">Reserved guests: {row.guest_count}. Paying people: {chosen.length+1}.</p>
      {error&&<div role="alert" className="text-sm leading-6 text-amber-200"><p>{error}</p><button type="button" disabled={busy} onClick={()=>setAttempt(n=>n+1)} className="min-h-11 font-semibold underline">Refresh connections</button></div>}
      {loading?<p role="status" className="text-sm">Loading your connections…</p>:<div className="divide-y divide-white/10">{people.map(person=><label key={person.userId} className="flex min-h-16 items-center gap-3 py-3">
        <input type="checkbox" aria-label={`Invite ${person.name}`} checked={ids.includes(person.conversationId)} disabled={busy||(!ids.includes(person.conversationId)&&ids.length>=capacity-1)} onChange={e=>setIds(current=>e.target.checked?[...current,person.conversationId]:current.filter(id=>id!==person.conversationId))} className="h-5 w-5 shrink-0"/>
        <span className="min-w-0"><span className="block break-words text-base font-medium">{person.name}</span>{person.username&&<span className="block break-words text-sm text-[#AAA3B3]">@{person.username}</span>}</span>
      </label>)}</div>}
      {!loading&&!people.length&&!error&&<p className="text-sm leading-6 text-[#AAA3B3]">No accepted connections are available. Connect with someone in Roommates first.</p>}
      {shares&&<div className="space-y-3 border-y border-white/10 py-4"><h4 className="text-base font-semibold">Proposed equal shares</h4>{shares.map((share,index)=><div key={index} className="text-sm leading-6"><strong>{index===0?'You':chosen[index-1].name}: {money(share.total)}</strong><p className="text-[#AAA3B3]">Stay {money(share.rent)} · Refundable deposit {share.deposit?money(share.deposit):'not required'}</p></div>)}<p className="text-sm leading-6 text-[#AAA3B3]">Shares may differ by ₦0.01 to match the booking total. Final shares use this reservation’s stored bill.</p></div>}
      <button type="button" disabled={busy||!shares||loading} onClick={()=>void create()} className="min-h-12 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold disabled:opacity-40">{busy?'Preparing invitation…':'Send cost-sharing invitation'}</button>
    </div>}
  </section>;
}
