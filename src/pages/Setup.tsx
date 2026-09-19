import { useEffect, useMemo, useState } from 'react';
import { updateProfile, isUsernameTaken, supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import SearchableSelect from '@/components/SearchableSelect';
import { NIGERIA_STATES } from '@/data/nigeria-locations';
import type { Profile } from '@/types';
import { acceptReviewedLegalDocument, getCurrentLegalDocuments, type CurrentLegalDocuments } from '@/lib/supabase/legal';
import { hasLegalConsent, legalDocumentKey, type LegalChoices } from '@/lib/legalConsent';
import LegalReview from '@/components/LegalReview';

interface Props { profile: Profile; onSetupComplete: (profile: Profile) => void }

export default function Setup({ profile, onSetupComplete }: Props) {
  const [username, setUsername] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [documents, setDocuments] = useState<CurrentLegalDocuments>({ privacy: null, terms: null });
  const [choices, setChoices] = useState<LegalChoices>({});
  const [legalLoading, setLegalLoading] = useState(true);
  const [legalError, setLegalError] = useState(false);

  const role = profile.role;
  const content = ({
    user: { title: 'Complete your profile', subtitle: 'A few details and you are ready', info: 'Your location helps WeHouse show relevant homes, roommates and services.' },
    worker: { title: 'Worker account setup', subtitle: 'Set up your account first', info: 'Your personal location is separate from your professional service coverage.' },
    property_partner: { title: 'Property Partner setup', subtitle: 'Set up your account', info: 'Complete your account before managing properties.' },
    staff: { title: 'Team account setup', subtitle: 'Complete your account', info: 'Your personal location is separate from your work assignment.' },
    admin: { title: 'Admin account setup', subtitle: 'Complete your account', info: 'Your personal location is separate from your branch assignment.' },
    creator: { title: 'Creator account setup', subtitle: 'Complete your account', info: 'Complete your account profile to continue.' },
  } as any)[role] || { title: 'Complete your profile', subtitle: 'A few details and you are ready', info: 'Your location helps WeHouse show relevant results.' };

  const stateOptions = useMemo(() => NIGERIA_STATES.map((item) => ({ value: item.state, label: item.state })), []);
  const cityOptions = useMemo(() => (NIGERIA_STATES.find((item) => item.state === state)?.cities || []).map((name) => ({ value: name, label: name })), [state]);
  const legalReady = !legalLoading && !legalError && hasLegalConsent(documents, choices);

  useEffect(() => {
    let active = true;
    void Promise.all([getCurrentLegalDocuments(), supabase.auth.getUser()]).then(([result, identity]) => {
      if (!active) return;
      setDocuments(result.documents);
      setLegalError(Boolean(result.error || identity.error));
      // A user's own declaration of reading is not a role/authorization claim.
      const prior = identity.data.user?.user_metadata?.legal_review || {};
      if (hasLegalConsent(result.documents, prior)) setChoices(prior);
      setLegalLoading(false);
    }).catch(() => { if (active) { setLegalError(true); setLegalLoading(false); } });
    return () => { active = false; };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const trimmed = username.trim().toLowerCase();
    if (trimmed.length < 3) return setError('Username must be at least 3 characters');
    if (!/^[a-z0-9_]+$/.test(trimmed)) return setError('Only letters, numbers, and underscores');
    if (!state) return setError('Choose your current State');
    if (!city) return setError('Choose your Local Government');
    if (!dateOfBirth) return setError('Enter your date of birth');
    if (dateOfBirth > adultCutoff()) return setError('You must be 18 or older to use WeHouse');
    if (!legalReady) return setError('Read and accept each published WeHouse legal document to continue');

    setWorking(true);
    try {
      const taken = await isUsernameTaken(trimmed);
      if (taken) {
        setError('Username taken. Try another.');
        setWorking(false);
        return;
      }
      for (const kind of ['privacy', 'terms'] as const) {
        const document = documents[kind];
        if (!document) throw new Error('Legal documents are unavailable');
        const result = await acceptReviewedLegalDocument(kind, document);
        if (result.error) {
          const refreshed = await getCurrentLegalDocuments();
          setDocuments(refreshed.documents); setChoices({}); setLegalError(Boolean(refreshed.error));
          setError('Your confirmation could not be saved. Review the current documents and try again.'); setWorking(false); return;
        }
      }
      const ageResult = await supabase.rpc('set_my_date_of_birth', { p_date_of_birth: dateOfBirth });
      if (ageResult.error) { setError(ageResult.error.message); setWorking(false); return; }
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

          <FieldLabel label="Date of birth">
            <Input type="date" value={dateOfBirth} max={adultCutoff()} onChange={(event) => setDateOfBirth(event.target.value)} className="h-11 rounded-xl border-[#2A2A3A] bg-[#1A1A24] text-sm text-white" />
            <span className="mt-1.5 block text-[9px] leading-4 text-[#6F7484]">WeHouse is for people aged 18 or older. Your date of birth is private and is used only to confirm eligibility.</span>
          </FieldLabel>

          <div className="rounded-2xl border border-white/[.06] bg-[#11131B] p-4 text-[10px] leading-relaxed text-[#7D8291]">{content.info}</div>

          {legalLoading ? <p role="status" className="text-sm text-[#AAA3B3]">Loading documents…</p>
            : legalError ? <p role="alert" className="text-sm text-red-200">The documents could not be loaded. Please sign out and try again.</p>
            : !documents.privacy || !documents.terms ? <p className="text-sm leading-6 text-[#AAA3B3]">Account setup will open when the Privacy Policy and Terms of Service are published.</p>
            : <LegalReview key={legalDocumentKey(documents)} documents={documents} choices={choices} onChange={setChoices} />}

          <button type="submit" disabled={working || !legalReady} className="h-12 w-full rounded-xl bg-violet-500 text-sm font-semibold text-white disabled:opacity-40">{working ? 'Saving…' : 'Continue'}</button>
          <button type="button" onClick={() => void supabase.auth.signOut({ scope: 'local' })} className="min-h-11 w-full text-sm font-semibold text-violet-300">Sign out</button>
        </form>
      </div>


    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-medium text-[#8A8B9C]">{label} *</span>{children}</label>; }
function adultCutoff() { const date = new Date(); date.setFullYear(date.getFullYear() - 18); return date.toISOString().slice(0, 10); }
