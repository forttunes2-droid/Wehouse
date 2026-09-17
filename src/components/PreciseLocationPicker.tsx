import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

export type PreciseLocation = {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  address: string;
  city?: string;
  state?: string;
};

type Props = {
  value: PreciseLocation | null;
  onChange: (value: PreciseLocation | null) => void;
  title?: string;
  description?: string;
  subject?: "personal" | "property";
};

export default function PreciseLocationPicker({
  value,
  onChange,
  title = "Street address",
  description = "Use my location to suggest the street address, then correct the text if needed.",
  subject = "personal",
}: Props) {
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState("");
  const requestRef = useRef(0);

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );

  function updateAddress(address: string) {
    onChange({
      latitude: value?.latitude ?? null,
      longitude: value?.longitude ?? null,
      accuracy: value?.accuracy ?? null,
      address,
      city: value?.city,
      state: value?.state,
    });
  }

  async function finish(position: GeolocationPosition, request: number) {
    if (request !== requestRef.current) return;
    setLocating(false);

    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    const accuracy = position.coords.accuracy;
    const typedAddress = value?.address?.trim() || "";
    const base: PreciseLocation = {
      latitude,
      longitude,
      accuracy,
      address: typedAddress,
      city: value?.city,
      state: value?.state,
    };
    onChange(base);
    setMessage(
      typedAddress
        ? "Location updated. Your written street address was kept."
        : "Location found. Looking up the street address…",
    );

    try {
      const result = await Promise.race([
        supabase.functions.invoke("reverse-geocode", {
          body: { latitude, longitude },
        }),
        new Promise<never>((_, reject) =>
          window.setTimeout(
            () => reject(new Error("Address lookup timed out")),
            8000,
          ),
        ),
      ]);
      if (request !== requestRef.current) return;

      if (!result.error && result.data?.address) {
        const suggestedAddress = String(result.data.address);
        onChange({
          ...base,
          // A manually corrected written address is authoritative. Refreshing
          // device location must never replace it with a nearby suggestion.
          address: typedAddress || suggestedAddress,
          city: String(result.data.city || value?.city || ""),
          state: String(result.data.state || value?.state || ""),
        });
        setMessage(
          typedAddress
            ? "Location updated. Your written street address was kept."
            : "Address suggestion found. Check and correct it before saving.",
        );
      } else if (!typedAddress) {
        setMessage("Location found. Type the correct street address before saving.");
      }
    } catch {
      if (request === requestRef.current && !typedAddress)
        setMessage("Location found. Type the correct street address before saving.");
    }
  }

  function fail(error: GeolocationPositionError) {
    setLocating(false);
    const denied = error.code === error.PERMISSION_DENIED;
    const text = denied
      ? "Location permission is blocked. You can still type the street address manually, or allow Location in the site controls and try again."
      : error.code === error.TIMEOUT
        ? "No location arrived from this phone. You can type the street address manually or try again."
        : "This phone could not provide a location. You can type the street address manually.";
    setMessage(text);
    toast.error(
      denied ? "Location is optional — type your address manually" : "No location received",
    );
  }

  function locate() {
    if (!navigator.geolocation) {
      setMessage(
        "This browser cannot share location. Type the correct street address manually.",
      );
      return;
    }
    const request = ++requestRef.current;
    let best: GeolocationPosition | null = null;
    let done = false;
    let watch = -1;
    setLocating(true);
    setMessage("Finding the best available location from this phone…");

    const settle = () => {
      if (done || request !== requestRef.current || !best) return;
      done = true;
      if (watch >= 0) navigator.geolocation.clearWatch(watch);
      void finish(best, request);
    };
    const receive = (position: GeolocationPosition) => {
      if (done || request !== requestRef.current) return;
      if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
      setMessage("Finding the best available location from this phone…");
      if (best.coords.accuracy <= 25) settle();
    };

    watch = navigator.geolocation.watchPosition(
      receive,
      (error) => {
        if (!best) {
          done = true;
          fail(error);
        } else settle();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    navigator.geolocation.getCurrentPosition(
      receive,
      (error) => {
        if (!best && watch < 0) {
          done = true;
          fail(error);
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    window.setTimeout(() => {
      if (best) settle();
      else if (!done) {
        done = true;
        if (watch >= 0) navigator.geolocation.clearWatch(watch);
        setLocating(false);
        setMessage(
          "We could not confirm a location from this phone. Type the correct street address manually or try again.",
        );
      }
    }, 12000);
  }

  const addressHelp =
    subject === "property"
      ? "The street address is what the Partner, WeHouse team and customers see. Device location stays in the background for verification and distance calculations."
      : "The street address is what you see and edit. Device location stays in the background and is never shown as coordinates.";

  return (
    <section className="border-y border-white/[.07] py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold">{title}</p>
          <p className="mt-1 text-[9px] leading-5 text-[#787D8F]">
            {description}
          </p>
        </div>
        <span
          className={`shrink-0 text-[8px] font-bold uppercase tracking-wide ${
            value?.address.trim() ? "text-emerald-300" : "text-amber-300"
          }`}
        >
          {value?.address.trim() ? "Address saved" : "Add address"}
        </span>
      </div>

      <div className="mt-3">
        <label className="block">
          <span className="mb-1 block text-[9px] font-semibold text-[#A4A9B7]">
            {subject === "property"
              ? "Property street address"
              : "Your street address"}
          </span>
          <textarea
            rows={2}
            value={value?.address || ""}
            placeholder="House number, street, area"
            onChange={(event) => updateAddress(event.target.value)}
            className="w-full resize-none rounded-xl border border-white/[.08] bg-[#181A23] p-3 text-xs outline-none focus:border-violet-500/40"
          />
        </label>

        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[8px] leading-4 text-[#656B7B]">{addressHelp}</p>
          <button
            type="button"
            onClick={locate}
            disabled={locating}
            className="shrink-0 text-[9px] font-semibold text-violet-300 disabled:opacity-50"
          >
            {locating ? "Finding address…" : "Use my location"}
          </button>
        </div>

        {value && (
          <button
            type="button"
            onClick={() => {
              requestRef.current += 1;
              onChange(null);
              setMessage("");
            }}
            className="mt-2 text-[9px] font-semibold text-red-300"
          >
            Remove address
          </button>
        )}
      </div>

      {message && (
        <p
          className={`mt-2 rounded-xl px-3 py-2 text-[9px] leading-5 ${
            /blocked|could not|cannot|No location/i.test(message)
              ? "bg-amber-500/10 text-amber-200"
              : "text-[#9AA0AF]"
          }`}
          role={
            /blocked|could not|cannot|No location/i.test(message)
              ? "alert"
              : "status"
          }
        >
          {message}
        </p>
      )}
    </section>
  );
}
