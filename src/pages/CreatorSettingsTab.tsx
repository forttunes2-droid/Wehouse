import { useState, useEffect } from 'react';
import { supabase, getServiceCategories, getServiceSubcategories, createServiceCategory, updateServiceCategory, deleteServiceCategory, createServiceSubcategory, updateServiceSubcategory, deleteServiceSubcategory } from '@/lib/supabase';
import type { Profile, ServiceCategory, ServiceSubcategory } from '@/types';
import { Toaster, toast } from 'sonner';

interface CreatorSettingsTabProps {
  profile: Profile;
}

interface Setting {
  id: string;
  key: string;
  value: string;
  label: string;
  description: string;
  category: string;
  data_type: string;
}

const SETTING_CATEGORIES = [
  { id: 'company', label: 'Company', icon: '🏢' },
  { id: 'finance', label: 'Financial', icon: '💰' },
  { id: 'payment', label: 'Payment', icon: '💳' },
  { id: 'property', label: 'Property', icon: '🏠' },
  { id: 'worker', label: 'Workers', icon: '🔧' },
  { id: 'booking', label: 'Booking', icon: '📅' },
  { id: 'support', label: 'Support', icon: '🎧' },
  { id: 'notification', label: 'Notifications', icon: '🔔' },
  { id: 'legal', label: 'Legal', icon: '⚖️' },
  { id: 'toggle', label: 'Toggles', icon: '🎚️' },
  { id: 'appearance', label: 'Appearance', icon: '🎨' },
  { id: 'security', label: 'Security', icon: '🔒' },
];

type SettingsView = 'settings' | 'categories' | 'property_types';

