import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type TrustStatus = 'probation' | 'trusted' | 'restricted' | 'revoked';
type TrustRow = {
  status: TrustStatus;
  appointed_at: string | null;
  trusted_at: string | null;
  notes: string | null;
};

const STATUS_COPY: Record<TrustStatus, { label: string; detail: string }> = {
  probation: {
    label: 'Probation',
    detail: 'Staff account exists, but operational permissions stay locked until WeHouse approves trust.',
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

export default function StaffTrustManager({ staff, actor }: { staff: Profile; actor?: Profile | null }) {
  const [row, setRow] = useState<TrustRow | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const allowed = actor?.role === 'creator' || actor?.role === 'admin';

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('staff_trust_profiles')
      .select('status,appointed_at,trusted_at,notes')
      .eq('staff_id', staff.user_id)
      .maybeSingle();
    if (error) {
      toast.error(error.message);
      setRow(null);
    } else {
      const next = (data || { status: 'probation', appointed_at: null, trusted_at: null, notes: null }) as TrustRow;
      setRow(next);
      setNotes(next.notes || '');
    }
    setLoading(false);
  }

  useEffect(() => {
    if (allowed && staff.role === 'staff') void load();
  }, [staff.user_id, staff.role, actor?.role]);

  if (!allowed || staff.role !== 'staff') return null;

  async function change(status: TrustStatus) {
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

  const status = row?.status || 'probation';

  return (
    <section className="glass rounded-2xl border border-violet-500/15 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">WEHOUSE STAFF TRUST</p>
          <h4 className="mt-1 text-xs font-semibold">{loading ? 'Checking trust…' : STATUS_COPY[status].label}</h4>
        </div>
        {!loading && (
          <span className={`rounded-full px-2 py-1 text-[8px] font-bold uppercase ${
            status === 'trusted'
              ? 'bg-emerald-500/10 text-emerald-300'
              : status === 'restricted' || status === 'revoked'
                ? 'bg-red-500/10 text-red-300'
                : 'bg-amber-500/10 text-amber-300'
          }`}>
            {status}
          </span>
        )}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-[#747A8B]">
        {loading ? 'Loading Staff trust record…' : STATUS_COPY[status].detail}
      </p>
      <p className="mt-2 text-[9px] leading-relaxed text-[#5F6575]">
        WeHouse trust is based on appointment, branch responsibility, probation, work history, audit activity and Admin/Creator review. Government ID is not required.
      </p>

      {!loading && (
        <>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value.slice(0, 500))}
            rows={3}
            placeholder="Trust notes — why this Staff member is trusted, restricted, or under probation"
            className="mt-3 w-full resize-none rounded-xl border border-white/[.08] bg-[#171A23] p-3 text-[10px] text-white outline-none focus:border-violet-500/35"
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <TrustButton active={status === 'trusted'} disabled={saving} onClick={() => void change('trusted')}>Mark trusted</TrustButton>
            <TrustButton active={status === 'probation'} disabled={saving} onClick={() => void change('probation')}>Return to probation</TrustButton>
            <TrustButton danger active={status === 'restricted'} disabled={saving} onClick={() => void change('restricted')}>Restrict</TrustButton>
            <TrustButton danger active={status === 'revoked'} disabled={saving} onClick={() => void change('revoked')}>Revoke trust</TrustButton>
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
