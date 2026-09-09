import { useCallback, useEffect, useState } from "react";

export type DiscoveryLocation = {
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: number;
};

const STORAGE_KEY = "wh_discovery_location_v1";
const EVENT_NAME = "wehouse:discovery-location";
let memoryLocation: DiscoveryLocation | null | undefined;

function readLocation(): DiscoveryLocation | null {
  if (memoryLocation !== undefined) return memoryLocation;
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null") as DiscoveryLocation | null;
    memoryLocation = parsed && Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng) ? parsed : null;
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
  const [location, setLocation] = useState<DiscoveryLocation | null>(() => readLocation());
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const sync = (event: Event) => setLocation((event as CustomEvent<DiscoveryLocation | null>).detail);
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
      (position) => {
        const next = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          capturedAt: Date.now(),
        };
        publish(next);
        setLocation(next);
        setLocating(false);
      },
      (reason) => {
        setLocating(false);
        setError(reason.code === reason.PERMISSION_DENIED
          ? "Allow location access to see distance from you."
          : "Your location could not be found. Try again outside or with device location enabled.");
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
  const value = Math.sin(latitude / 2) ** 2
    + Math.cos(radians(origin.lat)) * Math.cos(radians(destination.lat)) * Math.sin(longitude / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function directionsUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${latitude},${longitude}`)}&travelmode=driving`;
}
