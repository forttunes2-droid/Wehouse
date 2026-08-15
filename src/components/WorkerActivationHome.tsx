import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Props = { profile: Profile; onProfile: () => void; onVerification: () => void };
type Activation = { worker_status: string; live: boolean; profile_complete: boolean; gold_badge: boolean; test_passed: boolean; evidence_saved: boolean; submitted: boolean; rejection_reason: string | null };

export default function WorkerActivationHome({ profile, onProfile, onVerification }: Props) {
  const [data, setData] = useState<Activation | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void (async () => { const { data: activation, error: activationError } = await supabase.rpc('get_my_worker_activation'); if (activationError) { setError(activationError.message); return; } setData(activation as Activation); setError(''); })(); }, [profile.user_id, profile.worker_status, profile.worker_verified]);
  if (error) return <State text={error} />;
  if (!data) return <State text="Loading…" />;
  const verificationDone = data.gold_badge && data.test_passed && data.evidence_saved;
  const underReview = data.worker_status === 'profile_under_review' || data.submitted;
  const live = data.live || data.worker_status === 'verified';
  const stages = [{ label: 'Work profile', done: data.profile_complete }, { label: 'Work verification', done: verificationDone }, { label: 'WeHouse review', done: live }];
  const complete = stages.filter((stage) => stage.done).length;
  let title = 'Set up your work profile', note = 'Tell customers what you do, your experience and where you work.', action = onProfile, actionLabel = 'Complete work profile';
  if (live) { title = 'Your services are live'; note = 'Customers can now find your professional profile.'; action = onProfile; actionLabel = 'View professional profile'; }
  else if (underReview) { title = 'Review in progress'; note = 'WeHouse is reviewing your work evidence. No action is needed right now.'; action = onVerification; actionLabel = 'View review status'; }
  else if (data.profile_complete && verificationDone) { title = 'Ready for WeHouse review'; note = 'Your work checks are complete. Send them for final review.'; action = onVerification; actionLabel = 'Submit for review'; }
  else if (data.profile_complete) { title = 'Verify your work'; note = 'Complete the verification payment, skill check and one short work video.'; action = onVerification; actionLabel = 'Continue work verification'; }
  return <div className="space-y-3"><section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.09] via-[#12141C] to-[#0F1218] p-4 sm:p-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">GET READY TO WORK</p><h2 className="mt-2 text-xl font-bold leading-tight">{title}</h2><p className="mt-1 max-w-md text-[10px] leading-relaxed text-[#747B8B]">{note}</p></div><div className="shrink-0 rounded-2xl border border-white/[.06] bg-black/10 px-3 py-2 text-center"><p className="text-lg font-bold">{complete}/3</p><p className="text-[8px] text-[#686F7F]">done</p></div></div><div className="mt-5 grid grid-cols-3 gap-2">{stages.map((stage,index)=>{const active=!stage.done&&stages.slice(0,index).every((item)=>item.done);return <div key={stage.label} className={`rounded-2xl border px-2 py-3 text-center ${stage.done?'border-emerald-500/15 bg-emerald-500/[.05]':active?'border-violet-500/20 bg-violet-500/[.06]':'border-white/[.05] bg-black/10'}`}><span className={`mx-auto grid h-7 w-7 place-items-center rounded-full text-[9px] font-bold ${stage.done?'bg-emerald-500 text-[#04120A]':active?'bg-violet-500 text-white':'bg-white/[.05] text-[#656C7B]'}`}>{stage.done?'✓':index+1}</span><p className={`mt-2 text-[8px] font-medium leading-tight ${stage.done?'text-emerald-300':active?'text-violet-200':'text-[#676E7E]'}`}>{stage.label}</p></div>})}</div><button onClick={action} className="mt-4 h-12 w-full rounded-2xl bg-violet-500 text-[11px] font-semibold text-white">{actionLabel}</button></section>{data.rejection_reason&&<section className="rounded-xl border border-red-500/20 bg-red-500/[.05] p-3"><p className="text-[9px] font-semibold text-red-200">Review feedback</p><p className="mt-1 text-[10px] text-red-100/70">{data.rejection_reason}</p></section>}</div>;
}
function State({ text }: { text: string }) { return <div className="grid min-h-36 place-items-center rounded-2xl border border-white/[.06] bg-[#0F131A] px-5 text-center text-xs text-[#747B8B]">{text}</div>; }
