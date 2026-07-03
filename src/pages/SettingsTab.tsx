import { useState, useEffect } from 'react';
import { getSystemSettings, updateSystemSetting, logAuditAction } from '@/lib/supabase';
import { useCreatorAuth } from '@/hooks/useCreatorAuth';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { toast } from 'sonner';

interface SettingsTabProps {
  profile: Profile;
  isCreator: boolean;
}

interface SettingDef {
  key: string;
  label: string;
  type: 'text' | 'select';
  options?: [string, string][];
  creatorOnly?: boolean;
  description?: string;
}

type SettingsSubPage = 'menu' | 'general' | 'finance';

// ═══════════════════════════════════════════════════════════
// MAIN SETTINGS TAB — with sub-navigation
// ═══════════════════════════════════════════════════════════

export default function SettingsTab({ profile, isCreator }: SettingsTabProps) {
  const [subPage, setSubPage] = useState<SettingsSubPage>('menu');

  // Menu view — show categories
  if (subPage === 'menu') {
    return <SettingsMenu isCreator={isCreator} onNavigate={setSubPage} />;
  }

  // General settings
  if (subPage === 'general') {
    return <GeneralSettings profile={profile} isCreator={isCreator} onBack={() => setSubPage('menu')} />;
  }

  // Finance settings
  if (subPage === 'finance') {
    return <FinanceSettings onBack={() => setSubPage('menu')} />;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════
// SETTINGS MENU — Category selector
// ═══════════════════════════════════════════════════════════

function SettingsMenu({ isCreator, onNavigate }: { isCreator: boolean; onNavigate: (p: SettingsSubPage) => void }) {
  const categories = [
    {
      id: 'general' as SettingsSubPage,
      label: 'General Settings',
      desc: 'Platform name, maintenance mode, registration, support contacts, AI key',
      icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
      creatorOnly: false,
    },
    {
      id: 'finance' as SettingsSubPage,
      label: 'Finance Settings',
      desc: 'Commissions, fees, reservation fee, worker charges',
      icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
      creatorOnly: true,
    },
  ].filter(c => !c.creatorOnly || isCreator);

  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl p-4">
        <p className="text-xs text-white font-medium">Platform Settings</p>
        <p className="text-[10px] text-[#5C5E72] mt-0.5">Choose a category to configure</p>
      </div>

      <div className="space-y-3">
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => onNavigate(cat.id)}
            className="w-full glass rounded-2xl p-4 flex items-center gap-4 text-left card-hover group"
          >
            <div className="w-11 h-11 rounded-xl bg-[#1A1A24] border border-[#232330] flex items-center justify-center flex-shrink-0 group-hover:border-[#3B82F6]/30 transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5">
                <path d={cat.icon} />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">{cat.label}</p>
              <p className="text-[10px] text-[#5C5E72] mt-0.5">{cat.desc}</p>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2" className="flex-shrink-0">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// GENERAL SETTINGS — The existing settings page
// ═══════════════════════════════════════════════════════════

function GeneralSettings({ profile, isCreator, onBack }: { profile: Profile; isCreator: boolean; onBack: () => void }) {
  const { requestAuth } = useCreatorAuth();
  const [savedSettings, setSavedSettings] = useState<Record<string, string>>({});
  const [pendingSettings, setPendingSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    async function load() {
      const { settings: data } = await getSystemSettings();
      const map: Record<string, string> = {};
      if (data) data.forEach((s: any) => { if (s.value != null) map[s.key] = s.value; });
      if (!map.platform_name) map.platform_name = 'WeHouse';
      if (!map.listing_approval_required) map.listing_approval_required = 'false';
      if (!map.maintenance_mode) map.maintenance_mode = 'false';
      if (!map.registration_open) map.registration_open = 'true';
      if (!map.max_listings_per_user) map.max_listings_per_user = 'unlimited';
      if (!map.support_whatsapp) map.support_whatsapp = '';
      if (!map.support_telegram) map.support_telegram = '';
      if (!map.support_email) map.support_email = '';
      if (!map.openai_api_key) map.openai_api_key = '';
      setSavedSettings(map);
      setPendingSettings(map);
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    const changed = Object.keys(pendingSettings).some(k => pendingSettings[k] !== savedSettings[k]);
    setHasChanges(changed);
  }, [pendingSettings, savedSettings]);

  async function handleSaveAll() {
    if (isCreator) { requestAuth(doSave); return; }
    doSave();
  }

  async function doSave() {
    setSaving(true);
    const keys = Object.keys(pendingSettings).filter(k => pendingSettings[k] !== savedSettings[k]);
    if (keys.length === 0) { toast.info('No changes to save'); setSaving(false); return; }
    let savedCount = 0;
    for (const key of keys) {
      const { error } = await updateSystemSetting(key, pendingSettings[key], profile.user_id);
      if (error) { toast.error(`Failed to save "${key}"`); } else { savedCount++; await logAuditAction(profile.user_id, profile.email, 'update_setting', 'setting', key, `${key} = ${pendingSettings[key]}`); }
    }
    if (savedCount === keys.length) { toast.success(`${savedCount} setting${savedCount > 1 ? 's' : ''} saved`); setSavedSettings({ ...pendingSettings }); }
    else if (savedCount > 0) { toast.warning(`${savedCount}/${keys.length} saved`); setSavedSettings({ ...pendingSettings }); }
    else { toast.error('All saves failed'); }
    setSaving(false);
  }

  function handleDiscard() { setPendingSettings({ ...savedSettings }); toast.info('Changes discarded'); }

  if (loading) { return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>; }

  const settings: SettingDef[] = [
    { key: 'platform_name', label: 'Platform Name', type: 'text', description: 'The name displayed across the app' },
    { key: 'listing_approval_required', label: 'Require Listing Approval', type: 'select', options: [['false', 'No \u2014 Listings go live immediately'], ['true', 'Yes \u2014 Require admin approval']], description: 'Control whether new listings need approval' },
    { key: 'maintenance_mode', label: 'Maintenance Mode', type: 'select', options: [['false', 'Off \u2014 App is open to everyone'], ['true', 'On \u2014 Only creator can access']], creatorOnly: true, description: 'When ON, blocks all non-creator users from logging in' },
    { key: 'registration_open', label: 'Allow New Registrations', type: 'select', options: [['true', 'Yes \u2014 Anyone can sign up'], ['false', 'No \u2014 New signups blocked']], creatorOnly: true, description: 'Control whether new accounts can be created' },
    { key: 'max_listings_per_user', label: 'Max Listings Per User', type: 'select', options: [['3', '3 listings'], ['5', '5 listings'], ['10', '10 listings'], ['20', '20 listings'], ['unlimited', 'Unlimited']], creatorOnly: true, description: 'Maximum listings a single user can post' },
    { key: 'support_whatsapp', label: 'Support WhatsApp', type: 'text', creatorOnly: true, description: 'WhatsApp number for support button (e.g., 2348012345678)' },
    { key: 'support_telegram', label: 'Support Telegram', type: 'text', creatorOnly: true, description: 'Telegram username or link (e.g., @wehouse or https://t.me/wehouse)' },
    { key: 'support_email', label: 'Support Email', type: 'text', creatorOnly: true, description: 'Support email address (e.g., support@wehouse.com.ng)' },
    { key: 'openai_api_key', label: 'OpenAI API Key', type: 'text', creatorOnly: true, description: 'API key for AI chat bot (from platform.openai.com/api-keys)' },
  ];

  const visible = settings.filter(s => !s.creatorOnly || isCreator);

  return (
    <div className="space-y-4">
      {/* Back button + header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-[#8A8B9C] hover:text-white transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>
        <div>
          <p className="text-xs text-white font-medium">General Settings</p>
          <p className="text-[10px] text-[#5C5E72]">Platform configuration</p>
        </div>
      </div>

      {visible.map(s => {
        const isChanged = pendingSettings[s.key] !== savedSettings[s.key];
        return (
          <div key={s.key} className={`glass rounded-2xl p-4 transition-colors ${isChanged ? 'border border-[#3B82F6]/30 bg-[#3B82F6]/[0.03]' : s.creatorOnly ? 'border border-purple-500/10' : ''}`}>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs text-[#8B8DA0] font-medium">{s.label}</label>
              {s.creatorOnly && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium">CREATOR</span>}
              {isChanged && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">CHANGED</span>}
            </div>
            {s.description && <p className="text-[10px] text-[#5C5E72] mb-2">{s.description}</p>}
            {s.type === 'text' ? (
              <input value={pendingSettings[s.key] || ''} onChange={(e) => setPendingSettings(prev => ({ ...prev, [s.key]: e.target.value }))} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 outline-none focus:border-[#3B82F6]" />
            ) : (
              <select value={pendingSettings[s.key] || ''} onChange={(e) => setPendingSettings(prev => ({ ...prev, [s.key]: e.target.value }))} className={`w-full h-10 rounded-xl border text-white text-sm px-4 outline-none ${isChanged ? 'bg-[#3B82F6]/5 border-[#3B82F6]/30' : 'bg-[#1A1A24] border-[#232330]'}`}>
                {s.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[9px] text-[#5C5E72]">Saved: <span className="text-[#8A8B9C]">{s.type === 'select' ? s.options?.find(o => o[0] === savedSettings[s.key])?.[1] || savedSettings[s.key] : savedSettings[s.key]}</span></span>
              {isChanged && <span className="text-[9px] text-amber-400">{`->`} Pending: {s.type === 'select' ? s.options?.find(o => o[0] === pendingSettings[s.key])?.[1] || pendingSettings[s.key] : pendingSettings[s.key]}</span>}
            </div>
          </div>
        );
      })}

      {hasChanges && (
        <div className="flex gap-3 sticky bottom-20 z-10 bg-[#0A0A0F]/90 backdrop-blur-sm pt-2 pb-6">
          <button onClick={handleSaveAll} disabled={saving} className="flex-1 h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving...</> : <>Save Changes</>}
          </button>
          <button onClick={handleDiscard} disabled={saving} className="h-11 px-5 rounded-xl bg-[#1A1A24] border border-[#232330] text-[#8A8B9C] text-sm font-medium hover:text-white transition-colors disabled:opacity-50">Discard</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// FINANCE SETTINGS — Fee configuration (moved from separate tab)
// ═══════════════════════════════════════════════════════════



function FinanceSettings({ onBack }: { onBack: () => void }) {
  const defaultFees = {
    longStayCommission: 10,
    shortStayCommission: 20,
    workerCommission: 12.5,
    workerBookingFee: 300,
    reservationFee: 5000,
    hotelCommission: 15,
    lateFeePercent: 5,
    securityDepositPercent: 10,
    securityDepositMin: 10000,
  };
  const [fees, setFees] = useState({ ...defaultFees });
  const [originalFees, setOriginalFees] = useState({ ...defaultFees });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Check if anything changed from what was loaded
  const hasChanges = Object.keys(fees).some(k => (fees as any)[k] !== (originalFees as any)[k]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('platform_settings').select('key, value').in('key', [
        'long_stay_commission_percent', 'short_stay_commission_percent', 'worker_commission_percent',
        'worker_booking_fee', 'reservation_fee', 'hotel_commission_percent', 'late_fee_percent',
        'security_deposit_percent', 'security_deposit_min',
      ]);
      const loaded = { ...defaultFees };
      if (data) {
        const map: Record<string, number> = {};
        data.forEach((r: any) => { map[r.key] = Number(r.value) || 0; });
        loaded.longStayCommission = map['long_stay_commission_percent'] || loaded.longStayCommission;
        loaded.shortStayCommission = map['short_stay_commission_percent'] || loaded.shortStayCommission;
        loaded.workerCommission = map['worker_commission_percent'] || loaded.workerCommission;
        loaded.workerBookingFee = map['worker_booking_fee'] || loaded.workerBookingFee;
        loaded.reservationFee = map['reservation_fee'] || loaded.reservationFee;
        loaded.hotelCommission = map['hotel_commission_percent'] || loaded.hotelCommission;
        loaded.lateFeePercent = map['late_fee_percent'] || loaded.lateFeePercent;
        loaded.securityDepositPercent = map['security_deposit_percent'] || loaded.securityDepositPercent;
        loaded.securityDepositMin = map['security_deposit_min'] || loaded.securityDepositMin;
      }
      setFees(loaded);
      setOriginalFees(loaded);
      setLoading(false);
    }
    load();
  }, []);

  async function handleSave() {
    setSaving(true);
    const updates = [
      { key: 'long_stay_commission_percent', value: String(fees.longStayCommission) },
      { key: 'short_stay_commission_percent', value: String(fees.shortStayCommission) },
      { key: 'worker_commission_percent', value: String(fees.workerCommission) },
      { key: 'worker_booking_fee', value: String(fees.workerBookingFee) },
      { key: 'reservation_fee', value: String(fees.reservationFee) },
      { key: 'hotel_commission_percent', value: String(fees.hotelCommission) },
      { key: 'late_fee_percent', value: String(fees.lateFeePercent) },
      { key: 'security_deposit_percent', value: String(fees.securityDepositPercent) },
      { key: 'security_deposit_min', value: String(fees.securityDepositMin) },
    ];
    for (const u of updates) {
      await supabase.from('platform_settings').upsert({ key: u.key, value: u.value }, { onConflict: 'key' });
    }
    setSaving(false);
    setOriginalFees({ ...fees }); // Reset the baseline so hasChanges = false
    toast.success('Fee settings saved');
  }

  function FeeCard({ label, desc, value, suffix, onChange, min = 0, max = 100 }:
    { label: string; desc: string; value: number; suffix: string; onChange: (v: number) => void; min?: number; max?: number }) {
    // Track local value as string to allow free typing (including decimals)
    const [local, setLocal] = useState(String(value));
    const [isDirty, setIsDirty] = useState(false);

    // Only sync from parent on initial mount or when parent value changes AND user isn't editing
    useEffect(() => {
      if (!isDirty) {
        setLocal(String(value));
      }
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      // Allow: empty, digits, one decimal point, digits after decimal
      if (raw === '' || /^\d*\.?\d{0,2}$/.test(raw)) {
        setLocal(raw);
        setIsDirty(true);
        // Only notify parent if it's a valid number
        if (raw !== '' && raw !== '.') {
          const n = Number(raw);
          if (!isNaN(n) && n >= min && n <= max) {
            onChange(n);
          }
        }
      }
    };

    const handleBlur = () => {
      setIsDirty(false);
      if (local === '' || local === '.') {
        setLocal(String(min));
        onChange(min);
        return;
      }
      const n = Number(local);
      if (isNaN(n)) {
        setLocal(String(value));
        return;
      }
      // Clamp to range
      const clamped = Math.max(min, Math.min(max, n));
      setLocal(String(clamped));
      onChange(clamped);
    };

    return (
      <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold text-white">{label}</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={local}
              onChange={handleChange}
              onBlur={handleBlur}
              className="w-24 h-9 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-sm text-center outline-none focus:border-emerald-500"
            />
            <span className="text-xs text-[#5C5E72] w-12">{suffix}</span>
          </div>
        </div>
        <p className="text-[10px] text-[#5C5E72]">{desc}</p>
      </div>
    );
  }

  if (loading) { return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>; }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-[#8A8B9C] hover:text-white transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>
        <div>
          <p className="text-xs text-white font-medium">Finance Settings</p>
          <p className="text-[10px] text-[#5C5E72]">Configure what WeHouse charges</p>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Apartments</h3>
        <FeeCard label="Long Stay Commission" desc="Monthly/yearly rentals. Lower because tenants stay long-term." value={fees.longStayCommission} suffix="%" onChange={v => setFees(f => ({ ...f, longStayCommission: v }))} max={50} />
        <FeeCard label="Short Stay Commission" desc="Daily/weekly rentals. Higher because of cleaning, turnover, management." value={fees.shortStayCommission} suffix="%" onChange={v => setFees(f => ({ ...f, shortStayCommission: v }))} max={50} />
        <FeeCard label="Reservation Fee" desc="What renters pay to hold a property for 72 hours." value={fees.reservationFee} suffix="NGN" onChange={v => setFees(f => ({ ...f, reservationFee: v }))} max={50000} />
        <FeeCard label="Short-Let Security Deposit %" desc="Default % for short-let only (furnished apartments with appliances). Long stay has no deposit. Each listing can override this." value={fees.securityDepositPercent} suffix="%" onChange={v => setFees(f => ({ ...f, securityDepositPercent: v }))} max={100} />
        <FeeCard label="Short-Let Security Deposit Min" desc="Minimum deposit for short-let. Only applies when listing owner doesn't set a custom amount." value={fees.securityDepositMin} suffix="NGN" onChange={v => setFees(f => ({ ...f, securityDepositMin: v }))} max={1000000} />
        <FeeCard label="Late Payment Fee" desc="Added to overdue monthly installment payments." value={fees.lateFeePercent} suffix="%" onChange={v => setFees(f => ({ ...f, lateFeePercent: v }))} max={20} />
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Hotels</h3>
        <FeeCard label="Hotel Commission" desc="Percentage of hotel booking value WeHouse keeps." value={fees.hotelCommission} suffix="%" onChange={v => setFees(f => ({ ...f, hotelCommission: v }))} max={50} />
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Service Workers</h3>
        <FeeCard label="Worker Commission" desc="Taken from worker earnings per completed job." value={fees.workerCommission} suffix="%" onChange={v => setFees(f => ({ ...f, workerCommission: v }))} max={50} />
        <FeeCard label="User Booking Fee" desc="Flat fee users pay per worker booking." value={fees.workerBookingFee} suffix="NGN" onChange={v => setFees(f => ({ ...f, workerBookingFee: v }))} max={2000} />
      </div>

      {/* Fee Summary — no fake numbers, just clear explanations */}
      <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-3">
        <h3 className="text-xs font-semibold text-white">How Fees Work</h3>

        <div className="rounded-xl bg-[#1A1A24] p-3">
          <p className="text-[10px] font-semibold text-emerald-400 mb-2">Long Stay Apartment</p>
          <p className="text-[10px] text-[#8A8B9C] leading-relaxed">
            When a user rents for a year+, WeHouse takes <span className="text-amber-400">{fees.longStayCommission}%</span> of the annual rent.
            The property partner receives <span className="text-emerald-400">{100 - fees.longStayCommission}%</span>.
            No security deposit — tenant brings their own appliances.
          </p>
        </div>

        <div className="rounded-xl bg-[#1A1A24] p-3">
          <p className="text-[10px] font-semibold text-orange-400 mb-2">Short Stay Apartment</p>
          <p className="text-[10px] text-[#8A8B9C] leading-relaxed">
            Daily/weekly rentals. Apartment includes furniture and appliances.
            WeHouse takes <span className="text-amber-400">{fees.shortStayCommission}%</span> — higher because of cleaning, turnover, management.
            Partner receives <span className="text-emerald-400">{100 - fees.shortStayCommission}%</span>.
            Security deposit (caution fee) of <span className="text-blue-400">{fees.securityDepositPercent}% (min N{fees.securityDepositMin.toLocaleString()})</span> held in escrow for appliance protection. Returned after stay if no damage. Each listing sets its own amount.
          </p>
        </div>

        <div className="rounded-xl bg-[#1A1A24] p-3">
          <p className="text-[10px] font-semibold text-blue-400 mb-2">Worker Booking</p>
          <p className="text-[10px] text-[#8A8B9C] leading-relaxed">
            User pays agreed price + N{fees.workerBookingFee} booking fee. 
            WeHouse takes <span className="text-amber-400">{fees.workerCommission}%</span> from the worker. 
            Worker keeps <span className="text-emerald-400">{100 - fees.workerCommission}%</span>. 
            Payment held in escrow until user approves completed work.
          </p>
        </div>
      </div>

      {/* Save bar — only shows when changes detected, sticky at bottom */}
      {hasChanges && (
        <div className="flex gap-3 sticky bottom-20 z-10 bg-[#0A0A0F]/90 backdrop-blur-sm pt-2 pb-6">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 h-11 rounded-xl bg-emerald-500 text-white font-semibold hover:bg-emerald-600 transition-colors disabled:opacity-50 active:scale-[0.98]">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button onClick={() => { setFees({ ...originalFees }); toast.info('Changes discarded'); }} disabled={saving}
            className="h-11 px-5 rounded-xl bg-[#1A1A24] border border-[#232330] text-[#5C5E72] font-medium hover:text-white transition-colors disabled:opacity-50">
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
