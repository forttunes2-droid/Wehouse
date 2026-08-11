import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { invalidateSettingsCache } from '@/hooks/usePlatformSettings';
import type { Profile } from '@/types';
import { toast } from 'sonner';

interface SettingDef {
  key: string;
  label: string;
  description: string;
  type: 'text' | 'toggle' | 'textarea' | 'email';
  defaultValue: string;
}

interface DbSetting {
  key: string;
  value: string;
  is_active: boolean;
}

const SETTING_GROUPS: Array<{ id: string; label: string; description: string; settings: SettingDef[] }> = [
  {
    id: 'identity',
    label: 'Platform identity',
    description: 'Public WeHouse contact and identity information.',
    settings: [
      { key: 'company_name', label: 'Company name', description: 'Name shown across the platform.', type: 'text', defaultValue: 'WeHouse' },
      { key: 'support_email', label: 'Support email', description: 'Primary public support email.', type: 'email', defaultValue: '' },
      { key: 'support_phone', label: 'Support phone', description: 'Primary public support phone number.', type: 'text', defaultValue: '' },
    ],
  },
  {
    id: 'access',
    label: 'Platform access',
    description: 'High-level switches that affect who can use WeHouse.',
    settings: [
      { key: 'maintenance_mode', label: 'Maintenance mode', description: 'Temporarily block normal platform access while maintenance is active.', type: 'toggle', defaultValue: 'false' },
      { key: 'registration_open', label: 'Registration open', description: 'Allow new accounts to register.', type: 'toggle', defaultValue: 'true' },
    ],
  },
  {
    id: 'legal',
    label: 'Legal content',
    description: 'Canonical legal text presented by the platform.',
    settings: [
      { key: 'privacy_policy', label: 'Privacy policy', description: 'Privacy policy text used by WeHouse.', type: 'textarea', defaultValue: '' },
      { key: 'terms_of_service', label: 'Terms & conditions', description: 'Terms governing use of WeHouse.', type: 'textarea', defaultValue: '' },
    ],
  },
];

export default function CreatorSettingsTab({ profile: _profile }: { profile?: Profile }) {
  const [settings, setSettings] = useState<DbSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const definitions = useMemo(() => SETTING_GROUPS.flatMap(group => group.settings), []);
  const keys = useMemo(() => definitions.map(def => def.key), [definitions]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from('platform_settings')
        .select('key,value,is_active')
        .in('key', keys);
      if (cancelled) return;
      if (error) {
        toast.error(`Failed to load platform settings: ${error.message}`);
        setLoading(false);
        return;
      }
      setSettings((data || []) as DbSetting[]);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [keys]);

  function storedValue(def: SettingDef) {
    const row = settings.find(setting => setting.key === def.key && setting.is_active !== false);
    return row?.value ?? def.defaultValue;
  }

  function currentValue(def: SettingDef) {
    return drafts[def.key] !== undefined ? drafts[def.key] : storedValue(def);
  }

  function setDraft(key: string, value: string) {
    setDrafts(prev => ({ ...prev, [key]: value }));
  }

  async function save(def: SettingDef, value: string) {
    setSaving(prev => ({ ...prev, [def.key]: true }));
    const { error } = await supabase.from('platform_settings').upsert({
      key: def.key,
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
      setSaving(prev => ({ ...prev, [def.key]: false }));
      return false;
    }

    const { data: verify, error: verifyError } = await supabase
      .from('platform_settings')
      .select('key,value,is_active')
      .eq('key', def.key)
      .maybeSingle();

    if (verifyError || !verify || String(verify.value) !== String(value)) {
      toast.error(`${def.label} could not be verified after saving`);
      setSaving(prev => ({ ...prev, [def.key]: false }));
      return false;
    }

    setSettings(prev => {
      const rest = prev.filter(setting => setting.key !== def.key);
      return [...rest, verify as DbSetting];
    });
    setDrafts(prev => {
      const next = { ...prev };
      delete next[def.key];
      return next;
    });
    invalidateSettingsCache();
    setSaving(prev => ({ ...prev, [def.key]: false }));
    return true;
  }

  async function saveAll() {
    const changed = definitions.filter(def => drafts[def.key] !== undefined);
    if (!changed.length) return;
    let saved = 0;
    for (const def of changed) {
      if (await save(def, drafts[def.key])) saved += 1;
    }
    if (saved) toast.success(`${saved} setting${saved === 1 ? '' : 's'} saved`);
  }

  if (loading) {
    return <div className="grid min-h-40 place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>;
  }

  const changedCount = Object.keys(drafts).length;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-white">Platform settings</h2>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[#686C7E]">Only global configuration lives here. Finance rules remain in Finance; staff, users and operational work remain in Management.</p>
        </div>
        {changedCount > 0 && (
          <button
            type="button"
            onClick={() => void saveAll()}
            disabled={Object.values(saving).some(Boolean)}
            className="h-10 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold text-white disabled:opacity-40"
          >
            {Object.values(saving).some(Boolean) ? 'Saving…' : `Save changes (${changedCount})`}
          </button>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {SETTING_GROUPS.map(group => (
          <div key={group.id} className={`${group.id === 'legal' ? 'xl:col-span-2' : ''} rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 sm:p-5`}>
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-white">{group.label}</h3>
              <p className="mt-1 text-[10px] text-[#666A7C]">{group.description}</p>
            </div>

            <div className="divide-y divide-white/[0.05]">
              {group.settings.map(def => {
                const value = currentValue(def);
                const isSaving = saving[def.key];
                const changed = drafts[def.key] !== undefined;
                return (
                  <div key={def.key} className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(180px,280px)] sm:items-center">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-white">{def.label}</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-[#666A7C]">{def.description}</p>
                    </div>

                    <div className="flex min-w-0 items-center gap-2 sm:justify-end">
                      {def.type === 'toggle' ? (
                        <button
                          type="button"
                          disabled={isSaving}
                          aria-pressed={value === 'true'}
                          onClick={() => {
                            const next = value === 'true' ? 'false' : 'true';
                            setDraft(def.key, next);
                            void save(def, next);
                          }}
                          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${value === 'true' ? 'bg-violet-500' : 'border border-white/[0.08] bg-[#252936]'}`}
                        >
                          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${value === 'true' ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                      ) : def.type === 'textarea' ? (
                        <textarea
                          rows={5}
                          value={value}
                          onChange={event => setDraft(def.key, event.target.value)}
                          className="min-w-0 flex-1 resize-y rounded-xl border border-white/[0.08] bg-[#171A23] px-3 py-2 text-xs text-white outline-none focus:border-violet-500/40"
                        />
                      ) : (
                        <input
                          type={def.type}
                          value={value}
                          onChange={event => setDraft(def.key, event.target.value)}
                          className="h-10 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-[#171A23] px-3 text-xs text-white outline-none focus:border-violet-500/40"
                        />
                      )}

                      {def.type !== 'toggle' && (
                        <button
                          type="button"
                          disabled={isSaving || !changed}
                          onClick={() => void save(def, value)}
                          className="h-10 shrink-0 rounded-xl bg-violet-500 px-3 text-[10px] font-semibold text-white disabled:opacity-30"
                        >
                          {isSaving ? 'Saving…' : 'Save'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
