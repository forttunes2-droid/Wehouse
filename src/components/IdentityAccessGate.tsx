import { useRpcRead } from '@/hooks/useRpcRead';
import AccountShell from '@/components/AccountShell';
import WorkerIdentityCheck from '@/components/WorkerIdentityCheck';
import type { Profile } from '@/types';

type Status = {
  required: boolean;
  gate_satisfied: boolean;
  current: boolean;
  recurring_required?: boolean;
  enrolled: boolean;
  due_at: string | null;
  recheck_days: number | null;
  status: string;
  review_notes?: string | null;
};

export default function IdentityAccessGate({
  profile,
  children,
}: {
  profile: Profile;
  children: React.ReactNode;
}) {
  const { data: state, loading, error: loadError, refresh } = useRpcRead<Status>('get_my_account_identity_status', profile.user_id);

  if (loading)
    return (
      <AccountShell profile={profile} title={profile.role === 'property_partner' ? 'Property Partner' : 'Service Provider'}>
        <section role="status" aria-live="polite" className="space-y-4 py-5">
          <p className="text-sm text-[#A1A1AA]">Opening your workspace…</p>
          <div aria-hidden="true" className="space-y-3 animate-pulse">{[1, 2, 3].map(item => <div key={item} className="h-20 rounded-xl bg-white/[.04]" />)}</div>
        </section>
      </AccountShell>
    );

  // Privileged provider/partner work should never silently fail open when the
  // server-side gate cannot be read. This is a connectivity/access error, not a
  // request to repeat face verification.
  if (loadError)
    return (
      <AccountShell
        profile={profile}
        title="Workspace check unavailable"
        description="WeHouse could not safely confirm this workspace right now."
      >
        <section className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-4">
          <p className="text-xs leading-6 text-amber-100/80">{loadError}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-4 h-11 w-full rounded-xl border border-white/[.08] text-[11px] font-semibold text-white"
          >
            Check again
          </button>
        </section>
      </AccountShell>
    );

  // Biometric/liveness collection is not a default launch requirement. The
  // server decides whether the approved policy gate is enabled. When disabled,
  // no face prompt is shown and existing workspace authority remains intact.
  if (state?.required && !state.gate_satisfied) {
    const partner = profile.role === 'property_partner';
    const label = partner ? 'Property Partner' : 'Service Provider';
    const protectedWork = partner
      ? 'property requests, listings and earnings'
      : 'jobs, showcase and earnings';
    const pending = state.status === 'pending_review';
    const expired = state.status === 'expired';

    return (
      <AccountShell
        profile={profile}
        title={pending ? 'Identity review pending' : expired ? 'Identity confirmation due' : 'Identity verification required'}
        description={
          pending
            ? `WeHouse is reviewing the private live check for this ${label} workspace.`
            : `Confirm that you are still the person using this ${label} workspace.`
        }
      >
        <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.045] p-4">
          <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">
            {pending ? 'WEHOUSE IDENTITY REVIEW' : 'IDENTITY CONFIRMATION'}
          </p>
          <p className="mt-2 text-xs leading-6 text-[#9AA0AF]">
            {pending
              ? `Your ${protectedWork} stay protected while a different authorised WeHouse Team member reviews this check.`
              : state.recurring_required
                ? `A private live check helps stop account takeover. Recurring checks run only under the approved identity policy and do not erase your ${protectedWork}.`
                : `A private live check helps confirm that the approved account owner still controls this ${label} workspace. It does not replace property authority, skills or other WeHouse review.`}
          </p>
        </section>
        <WorkerIdentityCheck
          profile={profile}
          status={
            pending
              ? 'pending_review'
              : expired
                ? 'expired'
                : state.status === 'rejected'
                  ? 'rejected'
                  : state.enrolled
                    ? 'due'
                    : 'not_started'
          }
          rejectionReason={state.review_notes}
          onSaved={refresh}
        />
      </AccountShell>
    );
  }

  return <>{children}</>;
}
