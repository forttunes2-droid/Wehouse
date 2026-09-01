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
import AccountShell from "@/components/AccountShell";
import WorkerProfilePanelV3 from "@/components/WorkerProfilePanelV2";
import type { Profile } from "@/types";
import IdentityAccessGate from "@/components/IdentityAccessGate";
import WorkerWallet from "@/pages/WorkerWallet";
import PayoutAccountManager from "@/components/PayoutAccountManager";

type Tab = "home" | "jobs" | "conversations" | "work" | "earnings" | "account";

const LIVE_NAV = [
  { id: "jobs", label: "Jobs" },
  { id: "conversations", label: "Messages" },
  { id: "work", label: "Showcase" },
  { id: "earnings", label: "Earnings" },
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
  const [accountView, setAccountView] = useState<"account" | "profile">("account");
  const safeTab =
    !live && (tab === "jobs" || tab === "conversations" || tab === "work" || tab === "earnings")
      ? "home"
      : tab;

  if (safeTab === "account") {
    if (accountView === "profile") return <AccountShell profile={profile} title="Professional Profile" description="This is the professional profile customers see." onBack={() => setAccountView("account")}><WorkerProfilePanelV3 profile={profile} onEdit={onGoToSetup} onVerification={() => onNavigate?.("worker_verification")}/></AccountShell>;
    return <AccountCenter profile={profile} onBack={() => setTab(live ? "jobs" : "home")} onGoToPrivacy={() => {}} onGoToSaved={() => onNavigate?.("saved")} onGoToSecurity={() => {}} onGoToProfileEdit={() => setAccountView("profile")} onLogout={onLogout}/>;
  }

  let content: React.ReactNode;
  if (live && safeTab === "jobs") {
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
        onNavigate={onNavigate}
      />
    );
  } else if (live && safeTab === "work") {
    content = <WorkerShowcaseManager profile={profile} />;
  } else if (live && safeTab === "earnings") {
    content = <div className="space-y-5"><WorkerWallet profile={profile}/><PayoutAccountManager profile={profile}/></div>;
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
    safeTab === "conversations"
        ? "Customer requests and job updates stay in one continuous conversation."
        : safeTab === "earnings"
          ? "See available earnings, withdrawals and your verified payout account."
        : safeTab === "work"
          ? "Publish photos and videos that show customers the work you do."
          : safeTab === "jobs"
            ? "Track each job from request to completion, including its earnings."
            : live
              ? "Manage your work from one place."
              : "Finish verification before your services become public.";

  const workspace = (
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
  return live ? <IdentityAccessGate profile={profile}>{workspace}</IdentityAccessGate> : workspace;
}
