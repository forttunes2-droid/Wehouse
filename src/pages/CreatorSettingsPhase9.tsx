import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { invalidateSettingsCache } from '@/hooks/usePlatformSettings';
import type { Profile } from '@/types';

type Kind = 'text' | 'email' | 'url' | 'number' | 'toggle' | 'textarea';
type Def = { key: string; label: string; description: string; kind: Kind; defaultValue: string; min?: number; max?: number; step?: number };
type DbSetting = { key: string; value: string; is_active: boolean };
type Group = { id: string; label: string; description: string; note?: string; settings: Def[] };

const GROUPS: Group[] = [
  { id: 'identity', label: 'WeHouse identity', description: 'Public company and contact information used by WeHouse.', settings: [
    { key: 'company_name', label: 'Company name', description: 'Public company name.', kind: 'text', defaultValue: 'WeHouse Nigeria' },
    { key: 'company_website', label: 'Website', description: 'Canonical public WeHouse website.', kind: 'url', defaultValue: 'https://wehouse.com.ng' },
    { key: 'support_email', label: 'Support email', description: 'Primary public support email.', kind: 'email', defaultValue: '' },
    { key: 'support_phone', label: 'Support phone', description: 'Primary public support phone number.', kind: 'text', defaultValue: '' },
  ]},
  { id: 'worker_verification', label: 'Worker verification', description: 'Global Worker identity and onboarding policy.', note: 'The identity re-check is the existing private WeHouse selfie + face match + head-turn liveness/anti-spoof check. It does not use government ID. Re-checking never repeats payment, readiness testing or professional review.', settings: [
    { key: 'worker_verification_fee', label: 'Onboarding verification fee (₦)', description: 'One-time Paystack fee during initial Worker onboarding.', kind: 'number', defaultValue: '1300', min: 0, max: 10000000, step: 1 },
    { key: 'worker_identity_recheck_days', label: 'Identity re-check interval (days)', description: 'How often a live Worker must confirm they are still the person using the account.', kind: 'number', defaultValue: '14', min: 1, max: 90, step: 1 },
  ]},
  { id: 'communications', label: 'Messages & support', description: 'Rules used by live WeHouse communication flows.', settings: [
    { key: 'message_edit_window_minutes', label: 'Message edit window (minutes)', description: 'Time a sender may edit their own private text message after sending.', kind: 'number', defaultValue: '10', min: 1, max: 60, step: 1 },
    { key: 'support_hours', label: 'Support hours', description: 'Operating hours shown for WeHouse Support.', kind: 'text', defaultValue: 'Mon-Fri 9AM-6PM WAT' },
    { key: 'support_response_time_hours', label: 'Support response target (hours)', description: 'Target response time for Support cases.', kind: 'number', defaultValue: '24', min: 1, max: 720, step: 1 },
  ]},
  { id: 'worker_trust', label: 'WeHouse Trusted', description: 'Earned trust based on real WeHouse marketplace performance.', note: 'WeHouse Reviewed is professional approval. WeHouse Trusted is earned later from completed jobs, rating, cancellations and dispute history.', settings: [
    { key: 'worker_trust_enabled', label: 'Enable WeHouse Trusted', description: 'Allow automatic earned trust when the reputation rules are satisfied.', kind: 'toggle', defaultValue: 'false' },
    { key: 'worker_trusted_min_completed_jobs', label: 'Minimum completed jobs', description: 'Completed WeHouse Worker jobs required.', kind: 'number', defaultValue: '5', min: 0, max: 10000, step: 1 },
    { key: 'worker_trusted_min_rating', label: 'Minimum rating', description: 'Minimum marketplace rating.', kind: 'number', defaultValue: '4.5', min: 0, max: 5, step: 0.1 },
    { key: 'worker_trusted_max_cancel_rate', label: 'Maximum Worker cancellation rate (%)', description: 'Maximum Worker-caused cancellation rate while retaining Trusted.', kind: 'number', defaultValue: '20', min: 0, max: 100, step: 1 },
    { key: 'worker_trusted_block_open_disputes', label: 'Block Trusted with unresolved disputes', description: 'Require no unresolved Worker-booking disputes.', kind: 'toggle', defaultValue: 'true' },
  ]},
  { id: 'access', label: 'Platform access', description: 'High-level operating switches for the live platform.', settings: [
    { key: 'maintenance_mode', label: 'Maintenance mode', description: 'Temporarily restrict normal platform access while WeHouse is being serviced.', kind: 'toggle', defaultValue: 'false' },
    { key: 'registration_open', label: 'Registration open', description: 'Allow new accounts to register.', kind: 'toggle', defaultValue: 'true' },
  ]},
  { id: 'legal', label: 'Legal documents', description: 'Current Privacy Policy and Terms shown to users.', settings: [
    { key: 'privacy_policy', label: 'Privacy Policy', description: 'Published WeHouse Privacy Policy.', kind: 'textarea', defaultValue: '' },
    { key: 'terms_of_service', label: 'Terms & Conditions', description: 'Published WeHouse Terms & Conditions.', kind: 'textarea', defaultValue: '' },
  ]},
];

