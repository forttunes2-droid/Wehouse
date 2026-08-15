import { useEffect, useMemo, useState } from 'react';
import { updateProfile, isUsernameTaken, supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import SearchableSelect from '@/components/SearchableSelect';
import { NIGERIA_STATES } from '@/data/nigeria-locations';
import type { Profile } from '@/types';

interface Props { profile: Profile; onSetupComplete: (profile: Profile) => void }
type LegalDoc = 'privacy' | 'terms' | null;

export default function Setup({ profile, onSetupComplete }: Props) {
  const [username, setUsername] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [privacy, setPrivacy] = useState('');
  const [terms, setTerms] = useState('');
  const [privacyOk, setPrivacyOk] = useState(false);
  const [termsOk, setTermsOk] = useState(false);
  const [openDoc, setOpenDoc] = useState<LegalDoc>(null);

  const role = profile.role;
  const content = ({
    user: { title: 'Complete your profile', subtitle: 'A few details and you are ready', info: 'Your location helps WeHouse show relevant homes, roommates and services.' },
    worker: { title: 'Worker account setup', subtitle: 'Set up your account first', info: 'Your personal location is separate from your professional service coverage.' },
    property_partner: { title: 'Property Partner setup', subtitle: 'Set up your account', info: 'Complete your account before managing properties.' },
    staff: { title: 'Staff account setup', subtitle: 'Complete your account', info: 'Your personal location is separate from your work assignment.' },
    admin: { title: 'Admin account setup', subtitle: 'Complete your account', info: 'Your personal location is separate from your branch assignment.' },
    creator: { title: 'Creator account setup', subtitle: 'Complete your account', info: 'Complete your account profile to continue.' },
  } as any)[role] || { title: 'Complete your profile', subtitle: 'A few details and you are ready', info: 'Your location helps WeHouse show relevant results.' };

  const stateOptions = useMemo(() => NIGERIA_STATES.map((item) => ({ value: item.state, label: item.state })), []);
  const cityOptions = useMemo(() => (NIGERIA_STATES.find((item) => item.state === state)?.cities || []).map((name) => ({ value: name, label: name })), [state]);
  const privacyPublished = Boolean(privacy.trim());
  const termsPublished = Boolean(terms.trim());
  const legalReady = (!privacyPublished || privacyOk) && (!termsPublished || termsOk);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('platform_settings').select('key,value').in('key', ['privacy_policy', 'terms_of_service']);
      for (const row of data || []) {
        if (row.key === 'privacy_policy') setPrivacy(row.value?.trim() || '');
        if (row.key === 'terms_of_service') setTerms(row.value?.trim() || '');
      }
    })();
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const trimmed = username.trim().toLowerCase();
    if (trimmed.length < 3) return setError('Username must be at least 3 characters');
    if (!/^[a-z0-9_]+$/.test(trimmed)) return setError('Only letters, numbers, and underscores');
    if (!state) return setError('Choose your current State');
    if (!city) return setError('Choose your Local Government');
    if (!legalReady) return setError('Read and accept each published WeHouse legal document to continue');

    setWorking(true);
    try {
      const taken = await isUsernameTaken(trimmed);
      if (taken) {
        setError('Username taken. Try another.');
        setWorking(false);
        return;
      }
      if (privacyPublished) {
        const result = await supabase.rpc('accept_current_legal', { p_document: 'privacy' });
        if (result.error) { setError(result.error.message); setWorking(false); return; }
      }
      if (termsPublished) {
        const result = await supabase.rpc('accept_current_legal', { p_document: 'terms' });
        if (result.error) { setError(result.error.message); setWorking(false); return; }
      }
      const { profile: updated, error: saveError } = await updateProfile(profile.user_id, {
        username: trimmed,
        state,
        city,
        local_government: city,
        profile_complete: true,
      });
      if (saveError || !updated) {
        setError(saveError?.message || 'Failed to save profile');
        setWorking(false);
        return;
      }
      onSetupComplete(updated);
    } catch {
      setError('Something went wrong. Please try again.');
      setWorking(false);
    }
  }

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[#09090D] px-4 py-8 text-white sm:px-5">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-[9px] font-semibold tracking-[.2em] text-violet-300">WELCOME TO WEHOUSE</p>
          <h1 className="mt-2 text-xl font-bold">{content.title}</h1>
          <p className="mt-1 text-xs text-[#6D7182]">{content.subtitle}</p>
        </div>

        {error && <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <FieldLabel label="Username">
            <Input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} className="h-11 rounded-xl border-[#2A2A3A] bg-[#1A1A24] text-sm text-white" placeholder="e.g. johnsmith" autoFocus />
          </FieldLabel>

          <SearchableSelect label="State *" value={state} onChange={(next) => { setState(next); setCity(''); }} options={stateOptions} placeholder="Choose State" searchPlaceholder="Search State, e.g. Nasarawa" />
          <SearchableSelect label="Local Government *" value={city} onChange={setCity} options={cityOptions} placeholder={state ? 'Choose LGA' : 'Choose State first'} searchPlaceholder="Search Local Government" disabled={!state} />

          <div className="rounded-2xl border border-white/[.06] bg-[#11131B] p-4 text-[10px] leading-relaxed text-[#7D8291]">{content.info}</div>

          {(privacyPublished || termsPublished) && (
            <section className="overflow-hidden rounded-2xl border border-white/[.07] bg-[#11131B]">
              <div className="border-b border-white/[.05] p-4">
                <p className="text-sm font-semibold">Legal consent</p>
                <p className="mt-1 text-[10px] text-[#6F7384]">Read the current WeHouse legal documents.</p>
              </div>
              {privacyPublished && <Consent checked={privacyOk} onChange={setPrivacyOk} title="Privacy Policy" onRead={() => setOpenDoc('privacy')} />}
              {termsPublished && <Consent checked={termsOk} onChange={setTermsOk} title="Terms & Conditions" onRead={() => setOpenDoc('terms')} />}
            </section>
          )}

          <button type="submit" disabled={working || !legalReady} className="h-12 w-full rounded-xl bg-violet-500 text-sm font-semibold text-white disabled:opacity-40">{working ? 'Saving…' : 'Continue'}</button>
        </form>
      </div>

      {openDoc && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 sm:items-center sm:p-5" onClick={() => setOpenDoc(null)}>
          <div onClick={(event) => event.stopPropagation()} className="max-h-[88dvh] w-full max-w-2xl overflow-hidden rounded-t-3xl border border-white/[.08] bg-[#10121A] sm:rounded-3xl">
            <header className="flex items-center justify-between border-b border-white/[.06] p-4">
              <div><p className="text-[9px] font-semibold tracking-[.18em] text-violet-300">WEHOUSE LEGAL</p><h2 className="mt-1 text-base font-semibold">{openDoc === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions'}</h2></div>
              <button type="button" onClick={() => setOpenDoc(null)} className="grid h-9 w-9 place-items-center rounded-xl border border-white/[.08]">×</button>
            </header>
            <article className="max-h-[68dvh] overflow-y-auto p-5 text-[12px] leading-7 text-[#A6A9B5] sm:p-6">{render(openDoc === 'privacy' ? privacy : terms)}</article>
            <div className="border-t border-white/[.06] p-4"><button type="button" onClick={() => { openDoc === 'privacy' ? setPrivacyOk(true) : setTermsOk(true); setOpenDoc(null); }} className="min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold">I have read this document</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-medium text-[#8A8B9C]">{label} *</span>{children}</label>; }
function Consent({ checked, onChange, title, onRead }: { checked: boolean; onChange: (value: boolean) => void; title: string; onRead: () => void }) { return <div className="flex items-center gap-3 border-b border-white/[.05] p-4 last:border-0"><button type="button" onClick={() => onChange(!checked)} className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg border text-xs ${checked ? 'border-violet-500 bg-violet-500' : 'border-white/[.15]'}`}>{checked ? '✓' : ''}</button><div className="min-w-0 flex-1"><p className="text-xs">I accept the {title}</p><button type="button" onClick={onRead} className="mt-1 text-[10px] font-semibold text-violet-300">Read {title}</button></div></div>; }
function render(text: string) { return text.split('\n').map((line, index) => { const trimmed = line.trim(); if (!trimmed) return <div key={index} className="h-3" />; if (trimmed.startsWith('**') && trimmed.endsWith('**')) return <h3 key={index} className="mt-5 text-sm font-semibold text-white first:mt-0">{trimmed.replace(/\*\*/g, '')}</h3>; return <p key={index}>{line}</p>; }); }
