import { useCallback, useEffect, useMemo, useState } from "react";
import { NIGERIA_STATES, getCitiesForState } from "@/data/nigeria-locations";
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
  type HomeStayType,
} from "@/lib/housing-discovery";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";
import type { Listing } from "@/types";
import { toast } from "sonner";
import {
  followPropertySearch,
  getMySavedSearches,
  removeSavedSearch,
  savedSearchKey,
  type SavedSearch,
} from "@/lib/supabase/saved-searches";
import {
  distanceBetweenKm,
  useDiscoveryLocation,
} from "@/hooks/useDiscoveryLocation";

type SearchProps = {
  onNavigate: (page: string, listingId?: string) => void;
  savedIds: Set<string>;
  onToggleSave: (listingId: string) => void;
};

const LONG_FLOOR = 180000;
const LONG_CEILING = 5000000;
const SHORT_FLOOR = 5000;
const SHORT_CEILING = 500000;
let propertyCache: Listing[] | null = null;
type StayFilter = HomeStayType | "all";
type PropertySearchState = {
  stayType: StayFilter;
  priceMin: number | "";
  priceMax: number | "";
  bedrooms: number | "";
  bathrooms: number | "";
  filterState: string;
  filterCity: string;
};
let searchState: PropertySearchState = {
  stayType: "all",
  priceMin: "",
  priceMax: "",
  bedrooms: "",
  bathrooms: "",
  filterState: "",
  filterCity: "",
};

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export default function Search({
  onNavigate,
  savedIds,
  onToggleSave,
}: SearchProps) {
  const { getNumber } = usePlatformSettings();
  const [listings, setListings] = useState<Listing[]>(() => propertyCache || []);
  const [loading, setLoading] = useState(() => !propertyCache);
  const [loadError, setLoadError] = useState("");
  const [stayType, setStayType] = useState<StayFilter>(() => searchState.stayType);
  const [priceMin, setPriceMin] = useState<number | "">(() => searchState.priceMin);
  const [priceMax, setPriceMax] = useState<number | "">(() => searchState.priceMax);
  const [bedrooms, setBedrooms] = useState<number | "">(() => searchState.bedrooms);
  const [bathrooms, setBathrooms] = useState<number | "">(() => searchState.bathrooms);
  const [filterState, setFilterState] = useState(() => searchState.filterState);
  const [filterCity, setFilterCity] = useState(() => searchState.filterCity);
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

  useEffect(() => {
    const saved = sessionStorage.getItem("search_property_type");
    if (saved === "short_let" || saved === "long_stay") setStayType(saved);
    sessionStorage.removeItem("search_property_type");
  }, []);

  useEffect(() => {
    void getMySavedSearches().then(({ searches }) => setFollowedSearches(searches));
  }, []);

  useEffect(() => {
    searchState = {
      stayType,
      priceMin,
      priceMax,
      bedrooms,
      bathrooms,
      filterState,
      filterCity,
    };
  }, [stayType, priceMin, priceMax, bedrooms, bathrooms, filterState, filterCity]);

  const loadProperties = useCallback(async (quiet = false) => {
    if (!quiet && !propertyCache) setLoading(true);
    setLoadError("");
    const { homes, error } = await getDiscoverableHomes();
    if (error) {
      setLoadError("Apartments could not be loaded. Check your connection and try again.");
    } else {
      propertyCache = homes || [];
      setListings(propertyCache);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let live = true;
    void getDiscoverableHomes().then(({ homes, error }) => {
      if (!live) return;
      if (error) {
        setLoadError("Apartments could not be loaded. Check your connection and try again.");
      } else {
        propertyCache = homes || [];
        setListings(propertyCache);
      }
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

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
        .map((listing) => {
          const lat = Number(listing.gps_latitude);
          const lng = Number(listing.gps_longitude);
          const distance =
            location && Number.isFinite(lat) && Number.isFinite(lng)
              ? distanceBetweenKm(location, { lat, lng })
              : null;
          return { listing, distance };
        })
        .filter(({ listing }) => {
          if (stayType !== "all" && listing.sub_type !== stayType) return false;
          const price = Number(listing.price || 0);
          if (priceMin !== "" && (price <= 0 || price < priceMin)) return false;
          if (priceMax !== "" && (price <= 0 || price > priceMax)) return false;
          if (bedrooms && Number(listing.bedrooms || 0) < bedrooms) return false;
          if (bathrooms && Number(listing.bathrooms || 0) < bathrooms) return false;
          if (filterState && normalize(listing.state) !== normalize(filterState)) return false;
          if (filterCity && normalize(listing.city) !== normalize(filterCity)) return false;
          return true;
        })
        .sort((a, b) =>
          location ? (a.distance ?? Infinity) - (b.distance ?? Infinity) : 0,
        ),
    [
      listings,
      stayType,
      priceMin,
      priceMax,
      bedrooms,
      bathrooms,
      filterState,
      filterCity,
      location,
    ],
  );

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
    if (savingSearch) return;
    setSavingSearch(true);
    if (followedSearch?.notifications_enabled) {
      const { error } = await removeSavedSearch(followedSearch.id);
      setSavingSearch(false);
      if (error) return toast.error(error.message || "Search could not be unfollowed");
      setFollowedSearches((current) =>
        current.filter((item) => item.id !== followedSearch.id),
      );
      toast.success("Search unfollowed. New matches will no longer create Activity updates.");
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
        : "Search followed. New matches will appear in Inbox Activity.",
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
          showSearch={false}
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

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold">
              {loading
                ? "Loading apartments…"
                : `${filtered.length} ${filtered.length === 1 ? "apartment" : "apartments"}`}
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
              onClick={() => void loadProperties()}
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map(({ listing, distance }) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                distanceKm={distance}
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
