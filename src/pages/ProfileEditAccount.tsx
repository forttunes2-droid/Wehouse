import { useEffect, useMemo, useState } from 'react';
import { checkUsernameAvailable, getProfileCountryOptions, removeAvatar, updateProfile, validateUsername } from '@/lib/supabase';
import type {ProfileCountryOption} from '@/lib/supabase/profile';
import { getRegisteredInstitutions, type RegisteredInstitution } from '@/lib/supabase/institutions';
import SearchableSelect from '@/components/SearchableSelect';
import AccountShell from '@/components/AccountShell';
import { locationCountryCode, regionDataset } from '@/data/locations';
import { getRegionalDefaults } from '@/lib/regional';
import { toast } from 'sonner';
import type { Profile } from '@/types';
import ProfilePhotoEditor from '@/components/ProfilePhotoEditor';
import PreciseLocationPicker, { type PreciseLocation } from '@/components/PreciseLocationPicker';

type Props = { profile: Profile; onUpdate: (profile: Profile) => void; onBack: () => void };
function withTimeout<T>(promise: Promise<T>, milliseconds = 20000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Saving timed out. Check your connection and try again.')), milliseconds);
    promise.then((value) => { window.clearTimeout(timer); resolve(value); }, (error) => { window.clearTimeout(timer); reject(error); });
  });
}

