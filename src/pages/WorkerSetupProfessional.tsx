import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getServiceCategories,
  getServiceSubcategories,
  supabase,
  updateProfile,
} from "@/lib/supabase";
import LocationSelector from "@/legacy/LocationSelector";
import SearchableSelect from "@/components/SearchableSelect";
import BackButton from "@/components/BackButton";
import type { Profile, ServiceCategory, ServiceSubcategory } from "@/types";
import ProfilePhotoEditor from "@/components/ProfilePhotoEditor";
import { occupationForService, workerOccupation } from "@/lib/workerTaxonomy";

type Props = {
  profile: Profile;
  onComplete: () => void;
  onContinueVerification?: () => void;
  onBack?: () => void;
};

type SelectedService = {
  categoryId: string;
  categoryName: string;
  name: string;
  price: string;
};

export default function WorkerSetupProfessional({
  profile,
  onComplete,
  onContinueVerification,
  onBack,
}: Props) {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [subs, setSubs] = useState<ServiceSubcategory[]>([]);
  const [category, setCategory] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  const [services, setServices] = useState<SelectedService[]>([]);
  const [initialServicesKey, setInitialServicesKey] = useState("");
  const initialOccupation = workerOccupation(profile);
  const [occupation, setOccupation] = useState(
    initialOccupation === "Service professional" ? "" : initialOccupation,
  );
  const [name, setName] = useState(profile.full_name || "");
  const [experience, setExperience] = useState(profile.worker_experience || "");
  const [bio, setBio] = useState(profile.worker_bio || "");
  const [phone, setPhone] = useState(profile.phone || "");
  const [avatar, setAvatar] = useState(profile.avatar_url || "");
  const [location, setLocation] = useState({
    country: profile.country || "Nigeria",
    state: profile.state || "",
    city: profile.local_government || profile.city || "",
    area: profile.area || "",
  });
  const [busy, setBusy] = useState(false);
  const [servicesLoading, setServicesLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      setServicesLoading(true);
      const { categories: rows } = await getServiceCategories();
      if (!active) return;
      const categoryRows = rows || [];
      setCategories(categoryRows);

      const catalogs = await Promise.all(
        categoryRows.map(async (item) => {
          const { subcategories } = await getServiceSubcategories(item.id);
          return { category: item, subcategories: subcategories || [] };
        }),
      );
      if (!active) return;

      const canonical = await supabase
        .from("worker_services")
        .select("service_name,price")
        .eq("worker_id", profile.user_id)
        .order("created_at");
      if (!active) return;

      const canonicalRows = (canonical.data || []) as Array<{
        service_name: string;
        price: number | null;
      }>;
      let next: SelectedService[] = canonicalRows.map((row) => {
        const match = catalogs.find(({ subcategories }) =>
          subcategories.some(
            (item) =>
              item.name.trim().toLowerCase() ===
              String(row.service_name || "").trim().toLowerCase(),
          ),
        );
        return {
          categoryId: match?.category.id || "",
          categoryName: match?.category.name || "",
          name: String(row.service_name || "").trim(),
          price: Number(row.price || 0) > 0 ? String(row.price) : "",
        };
      });

      if (!next.length) {
        const legacySkills = Array.isArray(profile.worker_skills)
          ? profile.worker_skills.filter(
              (item): item is string =>
                typeof item === "string" && Boolean(item.trim()),
            )
          : [];
        for (const catalog of catalogs) {
          const specialtyName = legacySkills.find((skill) =>
            catalog.subcategories.some(
              (item) =>
                item.name.trim().toLowerCase() === skill.trim().toLowerCase(),
            ),
          );
          if (!specialtyName) continue;
          next = [
            {
              categoryId: catalog.category.id,
              categoryName: catalog.category.name,
              name: specialtyName,
              price: profile.worker_price ? String(profile.worker_price) : "",
            },
          ];
          break;
        }
      }

      setServices(next);
      setInitialServicesKey(servicesKey(next));
      setServicesLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [profile.user_id, profile.worker_price, profile.worker_skills]);

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
    return (
      name.trim() !== (profile.full_name || "") ||
      avatar !== (profile.avatar_url || "") ||
      phone.trim() !== (profile.phone || "") ||
      occupation.trim() !== workerOccupation(profile) ||
      servicesKey(services) !== initialServicesKey ||
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
    experience,
    initialServicesKey,
    location,
    name,
    occupation,
    phone,
    profile,
    services,
  ]);

  function addService() {
    const categoryRow = categories.find((item) => item.id === category);
    if (!categoryRow || !specialty)
      return toast.error("Choose a work category and service");
    if (
      services.some(
        (item) => item.name.toLowerCase() === specialty.toLowerCase(),
      )
    )
      return toast.error("That service is already on your profile");
    if (services.length >= 10)
      return toast.error("You can list up to 10 services");

    const next: SelectedService = {
      categoryId: categoryRow.id,
      categoryName: categoryRow.name,
      name: specialty,
      price: servicePrice,
    };
    setServices((current) => [...current, next]);
    if (!occupation.trim())
      setOccupation(occupationForService(categoryRow.name, specialty));
    setSpecialty("");
    setServicePrice("");
  }

  function removeService(index: number) {
    setServices((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return toast.error("Add your full name");
    if (!services.length) return toast.error("Add at least one service");
    if (services.some((item) => !item.categoryName || !item.name))
      return toast.error("Choose a category for every service");
    if (!occupation.trim()) return toast.error("Add your work title");
    if (!experience.trim()) return toast.error("Add your work experience");
    if (!location.state || !location.city)
      return toast.error("Choose your State and LGA");

    setBusy(true);
    const servicePayload = services.map((item) => ({
      category: item.categoryName,
      name: item.name,
      price: item.price ? Number(item.price) : 0,
      price_type: item.price ? "starting_from" : "negotiable",
    }));
    const serviceResult = await supabase.rpc("set_my_worker_services", {
      p_services: servicePayload,
    });
    if (serviceResult.error) {
      setBusy(false);
      return toast.error(
        serviceResult.error.message || "Could not save your services",
      );
    }

    const positivePrices = services
      .map((item) => Number(item.price || 0))
      .filter((value) => value > 0);
    const { error } = await updateProfile(profile.user_id, {
      full_name: name.trim(),
      avatar_url: avatar || null,
      phone: phone.trim() || null,
      worker_occupation: occupation.trim(),
      worker_price: positivePrices.length ? Math.min(...positivePrices) : null,
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
    if (error)
      return toast.error(
        "Your services were saved, but your profile details could not be saved. Try again.",
      );

    setInitialServicesKey(servicesKey(services));
    toast.success("Worker profile saved");

    if (!profile.worker_verified) {
      if (onContinueVerification) {
        onContinueVerification();
        return;
      }
      try {
        localStorage.setItem("wh_navpage", "worker_verification");
        window.history.replaceState(
          { page: "worker_verification" },
          "",
          "#worker_verification",
        );
      } catch {}
      window.location.reload();
      return;
    }

    onComplete();
  }

  return (
    <div className="min-h-[100dvh] bg-[#090B11] pb-8 text-white">
      <main className="mx-auto max-w-2xl px-4 py-5 sm:px-5">
        <header className="mb-5 flex items-start gap-3 border-b border-white/[.06] pb-4">
          {onBack && <BackButton onClick={onBack} />}
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold tracking-[.18em] text-violet-300">
              WEHOUSE · WORKER
            </p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <h1 className="truncate text-xl font-bold">
                {profile.worker_occupation ? "Edit profile" : "Set up your work profile"}
              </h1>
              <span className="shrink-0 text-[8px] font-semibold uppercase tracking-wide text-[#777E8E]">
                Public after approval
              </span>
            </div>
          </div>
        </header>

        <form onSubmit={save} className="space-y-3">
          <section className="rounded-2xl border border-white/[.07] bg-[#11151D] p-4">
            <ProfilePhotoEditor
              avatar={avatar}
              name={name}
              disabled={busy}
              onUploaded={(url) => setAvatar(url)}
            />
            <div className="mt-4">
              <Field label="Full name" value={name} set={setName} />
            </div>
            <div className="mt-3">
              <Field label="Phone" value={phone} set={setPhone} />
            </div>
          </section>

          <section className="rounded-2xl border border-white/[.07] bg-[#11151D] p-4">
            <div className="mb-3">
              <h2 className="text-sm font-semibold">Services you offer</h2>
              <p className="mt-1 text-[9px] leading-4 text-[#697080]">
                Add each service customers can request from you. Keep one clear work title for your public profile.
              </p>
            </div>

            {services.length > 0 ? (
              <div className="mb-4 divide-y divide-white/[.06] border-y border-white/[.06]">
                {services.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">{item.name}</p>
                      <p className="mt-1 truncate text-[9px] text-[#687080]">
                        {item.categoryName}
                        {item.price
                          ? ` · From ₦${Number(item.price).toLocaleString()}`
                          : " · Price discussed with customer"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeService(index)}
                      disabled={busy}
                      className="min-h-10 px-2 text-[10px] font-semibold text-red-300 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : servicesLoading ? (
              <p className="mb-4 text-[10px] text-[#737A8A]">Loading your services…</p>
            ) : (
              <p className="mb-4 text-[10px] text-[#737A8A]">Add the first service customers can request from you.</p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <SearchableSelect
                label="Work category"
                value={category}
                onChange={(value) => {
                  setCategory(value);
                  setSpecialty("");
                }}
                options={categoryOptions}
                placeholder="Choose category"
                searchPlaceholder="Search categories"
              />
              <SearchableSelect
                label="Service"
                value={specialty}
                onChange={setSpecialty}
                options={specialtyOptions}
                placeholder={category ? "Choose a service" : "Choose a category first"}
                searchPlaceholder="Search services"
                disabled={!category}
              />
            </div>
            <div className="mt-3">
              <Field
                label="Starting price (₦) · optional"
                value={servicePrice}
                inputMode="numeric"
                set={(value) => setServicePrice(value.replace(/[^0-9]/g, ""))}
              />
            </div>
            <button
              type="button"
              onClick={addService}
              disabled={busy || !category || !specialty || services.length >= 10}
              className="mt-3 h-11 w-full rounded-xl border border-violet-500/20 bg-violet-500/[.07] text-[11px] font-semibold text-violet-200 disabled:opacity-35"
            >
              Add service
            </button>

            <div className="mt-4">
              <Field label="Work title" value={occupation} set={setOccupation} />
              <p className="mt-1.5 text-[8px] text-[#5F6676]">
                One clear title shown on your public profile, such as Electrician, Hairstylist or Handyperson.
              </p>
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
                About your work <span className="text-[#5E6473]">(optional)</span>
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
              disabled={busy || servicesLoading}
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

function servicesKey(services: SelectedService[]) {
  return JSON.stringify(
    services.map((item) => ({
      category: item.categoryName.trim().toLowerCase(),
      name: item.name.trim().toLowerCase(),
      price: item.price || "",
    })),
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
