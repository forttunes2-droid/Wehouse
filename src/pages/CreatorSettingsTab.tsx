import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { invalidateSettingsCache } from '@/hooks/usePlatformSettings';
import type { Profile } from '@/types';
import { Toaster, toast } from 'sonner';

// ═══════════════════════════════════════════════════════════════
// CREATOR GLOBAL SETTINGS — Final Architecture
// 7 controls, 3 sections. Domain settings moved to their modules.
// ═══════════════════════════════════════════════════════════════

interface SettingDef {
  key: string;
  label: string;
  description: string;
  type: 'text' | 'toggle' | 'textarea' | 'email';
  defaultValue: string;
}

interface DbSetting {
  id: number;
  key: string;
  value: string;
  category: string;
  label: string;
  description: string;
  data_type: string;
  is_active: boolean;
}

// ═══════════════════════════════════════════════════════════════
// FINAL GLOBAL SETTINGS — 7 controls only
// ═══════════════════════════════════════════════════════════════

const SETTING_GROUPS: { id: string; label: string; settings: SettingDef[] }[] = [
  {
    id: 'identity',
    label: 'Platform Identity',
    settings: [
      { key: 'company_name', label: 'Company Name', description: 'Platform company name displayed to all users', type: 'text', defaultValue: 'WeHouse' },
      { key: 'support_email', label: 'Support Email', description: 'Primary contact email for the platform', type: 'email', defaultValue: '' },
      { key: 'support_phone', label: 'Support Phone', description: 'Primary contact phone for the platform', type: 'text', defaultValue: '' },
    ],
  },
  {
    id: 'access',
    label: 'Platform Access',
    settings: [
      { key: 'maintenance_mode', label: 'Maintenance Mode', description: 'Block all non-exempt users from the platform', type: 'toggle', defaultValue: 'false' },
      { key: 'registration_open', label: 'Registration Open', description: 'Allow new users to sign up', type: 'toggle', defaultValue: 'true' },
    ],
  },
  {
    id: 'legal',
    label: 'Legal Content',
    settings: [
      { key: 'privacy_policy', label: 'Privacy Policy', description: 'Platform privacy policy text', type: 'textarea', defaultValue: '' },
      { key: 'terms_of_service', label: 'Terms & Conditions', description: 'Platform terms of service text', type: 'textarea', defaultValue: '' },
    ],
  },
];

interface CreatorSettingsTabProps {
  profile?: Profile;
}