export default function CreatorSettingsPhase9({ profile }: { profile?: Profile }) {
  const defs = useMemo(() => GROUPS.flatMap((group) => group.settings), []);
  const keys = useMemo(() => defs.map((def) => def.key), [defs]);
  const [rows, setRows] = useState<DbSetting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [assistantConnected, setAssistantConnected] = useState(false);
  const [assistantKey, setAssistantKey] = useState('');
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantTesting, setAssistantTesting] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [settingsResult, secretResult] = await Promise.all([
        supabase.from('platform_settings').select('key,value,is_active').in('key', keys),
        supabase.rpc('get_secret_v2', { p_key: 'openai_api_key' }),
      ]);
      if (!active) return;
      if (settingsResult.error) toast.error(settingsResult.error.message);
      else setRows((settingsResult.data || []) as DbSetting[]);
      if (!secretResult.error) setAssistantConnected(Boolean(Array.isArray(secretResult.data) && secretResult.data[0]?.value));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [keys]);

  function stored(def: Def) { return rows.find((row) => row.key === def.key && row.is_active !== false)?.value ?? def.defaultValue; }
  function current(def: Def) { return drafts[def.key] !== undefined ? drafts[def.key] : stored(def); }
  function normalize(def: Def, raw: string) {
    if (def.kind !== 'number') return raw.trim();
    const cleaned = raw.trim().replace(/,/g, '');
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
    const value = Number(cleaned);
    if (!Number.isFinite(value) || (def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max) || ((def.step ?? 1) >= 1 && !Number.isInteger(value))) return null;
    return String(value);
  }

  async function save(def: Def, raw: string) {
    const value = normalize(def, raw);
    if (value === null) { toast.error(`${def.label} has an invalid value`); return false; }
    setSaving((state) => ({ ...state, [def.key]: true }));
    const result = await supabase.rpc('update_platform_setting', { p_key: def.key, p_value: value });
    if (result.error || result.data !== true) {
      setSaving((state) => ({ ...state, [def.key]: false }));
      toast.error(result.error?.message || `${def.label} could not be saved`);
      return false;
    }
    const { data: verified, error: verifyError } = await supabase.from('platform_settings').select('key,value,is_active').eq('key', def.key).maybeSingle();
    setSaving((state) => ({ ...state, [def.key]: false }));
    if (verifyError || !verified || String(verified.value) !== String(value)) { toast.error(`${def.label} could not be verified after saving`); return false; }
    setRows((state) => [...state.filter((row) => row.key !== def.key), verified as DbSetting]);
    setDrafts((state) => { const next = { ...state }; delete next[def.key]; return next; });
    invalidateSettingsCache();
    toast.success(def.kind === 'textarea' ? `${def.label} published` : `${def.label} saved`);
    return true;
  }
  async function saveAll() { for (const def of defs.filter((item) => drafts[item.key] !== undefined)) await save(def, drafts[def.key]); }

  async function saveAssistant() {
    const key = assistantKey.trim();
    if (!key || !key.startsWith('sk-')) return toast.error('Enter a valid OpenAI API key');
    setAssistantBusy(true);
    const { data, error } = await supabase.rpc('set_secret_v2', { p_key: 'openai_api_key', p_value: key });
    setAssistantBusy(false);
    if (error || data !== true) return toast.error(error?.message || 'Could not save Assistant connection');
    setAssistantKey(''); setAssistantConnected(true); toast.success('WeHouse Assistant connection saved');
  }
  async function testAssistant() {
    if (!profile) return;
    setAssistantTesting(true);
    const { data, error } = await supabase.functions.invoke('wehouse-assistant', { body: { message: 'Confirm WeHouse Assistant is connected. Reply briefly.', messages: [] } });
    setAssistantTesting(false);
    if (error || !data?.message) return toast.error(data?.message || 'Assistant connection test failed');
    toast.success('WeHouse Assistant is connected');
  }

  if (loading) return <Loading />;
  const changed = Object.keys(drafts).length;
  return <section className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[8px] font-bold uppercase tracking-[.18em] text-violet-400">GLOBAL CONTROL</p><h2 className="mt-1 text-lg font-bold">Platform settings</h2><p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[#686C7E]">Creator-only live policy and global configuration. Each save goes through the server-side Creator permission check and is recorded in the audit log.</p></div>{changed > 0 && <button onClick={() => void saveAll()} disabled={Object.values(saving).some(Boolean)} className="min-h-11 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-40">Save changes ({changed})</button>}</div>

    <section className="rounded-2xl border border-blue-500/15 bg-blue-500/[.035] p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">WeHouse Assistant</h3><Status good={assistantConnected}>{assistantConnected ? 'CONNECTED' : 'NOT CONNECTED'}</Status></div><p className="mt-1 text-[10px] text-[#687082]">Private server-side Assistant connection. The secret key is never stored in normal platform settings.</p></div>{assistantConnected && <button onClick={() => void testAssistant()} disabled={assistantTesting} className="h-10 rounded-xl border border-blue-500/20 px-4 text-[10px] font-semibold text-blue-300 disabled:opacity-40">{assistantTesting ? 'Testing…' : 'Test connection'}</button>}</div><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input type="password" autoComplete="off" value={assistantKey} onChange={(event) => setAssistantKey(event.target.value)} placeholder={assistantConnected ? 'Paste a new key only to replace the current one' : 'sk-…'} className="h-11 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none focus:border-blue-500/40" /><button onClick={() => void saveAssistant()} disabled={assistantBusy || !assistantKey.trim()} className="h-11 rounded-xl bg-blue-500 px-4 text-[10px] font-semibold disabled:opacity-40">{assistantBusy ? 'Saving…' : assistantConnected ? 'Replace key' : 'Connect Assistant'}</button></div></section>

    <div className="grid gap-4 xl:grid-cols-2">{GROUPS.map((group) => <section key={group.id} className={`${group.id === 'legal' ? 'xl:col-span-2' : ''} rounded-2xl border border-white/[.06] bg-[#10131B] p-4 sm:p-5`}><div className="mb-4"><h3 className="text-sm font-semibold">{group.label}</h3><p className="mt-1 text-[10px] leading-relaxed text-[#666A7C]">{group.description}</p>{group.note && <p className="mt-3 rounded-xl border border-violet-500/10 bg-violet-500/[.035] p-3 text-[9px] leading-relaxed text-violet-100/70">{group.note}</p>}</div><div className="space-y-3">{group.settings.map((def) => <Setting key={def.key} def={def} value={current(def)} dirty={drafts[def.key] !== undefined} busy={saving[def.key]} setValue={(value) => setDrafts((state) => ({ ...state, [def.key]: value }))} save={() => void save(def, current(def))} />)}</div></section>)}</div>
  </section>;
}

