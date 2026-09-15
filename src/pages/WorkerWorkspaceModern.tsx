import { useState } from "react";
import WorkspaceFrameV2 from "@/components/WorkspaceFrameV2";
import WorkerActivationHome from "@/components/WorkerActivationHome";
import WorkerJobsPanelV2, {
  WorkerInboxPanel,
} from "@/components/WorkerJobsPanelV2";
import type { WorkerBookingConversation } from "@/components/WorkerJobsPanelV2";
import WorkerShowcaseManager from "@/components/WorkerShowcaseManager";
import WorkerProPanel from "@/components/WorkerProPanel";
import AccountCenter, {
  type WorkspaceAccess,
  type WorkspaceChoice,
} from "@/pages/AccountCenter";
import AccountShell from "@/components/AccountShell";
import WorkerProfilePanelV3 from "@/components/WorkerProfilePanelV2";
import type { Profile } from "@/types";
import IdentityAccessGate from "@/components/IdentityAccessGate";
import WorkerWallet from "@/pages/WorkerWallet";
import PayoutAccountManager from "@/components/PayoutAccountManager";
import WorkerAvailabilityControl from "@/components/WorkerAvailabilityControl";
import { useWorkerInboxSummary } from "@/hooks/useWorkerInboxSummary";
import { useWorkerPro } from "@/hooks/useWorkerPro";

type Tab = "home" | "jobs" | "inbox" | "showcase" | "earnings" | "account";

