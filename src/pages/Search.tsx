import { publicPropertyImages } from "@/lib/publicPropertyMedia";
import { takeFollowedSearchIntent } from "@/lib/followedSearchIntent";
import { useEffect, useMemo, useRef, useState } from "react";
import { NIGERIA_STATES, getCitiesForState } from "@/data/nigeria-locations";
import { useDiscoveryAccess } from '@/components/DiscoveryAccess';
import ListingCard from "@/components/ListingCard";
import SearchableSelect from "@/components/SearchableSelect";
import DiscoveryPriceRangeSlider from "@/components/DiscoveryPriceRangeSlider";
import DiscoveryShell, {
  DiscoveryEmpty,
  DiscoveryFilterSheet,
  DiscoveryToolbar,
} from "@/components/DiscoveryShell";
import {
  getDiscoverableHomes,
  type HomePageCursor,
  type HomeStayType,
} from "@/lib/housing-discovery";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";
import { useSponsoredDiscovery, recordSponsoredImpression, recordSponsoredOpen } from '@/hooks/useSponsoredDiscovery';
import type { Listing } from "@/types";
import { toast } from "sonner";
import { getListing } from "@/lib/supabase/listings";
import {
  followPropertySearch,
  getMySavedSearches,
  removeSavedSearch,
  savedSearchKey,
  type SavedSearch,
} from "@/lib/supabase/saved-searches";
import {
  getDiscoveryDistanceMap,
  useDiscoveryLocation,
} from "@/hooks/useDiscoveryLocation";

type SearchProps = {
  onNavigate: (page: string, listingId?: string) => void;
  savedIds: Set<string>;
  onToggleSave: (listingId: string) => void;
  sessionKey?: string;
};

const LONG_FLOOR = 180000;
const LONG_CEILING = 5000000;
const SHORT_FLOOR = 5000;
const SHORT_CEILING = 500000;
type StayFilter = HomeStayType | "all";
type PropertySearchState = {
  query: string;
  stayType: StayFilter;
  priceMin: number | "";
  priceMax: number | "";
  bedrooms: number | "";
  bathrooms: number | "";
  filterState: string;
  filterCity: string;
};
const emptySearchState: PropertySearchState = {
  query: "",
  stayType: "all",
  priceMin: "",
  priceMax: "",
  bedrooms: "",
  bathrooms: "",
  filterState: "",
  filterCity: "",
};
// Remember filters only within the same identity. A guest or another signed-in
// account must never inherit a previous account's search.
const searchStateBySession = new Map<string, PropertySearchState>();

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function matchesHome(listing: Listing, filters: {
  query: string; stayType: StayFilter; minPrice: number | ""; maxPrice: number | "";
  bedrooms: number | ""; bathrooms: number | ""; state: string; city: string;
}) {
  if (filters.query.trim() && !normalize([listing.title, listing.address, listing.city, listing.state].filter(Boolean).join(" ")).includes(normalize(filters.query))) return false;
  if (filters.stayType !== "all" && listing.sub_type !== filters.stayType) return false;
  const price = Number(listing.price || 0);
  if (filters.minPrice !== "" && (price <= 0 || price < filters.minPrice)) return false;
  if (filters.maxPrice !== "" && (price <= 0 || price > filters.maxPrice)) return false;
  if (filters.bedrooms && Number(listing.bedrooms || 0) < filters.bedrooms) return false;
  if (filters.bathrooms && Number(listing.bathrooms || 0) < filters.bathrooms) return false;
  if (filters.state && normalize(listing.state) !== normalize(filters.state)) return false;
  if (filters.city && normalize(listing.city) !== normalize(filters.city)) return false;
  return listing.status === "available" && String(listing.availability_status || "available") === "available";
}

