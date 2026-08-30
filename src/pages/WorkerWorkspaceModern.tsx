import { useState } from "react";
import WorkspaceFrameV2 from "@/components/WorkspaceFrameV2";
import WorkerActivationHome from "@/components/WorkerActivationHome";
import WorkerJobsPanelV2, {
  WorkerConversationsPanel,
} from "@/components/WorkerJobsPanelV2";
import type { WorkerBookingConversation } from "@/components/WorkerJobsPanelV2";
import WorkerShowcaseManager from "@/components/WorkerShowcaseManager";
import GoldTickBadge from "@/components/GoldTickBadge";
import AccountCenter from "@/pages/AccountCenter";
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
    content = <AccountCenter profile={profile} onGoToPrivacy={() => {}} onGoToSaved={() => onNavigate?.("saved")} onGoToSecurity={() => {}} onGoToProfileEdit={onGoToSetup} onLogout={onLogout}/>;
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
        ? "Your identity, preferences, privacy, security and account tools."
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
