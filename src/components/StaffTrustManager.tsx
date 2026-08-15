import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type TrustStatus = 'probation' | 'trusted' | 'restricted' | 'revoked';
type TrustRow = {
  status: TrustStatus;
  appointed_at: string | null;
  trusted_at: string | null;
  notes: string | null;
  supervisor_confirmed: boolean;
  orientation_completed: boolean;
  role_training_completed: boolean;
  code_of_conduct_confirmed: boolean;
  probation_observation_completed: boolean;
};

type ChecklistKey =
  | 'supervisor_confirmed'
  | 'orientation_completed'
  | 'role_training_completed'
  | 'code_of_conduct_confirmed'
  | 'probation_observation_completed';

const STATUS_COPY: Record<TrustStatus, { label: string; detail: string }> = {
  probation: {
    label: 'Probation',
    detail: 'Staff account exists, but operational permissions stay locked until the WeHouse trust checklist is completed and approved.',
  },
  trusted: {
    label: 'Trusted',
    detail: 'Staff can use the one operational module assigned to this account.',
  },
  restricted: {
    label: 'Restricted',
    detail: 'Operational access is temporarily blocked while an issue is reviewed.',
  },
  revoked: {
    label: 'Revoked',
    detail: 'Staff trust has been withdrawn and operational access is blocked.',
  },
};

const CHECKS: Array<{ key: ChecklistKey; title: string; detail: string }> = [
  {
    key: 'supervisor_confirmed',
    title: 'Supervisor confirmation',
    detail: 'An Admin or Creator has personally confirmed who is joining the branch team and accepts responsibility for the appointment.',
  },
  {
    key: 'orientation_completed',
    title: 'Branch orientation',
    detail: 'The Staff member understands the assigned branch, their one module, escalation path and what they must not access.',
  },
  {
    key: 'role_training_completed',
    title: 'Role training',
    detail: 'Training for the assigned operational module has been completed and understood.',
  },
  {
    key: 'code_of_conduct_confirmed',
    title: 'Code of conduct',
    detail: 'Confidentiality, customer treatment, conflict-of-interest and account-security expectations were explained and accepted.',
  },
  {
    key: 'probation_observation_completed',
    title: 'Observed probation task',
    detail: 'A supervisor observed a trial/probation task or equivalent role exercise and is satisfied with the Staff member’s conduct.',
  },
];

const EMPTY: TrustRow = {
  status: 'probation',
  appointed_at: null,
  trusted_at: null,
  notes: null,
  supervisor_confirmed: false,
  orientation_completed: false,
  role_training_completed: false,
  code_of_conduct_confirmed: false,
  probation_observation_completed: false,
};