function Setting({ def, value, dirty, busy, setValue, save }: { def: Def; value: string; dirty: boolean; busy?: boolean; setValue: (value: string) => void; save: () => void }) {
  if (def.kind === 'toggle') {
    const enabled = ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
    return <div className="rounded-xl border border-white/[.05] bg-[#0D1017] p-3"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold">{def.label}</p><p className="mt-1 text-[9px] leading-relaxed text-[#666A7C]">{def.description}</p></div><button onClick={() => setValue(enabled ? 'false' : 'true')} className={`relative mt-1 h-6 w-11 shrink-0 rounded-full ${enabled ? 'bg-violet-500' : 'bg-white/[.1]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${enabled ? 'left-6' : 'left-1'}`} /></button></div>{dirty && <button onClick={save} disabled={busy} className="mt-3 h-9 rounded-xl bg-violet-500 px-3 text-[9px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>}</div>;
  }
  if (def.kind === 'textarea') return <div className="rounded-xl border border-white/[.05] bg-[#0D1017] p-3"><p className="text-xs font-semibold">{def.label}</p><p className="mt-1 text-[9px] text-[#666A7C]">{def.description}</p><textarea rows={9} value={value} onChange={(event) => setValue(event.target.value)} className="mt-3 w-full resize-y rounded-xl border border-white/[.08] bg-[#171A23] p-3 text-xs leading-5 outline-none focus:border-violet-500/40" />{dirty && <button onClick={save} disabled={busy} className="mt-2 h-10 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-40">{busy ? 'Publishing…' : `Publish ${def.label}`}</button>}</div>;
  return <label className="block rounded-xl border border-white/[.05] bg-[#0D1017] p-3"><span className="text-xs font-semibold">{def.label}</span><span className="mt-1 block text-[9px] leading-relaxed text-[#666A7C]">{def.description}</span><div className="mt-3 flex gap-2"><input type={def.kind === 'number' ? 'number' : def.kind === 'email' ? 'email' : def.kind === 'url' ? 'url' : 'text'} min={def.min} max={def.max} step={def.step} value={value} onChange={(event) => setValue(event.target.value)} className="h-11 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs outline-none focus:border-violet-500/40" />{dirty && <button type="button" onClick={save} disabled={busy} className="h-11 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>}</div></label>;
}
function Status({ good, children }: { good: boolean; children: React.ReactNode }) { return <span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${good ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{children}</span>; }
function Loading() { return <div className="grid min-h-40 place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>; }
