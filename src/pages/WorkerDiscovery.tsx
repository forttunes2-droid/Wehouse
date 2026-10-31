import DiscoveryRows from '@/components/DiscoveryRows';
import {useServicePhotoUrls} from '@/hooks/useServicePhotoUrls';
import type {ServiceProvider} from '@/lib/supabase/workers-public';
import SponsoredPlacement from "@/components/SponsoredPlacement";
import {matchesDiscoveryText} from '@/lib/discoveryText';
import WeHouseLoadingState from "@/components/WeHouseLoadingState";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getCategoryWithSubcategories,
  supabase,
} from "@/lib/supabase";
import {searchServiceProviders,getServiceProvidersByIds,type ServiceProviderCursor} from '@/lib/supabase/workers-public';
import {withTimeout} from '@/lib/withTimeout';
import { useSponsoredDiscovery, recordSponsoredOpen } from '@/hooks/useSponsoredDiscovery';
import { getUserActiveBookings } from "@/lib/supabase/worker-bookings";
import LocationFilterFields from "@/components/LocationFilterFields";
import WorkerBookingRequestSheetV2 from "@/components/WorkerBookingRequestSheetV2";
import BookingNegotiationChat from "@/components/BookingNegotiationChat";
import WorkerTrustBadge from "@/components/WorkerTrustBadge";
import GoldTickBadge from "@/components/GoldTickBadge";
import WorkerPublicProfile from "@/components/WorkerPublicProfile";
import SearchableSelect from "@/components/SearchableSelect";
import DiscoveryShell, {
  DiscoveryEmpty,
  DiscoveryFilterSheet,
  DiscoveryToolbar,
} from "@/components/DiscoveryShell";
import { workerServiceNames } from "@/lib/workerTaxonomy";
import {workerServesLocation,workerCoverageSearchText} from '@/lib/serviceCoverageMatch';
import {locationLabel} from '@/lib/locationPresentation';
import { workerAvatarUrl, workerDisplayName, workerInitial, workerRoleLabel } from "@/lib/workerIdentity";
import type { Profile, ServiceCategory, ServiceSubcategory } from "@/types";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";
import { formatRecordedMoney,getRegionalDefaults } from "@/lib/regional";

type Category = ServiceCategory & { subcategories: ServiceSubcategory[] };
const ExperienceDiscovery=lazy(()=>import('@/components/ExperienceDiscovery'));
function OfferingChoice({value,onChange}:{value:'services'|'experiences';onChange:(value:'services'|'experiences')=>void}){
 return <div aria-label="Service offering" className="inline-flex gap-1 rounded-full border border-[var(--wh-border)] bg-[var(--wh-surface)] p-1">{(['services','experiences'] as const).map(kind=><button key={kind} type="button" aria-pressed={value===kind} onClick={()=>onChange(kind)} className={`min-h-11 rounded-full px-5 text-sm font-medium ${value===kind?'bg-[var(--wh-accent-surface)] text-[var(--wh-accent-text)]':'text-[var(--wh-text-secondary)]'}`}>{kind==='services'?'Request a service':'Book an activity'}</button>)}</div>;
}
type ActiveBooking = { worker_id?: string | null };
type Props = {
  userCity?: string | null;
  profile?: Profile | null;
  onNavigate?: (page: string, id?: string) => void;
  preSelectedCategory?: string | null;
  initialWorkerId?: string | null;
  initialExperienceId?:string|null;
  onInitialExperienceOpened?:()=>void;
  onInitialWorkerOpened?: () => void;
};

function workerMatchesFilters(worker: Profile, filters: {
  search: string;
  category: string;
  specialty: string;
  categoryServices: string[];
  state: string;
  city: string;
}) {
  const hay = [
    workerDisplayName(worker),
    worker.username || '',
    worker.worker_occupation || "",
    worker.worker_bio || "",
    worker.city || "",
    worker.local_government || "",
    worker.state || "",
    workerCoverageSearchText(worker),
    ...workerServiceNames(worker),
  ].join(" ").toLowerCase();
  if (!matchesDiscoveryText([hay], filters.search)) return false;
  const offered=[worker.worker_occupation||'',...workerServiceNames(worker)].map(name=>name.trim().toLowerCase());
  if (filters.category && ![filters.category,...filters.categoryServices].some(name=>offered.includes(name.trim().toLowerCase()))) return false;
  if (filters.specialty && !workerServiceNames(worker).some(
    (skill) => skill.trim().toLowerCase() === filters.specialty.trim().toLowerCase(),
  )) return false;
  if (!workerServesLocation(worker,filters.state,filters.city)) return false;
  return true;
}

