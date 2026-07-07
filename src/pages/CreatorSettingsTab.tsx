import { useState, useEffect } from 'react';
import { supabase, getServiceCategories, getServiceSubcategories, createServiceCategory, updateServiceCategory, deleteServiceCategory, createServiceSubcategory, updateServiceSubcategory, deleteServiceSubcategory } from '@/lib/supabase';
import type { Profile, ServiceCategory, ServiceSubcategory } from '@/types';
import { Toaster, toast } from 'sonner';

interface CreatorSettingsTabProps {
  profile: Profile;
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS CONFIG — Everything the Creator can configure
// ═══════════════════════════════════════════════════════════════

interface SettingDef {
  key: string;
  label: string;
  description: string;
  type: 'text' | 'textarea' | 'number' | 'toggle' | 'color' | 'email' | 'url';
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

const SETTING_GROUPS = [
  {
    id: 'commissions',
    label: 'Commissions',
    settings: [
      { key: 'worker_commission', label: 'Worker Commission (%)', description: 'Percentage WeHouse earns from completed worker jobs. Example: 10% of N20,000 = N2,000 to WeHouse', type: 'number', defaultValue: '10' },
      { key: 'property_commission', label: 'Property Commission (%)', description: 'Percentage WeHouse earns from Long Stay and Short Let bookings', type: 'number', defaultValue: '5' },
      { key: 'hotel_commission', label: 'Hotel Commission (%)', description: 'Percentage WeHouse earns from hotel bookings', type: 'number', defaultValue: '12' },
      { key: 'vat_percent', label: 'VAT (%)', description: 'VAT percentage if VAT registered. Set to 0 to disable.', type: 'number', defaultValue: '0' },
    ] as SettingDef[],
  },
  {
    id: 'company',
    label: 'Company',
    settings: [
      { key: 'company_name', label: 'Company Name', description: 'Legal business name displayed on the platform', type: 'text', defaultValue: 'WeHouse Nigeria' },
      { key: 'company_logo', label: 'Company Logo URL', description: 'URL to company logo image', type: 'url', defaultValue: '' },
      { key: 'currency', label: 'Currency', description: 'Platform currency code', type: 'text', defaultValue: 'NGN' },
    ] as SettingDef[],
  },
  {
    id: 'contact',
    label: 'Contact',
    settings: [
      { key: 'support_email', label: 'Support Email', description: 'Primary support email address', type: 'email', defaultValue: 'support@wehouse.ng' },
      { key: 'support_phone', label: 'Support Phone', description: 'Customer support phone number', type: 'text', defaultValue: '' },
      { key: 'whatsapp_number', label: 'WhatsApp Number', description: 'Business WhatsApp for support', type: 'text', defaultValue: '' },
      { key: 'telegram_link', label: 'Telegram Link', description: 'Telegram support group link', type: 'url', defaultValue: '' },
      { key: 'company_address', label: 'Company Address', description: 'Physical office address', type: 'textarea', defaultValue: '' },
    ] as SettingDef[],
  },
  {
    id: 'payment',
    label: 'Payment',
    settings: [
      { key: 'paystack_public_key', label: 'Paystack Public Key', description: 'Paystack public key for client-side payments', type: 'text', defaultValue: '' },
      { key: 'paystack_secret_key', label: 'Paystack Secret Key', description: 'Paystack secret key for server transfers', type: 'text', defaultValue: '' },
      { key: 'payment_test_mode', label: 'Test Mode', description: 'Enable Paystack sandbox mode', type: 'toggle', defaultValue: 'true' },
    ] as SettingDef[],
  },
  {
    id: 'auth',
    label: 'Auth',
    settings: [
      { key: 'google_oauth_client_id', label: 'Google OAuth Client ID', description: 'Google OAuth client ID for login', type: 'text', defaultValue: '' },
    ] as SettingDef[],
  },
  {
    id: 'legal',
    label: 'Legal',
    settings: [
      { key: 'terms_conditions', label: 'Terms & Conditions', description: 'Full terms displayed to users', type: 'textarea', defaultValue: '' },
      { key: 'privacy_policy', label: 'Privacy Policy', description: 'Full privacy policy displayed to users', type: 'textarea', defaultValue: '' },
      { key: 'cancellation_policy', label: 'Cancellation Policy', description: 'Booking cancellation policy', type: 'textarea', defaultValue: '' },
    ] as SettingDef[],
  },
  {
    id: 'rules',
    label: 'Rules',
    settings: [
      { key: 'booking_rules', label: 'Booking Rules', description: 'Rules for property bookings', type: 'textarea', defaultValue: '' },
      { key: 'roommate_rules', label: 'Roommate Rules', description: 'Rules for roommate matching', type: 'textarea', defaultValue: '' },
      { key: 'worker_verification_rules', label: 'Worker Verification Rules', description: 'Requirements for worker verification', type: 'textarea', defaultValue: '' },
      { key: 'property_inspection_rules', label: 'Property Inspection Rules', description: 'Rules for property inspections', type: 'textarea', defaultValue: '' },
      { key: 'hotel_approval_rules', label: 'Hotel Approval Rules', description: 'Requirements for hotel approval', type: 'textarea', defaultValue: '' },
    ] as SettingDef[],
  },
  {
    id: 'platform',
    label: 'Platform',
    settings: [
      { key: 'maintenance_mode', label: 'Maintenance Mode', description: 'Put entire platform in maintenance mode', type: 'toggle', defaultValue: 'false' },
      { key: 'wallet_minimum_withdrawal', label: 'Min Withdrawal (N)', description: 'Minimum amount workers/partners can withdraw', type: 'number', defaultValue: '1000' },
      { key: 'escrow_auto_release_days', label: 'Escrow Auto-Release (Days)', description: 'Days before escrow auto-releases after job completion', type: 'number', defaultValue: '7' },
      { key: 'dispute_period_days', label: 'Dispute Period (Days)', description: 'Days after completion to open a dispute', type: 'number', defaultValue: '3' },
    ] as SettingDef[],
  },
  {
    id: 'features',
    label: 'Features',
    settings: [
      { key: 'worker_approval', label: 'Worker Approval', description: 'manual or auto approval', type: 'text', defaultValue: 'manual' },
      { key: 'worker_video_required', label: 'Video Intro Required', description: 'Require workers to submit a video', type: 'toggle', defaultValue: 'true' },
      { key: 'max_skills_worker', label: 'Max Skills Per Worker', description: 'Maximum services a worker can offer', type: 'number', defaultValue: '5' },
    ] as SettingDef[],
  },
  {
    id: 'features',
    label: 'Features',
    settings: [
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

      {view === 'settings' && <PlatformSettings />}
      {view === 'categories' && <CategoryManager profile={profile} />}
      {view === 'property_types' && <PropertyTypeManager profile={profile} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PLATFORM SETTINGS — Simple, clean, grouped
// ═══════════════════════════════════════════════════════════════

function PlatformSettings() {
  const [dbSettings, setDbSettings] = useState<DbSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState('commissions');

  // Load all settings from database on mount
  useEffect(() => {
    loadAllSettings();
  }, []);

  async function loadAllSettings() {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_all_settings_v2');
      if (!error && data && data.length > 0) {
        // Filter to only our known categories
        const knownCategories = SETTING_GROUPS.map(g => g.id);
        const filtered = (data as DbSetting[]).filter(s => knownCategories.includes(s.category));
        if (filtered.length > 0) {
          setDbSettings(filtered);
          setLoading(false);
          return;
        }
      }
    } catch {
      // RPC failed
    }
    // If DB load failed or returned nothing, seed from hardcoded defaults
    const defaults: DbSetting[] = [];
    SETTING_GROUPS.forEach(g => {
      g.settings.forEach((s, i) => {
        defaults.push({
          id: i,
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
    setLoading(false);
  }

  async function saveSetting(key: string, value: string) {
    setSaving(key);
    try {
      // Try RPC first
      const { error } = await supabase.rpc('set_setting_v2', {
        p_key: key,
        p_value: value,
      });
      if (error) {
        // Fallback: direct table upsert
        const { error: upsertError } = await supabase
          .from('platform_settings')
          .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        if (upsertError) {
          toast.error('Failed to save: ' + upsertError.message);
          setSaving(null);
          return;
        }
      }
      setDbSettings(prev => prev.map(s => s.key === key ? { ...s, value } : s));
      toast.success('Saved');
    } catch (e: any) {
      toast.error('Save failed: ' + (e.message || 'Unknown error'));
    }
    setSaving(null);
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

  // Get unique categories from DB settings
  const categories = [...new Set(dbSettings.map(s => s.category))];
  const currentSettings = dbSettings.filter(s => s.category === activeGroup);

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-[#5C5E72]">
        Configure WeHouse platform settings. Changes apply immediately across the entire platform.
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
            saving={saving === setting.key}
            onSave={(val) => saveSetting(setting.key, val)}
          />
        ))}

        {currentSettings.length === 0 && (
          <div className="text-center py-10">
            <p className="text-sm text-[#5C5E72]">No settings in this category</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Individual Setting Field ──────────────────────────

function SettingField({ def, value, saving, onSave }: {
  def: SettingDef;
  value: string;
  saving: boolean;
  onSave: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);

  useEffect(() => { setLocal(value); }, [value]);

  const handleBlur = () => {
    if (local !== value) onSave(local);
  };

  const handleToggle = () => {
    const next = local === 'true' ? 'false' : 'true';
    setLocal(next);
    onSave(next);
  };

  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-white">{def.label}</p>
            {saving && <div className="w-3 h-3 border border-[#3B82F6] border-t-transparent rounded-full animate-spin" />}
          </div>
          <p className="text-[10px] text-[#5C5E72] mt-0.5">{def.description}</p>
        </div>

        <div className="flex-shrink-0">
          {def.type === 'toggle' ? (
            <ToggleSwitch enabled={local === 'true'} onToggle={handleToggle} />
          ) : def.type === 'textarea' ? (
            <div className="w-64">
              <textarea
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                onBlur={handleBlur}
                rows={6}
                placeholder={`Enter ${def.label.toLowerCase()}...`}
                className="w-full rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 py-2 placeholder-[#3A3A4A] focus:border-[#3B82F6]/50 outline-none resize-none"
              />
              <p className="text-[9px] text-[#3A3A4A] mt-1">Auto-saves when you click away</p>
            </div>
          ) : def.type === 'color' ? (
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={local || '#3B82F6'}
                onChange={(e) => { setLocal(e.target.value); onSave(e.target.value); }}
                className="w-8 h-8 rounded-lg border-0 cursor-pointer"
              />
              <span className="text-[10px] text-[#5C5E72] font-mono">{local}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type={def.type === 'number' ? 'number' : def.type === 'email' ? 'email' : def.type === 'url' ? 'url' : 'text'}
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                onBlur={handleBlur}
                placeholder={def.type === 'number' ? '0' : '...'}
                className="w-40 h-9 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none"
              />
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

  async function handleToggleActive(cat: ServiceCategory) {
    const { error } = await updateServiceCategory(cat.id, { is_active: !cat.is_active });
    if (error) { toast.error('Failed: ' + error.message); return; }
    setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, is_active: !c.is_active } : c));
    toast.success(cat.is_active ? 'Category hidden' : 'Category activated');
  }

  async function handleToggleSubActive(sub: ServiceSubcategory) {
    const { error } = await updateServiceSubcategory(sub.id, { is_active: !sub.is_active });
    if (error) { toast.error('Failed: ' + error.message); return; }
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

      <button onClick={openNewCat} className="px-3 py-2 rounded-xl bg-[#3B82F6]/15 text-[#3B82F6] text-xs font-semibold border border-[#3B82F6]/20 hover:bg-[#3B82F6]/25 transition-colors">
        + New Category
      </button>

      {/* Category Form */}
      {showCatForm && (
        <form onSubmit={editingCat ? handleUpdateCategory : handleCreateCategory} className="glass rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-white">{editingCat ? 'Edit Category' : 'New Category'}</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Name *</label>
              <input type="text" value={catForm.name} onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none" placeholder="e.g. Plumbing" />
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Icon (emoji)</label>
              <input type="text" value={catForm.icon} onChange={e => setCatForm(f => ({ ...f, icon: e.target.value }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none" placeholder="e.g. 🔧" />
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Sort Order</label>
              <input type="number" value={catForm.sort_order} onChange={e => setCatForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 rounded-lg bg-[#3B82F6] text-white text-xs font-semibold hover:bg-[#2563EB]">{editingCat ? 'Update' : 'Create'}</button>
            <button type="button" onClick={() => { setShowCatForm(false); setEditingCat(null); }} className="px-4 py-1.5 rounded-lg bg-[#12121A] text-[#5C5E72] text-xs hover:text-white">Cancel</button>
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
              <input type="text" value={subForm.name} onChange={e => setSubForm(f => ({ ...f, name: e.target.value }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none" placeholder="e.g. Pipe Repair" />
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Parent Category *</label>
              <select value={subForm.category_id} onChange={e => setSubForm(f => ({ ...f, category_id: e.target.value }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none">
                <option value="">Select...</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] block mb-1">Sort Order</label>
              <input type="number" value={subForm.sort_order} onChange={e => setSubForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                className="w-full h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 focus:border-[#3B82F6]/50 outline-none" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 rounded-lg bg-[#3B82F6] text-white text-xs font-semibold hover:bg-[#2563EB]">{editingSub ? 'Update' : 'Create'}</button>
            <button type="button" onClick={() => { setShowSubForm(false); setEditingSub(null); }} className="px-4 py-1.5 rounded-lg bg-[#12121A] text-[#5C5E72] text-xs hover:text-white">Cancel</button>
          </div>
        </form>
      )}

      {/* Categories List */}
      <div className="space-y-3">
        {visibleCategories.map(cat => {
          const catSubs = subcategories.filter(s => s.category_id === cat.id);
          return (
            <div key={cat.id} className={`glass rounded-xl overflow-hidden ${!cat.is_active ? 'opacity-50' : ''}`}>
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-xl">{cat.icon || '📦'}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-white">{cat.name}</p>
                      {!cat.is_active && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">HIDDEN</span>}
                    </div>
                    <p className="text-[10px] text-[#5C5E72]">{catSubs.length} subcategories</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => handleToggleActive(cat)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${cat.is_active ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'}`}>
                    {cat.is_active ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>}
                  </button>
                  <button onClick={() => startEditCat(cat)} className="w-8 h-8 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-[#3B82F6]" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  </button>
                  <button onClick={() => { if (confirm(`Delete "${cat.name}"?`)) handleDeleteCategory(cat.id); }} disabled={deleting === cat.id}
                    className="w-8 h-8 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-red-400 disabled:opacity-50" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  </button>
                </div>
              </div>

              {/* Subcategories */}
              <div className="border-t border-[#1E1E2C] px-3.5 py-2">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[9px] text-[#5C5E72] font-medium uppercase tracking-wider">Subcategories ({catSubs.length})</p>
                  <button onClick={() => { setEditingSub(null); setSubForm({ name: '', category_id: cat.id, sort_order: catSubs.length }); setShowSubForm(true); }}
                    className="text-[10px] px-2 py-0.5 rounded-md bg-[#3B82F6]/10 text-[#3B82F6] hover:bg-[#3B82F6]/20">+ Add</button>
                </div>
                {catSubs.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {catSubs.map(sub => (
                      <span key={sub.id} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] ${sub.is_active ? 'bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20' : 'bg-red-500/5 text-red-400/60 border border-red-500/10 line-through'}`}>
                        {sub.name}
                        <button onClick={() => handleToggleSubActive(sub)} title={sub.is_active ? 'Hide' : 'Show'} className="hover:opacity-70">{sub.is_active ? '👁' : '🚫'}</button>
                        <button onClick={() => startEditSub(sub)} className="hover:opacity-70">✏️</button>
                        <button onClick={() => { if (confirm(`Delete "${sub.name}"?`)) handleDeleteSubcategory(sub.id); }} className="hover:opacity-70">🗑</button>
                      </span>
                    ))}
                  </div>
                ) : <p className="text-[10px] text-[#3A3A4A] italic">No subcategories yet</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROPERTY TYPE MANAGER
// ═══════════════════════════════════════════════════════════════

function PropertyTypeManager({ profile: _profile }: { profile: Profile }) {
  const [types, setTypes] = useState<string[]>([]);
  const [subtypes, setSubtypes] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newType, setNewType] = useState('');
  const [newSubtype, setNewSubtype] = useState<Record<string, string>>({});

  const ICON_MAP: Record<string, string> = {
    apartment: '🏢', hotel: '🏨', house: '🏠', duplex: '🏘️',
    studio: '🛋️', self_contain: '🚪', hostel: '🛏️',
    lodge: '🏕️', resort: '🏖️', office: '🏢', warehouse: '🏭', land: '🌿',
  };

  function toLabel(value: string): string {
    return value.split(/[_\-]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  async function load() {
    setLoading(true);
    const { data: typesData } = await supabase.rpc('get_setting_v2', { p_key: 'property_types_allowed' });
    let loadedTypes: string[] = [];
    if (typesData) { try { const p = JSON.parse(typesData); if (Array.isArray(p)) loadedTypes = p; } catch { } }
    if (loadedTypes.length === 0) loadedTypes = ['apartment', 'house', 'duplex', 'studio', 'self_contain', 'office', 'warehouse', 'land', 'hotel', 'hostel', 'lodge', 'resort'];
    setTypes(loadedTypes);

    const { data: subData } = await supabase.rpc('get_setting_v2', { p_key: 'property_subtypes' });
    let loadedSubtypes: Record<string, string[]> = {};
    if (subData) { try { loadedSubtypes = JSON.parse(subData); } catch { } }
    if (Object.keys(loadedSubtypes).length === 0) {
      loadedSubtypes = { apartment: ['Short Stay', 'Long Stay'], house: ['Bungalow', 'Duplex', 'Terrace'], hotel: ['Standard', 'Deluxe', 'Suite'] };
    }
    setSubtypes(loadedSubtypes);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function saveTypes(newTypes: string[]) {
    setSaving(true);
    await supabase.rpc('set_setting_v2', { p_key: 'property_types_allowed', p_value: JSON.stringify(newTypes) });
    setSaving(false);
    setTypes(newTypes);
  }

  async function saveSubtypes(newSubtypes: Record<string, string[]>) {
    setSaving(true);
    await supabase.rpc('set_setting_v2', { p_key: 'property_subtypes', p_value: JSON.stringify(newSubtypes) });
    setSaving(false);
    setSubtypes(newSubtypes);
  }

  function handleAddType() {
    const clean = newType.trim().toLowerCase().replace(/\s+/g, '_');
    if (!clean) { toast.error('Enter a property type'); return; }
    if (types.includes(clean)) { toast.error('Already exists'); return; }
    saveTypes([...types, clean]);
    setNewType('');
  }

  function handleRemoveType(value: string) {
    if (!confirm(`Remove "${toLabel(value)}"?`)) return;
    saveTypes(types.filter(t => t !== value));
    const ns = { ...subtypes }; delete ns[value]; saveSubtypes(ns);
  }

  function handleAddSubtype(parent: string) {
    const val = (newSubtype[parent] || '').trim();
    if (!val) { toast.error('Enter a sub-type'); return; }
    const cur = subtypes[parent] || [];
    if (cur.includes(val)) { toast.error('Already exists'); return; }
    saveSubtypes({ ...subtypes, [parent]: [...cur, val] });
    setNewSubtype(p => ({ ...p, [parent]: '' }));
  }

  function handleRemoveSubtype(parent: string, sub: string) {
    saveSubtypes({ ...subtypes, [parent]: (subtypes[parent] || []).filter(s => s !== sub) });
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-3 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Property Types</h2>
        {saving && <div className="w-5 h-5 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />}
      </div>

      <div className="flex gap-2">
        <input type="text" value={newType} onChange={e => setNewType(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddType()} placeholder="e.g. Penthouse..."
          className="flex-1 h-10 rounded-xl bg-[#12121A] border border-[#1E1E2C] text-white text-sm px-4 placeholder-[#3A3A4A] focus:border-[#3B82F6]/50 outline-none" />
        <button onClick={handleAddType} className="h-10 px-4 rounded-xl bg-[#3B82F6]/15 text-[#3B82F6] text-xs font-semibold border border-[#3B82F6]/20">+ Add Type</button>
      </div>

      <div className="space-y-3">
        {types.map(t => {
          const ts = subtypes[t] || [];
          return (
            <div key={t} className="glass rounded-xl overflow-hidden">
              <div className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{ICON_MAP[t] || '🏠'}</span>
                  <div>
                    <p className="text-xs font-semibold text-white">{toLabel(t)}</p>
                    <p className="text-[10px] text-[#5C5E72]">{ts.length} sub-types</p>
                  </div>
                </div>
                <button onClick={() => handleRemoveType(t)} className="w-7 h-7 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-red-400">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                </button>
              </div>
              <div className="border-t border-[#1E1E2C] px-3 py-2">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {ts.map(sub => <span key={sub} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">{sub} <button onClick={() => handleRemoveSubtype(t, sub)} className="hover:text-red-400">×</button></span>)}
                  {ts.length === 0 && <p className="text-[10px] text-[#3A3A4A] italic">No sub-types</p>}
                </div>
                <div className="flex gap-2">
                  <input type="text" value={newSubtype[t] || ''} onChange={e => setNewSubtype(p => ({ ...p, [t]: e.target.value }))} onKeyDown={e => e.key === 'Enter' && handleAddSubtype(t)} placeholder={`Add sub-type...`}
                    className="flex-1 h-8 rounded-lg bg-[#12121A] border border-[#1E1E2C] text-white text-[11px] px-3 placeholder-[#3A3A4A] focus:border-[#3B82F6]/50 outline-none" />
                  <button onClick={() => handleAddSubtype(t)} className="h-8 px-3 rounded-lg bg-[#3B82F6]/10 text-[#3B82F6] text-[10px] font-semibold">+ Add</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Toggle Switch ──────────────────────────────────

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-[#3B82F6]' : 'bg-[#1E1E2C]'}`}
    >
      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5.5 left-0.5' : 'left-0.5'}`}
        style={{ transform: enabled ? 'translateX(20px)' : 'translateX(0)' }} />
    </button>
  );
}
