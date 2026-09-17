import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type DiscoveryLocation = {
  lat: number;
  lng: number;
  accuracy: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  capturedAt: number;
};

const STORAGE_KEY = "wh_discovery_location_v2";
const EVENT_NAME = "wehouse:discovery-location";
let memoryLocation: DiscoveryLocation | null | undefined;

function normalizeStoredLocation(value: unknown): DiscoveryLocation | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<DiscoveryLocation>;
  if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return null;
  return {
    lat: Number(row.lat),
    lng: Number(row.lng),
    accuracy: Number.isFinite(row.accuracy) ? Number(row.accuracy) : null,
    address:
      typeof row.address === "string" && row.address.trim()
        ? row.address.trim()
        : null,
    city:
      typeof row.city === "string" && row.city.trim() ? row.city.trim() : null,
    state:
      typeof row.state === "string" && row.state.trim() ? row.state.trim() : null,
    capturedAt: Number.isFinite(row.capturedAt)
      ? Number(row.capturedAt)
      : Date.now(),
  };
}

function readLocation(): DiscoveryLocation | null {
  if (memoryLocation !== undefined) return memoryLocation;
  if (typeof window === "undefined") return null;
  try {
    memoryLocation = normalizeStoredLocation(
      JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null"),
    );
  } catch {
    memoryLocation = null;
  }
  return memoryLocation;
}

function publish(location: DiscoveryLocation | null) {
  memoryLocation = location;
  try {
    if (location) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(location));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: location }));
}

export function useDiscoveryLocation() {
  const [location, setLocation] = useState<DiscoveryLocation | null>(() =>
    readLocation(),
  );
  const [locating, setLocating] = useState(false);
  // Kept as `error` for the existing toolbar API. On a successful location
  // lookup it carries the human-readable address so every "Use my location"
  // surface shows text rather than coordinates.
  const [error, setError] = useState(() => readLocation()?.address || "");

  useEffect(() => {
    const sync = (event: Event) => {
      const next = (event as CustomEvent<DiscoveryLocation | null>).detail;
      setLocation(next);
      setError(next?.address || "");
    };
    window.addEventListener(EVENT_NAME, sync);
    return () => window.removeEventListener(EVENT_NAME, sync);
  }, []);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Current location is not available on this device.");
      return;
    }
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const base: DiscoveryLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy)
            ? position.coords.accuracy
            : null,
          address: null,
          city: null,
          state: null,
          capturedAt: Date.now(),
        };

        // Coordinates stay internal to the browser/server calculation path. The
        // human-facing result is the reverse-geocoded address text only.
        publish(base);
        setLocation(base);

        try {
          const result = await Promise.race([
            supabase.functions.invoke("reverse-geocode", {
              body: { latitude: base.lat, longitude: base.lng },
            }),
            new Promise<never>((_, reject) =>
              window.setTimeout(
                () => reject(new Error("Address lookup timed out")),
                8000,
              ),
            ),
          ]);
          if (!result.error && result.data?.address) {
            const resolved: DiscoveryLocation = {
              ...base,
              address: String(result.data.address).trim() || null,
              city: String(result.data.city || "").trim() || null,
              state: String(result.data.state || "").trim() || null,
            };
            publish(resolved);
            setLocation(resolved);
            setError(resolved.address || "Current location");
          } else {
            setError(
              "Location found, but the street address could not be identified. Distance still works.",
            );
          }
        } catch {
          setError(
            "Location found, but the street address could not be identified. Distance still works.",
          );
        } finally {
          setLocating(false);
        }
      },
      (reason) => {
        setLocating(false);
        setError(
          reason.code === reason.PERMISSION_DENIED
            ? "Allow location access to use your current location."
            : "Your location could not be found. Try again with device location enabled.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }, []);

  const clearLocation = useCallback(() => {
    publish(null);
    setLocation(null);
    setError("");
  }, []);

  return { location, locating, error, requestLocation, clearLocation };
}

export function distanceBetweenKm(
  origin: Pick<DiscoveryLocation, "lat" | "lng">,
  destination: { lat: number; lng: number },
) {
  const radius = 6371;
  const radians = (value: number) => (value * Math.PI) / 180;
  const latitude = radians(destination.lat - origin.lat);
  const longitude = radians(destination.lng - origin.lng);
  const value =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(origin.lat)) *
      Math.cos(radians(destination.lat)) *
      Math.sin(longitude / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export async function getDiscoveryDistanceMap(
  origin: Pick<DiscoveryLocation, "lat" | "lng"> | null,
) {
  const map = new Map<string, number>();
  if (!origin) return map;
  const { data, error } = await supabase.rpc("get_my_discovery_distances", {
    p_lat: origin.lat,
    p_lng: origin.lng,
  });
  if (error) return map;
  for (const row of Array.isArray(data) ? data : []) {
    const type = String(row?.subject_type || "");
    const id = String(row?.subject_id || "");
    const distance = Number(row?.distance_km);
    if (type && id && Number.isFinite(distance))
      map.set(`${type}:${id}`, distance);
  }
  return map;
}

export function directionsUrl(address: string) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}
