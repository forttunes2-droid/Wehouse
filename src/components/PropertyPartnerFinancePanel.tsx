import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Finance = { available_balance:number; pending_balance:number; frozen_balance:number; total_withdrawn:number; total_earnings:number; commission_rate:number; minimum_withdrawal:number; is_frozen:boolean };
const money=(n:number)=>`₦${Number(n||0).toLocaleString('en-NG',{minimumFractionDigits:2})}`;
export default function PropertyPartnerFinancePanel({profile}:{profile:Profile}){
 const [f,setF]=useState<Finance|null>(null); const [tx,setTx]=useState<any[]>([]); const [wd,setWd]=useState<any[]>([]); const [loading,setLoading]=useState(true);
 async function load(){setLoading(true); const {data}=await supabase.rpc('get_my_property_partner_finance'); setF(data as Finance); const [{data:t},{data:w}]=await Promise.all([supabase.from('wallet_transactions').select('*').eq('user_id',profile.user_id).order('created_at',{ascending:false}).limit(10),supabase.from('withdrawals').select('id,amount,status,created_at,failed_reason,wallets!inner(owner_id)').eq('wallets.owner_id',profile.user_id).order('created_at',{ascending:false}).limit(10)]); setTx(t||[]);setWd(w||[]);setLoading(false)}
 useEffect(()=>{void load()},[profile.user_id]);
 if(loading)return <section className="rounded-2xl border border-white/5 bg-[#12121A]/60 p-4 text-xs text-[#8A8B9C]">Loading partner finances…</section>;
 if(!f)return <section className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-xs text-red-400">Unable to load partner finances.</section>;
 return <section className="rounded-2xl border border-violet-500/15 bg-[#12121A]/60 p-4 lg:p-5 space-y-4">
  <div><h3 className="text-sm font-semibold text-white">Property Partner Finance</h3><p className="text-[10px] text-[#8A8B9C] mt-1">Reservation fees belong to WeHouse. Partner earnings are net property income after commission.</p></div>
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">{[['Available',f.available_balance],['Pending',f.pending_balance],['Total earnings',f.total_earnings],['Withdrawn',f.total_withdrawn]].map(([l,v])=><div key={String(l)} className="rounded-xl bg-[#1A1A24] border border-white/5 p-3"><p className="text-[9px] uppercase text-[#5C5E72]">{l}</p><p className="text-sm font-bold text-white mt-1">{money(Number(v))}</p></div>)}</div>
  <div className="flex flex-wrap gap-3 text-[10px] text-[#8A8B9C]"><span>Commission: {f.commission_rate}%</span><span>Minimum withdrawal: {money(f.minimum_withdrawal)}</span>{f.frozen_balance>0&&<span>Held: {money(f.frozen_balance)}</span>}</div>
  <div className="grid md:grid-cols-2 gap-3"><div className="rounded-xl bg-[#0D0D14] p-3"><p className="text-xs font-semibold text-white mb-2">Recent transactions</p>{tx.length?tx.slice(0,5).map(x=><div key={x.id} className="flex justify-between py-1.5 text-[10px] border-b border-white/[.03]"><span className="text-[#8A8B9C]">{x.description}</span><span className="text-white">{money(x.amount)}</span></div>):<p className="text-[10px] text-[#5C5E72]">No earnings transactions yet.</p>}</div><div className="rounded-xl bg-[#0D0D14] p-3"><p className="text-xs font-semibold text-white mb-2">Withdrawals</p>{wd.length?wd.slice(0,5).map(x=><div key={x.id} className="flex justify-between py-1.5 text-[10px] border-b border-white/[.03]"><span className="text-[#8A8B9C] capitalize">{x.status}</span><span className="text-white">{money(x.amount)}</span></div>):<p className="text-[10px] text-[#5C5E72]">No withdrawals yet.</p>}</div></div>
 </section>
}