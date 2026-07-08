import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Toaster, toast } from 'sonner';

interface PropertyType {
  id: number;
  name: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
}

const DEFAULT_TYPES: PropertyType[] = [
  { id: 1, name: 'Houses', icon: 'house', sort_order: 1, is_active: true },
  { id: 2, name: 'Apartments', icon: 'apartment', sort_order: 2, is_active: true },
  { id: 3, name: 'Hotels', icon: 'hotel', sort_order: 3, is_active: true },
  { id: 4, name: 'Workers', icon: 'worker', sort_order: 4, is_active: true },
  { id: 5, name: 'Roommates', icon: 'roommate', sort_order: 5, is_active: true },
];

const ICONS: Record<string, string> = {
  house: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  apartment: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  hotel: 'M18 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2zM9 7h6M9 11h6M9 15h6',
  worker: 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z',
  roommate: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75M9 7a4 4 0 110-8 4 4 0 010 8z',
};

export default function PropertyTypeManager({ profile: _profile }: { profile: Profile }) {
  const [types, setTypes] = useState<PropertyType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newType, setNewType] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('property_types').select('*').order('sort_order');
    if (!error && data && data.length > 0) {
      setTypes(data as PropertyType[]);
    } else {
      setTypes(DEFAULT_TYPES);
    }
    setLoading(false);
  }

  async function saveTypes() {
    setSaving(true);
    for (const t of types) {
      await supabase.from('property_types').upsert({
        id: t.id,
        name: t.name,
        icon: t.icon,
        sort_order: t.sort_order,
        is_active: t.is_active,
        updated_at: new Date().toISOString(),
      });
    }
    setSaving(false);
    toast.success('Property types saved');
  }

  async function deleteType(id: number) {
    await supabase.from('property_types').delete().eq('id', id);
    setTypes(prev => prev.filter(t => t.id !== id));
    toast.success('Property type deleted');
  }

  function addType() {
    if (!newType.trim()) return;
    const newId = Math.max(...types.map(t => t.id), 0) + 1;
    setTypes(prev => [...prev, {
      id: newId,
      name: newType.trim(),
      icon: 'house',
      sort_order: newId,
      is_active: true,
    }]);
    setNewType('');
  }

  function toggleActive(id: number) {
    setTypes(prev => prev.map(t => t.id === id ? { ...t, is_active: !t.is_active } : t));
  }

  function moveUp(id: number) {
    const idx = types.findIndex(t => t.id === id);
    if (idx <= 0) return;
    const newTypes = [...types];
    [newTypes[idx], newTypes[idx - 1]] = [newTypes[idx - 1], newTypes[idx]];
    // Reassign sort_order
    newTypes.forEach((t, i) => t.sort_order = i + 1);
    setTypes(newTypes);
  }

  function moveDown(id: number) {
    const idx = types.findIndex(t => t.id === id);
    if (idx >= types.length - 1) return;
    const newTypes = [...types];
    [newTypes[idx], newTypes[idx + 1]] = [newTypes[idx + 1], newTypes[idx]];
    newTypes.forEach((t, i) => t.sort_order = i + 1);
    setTypes(newTypes);
  }

  if (loading) {
    return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <Toaster position="top-center" richColors theme="dark" />
      <p className="text-[11px] text-[#5C5E72]">Manage property types shown in Explore. Drag to reorder, toggle to show/hide. Changes sync to the Explore page.</p>

      {/* Add new */}
      <div className="flex gap-2">
        <input
          value={newType}
          onChange={e => setNewType(e.target.value)}
          placeholder="New property type..."
          className="flex-1 h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-[#3B82F6]/50 outline-none"
        />
        <button onClick={addType}
          className="h-10 px-4 rounded-xl bg-[#3B82F6] text-white text-xs font-semibold hover:bg-[#2563EB] transition-colors">
          Add
        </button>
      </div>

      {/* List */}
      <div className="space-y-2">
        {types.map((t, idx) => (
          <div key={t.id} className={`glass rounded-xl p-3 flex items-center gap-3 ${!t.is_active ? 'opacity-50' : ''}`}>
            {/* Order */}
            <span className="text-[10px] text-[#5C5E72] w-4 text-center">{idx + 1}</span>

            {/* Icon */}
            <div className="w-8 h-8 rounded-lg bg-[#1A1A24] flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2">
                <path d={ICONS[t.icon] || ICONS.house} />
              </svg>
            </div>

            {/* Name */}
            <span className="flex-1 text-xs text-white">{t.name}</span>

            {/* Status */}
            <button onClick={() => toggleActive(t.id)}
              className={`text-[9px] px-2 py-0.5 rounded-full ${t.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              {t.is_active ? 'Active' : 'Hidden'}
            </button>

            {/* Move */}
            <div className="flex gap-0.5">
              <button onClick={() => moveUp(t.id)} disabled={idx === 0}
                className="w-6 h-6 rounded bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-white disabled:opacity-20">↑</button>
              <button onClick={() => moveDown(t.id)} disabled={idx === types.length - 1}
                className="w-6 h-6 rounded bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-white disabled:opacity-20">↓</button>
            </div>

            {/* Delete */}
            <button onClick={() => deleteType(t.id)}
              className="w-6 h-6 rounded bg-red-500/10 flex items-center justify-center text-red-400 hover:bg-red-500/20">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
        ))}
      </div>

      {/* Save */}
      <button onClick={saveTypes} disabled={saving}
        className="w-full h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
        {saving ? 'Saving...' : 'Save Property Types'}
      </button>
    </div>
  );
}
