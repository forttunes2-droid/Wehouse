import { useEffect, useRef } from "react";
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
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("wehouse:nested-screen", { detail: { open: true } }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("wehouse:nested-screen", { detail: { open: false } }),
      );
    };
  }, []);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const pruneRoutineSupport = () => {
      const buttons = Array.from(surface.querySelectorAll("button"));
      for (const button of buttons) {
        const label = String(button.textContent || "").replace(/\s+/g, " ").trim();
        if (!/^Message WeHouse(?:\s*→)?$/i.test(label)) continue;
        const section = button.closest("section");
        const sectionText = String(section?.textContent || "").replace(/\s+/g, " ");
        if (section && /Questions about this apartment\?/i.test(sectionText)) {
          section.style.display = "none";
        } else {
          button.style.display = "none";
          button.setAttribute("aria-hidden", "true");
          button.tabIndex = -1;
        }
      }
    };
    pruneRoutineSupport();
    const observer = new MutationObserver(pruneRoutineSupport);
    observer.observe(surface, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [props.listingId]);

  return (
    <div ref={surfaceRef} className="listing-detail-save-surface relative">
      <style>{`
        .listing-detail-save-surface button[aria-label="Save apartment"],
        .listing-detail-save-surface button[aria-label="Remove from saved apartments"] { display: none !important; }
      `}</style>
      <ListingDetailCore {...props} />
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onToggleSave();
        }}
        aria-label={props.isSaved ? "Remove apartment from Saved" : "Add apartment to Saved"}
        aria-pressed={props.isSaved}
        className="absolute right-4 top-[4.75rem] z-[45] grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur active:scale-95"
      >
        <Heart filled={props.isSaved} />
      </button>
    </div>
  );
}

function Heart({ filled }: { filled: boolean }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill={filled ? "#A78BFA" : "none"} stroke={filled ? "#A78BFA" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"/></svg>;
}
