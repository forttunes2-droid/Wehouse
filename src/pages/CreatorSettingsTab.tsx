import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Toaster, toast } from 'sonner';
import ServiceCategoryManager from '@/components/ServiceCategoryManager';
import PropertyTypeManager from '@/components/PropertyTypeManager';

// ═══════════════════════════════════════════════════════════════
// CREATOR SETTINGS — Constitution Article 1
// Every platform rule controlled by Creator. NOTHING hardcoded.
// ═══════════════════════════════════════════════════════════════

interface SettingDef {
  key: string;
  label: string;
  description: string;
  type: 'text' | 'toggle' | 'number' | 'textarea' | 'email' | 'url';
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
// ALL SETTING GROUPS — per Constitution Article 1, EXACTLY as written
// ═══════════════════════════════════════════════════════════════

const SETTING_GROUPS: { id: string; label: string; settings: SettingDef[] }[] = [
  // ── 1. COMPANY ──
  {
    id: 'company',
    label: 'Company',
    settings: [
      { key: 'company_name', label: 'Company Name', description: 'Platform company name', type: 'text', defaultValue: 'WeHouse' },
      { key: 'company_logo', label: 'Company Logo URL', description: 'URL to company logo image', type: 'url', defaultValue: '' },
      { key: 'support_email', label: 'Support Email', description: 'Customer support email address', type: 'email', defaultValue: '' },
      { key: 'support_phone', label: 'Support Phone', description: 'Customer support phone number', type: 'text', defaultValue: '' },
      { key: 'support_whatsapp', label: 'WhatsApp', description: 'WhatsApp support number', type: 'text', defaultValue: '' },
      { key: 'support_telegram', label: 'Telegram', description: 'Telegram support handle', type: 'text', defaultValue: '' },
      { key: 'office_address', label: 'Office Address', description: 'Physical office address', type: 'textarea', defaultValue: '' },
    ],
  },
  // ── 2. APARTMENT SETTINGS ──
  {
    id: 'apartment',
    label: 'Apartment',
    settings: [
      { key: 'commission_apartment', label: 'Apartment Commission %', description: 'Commission on apartment bookings', type: 'number', defaultValue: '10' },
      { key: 'apartment_reservation_fee', label: 'Apartment Reservation Fee (N)', description: 'Fee for apartment reservation', type: 'number', defaultValue: '0' },
      { key: 'security_deposit_rules', label: 'Security Deposit Rules', description: 'Rules for security deposits on short let apartments', type: 'textarea', defaultValue: '' },
      { key: 'rent_plans_enabled', label: 'Enable Rent Plans', description: 'Enable rent plan functionality', type: 'toggle', defaultValue: 'true' },
      { key: 'min_rent_duration', label: 'Minimum Rent Duration (months)', description: 'Minimum rent duration in months', type: 'number', defaultValue: '1' },
      { key: 'max_rent_duration', label: 'Maximum Rent Duration (months)', description: 'Maximum rent duration in months', type: 'number', defaultValue: '24' },
      { key: 'grace_period_days', label: 'Grace Period (days)', description: 'Grace period before late fees apply', type: 'number', defaultValue: '7' },
      { key: 'late_payment_rules', label: 'Late Payment Rules', description: 'Rules for late rent payments', type: 'textarea', defaultValue: '' },
    ],
  },
  // ── 3. HOTEL SETTINGS ──
  {
    id: 'hotel',
    label: 'Hotel',
    settings: [
      { key: 'allow_hotel_reservation', label: 'Hotel Reservation Enabled', description: 'If ON: users can reserve before paying. If OFF: direct payment only.', type: 'toggle', defaultValue: 'false' },
      { key: 'hotel_reservation_fee', label: 'Hotel Reservation Fee (N)', description: 'Fee for hotel reservation', type: 'number', defaultValue: '5000' },
      { key: 'commission_hotel', label: 'Hotel Commission %', description: 'Commission on hotel bookings', type: 'number', defaultValue: '12' },
    ],
  },
  // ── 4. WORKER ──
  {
    id: 'worker',
    label: 'Worker',
    settings: [
      { key: 'worker_verification_fee', label: 'Verification Payment (N)', description: 'One-time fee workers pay for verification', type: 'number', defaultValue: '5000' },
      { key: 'commission_worker', label: 'Worker Commission %', description: 'Commission on worker bookings', type: 'number', defaultValue: '15' },
      { key: 'worker_verification_video_length', label: 'Required Video Length (minutes)', description: 'Required length of skill demonstration video', type: 'number', defaultValue: '3' },
      { key: 'worker_required_documents', label: 'Required Documents', description: 'Documents required from workers (comma-separated)', type: 'textarea', defaultValue: 'Government ID, Proof of Address' },
    ],
  },
  // ── 5. WITHDRAWALS ──
  {
    id: 'withdrawals',
    label: 'Withdrawals',
    settings: [
      { key: 'min_withdrawal', label: 'Minimum Withdrawal (N)', description: 'Minimum withdrawal amount', type: 'number', defaultValue: '5000' },
      { key: 'max_withdrawal', label: 'Maximum Withdrawal (N)', description: 'Maximum withdrawal amount', type: 'number', defaultValue: '500000' },
      { key: 'automatic_paystack_transfer', label: 'Automatic Paystack Transfer', description: 'Automatically process withdrawals via Paystack', type: 'toggle', defaultValue: 'false' },
    ],
  },
  // ── 6. NOTIFICATIONS ──
  {
    id: 'notifications',
    label: 'Notifications',
    settings: [
      { key: 'email_notifications', label: 'Email Notifications', description: 'Send email notifications to users', type: 'toggle', defaultValue: 'true' },
      { key: 'push_notifications', label: 'Push Notifications', description: 'Send push notifications to users', type: 'toggle', defaultValue: 'true' },
    ],
  },
  // ── 7. MAINTENANCE ──
  {
    id: 'maintenance',
    label: 'Maintenance',
    settings: [
      { key: 'maintenance_mode', label: 'Maintenance Mode', description: 'Put site in maintenance mode', type: 'toggle', defaultValue: 'false' },
    ],
  },
  // ── 8. LEGAL ──
  {
    id: 'legal',
    label: 'Legal',
    settings: [
      { key: 'privacy_policy', label: 'Privacy Policy', description: 'Full privacy policy text (supports markdown)', type: 'textarea', defaultValue: '' },
      { key: 'terms_of_service', label: 'Terms & Conditions', description: 'Full terms and conditions text (supports markdown)', type: 'textarea', defaultValue: '' },
      { key: 'refund_policy', label: 'Refund Policy', description: 'Refund and cancellation policy', type: 'textarea', defaultValue: '' },
    ],
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
// PLATFORM SETTINGS — with explicit Save button per setting
// ═══════════════════════════════════════════════════════════════

function PlatformSettings({ profile }: { profile: Profile }) {
  const [dbSettings, setDbSettings] = useState<DbSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState('company');
  const [hasChanges, setHasChanges] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  // Load all settings from database on mount
  useEffect(() => {
    loadAllSettings();
  }, []);

  async function loadAllSettings() {
    setLoading(true);
    let loaded: DbSetting[] = [];

    // Load ALL settings from DB — NO filtering
    try {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('*')
        .order('key', { ascending: true });

      if (!error && data && data.length > 0) {
        loaded = data as DbSetting[];
      }
    } catch {
      /* DB query failed */
    }

    // Merge DB settings with Constitution defaults
    // DB values take priority; missing settings get defaults
    const merged: Record<string, DbSetting> = {};
    for (const s of loaded) merged[s.key] = s;

    let id = loaded.length > 0 ? Math.max(...loaded.map(s => s.id)) + 1 : 0;
    SETTING_GROUPS.forEach(g => {
      g.settings.forEach(s => {
        if (!merged[s.key]) {
          merged[s.key] = {
            id: id++,
            key: s.key,
            value: s.defaultValue,
            category: g.id,
            label: s.label,
            description: s.description,
            data_type: s.type,
            is_active: true,
          };
        }
      });
    });

    setDbSettings(Object.values(merged));
    setLoading(false);
  }

  async function saveSetting(key: string, value: string) {
    // Find which group this setting belongs to
    let groupId = activeGroup;
    let settingDef: SettingDef | undefined;
    for (const g of SETTING_GROUPS) {
      const found = g.settings.find(s => s.key === key);
      if (found) { settingDef = found; groupId = g.id; break; }
    }
    if (!settingDef) settingDef = ALL_SETTINGS[key];
    const label = settingDef?.label || key;

    setSaving(prev => ({ ...prev, [key]: true }));

    // Direct upsert with ALL required fields — category, data_type, label are NOT NULL
    // Do NOT use set_setting_v2 RPC — it only sets key/value and fails silently
    const { error: upsertError } = await supabase
      .from('platform_settings')
      .upsert({
        key,
        value,
        label,
        category: groupId,
        data_type: settingDef?.type || 'text',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

    setSaving(prev => ({ ...prev, [key]: false }));

    if (upsertError) {
      toast.error(`Failed to save ${label}: ${upsertError.message}`);
      return;
    }

    // ONLY update local state after DB confirms success
    setDbSettings(prev => prev.map(s => s.key === key ? { ...s, value, label } : s));
    setHasChanges(prev => ({ ...prev, [key]: false }));
    toast.success(`${label} saved`);
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

  const currentSettings = dbSettings.filter(s => s.category === activeGroup);
  const anyChanges = Object.values(hasChanges).some(v => v);

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-[#5C5E72]">
        Configure WeHouse platform settings per the Constitution. Click Save to apply changes. Nothing is hardcoded.
      </p>

      {/* Group Tabs — all 9 categories */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
        {SETTING_GROUPS.map(g => (
          <button
            key={g.id}
            onClick={() => setActiveGroup(g.id)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
              activeGroup === g.id
                ? 'bg-[#3B82F6]/15 text-[#3B82F6]'
                : 'bg-[#12121A] text-[#5C5E72] hover:text-white'
            }`}
          >
            {g.label}
          </button>
        ))}
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
            {changed && !isSaving && <span className="text-[9px] text-amber-400">modified</span>}
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
