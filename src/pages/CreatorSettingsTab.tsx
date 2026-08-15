import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { invalidateSettingsCache } from '@/hooks/usePlatformSettings';
import type { Profile } from '@/types';
import { toast } from 'sonner';

type Type = 'text' | 'toggle' | 'textarea' | 'email' | 'number';
type Def = {
  key: string;
  label: string;
  description: string;
  type: Type;
  defaultValue: string;
};
type Db = { key: string; value: string; is_active: boolean };

const GROUPS: Array<{ id: string; label: string; description: string; settings: Def[] }> = [
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
    id: 'worker_verification',
    label: 'Worker verification',
    description: 'Creator-owned rules for the Worker professional verification journey.',
    settings: [
      {
        key: 'worker_verification_fee',
        label: 'Worker verification fee (₦)',
        description: 'Amount charged through Paystack for the Gold Tick. New verification payments read this value from the database. Set 0 to disable verification payments until a new fee is configured.',
        type: 'number',
        defaultValue: '0',
      },
    ],
  },
  {
    id: 'access',
    label: 'Platform access',
    description: 'High-level switches that affect access to WeHouse.',
    settings: [
      { key: 'maintenance_mode', label: 'Maintenance mode', description: 'Temporarily block normal platform access while maintenance is active.', type: 'toggle', defaultValue: 'false' },
      { key: 'registration_open', label: 'Registration open', description: 'Allow new accounts to register.', type: 'toggle', defaultValue: 'true' },
    ],
  },
  {
    id: 'legal',
    label: 'Legal documents',
    description: 'Published Privacy Policy and Terms & Conditions. Users can read and accept the current versions.',
    settings: [
      { key: 'privacy_policy', label: 'Privacy Policy', description: 'The public Privacy Policy shown in WeHouse.', type: 'textarea', defaultValue: '' },
      { key: 'terms_of_service', label: 'Terms & Conditions', description: 'The public Terms & Conditions shown in WeHouse.', type: 'textarea', defaultValue: '' },
    ],
  },
];

