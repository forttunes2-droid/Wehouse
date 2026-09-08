import { useState } from "react";
import SupportEntryCard from "@/components/SupportEntryCard";
import Notifications from "@/pages/Notifications";
import InboxTabs from "@/components/InboxTabs";
import type { Profile } from "@/types";

type Props = {
  profile: Profile;
  onNavigate?: (page: string, id?: string) => void;
};

export default function CommunicationInbox({
  profile,
  onNavigate = () => {},
}: Props) {
  const [view, setView] = useState<"chats" | "activity">("chats");
  return (
    <div className="space-y-4">
      <InboxTabs value={view} onChange={setView} />
      {view === "activity" ? (
        <Notifications
          profile={profile}
          scope="property_partner"
          embedded
          onNavigate={onNavigate}
        />
      ) : (
        <div className="space-y-3">
          <section className="overflow-hidden border-y border-white/[.06]">
            <SupportEntryCard profile={profile} compact />
          </section>
          <p className="px-1 text-[9px] leading-relaxed text-[#555A69]">
            Property, booking and payment conversations with WeHouse stay
            together here. Official updates appear in Activity.
          </p>
        </div>
      )}
    </div>
  );
}
