import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { getActivityLabel, getActionVerb, parseAuditDetails } from '@/lib/activity-formatter';

type AuditRow = {
  id: string;
  admin_id: string | null;
  admin_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: string | null;
  created_at: string;
};

export default function CreatorAuditWorkspace() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('audit_logs').select('id,admin_id,admin_email,action,target_type,target_id,details,created_at').order('created_at', { ascending: false }).limit(250);
    if (error) toast.error(error.message);
    setRows((data || []) as AuditRow[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => [row.action,row.target_type,row.target_id,row.admin_id,row.admin_email,row.details].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.08] via-[#11141D] to-[#0D1017] p-4 sm:p-5">
        <p className="text-[8px] font-bold uppercase tracking-[.18em] text-violet-300">AUDIT</p>
        <h2 className="mt-2 text-lg font-bold">Platform change history</h2>
        <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[#73798A]">Real recorded management and system changes. Suspicious-activity detection belongs to the Security phase; this screen does not invent security alerts that do not exist.</p>
      </section>
      <div className="flex gap-2"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search action, account or target" className="h-11 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#141820] px-3 text-xs outline-none focus:border-violet-500/40" /><button onClick={() => void load()} className="h-11 rounded-xl border border-white/[.08] px-4 text-[10px] font-semibold">Refresh</button></div>
      {loading ? <Loading /> : shown.length === 0 ? <Empty /> : <section className="overflow-hidden rounded-2xl border border-white/[.06] bg-[#10131B] divide-y divide-white/[.05]">{shown.map((row) => <AuditItem key={row.id} row={row} />)}</section>}
    </div>
  );
}

function AuditItem({ row }: { row: AuditRow }) {
  const label = getActivityLabel(row.target_id || row.target_type || 'Platform');
  const verb = getActionVerb(row.action || 'UPDATE');
  const parsed = parseAuditDetails(row.details || '');
  const changed = parsed.oldValue !== undefined && parsed.newValue !== undefined && parsed.oldValue !== parsed.newValue;
  return <article className="flex gap-3 px-4 py-3.5"><div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-[10px] font-bold text-violet-300">{String(row.action || 'A')[0]}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><p className="break-words text-[11px] font-medium">{label} {verb}</p><span className="shrink-0 text-[8px] text-[#555C6D]">{new Date(row.created_at).toLocaleString()}</span></div>{changed && <p className="mt-1 break-words text-[9px] text-[#777C8D]"><span className="text-[#5C6172]">{String(parsed.oldValue)}</span> <span className="text-violet-300">→</span> <span>{String(parsed.newValue)}</span></p>}<p className="mt-1 truncate text-[8px] text-[#565C6D]">{row.admin_email || row.admin_id || 'WeHouse System'} · {String(row.action || '').replace(/_/g,' ')}</p></div></article>;
}
function Loading(){return <div className="grid min-h-44 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>}
function Empty(){return <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-12 text-center text-[10px] text-[#666C7D]">No audit records match this view.</div>}
