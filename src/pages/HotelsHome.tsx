import { useEffect, useMemo, useState } from "react";
import { getHotels } from "@/lib/supabase";
import { toast } from "sonner";
import { NIGERIA_STATES, getCitiesForState } from "@/data/nigeria-locations";
import { HOTEL_AMENITIES } from "@/types";
import type { Hotel } from "@/types";
import SearchableSelect from "@/components/SearchableSelect";
import DiscoveryShell, {
  DiscoveryEmpty,
  DiscoveryFilterSheet,
  DiscoveryToolbar,
} from "@/components/DiscoveryShell";
import {
  distanceBetweenKm,
  useDiscoveryLocation,
} from "@/hooks/useDiscoveryLocation";
import {
  followPropertySearch,
  getMySavedSearches,
  removeSavedSearch,
  savedSearchKey,
  type SavedSearch,
} from "@/lib/supabase/saved-searches";
import {
  getMySavedHotelIds,
  saveHotel,
  unsaveHotel,
} from "@/lib/supabase/saved-hotels";

type HotelRoomPreview = {
  room_id: number;
  price_per_night: number;
  room_type: string;
};
type HotelRow = Hotel & {
  hotel_rooms: HotelRoomPreview[];
  gps_latitude?: number | null;
  gps_longitude?: number | null;
};
type Props = { onNavigate: (page: string, id?: string) => void };

