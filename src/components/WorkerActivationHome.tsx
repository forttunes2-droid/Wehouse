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
  identity_status: string;
  identity_provider: string | null;
  rejection_reason: string | null;
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
  if (!data) return <State text="Loading Worker activation…" />;

  const identityVerified = data.identity_status === 'verified';
  const underReview = data.worker_status === 'profile_under_review' || data.submitted;
  const steps = [
    {
      title: 'Professional profile',
      detail: 'Service, skills, experience, price and service area.',
      done: data.profile_complete,
      action: onProfile,
      actionLabel: data.profile_complete ? 'View profile' : 'Complete profile',
    },
    {
      title: 'Verification Gold Tick',
      detail: 'Confirmed Paystack verification payment. This badge does not make the profile public.',
      done: data.gold_badge,
      action: onVerification,
      actionLabel: data.gold_badge ? 'Payment confirmed' : 'Pay verification fee',
    },
    {
      title: 'Worker readiness test',
      detail: data.test_passed ? `Passed${data.test_percent != null ? ` · ${data.test_percent}%` : ''}.` : 'Professional conduct, safety, privacy and WeHouse rules.',
      done: data.test_passed,
      action: onVerification,
      actionLabel: data.test_passed ? 'Test passed' : 'Take Worker test',
    },
    {
      title: 'Professional evidence',
      detail: 'Skill demonstration video plus an optional professional certificate.',
      done: data.evidence_saved,
      action: onVerification,
      actionLabel: data.evidence_saved ? 'Evidence saved' : 'Add work evidence',
    },
    {
      title: 'External government identity',
      detail: identityVerified
        ? `${data.identity_provider || 'External provider'} verified the identity.`
        : 'Youverify checks the government identity outside the WeHouse Staff review workflow.',
      done: identityVerified,
      action: onVerification,
      actionLabel: identityVerified ? 'Identity verified' : 'Verify identity',
    },
    {
      title: 'WeHouse professional review',
      detail: data.live
        ? 'Approved. Your Worker profile is live in Local Services.'
        : underReview
          ? 'Submitted. Your profile stays private until approval.'
          : 'Final review starts only after every previous gate is complete.',
      done: data.live,
      action: onVerification,
      actionLabel: data.live ? 'Worker is live' : underReview ? 'Under review' : 'Continue activation',
    },
  ];

  const completeCount = steps.filter((step) => step.done).length;
  const nextIndex = steps.findIndex((step) => !step.done);
  const next = nextIndex >= 0 ? steps[nextIndex] : null;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-cyan-500/15 bg-gradient-to-br from-cyan-500/[.10] via-[#101720] to-[#0D1219] p-5 sm:p-6 lg:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[9px] font-bold uppercase tracking-[.18em] text-cyan-300">WORKER ACTIVATION</p>
              {data.gold_badge && <span className="rounded-full border border-amber-400/20 bg-amber-400/[.08] px-2 py-1 text-[8px] font-bold text-amber-300">GOLD TICK · PAYMENT</span>}
            </div>
            <h2 className="mt-3 text-2xl font-bold">Build one trusted professional identity</h2>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[#7B8292]">Your account exists immediately, but it remains private until the complete activation path is approved. There is one status path, not separate verification dashboards.</p>
          </div>
          <div className="rounded-2xl border border-white/[.07] bg-black/10 px-4 py-3 text-right">
            <p className="text-2xl font-bold">{completeCount}/{steps.length}</p>
            <p className="text-[9px] text-[#697080]">activation gates complete</p>
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
        <section className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[.04] p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div><p className="text-[9px] font-semibold uppercase tracking-wide text-cyan-300">NEXT ACTION</p><p className="mt-1 text-sm font-semibold">{next.title}</p><p className="mt-1 text-[10px] leading-relaxed text-[#747B8B]">{next.detail}</p></div>
          <button onClick={next.action} className="mt-3 h-11 w-full rounded-xl bg-cyan-500 px-4 text-[11px] font-semibold text-[#041014] sm:mt-0 sm:w-auto">{next.actionLabel}</button>
        </section>
      )}

      <section className="space-y-2">
        {steps.map((step, index) => {
          const current = index === nextIndex && !underReview;
          return (
            <button key={step.title} onClick={step.action} className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${step.done ? 'border-emerald-500/15 bg-emerald-500/[.04]' : current ? 'border-cyan-500/20 bg-cyan-500/[.04]' : 'border-white/[.06] bg-[#10141C]'}`}>
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[10px] font-bold ${step.done ? 'bg-emerald-500 text-[#04120A]' : current ? 'bg-cyan-500 text-[#041014]' : 'bg-white/[.05] text-[#717888]'}`}>{step.done ? '✓' : index + 1}</span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{step.title}</span><span className="mt-1 block text-[10px] leading-relaxed text-[#707788]">{step.detail}</span></span>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-semibold ${step.done ? 'bg-emerald-500/10 text-emerald-300' : current ? 'bg-cyan-500/10 text-cyan-300' : 'bg-white/[.04] text-[#646B7A]'}`}>{step.done ? 'DONE' : current ? 'NEXT' : 'LOCKED'}</span>
            </button>
          );
        })}
      </section>

      <section className="rounded-2xl border border-white/[.06] bg-[#0F131A] p-4">
        <p className="text-xs font-semibold">Public visibility rule</p>
        <p className="mt-1 text-[10px] leading-relaxed text-[#6F7686]">Payment Gold Tick ≠ public approval. Passing the test ≠ public approval. External identity ≠ public approval. Only the final approved Worker state becomes searchable in Local Services.</p>
      </section>
    </div>
  );
}

function State({ text }: { text: string }) {
  return <div className="grid min-h-[50dvh] place-items-center rounded-2xl border border-white/[.06] bg-[#0F131A] px-5 text-center text-xs text-[#747B8B]">{text}</div>;
}
