import { useEffect, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { getServiceCategories, getServiceSubcategories, updateProfile, uploadAvatar } from '@/lib/supabase';
import LocationSelector from '@/legacy/LocationSelector';
import type { Profile, ServiceCategory, ServiceSubcategory } from '@/types';

type Props = { profile: Profile; onComplete: () => void };

export default function WorkerSetupProfessional({ profile, onComplete }: Props) {
  const photoRef = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [subs, setSubs] = useState<ServiceSubcategory[]>([]);
  const [category, setCategory] = useState('');
  const [specialty, setSpecialty] = useState(((profile.worker_skills as string[]) || [])[0] || '');
  const [name, setName] = useState(profile.full_name || '');
  const [experience, setExperience] = useState(profile.worker_experience || '');
  const [bio, setBio] = useState(profile.worker_bio || '');
  const [price, setPrice] = useState(profile.worker_price ? String(profile.worker_price) : '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [avatar, setAvatar] = useState(profile.avatar_url || '');
  const [location, setLocation] = useState({ country: profile.country || 'Nigeria', state: profile.state || '', city: profile.local_government || profile.city || '', area: profile.area || '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const { categories: rows } = await getServiceCategories();
      setCategories(rows || []);
      const match = (rows || []).find((item) => item.name === profile.worker_occupation);
      if (match) setCategory(match.id);
    })();
  }, [profile.worker_occupation]);

  useEffect(() => {
    if (!category) return void setSubs([]);
    void getServiceSubcategories(category).then(({ subcategories }) => setSubs(subcategories || []));
  }, [category]);

  async function photo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const { url, error } = await uploadAvatar(file, profile.user_id);
    setBusy(false);
    if (error || !url) return toast.error(error?.message || 'Photo upload failed');
    setAvatar(url);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const service = categories.find((item) => item.id === category);
    if (!name.trim()) return toast.error('Full name is required');
    if (!service || !specialty) return toast.error('Choose your service and specialty');
    if (!location.state || !location.city) return toast.error('Choose your State and LGA');
    if (!experience.trim()) return toast.error('Describe your professional experience');

    setBusy(true);
    const { error } = await updateProfile(profile.user_id, {
      full_name: name.trim(), avatar_url: avatar || null, phone: phone.trim() || null,
      worker_occupation: service.name, worker_skills: [specialty], worker_price: price ? Number(price) : null,
      worker_bio: bio.trim() || null, worker_experience: experience.trim(), country: location.country,
      state: location.state, city: location.city, local_government: location.city, area: location.area || null,
      profile_complete: true,
    });
    setBusy(false);
    if (error) return toast.error(error.message);

    if (!profile.profile_complete) {
      localStorage.setItem('wh_navpage', 'worker_dashboard');
      window.location.reload();
      return;
    }
    toast.success('Professional profile updated');
    onComplete();
  }

  return (
    <div className="min-h-[100dvh] bg-[#090B11] text-white">
      <Toaster position="top-center" richColors />
      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6">
        <div>
          <p className="text-[9px] font-bold tracking-[.18em] text-cyan-400">PROFESSIONAL PROFILE</p>
          <h1 className="mt-2 text-2xl font-bold">{profile.profile_complete ? 'Edit your service profile' : 'Set up your local service profile'}</h1>
          <p className="mt-2 text-[11px] leading-relaxed text-[#747A8B]">This is the professional profile customers will rely on. Payment confirmation, the WeHouse readiness check, work evidence and internal professional review happen afterward in Verification.</p>
        </div>

        <section className="rounded-2xl border border-white/[.07] bg-[#11151D] p-4">
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => photoRef.current?.click()} className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-cyan-500 text-xl font-bold">{avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : (name || 'W')[0]}</button>
            <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={photo} />
            <div className="flex-1"><Field label="Full name" value={name} set={setName} /></div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Phone" value={phone} set={setPhone} /><Field label="Starting price" value={price} set={(value) => setPrice(value.replace(/[^0-9]/g, ''))} /></div>
        </section>

        <section className="rounded-2xl border border-white/[.07] bg-[#11151D] p-4">
          <div className="grid gap-3 sm:grid-cols-2"><Select label="Service category" value={category} set={(value) => { setCategory(value); setSpecialty(''); }} options={categories.map((item) => [item.id, item.name])} /><Select label="Specialty" value={specialty} set={setSpecialty} options={subs.map((item) => [item.name, item.name])} /></div>
          <label className="mt-3 block"><span className="mb-1 block text-[9px] uppercase text-[#666D7E]">Professional experience</span><textarea value={experience} onChange={(event) => setExperience(event.target.value)} rows={3} placeholder="Example: 4 years installing and repairing household electrical systems" className="w-full rounded-xl border border-white/[.08] bg-[#171B24] p-3 text-xs outline-none" /></label>
          <textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={5} placeholder="Describe the work you handle and what customers can expect" className="mt-3 w-full rounded-xl border border-white/[.08] bg-[#171B24] p-3 text-xs outline-none" />
        </section>

        <section className="rounded-2xl border border-white/[.07] bg-[#11151D] p-4"><h2 className="text-sm font-semibold">Service coverage</h2><p className="mt-1 text-[10px] leading-relaxed text-[#747A8B]">Your State and LGA decide where customers can discover you. The server saves this as your Worker service coverage.</p><div className="mt-3"><LocationSelector value={location} onChange={setLocation} /></div></section>

        {profile.worker_status === 'verified' && <p className="rounded-xl border border-amber-500/15 bg-amber-500/[.05] p-3 text-[10px] text-amber-200">Major professional changes to a live Worker may require a new review before they are reflected publicly.</p>}
        <button onClick={save as any} disabled={busy} className="h-12 w-full rounded-xl bg-cyan-500 text-sm font-semibold text-[#051018] disabled:opacity-40">{busy ? 'Saving…' : 'Save professional profile'}</button>
      </main>
    </div>
  );
}

function Field({ label, value, set }: { label: string; value: string; set: (value: string) => void }) { return <label className="block"><span className="mb-1 block text-[9px] uppercase text-[#666D7E]">{label}</span><input value={value} onChange={(event) => set(event.target.value)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs outline-none" /></label>; }
function Select({ label, value, set, options }: { label: string; value: string; set: (value: string) => void; options: string[][] }) { return <label className="block"><span className="mb-1 block text-[9px] uppercase text-[#666D7E]">{label}</span><select value={value} onChange={(event) => set(event.target.value)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs"><option value="">Choose</option>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>; }
