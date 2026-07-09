import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getServiceCategories, getServiceSubcategories, createServiceCategory, createServiceSubcategory, deleteServiceCategory, deleteServiceSubcategory, updateServiceCategory, updateServiceSubcategory } from '@/lib/supabase';
import type { Profile, ServiceCategory, ServiceSubcategory } from '@/types';
import { Toaster, toast } from 'sonner';

interface ServiceCategoryManagerProps {
  profile: Profile;
}

export default function ServiceCategoryManager({ profile: _profile }: ServiceCategoryManagerProps) {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [subcategories, setSubcategories] = useState<ServiceSubcategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCategory, setNewCategory] = useState('');
  const [newSubcategory, setNewSubcategory] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [{ categories: cats }, { subcategories: subs }] = await Promise.all([
      getServiceCategories(true),
      getServiceSubcategories(undefined, true),
    ]);
    setCategories(cats || []);
    setSubcategories(subs || []);
    setLoading(false);
  }

  async function addCategory() {
    if (!newCategory.trim()) return;
    setSaving(true);
    const { category, error } = await createServiceCategory(newCategory.trim(), '', categories.length + 1);
    setSaving(false);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Category added');
    setNewCategory('');
    load();
  }

  async function addSubcategory() {
    if (!newSubcategory.trim() || !selectedCategory) return;
    setSaving(true);
    const catSubs = subcategories.filter(s => s.category_id === selectedCategory);
    const { error } = await createServiceSubcategory(selectedCategory, newSubcategory.trim(), '', catSubs.length + 1);
    setSaving(false);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Subcategory added');
    setNewSubcategory('');
    load();
  }

  async function toggleCategory(id: string, isActive: boolean) {
    const { error } = await updateServiceCategory(id, { is_active: !isActive });
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success(isActive ? 'Category hidden' : 'Category activated');
    load();
  }

  async function toggleSubcategory(id: string, isActive: boolean) {
    const { error } = await updateServiceSubcategory(id, { is_active: !isActive });
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success(isActive ? 'Subcategory hidden' : 'Subcategory activated');
    load();
  }

  async function removeCategory(id: string) {
    if (!confirm('Delete this category and all its subcategories?')) return;
    const { error } = await deleteServiceCategory(id);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Category deleted');
    load();
  }

  async function removeSubcategory(id: string) {
    if (!confirm('Delete this subcategory?')) return;
    const { error } = await deleteServiceSubcategory(id);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Subcategory deleted');
    load();
  }

  if (loading) {
    return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <Toaster position="top-center" richColors theme="dark" />
      <p className="text-[11px] text-[#5C5E72]">Manage worker service categories and subcategories. Workers select these when registering.</p>

      {/* Add Category */}
      <div className="flex gap-2">
        <input
          value={newCategory}
          onChange={e => setNewCategory(e.target.value)}
          placeholder="New category (e.g. Electrical, Plumbing)..."
          className="flex-1 h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-[#3B82F6]/50 outline-none"
        />
        <button onClick={addCategory} disabled={saving}
          className="h-10 px-4 rounded-xl bg-[#3B82F6] text-white text-xs font-semibold hover:bg-[#2563EB] transition-colors disabled:opacity-40">
          Add
        </button>
      </div>

      {/* Categories List */}
      <div className="space-y-3">
        {categories.map(cat => {
          const catSubs = subcategories.filter(s => s.category_id === cat.id);
          return (
            <div key={cat.id} className={`glass rounded-xl p-3 ${!cat.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="flex-1 text-xs font-semibold text-white">{cat.name}</span>
                <button onClick={() => toggleCategory(cat.id, cat.is_active)}
                  className={`text-[9px] px-2 py-0.5 rounded-full ${cat.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                  {cat.is_active ? 'Active' : 'Hidden'}
                </button>
                <button onClick={() => removeCategory(cat.id)}
                  className="w-6 h-6 rounded bg-red-500/10 flex items-center justify-center text-red-400 hover:bg-red-500/20">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>

              {/* Subcategories */}
              <div className="pl-3 space-y-1 border-l border-white/[0.04]">
                {catSubs.map(sub => (
                  <div key={sub.id} className="flex items-center gap-2">
                    <span className="flex-1 text-[10px] text-[#8A8B9C]">{sub.name}</span>
                    <button onClick={() => toggleSubcategory(sub.id, sub.is_active)}
                      className={`text-[8px] px-1.5 py-0.5 rounded-full ${sub.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                      {sub.is_active ? 'On' : 'Off'}
                    </button>
                    <button onClick={() => removeSubcategory(sub.id)}
                      className="w-5 h-5 rounded bg-red-500/10 flex items-center justify-center text-red-400 hover:bg-red-500/20">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {categories.length === 0 && (
          <div className="text-center py-10">
            <p className="text-sm text-[#5C5E72]">No categories yet</p>
            <p className="text-[10px] text-[#3A3A4A] mt-1">Add your first service category above</p>
          </div>
        )}
      </div>

      {/* Add Subcategory */}
      <div className="flex gap-2">
        <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
          className="h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-[#3B82F6]/50 outline-none">
          <option value="">Select category...</option>
          {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
        </select>
        <input
          value={newSubcategory}
          onChange={e => setNewSubcategory(e.target.value)}
          placeholder="New subcategory..."
          className="flex-1 h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-[#3B82F6]/50 outline-none"
        />
        <button onClick={addSubcategory} disabled={saving || !selectedCategory}
          className="h-10 px-4 rounded-xl bg-[#3B82F6] text-white text-xs font-semibold hover:bg-[#2563EB] transition-colors disabled:opacity-40">
          Add
        </button>
      </div>
    </div>
  );
}
