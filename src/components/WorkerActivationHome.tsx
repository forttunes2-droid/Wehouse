import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Props = { profile: Profile; onProfile: () => void; onVerification: () => void };
type Activation = {
  worker_status: string;
  live: boolean;
  profile_complete: boolean;
  gold_badge: boolean;
  test_passed: boolean;
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

  const skillsDone = data.test_passed && data.evidence_saved;
  const underReview = data.worker_status === 'profile_under_review' || data.submitted;
  const steps = [
    { label: 'Profile', done: data.profile_complete },
    { label: 'Gold Tick', done: data.gold_badge },
    { label: 'Skills', done: skillsDone },
    { label: 'Review', done: data.live },
  ];
  const complete = steps.filter((step) => step.done).length;

  let title = 'Complete your work profile';
  let note = 'Add your service, experience and work location.';
  let action = onProfile;
  let actionLabel = 'Complete profile';

  if (data.live) {
    title = 'You’re verified and live';
    note = 'Customers can find your professional profile.';
    action = onProfile;
    actionLabel = 'View professional profile';
  } else if (underReview) {
    title = 'Under WeHouse review';
    note = 'No action needed right now.';
    action = onVerification;
    actionLabel = 'View status';
  } else if (data.profile_complete && !data.gold_badge) {
    title = 'Get your Gold Tick';
    note = 'Confirm the verification payment.';
    action = onVerification;
    actionLabel = 'Continue';
  } else if (data.profile_complete && data.gold_badge && !skillsDone) {
    title = 'Complete your skill check';
    note = 'Finish readiness and add a short work video.';
    action = onVerification;
    actionLabel = 'Continue';
  } else if (data.profile_complete && data.gold_badge && skillsDone) {
    title = 'Ready for review';
    note = 'Submit your completed checks to WeHouse.';
    action = onVerification;
    actionLabel = 'Submit for review';
  }

  return (
    <div className="space-y-3">
      <section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.09] via-[#12141C] to-[#0F1218] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">WORKER VERIFICATION</p>
              {data.gold_badge && <span className="rounded-full border border-amber-400/20 bg-amber-400/[.08] px-2 py-1 text-[8px] font-bold text-amber-300">GOLD TICK</span>}
            </div>
            <h2 className="mt-2 text-xl font-bold">{title}</h2>
            <p className="mt-1 text-[10px] text-[#747B8B]">{note}</p>
          </div>
          <div className="shrink-0 rounded-2xl border border-white/[.06] bg-black/10 px-3 py-2 text-center"><p className="text-lg font-bold">{complete}/4</p><p className="text-[8px] text-[#686F7F]">complete</p></div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-1">
          {steps.map((step, index) => <div key={step.label} className="min-w-0 text-center"><span className={`mx-auto grid h-7 w-7 place-items-center rounded-full text-[9px] font-bold ${step.done ? 'bg-emerald-500 text-[#04120A]' : 'bg-white/[.05] text-[#656C7B]'}`}>{step.done ? '✓' : index + 1}</span><p className={`mt-1 truncate text-[8px] ${step.done ? 'text-emerald-300' : 'text-[#676E7E]'}`}>{step.label}</p></div>)}
        </div>

        <button onClick={action} className="mt-4 h-11 w-full rounded-xl bg-violet-500 text-[11px] font-semibold text-white">{actionLabel}</button>
      </section>

      {data.rejection_reason && <section className="rounded-xl border border-red-500/20 bg-red-500/[.05] p-3"><p className="text-[9px] font-semibold text-red-200">Review feedback</p><p className="mt-1 text-[10px] text-red-100/70">{data.rejection_reason}</p></section>}

      <div className="grid grid-cols-2 gap-2"><Mini title="Gold Tick" text="Payment confirmed" tone="gold" /><Mini title="WeHouse Verified" text="Review approved" tone="green" /></div>
    </div>
  );
}

function Mini({ title, text, tone }: { title: string; text: string; tone: 'gold' | 'green' }) { return <div className="rounded-xl border border-white/[.06] bg-[#0F131A] p-3"><p className={`text-[9px] font-semibold ${tone === 'gold' ? 'text-amber-300' : 'text-emerald-300'}`}>{title}</p><p className="mt-1 text-[9px] text-[#686F7F]">{text}</p></div>; }
function State({ text }: { text: string }) { return <div className="grid min-h-36 place-items-center rounded-2xl border border-white/[.06] bg-[#0F131A] px-5 text-center text-xs text-[#747B8B]">{text}</div>; }