export default function CreatorSettingsTab({ profile: _profile }: CreatorSettingsTabProps) {
  const [settings, setSettings] = useState<DbSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [changed, setChanged] = useState<Record<string, string>>({});

  // Load all active settings from DB
  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from('platform_settings')
        .select('*')
        .eq('is_active', true)
        .order('key');

      if (error) {
        toast.error('Failed to load settings: ' + error.message);
        setLoading(false);
        return;
      }

      // Seed any missing keys with defaults
      const dbKeys = new Set((data || []).map((s: DbSetting) => s.key));
      const allDefs = SETTING_GROUPS.flatMap(g => g.settings);
      const toSeed = allDefs.filter(d => !dbKeys.has(d.key));

      if (toSeed.length > 0) {
        const seedRows = toSeed.map(d => ({
          key: d.key,
          value: d.defaultValue,
          label: d.label,
          description: d.description,
          category: 'platform',
          data_type: d.type === 'toggle' ? 'boolean' : 'text',
          is_active: true,
        }));

        const { error: seedError } = await supabase.from('platform_settings').upsert(seedRows, { onConflict: 'key' });
        if (seedError) {
          toast.error('Failed to seed settings: ' + seedError.message);
        }

        // Reload after seed
        const { data: reloaded } = await supabase
          .from('platform_settings')
          .select('*')
          .eq('is_active', true)
          .order('key');
        setSettings(reloaded || []);
      } else {
        setSettings(data || []);
      }

      setLoading(false);
    }
    load();
  }, []);

  function getSettingValue(key: string): string {
    const fromDb = settings.find(s => s.key === key);
    if (fromDb) return fromDb.value;
    const def = SETTING_GROUPS.flatMap(g => g.settings).find(s => s.key === key);
    return def?.defaultValue || '';
  }

  async function saveSetting(key: string, value: string) {
    setSaving(prev => ({ ...prev, [key]: true }));

    const def = SETTING_GROUPS.flatMap(g => g.settings).find(s => s.key === key);
    if (!def) { setSaving(prev => ({ ...prev, [key]: false })); return; }

    const { error } = await supabase.from('platform_settings').upsert({
      key,
      value,
      label: def.label,
      description: def.description,
      category: 'platform',
      data_type: def.type === 'toggle' ? 'boolean' : 'text',
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });

    if (error) {
      toast.error(`Failed to save ${def.label}: ${error.message}`);
      setSaving(prev => ({ ...prev, [key]: false }));
      return;
    }

    // Verify
    const { data: verify } = await supabase.from('platform_settings').select('value').eq('key', key).single();
    if (verify && verify.value !== value) {
      toast.error(`${def.label} verification mismatch`);
      setSaving(prev => ({ ...prev, [key]: false }));
      return;
    }

    invalidateSettingsCache();
    setChanged(prev => { const n = { ...prev }; delete n[key]; return n; });
    setSettings(prev => prev.map(s => s.key === key ? { ...s, value } : s));
    toast.success(`${def.label} saved`);
    setSaving(prev => ({ ...prev, [key]: false }));
  }

  async function saveAll() {
    const keys = Object.keys(changed);
    if (keys.length === 0) return;
    await Promise.all(keys.map(k => saveSetting(k, changed[k])));
    toast.success('All settings saved');
  }

  const hasChanges = Object.keys(changed).length > 0;

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Toaster position="top-right" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white">Platform Settings</h2>
          <p className="text-[11px] text-[#5C5E72]">Global platform configuration</p>
        </div>
        {hasChanges && (
          <button
            onClick={saveAll}
            disabled={Object.values(saving).some(Boolean)}
            className="h-8 px-4 rounded-lg bg-[#3B82F6] text-white text-[11px] font-semibold hover:bg-[#2563EB] transition-colors disabled:opacity-50"
          >
            {Object.values(saving).some(Boolean) ? 'Saving...' : `Save All (${Object.keys(changed).length})`}
          </button>
        )}
      </div>

      {/* Setting Groups — flat sections, no nested tabs */}
      {SETTING_GROUPS.map(group => (
        <div key={group.id} className="glass rounded-2xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white">{group.label}</h3>

          {group.settings.map(def => {
            const currentValue = changed[def.key] !== undefined ? changed[def.key] : getSettingValue(def.key);
            const isSaving = saving[def.key];
            const isChanged = changed[def.key] !== undefined;

            return (
              <div key={def.key} className={`rounded-xl p-3 space-y-2 ${isChanged ? 'bg-[#3B82F6]/5 border border-[#3B82F6]/20' : 'bg-[#1A1A24]/50 border border-[#232330]'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex-1">
                    <div className="text-[11px] font-medium text-white">{def.label}</div>
                    <div className="text-[10px] text-[#5C5E72]">{def.description}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Toggle */}
                    {def.type === 'toggle' && (
                      <button
                        onClick={() => {
                          const newVal = currentValue === 'true' ? 'false' : 'true';
                          setChanged(prev => ({ ...prev, [def.key]: newVal }));
                          saveSetting(def.key, newVal);
                        }}
                        className={`relative w-11 h-6 rounded-full transition-colors ${currentValue === 'true' ? 'bg-[#3B82F6]' : 'bg-[#2A2A3A] border border-[#232330]'}`}
                      >
                        <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${currentValue === 'true' ? 'translate-x-5' : 'translate-x-0'}`} />
                      </button>
                    )}

                    {/* Text / Email */}
                    {(def.type === 'text' || def.type === 'email') && (
                      <input
                        type={def.type}
                        value={currentValue}
                        onChange={e => setChanged(prev => ({ ...prev, [def.key]: e.target.value }))}
                        onBlur={() => { if (changed[def.key] !== undefined) saveSetting(def.key, changed[def.key]); }}
                        className="w-full sm:w-48 h-8 px-3 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-[11px] focus:outline-none focus:border-[#3B82F6]"
                      />
                    )}

                    {/* Textarea */}
                    {def.type === 'textarea' && (
                      <textarea
                        value={currentValue}
                        onChange={e => setChanged(prev => ({ ...prev, [def.key]: e.target.value }))}
                        rows={3}
                        className="w-full sm:w-64 px-3 py-2 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-[11px] focus:outline-none focus:border-[#3B82F6] resize-none"
                      />
                    )}

                    {/* Save button for non-toggle */}
                    {def.type !== 'toggle' && (
                      <button
                        onClick={() => saveSetting(def.key, currentValue)}
                        disabled={isSaving || !isChanged}
                        className="h-7 px-3 rounded-lg bg-[#3B82F6] text-white text-[10px] font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                      >
                        {isSaving ? '...' : 'Save'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* Info footer */}
      <div className="text-center text-[10px] text-[#5C5E72] pt-2">
        Domain-specific settings have been moved to their respective dashboard modules.
      </div>
    </div>
  );
}
