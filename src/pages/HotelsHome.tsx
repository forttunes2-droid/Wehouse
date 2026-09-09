import { useEffect, useMemo, useState } from "react";
import { getHotels, supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { NIGERIA_STATES, getCitiesForState } from "@/data/nigeria-locations";
import { HOTEL_AMENITIES } from "@/types";
import type { Hotel } from "@/types";
import SearchableSelect from "@/components/SearchableSelect";
import DiscoveryPriceRangeSlider from "@/components/DiscoveryPriceRangeSlider";
import DiscoveryShell, {
  DiscoveryEmpty,
  DiscoveryFilterSheet,
  DiscoveryToolbar,
} from "@/components/DiscoveryShell";
import { distanceBetweenKm, useDiscoveryLocation } from "@/hooks/useDiscoveryLocation";

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
const HOTEL_PRICE_FLOOR = 1000;
const HOTEL_PRICE_CEILING = 1000000;
const HOTEL_PRICE_STEP = 1000;
function normalize(v: unknown) {
  return String(v || "")
    .trim()
    .toLowerCase();
}
function coords(h: HotelRow) {
  const lat = Number(h.gps_latitude),
    lng = Number(h.gps_longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export default function HotelsHome({ onNavigate }: Props) {
  const [hotels, setHotels] = useState<HotelRow[]>([]),
    [loading, setLoading] = useState(true),
    [query, setQuery] = useState(""),
    [state, setState] = useState(""),
    [city, setCity] = useState(""),
    [amenities, setAmenities] = useState<string[]>([]),
    [minPrice, setMinPrice] = useState<number | "">(""),
    [maxPrice, setMaxPrice] = useState<number | "">(""),
    [filtersOpen, setFiltersOpen] = useState(false),
    [radius, setRadius] = useState<number | "">(""),
    [savingSearch, setSavingSearch] = useState(false);
  const { location: userLocation, locating, error: locationError, requestLocation, clearLocation } = useDiscoveryLocation();
  useEffect(() => {
    let live = true;
    void (async () => {
      const { hotels: rows } = await getHotels();
      if (live) {
        setHotels((rows || []) as HotelRow[]);
        setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  const cities = useMemo(() => getCitiesForState(state), [state]);
  const stateOptions = useMemo(
    () =>
      NIGERIA_STATES.map((item) => ({ value: item.state, label: item.state })),
    [],
  );
  const cityOptions = useMemo(
    () => cities.map((item) => ({ value: item, label: item })),
    [cities],
  );
  const priceScale = useMemo(() => {
    const prices = hotels
      .flatMap((hotel) =>
        (hotel.hotel_rooms || []).map((room) =>
          Number(room.price_per_night || 0),
        ),
      )
      .filter((price) => Number.isFinite(price) && price > 0);
    if (!prices.length)
      return { floor: HOTEL_PRICE_FLOOR, ceiling: HOTEL_PRICE_CEILING };
    const observedMin = Math.min(...prices),
      observedMax = Math.max(...prices);
    return {
      floor: Math.min(
        HOTEL_PRICE_FLOOR,
        Math.max(
          HOTEL_PRICE_STEP,
          Math.floor(observedMin / HOTEL_PRICE_STEP) * HOTEL_PRICE_STEP,
        ),
      ),
      ceiling: Math.max(
        HOTEL_PRICE_CEILING,
        Math.ceil(observedMax / HOTEL_PRICE_STEP) * HOTEL_PRICE_STEP,
      ),
    };
  }, [hotels]);
  const filtered = useMemo(
    () =>
      hotels
        .map((hotel) => {
          const c = coords(hotel);
          return {
            hotel,
            distance: userLocation && c ? distanceBetweenKm(userLocation, c) : null,
          };
        })
        .filter(({ hotel, distance }) => {
          const needle = normalize(query),
            hay = normalize(hotel.name);
          if (needle && !hay.includes(needle)) return false;
          if (state && normalize(hotel.state) !== normalize(state))
            return false;
          if (city && normalize(hotel.city) !== normalize(city)) return false;
          if (
            amenities.length &&
            !amenities.every((item) => hotel.amenities?.includes(item))
          )
            return false;
          if (minPrice !== "" || maxPrice !== "") {
            const prices = (hotel.hotel_rooms || [])
              .map((room) => Number(room.price_per_night || 0))
              .filter((price) => price > 0);
            if (!prices.length) return false;
            const matches = prices.some(
              (price) =>
                (minPrice === "" || price >= minPrice) &&
                (maxPrice === "" || price <= maxPrice),
            );
            if (!matches) return false;
          }
          if (radius && (distance == null || distance > radius)) return false;
          return true;
        })
        .sort((a, b) =>
          userLocation
            ? (a.distance ?? Infinity) - (b.distance ?? Infinity)
            : Number(Boolean(b.hotel.featured)) -
              Number(Boolean(a.hotel.featured)),
        ),
    [
      hotels,
      query,
      state,
      city,
      amenities,
      minPrice,
      maxPrice,
      userLocation,
      radius,
    ],
  );
  const priceActive = minPrice !== "" || maxPrice !== "";
  const filterCount =
    [state, city, radius].filter(Boolean).length +
    amenities.length +
    (priceActive ? 1 : 0);
  function clearFilters() {
    setQuery("");
    setState("");
    setCity("");
    setAmenities([]);
    setMinPrice("");
    setMaxPrice("");
    setRadius("");
  }
  function clearStructuredFilters() {
    setState("");
    setCity("");
    setAmenities([]);
    setMinPrice("");
    setMaxPrice("");
    setRadius("");
  }
  function chooseState(value: string) {
    setState(value);
    setCity("");
  }
  async function followSearch() {
    setSavingSearch(true);
    const name = `Hotels${city ? ` · ${city}` : state ? ` · ${state}` : ""}`;
    const { error } = await supabase.rpc("save_my_property_search", {
      p_name: name,
      p_search_kind: "hotels",
      p_criteria: {
        state,
        city,
        min_price: minPrice === "" ? null : minPrice,
        max_price: maxPrice === "" ? null : maxPrice,
        amenities,
      },
    });
    setSavingSearch(false);
    if (error)
      return toast.error(error.message || "Search could not be followed");
    toast.success(
      "Search followed. New matching hotels will appear in Inbox Activity.",
    );
  }
  function toggleAmenity(item: string) {
    setAmenities((current) =>
      current.includes(item)
        ? current.filter((value) => value !== item)
        : [...current, item],
    );
  }
  return (
    <DiscoveryShell
      active="hotels"
      onNavigate={onNavigate}
    >
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        <DiscoveryToolbar
          value={query}
          onChange={setQuery}
          placeholder="Search hotel name"
          onFilters={() => setFiltersOpen(true)}
          filterCount={filterCount}
          locationDetail={locationError || undefined}
          locationLabel={userLocation ? "Location on" : "Use my location"}
          locationActive={Boolean(userLocation)}
          locationBusy={locating}
          onLocation={requestLocation}
          onClearLocation={clearLocation}
        />
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold">
              {loading
                ? "Loading hotels…"
                : `${filtered.length} ${filtered.length === 1 ? "hotel" : "hotels"}`}
            </p>
            <p className="mt-1 text-[9px] text-[#666D7E]">
              {city ? `${city}, ${state}` : state || "All locations"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {Boolean(filterCount) && (
              <button
                type="button"
                disabled={savingSearch}
                onClick={() => void followSearch()}
                className="rounded-full border border-violet-500/20 px-3 py-2 text-[9px] font-semibold text-violet-300 disabled:opacity-40"
              >
                {savingSearch ? "Saving…" : "Follow search"}
              </button>
            )}
            {(query || filterCount) && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-[9px] font-semibold text-violet-300"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {loading ? (
          <div className="grid min-h-56 place-items-center">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <DiscoveryEmpty
            title={
              priceActive
                ? "No hotels match this nightly price range"
                : "No hotels match these filters"
            }
            text="Change the selected filters to see other hotels."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(({ hotel, distance }) => (
              <HotelCard
                key={hotel.hotel_id}
                hotel={hotel}
                distance={distance}
                onOpen={() =>
                  onNavigate("hotel_detail", String(hotel.hotel_id))
                }
              />
            ))}
          </div>
        )}
      </main>
      {filtersOpen && (
        <DiscoveryFilterSheet
          title="Find a hotel"
          onClose={() => setFiltersOpen(false)}
          onClear={clearStructuredFilters}
        >
          <div className="grid grid-cols-2 gap-3">
            <SearchableSelect
              label="State"
              value={state}
              onChange={chooseState}
              options={stateOptions}
              placeholder="Any State"
              searchPlaceholder="Search State"
            />
            <SearchableSelect
              label="LGA"
              value={city}
              onChange={setCity}
              options={cityOptions}
              placeholder={state ? "Any LGA" : "Choose State"}
              searchPlaceholder="Search LGA"
              disabled={!state}
            />
          </div>
          <DiscoveryPriceRangeSlider
            label="Nightly price"
            floor={priceScale.floor}
            ceiling={priceScale.ceiling}
            step={HOTEL_PRICE_STEP}
            minValue={minPrice}
            maxValue={maxPrice}
            onMinChange={setMinPrice}
            onMaxChange={setMaxPrice}
          />
          <div>
            <p className="mb-2 text-[10px] font-medium text-[#7B8190]">
              Amenities
            </p>
            <div className="flex flex-wrap gap-2">
              {HOTEL_AMENITIES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => toggleAmenity(item)}
                  className={`min-h-9 rounded-full border px-3.5 py-2 text-[9px] font-semibold leading-tight ${amenities.includes(item) ? "border-violet-500/30 bg-violet-500/14 text-violet-100" : "border-white/[.07] bg-white/[.025] text-[#858B9A]"}`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          {userLocation && (
            <section>
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
            </section>
          )}
        </DiscoveryFilterSheet>
      )}
    </DiscoveryShell>
  );
}

function HotelCard({
  hotel,
  distance,
  onOpen,
}: {
  hotel: HotelRow;
  distance: number | null;
  onOpen: () => void;
}) {
  const prices = (hotel.hotel_rooms || [])
      .map((room) => Number(room.price_per_night || 0))
      .filter(Boolean),
    minPrice = prices.length ? Math.min(...prices) : 0,
    image = hotel.images?.[0];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group w-full border-b border-white/[.07] pb-5 text-left"
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[#171B24]">
        {image ? (
          <img
            src={image}
            alt={hotel.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="grid h-full place-items-center text-[10px] text-[#5F6676]">
            No image yet
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        {hotel.featured && (
          <span className="absolute left-3 top-3 rounded-full bg-violet-500 px-2.5 py-1 text-[7px] font-bold">
            FEATURED
          </span>
        )}
        {distance != null && (
          <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[8px] font-semibold text-white">
            {distance < 1
              ? `${Math.round(distance * 1000)} m`
              : `${distance.toFixed(1)} km`}
          </span>
        )}
      </div>
      <div className="min-w-0 px-1 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="line-clamp-2 text-[15px] font-bold">{hotel.name}</h2>
            <p className="mt-1 truncate text-[9px] text-[#6F7585]">
              {[hotel.area, hotel.city, hotel.state].filter(Boolean).join(", ")}
            </p>
          </div>
          {Number(hotel.rating || 0) > 0 && (
            <span className="shrink-0 text-[9px] font-semibold text-amber-300">
              ★ {Number(hotel.rating).toFixed(1)}
            </span>
          )}
        </div>
        {minPrice > 0 && (
          <p className="mt-3 text-sm font-bold">
            ₦{minPrice.toLocaleString()} <span className="text-[8px] font-medium text-[#747A89]">/ night</span>
          </p>
        )}
        {hotel.amenities?.length > 0 && (
          <div className="mt-2 flex gap-1.5 overflow-hidden">
            {hotel.amenities.slice(0, 3).map((item) => (
              <span
                key={item}
                className="rounded-lg border border-white/[.06] px-2 py-1 text-[8px] text-[#858B9A]"
              >
                {item}
              </span>
            ))}
            {hotel.amenities.length > 3 && <span className="shrink-0 rounded-lg border border-violet-500/15 bg-violet-500/[.06] px-2 py-1 text-[8px] text-violet-300">+{hotel.amenities.length - 3}</span>}
          </div>
        )}
      </div>
    </button>
  );
}
