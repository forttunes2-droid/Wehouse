import { useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  getServiceCategories,
  getServiceSubcategories,
  updateProfile,
} from "@/lib/supabase";
import LocationSelector from "@/legacy/LocationSelector";
import SearchableSelect from "@/components/SearchableSelect";
import BackButton from "@/components/BackButton";
import type { Profile, ServiceCategory, ServiceSubcategory } from "@/types";
import ProfilePhotoEditor from '@/components/ProfilePhotoEditor';

type Props = { profile: Profile; onComplete: () => void; onBack?: () => void };

export default function WorkerSetupProfessional({
  profile,
  onComplete,
  onBack,
}: Props) {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [subs, setSubs] = useState<ServiceSubcategory[]>([]);
  const [category, setCategory] = useState("");
  const [specialty, setSpecialty] = useState(
    ((profile.worker_skills as string[]) || [])[0] || "",
  );
  const [name, setName] = useState(profile.full_name || "");
  const [experience, setExperience] = useState(profile.worker_experience || "");
  const [bio, setBio] = useState(profile.worker_bio || "");
  const [price, setPrice] = useState(
    profile.worker_price ? String(profile.worker_price) : "",
  );
  const [phone, setPhone] = useState(profile.phone || "");
  const [avatar, setAvatar] = useState(profile.avatar_url || "");
  const [location, setLocation] = useState({
    country: profile.country || "Nigeria",
    state: profile.state || "",
    city: profile.local_government || profile.city || "",
    area: profile.area || "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const { categories: rows } = await getServiceCategories();
      setCategories(rows || []);
      const match = (rows || []).find(
        (item) => item.name === profile.worker_occupation,
      );
      if (match) setCategory(match.id);
    })();
  }, [profile.worker_occupation]);

  useEffect(() => {
    if (!category) {
      const timer = window.setTimeout(() => setSubs([]), 0);
      return () => window.clearTimeout(timer);
    }
    void getServiceSubcategories(category).then(({ subcategories }) =>
      setSubs(subcategories || []),
    );
  }, [category]);

  const categoryOptions = useMemo(
    () => categories.map((item) => ({ value: item.id, label: item.name })),
    [categories],
  );
  const specialtyOptions = useMemo(
    () => subs.map((item) => ({ value: item.name, label: item.name })),
    [subs],
  );
  const hasChanges = useMemo(() => {
    if (!profile.profile_complete) return true;
    const service = categories.find((item) => item.id === category)?.name || "";
    return (
      name.trim() !== (profile.full_name || "") ||
      avatar !== (profile.avatar_url || "") ||
      phone.trim() !== (profile.phone || "") ||
      service !== (profile.worker_occupation || "") ||
      specialty !== (((profile.worker_skills as string[]) || [])[0] || "") ||
      price !== (profile.worker_price ? String(profile.worker_price) : "") ||
      bio.trim() !== (profile.worker_bio || "") ||
      experience.trim() !== (profile.worker_experience || "") ||
      location.country !== (profile.country || "Nigeria") ||
      location.state !== (profile.state || "") ||
      location.city !== (profile.local_government || profile.city || "") ||
      location.area !== (profile.area || "")
    );
  }, [
    avatar,
    bio,
    categories,
    category,
    experience,
    location,
    name,
    phone,
    price,
    profile,
    specialty,
  ]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const service = categories.find((item) => item.id === category);
    if (!name.trim()) return toast.error("Add your full name");
    if (!service || !specialty)
      return toast.error("Choose your service and specialty");
    if (!experience.trim()) return toast.error("Add your work experience");
    if (!location.state || !location.city)
      return toast.error("Choose your State and LGA");

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
    toast.success("Professional profile saved");

    try {
      if (sessionStorage.getItem("wh_worker_setup_return") === "verification") {
        sessionStorage.removeItem("wh_worker_setup_return");
        localStorage.setItem("wh_navpage", "worker_verification");
        window.history.replaceState(
          { page: "worker_verification" },
          "",
          "#worker_verification",
        );
        window.location.reload();
        return;
      }
    } catch {}

    if (!profile.profile_complete) {
      try {
        localStorage.setItem("wh_navpage", "worker_dashboard");
        window.history.replaceState(
          { page: "worker_dashboard" },
          "",
          "#worker_dashboard",
        );
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
        <header className="mb-5 flex items-start gap-3 border-b border-white/[.06] pb-4">
          {onBack && <BackButton onClick={onBack} />}
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold tracking-[.18em] text-violet-300">
              WEHOUSE · WORKER
            </p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <h1 className="truncate text-xl font-bold">
                {profile.profile_complete
                  ? "Edit profile"
                  : "Set up your work profile"}
              </h1>
              <span className="shrink-0 text-[8px] font-semibold uppercase tracking-wide text-[#777E8E]">
                Public after approval
              </span>
            </div>
          </div>
        </header>

        <form onSubmit={save} className="space-y-3">
          <section className="rounded-2xl border border-white/[.07] bg-[#11151D] p-4">
            <ProfilePhotoEditor avatar={avatar} name={name} disabled={busy} onUploaded={url=>setAvatar(url)}/>
            <div className="mt-4"><Field label="Full name" value={name} set={setName} /></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Phone" value={phone} set={setPhone} />
              <Field
                label="Starting price (₦)"
                value={price}
                inputMode="numeric"
                set={(value) => setPrice(value.replace(/[^0-9]/g, ""))}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-white/[.07] bg-[#11151D] p-4">
            <div className="mb-3">
              <h2 className="text-sm font-semibold">What do you do?</h2>
              <p className="mt-1 text-[9px] text-[#697080]">
                Choose your main service and specialty.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SearchableSelect
                label="Service"
                value={category}
                onChange={(value) => {
                  setCategory(value);
                  setSpecialty("");
                }}
                options={categoryOptions}
                placeholder="Choose service"
                searchPlaceholder="Search services"
              />
              <SearchableSelect
                label="Specialty"
                value={specialty}
                onChange={setSpecialty}
                options={specialtyOptions}
                placeholder={
                  category ? "Choose specialty" : "Choose service first"
                }
                searchPlaceholder="Search specialty"
                disabled={!category}
              />
            </div>
            <label className="mt-3 block">
              <span className="mb-1.5 block text-[10px] font-medium text-[#7B8190]">
                Experience
              </span>
              <textarea
                value={experience}
                onChange={(event) => setExperience(event.target.value)}
                rows={3}
                placeholder="Example: 4 years installing and repairing home electrical systems"
                className="w-full resize-none rounded-xl border border-white/[.08] bg-[#181B24] p-3 text-xs outline-none placeholder:text-[#5E6473] focus:border-violet-500/40"
              />
            </label>
            <label className="mt-3 block">
              <span className="mb-1.5 block text-[10px] font-medium text-[#7B8190]">
                About your work{" "}
                <span className="text-[#5E6473]">(optional)</span>
              </span>
              <textarea
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                rows={3}
                placeholder="What can customers expect from you?"
                className="w-full resize-none rounded-xl border border-white/[.08] bg-[#181B24] p-3 text-xs outline-none placeholder:text-[#5E6473] focus:border-violet-500/40"
              />
            </label>
          </section>

          <section className="rounded-2xl border border-white/[.07] bg-[#11151D] p-4">
            <div className="mb-3">
              <h2 className="text-sm font-semibold">Where do you work?</h2>
              <p className="mt-1 text-[9px] text-[#697080]">
                Customers discover you within this service area.
              </p>
            </div>
            <LocationSelector value={location} onChange={setLocation} />
          </section>

          {profile.worker_status === "verified" && (
            <div className="rounded-xl border border-amber-500/15 bg-amber-500/[.05] p-3 text-[9px] text-amber-200">
              Major changes to a live profile may require review again.
            </div>
          )}

          {hasChanges && (
            <button
              type="submit"
              disabled={busy}
              className="h-12 w-full rounded-xl bg-violet-500 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy
                ? "Saving…"
                : profile.profile_complete
                  ? "Save changes"
                  : "Save & continue"}
            </button>
          )}
        </form>
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  set,
  inputMode,
}: {
  label: string;
  value: string;
  set: (value: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-medium text-[#7B8190]">
        {label}
      </span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(event) => set(event.target.value)}
        className="h-11 w-full rounded-xl border border-white/[.08] bg-[#181B24] px-3 text-xs outline-none focus:border-violet-500/40"
      />
    </label>
  );
}
