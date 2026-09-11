import type { Profile } from "@/types";
import ListingDetailCore from "@/pages/ListingDetailCore";

type Props = {
  listingId: string;
  onNavigate: () => void;
  isSaved: boolean;
  onToggleSave: () => void;
  profile: Profile;
  onGoToChat: (convId: string) => void;
  onOpenBooking: (reservationId: string) => void;
};

export default function ListingDetail(props: Props) {
  return (
    <div className="listing-detail-save-surface relative">
      <style>{`
        .listing-detail-save-surface button[aria-label="Save apartment"],
        .listing-detail-save-surface button[aria-label="Remove from saved apartments"] {
          display: none !important;
        }
      `}</style>
      <ListingDetailCore {...props} />
      <button
        type="button"
        onClick={props.onToggleSave}
        aria-label={props.isSaved ? "Remove apartment from Saved" : "Save apartment"}
        aria-pressed={props.isSaved}
        className="fixed right-4 top-[max(.75rem,env(safe-area-inset-top))] z-[55] grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur"
      >
        <Bookmark filled={props.isSaved} />
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