export default function WorkerDiscovery({
  userCity,
  profile,
  onNavigate = () => {},
  preSelectedCategory,
  initialWorkerId,
  initialExperienceId,
  onInitialExperienceOpened,
  onInitialWorkerOpened,
}: Props) {
  const [offering,setOffering]=useState<'services'|'experiences'>(initialExperienceId?'experiences':'services');
  const { getBoolean, loading: settingsLoading } = usePlatformSettings();
  const marketplaceEnabled = getBoolean("worker_marketplace_launch_enabled", false);
  const country=getRegionalDefaults().countryCode;
  const savedState = profile?.state || "",
    savedCity = savedState ? profile?.local_government || profile?.city || userCity || "" : '';
  const [workers, setWorkers] = useState<Profile[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(''),
    [reload, setReload] = useState(0),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [specialty, setSpecialty] = useState(""),
    [state, setState] = useState(savedState),
    [city, setCity] = useState(savedCity),
    [filtersOpen, setFiltersOpen] = useState(false),
    [bookingWorker, setBookingWorker] = useState<Profile | null>(null),
    [viewWorker, setViewWorker] = useState<Profile | null>(null),
    [active, setActive] = useState<Set<string>>(new Set()),
    [profileBlock, setProfileBlock] = useState({
      blockedByMe: false,
      blockedMe: false,
      busy: false,
    }),
    [chat, setChat] = useState<{
      conversationId: string;
      bookingId: string;
    } | null>(null);
  const sponsoredResults = useSponsoredDiscovery('worker', state, city, category,offering==='services');
  const [hasMore,setHasMore]=useState(false),[cursor,setCursor]=useState<ServiceProviderCursor|null>(null),[paging,setPaging]=useState(false),[categoryError,setCategoryError]=useState(''),[promotedWorkers,setPromotedWorkers]=useState<Profile[]>([]);
  const searchVersion=useRef(0),pagingLock=useRef(false);
  const appliedCategory=useRef<string|null>(null);
  const searchText=search.trim();
  const sponsoredIds=JSON.stringify(sponsoredResults.map(row=>row.resource_id));
  useEffect(()=>{let live=true;setPromotedWorkers([]);const ids=JSON.parse(sponsoredIds) as string[];if(offering==='services'&&ids.length)void getServiceProvidersByIds(ids).then(rows=>{if(live)setPromotedWorkers(rows);}).catch(()=>{});return()=>{live=false;};},[sponsoredIds,offering,profile?.user_id]);
  useEffect(()=>{setViewWorker(null);setBookingWorker(null);setChat(null);setActive(new Set());},[profile?.user_id]);
  useEffect(()=>{if(initialExperienceId){setOffering('experiences');setViewWorker(null);setChat(null);}},[initialExperienceId]);
  useEffect(() => {
    if(offering!=='services')return;
    let live = true;
    setCategoryError('');
    void withTimeout(getCategoryWithSubcategories(),15000,'Service categories took too long.').then(({categories:rows,error})=>{
      if(error)throw error;if(live)setCategories((rows||[]) as Category[]);
    }).catch(()=>{if(live)setCategoryError('Service categories could not be loaded. Refresh to use category filters.');});
    return()=>{live=false;};
  },[reload,offering]);
  useEffect(() => {
    const request=++searchVersion.current;
    if(offering!=='services')return;
    const controller=new AbortController();
    setLoading(true);
    setLoadError('');
    setWorkers([]);setHasMore(false);setCursor(null);setPaging(false);pagingLock.current=false;
    const timer=window.setTimeout(()=>{void (async () => {
      try {
        const page=await searchServiceProviders({country,query:searchText,category,specialty,state,city},null,controller.signal);
        if(request!==searchVersion.current)return;
        setWorkers(page.workers);setHasMore(page.hasMore);setCursor(page.nextCursor);
      } catch (error: unknown) {
        if (request===searchVersion.current) {
          setWorkers([]);
          setLoadError(error instanceof Error ? error.message : 'Service Providers could not be loaded.');
        }
      } finally {
        if (request===searchVersion.current) setLoading(false);
      }
    })();},300);
    return()=>{window.clearTimeout(timer);searchVersion.current++;controller.abort();};
  }, [reload,offering,country,searchText,category,specialty,state,city,profile?.user_id]);
  async function moreProviders(){
    if(pagingLock.current||!cursor||!hasMore)return;
    pagingLock.current=true;setPaging(true);setLoadError('');const request=searchVersion.current;
    try{const page=await searchServiceProviders({country,query:search,category,specialty,state,city},cursor);if(request===searchVersion.current){setWorkers(previous=>[...new Map([...previous,...page.workers].map(row=>[row.user_id,row])).values()]);setHasMore(page.hasMore);setCursor(page.nextCursor);}}
    catch(error){if(request===searchVersion.current)setLoadError(error instanceof Error?error.message:'More Service Providers could not be loaded.');}
    finally{if(request===searchVersion.current){pagingLock.current=false;setPaging(false);}}
  }
  useEffect(() => {
    if (!profile?.user_id||offering!=='services') return;
    void getUserActiveBookings(profile.user_id).then(({ bookings }) =>
      setActive(new Set(((bookings || []) as ActiveBooking[]).map((row) => row.worker_id).filter((id): id is string => Boolean(id)))),
    );
  }, [profile?.user_id,offering]);
  useEffect(() => {
    if (!viewWorker || !active.has(viewWorker.user_id)) {
      setProfileBlock({ blockedByMe: false, blockedMe: false, busy: false });
      return;
    }
    let current = true;
    void supabase
      .rpc("get_my_worker_block_state", { p_user_id: viewWorker.user_id })
      .then(({ data, error }) => {
        if (!current || error) return;
        setProfileBlock({
          blockedByMe: Boolean(data?.blocked_by_me),
          blockedMe: Boolean(data?.blocked_me),
          busy: false,
        });
      });
    return () => {
      current = false;
    };
  }, [active, viewWorker]);
  useEffect(() => {
    if(!initialWorkerId)return;
    let live=true;
    void getServiceProvidersByIds([initialWorkerId]).then(rows=>{if(!live)return;if(rows[0])setViewWorker(rows[0]);else toast.error('This Service Provider is unavailable. You can search for another provider.');}).catch(()=>{if(live)toast.error('This Service Provider could not be opened. Please retry the shared link.');}).finally(()=>{if(live)onInitialWorkerOpened?.();});
    return()=>{live=false;};
  }, [initialWorkerId,onInitialWorkerOpened,profile?.user_id]);
  useEffect(() => {
    if(!preSelectedCategory){appliedCategory.current=null;return;}
    if (!categories.length || appliedCategory.current===preSelectedCategory) return;
    const direct = categories.find((item) => item.name === preSelectedCategory);
    if (direct) {
      setCategory(direct.name);
      setSpecialty("");
      appliedCategory.current=preSelectedCategory;
      return;
    }
    const parent = categories.find((item) =>
      (item.subcategories || []).some(
        (sub) => sub.name === preSelectedCategory,
      ),
    );
    if (parent) {
      setCategory(parent.name);
      setSpecialty(preSelectedCategory);
      appliedCategory.current=preSelectedCategory;
    }
  }, [preSelectedCategory, categories]);
  const selected = useMemo(
    () => categories.find((item) => item.name === category) || null,
    [categories, category],
  );
  const categoryOptions = useMemo(
    () => categories.map((item) => ({ value: item.name, label: item.name })),
    [categories],
  );
  const specialtyOptions = useMemo(
    () =>
      (selected?.subcategories || []).map((sub) => ({
        value: sub.name,
        label: sub.name,
      })),
    [selected],
  );
  const categoryServices=useMemo(()=>(selected?.subcategories||[]).map(item=>item.name),[selected]);
  const liveWorkers = useMemo(
    () =>
      workers.filter(
        (worker) =>
          worker.worker_status === "verified" &&
          worker.worker_verified === true &&
          worker.available !== false,
      ),
    [workers],
  );
  // The server filters before pagination. A second browser filter can drop a
  // valid page or use different taxonomy/search rules from the next page.
  const shown = liveWorkers;
  const visibleFeaturedWorkers = useMemo(
    () => sponsoredResults.map(item => ({ campaignId: item.campaign_id,
      worker: promotedWorkers.find(worker => worker.user_id === item.resource_id) }))
      .filter((item): item is { campaignId: string; worker: Profile } =>
        Boolean(item.worker && workerMatchesFilters(item.worker, { search, category, specialty, state, city,categoryServices }))),
    [sponsoredResults, promotedWorkers, search, category, specialty, state, city,categoryServices],
  );

  const filterCount = [category, specialty, state, city].filter(Boolean).length;
  // A Sponsored provider lookup has no search context. Never show a cover for
  // another service when the customer selected a particular service/category.
  function shownOffer(worker:Profile){
    const matches=(name:string)=>!specialty||name.trim().toLowerCase()===specialty.trim().toLowerCase();
    const inCategory=(name:string)=>!category||!categoryServices.length||categoryServices.some(item=>item.trim().toLowerCase()===name.trim().toLowerCase());
    const offer=(worker as ServiceProvider).service_offer;
    if(offer&&matches(offer.name)&&inCategory(offer.name))return offer;
    const services=(worker as Profile&{services?:{name:string;price:number;price_type:string}[]}).services;
    const selected=Array.isArray(services)?services.find(item=>typeof item.name==='string'&&matches(item.name)&&inCategory(item.name)&&Number.isSafeInteger(item.price)&&item.price>=0):null;
    return selected?{name:selected.name,price:selected.price,price_type:selected.price_type,cover:null}:null;
  }
  const servicePhotos=useServicePhotoUrls(offering==='services'?[...shown,...visibleFeaturedWorkers.map(item=>item.worker)].flatMap(worker=>{const cover=shownOffer(worker)?.cover;return cover?[cover.preview]:[];}):[],profile?.user_id);
  function clear() {
    setSearch("");
    setCategory("");
    setSpecialty("");
    setState("");
    setCity("");
  }
  function resetStructured() {
    setCategory("");
    setSpecialty("");
    setState("");
    setCity("");
  }
  function created(
    workerId: string,
    conversationId: string,
    bookingId: string,
  ) {
    setBookingWorker(null);
    setActive((current) => new Set(current).add(workerId));
    setChat({ conversationId, bookingId });
  }
  function openWorker(worker: Profile) {
    const campaign = visibleFeaturedWorkers.find(item => item.worker.user_id === worker.user_id);
    if (campaign) recordSponsoredOpen(campaign.campaignId);
    setViewWorker(worker);
  }
  async function toggleProfileBlock() {
    if (!viewWorker || profileBlock.busy) return;
    const next = !profileBlock.blockedByMe;
    setProfileBlock((value) => ({ ...value, busy: true }));
    const { data, error } = await supabase.rpc("set_my_worker_block", {
      p_user_id: viewWorker.user_id,
      p_blocked: next,
      p_reason: next ? "Blocked from the Worker profile" : null,
    });
    if (error) {
      setProfileBlock((value) => ({ ...value, busy: false }));
      return toast.error(error.message || "Safety setting could not be changed");
    }
    setProfileBlock((value) => ({
      ...value,
      blockedByMe: next,
      busy: false,
    }));
    toast.success(next ? "Worker blocked" : "Worker unblocked");
    if (data?.booking_action === "review_required")
      toast.info("The job and protected payment are now with WeHouse for review.");
  }
  if (chat && profile)
    return (
      <BookingNegotiationChat
        conversationId={chat.conversationId}
        bookingId={chat.bookingId}
        profile={profile}
        isWorker={false}
        onClose={() => setChat(null)}
      />
    );
  if (viewWorker)
    {
    const viewingOwnWorker = Boolean(profile?.user_id && viewWorker.user_id === profile.user_id);
    return (
      <>
        <WorkerPublicProfile
          worker={viewWorker}
          viewerUserId={profile?.user_id}
          onBack={() => setViewWorker(null)}
          onGoToChat={(id) => onNavigate("chat", id)}
          onGoToFriendChat={(id) => onNavigate("activity", id)}
          bookingActive={active.has(viewWorker.user_id)}
          showBookingAction={!viewingOwnWorker}
          onOpenBooking={() => onNavigate("my_reservations")}
          onBook={() =>
            profile
              ? setBookingWorker(viewWorker)
              : toast.info("Please sign in to request this service worker")
          }
          safetyAction={!viewingOwnWorker && active.has(viewWorker.user_id) ? (
            <div>
              {profileBlock.blockedMe && (
                <p className="mb-3 text-[9px] leading-4 text-amber-200">
                  This Worker has stopped direct messages and private calls.
                </p>
              )}
              <button
                type="button"
                disabled={profileBlock.busy}
                onClick={() => void toggleProfileBlock()}
                className="h-12 w-full rounded-2xl border border-amber-500/20 text-[11px] font-semibold text-amber-200 disabled:opacity-45"
              >
                {profileBlock.busy
                  ? "Updating…"
                  : profileBlock.blockedByMe
                    ? "Resume contact"
                    : "Stop contact"}
              </button>
            </div>
          ) : undefined}
        />
        {bookingWorker && profile && (
          <WorkerBookingRequestSheetV2
            worker={bookingWorker}
            profile={profile}
            onClose={() => setBookingWorker(null)}
            onCreated={(conversationId, bookingId) =>
              created(bookingWorker.user_id, conversationId, bookingId)
            }
          />
        )}
      </>
    );
    }
  if(offering==='experiences')return <DiscoveryShell active="services" onNavigate={onNavigate}><main className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8"><OfferingChoice value={offering} onChange={setOffering}/><Suspense fallback={<p role="status">Loading Activities...</p>}><ExperienceDiscovery viewerId={profile?.user_id} onNavigate={onNavigate} initialActivityId={initialExperienceId} onInitialActivityOpened={onInitialExperienceOpened} onBooking={id=>onNavigate('my_reservations',id?`experience:${id}`:undefined)}/></Suspense></main></DiscoveryShell>;
  return (
    <DiscoveryShell
      active="services"
      onNavigate={onNavigate}
    >

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        <OfferingChoice value={offering} onChange={setOffering}/>
        <DiscoveryToolbar
          value={search}
          onChange={setSearch}
          placeholder="Search service, skill or name"
          onFilters={() => setFiltersOpen(true)}
          filterCount={filterCount}
        />
        {visibleFeaturedWorkers.length > 0 && (
          <section
            aria-labelledby="featured-workers-title"
            className="overflow-hidden rounded-3xl border border-[var(--wh-border)] bg-[var(--wh-surface)] px-4 py-4"
          >
            <div className="mb-2">
              <p className="text-[9px] font-bold uppercase tracking-[.16em] text-amber-300">
                SPONSORED
              </p>
              <h2 id="featured-workers-title" className="mt-1 text-sm font-bold">
                Featured Workers
              </h2>
              <p className="mt-1 text-[9px] leading-4 text-[var(--wh-text-muted)]">
                Paid placement among matching, available and Reviewed Workers. It does not mean more trusted.
              </p>
            </div>
            <div className="divide-y divide-amber-300/10">
              {visibleFeaturedWorkers.map(({ worker, campaignId }) => (
                <SponsoredPlacement key={campaignId} campaignId={campaignId} context="worker_discovery"><WorkerCard
                  worker={worker}
                  offer={shownOffer(worker)} coverUrl={servicePhotos.urls[shownOffer(worker)?.cover?.preview||'']}
                  serviceArea={locationLabel(city,state)}
                  active={active.has(worker.user_id)}
                  bookable={worker.user_id !== profile?.user_id}
                  sponsored
                  onProfile={() => openWorker(worker)}
                  onBook={() => { recordSponsoredOpen(campaignId); setBookingWorker(worker); }}
                  onOpen={() => onNavigate("my_reservations")}
                /></SponsoredPlacement>
              ))}
            </div>
          </section>
        )}
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold">
              {loading || settingsLoading
                ? "Finding Workers…"
                : marketplaceEnabled
                  ? `${shown.length}${hasMore?'+':''} ${shown.length === 1 ? "Worker" : "Workers"}`
                  : "WeHouse Services"}
            </p>
            <p className="mt-1 text-[9px] text-[var(--wh-text-muted)]">
              {!marketplaceEnabled && !settingsLoading
                ? "Service discovery is temporarily paused by WeHouse."
                : state
                  ? `Searching ${[city, state].filter(Boolean).join(", ")}`
                  : "Choose State and LGA in filters."}
            </p>
          </div>
          {(search || filterCount) && (
            <button
              type="button"
              onClick={clear}
              className="text-[9px] font-semibold text-violet-300"
            >
              Clear
            </button>
          )}
        </div>
        {loading || settingsLoading ? (
          <WeHouseLoadingState compact label="Loading" />
        ) : loadError && workers.length===0 ? (
          <section role="alert" className="rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-5">
            <p className="text-sm text-[var(--wh-text-secondary)]">Service Providers could not be loaded. Try again to continue your search.</p>
            <button type="button" onClick={()=>setReload(value=>value+1)} className="mt-3 min-h-11 rounded-full bg-[var(--wh-violet)] px-5 text-sm font-semibold text-white">Try again</button>
          </section>
        ) : !marketplaceEnabled ? (
          <DiscoveryEmpty
            title="Service discovery is temporarily paused"
            text="WeHouse has paused new discovery for an operational issue. Existing conversations and bookings remain in your Inbox and Bookings."
          />
        ) : shown.length === 0 ? (
          <DiscoveryEmpty
            title="No Worker matches this search"
            text="Try a broader service or location."
          />
        ) : (
          <DiscoveryRows title="Services near you" itemLabel="providers">
            {shown.map((worker) => (
              <WorkerCard
                key={worker.user_id}
                worker={worker}
                offer={shownOffer(worker)} coverUrl={servicePhotos.urls[shownOffer(worker)?.cover?.preview||'']}
                  serviceArea={locationLabel(city,state)}
                active={active.has(worker.user_id)}
                bookable={worker.user_id !== profile?.user_id}
                onProfile={() => openWorker(worker)}
                onBook={() =>
                  profile
                    ? setBookingWorker(worker)
                    : toast.info("Please sign in to request a Worker")
                }
                onOpen={() => onNavigate("my_reservations")}
              />
            ))}
          </DiscoveryRows>
        )}
        {!loading&&workers.length>0&&loadError&&<p role="alert" className="text-sm text-[var(--wh-text-secondary)]">{loadError}</p>}
        {servicePhotos.error&&<p role="status" className="text-sm text-[var(--wh-text-secondary)]">{servicePhotos.error} <button type="button" className="min-h-11 underline" onClick={servicePhotos.retry}>Refresh photos</button></p>}
        {!loading&&hasMore&&<button type="button" disabled={paging} onClick={()=>void moreProviders()} className="min-h-11 rounded-xl border border-[var(--wh-border)] bg-[var(--wh-surface)] px-5 text-sm font-semibold disabled:opacity-50">{paging?'Loading more Providers...':'Show more Providers'}</button>}
      </main>
      {filtersOpen && (
        <DiscoveryFilterSheet
          title="Filter services"
          onClose={() => setFiltersOpen(false)}
          onClear={resetStructured}
        >
          {categoryError&&<p role="alert" className="text-sm">{categoryError}<button type="button" onClick={()=>setReload(value=>value+1)} className="ml-2 min-h-11 underline">Refresh categories</button></p>}
          <div className="grid grid-cols-2 gap-3">
            <SearchableSelect
              label="Work category"
              value={category}
              onChange={(value) => {
                setCategory(value);
                setSpecialty("");
              }}
              options={categoryOptions}
              placeholder="Any category"
              searchPlaceholder="Search categories"
            />
            <SearchableSelect
              label="Service"
              value={specialty}
              onChange={setSpecialty}
              options={specialtyOptions}
              placeholder={category ? "Any service" : "Choose category"}
              searchPlaceholder="Search services"
              disabled={!category}
            />
          </div>
          <LocationFilterFields region={state} locality={city} onRegionChange={(value) => { setState(value); setCity(""); }} onLocalityChange={setCity} />
          {(savedState || savedCity) && (
            <p className="rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] px-3 py-2.5 text-[9px] text-[var(--wh-text-muted)]">
              Your saved area is the default:{" "}
              {[savedCity, savedState].filter(Boolean).join(", ")}.
            </p>
          )}
        </DiscoveryFilterSheet>
      )}
      {bookingWorker && profile && (
        <WorkerBookingRequestSheetV2
          worker={bookingWorker}
          profile={profile}
          onClose={() => setBookingWorker(null)}
          onCreated={(conversationId, bookingId) =>
            created(bookingWorker.user_id, conversationId, bookingId)
          }
        />
      )}
    </DiscoveryShell>
  );
}

function WorkerCard({
  worker,
  serviceArea,
  active,
  bookable,
  onProfile,
  onBook,
  onOpen,
  sponsored = false,
  offer,
  coverUrl,
}: {
  worker: Profile;
  serviceArea?: string;
  active: boolean;
  bookable: boolean;
  onProfile: () => void;
  onBook: () => void;
  onOpen: () => void;
  sponsored?: boolean;
  offer?: Pick<NonNullable<ServiceProvider['service_offer']>,'name'|'price'|'price_type'|'cover'>|null;
  coverUrl?: string;
}) {
  const occupation = workerRoleLabel(worker),
    displayName = workerDisplayName(worker),
    avatarUrl = workerAvatarUrl(worker),
    skills = workerServiceNames(worker);
  return (
    <article className="flex h-full flex-col rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
      {offer?.cover&&<button type="button" onClick={onProfile} aria-label={`View ${offer.name} by ${displayName}`} className="mb-4 overflow-hidden rounded-xl bg-[var(--wh-elevated)]">{coverUrl?<img src={coverUrl} loading="lazy" decoding="async" alt={offer.cover.caption} className="aspect-[4/3] w-full object-cover"/>:<div className="grid aspect-[4/3] place-items-center p-4 text-sm text-[var(--wh-text-secondary)]">Service photo unavailable</div>}</button>}
      {offer&&<h2 className="mb-3 text-base font-semibold">{offer.name}</h2>}
      {sponsored && (
        <p className="mb-2 text-[8px] font-bold uppercase tracking-[.16em] text-amber-300">
          Sponsored
        </p>
      )}
      <div className="flex items-start gap-3">
        <button
          onClick={onProfile} aria-label={`Open ${displayName} profile`}
          className="shrink-0 rounded-[18px]"
        >
          <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 to-violet-600 text-lg font-bold">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              workerInitial(worker)
            )}
          </div>
        </button>
        <button onClick={onProfile} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
              {displayName}
            </h3>
            <WorkerTrustBadge />
            {worker.pro_active ? <GoldTickBadge size="sm" title="Worker PRO membership" /> : null}
          </div>
          <p className="mt-1 truncate text-[10px] text-[var(--wh-text-secondary)]">
            {occupation}
          </p>
          <p className="mt-1 truncate text-[9px] text-[var(--wh-text-muted)]">
            Base: {locationLabel(worker.city || worker.local_government,worker.state) || "Location not shown"}
          </p>
          {serviceArea&&<p className="mt-1 text-[10px] text-[var(--wh-text-secondary)]">Serves {serviceArea}</p>}
          {Number(worker.review_count || 0) > 0 && Number(worker.rating || 0) > 0 && (
            <p className="mt-2 text-[9px] font-semibold text-amber-300">
              ★ {Number(worker.rating).toFixed(1)} ·{" "}
              {Number(worker.review_count || 0)} reviews
            </p>
          )}
        </button>
      </div>
      {skills.length > 0 && (
        <p className="mt-3 line-clamp-2 text-[9px] leading-4 text-[var(--wh-text-muted)]">
          {skills.slice(0, 4).join(" · ")}
          {skills.length > 4 ? ` · +${skills.length - 4}` : ""}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <p className="text-[10px] font-semibold text-[var(--wh-text)]">
          {(offer?.price??worker.worker_price)
            ? `${offer?.price_type==='fixed'?'':'From '}${formatRecordedMoney(Number(offer?.price??worker.worker_price))}`
            : "Discuss price"}
        </p>
        {active && bookable ? (
          <button
            onClick={onOpen}
            className="rounded-xl border border-amber-500/20 bg-amber-500/[.06] px-3 py-2 text-[9px] font-semibold text-amber-300"
          >
            Open booking
          </button>
        ) : bookable ? (
          <button
            onClick={onBook}
            className="rounded-xl bg-violet-500 px-3 py-2 text-[9px] font-semibold text-white"
          >
            Request
          </button>
        ) : null}
      </div>
    </article>
  );
}
