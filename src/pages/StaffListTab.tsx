import { useState, useEffect } from 'react';
import { getAllUsers } from '@/lib/supabase/admin';
import type { Profile } from '@/types';

export default function StaffListTab() {
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStaff();
  }, []);

  async function loadStaff() {
    setLoading(true);
    const { users, error } = await getAllUsers();
    if (!error && users) {
      setStaff(users.filter((u: any) => u.role === 'staff') as Profile[]);
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (staff.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-sm text-[#5C5E72]">No staff members found</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Staff Members</h3>
        <span className="text-[10px] text-[#5C5E72]">{staff.length} total</span>
      </div>
      {staff.map(s => (
        <div key={s.user_id} className="glass rounded-xl p-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-xs font-bold">
              {(s.username || 'S').charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-xs font-medium text-white">@{s.username}</p>
              <p className="text-[10px] text-[#5C5E72]">{s.email}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
