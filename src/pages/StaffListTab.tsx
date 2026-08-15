import { useEffect, useMemo, useState } from 'react';
import { getAllUsers } from '@/lib/supabase/admin';
import { supabase } from '@/lib/supabase';
import { NIGERIA_STATES } from '@/data/nigeria-locations';
import StaffTrustManager from '@/components/StaffTrustManager';
import type { Profile } from '@/types';
import { toast } from 'sonner';

const MODULES: Record<string, string> = {
  operations: 'Operations',
  finance: 'Finance',
  support: 'Support',
  verification: 'Verification',
  field_officer: 'Field Officer',
};

const PAGE_SIZE = 12;
type TeamRole = 'all' | 'admin' | 'staff';
type TrustFilter = 'all' | 'probation' | 'trusted' | 'restricted' | 'revoked';
type TrustRow = {
  staff_id: string;
  status: TrustFilter;
  appointed_by: string | null;
  updated_at?: string | null;
};

export default function StaffListTab({ profile }: { profile: Profile }) {
  const creator = profile.role === 'creator';
  const [team, setTeam] = useState<Profile[]>([]);
  const [assigned, setAssigned] = useState<Record<string, string>>({});
  const [trust, setTrust] = useState<Record<string, TrustRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [filter, setFilter] = useState<TeamRole>('all');
  const [trustFilter, setTrustFilter] = useState<TrustFilter>('all');
  const [stateFilter, setStateFilter] = useState('');
  const [lgaFilter, setLgaFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [staffLimit, setStaffLimit] = useState(0);
  const [limitDraft, setLimitDraft] = useState('0');
  const [savingLimit, setSavingLimit] = useState(false);

  async function load() {
    setLoading(true);
    let list: Profile[] = [];

    if (!creator) {
      const { data, error } = await supabase.rpc('admin_get_my_branch_profiles', { p_role: 'staff' });
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }
      list = (Array.isArray(data) ? data : []) as Profile[];
    } else {
      const { users, error } = await getAllUsers();
      if (error) {
        toast.error('Unable to load WeHouse team');
        setLoading(false);
        return;
      }
      list = (users || []).filter((user: any) => user.role === 'admin' || user.role === 'staff') as Profile[];
    }

    setTeam(list);
    const staff = list.filter((member) => member.role === 'staff');
    if (staff.length) {
      const ids = staff.map((member) => member.user_id);
      const [permissionsResult, trustResult] = await Promise.all([
        supabase.from('staff_permissions').select('staff_id,permission').in('staff_id', ids).eq('is_active', true),
        supabase.from('staff_trust_profiles').select('staff_id,status,appointed_by,updated_at').in('staff_id', ids),
      ]);

      if (permissionsResult.error) toast.error(permissionsResult.error.message);
      if (trustResult.error) toast.error(trustResult.error.message);

      const permissionMap: Record<string, string> = {};
      (permissionsResult.data || []).forEach((row: any) => {
        permissionMap[row.staff_id] = row.permission;
      });
      setAssigned(permissionMap);

      const trustMap: Record<string, TrustRow> = {};
      (trustResult.data || []).forEach((row: any) => {
        trustMap[row.staff_id] = row as TrustRow;
      });
      setTrust(trustMap);
    } else {
      setAssigned({});
      setTrust({});
    }

    const { data: limitRow, error: limitError } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'admin_staff_limit')
      .maybeSingle();
    if (limitError) toast.error('Could not load Staff capacity policy');
    const limit = Math.max(0, Number(limitRow?.value || 0) || 0);
    setStaffLimit(limit);
    setLimitDraft(String(limit));

    setSelected((current) => current ? list.find((member) => member.user_id === current.user_id) || null : null);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [profile.role, profile.assigned_state, profile.assigned_lga]);

  useEffect(() => {
    setPage(1);
  }, [filter, trustFilter, stateFilter, lgaFilter, search]);

  const staffMembers = useMemo(() => team.filter((member) => member.role === 'staff'), [team]);
  const admins = useMemo(() => team.filter((member) => member.role === 'admin'), [team]);
  const trustedCount = useMemo(() => staffMembers.filter((member) => trust[member.user_id]?.status === 'trusted').length, [staffMembers, trust]);
  const attentionCount = useMemo(() => staffMembers.filter((member) => ['probation', 'restricted', 'revoked'].includes(trust[member.user_id]?.status || 'probation')).length, [staffMembers, trust]);

  function appointedCount(adminId: string) {
    return staffMembers.filter((member) => trust[member.user_id]?.appointed_by === adminId).length;
  }

  const ownUsed = creator ? 0 : appointedCount(profile.user_id);
  const ownRemaining = staffLimit === 0 ? null : Math.max(0, staffLimit - ownUsed);

  const stateData = NIGERIA_STATES.find((item) => item.state === stateFilter);
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return team.filter((member) => {
      if (creator && filter !== 'all' && member.role !== filter) return false;
      if (trustFilter !== 'all') {
        if (member.role !== 'staff') return false;
        if ((trust[member.user_id]?.status || 'probation') !== trustFilter) return false;
      }
      if (creator && stateFilter && member.assigned_state !== stateFilter) return false;
      if (creator && lgaFilter && member.assigned_lga !== lgaFilter) return false;
      if (needle) {
        const haystack = [member.full_name, member.username, member.email, member.user_id, member.assigned_state, member.assigned_lga]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [team, creator, filter, trustFilter, trust, stateFilter, lgaFilter, search]);

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = shown.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  async function changeModule(staffId: string, next: string) {
    setSaving(staffId);
    const current = assigned[staffId] || '';
    if (current === next) {
      setSaving(null);
      return;
    }

    if (!next && current) {
      const { error } = await supabase.rpc('manage_staff_permission', {
        p_staff_id: staffId,
        p_permission: current,
        p_enabled: false,
      });
      if (error) {
        toast.error(error.message);
        setSaving(null);
        return;
      }
      setAssigned((value) => ({ ...value, [staffId]: '' }));
      toast.success('Staff module removed');
    } else if (next) {
      const { error } = await supabase.rpc('manage_staff_permission', {
        p_staff_id: staffId,
        p_permission: next,
        p_enabled: true,
      });
      if (error) {
        toast.error(error.message);
        setSaving(null);
        return;
      }
      setAssigned((value) => ({ ...value, [staffId]: next }));
      toast.success('Staff module updated');
    }
    setSaving(null);
  }

  async function reassign(person: Profile, state: string, lga: string) {
    if (!creator || !state || !lga) return;
    setSaving(person.user_id);
    const { error } = await supabase.rpc('creator_reassign_branch', {
      p_target_user_id: person.user_id,
      p_new_state: state,
      p_new_lga: lga,
    });
    if (error) toast.error(error.message);
    else {
      toast.success('Branch assignment updated');
      await load();
    }
    setSaving(null);
  }

  async function saveLimit() {
    if (!creator) return;
    const parsed = Number(limitDraft);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000) {
      toast.error('Staff limit must be a whole number from 0 to 1000');
      return;
    }

    setSavingLimit(true);
    const payload = {
      key: 'admin_staff_limit',
      value: String(parsed),
      category: 'team',
      label: 'Maximum Staff per Admin',
      description: 'Maximum active Staff an Admin can appoint. 0 means unlimited.',
      data_type: 'number',
      editable: true,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    const { data: existing, error: readError } = await supabase.from('platform_settings').select('key').eq('key', payload.key).maybeSingle();
    if (readError) {
      toast.error(readError.message);
      setSavingLimit(false);
      return;
    }
    const result = existing
      ? await supabase.from('platform_settings').update(payload).eq('key', payload.key)
      : await supabase.from('platform_settings').insert(payload);
    setSavingLimit(false);
    if (result.error) return toast.error(result.error.message);
    setStaffLimit(parsed);
    toast.success(parsed === 0 ? 'Admin Staff limit set to unlimited' : `Admin Staff limit set to ${parsed}`);
  }

  if (loading) {
    return <div className="grid min-h-52 place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-white/[0.06] bg-[#10131B] p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">TEAM MANAGEMENT</p>
            <h3 className="mt-2 text-lg font-bold text-white">{creator ? 'WeHouse organisation' : 'Branch team'}</h3>
            <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[#6A6E80]">
              {creator
                ? 'Manage Admin capacity, Staff responsibility, branch placement and trust without turning the page into an endless member list.'
                : 'Manage Staff assigned to your branch. Your Staff appointment capacity is enforced by the server.'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[520px]">
            <Metric label="Admins" value={admins.length} />
            <Metric label="Staff" value={staffMembers.length} />
            <Metric label="Trusted" value={trustedCount} />
            <Metric label="Needs attention" value={attentionCount} />
          </div>
        </div>
      </section>

      {creator ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.55fr)]">
          <div className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold">Admin Staff capacity</h4>
                <p className="mt-1 text-[10px] leading-relaxed text-[#6B7081]">This is a real backend limit on how many active Staff each Admin can appoint. Staff appointed directly by Creator do not consume an Admin's quota.</p>
              </div>
              <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-[9px] font-semibold text-violet-300">{staffLimit === 0 ? 'UNLIMITED' : `${staffLimit} / ADMIN`}</span>
            </div>
            <div className="mt-4 flex max-w-md gap-2">
              <input
                inputMode="numeric"
                value={limitDraft}
                onChange={(event) => setLimitDraft(event.target.value.replace(/[^0-9]/g, ''))}
                className="h-11 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-[#171A23] px-3 text-xs outline-none focus:border-violet-500/40"
                aria-label="Maximum Staff per Admin"
              />
              <button onClick={() => void saveLimit()} disabled={savingLimit} className="h-11 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold text-white disabled:opacity-40">
                {savingLimit ? 'Saving…' : 'Save limit'}
              </button>
            </div>
            <p className="mt-2 text-[9px] text-[#5E6475]">Use 0 for unlimited. You can change this without redeploying the website.</p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4">
            <h4 className="text-sm font-semibold">How appointment responsibility works</h4>
            <p className="mt-2 text-[10px] leading-relaxed text-[#6B7081]">An Admin's quota counts Staff that Admin appointed. Creator can still appoint or reorganise Staff directly. Branch changes send Staff back through trust review.</p>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-indigo-500/15 bg-indigo-500/[0.04] p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[9px] uppercase tracking-[.14em] text-indigo-300">YOUR APPOINTMENT CAPACITY</p>
              <p className="mt-2 text-xl font-bold">{ownUsed}{staffLimit === 0 ? '' : ` / ${staffLimit}`}</p>
              <p className="mt-1 text-[10px] text-[#6E7484]">{staffLimit === 0 ? 'Unlimited by Creator policy' : `${ownRemaining} appointment slot${ownRemaining === 1 ? '' : 's'} remaining`}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${staffLimit > 0 && ownRemaining === 0 ? 'bg-red-500/10 text-red-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
              {staffLimit > 0 && ownRemaining === 0 ? 'CAP REACHED' : 'AVAILABLE'}
            </span>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-white/[0.06] bg-[#0D1017] p-3 sm:p-4">
        <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_auto]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, ID or branch"
            className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#151821] px-3 text-xs outline-none focus:border-violet-500/40"
          />
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {creator && (
              <select value={filter} onChange={(event) => setFilter(event.target.value as TeamRole)} className="h-11 shrink-0 rounded-xl border border-white/[0.08] bg-[#151821] px-3 text-[10px]">
                <option value="all">All roles</option>
                <option value="admin">Admins</option>
                <option value="staff">Staff</option>
              </select>
            )}
            <select value={trustFilter} onChange={(event) => setTrustFilter(event.target.value as TrustFilter)} className="h-11 shrink-0 rounded-xl border border-white/[0.08] bg-[#151821] px-3 text-[10px]">
              <option value="all">All trust states</option>
              <option value="probation">Probation</option>
              <option value="trusted">Trusted</option>
              <option value="restricted">Restricted</option>
              <option value="revoked">Revoked</option>
            </select>
            {creator && (
              <>
                <select value={stateFilter} onChange={(event) => { setStateFilter(event.target.value); setLgaFilter(''); }} className="h-11 shrink-0 rounded-xl border border-white/[0.08] bg-[#151821] px-3 text-[10px]">
                  <option value="">All states</option>
                  {NIGERIA_STATES.map((item) => <option key={item.state} value={item.state}>{item.state}</option>)}
                </select>
                <select value={lgaFilter} disabled={!stateFilter} onChange={(event) => setLgaFilter(event.target.value)} className="h-11 shrink-0 rounded-xl border border-white/[0.08] bg-[#151821] px-3 text-[10px] disabled:opacity-40">
                  <option value="">All LGAs</option>
                  {(stateData?.cities || []).map((city) => <option key={city} value={city}>{city}</option>)}
                </select>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] text-[#6B7080]">{shown.length} matching team member{shown.length === 1 ? '' : 's'} · page {safePage} of {pageCount}</p>
        {creator && <p className="hidden text-[9px] text-[#555C6D] sm:block">Assign new Admin/Staff roles from People → open account</p>}
      </div>

      {pageRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] p-10 text-center text-xs text-[#66697B]">No team members match this view.</div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-white/[0.06] lg:block">
            <table className="w-full border-collapse text-left">
              <thead className="bg-[#11151D] text-[9px] uppercase tracking-[.12em] text-[#666D7E]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Team member</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Branch</th>
                  <th className="px-4 py-3 font-semibold">Responsibility</th>
                  <th className="px-4 py-3 font-semibold">Status / capacity</th>
                  <th className="px-4 py-3 text-right font-semibold">Manage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05] bg-[#0E1118]">
                {pageRows.map((person) => (
                  <TeamRow key={person.user_id} person={person} module={assigned[person.user_id] || ''} trust={trust[person.user_id]} staffLimit={staffLimit} appointedCount={appointedCount(person.user_id)} onManage={() => setSelected(person)} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 lg:hidden">
            {pageRows.map((person) => (
              <button key={person.user_id} onClick={() => setSelected(person)} className="flex w-full items-center gap-3 rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left">
                <Avatar person={person} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs font-semibold">{person.full_name || person.username || 'Team member'}</p>
                    <RoleBadge role={person.role || 'staff'} />
                  </div>
                  <p className="mt-1 truncate text-[9px] text-[#666D7E]">{[person.assigned_lga, person.assigned_state].filter(Boolean).join(', ') || 'No branch assigned'}</p>
                  <p className="mt-1 truncate text-[9px] text-[#818797]">{person.role === 'staff' ? `${MODULES[assigned[person.user_id]] || 'No module'} · ${(trust[person.user_id]?.status || 'probation').replace(/_/g, ' ')}` : staffLimit === 0 ? `${appointedCount(person.user_id)} Staff · unlimited` : `${appointedCount(person.user_id)} / ${staffLimit} Staff`}</p>
                </div>
                <span className="text-[#666D7E]">›</span>
              </button>
            ))}
          </div>
        </>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="h-10 rounded-xl border border-white/[0.08] px-4 text-[10px] disabled:opacity-30">Previous</button>
          <span className="px-2 text-[10px] text-[#777D8D]">{safePage} / {pageCount}</span>
          <button disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="h-10 rounded-xl border border-white/[0.08] px-4 text-[10px] disabled:opacity-30">Next</button>
        </div>
      )}

      {selected && (
        <ManageSheet
          person={selected}
          actor={profile}
          creator={creator}
          module={assigned[selected.user_id] || ''}
          trust={trust[selected.user_id]}
          staffLimit={staffLimit}
          appointedCount={appointedCount(selected.user_id)}
          saving={saving === selected.user_id}
          onClose={() => setSelected(null)}
          onModule={changeModule}
          onReassign={reassign}
          onReload={load}
        />
      )}
    </div>
  );
}

function TeamRow({ person, module, trust, staffLimit, appointedCount, onManage }: { person: Profile; module: string; trust?: TrustRow; staffLimit: number; appointedCount: number; onManage: () => void }) {
  return (
    <tr className="hover:bg-white/[0.018]">
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <Avatar person={person} />
          <div className="min-w-0">
            <p className="max-w-[220px] truncate text-[11px] font-semibold text-white">{person.full_name || person.username || 'Team member'}</p>
            <p className="mt-0.5 max-w-[220px] truncate text-[9px] text-[#606778]">{person.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5"><RoleBadge role={person.role || 'staff'} /></td>
      <td className="px-4 py-3.5 text-[10px] text-[#8A90A0]">{[person.assigned_lga, person.assigned_state].filter(Boolean).join(', ') || 'Unassigned'}</td>
      <td className="px-4 py-3.5 text-[10px] text-[#8A90A0]">{person.role === 'staff' ? MODULES[module] || 'No module' : 'Branch administration'}</td>
      <td className="px-4 py-3.5">
        {person.role === 'staff' ? <TrustBadge status={trust?.status || 'probation'} /> : <span className="text-[10px] text-[#8A90A0]">{staffLimit === 0 ? `${appointedCount} Staff · unlimited` : `${appointedCount} / ${staffLimit} Staff`}</span>}
      </td>
      <td className="px-4 py-3.5 text-right"><button onClick={onManage} className="rounded-xl border border-white/[0.08] px-3 py-2 text-[9px] font-semibold text-violet-300">Manage</button></td>
    </tr>
  );
}

function ManageSheet({ person, actor, creator, module, trust, staffLimit, appointedCount, saving, onClose, onModule, onReassign, onReload }: { person: Profile; actor: Profile; creator: boolean; module: string; trust?: TrustRow; staffLimit: number; appointedCount: number; saving: boolean; onClose: () => void; onModule: (id: string, value: string) => Promise<void>; onReassign: (person: Profile, state: string, lga: string) => Promise<void>; onReload: () => Promise<void> }) {
  const [state, setState] = useState(person.assigned_state || '');
  const [lga, setLga] = useState(person.assigned_lga || '');
  const stateData = NIGERIA_STATES.find((item) => item.state === state);
  const changed = state !== String(person.assigned_state || '') || lga !== String(person.assigned_lga || '');

  return (
    <div className="fixed inset-0 z-[100020] bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <aside className="absolute inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-3xl border-t border-white/[0.08] bg-[#0D1017] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[460px] sm:rounded-none sm:border-l sm:border-t-0 sm:p-5" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar person={person} large />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{person.full_name || person.username || 'Team member'}</p>
              <p className="mt-1 truncate text-[9px] text-[#666D7E]">{person.email}</p>
              <div className="mt-2"><RoleBadge role={person.role || 'staff'} /></div>
            </div>
          </div>
          <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full border border-white/[0.08] bg-white/[0.04] text-lg text-[#A7ACB8]">×</button>
        </div>

        <div className="mt-5 space-y-4">
          {person.role === 'admin' && (
            <section className="rounded-2xl border border-white/[0.06] bg-[#11151D] p-4">
              <p className="text-[9px] uppercase tracking-[.14em] text-[#666D7E]">Staff appointment capacity</p>
              <p className="mt-2 text-2xl font-bold">{appointedCount}{staffLimit === 0 ? '' : ` / ${staffLimit}`}</p>
              <p className="mt-1 text-[10px] text-[#6E7484]">{staffLimit === 0 ? 'Unlimited by current Creator policy' : `${Math.max(0, staffLimit - appointedCount)} slot${Math.max(0, staffLimit - appointedCount) === 1 ? '' : 's'} remaining`}</p>
            </section>
          )}

          {creator && (
            <section className="rounded-2xl border border-white/[0.06] bg-[#11151D] p-4">
              <p className="text-[10px] font-semibold">Branch assignment</p>
              <p className="mt-1 text-[9px] text-[#666D7E]">Changing a Staff branch sends that Staff member back through WeHouse trust review.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <select value={state} disabled={saving} onChange={(event) => { setState(event.target.value); setLga(''); }} className="h-11 rounded-xl border border-white/[0.08] bg-[#171A23] px-2 text-[10px]">
                  <option value="">State</option>
                  {NIGERIA_STATES.map((item) => <option key={item.state} value={item.state}>{item.state}</option>)}
                </select>
                <select value={lga} disabled={saving || !state} onChange={(event) => setLga(event.target.value)} className="h-11 rounded-xl border border-white/[0.08] bg-[#171A23] px-2 text-[10px]">
                  <option value="">LGA</option>
                  {(stateData?.cities || []).map((city) => <option key={city} value={city}>{city}</option>)}
                </select>
              </div>
              {changed && state && lga && <button disabled={saving} onClick={() => void onReassign(person, state, lga)} className="mt-2 h-10 w-full rounded-xl bg-violet-500 text-[10px] font-semibold text-white disabled:opacity-40">Save branch assignment</button>}
            </section>
          )}

          {person.role === 'staff' && (
            <section className="rounded-2xl border border-white/[0.06] bg-[#11151D] p-4">
              <p className="text-[10px] font-semibold">Operational responsibility</p>
              <p className="mt-1 text-[9px] text-[#666D7E]">Each Staff account owns one operational module. Avoid duplicate responsibilities across tabs.</p>
              <select value={module} disabled={saving} onChange={(event) => void onModule(person.user_id, event.target.value)} className="mt-3 h-11 w-full rounded-xl border border-white/[0.08] bg-[#171A23] px-3 text-[10px]">
                <option value="">No module</option>
                {Object.entries(MODULES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-black/10 p-3">
                <span className="text-[9px] text-[#666D7E]">Current trust state</span>
                <TrustBadge status={trust?.status || 'probation'} />
              </div>
            </section>
          )}

          {person.role === 'staff' && (
            <StaffTrustManager staff={person} actor={actor} />
          )}

          <button onClick={() => void onReload()} className="h-10 w-full rounded-xl border border-white/[0.08] text-[9px] font-semibold text-[#A1A7B5]">Refresh team data</button>
        </div>
      </aside>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-white/[0.05] bg-black/10 p-3"><p className="text-lg font-bold">{value}</p><p className="mt-1 text-[8px] uppercase tracking-wide text-[#62697A]">{label}</p></div>;
}

function Avatar({ person, large = false }: { person: Profile; large?: boolean }) {
  const text = person.full_name || person.username || person.email || 'W';
  const size = large ? 'h-14 w-14 rounded-2xl text-base' : 'h-10 w-10 rounded-xl text-xs';
  return <div className={`grid shrink-0 place-items-center overflow-hidden bg-gradient-to-br from-violet-500 to-indigo-600 font-bold ${size}`}>{person.avatar_url ? <img src={person.avatar_url} alt="" className="h-full w-full object-cover" /> : text[0].toUpperCase()}</div>;
}

function RoleBadge({ role }: { role: string }) {
  const admin = role === 'admin';
  return <span className={`rounded-full px-2 py-1 text-[8px] font-semibold uppercase ${admin ? 'bg-indigo-500/10 text-indigo-300' : 'bg-violet-500/10 text-violet-300'}`}>{admin ? 'Admin' : 'Staff'}</span>;
}

function TrustBadge({ status }: { status: string }) {
  const value = String(status || 'probation');
  const cls = value === 'trusted'
    ? 'bg-emerald-500/10 text-emerald-300'
    : value === 'restricted' || value === 'revoked'
      ? 'bg-red-500/10 text-red-300'
      : 'bg-amber-500/10 text-amber-300';
  return <span className={`rounded-full px-2 py-1 text-[8px] font-semibold capitalize ${cls}`}>{value.replace(/_/g, ' ')}</span>;
}
