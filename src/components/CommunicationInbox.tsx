import { useState } from "react";
import SupportEntryCard from "@/components/SupportEntryCard";
import Notifications from "@/pages/Notifications";
import InboxTabs from "@/components/InboxTabs";
import NewLoginAlert from "@/components/NewLoginAlert";
import type { Profile } from "@/types";

type Props = {
  profile: Profile;
  onNavigate?: (page: string, id?: string) => void;
};

export default function CommunicationInbox({ profile, onNavigate = () => {} }: Props) {
  const [view, setView] = useState<"chats" | "activity">("chats");
  return <div className="space-y-4">
    <InboxTabs value={view} onChange={setView}/>
    {view === "activity" ? <Notifications profile={profile} embedded onNavigate={onNavigate} /> : <div className="space-y-3">
      <NewLoginAlert profile={profile}/>
      <section className="overflow-hidden border-y border-white/[.06]"><SupportEntryCard profile={profile} compact /></section>
      <p className="px-1 text-[9px] leading-relaxed text-[#555A69]">Only genuine Human Support cases appear in Chats. Official announcements are one-way updates in Activity.</p>
    </div>}
  </div>;
}
