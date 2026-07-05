import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
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

const CATEGORIES = [
  { id: 'company', label: 'Company Info', icon: '🏢' },
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

export default function CreatorSettingsTab({ profile }: CreatorSettingsTabProps) {
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
      p_updated_by: profile.user_id,
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
      <Toaster position="top-center" richColors theme="dark" />

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
          {CATEGORIES.map(cat => (
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
