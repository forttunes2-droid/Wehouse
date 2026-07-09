import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Toaster, toast } from 'sonner';
import ServiceCategoryManager from '@/components/ServiceCategoryManager';
import PropertyTypeManager from '@/components/PropertyTypeManager';

// ═══════════════════════════════════════════════════════════════
// SETTING DEFINITIONS — grouped by category
// ═══════════════════════════════════════════════════════════════

interface SettingDef {
  key: string;
  label: string;
  description: string;
  type: 'text' | 'toggle' | 'number' | 'textarea' | 'email' | 'url' | 'color';
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

const SETTING_GROUPS: { id: string; label: string; settings: SettingDef[] }[] = [
  {
    id: 'payment',
    label: 'Payments & Fees',
    settings: [
      { key: 'worker_verification_fee', label: 'Worker Verification Fee (N)', description: 'One-time fee workers pay for verification', type: 'number', defaultValue: '5000' },
      { key: 'partner_commission_rate', label: 'Partner Commission %', description: 'Percentage taken from partner earnings', type: 'number', defaultValue: '10' },
      { key: 'commission_rental', label: 'Rental Commission %', description: 'Percentage taken from rent payments', type: 'number', defaultValue: '10' },
      { key: 'commission_worker', label: 'Worker Commission %', description: 'Percentage taken from worker bookings', type: 'number', defaultValue: '15' },
      { key: 'commission_hotel', label: 'Hotel Commission %', description: 'Percentage taken from hotel bookings', type: 'number', defaultValue: '12' },
      { key: 'min_payout', label: 'Minimum Payout (N)', description: 'Minimum amount for withdrawals', type: 'number', defaultValue: '5000' },
      { key: 'paystack_public_key', label: 'Paystack Public Key', description: 'Paystack public key for payment processing', type: 'text', defaultValue: '' },
      { key: 'payment_test_mode', label: 'Payment Test Mode', description: 'Enable Paystack test mode', type: 'toggle', defaultValue: 'true' },
    ] as SettingDef[],
  },
  {
    id: 'features',
    label: 'Features',
    settings: [
      { key: 'worker_approval', label: 'Worker Approval', description: 'manual or auto approval', type: 'text', defaultValue: 'manual' },
      { key: 'worker_video_required', label: 'Video Intro Required', description: 'Require workers to submit a video', type: 'toggle', defaultValue: 'true' },
      { key: 'max_skills_worker', label: 'Max Skills Per Worker', description: 'Maximum services a worker can offer', type: 'number', defaultValue: '5' },
      { key: 'feature_hotels', label: 'Hotels Module', description: 'Enable hotel bookings', type: 'toggle', defaultValue: 'true' },
      { key: 'feature_workers', label: 'Workers Module', description: 'Enable worker services', type: 'toggle', defaultValue: 'true' },
      { key: 'feature_roommate', label: 'Roommate Matching', description: 'Enable roommate matching', type: 'toggle', defaultValue: 'true' },
      { key: 'feature_negotiation', label: 'Price Negotiation', description: 'Allow price negotiation', type: 'toggle', defaultValue: 'true' },
      { key: 'maintenance_mode', label: 'Maintenance Mode', description: 'Put site in maintenance mode', type: 'toggle', defaultValue: 'false' },
      { key: 'registration_open', label: 'Open Registration', description: 'Allow new signups', type: 'toggle', defaultValue: 'true' },
    ] as SettingDef[],
  },
  {
    id: 'hotel_reservation',
    label: 'Hotel Reservation',
    settings: [
      { key: 'hotel_reservation_enabled', label: 'Hotel Reservation Enabled', description: 'Require reservation before hotel booking', type: 'toggle', defaultValue: 'false' },
      { key: 'hotel_reservation_fee_type', label: 'Reservation Fee Type', description: 'fixed_amount or per_day', type: 'text', defaultValue: 'fixed_amount' },
      { key: 'hotel_reservation_amount', label: 'Reservation Amount (N)', description: 'Reservation fee in Naira', type: 'number', defaultValue: '5000' },
      { key: 'hotel_reservation_expiry_hours', label: 'Reservation Expiry (Hours)', description: 'Hours before reservation expires', type: 'number', defaultValue: '48' },
      { key: 'hotel_reservation_refund_policy', label: 'Refund Policy', description: 'Refund policy for hotel reservations', type: 'textarea', defaultValue: 'Reservation fee is refundable if cancelled within 24 hours of booking.' },
    ] as SettingDef[],
  },
];

// Build a flat map of all settings for quick lookup
const ALL_SETTINGS: Record<string, SettingDef> = {};
SETTING_GROUPS.forEach(g => g.settings.forEach(s => ALL_SETTINGS[s.key] = s));

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

type SettingsView = 'settings' | 'categories' | 'property_types';

interface CreatorSettingsTabProps {
  profile: Profile;
}

export default function CreatorSettingsTab({ profile }: CreatorSettingsTabProps) {
  const [view, setView] = useState<SettingsView>('settings');

  return (
    <div className="space-y-4">
      <Toaster position="top-center" richColors theme="dark" />

      {/* View Switcher */}
      <div className="flex gap-2">
        {[
          { id: 'settings' as SettingsView, label: 'Platform Settings' },
          { id: 'categories' as SettingsView, label: 'Service Categories' },
          { id: 'property_types' as SettingsView, label: 'Property Types' },
        ].map(v => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              view === v.id
                ? 'bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/20'
                : 'bg-[#12121A] text-[#5C5E72] border border-[#1E1E2C] hover:text-white'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'settings' && <PlatformSettings profile={profile} />}
      {view === 'categories' && <ServiceCategoryManager profile={profile} />}
      {view === 'property_types' && <PropertyTypeManager profile={profile} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PLATFORM SETTINGS — with explicit Save button
// ═══════════════════════════════════════════════════════════════

function PlatformSettings({ profile }: { profile: Profile }) {
  const [dbSettings, setDbSettings] = useState<DbSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState('commissions');
  const [hasChanges, setHasChanges] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  // Load all settings from database on mount
  useEffect(() => {
    loadAllSettings();
  }, []);

  async function loadAllSettings() {
    setLoading(true);
    let loaded: DbSetting[] = [];

    // Try direct table query first (more reliable than RPC)
    try {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('*')
        .order('key', { ascending: true });

      if (!error && data && data.length > 0) {
        const knownCategories = SETTING_GROUPS.map(g => g.id);
        loaded = (data as DbSetting[]).filter(s => knownCategories.includes(s.category));
      }
    } catch {
      // Table query failed, try RPC
      try {
        const { data, error } = await supabase.rpc('get_all_settings_v2');
        if (!error && data && data.length > 0) {
          const knownCategories = SETTING_GROUPS.map(g => g.id);
          loaded = (data as DbSetting[]).filter(s => knownCategories.includes(s.category));
        }
      } catch {
        // Both failed
      }
    }

    if (loaded.length > 0) {
      setDbSettings(loaded);
    } else {
      // Seed from hardcoded defaults
      const defaults: DbSetting[] = [];
      let id = 0;
      SETTING_GROUPS.forEach(g => {
        g.settings.forEach(s => {
          defaults.push({
            id: id++,
            key: s.key,
            value: s.defaultValue,
            category: g.id,
            label: s.label,
            description: s.description,
            data_type: s.type,
            is_active: true,
          });
        });
      });
      setDbSettings(defaults);
    }
    setLoading(false);
  }

  async function saveSetting(key: string, value: string) {
    const group = SETTING_GROUPS.find(g => g.id === activeGroup);
    const settingDef = group?.settings.find(s => s.key === key);
    const label = settingDef?.label || key;

    setSaving(prev => ({ ...prev, [key]: true }));

    try {
      // Try RPC first
      const { error: rpcError } = await supabase.rpc('set_setting_v2', {
        p_key: key,
        p_value: value,
      });

      if (rpcError) {
        // Fallback: direct table upsert
        const { error: upsertError } = await supabase
          .from('platform_settings')
          .upsert({
            key,
            value,
            label,
            category: activeGroup,
            data_type: settingDef?.type || 'text',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'key' });

        if (upsertError) {
          toast.error('Failed to save: ' + upsertError.message);
          setSaving(prev => ({ ...prev, [key]: false }));
          return;
        }
      }

      // Update local state
      setDbSettings(prev => prev.map(s => s.key === key ? { ...s, value, label } : s));
      setHasChanges(prev => ({ ...prev, [key]: false }));
      toast.success(`${label} saved`);
    } catch (e: any) {
      toast.error('Save failed: ' + (e.message || 'Unknown error'));
    }

    setSaving(prev => ({ ...prev, [key]: false }));
  }

  // Save all changed settings at once
  async function saveAll() {
    const changedKeys = Object.entries(hasChanges).filter(([_, v]) => v).map(([k]) => k);
    if (changedKeys.length === 0) {
      toast.info('No changes to save');
      return;
    }

    for (const key of changedKeys) {
      const setting = dbSettings.find(s => s.key === key);
      if (setting) await saveSetting(key, setting.value);
    }
    toast.success('All settings saved');
  }

  // Map DB data_type to UI type
  function dbTypeToUiType(dt: string): SettingDef['type'] {
    switch (dt) {
      case 'toggle': return 'toggle';
      case 'textarea': return 'textarea';
      case 'number': return 'number';
      case 'email': return 'email';
      case 'url': return 'url';
      case 'color': return 'color';
      default: return 'text';
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const categories = [...new Set(dbSettings.map(s => s.category))];
  const currentSettings = dbSettings.filter(s => s.category === activeGroup);
  const anyChanges = Object.values(hasChanges).some(v => v);

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-[#5C5E72]">
        Configure WeHouse platform settings. Click Save to apply changes.
      </p>

      {/* Group Tabs */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
        {SETTING_GROUPS.map(g => {
          const hasSettings = categories.includes(g.id);
          return (
            <button
              key={g.id}
              onClick={() => setActiveGroup(g.id)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                activeGroup === g.id
                  ? 'bg-[#3B82F6]/15 text-[#3B82F6]'
                  : hasSettings
                    ? 'bg-[#12121A] text-[#5C5E72] hover:text-white'
                    : 'bg-[#12121A] text-[#3A3A4A] cursor-not-allowed'
              }`}
              disabled={!hasSettings}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      {/* Settings for active group */}
      <div className="space-y-3">
        {currentSettings.map(setting => (
          <SettingField
            key={setting.key}
            def={{
              key: setting.key,
              label: setting.label,
              description: setting.description,
              type: dbTypeToUiType(setting.data_type),
              defaultValue: setting.value,
            }}
            value={setting.value}
            isSaving={saving[setting.key] || false}
            onChange={(val) => {
              setDbSettings(prev => prev.map(s => s.key === setting.key ? { ...s, value: val } : s));
              setHasChanges(prev => ({ ...prev, [setting.key]: true }));
            }}
            onSave={() => {
              const s = dbSettings.find(ds => ds.key === setting.key);
              if (s) saveSetting(setting.key, s.value);
            }}
          />
        ))}

        {currentSettings.length === 0 && (
          <div className="text-center py-10">
            <p className="text-sm text-[#5C5E72]">No settings in this category</p>
          </div>
        )}
      </div>

      {/* Save All button */}
      {anyChanges && (
        <div className="sticky bottom-4 flex justify-end">
          <button
            onClick={saveAll}
            className="h-10 px-6 rounded-xl bg-[#3B82F6] text-white text-xs font-semibold shadow-lg shadow-blue-500/20 hover:bg-[#2563EB] transition-colors flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Individual Setting Field with explicit Save ──────────────────────────

function SettingField({ def, value, isSaving, onChange, onSave }: {
  def: SettingDef;
  value: string;
  isSaving: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
}) {
  const [local, setLocal] = useState(value);
  const changed = local !== value;

  useEffect(() => { setLocal(value); }, [value]);

  const handleToggle = () => {
    const next = local === 'true' ? 'false' : 'true';
    setLocal(next);
    onChange(next);
  };

  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-white">{def.label}</p>
            {isSaving && <div className="w-3 h-3 border border-[#3B82F6] border-t-transparent rounded-full animate-spin" />}
            {changed && !isSaving && <span className="text-[9px] text-amber-400">• modified</span>}
          </div>
          <p className="text-[10px] text-[#5C5E72] mt-0.5">{def.description}</p>
        </div>

        <div className="flex-shrink-0 flex items-center gap-2">
          {def.type === 'toggle' ? (
            <ToggleSwitch enabled={local === 'true'} onToggle={handleToggle} />
          ) : def.type === 'textarea' ? (
            <div className="w-64">
              <textarea
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                rows={4}
                placeholder={`Enter ${def.label.toLowerCase()}...`}
                className="w-full rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 py-2 placeholder-[#3A3A4A] focus:border-[#3B82F6]/50 outline-none resize-none"
              />
            </div>
          ) : def.type === 'color' ? (
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={local || '#3B82F6'}
                onChange={(e) => { setLocal(e.target.value); onChange(e.target.value); }}
                className="w-8 h-8 rounded-lg border-0 cursor-pointer"
              />
              <span className="text-[10px] text-[#5C5E72] font-mono">{local}</span>
            </div>
          ) : (
            <input
              type={def.type === 'number' ? 'number' : def.type === 'email' ? 'email' : def.type === 'url' ? 'url' : 'text'}
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              placeholder={def.type === 'number' ? '0' : '...'}
              className="w-40 h-9 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none"
            />
          )}

          {/* Explicit Save button */}
          {changed && (
            <button
              onClick={() => { onChange(local); onSave(); }}
              disabled={isSaving}
              className="h-9 px-3 rounded-lg bg-[#3B82F6] text-white text-[10px] font-semibold hover:bg-[#2563EB] transition-colors disabled:opacity-40"
            >
              {isSaving ? '...' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Toggle Switch ──────────────────────────

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-11 h-6 rounded-full transition-colors ${
        enabled ? 'bg-[#3B82F6]' : 'bg-[#2A2A3A]'
      }`}
    >
      <div
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
