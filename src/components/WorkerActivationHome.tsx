import { useEffect, useState } from 'react';
import WorkerVerificationChecklist from '@/components/WorkerVerificationChecklist';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Props = { profile: Profile; onProfile: () => void; onVerification: () => void };
type Activation = {
  worker_status: string;
  live: boolean;
  reviewed?: boolean;
  marketplace_enabled?: boolean;
  profile_complete: boolean;
  identity_required?: boolean;
  identity_gate_satisfied?: boolean;
  identity_captured?: boolean;
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

  const identityRequired = data.identity_required === true;
  const actualIdentityPassed = data.identity_captured === true && data.identity_passed === true;
  const identityGateSatisfied = data.identity_gate_satisfied ?? (!identityRequired || actualIdentityPassed);
  const requirements = [
    ...(identityRequired ? [identityGateSatisfied] : []),
    data.evidence_saved,
  ];
  const requirementsDone = requirements.filter(Boolean).length;
  const verificationDone = requirementsDone === requirements.length;
  const underReview = data.worker_status === 'profile_under_review' || (data.submitted && !['rejected','verified'].includes(data.worker_status));
  const reviewed = data.reviewed || data.worker_status === 'verified';

  if (underReview && identityGateSatisfied) return <section className="rounded-3xl border border-violet-500/15 bg-[#11151D] p-4 sm:p-5"><p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">WEHOUSE REVIEW</p><h2 className="mt-2 text-xl font-bold">Review in progress</h2><p className="mt-1 text-[10px] text-[#747B8B]">WeHouse is reviewing your professional evidence.</p><button onClick={onVerification} className="mt-4 h-12 w-full rounded-2xl border border-white/[.08] bg-white/[.03] text-[11px] font-semibold text-white">View status</button></section>;

  if (!data.profile_complete) return <section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.09] via-[#12141C] to-[#0F1218] p-4 sm:p-5"><p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">WEHOUSE SERVICES</p><h2 className="mt-2 text-xl font-bold">Set up your Service Provider profile</h2><p className="mt-1 text-[10px] leading-relaxed text-[#747B8B]">Add your service, experience, price and service area first. You can continue the remaining review steps afterward.</p><button onClick={onProfile} className="mt-4 h-12 w-full rounded-2xl bg-violet-500 text-[11px] font-semibold text-white">Continue Service Provider setup</button></section>;

  if (reviewed) return <section className="rounded-3xl border border-emerald-500/15 bg-emerald-500/[.04] p-4 sm:p-5"><p className="text-[9px] font-bold uppercase tracking-[.16em] text-emerald-300">WEHOUSE REVIEWED</p><h2 className="mt-2 text-xl font-bold">Your Service Provider review is complete</h2><p className="mt-1 text-[10px] text-[#747B8B]">{data.live?'Your Service Provider profile is live in WeHouse Services.':'Your review is complete. We’ll let you know when bookings open.'}</p><button onClick={onProfile} className="mt-4 h-12 w-full rounded-2xl bg-violet-500 text-[11px] font-semibold text-white">View Service Provider profile</button></section>;



  return <div className="space-y-3">
    <section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.09] via-[#12141C] to-[#0F1218] p-4 sm:p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">WEHOUSE SERVICES · SERVICE PROVIDER</p><h2 className="mt-2 text-xl font-bold">{verificationDone?'Ready for WeHouse review':'Complete your work profile'}</h2><p className="mt-1 text-[10px] text-[#747B8B]">{verificationDone?'Your free review requirements are complete.':'Complete the review requirements below. No onboarding payment is required.'}</p></div><div className="shrink-0 rounded-2xl border border-white/[.06] bg-black/10 px-3 py-2 text-center"><p className="text-lg font-bold">{requirementsDone}/{requirements.length}</p><p className="text-[8px] text-[#686F7F]">complete</p></div></div></section>
    <WorkerVerificationChecklist identityPassed={actualIdentityPassed} identityRequired={identityRequired} skillVideoSaved={data.evidence_saved}/>
    {!identityRequired && <section className="rounded-2xl border border-white/[.06] bg-white/[.025] px-4 py-3"><p className="text-[9px] leading-5 text-[#7E8595]">Identity verification is not currently required. Submit your work evidence for review.</p></section>}
    <button onClick={onVerification} className="h-12 w-full rounded-2xl bg-violet-500 text-[11px] font-semibold text-white">{verificationDone?'Submit for WeHouse review':'Continue setup'}</button>
    {data.rejection_reason&&<section className="rounded-xl border border-red-500/20 bg-red-500/[.05] p-3"><p className="text-[9px] font-semibold text-red-200">Review feedback</p><p className="mt-1 text-[10px] text-red-100/70">{data.rejection_reason}</p></section>}
  </div>;
}

function State({ text }: { text: string }) { return <div className="grid min-h-36 place-items-center rounded-2xl border border-white/[.06] bg-[#0F131A] px-5 text-center text-xs text-[#747B8B]">{text}</div>; }
