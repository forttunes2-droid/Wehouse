import { useState } from "react";
import WorkspaceFrameV2 from "@/components/WorkspaceFrameV2";
import WorkerActivationHome from "@/components/WorkerActivationHome";
import WorkerJobsPanelV2, {
  WorkerConversationsPanel,
} from "@/components/WorkerJobsPanelV2";
import type { WorkerBookingConversation } from "@/components/WorkerJobsPanelV2";
import WorkerProfilePanelV2 from "@/components/WorkerProfilePanelV2";
import WorkerShowcaseManager from "@/components/WorkerShowcaseManager";
import GoldTickBadge from "@/components/GoldTickBadge";
import CommunicationInbox from "@/components/CommunicationInbox";
import type { Profile } from "@/types";

type Tab = "home" | "jobs" | "conversations" | "work" | "account";

const LIVE_NAV = [
  { id: "jobs", label: "Jobs" },
  { id: "conversations", label: "Conversations" },
  { id: "work", label: "My Work" },
  { id: "account", label: "Account" },
];

const ACTIVATION_NAV = [
  { id: "home", label: "Home" },
  { id: "account", label: "Account" },
];

export default function WorkerWorkspaceModern({
  profile,
  onGoToSetup,
  onLogout,
  onNavigate,
}: {
  profile: Profile;
  onGoToSetup: () => void;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
}) {
  const live =
    profile.worker_status === "verified" && profile.worker_verified === true;
  const nav = live ? LIVE_NAV : ACTIVATION_NAV;
  const [tab, setTab] = useState<Tab>(live ? "jobs" : "home");
  const [conversation, setConversation] =
    useState<WorkerBookingConversation | null>(null);
  const safeTab =
    !live && (tab === "jobs" || tab === "conversations" || tab === "work")
      ? "home"
      : tab;

  let content: React.ReactNode;
  if (safeTab === "account") {
    content = <div className="space-y-7">
      <WorkerProfilePanelV2 profile={profile} onEdit={onGoToSetup} onVerification={() => onNavigate?.("worker_verification")}/>
      {live ? <><section className="grid gap-2 border-t border-white/[.07] pt-6 sm:grid-cols-3"><AccountLink title="Edit account" detail="Personal details and contact information" onClick={() => onNavigate?.("profile_edit")}/><AccountLink title="Privacy" detail="Profile and discovery visibility" onClick={() => onNavigate?.("privacy")}/><AccountLink title="Security" detail="Password and active sessions" onClick={() => onNavigate?.("security")}/></section><section className="border-t border-white/[.07] pt-6"><CommunicationInbox profile={profile} title="Help & support" description="Open a private help case with WeHouse. Support is separate from customer job conversations."/></section></> : null}
    </div>;
  } else if (live && safeTab === "jobs") {
    content = (
      <WorkerJobsPanelV2
        profile={profile}
        onOpenConversation={(row) => {
          setConversation(row);
          setTab("conversations");
        }}
      />
    );
  } else if (live && safeTab === "conversations") {
    content = (
      <WorkerConversationsPanel
        profile={profile}
        initialConversation={conversation}
        onConversationClosed={() => setConversation(null)}
      />
    );
  } else if (live && safeTab === "work") {
    content = <WorkerShowcaseManager profile={profile} />;
  } else if (live) {
    content = <WorkerJobsPanelV2 profile={profile} onOpenConversation={(row) => { setConversation(row); setTab("conversations"); }}/>
  } else {
    content = (
      <WorkerActivationHome
        profile={profile}
        onProfile={() => setTab("account")}
        onVerification={() => onNavigate?.("worker_verification")}
      />
    );
  }

  const description =
    safeTab === "account"
      ? live
        ? "Your public profile, wallet, payout account and account tools."
        : "Build the professional profile customers will see after approval."
      : safeTab === "conversations"
        ? "Customer requests and job updates stay in one continuous conversation."
        : safeTab === "work"
          ? "Publish photos and videos that show customers the work you do."
          : safeTab === "jobs"
            ? "Track each job from request to completion, including its earnings."
            : live
              ? "Manage your work from one place."
              : "Finish verification before your services become public.";

  return (
    <WorkspaceFrameV2
      label="WEHOUSE · WORKER"
      labelBadge={live ? <GoldTickBadge size="sm"/> : null}
      title={nav.find((item) => item.id === safeTab)?.label || "Worker"}
      description={description}
      items={nav}
      active={safeTab}
      setActive={(id) => setTab(id as Tab)}
      onLogout={onLogout}
    >
      {content}
    </WorkspaceFrameV2>
  );
}

function AccountLink({title,detail,onClick}:{title:string;detail:string;onClick:()=>void}) {
  return <button onClick={onClick} className="flex min-h-20 items-center justify-between gap-3 rounded-2xl border border-white/[.07] bg-[#11141C] p-4 text-left"><span><span className="block text-xs font-semibold">{title}</span><span className="mt-1 block text-[9px] leading-relaxed text-[#6E7484]">{detail}</span></span><span className="text-violet-300">›</span></button>;
}
