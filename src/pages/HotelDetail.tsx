import { useEffect, useState } from "react";
import { toast } from "sonner";
import HotelDetailCore from "@/pages/HotelDetailCore";
import {
  getMySavedHotelIds,
  saveHotel,
  unsaveHotel,
} from "@/lib/supabase/saved-hotels";

type Props = {
  hotelId: number;
  onBack: () => void;
  onBook: (
    hotelId: number,
    roomId: number,
    ratePlanId: number,
    checkIn: string,
    checkOut: string,
  ) => void;
  profile: { user_id: string; username: string | null };
};

export default function HotelDetail(props: Props) {
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void getMySavedHotelIds().then(({ hotelIds, error }) => {
      if (!active || error) return;
      setSaved(hotelIds.includes(Number(props.hotelId)));
    });
    return () => {
      active = false;
    };
  }, [props.hotelId]);

  async function toggleSaved() {
    if (busy) return;
    setBusy(true);
    const result = saved
      ? await unsaveHotel(props.hotelId)
      : await saveHotel(props.hotelId);
    setBusy(false);
    if (result.error)
      return toast.error(result.error.message || "Saved hotels could not be updated");
    setSaved((value) => !value);
    toast.success(saved ? "Hotel removed from Saved" : "Hotel saved");
  }

  return (
    <div className="relative">
      <HotelDetailCore {...props} />
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggleSaved()}
        aria-label={saved ? "Remove hotel from Saved" : "Save hotel"}
        aria-pressed={saved}
        className="fixed right-4 top-[max(.75rem,env(safe-area-inset-top))] z-[55] grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur disabled:opacity-50"
      >
        <Bookmark filled={saved} />
      </button>
    </div>
  );
}

function Bookmark({ filled }: { filled: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={filled ? "#A78BFA" : "none"}
      stroke={filled ? "#A78BFA" : "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3.75A1.75 1.75 0 0 1 7.75 2h8.5A1.75 1.75 0 0 1 18 3.75V22l-6-3.75L6 22V3.75Z" />
    </svg>
  );
}
