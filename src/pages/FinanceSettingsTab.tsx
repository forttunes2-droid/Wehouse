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

export default function FinanceSettingsTab({ profile: _profile }: FinanceSettingsTabProps) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Keys must match platform_settings table exactly
  const commissionSettings: FinanceSetting[] = [
    { key: 'commission_rate_worker', label: 'Worker Commission', description: '% taken from worker bookings', suffix: '%' },
    { key: 'commission_rate_partner', label: 'Partner Commission', description: '% taken from property partner earnings', suffix: '%' },
    { key: 'commission_rate_hotel', label: 'Hotel Commission', description: '% taken from hotel bookings', suffix: '%' },
    { key: 'commission_rate_listing', label: 'Listing Commission', description: '% taken from property listings', suffix: '%' },
  ];

  const feeSettings: FinanceSetting[] = [
    { key: 'booking_fee_fixed', label: 'Fixed Booking Fee', description: 'Flat fee per booking', prefix: 'N' },
    { key: 'booking_fee_percentage', label: 'Booking Fee %', description: 'Percentage fee on bookings', suffix: '%' },
    { key: 'inspection_fee', label: 'Inspection Fee', description: 'Fee for property inspections', prefix: 'N' },
    { key: 'late_cancellation_fee', label: 'Late Cancellation Fee', description: 'Fee for late cancellations', prefix: 'N' },
    { key: 'withdrawal_fee', label: 'Withdrawal Fee', description: 'Flat fee per withdrawal', prefix: 'N' },
  ];

  const withdrawalSettings: FinanceSetting[] = [
    { key: 'minimum_withdrawal', label: 'Minimum Withdrawal', description: 'Lowest withdrawal amount', prefix: 'N' },
    { key: 'withdrawal_daily_limit', label: 'Daily Limit', description: 'Max withdrawal per day', prefix: 'N' },
    { key: 'withdrawal_weekly_limit', label: 'Weekly Limit', description: 'Max withdrawal per week', prefix: 'N' },
    { key: 'withdrawal_monthly_limit', label: 'Monthly Limit', description: 'Max withdrawal per month', prefix: 'N' },
    { key: 'withdrawal_processing_days', label: 'Processing Time', description: 'Business days to process' },
  ];

  const escrowSettings: FinanceSetting[] = [
    { key: 'escrow_hold_days', label: 'Escrow Hold Days', description: 'Days to hold before release', suffix: 'days' },
    { key: 'escrow_dispute_window_days', label: 'Dispute Window', description: 'Days after completion to dispute', suffix: 'days' },
  ];

  const depositSettings: FinanceSetting[] = [
    { key: 'security_deposit_default_percentage', label: 'Default Deposit %', description: 'Default security deposit % of rent', suffix: '%' },
    { key: 'security_deposit_max_amount', label: 'Max Deposit', description: 'Maximum security deposit cap', prefix: 'N' },
    { key: 'security_deposit_refund_days', label: 'Refund Days', description: 'Days to refund after move-out', suffix: 'days' },
    { key: 'refund_policy_days', label: 'Refund Window', description: 'Days within which refunds are allowed', suffix: 'days' },
  ];

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    // Load ALL settings, not just finance category, since we need refund_policy_text etc
    const { data, error } = await supabase.rpc('get_platform_settings');
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

      <div>
        <h2 className="text-lg font-bold text-emerald-400">Finance Settings</h2>
        <p className="text-[11px] text-[#5C5E72]">All values editable. No code changes needed.</p>
      </div>

      <Section title="Commission Rates" icon="📊">
        {commissionSettings.map(s => (
          <FinanceRow key={s.key} setting={s} value={settings[s.key] || ''} saving={saving === s.key} onUpdate={(v) => updateSetting(s.key, v)} />
        ))}
      </Section>

      <Section title="Fees" icon="💰">
        {feeSettings.map(s => (
          <FinanceRow key={s.key} setting={s} value={settings[s.key] || ''} saving={saving === s.key} onUpdate={(v) => updateSetting(s.key, v)} />
        ))}
      </Section>

      <Section title="Withdrawal Limits" icon="💳">
        {withdrawalSettings.map(s => (
          <FinanceRow key={s.key} setting={s} value={settings[s.key] || ''} saving={saving === s.key} onUpdate={(v) => updateSetting(s.key, v)} />
        ))}
      </Section>

      <Section title="Escrow" icon="🔒">
        {escrowSettings.map(s => (
          <FinanceRow key={s.key} setting={s} value={settings[s.key] || ''} saving={saving === s.key} onUpdate={(v) => updateSetting(s.key, v)} />
        ))}
        <ToggleRow
          label="Auto Release Escrow"
          description="Automatically release after hold period"
          value={settings.escrow_auto_release || 'true'}
          onUpdate={(v) => updateSetting('escrow_auto_release', v)}
        />
      </Section>

      <Section title="Security Deposit" icon="🏠">
        {depositSettings.map(s => (
          <FinanceRow key={s.key} setting={s} value={settings[s.key] || ''} saving={saving === s.key} onUpdate={(v) => updateSetting(s.key, v)} />
        ))}
      </Section>

      <Section title="Payment Gateway" icon="🔐">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-white">Paystack Mode</p>
              <p className="text-[10px] text-[#5C5E72]">Test or Live</p>
            </div>
            <div className="flex gap-1.5">
              {['test', 'live'].map(mode => (
                <button
                  key={mode}
                  onClick={() => updateSetting('payment_test_mode', mode === 'test' ? 'true' : 'false')}
                  className={`h-7 px-3 rounded-lg text-[10px] font-medium capitalize transition-colors ${
                    (settings.payment_test_mode === 'true' ? 'test' : 'live') === mode
                      ? mode === 'live' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
                      : 'bg-[#12121A] text-[#5C5E72]'
                  }`}
                >{mode}</button>
              ))}
            </div>
          </div>
          <FinanceInput label="Public Key" value={settings.paystack_public_key || ''} onSave={(v) => updateSetting('paystack_public_key', v)} />
          <FinanceInput label="Secret Key" value={settings.paystack_secret_key || ''} onSave={(v) => updateSetting('paystack_secret_key', v)} type="password" />
        </div>
      </Section>

      <Section title="Currency" icon="💱">
        <FinanceRow key="currency_symbol" setting={{ key: 'currency_symbol', label: 'Currency Symbol', description: 'Displayed symbol' }} value={settings.currency_symbol || 'N'} saving={saving === 'currency_symbol'} onUpdate={(v) => updateSetting('currency_symbol', v)} />
        <FinanceRow key="currency_code" setting={{ key: 'currency_code', label: 'Currency Code', description: 'ISO code' }} value={settings.currency_code || 'NGN'} saving={saving === 'currency_code'} onUpdate={(v) => updateSetting('currency_code', v)} />
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
      <div className="p-4 space-y-4">{children}</div>
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
        <input type="number" value={local} onChange={(e) => setLocal(e.target.value)} onBlur={() => onUpdate(local)}
          className="w-20 h-7 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-2 text-right focus:border-emerald-500/50 outline-none" />
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
      <button onClick={() => onUpdate(enabled ? 'false' : 'true')}
        className={`relative w-10 h-5.5 rounded-full transition-colors ${enabled ? 'bg-emerald-500' : 'bg-[#2A2A3A]'}`}>
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
      <input type={type} value={local} onChange={(e) => setLocal(e.target.value)} onBlur={() => onSave(local)}
        className="w-48 h-7 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-2 focus:border-emerald-500/50 outline-none" />
    </div>
  );
}