export default function StaffTrustManager({ staff, actor }: { staff: Profile; actor?: Profile | null }) {
  const [row, setRow] = useState<TrustRow>(EMPTY);
  const [draft, setDraft] = useState<TrustRow>(EMPTY);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const allowed = actor?.role === 'creator' || actor?.role === 'admin';
  const completeCount = useMemo(() => CHECKS.filter((check) => draft[check.key]).length, [draft]);
  const allComplete = completeCount === CHECKS.length;
  const checklistChanged = CHECKS.some((check) => draft[check.key] !== row[check.key]) || notes !== (row.notes || '');

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('staff_trust_profiles')
      .select('status,appointed_at,trusted_at,notes,supervisor_confirmed,orientation_completed,role_training_completed,code_of_conduct_confirmed,probation_observation_completed')
      .eq('staff_id', staff.user_id)
      .maybeSingle();
    if (error) {
      toast.error(error.message);
      setRow(EMPTY);
      setDraft(EMPTY);
      setNotes('');
    } else {
      const next = { ...EMPTY, ...(data || {}) } as TrustRow;
      setRow(next);
      setDraft(next);
      setNotes(next.notes || '');
    }
    setLoading(false);
  }

  useEffect(() => {
    if (allowed && staff.role === 'staff') void load();
  }, [staff.user_id, staff.role, actor?.role]);

  if (!allowed || staff.role !== 'staff') return null;

  function toggle(key: ChecklistKey) {
    setDraft((current) => ({ ...current, [key]: !current[key] }));
  }

  async function saveChecklist() {
    setSaving(true);
    const { data, error } = await supabase.rpc('update_staff_trust_checklist', {
      p_staff_id: staff.user_id,
      p_supervisor_confirmed: draft.supervisor_confirmed,
      p_orientation_completed: draft.orientation_completed,
      p_role_training_completed: draft.role_training_completed,
      p_code_of_conduct_confirmed: draft.code_of_conduct_confirmed,
      p_probation_observation_completed: draft.probation_observation_completed,
      p_notes: notes.trim() || null,
    });
    setSaving(false);
    if (error || data !== true) return toast.error(error?.message || 'Could not save Staff trust checklist');
    toast.success('Staff trust checklist saved');
    await load();
  }

  async function change(status: TrustStatus) {
    if (status === 'trusted' && !allComplete) {
      return toast.error('Complete and save every WeHouse trust check before marking this Staff member trusted');
    }
    if (checklistChanged) {
      return toast.error('Save the trust checklist before changing Staff trust status');
    }

    setSaving(true);
    const { data, error } = await supabase.rpc('set_staff_trust_status', {
      p_staff_id: staff.user_id,
      p_status: status,
      p_notes: notes.trim() || null,
    });
    setSaving(false);
    if (error || data !== true) return toast.error(error?.message || 'Could not update Staff trust');
    toast.success(`Staff trust changed to ${STATUS_COPY[status].label}`);
    await load();
  }

  const status = row.status;

  return (
    <section className="rounded-2xl border border-violet-500/15 bg-[#11141C] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">WEHOUSE STAFF TRUST</p>
          <h4 className="mt-1 text-sm font-semibold">{loading ? 'Checking trust…' : STATUS_COPY[status].label}</h4>
        </div>
        {!loading && (
          <span
            className={`rounded-full px-2 py-1 text-[8px] font-bold uppercase ${
              status === 'trusted'
                ? 'bg-emerald-500/10 text-emerald-300'
                : status === 'restricted' || status === 'revoked'
                  ? 'bg-red-500/10 text-red-300'
                  : 'bg-amber-500/10 text-amber-300'
            }`}
          >
            {status}
          </span>
        )}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-[#747A8B]">
        {loading ? 'Loading Staff trust record…' : STATUS_COPY[status].detail}
      </p>
      <p className="mt-2 text-[9px] leading-relaxed text-[#5F6575]">
        This is a WeHouse operational trust process based on supervision, training, conduct and observed work. Government ID is not required.
      </p>

      {!loading && (
        <>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[9px] font-bold uppercase tracking-[.14em] text-[#777D8D]">Trust checklist</p>
            <span className={`text-[9px] font-semibold ${allComplete ? 'text-emerald-300' : 'text-amber-300'}`}>{completeCount}/{CHECKS.length}</span>
          </div>

          <div className="mt-2 space-y-2">
            {CHECKS.map((check) => (
              <button
                key={check.key}
                type="button"
                disabled={saving}
                onClick={() => toggle(check.key)}
                className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition disabled:opacity-50 ${
                  draft[check.key]
                    ? 'border-emerald-500/20 bg-emerald-500/[.05]'
                    : 'border-white/[.07] bg-black/10 hover:bg-white/[.025]'
                }`}
              >
                <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg border text-[10px] font-bold ${draft[check.key] ? 'border-emerald-500 bg-emerald-500 text-[#04100B]' : 'border-white/15 text-[#6A7080]'}`}>
                  {draft[check.key] ? '✓' : ''}
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-semibold text-[#D9DCE3]">{check.title}</span>
                  <span className="mt-1 block text-[9px] leading-relaxed text-[#686F80]">{check.detail}</span>
                </span>
              </button>
            ))}
          </div>

          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value.slice(0, 500))}
            rows={3}
            placeholder="Trust notes — supervisor observations, training notes or reason for restriction"
            className="mt-3 w-full resize-none rounded-xl border border-white/[.08] bg-[#171A23] p-3 text-[10px] text-white outline-none focus:border-violet-500/35"
          />

          <button
            type="button"
            disabled={saving || !checklistChanged}
            onClick={() => void saveChecklist()}
            className="mt-2 h-10 w-full rounded-xl border border-violet-500/20 bg-violet-500/10 text-[9px] font-semibold text-violet-200 disabled:opacity-35"
          >
            {saving ? 'Saving…' : checklistChanged ? 'Save trust checklist' : 'Checklist saved'}
          </button>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <TrustButton active={status === 'trusted'} disabled={saving || !allComplete || checklistChanged} onClick={() => void change('trusted')}>Mark trusted</TrustButton>
            <TrustButton active={status === 'probation'} disabled={saving || checklistChanged} onClick={() => void change('probation')}>Return to probation</TrustButton>
            <TrustButton danger active={status === 'restricted'} disabled={saving || checklistChanged} onClick={() => void change('restricted')}>Restrict</TrustButton>
            <TrustButton danger active={status === 'revoked'} disabled={saving || checklistChanged} onClick={() => void change('revoked')}>Revoke trust</TrustButton>
          </div>
        </>
      )}
    </section>
  );
}

function TrustButton({ children, active, danger, disabled, onClick }: { children: React.ReactNode; active?: boolean; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`min-h-10 rounded-xl border px-3 text-[9px] font-semibold disabled:opacity-40 ${
        active
          ? danger
            ? 'border-red-500/30 bg-red-500/15 text-red-200'
            : 'border-violet-500/30 bg-violet-500/15 text-violet-200'
          : 'border-white/[.07] bg-white/[.025] text-[#9AA0AF]'
      }`}
    >
      {children}
    </button>
  );
}
