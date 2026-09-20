import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useRpcRead } from "@/hooks/useRpcRead";
import MediaViewer from "@/components/MediaViewer";

type Role = "worker" | "property_partner";
type Row = { user_id:string;account_role:Role;full_name?:string|null;username?:string|null;state?:string|null;local_government?:string|null;city?:string|null;submitted_at?:string|null };
type Evidence = { status?:string|null;photo_path?:string|null;face_match_score?:number|null;liveness_score?:number|null;anti_spoof_score?:number|null;attempt_count?:number|null };

export default function AccountIdentityReviewQueue({ accountRole }: { accountRole: Role }) {
  const [selected,setSelected]=useState<Row|null>(null),[evidence,setEvidence]=useState<Evidence|null>(null),[url,setUrl]=useState(""),[notes,setNotes]=useState(""),[reason,setReason]=useState(""),[saving,setSaving]=useState(false),[viewer,setViewer]=useState(false);
  const label=accountRole==="property_partner"?"Property Partner":"Worker";
  const { data, loading, error, refresh: load } = useRpcRead<Row[]>("get_my_account_identity_review_queue", accountRole);
  const rows = (data || []).filter(row => row.account_role === accountRole);
  async function open(row:Row){setSelected(row);setEvidence(null);setUrl("");setNotes("");setReason("");const{data,error}=await supabase.rpc("get_review_account_identity_check",{p_user_id:row.user_id});if(error)return toast.error(error.message);const next=(data||null) as Evidence|null;setEvidence(next);if(next?.photo_path){const signed=await supabase.storage.from("worker-identity-private").createSignedUrl(next.photo_path,300);if(signed.error)toast.error("Private reference could not be opened");else setUrl(signed.data?.signedUrl||"")}}
  async function decide(decision:"approved"|"rejected"){if(!selected)return;if(decision==="rejected"&&!reason.trim())return toast.error("Enter the rejection reason");setSaving(true);const{error}=await supabase.rpc("review_account_identity_check",{p_user_id:selected.user_id,p_decision:decision,p_notes:decision==="rejected"?reason.trim():notes.trim()||null});setSaving(false);if(error)return toast.error(error.message);toast.success(decision==="approved"?`${label} identity approved`:`${label} identity returned with a reason`);setSelected(null);setEvidence(null);setUrl("");void load()}
  if(selected)return <section className="rounded-3xl border border-violet-500/15 bg-[#10131B] p-4 sm:p-5">
    <button type="button" onClick={()=>setSelected(null)} className="text-[10px] font-semibold text-violet-300">← Identity queue</button>
    <p className="mt-4 text-[8px] font-bold uppercase tracking-[.16em] text-violet-300">PRIVATE {label.toUpperCase()} IDENTITY REVIEW</p>
    <h3 className="mt-2 text-lg font-bold">{selected.full_name||selected.username||label}</h3>
    <p className="mt-1 text-[10px] text-[#747A8B]">{[selected.local_government||selected.city,selected.state].filter(Boolean).join(", ")||"Location not supplied"}</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-white/[.06] bg-black/10 p-4"><p className="text-xs font-semibold">Private face reference</p>{url?<button type="button" onClick={()=>setViewer(true)} className="mt-3 block overflow-hidden rounded-xl"><img src={url} alt="Private identity reference" className="aspect-square w-36 object-cover"/></button>:<p className="mt-3 text-[10px] text-[#666D7E]">Reference unavailable</p>}</div>
      <div className="rounded-2xl border border-white/[.06] bg-black/10 p-4"><p className="text-xs font-semibold">Screening evidence</p><p className="mt-1 text-[9px] leading-4 text-[#747A8B]">Browser scores help screening but cannot approve the account. Compare the private reference and complete the WeHouse manual review.</p><div className="mt-3 grid grid-cols-2 gap-2"><Metric label="Face" value={score(evidence?.face_match_score)}/><Metric label="Liveness" value={score(evidence?.liveness_score)}/><Metric label="Anti-spoof" value={score(evidence?.anti_spoof_score)}/><Metric label="Attempts" value={String(evidence?.attempt_count||0)}/></div></div>
    </div>
    <textarea value={notes} onChange={event=>setNotes(event.target.value)} rows={2} placeholder="Approval notes (optional)" className="mt-3 w-full rounded-xl border border-white/[.08] bg-black/20 p-3 text-xs outline-none"/>
    <input value={reason} onChange={event=>setReason(event.target.value)} placeholder="Reason required when rejecting" className="mt-2 h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-xs outline-none"/>
    <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={saving||evidence?.status!=="pending_review"} onClick={()=>void decide("approved")} className="min-h-11 rounded-xl bg-violet-500 text-[10px] font-semibold disabled:opacity-35">Approve identity</button><button type="button" disabled={saving} onClick={()=>void decide("rejected")} className="min-h-11 rounded-xl bg-red-500/15 text-[10px] font-semibold text-red-300 disabled:opacity-35">Reject with reason</button></div>
    {viewer&&url?<MediaViewer src={url} kind="image" title="Private identity reference" onClose={()=>setViewer(false)}/>:null}
  </section>;
  if (loading) return <p role="status" className="py-3 text-xs text-[#9298A6]">Checking pending reviews…</p>;
  if (error) return <section role="alert" className="rounded-xl border border-amber-500/20 p-4"><p className="text-sm text-amber-100">Identity review queue could not be loaded.</p><button type="button" onClick={() => void load()} className="min-h-11 text-sm text-violet-300">Try again</button></section>;
  if (rows.length === 0) return null;
  return <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4 sm:p-5"><div><h3 className="text-sm font-semibold">{label} identity reviews</h3><p className="mt-1 text-[9px] leading-4 text-[#707687]">A different authorised person must review each private live-check submission.</p></div>{loading?<p className="py-6 text-center text-[10px] text-[#666D7E]">Loading…</p>:rows.length===0?<p className="mt-4 border-t border-white/[.05] pt-4 text-[10px] text-[#666D7E]">No {label.toLowerCase()} identity check is waiting.</p>:<div className="mt-3 divide-y divide-white/[.06] border-y border-white/[.06]">{rows.map(row=><button type="button" key={row.user_id} onClick={()=>void open(row)} className="flex w-full items-center justify-between gap-3 py-3 text-left"><span className="min-w-0"><strong className="block truncate text-xs">{row.full_name||row.username||label}</strong><span className="mt-1 block truncate text-[9px] text-[#707687]">{[row.local_government||row.city,row.state].filter(Boolean).join(", ")||"Location not supplied"}</span></span><span className="text-[9px] font-semibold text-violet-300">Review →</span></button>)}</div>}</section>;
}
function Metric({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-white/[.035] p-2.5"><p className="text-[8px] uppercase text-[#666D7E]">{label}</p><p className="mt-1 text-[10px] font-semibold">{value}</p></div>}
function score(value?:number|null){return value==null?"—":`${Math.round(Number(value)*100)}%`}
