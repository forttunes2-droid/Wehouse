import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { invalidateSettingsCache } from '@/hooks/usePlatformSettings';
import { toast } from 'sonner';

interface SettingDef {
  key: string;
  label: string;
  description: string;
  type: 'text' | 'toggle' | 'number' | 'textarea' | 'select';
  defaultValue: string;
  options?: { value: string; label: string }[];
}

interface DomainSettingsPanelProps {
  title: string;
  description: string;
  settings: SettingDef[];
}

// Historical UI names must never create competing database settings.
// These aliases point at the keys used by the live settlement workflows.
const CANONICAL_KEYS: Record<string, string> = {
  property_partner_commission_rate: 'commission_apartment',
  hotel_commission_rate: 'commission_hotel',
};

function canonicalKey(key: string) {
  return CANONICAL_KEYS[key] || key;
}

export default function DomainSettingsPanel({ title, description, settings: defs }: DomainSettingsPanelProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const keys = useMemo(() => Array.from(new Set(defs.map(d => canonicalKey(d.key)))), [defs]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from('platform_settings')
        .select('key, value, is_active')
        .in('key', keys);

      if (cancelled) return;
      if (error) {
        toast.error('Failed to load settings');
        setLoading(false);
        return;
      }

      const next: Record<string, string> = {};
      for (const def of defs) {
        const dbKey = canonicalKey(def.key);
        const dbRow = data?.find((r: any) => r.key === dbKey && r.is_active !== false);
        next[def.key] = dbRow?.value ?? def.defaultValue;
      }
      setValues(next);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [defs, keys]);

  async function saveSetting(def: SettingDef, nextValue: string) {
    const dbKey = canonicalKey(def.key);
    setSaving(prev => ({ ...prev, [def.key]: true }));

    const { error } = await supabase.from('platform_settings').upsert({
      key: dbKey,
      value: nextValue,
      label: def.label,
      description: def.description,
      category: 'platform',
      data_type: def.type === 'toggle' ? 'boolean' : def.type === 'number' ? 'number' : 'text',
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });

    if (error) {
      toast.error(`Failed to save ${def.label}: ${error.message}`);
      setSaving(prev => ({ ...prev, [def.key]: false }));
      return;
    }

    const { data: verify, error: verifyError } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', dbKey)
      .maybeSingle();

    if (verifyError || !verify || String(verify.value) !== String(nextValue)) {
      toast.error(`${def.label} could not be verified after saving`);
      setSaving(prev => ({ ...prev, [def.key]: false }));
      return;
    }

    setValues(prev => ({ ...prev, [def.key]: nextValue }));
    invalidateSettingsCache();
    toast.success(`${def.label} saved`);
    setSaving(prev => ({ ...prev, [def.key]: false }));
  }

  function change(def: SettingDef, value: string) {
    setValues(prev => ({ ...prev, [def.key]: value }));
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-5">
        <div className="flex justify-center py-5">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="mt-1 text-[10px] leading-relaxed text-[#666A7C]">{description}</p>
      </div>

      <div className="divide-y divide-white/[0.05]">
        {defs.map(def => {
          const value = values[def.key] ?? def.defaultValue;
          const isSaving = saving[def.key];
          return (
            <div key={def.key} className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(180px,260px)] sm:items-center">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-white">{def.label}</p>
                <p className="mt-1 text-[10px] leading-relaxed text-[#666A7C]">{def.description}</p>
              </div>

              <div className="flex min-w-0 items-center justify-start gap-2 sm:justify-end">
                {def.type === 'toggle' && (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => {
                      const next = value === 'true' ? 'false' : 'true';
                      change(def, next);
                      void saveSetting(def, next);
                    }}
                    aria-pressed={value === 'true'}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${value === 'true' ? 'bg-violet-500' : 'border border-white/[0.08] bg-[#252936]'}`}
                  >
                    <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${value === 'true' ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                )}

                {def.type === 'number' && (
                  <input
                    type="number"
                    value={value}
                    onChange={e => change(def, e.target.value)}
                    className="h-10 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-[#171A23] px-3 text-xs text-white outline-none focus:border-violet-500/40 sm:max-w-32"
                  />
                )}

                {def.type === 'text' && (
                  <input
                    type="text"
                    value={value}
                    onChange={e => change(def, e.target.value)}
                    className="h-10 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-[#171A23] px-3 text-xs text-white outline-none focus:border-violet-500/40"
                  />
                )}

                {def.type === 'select' && def.options && (
                  <select
                    value={value}
                    disabled={isSaving}
                    onChange={e => {
                      const next = e.target.value;
                      change(def, next);
                      void saveSetting(def, next);
                    }}
                    className="h-10 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-[#171A23] px-3 text-xs text-white outline-none focus:border-violet-500/40"
                  >
                    {def.options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                )}

                {def.type === 'textarea' && (
                  <textarea
                    value={value}
                    onChange={e => change(def, e.target.value)}
                    rows={3}
                    className="min-w-0 flex-1 resize-none rounded-xl border border-white/[0.08] bg-[#171A23] px-3 py-2 text-xs text-white outline-none focus:border-violet-500/40"
                  />
                )}

                {def.type !== 'toggle' && def.type !== 'select' && (
                  <button
                    type="button"
                    onClick={() => void saveSetting(def, value)}
                    disabled={isSaving}
                    className="h-10 shrink-0 rounded-xl bg-violet-500 px-3 text-[10px] font-semibold text-white disabled:opacity-40"
                  >
                    {isSaving ? 'Saving…' : 'Save'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
