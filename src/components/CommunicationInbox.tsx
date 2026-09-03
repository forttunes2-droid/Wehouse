import { useState } from "react";
import SupportEntryCard from "@/components/SupportEntryCard";
import Notifications from "@/pages/Notifications";
import type { Profile } from "@/types";

type Props = {
  profile: Profile;
  onNavigate?: (page: string, id?: string) => void;
};

export default function CommunicationInbox({ profile, onNavigate = () => {} }: Props) {
  const [view, setView] = useState<"chats" | "activity">("chats");
  return <div className="space-y-4">
    <div className="flex border-b border-white/[.07]" aria-label="Inbox views">
      {([['chats', 'Chats'], ['activity', 'Activity']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setView(id)} className={`relative flex-1 py-3 text-[11px] font-semibold ${view === id ? 'text-violet-300 after:absolute after:inset-x-10 after:bottom-0 after:h-0.5 after:bg-violet-400' : 'text-[#74798A]'}`}>{label}</button>)}
    </div>
    {view === "activity" ? <Notifications profile={profile} embedded onNavigate={onNavigate} /> : <div className="space-y-3">
      <section className="overflow-hidden border-y border-white/[.06]"><SupportEntryCard profile={profile} compact /></section>
      <p className="px-1 text-[9px] leading-relaxed text-[#555A69]">Only genuine Human Support cases appear in Chats. Official announcements are one-way updates in Activity.</p>
    </div>}
  </div>;
}
