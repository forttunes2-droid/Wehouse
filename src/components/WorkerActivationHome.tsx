import { useEffect, useState } from 'react';
import WorkerVerificationChecklist from '@/components/WorkerVerificationChecklist';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Props = { profile: Profile; onProfile: () => void; onVerification: () => void };
type Activation = {
  worker_status: string;
  live: boolean;
  profile_complete: boolean;
  payment_confirmed?: boolean;
  gold_badge?: boolean;
  identity_passed: boolean;
  evidence_saved: boolean;
  submitted: boolean;
  rejection_reason: string | null;
};

export default function WorkerActivationHome({ profile, onProfile, onVerification }: Props) {
  const [data, setData] = useState<Activation | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const { data: activation, error: activationError } = await supabase.rpc('get_my_worker_activation');
      if (activationError) { setError(activationError.message); return; }
      setData(activation as Activation);
      setError('');
    })();
  }, [profile.user_id, profile.worker_status, profile.worker_verified]);

  if (error) return <State text={error} />;
  if (!data) return <State text="Loading…" />;

  const paymentDone = Boolean(data.payment_confirmed ?? data.gold_badge);
  const requirementsDone = [data.identity_passed, paymentDone, data.evidence_saved].filter(Boolean).length;
  const verificationDone = requirementsDone === 3;
  const underReview = data.worker_status === 'profile_under_review' || data.submitted;
  const live = data.live || data.worker_status === 'verified';

  if (!data.profile_complete) return <section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.09] via-[#12141C] to-[#0F1218] p-4 sm:p-5"><p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">LOCAL SERVICE WORKER</p><h2 className="mt-2 text-xl font-bold">Build your professional profile</h2><p className="mt-1 text-[10px] leading-relaxed text-[#747B8B]">Add your service, experience, price and work location first.</p><button onClick={onProfile} className="mt-4 h-12 w-full rounded-2xl bg-violet-500 text-[11px] font-semibold text-white">Complete professional profile</button></section>;

  if (live) return <section className="rounded-3xl border border-emerald-500/15 bg-emerald-500/[.04] p-4 sm:p-5"><p className="text-[9px] font-bold uppercase tracking-[.16em] text-emerald-300">WORKER VERIFIED</p><h2 className="mt-2 text-xl font-bold">You’re ready for customers</h2><p className="mt-1 text-[10px] text-[#747B8B]">Your Local Service professional profile is live on WeHouse.</p><button onClick={onProfile} className="mt-4 h-12 w-full rounded-2xl bg-violet-500 text-[11px] font-semibold text-white">View professional profile</button></section>;

  if (underReview) return <section className="rounded-3xl border border-violet-500/15 bg-[#11151D] p-4 sm:p-5"><p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">WEHOUSE REVIEW</p><h2 className="mt-2 text-xl font-bold">Review in progress</h2><p className="mt-1 text-[10px] text-[#747B8B]">WeHouse is reviewing your real professional work evidence.</p><button onClick={onVerification} className="mt-4 h-12 w-full rounded-2xl border border-white/[.08] bg-white/[.03] text-[11px] font-semibold text-white">View status</button></section>;

  return <div className="space-y-3">
    <section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.09] via-[#12141C] to-[#0F1218] p-4 sm:p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">LOCAL SERVICE WORKER</p><h2 className="mt-2 text-xl font-bold">{verificationDone?'Ready for WeHouse review':'Finish verification'}</h2><p className="mt-1 text-[10px] text-[#747B8B]">{verificationDone?'Your verification requirements are complete.':'Complete the three verification requirements below.'}</p></div><div className="shrink-0 rounded-2xl border border-white/[.06] bg-black/10 px-3 py-2 text-center"><p className="text-lg font-bold">{requirementsDone}/3</p><p className="text-[8px] text-[#686F7F]">complete</p></div></div></section>
    <WorkerVerificationChecklist identityPassed={data.identity_passed} paymentConfirmed={paymentDone} skillVideoSaved={data.evidence_saved}/>
    <button onClick={onVerification} className="h-12 w-full rounded-2xl bg-violet-500 text-[11px] font-semibold text-white">{verificationDone?'Submit for WeHouse review':'Continue verification'}</button>
    {data.rejection_reason&&<section className="rounded-xl border border-red-500/20 bg-red-500/[.05] p-3"><p className="text-[9px] font-semibold text-red-200">Review feedback</p><p className="mt-1 text-[10px] text-red-100/70">{data.rejection_reason}</p></section>}
  </div>;
}

function State({ text }: { text: string }) { return <div className="grid min-h-36 place-items-center rounded-2xl border border-white/[.06] bg-[#0F131A] px-5 text-center text-xs text-[#747B8B]">{text}</div>; }