function normalize(v: unknown) {
  return String(v || "").trim().toLowerCase();
}
function coords(h: HotelRow) {
  const lat = Number(h.gps_latitude), lng = Number(h.gps_longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export default function HotelsHome({ onNavigate }: Props) {
  const [hotels, setHotels] = useState<HotelRow[]>([]),
    [loading, setLoading] = useState(true),
    [query, setQuery] = useState(""),
    [state, setState] = useState(""),
    [city, setCity] = useState(""),
    [amenities, setAmenities] = useState<string[]>([]),
    [filtersOpen, setFiltersOpen] = useState(false),
    [radius, setRadius] = useState<number | "">(""),
    [savingSearch, setSavingSearch] = useState(false),
    [followedSearches, setFollowedSearches] = useState<SavedSearch[]>([]),
    [savedHotelIds, setSavedHotelIds] = useState<Set<number>>(new Set()),
    [savingHotelId, setSavingHotelId] = useState<number | null>(null);
  const {
    location: userLocation,
    locating,
    error: locationError,
    requestLocation,
    clearLocation,
  } = useDiscoveryLocation();

  useEffect(() => {
    let live = true;
    void (async () => {
      const [{ hotels: rows }, followed, saved] = await Promise.all([
        getHotels(),
        getMySavedSearches(),
        getMySavedHotelIds(),
      ]);
      if (!live) return;
      setHotels((rows || []) as HotelRow[]);
      if (!followed.error) setFollowedSearches(followed.searches);
      if (!saved.error) setSavedHotelIds(new Set(saved.hotelIds));
      setLoading(false);
    })();
    return () => { live = false; };
  }, []);

  const cities = useMemo(() => getCitiesForState(state), [state]);
  const stateOptions = useMemo(
    () => NIGERIA_STATES.map((item) => ({ value: item.state, label: item.state })),
    [],
  );
  const cityOptions = useMemo(
    () => cities.map((item) => ({ value: item, label: item })),
    [cities],
  );

  const filtered = useMemo(
    () => hotels
      .map((hotel) => {
        const c = coords(hotel);
        return { hotel, distance: userLocation && c ? distanceBetweenKm(userLocation, c) : null };
      })
      .filter(({ hotel, distance }) => {
        const needle = normalize(query);
        if (needle && !normalize(hotel.name).includes(needle)) return false;
        if (state && normalize(hotel.state) !== normalize(state)) return false;
        if (city && normalize(hotel.city) !== normalize(city)) return false;
        if (amenities.length && !amenities.every((item) => hotel.amenities?.includes(item))) return false;
        if (radius && (distance == null || distance > radius)) return false;
        return true;
      })
      .sort((a, b) => userLocation
        ? (a.distance ?? Infinity) - (b.distance ?? Infinity)
        : Number(Boolean(b.hotel.featured)) - Number(Boolean(a.hotel.featured))),
    [hotels, query, state, city, amenities, userLocation, radius],
  );

  const filterCount = [state, city, radius].filter(Boolean).length + amenities.length;
  const currentSearchCriteria = useMemo(() => ({
    query: query.trim(),
    state,
    city,
    amenities,
    radius_km: radius === "" ? null : radius,
    latitude: radius === "" ? null : userLocation?.lat,
    longitude: radius === "" ? null : userLocation?.lng,
  }), [amenities, city, query, radius, state, userLocation?.lat, userLocation?.lng]);
  const currentSearchKey = savedSearchKey("hotels", currentSearchCriteria);
  const followedSearch = followedSearches.find((item) => savedSearchKey(item.search_kind, item.criteria || {}) === currentSearchKey);

  function clearFilters() {
    setQuery(""); setState(""); setCity(""); setAmenities([]); setRadius("");
  }
  function clearStructuredFilters() {
    setState(""); setCity(""); setAmenities([]); setRadius("");
  }
  function chooseState(value: string) {
    setState(value); setCity("");
  }
  async function toggleFollowSearch() {
    if (savingSearch) return;
    setSavingSearch(true);
    if (followedSearch?.notifications_enabled) {
      const { error } = await removeSavedSearch(followedSearch.id);
      setSavingSearch(false);
      if (error) return toast.error(error.message || "Search could not be unfollowed");
      setFollowedSearches((current) => current.filter((item) => item.id !== followedSearch.id));
      return toast.success("Search unfollowed. New matches will no longer create Activity updates.");
    }
    const name = `${query.trim() ? `Hotels matching “${query.trim()}”` : "Hotels"}${city ? ` · ${city}` : state ? ` · ${state}` : ""}`;
    const { error } = await followPropertySearch(name, "hotels", currentSearchCriteria);
    setSavingSearch(false);
    if (error) return toast.error(error.message || "Search could not be followed");
    const refreshed = await getMySavedSearches();
    if (!refreshed.error) setFollowedSearches(refreshed.searches);
    toast.success(followedSearch ? "Hotel alerts resumed" : "Search followed. New matches will appear in Inbox Activity.");
  }
  async function toggleHotelSave(hotelId: number) {
    if (savingHotelId) return;
    const saved = savedHotelIds.has(hotelId);
    setSavingHotelId(hotelId);
    const { error } = saved ? await unsaveHotel(hotelId) : await saveHotel(hotelId);
    setSavingHotelId(null);
    if (error) return toast.error(error.message || "Saved hotels could not be updated");
    setSavedHotelIds((current) => {
      const next = new Set(current);
      if (saved) next.delete(hotelId); else next.add(hotelId);
      return next;
    });
    toast.success(saved ? "Hotel removed from Saved" : "Hotel saved");
  }
  function toggleAmenity(item: string) {
    setAmenities((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item]);
  }

  return (
    <DiscoveryShell active="hotels" onNavigate={onNavigate}>
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        <DiscoveryToolbar
          value={query}
          onChange={setQuery}
          placeholder="Search hotel name"
          onFilters={() => setFiltersOpen(true)}
          filterCount={filterCount}
          locationDetail={locationError || undefined}
          locationLabel={userLocation ? "Using current location" : "Use my location"}
          locationActive={Boolean(userLocation)}
          locationBusy={locating}
          onLocation={requestLocation}
          onClearLocation={clearLocation}
        />
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold">{loading ? "Loading hotels…" : `${filtered.length} ${filtered.length === 1 ? "hotel" : "hotels"}`}</p>
            <p className="mt-1 text-[9px] text-[#666D7E]">{city ? `${city}, ${state}` : state || "All locations"}</p>
          </div>
          <div className="flex items-center gap-3">
            {Boolean(query || filterCount) && (
              <button type="button" disabled={savingSearch} onClick={() => void toggleFollowSearch()} className={`rounded-full border px-3 py-2 text-[9px] font-semibold disabled:opacity-40 ${followedSearch?.notifications_enabled ? "border-emerald-500/25 text-emerald-300" : "border-violet-500/20 text-violet-300"}`}>
                {savingSearch ? "Updating…" : followedSearch?.notifications_enabled ? "Following" : followedSearch ? "Resume alerts" : "Follow search"}
              </button>
            )}
            {Boolean(query || filterCount) && <button type="button" onClick={clearFilters} className="text-[9px] font-semibold text-violet-300">Clear</button>}
          </div>
        </div>
        {loading ? (
          <div className="grid min-h-56 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>
        ) : filtered.length === 0 ? (
          <DiscoveryEmpty title="No hotels match these filters" text="Change the selected filters to see other hotels." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(({ hotel, distance }) => (
              <HotelCard
                key={hotel.hotel_id}
                hotel={hotel}
                distance={distance}
                saved={savedHotelIds.has(Number(hotel.hotel_id))}
                saving={savingHotelId === Number(hotel.hotel_id)}
                onToggleSave={() => void toggleHotelSave(Number(hotel.hotel_id))}
                onOpen={() => onNavigate("hotel_detail", String(hotel.hotel_id))}
              />
            ))}
          </div>
        )}
      </main>

      {filtersOpen && (
        <DiscoveryFilterSheet title="Find a hotel" onClose={() => setFiltersOpen(false)} onClear={clearStructuredFilters}>
          <div className="grid grid-cols-2 gap-3">
            <SearchableSelect label="State" value={state} onChange={chooseState} options={stateOptions} placeholder="Any State" searchPlaceholder="Search State" />
            <SearchableSelect label="LGA" value={city} onChange={setCity} options={cityOptions} placeholder={state ? "Any LGA" : "Choose State"} searchPlaceholder="Search LGA" disabled={!state} />
          </div>
          <div>
            <p className="mb-2 text-[10px] font-medium text-[#7B8190]">Amenities</p>
            <div className="flex flex-wrap gap-2">
              {HOTEL_AMENITIES.map((item) => (
                <button key={item} type="button" onClick={() => toggleAmenity(item)} className={`min-h-9 rounded-full border px-3.5 py-2 text-[9px] font-semibold leading-tight ${amenities.includes(item) ? "border-violet-500/30 bg-violet-500/14 text-violet-100" : "border-white/[.07] bg-white/[.025] text-[#858B9A]"}`}>{item}</button>
              ))}
            </div>
          </div>
          {userLocation && (
            <SearchableSelect
              label="Distance from your current location"
              value={radius === "" ? "" : String(radius)}
              onChange={(value) => setRadius(value ? Number(value) : "")}
              options={[
                { value: "", label: "Any distance" },
                { value: "2", label: "Within 2 km" },
                { value: "5", label: "Within 5 km" },
                { value: "10", label: "Within 10 km" },
                { value: "20", label: "Within 20 km" },
              ]}
              placeholder="Any distance"
              searchPlaceholder="Search distance"
            />
          )}
        </DiscoveryFilterSheet>
      )}
    </DiscoveryShell>
  );
}

function HotelCard({ hotel, distance, saved, saving, onOpen, onToggleSave }: {
  hotel: HotelRow;
  distance: number | null;
  saved: boolean;
  saving: boolean;
  onOpen: () => void;
  onToggleSave: () => void;
}) {
  const image = hotel.images?.[0];
  return (
    <article className="group border-b border-white/[.07] pb-5">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[#171B24]">
        <button type="button" onClick={onOpen} className="block h-full w-full text-left">
          {image ? <img src={image} alt={hotel.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" loading="lazy" /> : <div className="grid h-full place-items-center text-[10px] text-[#5F6676]">No image yet</div>}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          {hotel.featured && <span className="absolute left-3 top-3 rounded-full bg-violet-500 px-2.5 py-1 text-[7px] font-bold">FEATURED</span>}
          {distance != null && <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-2.5 py-1 text-[8px] font-semibold text-white">{distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`}</span>}
        </button>
        <button type="button" disabled={saving} onClick={onToggleSave} aria-label={saved ? `Remove ${hotel.name} from Saved` : `Save ${hotel.name}`} aria-pressed={saved} className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur disabled:opacity-50">
          <Heart filled={saved} />
        </button>
      </div>
      <button type="button" onClick={onOpen} className="block w-full px-1 pt-3 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h2 className="line-clamp-2 text-[15px] font-bold">{hotel.name}</h2><p className="mt-1 truncate text-[9px] text-[#6F7585]">{[hotel.area, hotel.city, hotel.state].filter(Boolean).join(", ")}</p></div>
          {Number(hotel.rating || 0) > 0 && <span className="shrink-0 text-[9px] font-semibold text-amber-300">★ {Number(hotel.rating).toFixed(1)}</span>}
        </div>
        <p className="mt-2 text-[8px] text-[#858B9A]">Choose a room, package and dates to see the price.</p>
        {hotel.amenities?.length > 0 && <p className="mt-2 text-[8px] text-[#858B9A]">{hotel.amenities.length} {hotel.amenities.length === 1 ? "amenity" : "amenities"}</p>}
      </button>
    </article>
  );
}

function Heart({ filled }: { filled: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "#A78BFA" : "none"} stroke={filled ? "#A78BFA" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z" /></svg>;
}
