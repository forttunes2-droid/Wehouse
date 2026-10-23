import { useEffect, useState } from 'react';
import WorkerVerificationChecklist from '@/components/WorkerVerificationChecklist';
import ProviderOfferingEntry from '@/components/ProviderOfferingEntry';
import { supabase } from '@/lib/supabase';
import WeHouseLoadingState from '@/components/WeHouseLoadingState';
import type { Profile } from '@/types';
import { withTimeout } from '@/lib/withTimeout';
import { assertWorkerActivation } from '@/lib/workerActivation';

type Props = { profile: Profile; onProfile: () => void; onVerification: () => void; onExperiences?: () => void };
type Activation = {
  worker_status: string;
  live: boolean;
  reviewed?: boolean;
  marketplace_enabled?: boolean;
  profile_complete: boolean;
  identity_required?: boolean;
  identity_gate_satisfied?: boolean;
  identity_captured?: boolean;
  identity_current?: boolean;
  identity_passed: boolean;
  evidence_saved: boolean;
  submitted: boolean;
  rejection_reason: string | null;
};

export default function WorkerActivationHome(props: Props) {
  return <div className="space-y-5">
    {props.onExperiences && <ProviderOfferingEntry onService={props.onProfile} onExperience={props.onExperiences} />}
    <ServiceReadinessSummary {...props} />
  </div>;
}

function ServiceReadinessSummary({ profile, onProfile, onVerification, onExperiences }: Props) {
  const [data, setData] = useState<Activation | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    void (async () => {
      try {
        const { data: activation, error: activationError } = await withTimeout(
          supabase.rpc('get_my_worker_activation'), 15000,
          'Setup status took too long to load. Please try again.',
        );
        if (activationError) throw activationError;
        assertWorkerActivation(activation);
        if (active) setData(activation as Activation);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Setup status could not be loaded. Please try again.');
      }
    })();
    return () => { active = false; };
  }, [profile.user_id, profile.worker_status, profile.worker_verified, attempt]);

  if (error) return <section role="alert" className="rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-5 text-[var(--wh-text)]"><h2 className="text-base font-semibold">Setup status unavailable</h2><p className="mt-2 text-sm text-[var(--wh-text-secondary)]">{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-4 min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white">Retry setup status</button></section>;
  if (!data) return <WeHouseLoadingState compact label="Loading" />;

  const identityRequired = data.identity_required === true;
  const actualIdentityPassed = data.identity_captured === true && data.identity_passed === true && data.identity_current === true;
  const identityGateSatisfied = data.identity_gate_satisfied ?? (!identityRequired || actualIdentityPassed);
  const requirements = [
    ...(identityRequired ? [identityGateSatisfied] : []),
    data.evidence_saved,
  ];
  const requirementsDone = requirements.filter(Boolean).length;
  const verificationDone = requirementsDone === requirements.length;
  const underReview = data.worker_status === 'profile_under_review' || (data.submitted && !['rejected','verified'].includes(data.worker_status));
  const reviewed = data.reviewed === true;

  if (underReview && identityGateSatisfied) return <section className="rounded-3xl border border-violet-500/15 bg-[var(--wh-surface)] p-4 sm:p-5"><p className="text-xs font-bold uppercase tracking-[.16em] text-[var(--wh-accent-text)]">WEHOUSE REVIEW</p><h2 className="mt-2 text-xl font-bold">Service review in progress</h2><p className="mt-1 text-sm text-[var(--wh-text-muted)]">WeHouse is reviewing the evidence for your requested services.</p><button type="button" onClick={onVerification} className="mt-4 h-12 w-full rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] text-sm font-semibold text-[var(--wh-text)]">View status</button></section>;

  if (!data.profile_complete && onExperiences) return null;
  if (!data.profile_complete) return <section className="rounded-3xl border border-violet-500/15 bg-[var(--wh-surface)] p-4 sm:p-5"><p className="text-xs font-bold uppercase tracking-[.16em] text-[var(--wh-accent-text)]">WEHOUSE SERVICES</p><h2 className="mt-2 text-xl font-bold">Set up your Service Worker profile</h2><p className="mt-1 text-sm leading-relaxed text-[var(--wh-text-muted)]">Add your service, relevant work experience, price and service area first. You can continue the remaining review steps afterward.</p><button type="button" onClick={onProfile} className="mt-4 h-12 w-full rounded-2xl bg-violet-600 text-sm font-semibold text-white">Continue Service Worker setup</button></section>;

  if (reviewed) return <section className="rounded-3xl border border-emerald-500/15 bg-emerald-500/[.04] p-4 sm:p-5"><p className="text-xs font-bold uppercase tracking-[.16em] text-emerald-700 dark:text-emerald-300">WEHOUSE REVIEWED</p><h2 className="mt-2 text-xl font-bold">Your requested services have been reviewed</h2><p className="mt-1 text-sm text-[var(--wh-text-muted)]">{data.live?'Your requested services are visible in WeHouse Services.':'Your service review is complete, but your service profile is not currently visible. Open your profile to check availability and review requirements.'}</p><button type="button" onClick={onProfile} className="mt-4 h-12 w-full rounded-2xl bg-violet-600 text-sm font-semibold text-white">View service profile</button></section>;



  return <div className="space-y-3">
    <section className="rounded-3xl border border-violet-500/15 bg-[var(--wh-surface)] p-4 sm:p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[var(--wh-accent-text)]">WEHOUSE SERVICES · SERVICE PROVIDER</p><h2 className="mt-2 text-xl font-bold">{verificationDone?'Ready for WeHouse review':'Complete your work profile'}</h2><p className="mt-1 text-sm text-[var(--wh-text-muted)]">{verificationDone?'Your free review requirements are complete.':'Complete the review requirements below. No onboarding payment is required.'}</p></div><div className="shrink-0 rounded-2xl border border-[var(--wh-border-subtle)] bg-black/10 px-3 py-2 text-center"><p className="text-lg font-bold">{requirementsDone}/{requirements.length}</p><p className="text-xs text-[var(--wh-text-muted)]">complete</p></div></div></section>
    <WorkerVerificationChecklist identityPassed={actualIdentityPassed} identityRequired={identityRequired} skillVideoSaved={data.evidence_saved}/>
    {!identityRequired && <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] px-4 py-3"><p className="text-xs leading-5 text-[var(--wh-text-secondary)]">Identity verification is not currently required. Submit your work evidence for review.</p></section>}
    <button type="button" onClick={onVerification} className="h-12 w-full rounded-2xl bg-violet-600 text-sm font-semibold text-white">{verificationDone?'Submit for WeHouse review':'Continue setup'}</button>
    {data.rejection_reason&&<section className="rounded-xl border border-red-500/20 bg-red-500/[.05] p-3"><p className="text-xs font-semibold text-red-700 dark:text-red-200">Review feedback</p><p className="mt-1 text-sm text-red-700 dark:text-red-100/80">{data.rejection_reason}</p></section>}
  </div>;
}