export default function CreatorSettingsTab({ profile }: CreatorSettingsTabProps) {
  const [view, setView] = useState<SettingsView>('settings');

  return (
    <div className="space-y-4">
      <Toaster position="top-center" richColors theme="dark" />

      {/* View Switcher */}
      <div className="flex gap-2">
        <button
          onClick={() => setView('settings')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            view === 'settings'
              ? 'bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/20'
              : 'bg-[#12121A] text-[#5C5E72] border border-[#1E1E2C] hover:text-white'
          }`}
        >
          Platform Settings
        </button>
        <button
          onClick={() => setView('categories')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            view === 'categories'
              ? 'bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/20'
              : 'bg-[#12121A] text-[#5C5E72] border border-[#1E1E2C] hover:text-white'
          }`}
        >
          Service Categories
        </button>
        <button
          onClick={() => setView('property_types')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            view === 'property_types'
              ? 'bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/20'
              : 'bg-[#12121A] text-[#5C5E72] border border-[#1E1E2C] hover:text-white'
          }`}
        >
          Property Types
        </button>
      </div>

      {view === 'settings' ? <PlatformSettings profile={profile} /> : view === 'categories' ? <CategoryManager profile={profile} /> : <PropertyTypeManager profile={profile} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PLATFORM SETTINGS
// ═══════════════════════════════════════════════════════════════

function PlatformSettings({ profile: _profile }: { profile: Profile }) {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('company');
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_platform_settings');
    if (error) {
      toast.error('Failed to load settings: ' + error.message);
      setLoading(false);
      return;
    }
    setSettings(data || []);
    setLoading(false);
  }

  async function updateSetting(key: string, value: string) {
    setSaving(key);
    const { error } = await supabase.rpc('update_platform_setting', {
      p_key: key,
      p_value: value,
    });
    setSaving(null);
    if (error) {
      toast.error('Failed to save: ' + error.message);
      return;
    }
    setSettings(prev => prev.map(s => s.key === key ? { ...s, value } : s));
    toast.success('Saved');
  }

  const filteredSettings = search
    ? settings.filter(s =>
        s.label.toLowerCase().includes(search.toLowerCase()) ||
        s.key.toLowerCase().includes(search.toLowerCase()) ||
        s.description.toLowerCase().includes(search.toLowerCase())
      )
    : settings.filter(s => s.category === activeCategory);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-white">Platform Settings</h2>
        <p className="text-[11px] text-[#5C5E72]">Configure every aspect of WeHouse. No hardcoded values.</p>
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5C5E72]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search settings..."
          className="w-full h-10 rounded-xl bg-[#12121A] border border-[#1E1E2C] text-white text-sm pl-10 pr-4 placeholder-[#3A3A4A] focus:border-[#3B82F6]/50 outline-none"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5C5E72] text-xs">Clear</button>
        )}
      </div>

      {/* Category Tabs */}
      {!search && (
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
          {SETTING_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                activeCategory === cat.id
                  ? 'bg-[#3B82F6]/15 text-[#3B82F6]'
                  : 'bg-[#12121A] text-[#5C5E72] hover:text-white'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      )}

      {/* Settings List */}
      <div className="space-y-3">
        {filteredSettings.map(setting => (
          <SettingRow
            key={setting.key}
            setting={setting}
            saving={saving === setting.key}
            onUpdate={(value) => updateSetting(setting.key, value)}
          />
        ))}

        {filteredSettings.length === 0 && (
          <div className="text-center py-10">
            <p className="text-sm text-[#5C5E72]">{search ? 'No settings match your search' : 'No settings in this category'}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Individual Setting Row ──────────────────────────

function SettingRow({ setting, saving, onUpdate }: { setting: Setting; saving: boolean; onUpdate: (v: string) => void }) {
  const [localValue, setLocalValue] = useState(setting.value || '');

  useEffect(() => {
    setLocalValue(setting.value || '');
  }, [setting.value]);

  function handleSave() {
    onUpdate(localValue);
  }

  function handleToggle() {
    const newVal = localValue === 'true' ? 'false' : 'true';
    setLocalValue(newVal);
    onUpdate(newVal);
  }

  return (
    <div className="glass rounded-xl p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-white">{setting.label}</p>
            {saving && <div className="w-3 h-3 border border-[#3B82F6] border-t-transparent rounded-full animate-spin" />}
          </div>
          <p className="text-[10px] text-[#5C5E72] mt-0.5">{setting.description}</p>
          <p className="text-[9px] text-[#3A3A4A] mt-0.5 font-mono">{setting.key}</p>
        </div>

        <div className="flex-shrink-0">
          {setting.data_type === 'boolean' ? (
            <ToggleSwitch enabled={localValue === 'true'} onToggle={handleToggle} />
          ) : setting.data_type === 'textarea' ? (
            <div className="w-48">
              <textarea
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onBlur={handleSave}
                rows={3}
                className="w-full rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 py-2 placeholder-[#3A3A4A] focus:border-[#3B82F6]/50 outline-none resize-none"
              />
            </div>
          ) : setting.data_type === 'color' ? (
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={localValue || '#3B82F6'}
                onChange={(e) => { setLocalValue(e.target.value); onUpdate(e.target.value); }}
                className="w-8 h-8 rounded-lg border-0 cursor-pointer"
              />
              <span className="text-[10px] text-[#5C5E72] font-mono">{localValue}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type={setting.data_type === 'number' || setting.data_type === 'percentage' ? 'number' : setting.data_type === 'email' ? 'email' : setting.data_type === 'url' ? 'url' : 'text'}
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onBlur={handleSave}
                placeholder={setting.data_type === 'percentage' ? '%' : '...'}
                className="w-32 h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none"
              />
              {setting.data_type === 'percentage' && <span className="text-[10px] text-[#5C5E72]">%</span>}
              {setting.key.includes('_fee') && !setting.key.includes('_type') && <span className="text-[10px] text-[#5C5E72]">N</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CATEGORY MANAGER
// ═══════════════════════════════════════════════════════════════

function CategoryManager({ profile: _profile }: { profile: Profile }) {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [subcategories, setSubcategories] = useState<ServiceSubcategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(true);
  const [editingCat, setEditingCat] = useState<ServiceCategory | null>(null);
  const [editingSub, setEditingSub] = useState<ServiceSubcategory | null>(null);
  const [showCatForm, setShowCatForm] = useState(false);
  const [showSubForm, setShowSubForm] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', icon: '', sort_order: 0 });
  const [subForm, setSubForm] = useState({ name: '', category_id: '', sort_order: 0 });
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

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

  async function handleToggleActive(cat: ServiceCategory) {
    const { error } = await updateServiceCategory(cat.id, { is_active: !cat.is_active });
    if (error) {
      toast.error('Failed: ' + error.message);
      return;
    }
    setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, is_active: !c.is_active } : c));
    toast.success(cat.is_active ? 'Category hidden' : 'Category activated');
  }

  async function handleToggleSubActive(sub: ServiceSubcategory) {
    const { error } = await updateServiceSubcategory(sub.id, { is_active: !sub.is_active });
    if (error) {
      toast.error('Failed: ' + error.message);
      return;
    }
    setSubcategories(prev => prev.map(s => s.id === sub.id ? { ...s, is_active: !s.is_active } : s));
    toast.success(sub.is_active ? 'Subcategory hidden' : 'Subcategory activated');
  }

  async function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!catForm.name.trim()) { toast.error('Name is required'); return; }
    const { category, error } = await createServiceCategory(catForm.name.trim(), catForm.icon, catForm.sort_order);
    if (error) { toast.error('Failed: ' + error.message); return; }
    setCategories(prev => [...prev, category!]);
    setShowCatForm(false);
    setCatForm({ name: '', icon: '', sort_order: 0 });
    toast.success('Category created');
  }

  async function handleUpdateCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCat) return;
    const { error } = await updateServiceCategory(editingCat.id, {
      name: catForm.name.trim(),
      icon: catForm.icon,
      sort_order: catForm.sort_order,
    });
    if (error) { toast.error('Failed: ' + error.message); return; }
    setCategories(prev => prev.map(c => c.id === editingCat.id ? { ...c, name: catForm.name.trim(), icon: catForm.icon, sort_order: catForm.sort_order } : c));
    setEditingCat(null);
    setCatForm({ name: '', icon: '', sort_order: 0 });
    toast.success('Category updated');
  }

  async function handleDeleteCategory(id: string) {
    setDeleting(id);
    const { error } = await deleteServiceCategory(id);
    setDeleting(null);
    if (error) { toast.error('Failed: ' + error.message); return; }
    setCategories(prev => prev.filter(c => c.id !== id));
    setSubcategories(prev => prev.filter(s => s.category_id !== id));
    toast.success('Category deleted');
  }

  async function handleCreateSubcategory(e: React.FormEvent) {
    e.preventDefault();
    if (!subForm.name.trim() || !subForm.category_id) { toast.error('Name and category are required'); return; }
    const { subcategory, error } = await createServiceSubcategory(subForm.category_id, subForm.name.trim(), '', subForm.sort_order);
    if (error) { toast.error('Failed: ' + error.message); return; }
    setSubcategories(prev => [...prev, subcategory!]);
    setShowSubForm(false);
    setSubForm({ name: '', category_id: '', sort_order: 0 });
    toast.success('Subcategory created');
  }

  async function handleUpdateSubcategory(e: React.FormEvent) {
    e.preventDefault();
    if (!editingSub) return;
    const { error } = await updateServiceSubcategory(editingSub.id, {
      name: subForm.name.trim(),
      category_id: subForm.category_id,
      sort_order: subForm.sort_order,
    });
    if (error) { toast.error('Failed: ' + error.message); return; }
    setSubcategories(prev => prev.map(s => s.id === editingSub.id ? { ...s, name: subForm.name.trim(), category_id: subForm.category_id, sort_order: subForm.sort_order } : s));
    setEditingSub(null);
    setSubForm({ name: '', category_id: '', sort_order: 0 });
    toast.success('Subcategory updated');
  }

  async function handleDeleteSubcategory(id: string) {
    setDeleting(id);
    const { error } = await deleteServiceSubcategory(id);
    setDeleting(null);
    if (error) { toast.error('Failed: ' + error.message); return; }
    setSubcategories(prev => prev.filter(s => s.id !== id));
    toast.success('Subcategory deleted');
  }

  function startEditCat(cat: ServiceCategory) {
    setEditingCat(cat);
    setCatForm({ name: cat.name, icon: cat.icon || '', sort_order: cat.sort_order || 0 });
    setShowCatForm(true);
  }

  function startEditSub(sub: ServiceSubcategory) {
    setEditingSub(sub);
    setSubForm({ name: sub.name, category_id: sub.category_id, sort_order: sub.sort_order || 0 });
    setShowSubForm(true);
  }

  function openNewCat() {
    setEditingCat(null);
    setCatForm({ name: '', icon: '', sort_order: categories.length });
    setShowCatForm(true);
  }

  function openNewSub() {
    setEditingSub(null);
    setSubForm({ name: '', category_id: categories[0]?.id || '', sort_order: 0 });
    setShowSubForm(true);
  }

  const visibleCategories = showHidden ? categories : categories.filter(c => c.is_active);
  const activeCount = categories.filter(c => c.is_active).length;
  const hiddenCount = categories.filter(c => !c.is_active).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Service Categories</h2>
          <p className="text-[11px] text-[#5C5E72]">{activeCount} active · {hiddenCount} hidden · {subcategories.length} subcategories</p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleSwitch enabled={showHidden} onToggle={() => setShowHidden(!showHidden)} />
          <span className="text-[10px] text-[#5C5E72]">Show hidden</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button onClick={openNewCat} className="px-3 py-2 rounded-xl bg-[#3B82F6]/15 text-[#3B82F6] text-xs font-semibold border border-[#3B82F6]/20 hover:bg-[#3B82F6]/25 transition-colors">
          + New Category
        </button>
        <button onClick={openNewSub} className="px-3 py-2 rounded-xl bg-[#12121A] text-[#5C5E72] text-xs font-semibold border border-[#1E1E2C] hover:text-white transition-colors">
          + New Subcategory
        </button>
      </div>

      {/* Category Form */}
      {showCatForm && (
        <form onSubmit={editingCat ? handleUpdateCategory : handleCreateCategory} className="glass rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-white">{editingCat ? 'Edit Category' : 'New Category'}</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Name *</label>
              <input
                type="text"
                value={catForm.name}
                onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none"
                placeholder="e.g. Plumbing"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Icon (emoji)</label>
              <input
                type="text"
                value={catForm.icon}
                onChange={e => setCatForm(f => ({ ...f, icon: e.target.value }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none"
                placeholder="e.g. 🔧"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Sort Order</label>
              <input
                type="number"
                value={catForm.sort_order}
                onChange={e => setCatForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 rounded-lg bg-[#3B82F6] text-white text-xs font-semibold hover:bg-[#2563EB] transition-colors">
              {editingCat ? 'Update' : 'Create'}
            </button>
            <button type="button" onClick={() => { setShowCatForm(false); setEditingCat(null); }} className="px-4 py-1.5 rounded-lg bg-[#12121A] text-[#5C5E72] text-xs hover:text-white transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Subcategory Form */}
      {showSubForm && (
        <form onSubmit={editingSub ? handleUpdateSubcategory : handleCreateSubcategory} className="glass rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-white">{editingSub ? 'Edit Subcategory' : 'New Subcategory'}</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Name *</label>
              <input
                type="text"
                value={subForm.name}
                onChange={e => setSubForm(f => ({ ...f, name: e.target.value }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none"
                placeholder="e.g. Pipe Repair"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Parent Category *</label>
              <select
                value={subForm.category_id}
                onChange={e => setSubForm(f => ({ ...f, category_id: e.target.value }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none"
              >
                <option value="">Select...</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name} {c.is_active ? '' : '(hidden)'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Sort Order</label>
              <input
                type="number"
                value={subForm.sort_order}
                onChange={e => setSubForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 rounded-lg bg-[#3B82F6] text-white text-xs font-semibold hover:bg-[#2563EB] transition-colors">
              {editingSub ? 'Update' : 'Create'}
            </button>
            <button type="button" onClick={() => { setShowSubForm(false); setEditingSub(null); }} className="px-4 py-1.5 rounded-lg bg-[#12121A] text-[#5C5E72] text-xs hover:text-white transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Categories List */}
      <div className="space-y-3">
        {visibleCategories.map(cat => {
          const catSubs = subcategories.filter(s => s.category_id === cat.id);
          return (
            <div key={cat.id} className={`glass rounded-xl overflow-hidden ${!cat.is_active ? 'opacity-50' : ''}`}>
              {/* Category Header */}
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-xl">{cat.icon || '📦'}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-white">{cat.name}</p>
                      {!cat.is_active && (
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">HIDDEN</span>
                      )}
                    </div>
                    <p className="text-[10px] text-[#5C5E72]">{catSubs.length} subcategories · Order: {cat.sort_order ?? 0}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => handleToggleActive(cat)}
                    title={cat.is_active ? 'Hide category' : 'Show category'}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                      cat.is_active
                        ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                        : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                    }`}
                  >
                    {cat.is_active ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                    )}
                  </button>
                  <button onClick={() => startEditCat(cat)} className="w-8 h-8 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-[#3B82F6] transition-colors" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${cat.name}"? This will also delete ${catSubs.length} subcategories.`)) {
                        handleDeleteCategory(cat.id);
                      }
                    }}
                    disabled={deleting === cat.id}
                    className="w-8 h-8 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-red-400 transition-colors disabled:opacity-50"
                    title="Delete"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  </button>
                </div>
              </div>

              {/* Subcategories */}
              {catSubs.length > 0 && (
                <div className="border-t border-[#1E1E2C] px-3.5 py-2">
                  <p className="text-[9px] text-[#5C5E72] font-medium uppercase tracking-wider mb-2">Subcategories</p>
                  <div className="flex flex-wrap gap-1.5">
                    {catSubs.map(sub => (
                      <span
                        key={sub.id}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] ${
                          sub.is_active
                            ? 'bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20'
                            : 'bg-red-500/5 text-red-400/60 border border-red-500/10 line-through'
                        }`}
                      >
                        {sub.name}
                        <button onClick={() => handleToggleSubActive(sub)} title={sub.is_active ? 'Hide' : 'Show'} className="hover:opacity-70">
                          {sub.is_active ? '👁' : '🚫'}
                        </button>
                        <button onClick={() => startEditSub(sub)} className="hover:opacity-70">✏️</button>
                        <button onClick={() => { if (confirm(`Delete "${sub.name}"?`)) handleDeleteSubcategory(sub.id); }} className="hover:opacity-70">🗑</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {visibleCategories.length === 0 && (
          <div className="text-center py-10">
            <p className="text-sm text-[#5C5E72]">No categories found</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROPERTY TYPE MANAGER
// ═══════════════════════════════════════════════════════════════

function PropertyTypeManager({ profile: _profile }: { profile: Profile }) {
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newType, setNewType] = useState('');

  const ICON_MAP: Record<string, string> = {
    apartment: '🏢', hotel: '🏨', house: '🏠', duplex: '🏘️',
    studio: '🛋️', self_contain: '🚪', 'self-contain': '🚪',
    hostel: '🛏️', lodge: '🏕️', resort: '🏖️',
    office: '🏢', warehouse: '🏭', land: '🌿',
    short_let: '⏱️', long_stay: '📅',
  };

  function toLabel(value: string): string {
    return value.split(/[_\-]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  function getIcon(value: string): string {
    return ICON_MAP[value] || '🏠';
  }

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_platform_setting', { p_key: 'property_types_allowed' });
    if (!error && data) {
      try {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) { setTypes(parsed); setLoading(false); return; }
      } catch { /* ignore */ }
    }
    // Fallback defaults
    setTypes(['apartment', 'house', 'duplex', 'studio', 'self_contain', 'office', 'warehouse', 'land', 'hotel', 'hostel', 'lodge', 'resort']);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function saveTypes(newTypes: string[]) {
    setSaving(true);
    const { error } = await supabase.rpc('update_platform_setting', {
      p_key: 'property_types_allowed',
      p_value: JSON.stringify(newTypes),
    });
    setSaving(false);
    if (error) { toast.error('Failed to save: ' + error.message); return false; }
    setTypes(newTypes);
    toast.success('Property types saved');
    return true;
  }

  function handleAdd() {
    const clean = newType.trim().toLowerCase().replace(/\s+/g, '_');
    if (!clean) { toast.error('Enter a property type'); return; }
    if (types.includes(clean)) { toast.error('Type already exists'); return; }
    const updated = [...types, clean];
    saveTypes(updated);
    setNewType('');
  }

  function handleRemove(value: string) {
    if (!confirm(`Remove "${toLabel(value)}"? Existing listings using this type will still work.`)) return;
    const updated = types.filter(t => t !== value);
    saveTypes(updated);
  }

  function handleMove(index: number, direction: -1 | 1) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= types.length) return;
    const updated = [...types];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    saveTypes(updated);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Property Types</h2>
          <p className="text-[11px] text-[#5C5E72]">{types.length} types configured. These appear when creating listings and partner registrations.</p>
        </div>
        {saving && <div className="w-5 h-5 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />}
      </div>

      {/* Add new type */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newType}
          onChange={e => setNewType(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="e.g. Penthouse, Bungalow..."
          className="flex-1 h-10 rounded-xl bg-[#12121A] border border-[#1E1E2C] text-white text-sm px-4 placeholder-[#3A3A4A] focus:border-[#3B82F6]/50 outline-none"
        />
        <button
          onClick={handleAdd}
          className="h-10 px-4 rounded-xl bg-[#3B82F6]/15 text-[#3B82F6] text-xs font-semibold border border-[#3B82F6]/20 hover:bg-[#3B82F6]/25 transition-colors"
        >
          + Add Type
        </button>
      </div>

      {/* Types list */}
      <div className="space-y-2">
        {types.map((t, i) => (
          <div key={t} className="glass rounded-xl p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xl">{getIcon(t)}</span>
              <div>
                <p className="text-xs font-medium text-white">{toLabel(t)}</p>
                <p className="text-[10px] text-[#5C5E72] font-mono">{t}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleMove(i, -1)}
                disabled={i === 0}
                className="w-7 h-7 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-white disabled:opacity-30 transition-colors"
                title="Move up"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6" /></svg>
              </button>
              <button
                onClick={() => handleMove(i, 1)}
                disabled={i === types.length - 1}
                className="w-7 h-7 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-white disabled:opacity-30 transition-colors"
                title="Move down"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              <button
                onClick={() => handleRemove(t)}
                className="w-7 h-7 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-red-400 transition-colors"
                title="Remove"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              </button>
            </div>
          </div>
        ))}

        {types.length === 0 && (
          <div className="text-center py-10">
            <p className="text-sm text-[#5C5E72]">No property types configured</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Toggle Switch ──────────────────────────────────

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-10 h-5.5 rounded-full transition-colors ${enabled ? 'bg-[#10B981]' : 'bg-[#2A2A3A]'}`}
    >
      <div className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}
