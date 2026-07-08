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

  async function assignModule(staffId: string, module: string) {
    setSaving(staffId);
    const current = staffModules[staffId] || [];
    const hasModule = current.includes(module);

    // Per Constitution: Staff can only have ONE module at a time
    // If assigning a new module, revoke all existing ones first
    if (!hasModule) {
      // Revoke ALL existing modules
      await supabase.from('staff_modules').update({ revoked_at: new Date().toISOString() }).eq('staff_id', staffId).is('revoked_at', null);
      // Grant only the selected module
      await supabase.from('staff_modules').insert({ staff_id: staffId, module });
      setStaffModules(prev => ({ ...prev, [staffId]: [module] }));
    } else {
      // Revoking the only module
      await supabase.from('staff_modules').update({ revoked_at: new Date().toISOString() }).eq('staff_id', staffId).eq('module', module).is('revoked_at', null);
      setStaffModules(prev => ({ ...prev, [staffId]: [] }));
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
      <p className="text-[10px] text-[#5C5E72]">Each staff member can have ONE module only. Select to assign, select again to remove.</p>
      {staff.map(s => {
        const modules = staffModules[s.user_id] || [];
        const currentModule = modules[0] || null;
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
            {/* Single-select module dropdown */}
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-[#5C5E72] flex-shrink-0">Module:</label>
              <select
                value={currentModule || ''}
                onChange={(e) => assignModule(s.user_id, e.target.value)}
                disabled={saving === s.user_id}
                className="flex-1 h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-[11px] px-2 focus:border-[#3B82F6]/50 outline-none"
              >
                <option value="">No module assigned</option>
                {Object.entries(MODULE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              {saving === s.user_id && <div className="w-4 h-4 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin flex-shrink-0" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
