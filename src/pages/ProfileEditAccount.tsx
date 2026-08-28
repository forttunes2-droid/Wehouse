import { useEffect, useMemo, useRef, useState } from 'react';
import { checkUsernameAvailable, removeAvatar, updateProfile, uploadAvatar, validateUsername } from '@/lib/supabase';
import { getRegisteredInstitutions, type RegisteredInstitution } from '@/lib/supabase/institutions';
import SearchableSelect from '@/components/SearchableSelect';
import AccountShell from '@/components/AccountShell';
import { NIGERIA_STATES } from '@/data/nigeria-locations';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

type Props = { profile: Profile; onUpdate: (profile: Profile) => void; onBack: () => void };

export default function ProfileEdit({ profile, onUpdate, onBack }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatar, setAvatar] = useState(profile.avatar_url || '');
  const [username, setUsername] = useState(profile.username || '');
  const [usernameState, setUsernameState] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [fullName, setFullName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [bio, setBio] = useState(profile.bio || '');
  const [gender, setGender] = useState(profile.gender || '');
  const [isStudent, setIsStudent] = useState(Boolean(profile.is_student));
  const [school, setSchool] = useState(profile.school || '');
  const [state, setState] = useState(profile.state || '');
  const [lga, setLga] = useState(profile.local_government || profile.city || '');
  const [area, setArea] = useState(profile.area || '');
  const [institutions, setInstitutions] = useState<RegisteredInstitution[]>([]);
  const [institutionsLoading, setInstitutionsLoading] = useState(false);
  const [institutionsError, setInstitutionsError] = useState<string | null>(null);
  const isUser = profile.role === 'user';
  const states = useMemo(() => NIGERIA_STATES.map((item) => ({ value: item.state, label: item.state })), []);
  const lgas = useMemo(() => (NIGERIA_STATES.find((item) => item.state === state)?.cities || []).map((name) => ({ value: name, label: name })), [state]);
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
    if (isUser) {
      Object.assign(current, { bio: bio.trim(), gender, is_student: isStudent, school: isStudent ? school.trim() : '', state, lga, area: area.trim() });
      Object.assign(original, { bio: (profile.bio || '').trim(), gender: profile.gender || '', is_student: Boolean(profile.is_student), school: profile.is_student ? (profile.school || '').trim() : '', state: profile.state || '', lga: profile.local_government || profile.city || '', area: (profile.area || '').trim() });
    }
    return JSON.stringify(current) !== JSON.stringify(original);
  }, [fullName, username, phone, bio, gender, isStudent, school, state, lga, area, isUser, profile]);

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
    if (!isUser || !isStudent || !state) { setInstitutions([]); setInstitutionsError(null); return; }
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
  }, [isUser, isStudent, state]);

  async function changePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return toast.error('Choose a JPG, PNG or WebP image');
    if (file.size > 35 * 1024 * 1024) return toast.error('Image must be under 35MB');
    setUploading(true);
    const { url, error } = await uploadAvatar(file, profile.user_id);
    setUploading(false);
    if (error || !url) return toast.error(error?.message || 'Photo upload failed');
    const { profile: updated, error: updateError } = await updateProfile(profile.user_id, { avatar_url: url });
    if (updateError || !updated) return toast.error(updateError?.message || 'Could not save photo');
    setAvatar(url);
    onUpdate(updated);
    toast.success('Profile photo updated');
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
    if (isUser && !gender) return toast.error('Gender is required for roommate matching');
    if (isUser && (!state || !lga)) return toast.error('State and Local Government are required');
    setSaving(true);
    const updates: any = { full_name: fullName.trim() || null, username: username.trim().toLowerCase(), phone: phone.trim() || null };
    if (isUser) {
      updates.bio = bio.trim() || null;
      updates.gender = gender;
      updates.is_student = isStudent;
      updates.school = isStudent ? (school.trim() || null) : null;
      updates.state = state;
      updates.local_government = lga;
      updates.city = lga;
      updates.area = area.trim() || null;
      updates.profile_complete = true;
    }
    const { profile: updated, error } = await updateProfile(profile.user_id, updates);
    setSaving(false);
    if (error || !updated) return toast.error(error?.message || 'Could not save profile');
    onUpdate(updated);
    toast.success('Personal details updated');
    setEditing(false);
  }

  if (!editing) return (
    <AccountShell profile={profile} title="Personal details" description="Your WeHouse profile and location." onBack={onBack}>
      <section className="overflow-hidden rounded-3xl border border-white/[.06] bg-[#11141C]">
        <div className="flex items-center gap-4 p-5">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-2xl font-bold text-violet-300">{avatar ? <img src={avatar} alt="Profile" className="h-full w-full object-cover" /> : (username || 'U')[0].toUpperCase()}</div>
          <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-bold">{fullName || username || 'WeHouse member'}</h2><p className="mt-1 truncate text-[10px] text-[#737A8B]">@{username || 'username'}</p>{bio && <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-[#A1A6B3]">{bio}</p>}</div>
        </div>
        <div className="grid grid-cols-2 border-y border-white/[.06] sm:grid-cols-3"><ProfileFact label="Phone" value={phone || 'Not added'} /><ProfileFact label="Role" value={profile.role === 'worker' ? 'WeHouse Service Worker' : profile.role} /><ProfileFact label="Gender" value={gender || 'Not added'} /></div>
        {isUser && <div className="grid grid-cols-2 border-b border-white/[.06] sm:grid-cols-3"><ProfileFact label="Location" value={[lga,state].filter(Boolean).join(', ') || 'Not added'} /><ProfileFact label="Area" value={area || 'Not added'} /><ProfileFact label="Institution" value={isStudent ? (school || 'Not added') : 'Not a student'} /></div>}
        <div className="p-4"><button type="button" onClick={()=>setEditing(true)} className="h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold">Edit profile</button></div>
      </section>
    </AccountShell>
  );

  return (
    <AccountShell profile={profile} title="Personal details" description={isUser ? 'Your personal profile and location used by WeHouse.' : 'Private personal details for this account.'} onBack={onBack}>
      <Toaster position="top-center" richColors />
      <form onSubmit={save} className="space-y-4">
        <button type="button" onClick={()=>setEditing(false)} className="text-[10px] font-semibold text-violet-300">Cancel editing</button>
        <section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4 sm:p-5">
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => fileRef.current?.click()} className="grid h-[72px] w-[72px] shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/[.06] bg-violet-500/15 text-xl font-bold text-violet-300">{avatar ? <img src={avatar} alt="Profile" className="h-full w-full object-cover" /> : (username || 'U')[0].toUpperCase()}</button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={changePhoto} className="hidden" />
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold">Profile photo</p><p aria-live="polite" className="mt-1 text-[10px] text-[#6F7585]">{uploading ? 'Uploading photo securely…' : 'JPG, PNG or WebP'}</p>{uploading&&<div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full w-2/5 animate-pulse rounded-full bg-violet-400"/></div>}<div className="mt-3 flex gap-2"><button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="rounded-xl border border-white/[.08] bg-white/[.02] px-3 py-2 text-[10px] font-semibold disabled:opacity-40">{avatar ? 'Change' : 'Add photo'}</button>{avatar && <button type="button" disabled={uploading} onClick={() => void deletePhoto()} className="rounded-xl border border-red-500/15 px-3 py-2 text-[10px] font-semibold text-red-300 disabled:opacity-40">Remove</button>}</div></div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" value={fullName} onChange={setFullName} />
            <div><Field label="Username" value={username} onChange={setUsername} /><p className={`mt-1 text-[9px] ${usernameState === 'available' ? 'text-emerald-300' : usernameState === 'taken' || usernameState === 'invalid' ? 'text-red-300' : 'text-[#62697A]'}`}>{usernameState === 'checking' ? 'Checking…' : usernameState === 'available' ? 'Username available' : usernameState === 'taken' ? 'Username already taken' : usernameState === 'invalid' ? 'Use 3–20 letters, numbers or underscores' : ''}</p></div>
            <Field label="Phone" value={phone} onChange={setPhone} />
          </div>
          {!isUser && <div className="mt-4 rounded-xl border border-violet-500/15 bg-violet-500/[.04] p-3 text-[10px] text-[#8C92A1]">Role and operational details stay inside your role workspace.</div>}
        </section>

        {isUser && <>
          <section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4 sm:p-5">
            <h2 className="text-sm font-semibold">About you</h2>
            <div className="mt-4 space-y-4">
              <label className="block"><span className="mb-1 block text-[10px] text-[#777E8E]">Bio</span><textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={3} className="w-full resize-none rounded-xl border border-white/[.08] bg-[#181A23] p-3 text-xs outline-none focus:border-violet-500/40" /></label>
              <div><p className="mb-2 text-[10px] text-[#777E8E]">Gender</p><div className="flex gap-2">{[['male', 'Male'], ['female', 'Female']].map(([id, label]) => <button type="button" key={id} onClick={() => setGender(id)} className={`rounded-xl px-4 py-2 text-[10px] font-semibold ${gender === id ? 'bg-violet-500' : 'border border-white/[.08] text-[#A0A5B3]'}`}>{label}</button>)}</div></div>
              <label className="flex items-center justify-between gap-4 rounded-xl border border-white/[.06] bg-black/10 p-3"><div><p className="text-xs font-medium">Student</p><p className="mt-1 text-[9px] text-[#62697A]">Choose your registered University, Polytechnic or College.</p></div><button type="button" onClick={() => setIsStudent((value) => !value)} className={`relative h-6 w-11 rounded-full ${isStudent ? 'bg-violet-500' : 'bg-[#2A2D38]'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${isStudent ? 'translate-x-5' : ''}`} /></button></label>
              {isStudent && <div><SearchableSelect label="Institution" value={school} onChange={setSchool} options={institutionOptions} placeholder={!state ? 'Choose State first' : institutionsLoading ? 'Loading institutions…' : 'Choose institution'} searchPlaceholder="Search University, Polytechnic or College" disabled={!state || institutionsLoading} emptyText="No registered institution found in this State yet" />{institutionsError && <p className="mt-1.5 text-[9px] text-red-300">Could not load registered institutions.</p>}{!institutionsError && state && !institutionsLoading && <p className="mt-1.5 text-[9px] text-[#62697A]">Schools in {lga ? `${lga} appear first, followed by the rest of ${state}.` : state}. Search also recognizes common abbreviations.</p>}</div>}
            </div>
          </section>

          <section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4 sm:p-5">
            <h2 className="text-sm font-semibold">Location</h2>
            <p className="mt-1 text-[10px] text-[#6F7585]">Used for nearby homes, services and roommate matching.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <SearchableSelect label="State" value={state} onChange={(next) => { setState(next); setLga(''); setSchool(''); }} options={states} placeholder="Choose State" searchPlaceholder="Search State, e.g. Nasarawa" />
              <SearchableSelect label="Local Government" value={lga} onChange={setLga} options={lgas} placeholder={state ? 'Choose LGA' : 'Choose State first'} searchPlaceholder="Search Local Government" disabled={!state} />
              <div className="sm:col-span-2"><Field label="Area / neighbourhood (optional)" value={area} onChange={setArea} /></div>
            </div>
          </section>
        </>}

        {hasChanges && <button type="submit" disabled={saving || usernameState === 'checking'} className="w-full rounded-xl bg-violet-500 px-4 py-3 text-xs font-semibold text-white transition disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>}
      </form>
    </AccountShell>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block"><span className="mb-1 block text-[10px] text-[#777E8E]">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#181A23] px-3 text-xs outline-none focus:border-violet-500/40" /></label>; }
function ProfileFact({label,value}:{label:string;value:string}){return <div className="min-w-0 border-r border-white/[.05] p-4 last:border-r-0"><p className="text-[8px] uppercase tracking-wide text-[#62697A]">{label}</p><p className="mt-1 truncate text-[10px] font-semibold capitalize text-[#A8ADBA]">{value}</p></div>}
