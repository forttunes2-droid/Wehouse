import { useEffect } from "react";
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

  return (
    <div className="relative">
      <ListingDetailCore {...props} />
    </div>
  );
}