export default function ProfileEdit({ profile, onUpdate, onBack }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatar, setAvatar] = useState(profile.avatar_url || '');
  const [username, setUsername] = useState(profile.username || '');
  const [usernameState, setUsernameState] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [fullName, setFullName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [bio, setBio] = useState(profile.bio || '');
  const [gender, setGender] = useState(profile.gender || '');
  const [isStudent, setIsStudent] = useState(Boolean(profile.is_student));
  const [school, setSchool] = useState(profile.school || '');
  const [country,setCountry]=useState(profile.country||'');
  const [countries,setCountries]=useState<ProfileCountryOption[]>([]);
  const [countriesLoading,setCountriesLoading]=useState(false),[countriesError,setCountriesError]=useState(''),[countryLoadAttempt,setCountryLoadAttempt]=useState(0);
  const [state, setState] = useState(profile.state || '');
  const [lga, setLga] = useState(profile.local_government || profile.city || '');
  const [locationNotice, setLocationNotice] = useState('');
  const [preciseLocation,setPreciseLocation]=useState<PreciseLocation|null>(()=>profile.precise_address||profile.precise_latitude!=null&&profile.precise_longitude!=null?{latitude:profile.precise_latitude==null?null:Number(profile.precise_latitude),longitude:profile.precise_longitude==null?null:Number(profile.precise_longitude),accuracy:profile.precise_location_accuracy_m==null?null:Number(profile.precise_location_accuracy_m),address:profile.precise_address||''}:null);
  const [institutions, setInstitutions] = useState<RegisteredInstitution[]>([]);
  const [institutionsLoading, setInstitutionsLoading] = useState(false);
  const [institutionsError, setInstitutionsError] = useState<string | null>(null);
  const isUser = profile.role === 'user';
  const regional = getRegionalDefaults();
  const savedCountry=countries.find(item=>item.country_code===country.toUpperCase()||item.name.toLowerCase()===country.toLowerCase());
  const countryCode = country.trim() ? savedCountry?.country_code||locationCountryCode(country,regional) : null;
  const countryOptions=countries.map(item=>({value:item.country_code,label:item.name}));
  if(country&&!countryOptions.some(item=>item.value===(countryCode||country)))countryOptions.unshift({value:countryCode||country,label:country});
  const regionRows = regionDataset(countryCode);
  const states = useMemo(() => (regionRows || []).map((item) => ({ value: item.state, label: item.state })), [regionRows]);
  const lgas = useMemo(() => (regionRows?.find((item) => item.state === state)?.cities || []).map((name) => ({ value: name, label: name })), [regionRows, state]);
  const institutionOptions = useMemo(() => {
    const typeLabel: Record<RegisteredInstitution['institution_type'], string> = { university: 'University', polytechnic: 'Polytechnic', college: 'College' };
    const ordered = [...institutions].sort((a, b) => {
      const aLocal = Boolean(lga && a.local_government === lga);
      const bLocal = Boolean(lga && b.local_government === lga);
      if (aLocal !== bLocal) return aLocal ? -1 : 1;
      return a.canonical_name.localeCompare(b.canonical_name);
    });
    const options = ordered.map((item) => ({
      value: item.canonical_name,
      label: item.canonical_name,
      meta: `${typeLabel[item.institution_type]} · ${item.local_government || item.state}`,
      keywords: `${item.aliases.join(' ')} ${item.regulator} ${item.local_government || ''}`,
    }));
    if (school && !options.some((option) => option.value === school)) {
      options.unshift({ value: school, label: school, meta: 'Current value', keywords: school });
    }
    return options;
  }, [institutions, lga, school]);
  const hasChanges = useMemo(() => {
    const current: Record<string, unknown> = {
      full_name: fullName.trim(), username: username.trim().toLowerCase(), phone: phone.trim(),
    };
    const original: Record<string, unknown> = {
      full_name: (profile.full_name || '').trim(), username: (profile.username || '').trim().toLowerCase(), phone: (profile.phone || '').trim(),
    };
    Object.assign(current,{country,state,lga,preciseLocation});Object.assign(original,{country:profile.country||'',state:profile.state||'',lga:profile.local_government||profile.city||'',preciseLocation:profile.precise_address||profile.precise_latitude!=null&&profile.precise_longitude!=null?{latitude:profile.precise_latitude==null?null:Number(profile.precise_latitude),longitude:profile.precise_longitude==null?null:Number(profile.precise_longitude),accuracy:profile.precise_location_accuracy_m==null?null:Number(profile.precise_location_accuracy_m),address:profile.precise_address||''}:null});
    if (isUser) {
      Object.assign(current, { bio: bio.trim(), gender, is_student: isStudent, school: isStudent ? school.trim() : '', state, lga });
      Object.assign(original, { bio: (profile.bio || '').trim(), gender: profile.gender || '', is_student: Boolean(profile.is_student), school: profile.is_student ? (profile.school || '').trim() : '', state: profile.state || '', lga: profile.local_government || profile.city || '' });
    }
    return JSON.stringify(current) !== JSON.stringify(original);
  }, [fullName, username, phone, bio, gender, isStudent, school,country, state, lga, preciseLocation, isUser, profile]);

  useEffect(()=>{
    if(!editing)return;
    let active=true;setCountriesLoading(true);setCountriesError('');
    void getProfileCountryOptions().then(result=>{if(active){setCountries(result.countries);setCountriesError(result.error?.message||'');}})
      .catch(cause=>{if(active)setCountriesError((cause as {message?:string})?.message||'Countries could not be loaded. Try again.');})
      .finally(()=>{if(active)setCountriesLoading(false);});
    return()=>{active=false;};
  },[editing,countryLoadAttempt]);

  useEffect(() => {
    const value = username.trim().toLowerCase();
    if (!value || value === (profile.username || '').toLowerCase()) { setUsernameState('idle'); return; }
    const valid = validateUsername(value);
    if (!valid.valid) { setUsernameState('invalid'); return; }
    setUsernameState('checking');
    const timer = window.setTimeout(async () => {
      const { available } = await checkUsernameAvailable(value, profile.user_id);
      setUsernameState(available ? 'available' : 'taken');
    }, 350);
    return () => window.clearTimeout(timer);
  }, [username, profile.username, profile.user_id]);

  useEffect(() => {
    if (!isUser || !isStudent || !state || countryCode!=='NG') { setInstitutions([]); setInstitutionsError(null); return; }
    let cancelled = false;
    setInstitutionsLoading(true);
    setInstitutionsError(null);
    void getRegisteredInstitutions(state).then(({ institutions: rows, error }) => {
      if (cancelled) return;
      setInstitutions(rows);
      setInstitutionsError(error?.message || null);
      setInstitutionsLoading(false);
    });
    return () => { cancelled = true; };
  }, [isUser, isStudent, state,countryCode]);

  async function savePhoto(url:string) {
    const { profile: updated, error: updateError } = await updateProfile(profile.user_id, { avatar_url: url });
    if (updateError || !updated) throw new Error(updateError?.message || 'Could not save photo');
    setAvatar(url);
    onUpdate(updated);
  }

  async function deletePhoto() {
    const { error } = await removeAvatar(profile.user_id);
    if (error) return toast.error(error.message);
    const { profile: updated } = await updateProfile(profile.user_id, { avatar_url: null });
    setAvatar('');
    if (updated) onUpdate(updated);
    toast.success('Profile photo removed');
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!hasChanges) return;
    if (usernameState === 'taken' || usernameState === 'invalid') return toast.error('Fix the username before saving');
    setSaving(true);
    const updates: any = { full_name: fullName.trim() || null, username: username.trim().toLowerCase(), phone: phone.trim() || null };
    if(country!==(profile.country||''))updates.country=country||null;
    updates.state=state;updates.local_government=lga;updates.city=lga;updates.precise_latitude=preciseLocation?.latitude??null;updates.precise_longitude=preciseLocation?.longitude??null;updates.precise_address=preciseLocation?.address.trim()||null;updates.precise_location_accuracy_m=preciseLocation?.accuracy??null;
    if (isUser) {
      updates.bio = bio.trim() || null;
      updates.gender = gender || null;
      updates.is_student = isStudent;
      updates.school = isStudent ? (school.trim() || null) : null;
      updates.state = state.trim() || null;
      updates.local_government = lga.trim() || null;
      updates.city = lga.trim() || null;
      updates.profile_complete = true;
    }
    try {
      const { profile: updated, error } = await withTimeout(updateProfile(profile.user_id, updates));
      if (error || !updated) return toast.error(error?.message || 'Could not save profile');
      onUpdate(updated);
      toast.success('Personal details updated');
      setEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save profile');
    } finally {
      setSaving(false);
    }
  }

  function resolveLocation(next: PreciseLocation | null) {
    setPreciseLocation(next);
    if (!next?.state) { setLocationNotice(''); return; }
    const clean = (value:string) => value.toLowerCase().replace(/\b(state|local government area|lga|municipality)\b/g, '').replace(/[^a-z]/g, '');
    const detectedState = regionRows?.find((item) => clean(item.state) === clean(next.state || ''));
    if (!detectedState) {
      setLocationNotice('Street address found. Check that the selected region and local area match this address.');
      return;
    }
    const detectedLga = detectedState.cities.find((item) => clean(item) === clean(next.city || '')) || '';
    if (state !== detectedState.state || (detectedLga && lga !== detectedLga)) {
      setLocationNotice(`The phone suggested ${[detectedLga, detectedState.state].filter(Boolean).join(', ')}. It can be approximate, so your selected region and local area were not changed.`);
    } else setLocationNotice('Location found. Check the street address before saving.');
  }

  function changeCountry(next:string){
    if(next===(countryCode||country))return;
    const confirming=!country.trim();
    const preserved=confirming&&regionDataset(next)?.some(item=>item.state===state&&(!lga||item.cities.includes(lga)));
    setCountry(countries.find(item=>item.country_code===next)?.name||next);
    if(!preserved){setState('');setLga('');setSchool('');setPreciseLocation(null);}
    setLocationNotice(preserved?'Country confirmed. Check your existing region and local area before saving.':'Choose the region and local area for this country.');
  }

  if (!editing) return (
    <AccountShell profile={profile} title="Personal profile" description="Your identity, contact details and private location settings." onBack={onBack}>
      <section className="overflow-hidden rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)]">
        <div className="flex items-center gap-4 p-5">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-2xl font-bold text-violet-300">{avatar ? <img src={avatar} alt="Profile" className="h-full w-full object-cover" /> : (username || 'U')[0].toUpperCase()}</div>
          <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-bold">{fullName || username || 'WeHouse member'}</h2><p className="mt-1 truncate text-[10px] text-[var(--wh-text-muted)]">@{username || 'username'}</p>{bio && <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-[var(--wh-text-secondary)]">{bio}</p>}</div>
        </div>
        <div className="grid grid-cols-2 border-y border-[var(--wh-border-subtle)] sm:grid-cols-3"><ProfileFact label="Phone · private" value={phone || 'Not added'} /><ProfileFact label="Account" value={profile.role === 'worker' ? 'WeHouse professional' : profile.role === 'user' ? 'WeHouse member' : profile.role.replaceAll('_', ' ')} /><ProfileFact label="Gender" value={gender || 'Not added'} /></div>
        <div className="grid grid-cols-2 border-b border-[var(--wh-border-subtle)] sm:grid-cols-3"><ProfileFact label="Region" value={[lga,state].filter(Boolean).join(', ') || 'Not added'} /><ProfileFact label="Street address" value={preciseLocation?.address?.trim() || 'Not added'} />{isUser && <ProfileFact label="Institution" value={isStudent ? (school || 'Not added') : 'Not a student'} />}</div>
        <div className="p-4"><button type="button" onClick={()=>setEditing(true)} className="h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold">Edit profile</button></div>
      </section>
    </AccountShell>
  );

  return (
    <AccountShell profile={profile} title="Edit profile" description={isUser ? 'Your photo, name and personal details.' : 'Update the private details for this account.'} onBack={onBack}>

      <form onSubmit={save} className="relative space-y-4" aria-busy={saving}>
        <fieldset disabled={saving} className="contents">
        <button type="button" onClick={()=>setEditing(false)} className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--wh-border-subtle)] px-4 text-[10px] font-semibold text-[var(--wh-text-secondary)]"><span aria-hidden="true">←</span> Profile summary</button>
        <section className="rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5">
          <ProfilePhotoEditor avatar={avatar} name={fullName||username} onUploaded={savePhoto} onRemove={async()=>{await deletePhoto();}}/>
        </section>

        <section className="rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" value={fullName} onChange={setFullName} />
            <div><Field label="Username" value={username} onChange={setUsername} /><p className={`mt-1 text-[9px] ${usernameState === 'available' ? 'text-emerald-300' : usernameState === 'taken' || usernameState === 'invalid' ? 'text-red-300' : 'text-[var(--wh-text-muted)]'}`}>{usernameState === 'checking' ? 'Checking…' : usernameState === 'available' ? 'Username available' : usernameState === 'taken' ? 'Username already taken' : usernameState === 'invalid' ? 'Use 3–20 letters, numbers or underscores' : ''}</p></div>
            <Field label="Phone" value={phone} onChange={setPhone} />
          </div>
          {!isUser && <div className="mt-4 rounded-xl border border-violet-500/15 bg-violet-500/[.04] p-3 text-[10px] text-[var(--wh-text-secondary)]">Role and operational details stay inside your role workspace.</div>}
        </section>

        {isUser && <>
          <section className="rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5">
            <h2 className="text-sm font-semibold">About you</h2>
            <div className="mt-4 space-y-4">
              <label className="block"><span className="mb-1 block text-[10px] text-[var(--wh-text-muted)]">Bio</span><textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={3} className="w-full resize-none rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-3 text-xs outline-none focus:border-violet-500/40" /></label>
              <div><p className="mb-2 text-[10px] text-[var(--wh-text-muted)]">Gender</p><div className="flex gap-2">{[['male', 'Male'], ['female', 'Female']].map(([id, label]) => <button type="button" key={id} onClick={() => setGender(id)} className={`rounded-xl px-4 py-2 text-[10px] font-semibold ${gender === id ? 'bg-violet-500' : 'border border-[var(--wh-border-subtle)] text-[var(--wh-text-secondary)]'}`}>{label}</button>)}</div></div>
              <label className="flex items-center justify-between gap-4 rounded-xl border border-[var(--wh-border-subtle)] bg-black/10 p-3"><div><p className="text-xs font-medium">Student</p><p className="mt-1 text-[9px] text-[var(--wh-text-muted)]">Choose your registered University, Polytechnic or College.</p></div><button type="button" onClick={() => setIsStudent((value) => !value)} className={`relative h-6 w-11 rounded-full ${isStudent ? 'bg-violet-500' : 'bg-[var(--wh-border)]'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${isStudent ? 'translate-x-5' : ''}`} /></button></label>
              {isStudent && (countryCode==='NG' ? <div><SearchableSelect label="Institution" value={school} onChange={setSchool} options={institutionOptions} placeholder={!state ? 'Choose State first' : institutionsLoading ? 'Loading institutions…' : 'Choose institution'} searchPlaceholder="Search University, Polytechnic or College" disabled={!state || institutionsLoading} emptyText="No registered institution found in this State yet" />{institutionsError && <p className="mt-1.5 text-[9px] text-red-300">Could not load registered institutions.</p>}{!institutionsError && state && !institutionsLoading && <p className="mt-1.5 text-[9px] text-[var(--wh-text-muted)]">Schools in {lga ? `${lga} appear first, followed by the rest of ${state}.` : state}. Search also recognizes common abbreviations.</p>}</div> : <Field label="Institution" value={school} onChange={setSchool}/>)}
            </div>
          </section>

          </>}
          <section className="rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5">
            <h2 className="text-sm font-semibold">Location</h2>
            <p className="mt-3 text-sm text-[var(--wh-text)]">Country · {savedCountry?.name||country||'Not set'}</p>
            <div className="mt-3"><SearchableSelect label="Country" value={countryCode||country} onChange={changeCountry} options={countryOptions} placeholder={countriesLoading?'Loading countries…':'Choose country'} searchPlaceholder="Search countries" disabled={countriesLoading||Boolean(countriesError)} emptyText="No available country matches"/></div>
            {countriesError&&<div role="alert" className="mt-2 text-sm text-[var(--wh-text-secondary)]"><p>{countriesError}</p><button type="button" onClick={()=>setCountryLoadAttempt(value=>value+1)} className="min-h-11 font-semibold text-[var(--wh-accent-text)]">Retry countries</button></div>}
            <p className="mt-1 text-[10px] text-[var(--wh-text-muted)]">Choose your state or region and city or area, then add your street address.</p>
            {!country ? <p className="mt-3 text-sm text-[var(--wh-text-secondary)]">Choose your country to edit this location. Your existing region and local area are kept until you confirm.</p> : regionRows ? <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <SearchableSelect label="State / region" value={state} onChange={(next) => { setState(next); setLga(''); setSchool(''); setPreciseLocation(null); setLocationNotice(preciseLocation?'Street address cleared because the region changed. Type the correct address for the new region.':''); }} options={states} placeholder="Choose state or region" searchPlaceholder="Search state or region" />
              <SearchableSelect label="City / area" value={lga} onChange={(next)=>{setLga(next);setPreciseLocation(null);setLocationNotice(preciseLocation?'Street address cleared because the area changed. Type the correct address for the new area.':'')}} options={lgas} placeholder={state ? 'Choose city or area' : 'Choose state or region first'} searchPlaceholder="Search city or area" disabled={!state} />
            </div> : <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="State / region" value={state} onChange={next=>{setState(next);setLga('');setPreciseLocation(null);setLocationNotice('');}} />
              <Field label="City / area" value={lga} onChange={next=>{setLga(next);setPreciseLocation(null);setLocationNotice('');}} />
            </div>}
            {country&&<div className="mt-4"><PreciseLocationPicker value={preciseLocation} onChange={resolveLocation}/>{locationNotice&&<p className="mt-2 rounded-xl bg-violet-500/[.07] px-3 py-2 text-xs leading-5 text-[var(--wh-accent-text)]" role="status">{locationNotice}</p>}</div>}
          </section>

        {hasChanges && <button type="submit" disabled={saving || usernameState === 'checking'} className="w-full rounded-xl bg-violet-500 px-4 py-3 text-xs font-semibold text-white transition disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>}
        </fieldset>
        {saving && <div className="absolute inset-0 z-20 grid place-items-end bg-[var(--wh-bg)]/55 p-4 backdrop-blur-[2px]" role="status"><p className="sticky bottom-4 w-full rounded-2xl border border-violet-500/20 bg-[var(--wh-elevated)] p-4 text-center text-xs font-semibold">Saving changes…</p></div>}
      </form>
    </AccountShell>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block"><span className="mb-1 block text-[10px] text-[var(--wh-text-muted)]">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-xs outline-none focus:border-violet-500/40" /></label>; }
function ProfileFact({label,value}:{label:string;value:string}){return <div className="min-w-0 border-r border-[var(--wh-border-subtle)] p-4 last:border-r-0"><p className="text-[8px] uppercase tracking-wide text-[var(--wh-text-muted)]">{label}</p><p className="mt-1 truncate text-[10px] font-semibold capitalize text-[var(--wh-text-secondary)]">{value}</p></div>}
