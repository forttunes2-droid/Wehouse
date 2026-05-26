import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';

interface School {
  id: string;
  name: string;
  state: string;
  lga: string;
  campus: string | null;
}

interface SchoolSelectorProps {
  value: {
    school_name: string;
    campus: string;
    faculty: string;
    department: string;
    level: string;
  };
  onChange: (v: {
    school_name: string;
    campus: string;
    faculty: string;
    department: string;
    level: string;
  }) => void;
}

const LEVELS = ['100', '200', '300', '400', '500', '600', 'PG'];

export default function SchoolSelector({ value, onChange }: SchoolSelectorProps) {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabase.from('schools').select('*').eq('active', true).order('name');
      setSchools(data || []);
      setLoading(false);
    }
    load();
  }, []);

  // Get unique school names
  const schoolNames = useMemo(() => {
    const names = new Set<string>();
    schools.forEach(s => names.add(s.name));
    return Array.from(names).sort();
  }, [schools]);

  // Get campuses for selected school
  const campuses = useMemo(() => {
    if (!value.school_name) return [];
    const camps = new Set<string>();
    schools.filter(s => s.name === value.school_name).forEach(s => {
      if (s.campus) camps.add(s.campus);
    });
    return Array.from(camps).sort();
  }, [schools, value.school_name]);

  const update = (key: string, val: string) => {
    onChange({ ...value, [key]: val });
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] animate-pulse" />
        <div className="h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* School */}
      <div>
        <label className="text-[10px] text-[#5C5E72] mb-1 block">School / Institution</label>
        <select
          value={value.school_name}
          onChange={(e) => {
            update('school_name', e.target.value);
            update('campus', ''); // Reset campus on school change
          }}
          className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 focus:border-[#3B82F6]/50 outline-none appearance-none"
        >
          <option value="">Select your school</option>
          {schoolNames.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>

      {/* Campus */}
      {value.school_name && campuses.length > 0 && (
        <div>
          <label className="text-[10px] text-[#5C5E72] mb-1 block">Campus</label>
          <div className="flex gap-2 flex-wrap">
            {campuses.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => update('campus', c)}
                className={`h-9 px-4 rounded-xl text-xs font-medium transition-all ${
                  value.campus === c
                    ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white shadow-lg shadow-blue-500/20'
                    : 'bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Faculty & Department */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-[#5C5E72] mb-1 block">Faculty</label>
          <input
            value={value.faculty}
            onChange={(e) => update('faculty', e.target.value)}
            placeholder="e.g. Forestry"
            className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] text-[#5C5E72] mb-1 block">Department</label>
          <input
            value={value.department}
            onChange={(e) => update('department', e.target.value)}
            placeholder="e.g. Forestry"
            className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
          />
        </div>
      </div>

      {/* Level */}
      <div>
        <label className="text-[10px] text-[#5C5E72] mb-1 block">Level</label>
        <div className="flex gap-2 flex-wrap">
          {LEVELS.map(l => (
            <button
              key={l}
              type="button"
              onClick={() => update('level', l)}
              className={`h-9 px-4 rounded-xl text-xs font-medium transition-all ${
                value.level === l
                  ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white shadow-lg shadow-blue-500/20'
                  : 'bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'
              }`}
            >
              {l}L
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
