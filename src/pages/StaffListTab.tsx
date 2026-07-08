import { useState, useEffect } from 'react';
import { getAllUsers } from '@/lib/supabase/admin';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

const MODULE_LABELS: Record<string, string> = {
  operations: 'Operations',
  finance: 'Finance',
  support: 'Support',
  verification: 'Verification',
  field_officer: 'Field Officer',
};

export default function StaffListTab() {
  const [staff, setStaff] = useState<Profile[]>([]);
  const [staffModules, setStaffModules] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => { loadStaff(); }, []);

  async function loadStaff() {
    setLoading(true);
    const { users, error } = await getAllUsers();
    if (!error && users) {
      const staffList = users.filter((u: any) => u.role === 'staff') as Profile[];
      setStaff(staffList);

      // Fetch modules for all staff
      if (staffList.length > 0) {
        const ids = staffList.map(s => s.user_id);
        const { data: mods } = await supabase.from('staff_modules').select('*').in('staff_id', ids).is('revoked_at', null);
        const moduleMap: Record<string, string[]> = {};
        (mods || []).forEach((m: any) => {
          if (!moduleMap[m.staff_id]) moduleMap[m.staff_id] = [];
          moduleMap[m.staff_id].push(m.module);
        });
        setStaffModules(moduleMap);
      }
    }
    setLoading(false);
  }

  async function toggleModule(staffId: string, module: string) {
    setSaving(staffId + module);
    const current = staffModules[staffId] || [];
    const hasModule = current.includes(module);

    if (hasModule) {
      await supabase.from('staff_modules').update({ revoked_at: new Date().toISOString() }).eq('staff_id', staffId).eq('module', module).is('revoked_at', null);
      setStaffModules(prev => ({ ...prev, [staffId]: (prev[staffId] || []).filter(m => m !== module) }));
    } else {
      await supabase.from('staff_modules').insert({ staff_id: staffId, module });
      setStaffModules(prev => ({ ...prev, [staffId]: [...(prev[staffId] || []), module] }));
    }
    setSaving(null);
  }

  if (loading) {
    return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (staff.length === 0) {
    return <div className="text-center py-10"><p className="text-sm text-[#5C5E72]">No staff members found</p></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Staff Members</h3>
        <span className="text-[10px] text-[#5C5E72]">{staff.length} total</span>
      </div>
      <p className="text-[10px] text-[#5C5E72]">Click a module to assign or revoke. Staff only sees their assigned modules.</p>
      {staff.map(s => {
        const modules = staffModules[s.user_id] || [];
        return (
          <div key={s.user_id} className="glass rounded-xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-xs font-bold">
                {(s.username || 'S').charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-xs font-medium text-white">@{s.username}</p>
                <p className="text-[10px] text-[#5C5E72]">{s.email}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(MODULE_LABELS).map(([key, label]) => {
                const active = modules.includes(key);
                return (
                  <button key={key} onClick={() => toggleModule(s.user_id, key)} disabled={saving === s.user_id + key}
                    className={`h-7 px-2.5 rounded-lg text-[10px] font-medium border transition-all ${
                      active ? 'bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/30' : 'bg-[#1A1A24] text-[#5C5E72] border-[#2A2A3A] hover:border-[#3B82F6]/20'
                    }`}>
                    {saving === s.user_id + key ? '...' : (active ? '✓ ' : '+ ') + label}
                  </button>
                );
              })}
            </div>
            {modules.length === 0 && <p className="text-[9px] text-[#5C5E72] mt-1">No modules assigned</p>}
          </div>
        );
      })}
    </div>
  );
}
