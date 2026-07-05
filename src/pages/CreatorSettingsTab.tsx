import { useState, useEffect } from 'react';
import { getSystemSettings, updateSystemSetting } from '@/lib/supabase/admin';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface CreatorSettingsTabProps {
  profile: Profile;
}

// Default finance settings (stored in platform_settings table with 'finance_' prefix)
const FINANCE_DEFAULTS: Record<string, string> = {
  finance_booking_fee: '300',
  finance_worker_commission_rate: '12.5',
  finance_min_withdrawal: '5000',
  finance_escrow_hold_days: '7',
};

export default function CreatorSettingsTab({ profile }: CreatorSettingsTabProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Record<string, string>>({});

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    const { settings: data } = await getSystemSettings();
    const map: Record<string, string> = {};
    // Platform settings
    (data || []).forEach((s: any) => { map[s.key] = s.value || ''; });
    // Finance defaults
    Object.entries(FINANCE_DEFAULTS).forEach(([key, value]) => {
      if (!map[key]) map[key] = value;
    });
    setSettings(map);
    setLoading(false);
  }

  async function updateSetting(key: string, value: string) {
    setSaving(true);
    const { error } = await updateSystemSetting(key, value, profile.user_id);
    setSaving(false);
    if (error) {
      toast.error('Failed: ' + error.message);
      return;
    }
    toast.success('Saved');
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  function handleToggle(key: string) {
    const current = settings[key] === 'true';
    updateSetting(key, current ? 'false' : 'true');
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[10px] text-[#5C5E72] py-8">
        <div className="w-4 h-4 border border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        Loading settings...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Toaster position="top-center" richColors theme="dark" />

      {/* ═══ PLATFORM SETTINGS ═══ */}
      <div className="glass rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1E1E2C] bg-purple-500/5">
          <h3 className="text-sm font-semibold text-purple-400">Platform Settings</h3>
          <p className="text-[10px] text-[#5C5E72]">Configure how WeHouse operates</p>
        </div>
        <div className="p-4 space-y-4">
          {/* Platform Name */}
          <SettingRow label="Platform Name" description="Displayed across the app">
            <input
              type="text"
              value={settings.platform_name || 'WeHouse'}
              onChange={(e) => setSettings(prev => ({ ...prev, platform_name: e.target.value }))}
              onBlur={(e) => updateSetting('platform_name', e.target.value)}
              className="w-40 h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-purple-500/50 outline-none"
            />
          </SettingRow>

          {/* Maintenance Mode */}
          <SettingRow label="Maintenance Mode" description="Block all non-Creator access">
            <ToggleButton
              enabled={settings.maintenance_mode === 'true'}
              onToggle={() => handleToggle('maintenance_mode')}
              activeColor="bg-amber-500"
            />
          </SettingRow>

          {/* Registration Open */}
          <SettingRow label="Open Registration" description="Allow new users to sign up">
            <ToggleButton
              enabled={settings.registration_open !== 'false'}
              onToggle={() => handleToggle('registration_open')}
              activeColor="bg-emerald-500"
            />
          </SettingRow>

          {/* Listing Approval Required */}
          <SettingRow label="Listing Approval Required" description="Creator/Admin must approve all listings">
            <ToggleButton
              enabled={settings.listing_approval_required === 'true'}
              onToggle={() => handleToggle('listing_approval_required')}
              activeColor="bg-blue-500"
            />
          </SettingRow>

          {/* Max Listings Per User */}
          <SettingRow label="Max Listings Per User" description="Limit how many listings one user can post">
            <input
              type="number"
              value={settings.max_listings_per_user || '5'}
              onChange={(e) => setSettings(prev => ({ ...prev, max_listings_per_user: e.target.value }))}
              onBlur={(e) => updateSetting('max_listings_per_user', e.target.value)}
              className="w-20 h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-purple-500/50 outline-none"
            />
          </SettingRow>
        </div>
      </div>

      {/* ═══ FINANCE SETTINGS ═══ */}
      <div className="glass rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1E1E2C] bg-emerald-500/5">
          <h3 className="text-sm font-semibold text-emerald-400">Finance Settings</h3>
          <p className="text-[10px] text-[#5C5E72]">Control fees, commissions, and withdrawals</p>
        </div>
        <div className="p-4 space-y-4">
          {/* Booking Fee */}
          <SettingRow label="WeHouse Booking Fee" description="Fixed fee added to every worker booking">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#5C5E72]">N</span>
              <input
                type="number"
                value={settings.finance_booking_fee || '300'}
                onChange={(e) => setSettings(prev => ({ ...prev, finance_booking_fee: e.target.value }))}
                onBlur={(e) => updateSetting('finance_booking_fee', e.target.value)}
                className="w-24 h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-emerald-500/50 outline-none"
              />
            </div>
          </SettingRow>

          {/* Worker Commission Rate */}
          <SettingRow label="Worker Commission Rate" description="% WeHouse takes from worker earnings">
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                value={settings.finance_worker_commission_rate || '12.5'}
                onChange={(e) => setSettings(prev => ({ ...prev, finance_worker_commission_rate: e.target.value }))}
                onBlur={(e) => updateSetting('finance_worker_commission_rate', e.target.value)}
                className="w-20 h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-emerald-500/50 outline-none"
              />
              <span className="text-xs text-[#5C5E72]">%</span>
            </div>
          </SettingRow>

          {/* Min Withdrawal */}
          <SettingRow label="Minimum Withdrawal" description="Lowest amount workers/partners can withdraw">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#5C5E72]">N</span>
              <input
                type="number"
                value={settings.finance_min_withdrawal || '5000'}
                onChange={(e) => setSettings(prev => ({ ...prev, finance_min_withdrawal: e.target.value }))}
                onBlur={(e) => updateSetting('finance_min_withdrawal', e.target.value)}
                className="w-24 h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-emerald-500/50 outline-none"
              />
            </div>
          </SettingRow>

          {/* Escrow Hold Days */}
          <SettingRow label="Escrow Hold Duration" description="Days to hold payment before releasing to worker">
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={settings.finance_escrow_hold_days || '7'}
                onChange={(e) => setSettings(prev => ({ ...prev, finance_escrow_hold_days: e.target.value }))}
                onBlur={(e) => updateSetting('finance_escrow_hold_days', e.target.value)}
                className="w-16 h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-emerald-500/50 outline-none"
              />
              <span className="text-xs text-[#5C5E72]">days</span>
            </div>
          </SettingRow>
        </div>
      </div>

      {/* ═══ SUPPORT CONTACTS ═══ */}
      <div className="glass rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1E1E2C] bg-blue-500/5">
          <h3 className="text-sm font-semibold text-blue-400">Support Contacts</h3>
          <p className="text-[10px] text-[#5C5E72]">Shown to users who need help</p>
        </div>
        <div className="p-4 space-y-4">
          <SettingRow label="WhatsApp Number" description="Support WhatsApp line">
            <input
              type="text"
              placeholder="+234..."
              value={settings.support_whatsapp || ''}
              onChange={(e) => setSettings(prev => ({ ...prev, support_whatsapp: e.target.value }))}
              onBlur={(e) => updateSetting('support_whatsapp', e.target.value)}
              className="w-48 h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 placeholder-[#3A3A4A] focus:border-blue-500/50 outline-none"
            />
          </SettingRow>

          <SettingRow label="Telegram" description="Support Telegram handle">
            <input
              type="text"
              placeholder="@wehouse_support"
              value={settings.support_telegram || ''}
              onChange={(e) => setSettings(prev => ({ ...prev, support_telegram: e.target.value }))}
              onBlur={(e) => updateSetting('support_telegram', e.target.value)}
              className="w-48 h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 placeholder-[#3A3A4A] focus:border-blue-500/50 outline-none"
            />
          </SettingRow>

          <SettingRow label="Support Email" description="Support email address">
            <input
              type="email"
              placeholder="support@wehouse.ng"
              value={settings.support_email || ''}
              onChange={(e) => setSettings(prev => ({ ...prev, support_email: e.target.value }))}
              onBlur={(e) => updateSetting('support_email', e.target.value)}
              className="w-48 h-8 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 placeholder-[#3A3A4A] focus:border-blue-500/50 outline-none"
            />
          </SettingRow>
        </div>
      </div>

      {saving && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-[#1A1A24] border border-[#2A2A3A] rounded-lg px-3 py-1.5 flex items-center gap-2 z-50">
          <div className="w-3 h-3 border border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
          <span className="text-[10px] text-[#8A8B9C]">Saving...</span>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-medium text-white">{label}</p>
        <p className="text-[10px] text-[#5C5E72]">{description}</p>
      </div>
      {children}
    </div>
  );
}

function ToggleButton({ enabled, onToggle, activeColor }: { enabled: boolean; onToggle: () => void; activeColor: string }) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? activeColor : 'bg-[#2A2A3A]'}`}
    >
      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
    </button>
  );
}
