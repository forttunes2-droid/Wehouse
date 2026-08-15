import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Props = { profile: Profile; onProfile: () => void; onVerification: () => void };
type Activation = {
  worker_status: string;
  live: boolean;
  profile_complete: boolean;
  payment_status: string | null;
  gold_badge: boolean;
  test_passed: boolean;
  test_percent: number | null;
  evidence_saved: boolean;
  submitted: boolean;
  review_status: string | null;
  rejection_reason: string | null;
};

type ActivationStep = {
  title: string;
  detail: string;
  done: boolean;
  action: () => void;
  actionLabel: string;
};

export default function WorkerActivationHome({ profile, onProfile, onVerification }: Props) {
  const [data, setData] = useState<Activation | null>(null);
  const [error, setError] = useState('');

  async function load() {
    const { data: activation, error: activationError } = await supabase.rpc('get_my_worker_activation');
    if (activationError) {
      setError(activationError.message);
      return;
    }
    setData(activation as Activation);
    setError('');
  }

  useEffect(() => {
    void load();
  }, [profile.user_id, profile.worker_status, profile.worker_verified]);

  if (error) return <State text={error} />;
  if (!data) return <State text="Loading Worker verification…" />;

  const skillCheckDone = data.test_passed && data.evidence_saved;
  const underReview = data.worker_status === 'profile_under_review' || data.submitted;

  const steps: ActivationStep[] = [
    {
      title: 'Professional setup',
      detail: 'Complete your service, skills, experience, price and service coverage.',
      done: data.profile_complete,
      action: onProfile,
      actionLabel: data.profile_complete ? 'Review profile' : 'Complete profile',
    },
    {
      title: 'Verification payment',
      detail: 'A confirmed Paystack payment gives the Gold Tick. The Gold Tick means payment confirmed only.',
      done: data.gold_badge,
      action: onVerification,
      actionLabel: data.gold_badge ? 'Payment confirmed' : 'Pay verification fee',
    },
    {
      title: 'WeHouse skill check',
      detail: data.test_passed
        ? data.evidence_saved
          ? `Readiness passed${data.test_percent != null ? ` · ${data.test_percent}%` : ''} and work evidence saved.`
          : `Readiness passed${data.test_percent != null ? ` · ${data.test_percent}%` : ''}. Add a skill demonstration video.`
        : 'Complete the WeHouse readiness check and show your work with a skill demonstration video.',
      done: skillCheckDone,
      action: onVerification,
      actionLabel: skillCheckDone ? 'Skill check complete' : 'Continue skill check',
    },
    {
      title: 'WeHouse review',
      detail: data.live
        ? 'Approved. Your professional profile is live in Local Services.'
        : underReview
          ? 'Submitted. Your profile stays private while WeHouse reviews your professional checks.'
          : 'Submit when your professional setup, payment and skill check are complete.',
      done: data.live,
      action: onVerification,
      actionLabel: data.live ? 'Worker is live' : underReview ? 'Under review' : 'Submit for review',
    },
  ];

  const completeCount = steps.filter((step) => step.done).length;
  const nextIndex = steps.findIndex((step) => !step.done);
  const next = nextIndex >= 0 ? steps[nextIndex] : null;

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.10] via-[#12141C] to-[#0F1218] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">WEHOUSE PROFESSIONAL VERIFICATION</p>
              {data.gold_badge && (
                <span className="rounded-full border border-amber-400/20 bg-amber-400/[.08] px-2 py-1 text-[8px] font-bold text-amber-300">
                  GOLD TICK · PAYMENT
                </span>
              )}
            </div>
            <h2 className="mt-3 text-2xl font-bold">Build trust through your work</h2>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[#7B8292]">
              WeHouse verifies Workers through professional setup, payment confirmation, skill checks, work evidence and internal review. Government ID is not part of this process.
            </p>
          </div>
          <div className="rounded-2xl border border-white/[.07] bg-black/10 px-4 py-3 text-right">
            <p className="text-2xl font-bold">{completeCount}/{steps.length}</p>
            <p className="text-[9px] text-[#697080]">stages complete</p>
          </div>
        </div>
      </section>

      {data.rejection_reason && (
        <section className="rounded-2xl border border-red-500/20 bg-red-500/[.05] p-4">
          <p className="text-xs font-semibold text-red-200">Review feedback</p>
          <p className="mt-1 text-[10px] leading-relaxed text-red-100/65">{data.rejection_reason}</p>
        </section>
      )}

      {next && !underReview && (
        <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.04] p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-violet-300">NEXT ACTION</p>
            <p className="mt-1 text-sm font-semibold">{next.title}</p>
            <p className="mt-1 text-[10px] leading-relaxed text-[#747B8B]">{next.detail}</p>
          </div>
          <button
            onClick={next.action}
            className="mt-3 h-11 w-full rounded-xl bg-violet-500 px-4 text-[11px] font-semibold text-white sm:mt-0 sm:w-auto"
          >
            {next.actionLabel}
          </button>
        </section>
      )}

      <section className="overflow-hidden rounded-3xl border border-white/[.06] bg-[#10141C]">
        <div className="border-b border-white/[.05] px-4 py-3 sm:px-5">
          <p className="text-[9px] font-bold uppercase tracking-[.16em] text-[#646B7A]">VERIFICATION PROGRESS</p>
          <p className="mt-1 text-[10px] text-[#757C8C]">One clear path. Payment is not approval, and approval is what makes you public.</p>
        </div>

        {steps.map((step, index) => {
          const current = index === nextIndex && !underReview;
          return (
            <div key={step.title} className={`flex items-start gap-3 px-4 py-4 sm:px-5 ${index > 0 ? 'border-t border-white/[.05]' : ''}`}>
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[10px] font-bold ${
                  step.done
                    ? 'bg-emerald-500 text-[#04120A]'
                    : current
                      ? 'bg-violet-500 text-white'
                      : 'bg-white/[.05] text-[#717888]'
                }`}
              >
                {step.done ? '✓' : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{step.title}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[8px] font-semibold ${
                      step.done
                        ? 'bg-emerald-500/10 text-emerald-300'
                        : current
                          ? 'bg-violet-500/10 text-violet-300'
                          : 'bg-white/[.04] text-[#646B7A]'
                    }`}
                  >
                    {step.done ? 'DONE' : current ? 'CURRENT' : 'LOCKED'}
                  </span>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-[#707788]">{step.detail}</p>
              </div>
            </div>
          );
        })}
      </section>

      <section className="rounded-2xl border border-white/[.06] bg-[#0F131A] p-4">
        <p className="text-xs font-semibold">What “WeHouse Verified” means</p>
        <p className="mt-1 text-[10px] leading-relaxed text-[#6F7686]">
          It means WeHouse checked the Worker’s professional setup, readiness, work evidence and review history. It does not mean government identity verification.
        </p>
      </section>
    </div>
  );
}

function State({ text }: { text: string }) {
  return (
    <div className="grid min-h-[50dvh] place-items-center rounded-2xl border border-white/[.06] bg-[#0F131A] px-5 text-center text-xs text-[#747B8B]">
      {text}
    </div>
  );
}
