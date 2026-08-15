import { useEffect, useMemo, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { getServiceCategories, getServiceSubcategories, updateProfile, uploadAvatar } from '@/lib/supabase';
import LocationSelector from '@/legacy/LocationSelector';
import SearchableSelect from '@/components/SearchableSelect';
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
    if (!category) { setSubs([]); return; }
    void getServiceSubcategories(category).then(({ subcategories }) => setSubs(subcategories || []));
  }, [category]);

  const categoryOptions = useMemo(() => categories.map((item) => ({ value: item.id, label: item.name })), [categories]);
  const specialtyOptions = useMemo(() => subs.map((item) => ({ value: item.name, label: item.name })), [subs]);

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
    if (!name.trim()) return toast.error('Add your full name');
    if (!service || !specialty) return toast.error('Choose your service and specialty');
    if (!experience.trim()) return toast.error('Add your work experience');
    if (!location.state || !location.city) return toast.error('Choose your State and LGA');

    setBusy(true);
    const { error } = await updateProfile(profile.user_id, {
      full_name: name.trim(),
      avatar_url: avatar || null,
      phone: phone.trim() || null,
      worker_occupation: service.name,
      worker_skills: [specialty],
      worker_price: price ? Number(price) : null,
      worker_bio: bio.trim() || null,
      worker_experience: experience.trim(),
      country: location.country,
      state: location.state,
      city: location.city,
      local_government: location.city,
      area: location.area || null,
      profile_complete: true,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Professional profile saved');

    try {
      if (sessionStorage.getItem('wh_worker_setup_return') === 'verification') {
        sessionStorage.removeItem('wh_worker_setup_return');
        localStorage.setItem('wh_navpage', 'worker_verification');
        window.history.replaceState({ page: 'worker_verification' }, '', '#worker_verification');
        window.location.reload();
        return;
      }
    } catch {}

    if (!profile.profile_complete) {
      try {
        localStorage.setItem('wh_navpage', 'worker_dashboard');
        window.history.replaceState({ page: 'worker_dashboard' }, '', '#worker_dashboard');
      } catch {}
      window.location.reload();
      return;
    }

    onComplete();
  }

  return (
    <div className="min-h-[100dvh] bg-[#090B11] pb-8 text-white">
      <Toaster position="top-center" richColors theme="dark" />
      <main className="mx-auto max-w-2xl px-4 py-5 sm:px-5">
        <header className="mb-4">
          <p className="text-[9px] font-bold tracking-[.18em] text-violet-300">PROFESSIONAL PROFILE</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <h1 className="text-xl font-bold">{profile.profile_complete ? 'Edit profile' : 'Set up your work profile'}</h1>
            <span className="shrink-0 rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[8px] font-semibold text-[#777E8E]">PUBLIC AFTER APPROVAL</span>
          </div>
        </header>

        <form onSubmit={save} className="space-y-3">
          <section className="rounded-2xl border border-white/[.07] bg-[#11151D] p-4">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => photoRef.current?.click()} className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-violet-500/20 bg-violet-500/15 text-lg font-bold text-violet-200">
                {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : (name || 'W')[0].toUpperCase()}
              </button>
              <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={photo} />
              <div className="min-w-0 flex-1"><Field label="Full name" value={name} set={setName} /></div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Phone" value={phone} set={setPhone} /><Field label="Starting price (₦)" value={price} inputMode="numeric" set={(value) => setPrice(value.replace(/[^0-9]/g, ''))} /></div>
          </section>

          <section className="rounded-2xl border border-white/[.07] bg-[#11151D] p-4">
            <div className="mb-3"><h2 className="text-sm font-semibold">What do you do?</h2><p className="mt-1 text-[9px] text-[#697080]">Choose your main service and specialty.</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SearchableSelect label="Service" value={category} onChange={(value) => { setCategory(value); setSpecialty(''); }} options={categoryOptions} placeholder="Choose service" searchPlaceholder="Search services" />
              <SearchableSelect label="Specialty" value={specialty} onChange={setSpecialty} options={specialtyOptions} placeholder={category ? 'Choose specialty' : 'Choose service first'} searchPlaceholder="Search specialty" disabled={!category} />
            </div>
            <label className="mt-3 block"><span className="mb-1.5 block text-[10px] font-medium text-[#7B8190]">Experience</span><textarea value={experience} onChange={(event) => setExperience(event.target.value)} rows={3} placeholder="Example: 4 years installing and repairing home electrical systems" className="w-full resize-none rounded-xl border border-white/[.08] bg-[#181B24] p-3 text-xs outline-none placeholder:text-[#5E6473] focus:border-violet-500/40" /></label>
            <label className="mt-3 block"><span className="mb-1.5 block text-[10px] font-medium text-[#7B8190]">About your work <span className="text-[#5E6473]">(optional)</span></span><textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={3} placeholder="What can customers expect from you?" className="w-full resize-none rounded-xl border border-white/[.08] bg-[#181B24] p-3 text-xs outline-none placeholder:text-[#5E6473] focus:border-violet-500/40" /></label>
          </section>

          <section className="rounded-2xl border border-white/[.07] bg-[#11151D] p-4">
            <div className="mb-3"><h2 className="text-sm font-semibold">Where do you work?</h2><p className="mt-1 text-[9px] text-[#697080]">Customers discover you within this service area.</p></div>
            <LocationSelector value={location} onChange={setLocation} />
          </section>

          {profile.worker_status === 'verified' && <div className="rounded-xl border border-amber-500/15 bg-amber-500/[.05] p-3 text-[9px] text-amber-200">Major changes to a live profile may require review again.</div>}

          <button type="submit" disabled={busy} className="h-12 w-full rounded-xl bg-violet-500 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Saving…' : profile.profile_complete ? 'Save changes' : 'Save & continue'}</button>
        </form>
      </main>
    </div>
  );
}

function Field({ label, value, set, inputMode }: { label: string; value: string; set: (value: string) => void; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'] }) {
  return <label className="block"><span className="mb-1.5 block text-[10px] font-medium text-[#7B8190]">{label}</span><input value={value} inputMode={inputMode} onChange={(event) => set(event.target.value)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#181B24] px-3 text-xs outline-none focus:border-violet-500/40" /></label>;
}
