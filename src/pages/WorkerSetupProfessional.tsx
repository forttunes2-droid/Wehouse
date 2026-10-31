import { useEffect, useMemo, useState } from "react";
import { getRegionalDefaults, currencySymbol } from "@/lib/regional";
import { toast } from "sonner";
import {
  getServiceCategories,
  getServiceSubcategories,
  supabase,
  getMyWorkerServiceCoverage,
  getProfile,
  saveMyWorkerProfile,
} from "@/lib/supabase";
import LocationSelector from "@/components/LocationSelector";
import SearchableSelect from "@/components/SearchableSelect";
import BackButton from "@/components/BackButton";
import type { Profile, ServiceCategory, ServiceSubcategory } from "@/types";
import ProfilePhotoEditor from "@/components/ProfilePhotoEditor";
import { occupationForService, workerOccupation } from "@/lib/workerTaxonomy";
import { formatMoney } from "@/lib/regional";
import {withTimeout} from '@/lib/withTimeout';
import ServiceOfferPhotosPanel from '@/components/ServiceOfferPhotosPanel';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';

type Props = {
  profile: Profile;
  onComplete: () => void;
  onContinueVerification?: () => void;
  onBack?: () => void;
};

type SelectedService = {
  id?: string;
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
  const [photoService,setPhotoService]=useState<SelectedService|null>(null),[photoBusy,setPhotoBusy]=useState(false);
  const [initialServicesKey, setInitialServicesKey] = useState("");
  const [baselineProfile,setBaselineProfile]=useState(profile);
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
    country: getRegionalDefaults().countryName,
    state: "",
    city: "",
    area: "",
  });
  const [initialLocationKey,setInitialLocationKey]=useState('');
  const [loadError,setLoadError]=useState(''),[saveError,setSaveError]=useState(''),[loadAttempt,setLoadAttempt]=useState(0);
  const [busy, setBusy] = useState(false);
  const [servicesLoading, setServicesLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      setServicesLoading(true);
      setLoadError('');
      const [{ categories: rows,error:categoryError },coverageResult,freshProfile] = await withTimeout(Promise.all([getServiceCategories(),getMyWorkerServiceCoverage(),getProfile(profile.user_id)]),15000,'Your work profile took too long to load. Refresh before editing.');
      if (!active) return;
      if(categoryError||coverageResult.error||freshProfile.error)throw categoryError||coverageResult.error||freshProfile.error;
      if(!freshProfile.profile||freshProfile.profile.user_id!==profile.user_id)throw Error('Your current work profile could not be confirmed.');
      const current=freshProfile.profile;
      setBaselineProfile(current);setName(current.full_name||'');setPhone(current.phone||'');setAvatar(current.avatar_url||'');
      setBio(current.worker_bio||'');setExperience(current.worker_experience||'');
      const currentOccupation=workerOccupation(current);setOccupation(currentOccupation==='Service professional'?'':currentOccupation);
      const coverage=coverageResult.coverage;
      const savedLocation={country:coverage?.country||getRegionalDefaults().countryName,state:coverage?.state||'',city:coverage?.city||'',area:coverage?.area||''};
      setLocation(savedLocation);setInitialLocationKey(JSON.stringify(savedLocation));
      const categoryRows = rows || [];
      setCategories(categoryRows);

      const catalogs = await Promise.all(
        categoryRows.map(async (item) => {
          const { subcategories,error } = await getServiceSubcategories(item.id);
          if(error)throw error;
          return { category: item, subcategories: subcategories || [] };
        }),
      );
      if (!active) return;

      const canonical = await withTimeout(supabase
        .from("worker_services")
        .select("id,service_name,price")
        .eq("worker_id", profile.user_id)
        .order("created_at"),15000,'Your saved services took too long to load. Refresh before editing.');
      if (!active) return;
      if(canonical.error)throw canonical.error;

      const canonicalRows = (canonical.data || []) as Array<{
        id: string;
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
          id: row.id,
          categoryId: match?.category.id || "",
          categoryName: match?.category.name || "",
          name: String(row.service_name || "").trim(),
          price: Number(row.price || 0) > 0 ? String(row.price) : "",
        };
      });

      if (!next.length) {
        const legacySkills = Array.isArray(current.worker_skills)
          ? current.worker_skills.filter(
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
              price: current.worker_price ? String(current.worker_price) : "",
            },
          ];
          break;
        }
      }

      setServices(next);
      setInitialServicesKey(servicesKey(next));
      setServicesLoading(false);
    })().catch(cause=>{if(active)setLoadError((cause as {message?:string})?.message||'Your work profile could not be loaded. Refresh before editing.');}).finally(()=>{if(active)setServicesLoading(false);});
    return () => {
      active = false;
    };
  }, [profile.user_id, profile.worker_price, profile.worker_skills,loadAttempt]);

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
    if (!baselineProfile.profile_complete) return true;
    return (
      name.trim() !== (baselineProfile.full_name || "") ||
      avatar !== (baselineProfile.avatar_url || "") ||
      phone.trim() !== (baselineProfile.phone || "") ||
      occupation.trim() !== workerOccupation(baselineProfile) ||
      servicesKey(services) !== initialServicesKey ||
      bio.trim() !== (baselineProfile.worker_bio || "") ||
      experience.trim() !== (baselineProfile.worker_experience || "") ||
      JSON.stringify(location) !== initialLocationKey
    );
  }, [
    avatar,
    bio,
    experience,
    initialServicesKey,
    initialLocationKey,
    location,
    name,
    occupation,
    phone,
    baselineProfile,
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

  async function save(event: React.FormEvent,stayForPhotos=false) {
    event.preventDefault();
    if(busy||servicesLoading||loadError)return;
    setSaveError('');
    if (!name.trim()) return setSaveError("Add your full name");
    if (!services.length) return setSaveError("Add at least one service");
    if (services.some((item) => !item.categoryName || !item.name))
      return setSaveError("Choose a category for every service");
    if (!occupation.trim()) return setSaveError("Add your work title");
    if (!experience.trim()) return setSaveError("Add your work experience");
    if (!location.state || !location.city)
      return setSaveError("Choose your state or region and city or area");

    setBusy(true);
    const servicePayload = services.map((item) => ({
      category: item.categoryName,
      name: item.name,
      price: item.price ? Number(item.price) : 0,
      price_type: item.price ? "starting_from" : "negotiable",
    }));
    const positivePrices = services
      .map((item) => Number(item.price || 0))
      .filter((value) => value > 0);
    let error: {message?:string}|null=null;
    let savedProfile:Profile|null=null;
    try { const result = await saveMyWorkerProfile(servicePayload, {
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
    }); error=result.error;savedProfile=result.profile;
      if(!error&&savedProfile?.user_id!==profile.user_id)error={message:'The saved profile could not be confirmed. Refresh your work profile before retrying.'};
    } catch(cause) {error={message:(cause as {message?:string})?.message||'The save result could not be confirmed. Refresh before retrying.'};}
    setBusy(false);
    if (error)
      return setSaveError(
        error.message || "Your work profile could not be saved. Refresh before retrying.",
      );

    setInitialServicesKey(servicesKey(services));
    setInitialLocationKey(JSON.stringify(location));
    if(savedProfile)setBaselineProfile(savedProfile);
    toast.success("Service Worker profile saved");
    if(stayForPhotos){
      try{
      const {data,error:reloadError}=await withTimeout(supabase.from('worker_services').select('id,service_name').eq('worker_id',profile.user_id),15000,'Services saved. Refresh before adding photos.');
      if(reloadError){setSaveError('Services saved, but their photo references could not be loaded. Refresh before adding photos.');return;}
      setServices(current=>current.map(item=>({...item,id:data?.find(row=>row.service_name.trim().toLowerCase()===item.name.trim().toLowerCase())?.id})));
      }catch{setSaveError('Services saved, but their photo references could not be confirmed. Refresh before adding photos.');}
      return;
    }

    if (!savedProfile?.worker_verified) {
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
    <div className="min-h-[100dvh] bg-[var(--wh-bg)] pb-8 text-[var(--wh-text)]">
      <main className="mx-auto max-w-2xl px-4 py-5 sm:px-5">
        <header className="mb-5 flex items-start gap-3 border-b border-[var(--wh-border-subtle)] pb-4">
          {onBack && <BackButton onClick={onBack} disabled={busy} />}
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold tracking-[.18em] text-violet-300">
              WEHOUSE · WORKER
            </p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <h1 className="truncate text-xl font-bold">
                {profile.worker_occupation ? "Edit profile" : "Set up your work profile"}
              </h1>
              <span className="shrink-0 text-[8px] font-semibold uppercase tracking-wide text-[var(--wh-text-muted)]">
                Public after approval
              </span>
            </div>
          </div>
        </header>

        {(loadError||saveError)&&<section role="alert" className="mb-4 rounded-xl border border-[var(--wh-border)] p-4 text-sm"><p>{loadError||saveError}</p><button type="button" disabled={busy} onClick={()=>{setSaveError('');setLoadAttempt(value=>value+1);}} className="min-h-11 font-semibold text-[var(--wh-accent-text)]">Refresh work profile</button></section>}
        {servicesLoading&&<p role="status" className="mb-4 text-sm text-[var(--wh-text-secondary)]">Loading your work profile…</p>}
        <form onSubmit={save} className="space-y-3">
          <fieldset disabled={busy||servicesLoading||Boolean(loadError)} className="contents">
          <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
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

          <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
            <div className="mb-3">
              <h2 className="text-sm font-semibold">Services you offer</h2>
              <p className="mt-1 text-[9px] leading-4 text-[var(--wh-text-muted)]">
                Add each service customers can request from you. Keep one clear work title for your public profile.
              </p>
            </div>

            {services.length > 0 ? (
              <div className="mb-4 divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
                {services.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">{item.name}</p>
                      <p className="mt-1 truncate text-[9px] text-[var(--wh-text-muted)]">
                        {item.categoryName}
                        {item.price
                          ? ` · From ${formatMoney(Number(item.price))}`
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
                    {item.id&&<button type="button" disabled={busy} onClick={()=>setPhotoService(item)} className="min-h-11 px-2 text-xs font-semibold text-[var(--wh-accent-text)]">Photos</button>}
                  </div>
                ))}
              </div>
            ) : servicesLoading ? (
              <p className="mb-4 text-[10px] text-[var(--wh-text-muted)]">Loading your services…</p>
            ) : (
              <p className="mb-4 text-[10px] text-[var(--wh-text-muted)]">Add the first service customers can request from you.</p>
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
            {services.some(item=>!item.id)&&<div className="mt-4 space-y-2"><p className="text-xs text-[var(--wh-text-secondary)]">Save your services to add a separate cover and gallery for each one.</p><button type="button" disabled={busy||servicesLoading} onClick={event=>void save(event,true)} className="min-h-11 rounded-xl border border-[var(--wh-border)] px-4 text-sm font-semibold">Save and add service photos</button></div>}
            <div className="mt-3">
              <Field
                label={`Starting price (${currencySymbol()}) · optional`}
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
              <p className="mt-1.5 text-[8px] text-[var(--wh-text-muted)]">
                One clear title shown on your public profile, such as Electrician, Hairstylist or Handyperson.
              </p>
            </div>
            <label className="mt-3 block">
              <span className="mb-1.5 block text-[10px] font-medium text-[var(--wh-text-muted)]">
                Work experience
              </span>
              <textarea
                value={experience}
                onChange={(event) => setExperience(event.target.value)}
                rows={3}
                placeholder="Example: 4 years installing and repairing home electrical systems"
                className="w-full resize-none rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-3 text-xs outline-none placeholder:text-[var(--wh-text-muted)] focus:border-violet-500/40"
              />
            </label>
            <label className="mt-3 block">
              <span className="mb-1.5 block text-[10px] font-medium text-[var(--wh-text-muted)]">
                About your work <span className="text-[var(--wh-text-muted)]">(optional)</span>
              </span>
              <textarea
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                rows={3}
                placeholder="What can customers expect from you?"
                className="w-full resize-none rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-3 text-xs outline-none placeholder:text-[var(--wh-text-muted)] focus:border-violet-500/40"
              />
            </label>
          </section>

          <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
            <div className="mb-3">
              <h2 className="text-sm font-semibold">Where do you work?</h2>
              <p className="mt-1 text-[9px] text-[var(--wh-text-muted)]">
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
              disabled={busy || servicesLoading || Boolean(loadError)}
              className="h-12 w-full rounded-xl bg-violet-500 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy
                ? "Saving…"
                : profile.profile_complete
                  ? "Save changes"
                  : "Save & continue"}
            </button>
          )}
          </fieldset>
        </form>
      </main>
      <Dialog open={Boolean(photoService)} onOpenChange={open=>{if(!open&&!photoBusy)setPhotoService(null);}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" onEscapeKeyDown={event=>{if(photoBusy)event.preventDefault();}} onInteractOutside={event=>{if(photoBusy)event.preventDefault();}}><DialogHeader><DialogTitle>Service photos</DialogTitle></DialogHeader>{photoService?.id&&<ServiceOfferPhotosPanel key={photoService.id} serviceId={photoService.id} workerId={profile.user_id} name={photoService.name} onBusyChange={setPhotoBusy}/>}</DialogContent></Dialog>
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
      <span className="mb-1.5 block text-[10px] font-medium text-[var(--wh-text-muted)]">
        {label}
      </span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(event) => set(event.target.value)}
        className="h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-xs outline-none focus:border-violet-500/40"
      />
    </label>
  );
}
