import { useState, useEffect } from 'react';
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

export default function DomainSettingsPanel({ title, description, settings: defs }: DomainSettingsPanelProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function load() {
      setLoading(true);
      const keys = defs.map(d => d.key);
      const { data, error } = await supabase
        .from('platform_settings')
        .select('key, value, is_active')
        .in('key', keys);

      if (error) {
        toast.error('Failed to load settings');
        setLoading(false);
        return;
      }

      const vals: Record<string, string> = {};
      for (const def of defs) {
        const dbRow = data?.find((r: any) => r.key === def.key);
        if (dbRow && dbRow.is_active !== false) {
          vals[def.key] = dbRow.value || def.defaultValue;
        } else {
          vals[def.key] = def.defaultValue;
        }
      }
      setValues(vals);
      setLoading(false);
    }
    load();
  }, [defs]);

  async function saveSetting(key: string) {
    const def = defs.find(d => d.key === key);
    if (!def) return;

    const value = values[key];
    setSaving(prev => ({ ...prev, [key]: true }));

    const { error } = await supabase.from('platform_settings').upsert({
      key,
      value,
      label: def.label,
      description: def.description,
      category: 'platform',
      data_type: def.type === 'toggle' ? 'boolean' : def.type === 'number' ? 'number' : def.type === 'select' ? 'text' : 'text',
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });

    if (error) {
      toast.error(`Failed to save ${def.label}: ${error.message}`);
      setSaving(prev => ({ ...prev, [key]: false }));
      return;
    }

    invalidateSettingsCache();
    toast.success(`${def.label} saved`);
    setSaving(prev => ({ ...prev, [key]: false }));
  }

  if (loading) {
    return (
      <div className="glass rounded-2xl p-4">
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="text-[10px] text-[#5C5E72]">{description}</p>
      </div>

      {defs.map(def => {
        const value = values[def.key] ?? def.defaultValue;
        const isSaving = saving[def.key];

        return (
          <div key={def.key} className="rounded-xl p-3 bg-[#1A1A24]/50 border border-[#232330]">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-medium text-white">{def.label}</div>
                <div className="text-[10px] text-[#5C5E72]">{def.description}</div>
              </div>

              <div className="flex items-center gap-2">
                {def.type === 'toggle' && (
                  <button
                    onClick={() => {
                      const newVal = value === 'true' ? 'false' : 'true';
                      setValues(prev => ({ ...prev, [def.key]: newVal }));
                      setTimeout(() => saveSetting(def.key), 0);
                    }}
                    className={`relative w-11 h-6 rounded-full transition-colors ${value === 'true' ? 'bg-[#3B82F6]' : 'bg-[#2A2A3A] border border-[#232330]'}`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${value === 'true' ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                )}

                {def.type === 'number' && (
                  <input
                    type="number"
                    value={value}
                    onChange={e => setValues(prev => ({ ...prev, [def.key]: e.target.value }))}
                    onBlur={() => saveSetting(def.key)}
                    className="w-24 h-8 px-3 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-[11px] focus:outline-none focus:border-[#3B82F6]"
                  />
                )}

                {def.type === 'text' && (
                  <input
                    type="text"
                    value={value}
                    onChange={e => setValues(prev => ({ ...prev, [def.key]: e.target.value }))}
                    onBlur={() => saveSetting(def.key)}
                    className="w-full sm:w-40 h-8 px-3 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-[11px] focus:outline-none focus:border-[#3B82F6]"
                  />
                )}

                {def.type === 'select' && def.options && (
                  <select
                    value={value}
                    onChange={e => {
                      setValues(prev => ({ ...prev, [def.key]: e.target.value }));
                      setTimeout(() => saveSetting(def.key), 0);
                    }}
                    className="h-8 px-3 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-[11px] focus:outline-none focus:border-[#3B82F6]"
                  >
                    {def.options.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                )}

                {def.type === 'textarea' && (
                  <textarea
                    value={value}
                    onChange={e => setValues(prev => ({ ...prev, [def.key]: e.target.value }))}
                    onBlur={() => saveSetting(def.key)}
                    rows={2}
                    className="w-full sm:w-48 px-3 py-2 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-[11px] focus:outline-none focus:border-[#3B82F6] resize-none"
                  />
                )}

                {def.type !== 'toggle' && def.type !== 'select' && (
                  <button
                    onClick={() => saveSetting(def.key)}
                    disabled={isSaving}
                    className="h-7 px-3 rounded-lg bg-[#3B82F6] text-white text-[10px] font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-30 flex-shrink-0"
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
  );
}
