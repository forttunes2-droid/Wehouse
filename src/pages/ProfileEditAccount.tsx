import { useEffect, useMemo, useRef, useState } from 'react';
import { checkUsernameAvailable, removeAvatar, updateProfile, uploadAvatar, validateUsername } from '@/lib/supabase';
import SearchableSelect from '@/components/SearchableSelect';
import AccountShell from '@/components/AccountShell';
import { NIGERIA_STATES } from '@/data/nigeria-locations';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

type Props = { profile: Profile; onUpdate: (profile: Profile) => void; onBack: () => void };

export default function ProfileEdit({ profile, onUpdate, onBack }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
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
  const isUser = profile.role === 'user';
  const states = useMemo(() => NIGERIA_STATES.map((item) => ({ value: item.state, label: item.state })), []);
  const lgas = useMemo(() => (NIGERIA_STATES.find((item) => item.state === state)?.cities || []).map((name) => ({ value: name, label: name })), [state]);

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
  }

  return (
    <AccountShell profile={profile} title="Personal details" description={isUser ? 'Your personal profile and location used by WeHouse.' : 'Private personal details for this account.'} onBack={onBack}>
      <Toaster position="top-center" richColors />
      <form onSubmit={save} className="space-y-4">
        <section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4 sm:p-5">
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => fileRef.current?.click()} className="grid h-[72px] w-[72px] shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/[.06] bg-violet-500/15 text-xl font-bold text-violet-300">{avatar ? <img src={avatar} alt="Profile" className="h-full w-full object-cover" /> : (username || 'U')[0].toUpperCase()}</button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={changePhoto} className="hidden" />
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold">Profile photo</p><p className="mt-1 text-[10px] text-[#6F7585]">{uploading ? 'Uploading…' : 'JPG, PNG or WebP'}</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => fileRef.current?.click()} className="rounded-xl border border-white/[.08] bg-white/[.02] px-3 py-2 text-[10px] font-semibold">{avatar ? 'Change' : 'Add photo'}</button>{avatar && <button type="button" onClick={() => void deletePhoto()} className="rounded-xl border border-red-500/15 px-3 py-2 text-[10px] font-semibold text-red-300">Remove</button>}</div></div>
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
              <label className="flex items-center justify-between gap-4 rounded-xl border border-white/[.06] bg-black/10 p-3"><div><p className="text-xs font-medium">Student</p><p className="mt-1 text-[9px] text-[#62697A]">Add your institution for roommate matching.</p></div><button type="button" onClick={() => setIsStudent((value) => !value)} className={`relative h-6 w-11 rounded-full ${isStudent ? 'bg-violet-500' : 'bg-[#2A2D38]'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${isStudent ? 'translate-x-5' : ''}`} /></button></label>
              {isStudent && <Field label="Institution" value={school} onChange={setSchool} />}
            </div>
          </section>

          <section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4 sm:p-5">
            <h2 className="text-sm font-semibold">Location</h2>
            <p className="mt-1 text-[10px] text-[#6F7585]">Used for nearby homes, services and roommate matching.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <SearchableSelect label="State" value={state} onChange={(next) => { setState(next); setLga(''); }} options={states} placeholder="Choose State" searchPlaceholder="Search State, e.g. Nasarawa" />
              <SearchableSelect label="Local Government" value={lga} onChange={setLga} options={lgas} placeholder={state ? 'Choose LGA' : 'Choose State first'} searchPlaceholder="Search Local Government" disabled={!state} />
              <div className="sm:col-span-2"><Field label="Area / neighbourhood (optional)" value={area} onChange={setArea} /></div>
            </div>
          </section>
        </>}

        <button type="submit" disabled={saving || usernameState === 'checking'} className="w-full rounded-xl bg-violet-500 px-4 py-3 text-xs font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Save personal details'}</button>
      </form>
    </AccountShell>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block"><span className="mb-1 block text-[10px] text-[#777E8E]">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#181A23] px-3 text-xs outline-none focus:border-violet-500/40" /></label>; }
