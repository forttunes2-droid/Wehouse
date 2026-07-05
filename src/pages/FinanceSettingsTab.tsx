import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface FinanceSettingsTabProps {
  profile: Profile;
}

interface FinanceSetting {
  key: string;
  label: string;
  description: string;
  prefix?: string;
  suffix?: string;
}

export default function FinanceSettingsTab({ profile }: FinanceSettingsTabProps) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const financeSettings: FinanceSetting[] = [
    // Commission Settings
    { key: 'worker_commission_rate', label: 'Worker Commission', description: 'Percentage WeHouse takes from worker bookings', suffix: '%' },
    { key: 'property_commission_rate', label: 'Property Commission', description: 'Percentage WeHouse takes from property listings', suffix: '%' },
    { key: 'hotel_commission_rate', label: 'Hotel Commission', description: 'Percentage WeHouse takes from hotel bookings', suffix: '%' },
    { key: 'booking_fee_amount', label: 'Booking Fee', description: 'Fixed fee charged per booking', prefix: 'N' },
    { key: 'inspection_fee_amount', label: 'Inspection Fee', description: 'Fee charged for property inspections', prefix: 'N' },
    { key: 'cancellation_fee', label: 'Cancellation Fee', description: 'Fee for late cancellations', prefix: 'N' },
    { key: 'refund_processing_fee', label: 'Refund Processing Fee', description: 'Fee deducted from refunds', prefix: 'N' },
    // Wallet Settings
    { key: 'min_withdrawal', label: 'Minimum Withdrawal', description: 'Lowest amount workers can withdraw', prefix: 'N' },
    { key: 'max_withdrawal', label: 'Maximum Withdrawal', description: 'Highest amount per withdrawal', prefix: 'N' },
    // Escrow
    { key: 'escrow_auto_release_days', label: 'Escrow Auto Release', description: 'Days before payment auto-releases to worker', suffix: 'days' },
    { key: 'dispute_time_limit_days', label: 'Dispute Time Limit', description: 'Max days to resolve a dispute', suffix: 'days' },
  ];

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_platform_settings', { p_category: 'finance' });
    if (error) {
      toast.error('Failed to load: ' + error.message);
      setLoading(false);
      return;
    }
    const map: Record<string, string> = {};
    (data || []).forEach((s: any) => { map[s.key] = s.value || ''; });
    setSettings(map);
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
      toast.error('Failed: ' + error.message);
      return;
    }
    setSettings(prev => ({ ...prev, [key]: value }));
    toast.success('Saved');
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
      <Toaster position="top-center" richColors theme="dark" />

      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-emerald-400">Finance Settings</h2>
        <p className="text-[11px] text-[#5C5E72]">Control all money flow. Change percentages anytime.</p>
      </div>

      {/* Commission Settings */}
      <Section title="Commission Rates" icon="📊">
        {financeSettings.slice(0, 7).map(s => (
          <FinanceRow key={s.key} setting={s} value={settings[s.key] || ''} saving={saving === s.key} onUpdate={(v) => updateSetting(s.key, v)} />
        ))}
      </Section>

      {/* Wallet Settings */}
      <Section title="Wallet & Withdrawal" icon="💳">
        {financeSettings.slice(7, 9).map(s => (
          <FinanceRow key={s.key} setting={s} value={settings[s.key] || ''} saving={saving === s.key} onUpdate={(v) => updateSetting(s.key, v)} />
        ))}
      </Section>

      {/* Escrow */}
      <Section title="Escrow & Disputes" icon="🔒">
        {financeSettings.slice(9).map(s => (
          <FinanceRow key={s.key} setting={s} value={settings[s.key] || ''} saving={saving === s.key} onUpdate={(v) => updateSetting(s.key, v)} />
        ))}
      </Section>

      {/* Toggles */}
      <Section title="Finance Toggles" icon="⚙️">
        <ToggleRow
          label="Inspection Fee"
          description="Charge for property inspections"
          value={settings.inspection_fee_enabled || 'false'}
          onUpdate={(v) => updateSetting('inspection_fee_enabled', v)}
        />
        <ToggleRow
          label="Hold During Disputes"
          description="Freeze escrow when dispute is raised"
          value={settings.escrow_dispute_hold || 'true'}
          onUpdate={(v) => updateSetting('escrow_dispute_hold', v)}
        />
        <ToggleRow
          label="Automatic Withdrawals"
          description="Process withdrawals automatically"
          value={settings.auto_withdrawal_enabled || 'false'}
          onUpdate={(v) => updateSetting('auto_withdrawal_enabled', v)}
        />
      </Section>

      {/* Payment Gateway */}
      <Section title="Payment Gateway" icon="🔐">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-white">Paystack Mode</p>
              <p className="text-[10px] text-[#5C5E72]">Test or Live environment</p>
            </div>
            <div className="flex gap-1.5">
              {['test', 'live'].map(mode => (
                <button
                  key={mode}
                  onClick={() => updateSetting('paystack_test_mode', mode === 'test' ? 'true' : 'false')}
                  className={`h-7 px-3 rounded-lg text-[10px] font-medium capitalize transition-colors ${
                    (settings.paystack_test_mode === 'true' ? 'test' : 'live') === mode
                      ? mode === 'live' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
                      : 'bg-[#12121A] text-[#5C5E72]'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <FinanceInput label="Public Key" value={settings.paystack_public_key || ''} onSave={(v) => updateSetting('paystack_public_key', v)} />
          <FinanceInput label="Secret Key" value={settings.paystack_secret_key || ''} onSave={(v) => updateSetting('paystack_secret_key', v)} type="password" />
          <FinanceInput label="Webhook URL" value={settings.paystack_webhook_url || ''} onSave={(v) => updateSetting('paystack_webhook_url', v)} />
        </div>
      </Section>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#1E1E2C] bg-emerald-500/5">
        <h3 className="text-xs font-semibold text-emerald-400">{icon} {title}</h3>
      </div>
      <div className="p-4 space-y-4">
        {children}
      </div>
    </div>
  );
}

function FinanceRow({ setting, value, saving, onUpdate }: { setting: FinanceSetting; value: string; saving: boolean; onUpdate: (v: string) => void }) {
  const [local, setLocal] = useState(value);

  useEffect(() => { setLocal(value); }, [value]);

  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-white">{setting.label}</p>
          {saving && <div className="w-2.5 h-2.5 border border-[#10B981] border-t-transparent rounded-full animate-spin" />}
        </div>
        <p className="text-[9px] text-[#5C5E72]">{setting.description}</p>
      </div>
      <div className="flex items-center gap-1.5">
        {setting.prefix && <span className="text-[10px] text-[#5C5E72]">{setting.prefix}</span>}
        <input
          type="number"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => onUpdate(local)}
          className="w-20 h-7 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-2 text-right focus:border-emerald-500/50 outline-none"
        />
        {setting.suffix && <span className="text-[10px] text-[#5C5E72]">{setting.suffix}</span>}
      </div>
    </div>
  );
}

function ToggleRow({ label, description, value, onUpdate }: { label: string; description: string; value: string; onUpdate: (v: string) => void }) {
  const enabled = value === 'true';
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-medium text-white">{label}</p>
        <p className="text-[9px] text-[#5C5E72]">{description}</p>
      </div>
      <button
        onClick={() => onUpdate(enabled ? 'false' : 'true')}
        className={`relative w-10 h-5.5 rounded-full transition-colors ${enabled ? 'bg-emerald-500' : 'bg-[#2A2A3A]'}`}
      >
        <div className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

function FinanceInput({ label, value, onSave, type = 'text' }: { label: string; value: string; onSave: (v: string) => void; type?: string }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);

  return (
    <div className="flex items-center justify-between">
      <p className="text-xs text-[#5C5E72]">{label}</p>
      <input
        type={type}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => onSave(local)}
        className="w-48 h-7 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-2 focus:border-emerald-500/50 outline-none"
      />
    </div>
  );
}
