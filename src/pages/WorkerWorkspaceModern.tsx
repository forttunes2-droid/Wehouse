import { useEffect, useState } from "react";
import WorkspaceFrameV2 from "@/components/WorkspaceFrameV2";
import { getCommunicationBookingConversations } from "@/lib/supabase/worker-bookings";
import WorkerActivationHome from "@/components/WorkerActivationHome";
import WorkerJobsPanelV2, {
  WorkerConversationsPanel,
} from "@/components/WorkerJobsPanelV2";
import type { WorkerBookingConversation } from "@/components/WorkerJobsPanelV2";
import WorkerProfilePanelV2 from "@/components/WorkerProfilePanelV2";
import WorkerShowcaseManager from "@/components/WorkerShowcaseManager";
import type { Profile } from "@/types";

type Tab = "home" | "jobs" | "conversations" | "work" | "account";

const LIVE_NAV = [
  { id: "home", label: "Home" },
  { id: "jobs", label: "Jobs" },
  { id: "conversations", label: "Conversations" },
  { id: "work", label: "Portfolio" },
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
  const [tab, setTab] = useState<Tab>("home");
  const [conversation, setConversation] =
    useState<WorkerBookingConversation | null>(null);
  const safeTab =
    !live && (tab === "jobs" || tab === "conversations" || tab === "work")
      ? "home"
      : tab;

  let content: React.ReactNode;
  if (safeTab === "account") {
    content = (
      <WorkerProfilePanelV2
        profile={profile}
        onEdit={onGoToSetup}
        onVerification={() => onNavigate?.("worker_verification")}
      />
    );
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
    content = <LiveHome profile={profile} setTab={setTab} />;
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
        ? "Preview and manage the professional profile customers see."
        : "Build the professional profile customers will see after approval."
      : safeTab === "conversations"
        ? "Customer requests and job updates stay in one continuous conversation."
        : safeTab === "work"
          ? "Publish permanent photos and videos that show customers your work."
          : safeTab === "jobs"
            ? "Track each job from request to completion, including its earnings."
            : live
              ? "Manage your work from one place."
              : "Finish verification before your services become public.";

  return (
    <WorkspaceFrameV2
      label="WEHOUSE · WORKER"
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

function LiveHome({
  profile,
  setTab,
}: {
  profile: Profile;
  setTab: (tab: Tab) => void;
}) {
  const [summary, setSummary] = useState<{ next: string; detail: string }>({
    next: "No job needs action",
    detail: "New requests will appear in Conversations.",
  });
  useEffect(() => {
    let active = true;
    void (async () => {
      const conversations = await getCommunicationBookingConversations(
        profile.user_id,
      );
      const rows = (conversations.conversations ||
        []) as WorkerBookingConversation[];
      const open = rows.find(
        (row) =>
          !["approved_released", "cancelled", "refunded"].includes(
            String(row.booking_status),
          ),
      );
      if (active)
        setSummary({
          next: open
            ? String(open.service_type || "Service job")
            : "No job needs action",
          detail: open
            ? `${open.other_person_name || "Customer"} · ${String(open.booking_status).replace(/_/g, " ")}`
            : "New requests will appear in Conversations.",
        });
    })();
    return () => {
      active = false;
    };
  }, [profile.user_id]);
  return (
    <div className="space-y-6">
      <section className="flex items-center justify-between gap-4 border-b border-white/[.07] pb-5">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold text-emerald-300">
            ● Available
          </p>
          <h2 className="mt-2 truncate text-2xl font-bold">
            {profile.full_name || profile.username || "Worker"}
          </h2>
        </div>
      </section>
      <section className="divide-y divide-white/[.06] border-y border-white/[.06]">
        <button
          onClick={() => setTab("conversations")}
          className="flex w-full items-center gap-4 py-5 text-left"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[9px] uppercase tracking-wide text-[#62697A]">
              Next action
            </p>
            <p className="mt-1 truncate text-sm font-semibold">
              {summary.next}
            </p>
            <p className="mt-1 truncate text-[10px] text-[#747B8B]">
              {summary.detail}
            </p>
          </div>
          <span className="text-violet-300">›</span>
        </button>
        <button
          onClick={() => setTab("jobs")}
          className="flex w-full items-center gap-4 py-5 text-left"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[9px] uppercase tracking-wide text-[#62697A]">
              Jobs
            </p>
            <p className="mt-1 text-sm font-semibold">
              Current work, history and earnings
            </p>
          </div>
          <span className="text-violet-300">View jobs ›</span>
        </button>
      </section>
    </div>
  );
}