const LIVE_NAV = [
  { id: "jobs", label: "Jobs" },
  { id: "inbox", label: "Inbox" },
  { id: "showcase", label: "Showcase" },
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
  workspaceAccess,
  activeWorkspace,
  onSwitchWorkspace,
}: {
  profile: Profile;
  onGoToSetup: () => void;
  onLogout: () => void;
  onNavigate?: (page: string, id?: string) => void;
  workspaceAccess?: WorkspaceAccess | null;
  activeWorkspace?: WorkspaceChoice;
  onSwitchWorkspace?: (workspace: WorkspaceChoice) => void;
}) {
  const live =
    profile.worker_status === "verified" && profile.worker_verified === true;
  const inbox = useWorkerInboxSummary(profile.user_id);
  const nav = live
    ? LIVE_NAV.map((item) =>
        item.id === "inbox"
          ? { ...item, badge: inbox.totalUnread || undefined }
          : item,
      )
    : ACTIVATION_NAV;
  const [tab, setTab] = useState<Tab>(live ? "jobs" : "home");
  const [conversation, setConversation] =
    useState<WorkerBookingConversation | null>(null);
  const [showcaseTargetId, setShowcaseTargetId] = useState<string>();
  const [accountView, setAccountView] = useState<
    "account" | "profile" | "paid_tools"
  >("account");
  const safeTab =
    !live &&
    (tab === "jobs" ||
      tab === "inbox" ||
      tab === "showcase" ||
      tab === "earnings")
      ? "home"
      : tab;

  function openActivityDestination(page: string, id?: string) {
    const route = page.toLowerCase().replace(/-/g, "_");
    if (/worker_showcase|showcase_post/.test(route)) {
      setShowcaseTargetId(id);
      setTab("showcase");
      return;
    }
    onNavigate?.(page, id);
  }

  if (safeTab === "account") {
    if (accountView === "profile")
      return (
        <AccountShell
          profile={profile}
          title="Service Provider profile"
          description="Services, coverage and the public details customers see."
          onBack={() => setAccountView("account")}
        >
          <WorkerProfilePanelV3
            profile={profile}
            onEdit={onGoToSetup}
            onVerification={() => onNavigate?.("worker_verification")}
          />
        </AccountShell>
      );
    if (accountView === "paid_tools")
      return (
        <ServiceProviderPaidToolsAccount
          profile={profile}
          onBack={() => setAccountView("account")}
        />
      );
    return (
      <AccountCenter
        profile={profile}
        onBack={() => setTab(live ? "jobs" : "home")}
        onGoToPrivacy={() => {}}
        onGoToSaved={() => onNavigate?.("saved")}
        onGoToSecurity={() => {}}
        onGoToProfileEdit={() => setAccountView("profile")}
        onGoToWorkerPaidTools={live ? () => setAccountView("paid_tools") : undefined}
        onNavigate={(page) => onNavigate?.(page)}
        onLogout={onLogout}
        workspaceAccess={workspaceAccess}
        activeWorkspace={activeWorkspace}
        onSwitchWorkspace={onSwitchWorkspace}
      />
    );
  }

  let content: React.ReactNode;
  if (live && safeTab === "jobs") {
    content = (
      <div className="space-y-4">
        <WorkerAvailabilityControl profile={profile} />
        <WorkerJobsPanelV2
          profile={profile}
          onOpenConversation={(row) => {
            setConversation(row);
            setTab("inbox");
          }}
        />
      </div>
    );
  } else if (live && safeTab === "inbox") {
    content = (
      <WorkerInboxPanel
        profile={profile}
        initialConversation={conversation}
        onConversationClosed={() => setConversation(null)}
        onNavigate={openActivityDestination}
        onOpenJobs={() => setTab("jobs")}
        chatUnread={inbox.chatUnread}
        activityUnread={inbox.activityUnread}
        onUnreadRefresh={inbox.refresh}
      />
    );
  } else if (live && safeTab === "showcase") {
    content = (
      <WorkerShowcaseManager
        profile={profile}
        initialPostId={showcaseTargetId}
      />
    );
  } else if (live && safeTab === "earnings") {
    content = (
      <div className="space-y-5">
        <WorkerWallet profile={profile} />
        <PayoutAccountManager profile={profile} />
      </div>
    );
  } else if (live) {
    content = (
      <WorkerJobsPanelV2
        profile={profile}
        onOpenConversation={(row) => {
          setConversation(row);
          setTab("inbox");
        }}
      />
    );
  } else {
    content = (
      <WorkerActivationHome
        profile={profile}
        onProfile={onGoToSetup}
        onVerification={() => onNavigate?.("worker_verification")}
      />
    );
  }

  const description =
    safeTab === "inbox"
      ? "Job conversations and important payment, security and official activity."
      : safeTab === "earnings"
        ? "See available earnings, withdrawals and your verified payout account."
        : safeTab === "showcase"
          ? "Publish and manage the work customers see on your profile."
          : safeTab === "jobs"
            ? "Track each job from request to completion, including its earnings."
            : live
              ? "Manage your WeHouse Services work from one place."
              : "Finish Service Provider onboarding before your services become public.";

  const workspace = (
    <WorkspaceFrameV2
      label="WEHOUSE SERVICES · SERVICE PROVIDER"
      title={nav.find((item) => item.id === safeTab)?.label || "Service Provider"}
      description={description}
      items={nav}
      active={safeTab}
      setActive={(id) => setTab(id as Tab)}
      onLogout={onLogout}
    >
      {content}
    </WorkspaceFrameV2>
  );
  return live ? (
    <IdentityAccessGate profile={profile}>{workspace}</IdentityAccessGate>
  ) : (
    workspace
  );
}

function ServiceProviderPaidToolsAccount({
  profile,
  onBack,
}: {
  profile: Profile;
  onBack: () => void;
}) {
  const workerPro = useWorkerPro(profile.user_id);
  return (
    <AccountShell
      profile={profile}
      title="WeHouse Pro"
      description="Optional business tools for Service Providers. Review and trust are earned separately."
      onBack={onBack}
    >
      <WorkerProPanel
        profile={profile}
        pro={workerPro.pro}
        loading={workerPro.loading}
        error={workerPro.error}
        onRefresh={workerPro.refresh}
      />
    </AccountShell>
  );
}
