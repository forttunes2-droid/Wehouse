import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type Point = { latitude: number; longitude: number };
type Props = {
  latitude: number;
  longitude: number;
  label?: string;
  height?: number;
  approximate?: boolean;
  /** Finds the viewer only to calculate an approximate distance. It never draws a route. */
  showDirections?: boolean;
  editable?: boolean;
  onPositionChange?: (point: Point) => void;
};

export default function LocationMap({
  latitude,
  longitude,
  label = "Property area",
  height = 220,
  approximate = false,
  showDirections = false,
  editable = false,
  onPositionChange,
}: Props) {
  const target = useMemo(
    () =>
      approximate
        ? {
            latitude: Math.round(latitude * 100) / 100,
            longitude: Math.round(longitude * 100) / 100,
          }
        : { latitude, longitude },
    [approximate, latitude, longitude],
  );
  const [user, setUser] = useState<Point | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [mapError, setMapError] = useState(false);
  const host = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const positionChangeRef = useRef(onPositionChange);
  const distance = user
    ? distanceKm(
        user.latitude,
        user.longitude,
        target.latitude,
        target.longitude,
      )
    : null;

  useEffect(() => {
    positionChangeRef.current = onPositionChange;
  }, [onPositionChange]);

  useEffect(() => {
    if (!host.current || mapRef.current) return;
    const map = L.map(host.current, { zoomControl: false });
    mapRef.current = map;
    L.control.zoom({ position: "bottomright" }).addTo(map);
    const tiles = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 19,
        subdomains: "abcd",
        attribution: "© OpenStreetMap · © CARTO",
      },
    );
    tiles.on("tileerror", () => setMapError(true));
    tiles.on("load", () => setMapError(false));
    tiles.addTo(map);
    layersRef.current = L.layerGroup().addTo(map);
    map.setView([target.latitude, target.longitude], approximate ? 13 : 17);
    if (editable)
      map.on("click", (event) =>
        positionChangeRef.current?.({
          latitude: event.latlng.lat,
          longitude: event.latlng.lng,
        }),
      );
    window.setTimeout(() => map.invalidateSize(), 100);
    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = layersRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    if (approximate) {
      L.circle([target.latitude, target.longitude], {
        radius: 1400,
        color: "#A78BFA",
        weight: 1,
        fillColor: "#8B5CF6",
        fillOpacity: 0.12,
      })
        .bindTooltip("Approximate property area")
        .addTo(layer);
    } else {
      L.circleMarker([target.latitude, target.longitude], {
        radius: 10,
        color: "#DDD6FE",
        weight: 3,
        fillColor: "#7C3AED",
        fillOpacity: 0.95,
      })
        .bindTooltip(editable ? "Saved entrance" : "Confirmed destination")
        .addTo(layer);
    }
    if (user) {
      L.circleMarker([user.latitude, user.longitude], {
        radius: 8,
        color: "#fff",
        weight: 3,
        fillColor: "#22C55E",
        fillOpacity: 1,
      })
        .bindTooltip("You")
        .addTo(layer);
      map.fitBounds(
        [
          [user.latitude, user.longitude],
          [target.latitude, target.longitude],
        ],
        { padding: [35, 35], maxZoom: approximate ? 13 : 15 },
      );
    } else {
      map.setView([target.latitude, target.longitude], approximate ? 13 : 17);
    }
  }, [approximate, editable, target.latitude, target.longitude, user]);

  function locate() {
    if (!navigator.geolocation) {
      setLocationError(
        "This browser cannot share your location. Open WeHouse in Chrome or Safari with Location enabled.",
      );
      return;
    }
    setLocating(true);
    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUser({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocating(false);
      },
      (error) => {
        setLocating(false);
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? "Location is off for WeHouse. Allow location in the site controls, then try again."
            : error.code === error.TIMEOUT
              ? "We could not get your location in time. Turn on Location, then try again."
              : "Your location could not be read. Turn on Location, then try again.",
        );
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 },
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#10131B]">
      <div className="relative">
        <div ref={host} style={{ height }} className="w-full" role="img" aria-label={label} />
        {editable && (
          <p className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/75 px-3 py-2 text-[9px] font-semibold text-white shadow-lg">
            Tap the real entrance to adjust the saved pin
          </p>
        )}
        {mapError && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-xl bg-[#10131B]/95 px-3 py-2 text-[9px] text-amber-200 shadow-lg" role="status">
            Map tiles are temporarily unavailable. The saved location is still available.
          </div>
        )}
      </div>
      <div className="space-y-3 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold text-white">{label}</p>
            <p className="mt-1 text-[9px] text-[#6D7182]">
              {editable
                ? "Choose the exact entrance, then confirm below"
                : approximate
                  ? "Approximate area only; no route or exact pin is shown"
                  : "Exact destination unlocked for this confirmed stay"}
              {distance !== null
                ? ` · about ${distance < 1 ? `${Math.max(1, Math.round(distance * 1000))} m` : `${distance.toFixed(1)} km`} away`
                : ""}
            </p>
          </div>
          {showDirections && (
            <button
              type="button"
              onClick={locate}
              disabled={locating}
              className="shrink-0 rounded-lg border border-violet-500/20 px-3 py-2 text-[9px] font-semibold text-violet-300 disabled:opacity-50"
            >
              {locating ? "Finding you…" : user ? "Refresh distance" : "Estimate distance"}
            </button>
          )}
        </div>
        {user && (
          <p className="text-[9px] text-[#8D93A3]">
            <span className="text-emerald-300">● You</span> ·{" "}
            <span className="text-violet-300">● {approximate ? "Property area" : "Destination"}</span> · straight-line estimate, not road navigation
          </p>
        )}
        {locationError && (
          <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-[9px] leading-5 text-amber-200" role="alert">
            {locationError}
          </p>
        )}
      </div>
    </div>
  );
}

export function distanceKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
) {
  const radius = 6371;
  const radians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = radians(bLat - aLat);
  const longitudeDelta = radians(bLon - aLon);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(aLat)) *
      Math.cos(radians(bLat)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