export default function CreatorSettingsTab({ profile }: { profile?: Profile }) {
  const [settings, setSettings] = useState<Db[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiKey, setAiKey] = useState('');
  const [aiSaving, setAiSaving] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);

  const defs = useMemo(() => GROUPS.flatMap((group) => group.settings), []);
  const keys = useMemo(() => defs.map((def) => def.key), [defs]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const [{ data, error }, { data: secret, error: secretError }] = await Promise.all([
        supabase.from('platform_settings').select('key,value,is_active').in('key', keys),
        supabase.rpc('get_secret_v2', { p_key: 'openai_api_key' }),
      ]);
      if (cancelled) return;
      if (error) toast.error(`Could not load platform settings: ${error.message}`);
      else setSettings((data || []) as Db[]);
      if (secretError) toast.error('Could not read Assistant connection status');
      else setAiConfigured(Boolean(Array.isArray(secret) && secret[0]?.value));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [keys]);

  const stored = (def: Def) => settings.find((setting) => setting.key === def.key && setting.is_active !== false)?.value ?? def.defaultValue;
  const current = (def: Def) => drafts[def.key] !== undefined ? drafts[def.key] : stored(def);
  const setDraft = (key: string, value: string) => setDrafts((state) => ({ ...state, [key]: value }));

  function normalize(def: Def, raw: string) {
    if (def.type !== 'number') return raw;
    const cleaned = raw.trim().replace(/,/g, '');
    if (!/^\d+$/.test(cleaned)) return null;
    const value = Number(cleaned);
    if (!Number.isSafeInteger(value) || value < 0 || value > 10000000) return null;
    return String(value);
  }

  async function save(def: Def, rawValue: string) {
    const value = normalize(def, rawValue);
    if (value === null) {
      toast.error(`${def.label} must be a whole number from 0 to 10,000,000`);
      return false;
    }

    setSaving((state) => ({ ...state, [def.key]: true }));
    const { data: existing, error: readError } = await supabase.from('platform_settings').select('key').eq('key', def.key).maybeSingle();
    if (readError) {
      setSaving((state) => ({ ...state, [def.key]: false }));
      toast.error(`Could not read ${def.label}: ${readError.message}`);
      return false;
    }

    const payload = {
      value,
      label: def.label,
      description: def.description,
      data_type: def.type === 'toggle' ? 'boolean' : def.type === 'number' ? 'number' : 'text',
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const result = existing
      ? await supabase.from('platform_settings').update(payload).eq('key', def.key)
      : await supabase.from('platform_settings').insert({ key: def.key, ...payload, category: def.key === 'worker_verification_fee' ? 'worker' : 'platform' });

    if (result.error) {
      setSaving((state) => ({ ...state, [def.key]: false }));
      toast.error(`Could not save ${def.label}: ${result.error.message}`);
      return false;
    }

    const { data: verify, error: verifyError } = await supabase.from('platform_settings').select('key,value,is_active').eq('key', def.key).maybeSingle();
    if (verifyError || !verify || String(verify.value) !== String(value)) {
      setSaving((state) => ({ ...state, [def.key]: false }));
      toast.error(`${def.label} could not be verified after saving`);
      return false;
    }

    setSettings((state) => [...state.filter((setting) => setting.key !== def.key), verify as Db]);
    setDrafts((state) => {
      const next = { ...state };
      delete next[def.key];
      return next;
    });
    invalidateSettingsCache();
    setSaving((state) => ({ ...state, [def.key]: false }));
    if (def.key === 'privacy_policy' || def.key === 'terms_of_service') toast.success(`${def.label} published`);
    else toast.success(`${def.label} saved`);
    return true;
  }

  async function saveAll() {
    const changed = defs.filter((def) => drafts[def.key] !== undefined);
    let count = 0;
    for (const def of changed) if (await save(def, drafts[def.key])) count += 1;
    if (count > 1) toast.success(`${count} settings saved`);
  }

  async function saveAssistantKey() {
    const key = aiKey.trim();
    if (!key) return toast.error('Paste the OpenAI API key first');
    if (!key.startsWith('sk-')) return toast.error('That does not look like an OpenAI API key');
    setAiSaving(true);
    const { data, error } = await supabase.rpc('set_secret_v2', { p_key: 'openai_api_key', p_value: key });
    setAiSaving(false);
    if (error || data !== true) return toast.error(error?.message || 'Could not save Assistant connection');
    setAiKey('');
    setAiConfigured(true);
    toast.success('WeHouse Assistant connection saved securely');
  }

  async function testAssistant() {
    if (!profile) return;
    setAiTesting(true);
    const { data, error } = await supabase.functions.invoke('wehouse-assistant', {
      body: { message: 'Confirm that WeHouse Assistant is connected. Keep the answer under 12 words.', messages: [] },
    });
    setAiTesting(false);
    if (error || !data?.message) return toast.error(data?.message || 'Assistant connection test failed');
    toast.success('WeHouse Assistant is connected');
  }

  if (loading) {
    return <div className="grid min-h-40 place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>;
  }

  const changed = Object.keys(drafts).length;

  return (
    <section className="min-w-0 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-white">Platform settings</h2>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[#686C7E]">Identity, Worker verification, access, Assistant connection and published legal documents.</p>
        </div>
        {changed > 0 && (
          <button onClick={() => void saveAll()} disabled={Object.values(saving).some(Boolean)} className="min-h-10 w-full rounded-xl bg-violet-500 px-4 text-[10px] font-semibold text-white disabled:opacity-40 sm:w-auto">
            {Object.values(saving).some(Boolean) ? 'Saving…' : `Save changes (${changed})`}
          </button>
        )}
      </div>

      <section className="overflow-hidden rounded-3xl border border-blue-500/15 bg-gradient-to-br from-blue-500/[.09] via-[#10131B] to-[#0D1017]">
        <div className="flex flex-col gap-4 border-b border-white/[.05] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">WeHouse Assistant</h3>
              <span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${aiConfigured ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{aiConfigured ? 'CONNECTED' : 'NOT CONNECTED'}</span>
            </div>
            <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-[#6D7284]">Connect the AI that powers product guidance. Human Support remains a separate real-person conversation.</p>
          </div>
          {aiConfigured && <button onClick={() => void testAssistant()} disabled={aiTesting} className="h-10 rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 text-[10px] font-semibold text-blue-300 disabled:opacity-40">{aiTesting ? 'Testing…' : 'Test connection'}</button>}
        </div>
        <div className="p-4 sm:p-5">
          <label className="block">
            <span className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[.12em] text-[#6A7082]">{aiConfigured ? 'Replace API key' : 'OpenAI API key'}</span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input type="password" autoComplete="off" value={aiKey} onChange={(event) => setAiKey(event.target.value)} placeholder={aiConfigured ? 'Paste a new key only if you want to replace the current one' : 'sk-…'} className="h-11 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none focus:border-blue-500/40" />
              <button onClick={() => void saveAssistantKey()} disabled={aiSaving || !aiKey.trim()} className="h-11 shrink-0 rounded-xl bg-blue-500 px-4 text-[10px] font-semibold disabled:opacity-40">{aiSaving ? 'Saving…' : aiConfigured ? 'Replace key' : 'Connect Assistant'}</button>
            </div>
          </label>
          <p className="mt-2 text-[9px] leading-relaxed text-[#5F6476]">The saved key is never shown again on this screen.</p>
        </div>
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {GROUPS.map((group) => (
          <section key={group.id} className={`${group.id === 'legal' ? 'xl:col-span-2' : ''} min-w-0 rounded-2xl border border-white/[.06] bg-[#10131B] p-4 sm:p-5`}>
            <div className="mb-4">
              <h3 className="text-sm font-semibold">{group.label}</h3>
              <p className="mt-1 text-[10px] leading-relaxed text-[#666A7C]">{group.description}</p>
            </div>
            {group.id === 'worker_verification' && (
              <div className="mb-4 rounded-xl border border-amber-500/15 bg-amber-500/[.04] p-3 text-[9px] leading-relaxed text-amber-100/70">This value is read by the server when a Worker starts a new Gold Tick payment. Changing it does not require a website redeploy.</div>
            )}
            {group.id === 'legal' && (
              <div className="mb-4 rounded-xl border border-violet-500/15 bg-violet-500/[.05] p-3 text-[10px] leading-relaxed text-violet-200/80">Publishing a changed legal document creates the current version users can read and accept.</div>
            )}
            <div className="space-y-4">
              {group.settings.map((def) => {
                const value = current(def);
                const busy = saving[def.key];
                const dirty = drafts[def.key] !== undefined;

                if (def.type === 'textarea') {
                  return (
                    <div key={def.key} className="min-w-0 rounded-2xl border border-white/[.05] bg-[#0D1017] p-3 sm:p-4">
                      <div className="mb-3"><p className="text-xs font-semibold">{def.label}</p><p className="mt-1 text-[10px] text-[#666A7C]">{def.description}</p></div>
                      <textarea rows={10} value={value} onChange={(event) => setDraft(def.key, event.target.value)} className="w-full min-w-0 resize-y rounded-xl border border-white/[.08] bg-[#171A23] px-3 py-3 text-xs leading-6 text-white outline-none focus:border-violet-500/40" />
                      <button onClick={() => void save(def, value)} disabled={busy || !dirty} className="mt-3 min-h-10 w-full rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-30 sm:w-auto">{busy ? 'Publishing…' : `Publish ${def.label}`}</button>
                    </div>
                  );
                }

                return (
                  <div key={def.key} className="grid min-w-0 gap-3 border-b border-white/[.05] pb-4 last:border-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(180px,280px)] sm:items-center">
                    <div className="min-w-0"><p className="text-[11px] font-medium">{def.label}</p><p className="mt-1 text-[10px] leading-relaxed text-[#666A7C]">{def.description}</p></div>
                    {def.type === 'toggle' ? (
                      <button disabled={busy} aria-pressed={value === 'true'} onClick={() => { const next = value === 'true' ? 'false' : 'true'; setDraft(def.key, next); void save(def, next); }} className={`relative h-6 w-11 rounded-full disabled:opacity-50 sm:justify-self-end ${value === 'true' ? 'bg-violet-500' : 'border border-white/[.08] bg-[#252936]'}`}>
                        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${value === 'true' ? 'translate-x-5' : ''}`} />
                      </button>
                    ) : (
                      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                        <div className={`flex h-10 min-w-0 flex-1 items-center rounded-xl border border-white/[.08] bg-[#171A23] px-3 focus-within:border-violet-500/40 ${def.type === 'number' ? 'gap-1' : ''}`}>
                          {def.type === 'number' && <span className="text-xs text-[#7A8090]">₦</span>}
                          <input
                            type={def.type === 'number' ? 'text' : def.type}
                            inputMode={def.type === 'number' ? 'numeric' : undefined}
                            value={value}
                            onChange={(event) => setDraft(def.key, def.type === 'number' ? event.target.value.replace(/[^0-9]/g, '') : event.target.value)}
                            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                          />
                        </div>
                        <button disabled={busy || !dirty} onClick={() => void save(def, value)} className="h-10 rounded-xl bg-violet-500 px-3 text-[10px] font-semibold disabled:opacity-30">{busy ? 'Saving…' : 'Save'}</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