export default function Search({
  onNavigate,
  savedIds,
  onToggleSave,
  sessionKey = 'guest',
}: SearchProps) {
  const guest = useDiscoveryAccess();
  const initialSearch = searchStateBySession.get(sessionKey) || emptySearchState;
  const [query, setQuery] = useState(() => initialSearch.query);
  const { getNumber } = usePlatformSettings();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<HomePageCursor | null>(null);
  const [reload, setReload] = useState(0);
  const [sponsoredListings, setSponsoredListings] = useState<Listing[]>([]);
  const requestGeneration = useRef(0);
  const [loadError, setLoadError] = useState("");
  const [stayType, setStayType] = useState<StayFilter>(() => initialSearch.stayType);
  const [priceMin, setPriceMin] = useState<number | "">(() => initialSearch.priceMin);
  const [priceMax, setPriceMax] = useState<number | "">(() => initialSearch.priceMax);
  const [bedrooms, setBedrooms] = useState<number | "">(() => initialSearch.bedrooms);
  const [bathrooms, setBathrooms] = useState<number | "">(() => initialSearch.bathrooms);
  const [filterState, setFilterState] = useState(() => initialSearch.filterState);
  const [filterCity, setFilterCity] = useState(() => initialSearch.filterCity);
  const sponsoredResults = useSponsoredDiscovery('property', filterState, filterCity);
  const [showFilters, setShowFilters] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);
  const [followedSearches, setFollowedSearches] = useState<SavedSearch[]>([]);
  const {
    location,
    locating,
    error: locationError,
    requestLocation,
    clearLocation,
  } = useDiscoveryLocation();
  const [distanceMap, setDistanceMap] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let live = true;
    void getDiscoveryDistanceMap(location).then((next) => { if (live) setDistanceMap(next); });
    return () => { live = false; };
  }, [location]);

  useEffect(() => {
    const criteria = takeFollowedSearchIntent('homes');
    if (!criteria) return;
    sessionStorage.removeItem('search_property_type');
    const string = (key: string) => typeof criteria[key] === 'string' ? criteria[key] as string : '';
    const number = (key: string) => typeof criteria[key] === 'number' && Number.isFinite(criteria[key]) ? criteria[key] as number : '';
    const stay = string('sub_type');
    setStayType(stay === 'short_let' || stay === 'long_stay' ? stay : 'all');
    setFilterState(string('state'));
    setFilterCity(string('city'));
    setPriceMin(number('min_price'));
    setPriceMax(number('max_price'));
    setBedrooms(number('bedrooms'));
    setBathrooms(number('bathrooms'));
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem("search_property_type");
    if (saved === "short_let" || saved === "long_stay") setStayType(saved);
    sessionStorage.removeItem("search_property_type");
  }, []);

  useEffect(() => {
    if (guest) return;
    let current = true;
    void getMySavedSearches().then(({ searches }) => { if (current) setFollowedSearches(searches); });
    return () => { current = false; };
  }, [Boolean(guest)]);

  useEffect(() => {
    searchStateBySession.set(sessionKey, {
      query,
      stayType,
      priceMin,
      priceMax,
      bedrooms,
      bathrooms,
      filterState,
      filterCity,
    });
  }, [sessionKey, query, stayType, priceMin, priceMax, bedrooms, bathrooms, filterState, filterCity]);

  const serverFilters = useMemo(() => ({
    query, stayType, minPrice: priceMin, maxPrice: priceMax, bedrooms, bathrooms,
    state: filterState, city: filterCity,
  }), [query, stayType, priceMin, priceMax, bedrooms, bathrooms, filterState, filterCity]);

  useEffect(() => {
    let live = true;
    const generation = ++requestGeneration.current;
    setListings([]);
    setHasMore(false);
    setCursor(null);
    setLoadingMore(false);
    setLoading(true);
    setLoadError("");
    const timer = window.setTimeout(() => {
      void getDiscoverableHomes(serverFilters).then(({ homes, hasMore: more, nextCursor, error }) => {
        if (!live || generation !== requestGeneration.current) return;
        if (error) setLoadError("Apartments could not be loaded. Check your connection and try again.");
        else {
          setListings(homes.map(item => ({ ...item, images: publicPropertyImages(item.images), videos: publicPropertyImages(item.videos) })));
          setHasMore(more);
          setCursor(nextCursor);
        }
      }).catch(() => {
        if (live && generation === requestGeneration.current) setLoadError("Apartments could not be loaded. Check your connection and try again.");
      }).finally(() => { if (live && generation === requestGeneration.current) setLoading(false); });
    }, query.trim() ? 250 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [serverFilters, reload]);

  async function loadMore() {
    if (!hasMore || !cursor || loadingMore) return;
    const generation = requestGeneration.current;
    setLoadingMore(true);
    try {
      const result = await getDiscoverableHomes(serverFilters, cursor);
      if (generation !== requestGeneration.current) return;
      if (result.error) { toast.error("More apartments could not be loaded. Try again."); return; }
      setListings(current => {
        const seen = new Set(current.map(item => item.id));
        return [...current, ...result.homes.filter(item => !seen.has(item.id)).map(item => ({
          ...item, images: publicPropertyImages(item.images), videos: publicPropertyImages(item.videos),
        }))];
      });
      setHasMore(result.hasMore);
      setCursor(result.nextCursor);
    } catch {
      if (generation === requestGeneration.current) toast.error("More apartments could not be loaded. Try again.");
    } finally { if (generation === requestGeneration.current) setLoadingMore(false); }
  }

  useEffect(() => {
    let live = true;
    if (!sponsoredResults.length) { setSponsoredListings([]); return; }
    setSponsoredListings([]);
    void Promise.all(sponsoredResults.map(item => getListing(item.resource_id))).then(results => {
      if (!live) return;
      setSponsoredListings(results.filter(result => !result.error && result.listing)
        .map(result => result.listing!) as Listing[]);
    }).catch(() => { if (live) setSponsoredListings([]); });
    return () => { live = false; };
  }, [sponsoredResults]);

  const citiesForState = useMemo(() => getCitiesForState(filterState), [filterState]);
  const stateOptions = useMemo(
    () => NIGERIA_STATES.map((item) => ({ value: item.state, label: item.state })),
    [],
  );
  const cityOptions = useMemo(
    () => citiesForState.map((city) => ({ value: city, label: city })),
    [citiesForState],
  );
  const priceScale = useMemo(
    () =>
      stayType === "short_let"
        ? {
            floor: getNumber("home_short_stay_min_price", SHORT_FLOOR),
            ceiling: getNumber("home_short_stay_max_price", SHORT_CEILING),
            step: 1000,
          }
        : {
            floor: getNumber("home_long_stay_min_price", LONG_FLOOR),
            ceiling: getNumber("home_long_stay_max_price", LONG_CEILING),
            step: 10000,
          },
    [stayType, getNumber],
  );

  const filtered = useMemo(
    () =>
      listings
        .map((listing) => ({
          listing,
          distance: distanceMap.get(`listing:${listing.id}`) ?? null,
        }))
        .filter(({ listing }) => matchesHome(listing, serverFilters))
        .sort((a, b) =>
          location ? (a.distance ?? Infinity) - (b.distance ?? Infinity) : 0,
        ),
    [
      listings,
      serverFilters,
      distanceMap,
      location,
    ],
  );
  const sponsoredHomes = useMemo(() => sponsoredResults.map(item => ({
    campaignId: item.campaign_id,
    entry: [...filtered, ...sponsoredListings.filter(listing => matchesHome(listing, serverFilters))
      .map(listing => ({ listing, distance: distanceMap.get(`listing:${listing.id}`) ?? null }))]
      .find(({ listing }) => listing.id === item.resource_id),
  })).filter((item): item is { campaignId: string; entry: (typeof filtered)[number] } => Boolean(item.entry)),
    [sponsoredResults, sponsoredListings, filtered, serverFilters, distanceMap]);
  useEffect(() => {
    sponsoredHomes.forEach(item => recordSponsoredImpression(item.campaignId, 'home_discovery'));
  }, [sponsoredHomes]);

  const priceActive = priceMin !== "" || priceMax !== "";
  const filterCount =
    [bedrooms, bathrooms, filterState, filterCity].filter(Boolean).length +
    (priceActive ? 1 : 0);
  const hasFilters = Boolean(filterCount || stayType !== "all");
  const currentSearchCriteria = useMemo(
    () => ({
      sub_type: stayType === "all" ? null : stayType,
      state: filterState,
      city: filterCity,
      min_price: priceMin === "" ? null : priceMin,
      max_price: priceMax === "" ? null : priceMax,
      bedrooms: bedrooms === "" ? null : bedrooms,
      bathrooms: bathrooms === "" ? null : bathrooms,
    }),
    [bathrooms, bedrooms, filterCity, filterState, priceMax, priceMin, stayType],
  );
  const currentSearchKey = savedSearchKey("homes", currentSearchCriteria);
  const followedSearch = followedSearches.find(
    (item) => savedSearchKey(item.search_kind, item.criteria || {}) === currentSearchKey,
  );

  function clearFilters() {
    setQuery("");
    setStayType("all");
    setPriceMin("");
    setPriceMax("");
    setBedrooms("");
    setBathrooms("");
    setFilterState("");
    setFilterCity("");
  }

  function chooseStay(next: StayFilter) {
    if (next === stayType) return;
    setStayType(next);
    setPriceMin("");
    setPriceMax("");
  }

  function chooseState(value: string) {
    setFilterState(value);
    setFilterCity("");
  }

  async function toggleFollowSearch() {
    if (guest) { guest.requireSignIn(); return; }
    if (savingSearch) return;
    setSavingSearch(true);
    if (followedSearch?.notifications_enabled) {
      const { error } = await removeSavedSearch(followedSearch.id);
      setSavingSearch(false);
      if (error) return toast.error(error.message || "Search could not be unfollowed");
      setFollowedSearches((current) =>
        current.filter((item) => item.id !== followedSearch.id),
      );
      toast.success("Search unfollowed");
      return;
    }
    const name = `${
      stayType === "short_let"
        ? "Short Let"
        : stayType === "long_stay"
          ? "Long Let"
          : "All homes"
    }${filterCity ? ` · ${filterCity}` : filterState ? ` · ${filterState}` : ""}`;
    const { error } = await followPropertySearch(
      name,
      "homes",
      currentSearchCriteria,
    );
    setSavingSearch(false);
    if (error) return toast.error(error.message || "Search could not be followed");
    const refreshed = await getMySavedSearches();
    if (!refreshed.error) setFollowedSearches(refreshed.searches);
    toast.success(
      followedSearch
        ? "Apartment alerts resumed"
        : "Search followed",
    );
  }

  const modeLabel =
    stayType === "short_let"
      ? "Short Let"
      : stayType === "long_stay"
        ? "Long Let"
        : "All homes";
  const locationSummary = filterCity
    ? `${filterCity}, ${filterState}`
    : filterState
      ? filterState
      : `${modeLabel} apartments`;
  const emptyTitle = priceActive
    ? `No ${modeLabel.toLowerCase()} apartments match this ${
        stayType === "short_let" ? "nightly" : "yearly"
      } price range`
    : stayType === "all"
      ? "No apartments match these filters"
      : `No ${modeLabel.toLowerCase()} apartments match these filters`;

  return (
    <DiscoveryShell active="homes" onNavigate={onNavigate}>
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        <DiscoveryToolbar
          value={query}
          onChange={value => setQuery(value.slice(0, 80))}
          placeholder="City, area or apartment"
          toolbarLabel={locationSummary}
          onFilters={() => setShowFilters(true)}
          filterCount={filterCount}
          locationLabel={location ? "Using current location" : "Use my location"}
          locationActive={Boolean(location)}
          locationBusy={locating}
          onLocation={requestLocation}
          onClearLocation={clearLocation}
          locationDetail={locationError || undefined}
        />
        {sponsoredHomes.length > 0 && <section aria-label="Sponsored homes" className="rounded-3xl border border-amber-300/15 bg-amber-300/[.04] p-4">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-amber-300">Sponsored homes</p>
          <p className="mb-3 text-xs text-muted-foreground">Paid placement among matching homes. WeHouse checks and organic order are separate.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sponsoredHomes.map(({ campaignId, entry: { listing, distance } }) => <div key={campaignId}>
              <span className="mb-2 inline-block rounded-full border border-amber-300/30 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-amber-300">Sponsored</span>
              <ListingCard listing={listing} distanceKm={distance} compactMobile
                onClick={() => { recordSponsoredOpen(campaignId); onNavigate('detail', listing.id); }}
                isSaved={savedIds.has(listing.id)}
                onToggleSave={event => { event.preventDefault(); event.stopPropagation(); onToggleSave(listing.id); }} />
            </div>)}
          </div>
        </section>}

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold">
              {loading
                ? "Loading apartments…"
                : `Showing ${filtered.length} ${filtered.length === 1 ? "apartment" : "apartments"}`}
            </p>
            <p className="mt-1 text-[9px] text-[#666D7E]">{modeLabel}</p>
          </div>
          <div className="flex items-center gap-3">
            {hasFilters ? (
              <button
                type="button"
                disabled={savingSearch}
                onClick={() => void toggleFollowSearch()}
                className={`rounded-full border px-3 py-2 text-[9px] font-semibold disabled:opacity-40 ${
                  followedSearch?.notifications_enabled
                    ? "border-emerald-500/25 text-emerald-300"
                    : "border-violet-500/20 text-violet-300"
                }`}
              >
                {savingSearch
                  ? "Updating…"
                  : followedSearch?.notifications_enabled
                    ? "Following"
                    : followedSearch
                      ? "Resume alerts"
                      : "Follow search"}
              </button>
            ) : null}
            {hasFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="text-[9px] font-semibold text-[#858A99]"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>

        {loadError && !listings.length ? (
          <section className="border-y border-red-500/15 px-5 py-12 text-center">
            <p className="text-sm font-semibold">Apartments could not be loaded</p>
            <p className="mt-2 text-[10px] text-[#777D8D]">{loadError}</p>
            <button
              type="button"
              onClick={() => setReload(value => value + 1)}
              className="mt-4 rounded-xl bg-violet-500 px-4 py-3 text-xs font-semibold"
            >
              Try again
            </button>
          </section>
        ) : loading && !listings.length ? (
          <div className="grid min-h-56 place-items-center">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <DiscoveryEmpty
            title={emptyTitle}
            text="Change the selected filters to see other apartments."
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map(({ listing, distance }) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                distanceKm={distance}
                compactMobile={filtered.length >= 3}
                onClick={() => onNavigate("detail", listing.id)}
                isSaved={savedIds.has(listing.id)}
                onToggleSave={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onToggleSave(listing.id);
                }}
              />
              ))}
            </div>
            {hasMore && <button type="button" disabled={loadingMore} onClick={() => void loadMore()}
              className="mx-auto mt-4 block min-h-11 rounded-xl border border-white/[.09] px-5 text-xs font-semibold text-violet-300 disabled:opacity-50">
              {loadingMore ? "Loading more…" : "Show more apartments"}
            </button>}
          </>
        )}
      </main>

      {showFilters ? (
        <DiscoveryFilterSheet
          title="Apartment filters"
          onClose={() => setShowFilters(false)}
          onClear={clearFilters}
          resultLabel={`Show ${filtered.length} ${filtered.length === 1 ? "apartment" : "apartments"}`}
        >
          <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-white/[.07] bg-[#151922] p-1.5">
            {(
              [
                ["all", "All"],
                ["long_stay", "Long Let"],
                ["short_let", "Short Let"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => chooseStay(value)}
                className={`rounded-xl px-2 py-2.5 text-[10px] font-semibold ${
                  stayType === value
                    ? "bg-violet-500 text-white"
                    : "text-[#7E8494]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <SearchableSelect
              label="State"
              value={filterState}
              onChange={chooseState}
              options={stateOptions}
              placeholder="Any State"
              searchPlaceholder="Search State"
            />
            <SearchableSelect
              label="LGA"
              value={filterCity}
              onChange={setFilterCity}
              options={cityOptions}
              placeholder={filterState ? "Any LGA" : "Choose State"}
              searchPlaceholder="Search LGA"
              disabled={!filterState}
            />
          </div>

          {stayType !== "all" ? (
            <DiscoveryPriceRangeSlider
              label={stayType === "short_let" ? "Price per night" : "Yearly rent"}
              floor={priceScale.floor}
              ceiling={priceScale.ceiling}
              step={priceScale.step}
              minValue={priceMin}
              maxValue={priceMax}
              onMinChange={setPriceMin}
              onMaxChange={setPriceMax}
            />
          ) : null}

          <section>
            <p className="mb-2 text-[10px] font-medium text-[#7B8190]">Bedrooms</p>
            <div className="grid grid-cols-5 gap-2">
              {(
                [
                  ["", "Any"],
                  ["1", "1+"],
                  ["2", "2+"],
                  ["3", "3+"],
                  ["4", "4+"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value || "any"}
                  type="button"
                  onClick={() => setBedrooms(value ? Number(value) : "")}
                  aria-pressed={String(bedrooms) === value}
                  className={`h-11 rounded-xl text-[10px] font-semibold ${
                    String(bedrooms) === value
                      ? "bg-violet-500 text-white"
                      : "border border-white/[.08] bg-[#151922] text-[#8A90A0]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="mb-2 text-[10px] font-medium text-[#7B8190]">Bathrooms</p>
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  ["", "Any"],
                  ["1", "1+"],
                  ["2", "2+"],
                  ["3", "3+"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value || "any"}
                  type="button"
                  onClick={() => setBathrooms(value ? Number(value) : "")}
                  aria-pressed={String(bathrooms) === value}
                  className={`h-11 rounded-xl text-[10px] font-semibold ${
                    String(bathrooms) === value
                      ? "bg-violet-500 text-white"
                      : "border border-white/[.08] bg-[#151922] text-[#8A90A0]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        </DiscoveryFilterSheet>
      ) : null}
    </DiscoveryShell>
  );
}
