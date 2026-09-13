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
    <div ref={surfaceRef} className="relative">
      <ListingDetailCore {...props} />
    </div>
  );
}
