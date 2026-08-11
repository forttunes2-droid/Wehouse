import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { toast } from 'sonner';

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
  const [deletedIds, setDeletedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newType, setNewType] = useState('');
  const [usingDefaults, setUsingDefaults] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('property_types').select('*').order('sort_order');
    if (error) {
      toast.error(`Failed to load property types: ${error.message}`);
      setTypes([]);
      setUsingDefaults(false);
    } else if (data && data.length > 0) {
      setTypes(data as PropertyType[]);
      setUsingDefaults(false);
    } else {
      // Defaults are a draft only. Opening Settings must never mutate the DB.
      setTypes(DEFAULT_TYPES.map(type => ({ ...type })));
      setUsingDefaults(true);
    }
    setDeletedIds([]);
    setLoading(false);
  }

  async function saveTypes() {
    setSaving(true);
    const errors: string[] = [];

    for (const type of types) {
      const { error } = await supabase.from('property_types').upsert({
        id: type.id,
        name: type.name,
        icon: type.icon,
        sort_order: type.sort_order,
        is_active: type.is_active,
        updated_at: new Date().toISOString(),
      });
      if (error) errors.push(`Save ${type.name}: ${error.message}`);
    }

    for (const id of deletedIds) {
      const { error } = await supabase.from('property_types').delete().eq('id', id);
      if (error) errors.push(`Delete #${id}: ${error.message}`);
    }

    setSaving(false);
    if (errors.length) {
      toast.error(`Some property-type changes failed: ${errors.join('; ')}`);
      return;
    }

    setDeletedIds([]);
    setUsingDefaults(false);
    toast.success('Property types saved');
    void load();
  }

  function deleteType(id: number) {
    setTypes(prev => prev.filter(type => type.id !== id));
    if (!usingDefaults) setDeletedIds(prev => prev.includes(id) ? prev : [...prev, id]);
  }

  function addType() {
    const name = newType.trim();
    if (!name) return;
    if (types.some(type => type.name.trim().toLowerCase() === name.toLowerCase())) return toast.error('That property type already exists');
    const id = Math.max(...types.map(type => type.id), 0) + 1;
    setTypes(prev => [...prev, { id, name, icon: 'house', sort_order: prev.length + 1, is_active: true }]);
    setNewType('');
  }

  function toggleActive(id: number) {
    setTypes(prev => prev.map(type => type.id === id ? { ...type, is_active: !type.is_active } : type));
  }

  function move(id: number, direction: -1 | 1) {
    const index = types.findIndex(type => type.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= types.length) return;
    const next = types.map(type => ({ ...type }));
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    next.forEach((type, position) => { type.sort_order = position + 1; });
    setTypes(next);
  }

  if (loading) return <div className="grid min-h-32 place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>;

  return <div className="space-y-4">
    <p className="text-[10px] leading-relaxed text-[#666A7C]">Property types shown across WeHouse. Changes stay as a draft until you press Save.</p>

    {usingDefaults && <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.05] p-3"><p className="text-[10px] text-amber-300">No property types are stored yet. The defaults below are only a preview until you save them.</p></div>}
    {deletedIds.length > 0 && <div className="rounded-xl border border-red-500/15 bg-red-500/[0.05] p-3"><p className="text-[10px] text-red-300">{deletedIds.length} saved type{deletedIds.length === 1 ? '' : 's'} will be deleted when you save.</p></div>}

    <div className="flex flex-col gap-2 sm:flex-row">
      <input value={newType} onChange={event => setNewType(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addType(); }} placeholder="New property type" className="h-10 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-[#171A23] px-3 text-xs text-white outline-none focus:border-violet-500/40" />
      <button onClick={addType} className="h-10 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold text-white">Add type</button>
    </div>

    <div className="space-y-2">
      {types.map((type, index) => <div key={type.id} className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-white/[0.06] bg-[#151821] p-3 ${!type.is_active ? 'opacity-55' : ''}`}>
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.04]"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={ICONS[type.icon] || ICONS.house} /></svg></div>
        <div className="min-w-0"><p className="truncate text-xs font-medium text-white">{type.name}</p><p className="mt-1 text-[9px] text-[#5F6375]">Position {index + 1}</p></div>
        <div className="flex flex-wrap justify-end gap-1">
          <button onClick={() => toggleActive(type.id)} className={`rounded-lg px-2 py-1.5 text-[9px] font-semibold ${type.is_active ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/[0.05] text-[#777B8E]'}`}>{type.is_active ? 'Active' : 'Hidden'}</button>
          <button onClick={() => move(type.id, -1)} disabled={index === 0} className="h-7 w-7 rounded-lg bg-white/[0.04] text-[10px] text-[#8A8E9E] disabled:opacity-20">↑</button>
          <button onClick={() => move(type.id, 1)} disabled={index === types.length - 1} className="h-7 w-7 rounded-lg bg-white/[0.04] text-[10px] text-[#8A8E9E] disabled:opacity-20">↓</button>
          <button onClick={() => deleteType(type.id)} className="h-7 rounded-lg bg-red-500/10 px-2 text-[9px] text-red-300">Delete</button>
        </div>
      </div>)}
    </div>

    <button onClick={() => void saveTypes()} disabled={saving || types.length === 0} className="h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold text-white disabled:opacity-40">{saving ? 'Saving…' : 'Save property types'}</button>
  </div>;
}
