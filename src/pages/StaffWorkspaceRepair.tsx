import { useEffect, useMemo, useState } from "react";
import { Toaster } from "sonner";
import WorkspaceFrameV2 from "@/components/WorkspaceFrameV2";
import PropertyPipelineWorkspace from "@/components/PropertyPipelineWorkspace";
import HousingOperationsWorkspace from "@/components/HousingOperationsWorkspace";
import CommunicationsWorkspace from "@/components/CommunicationsWorkspace";
import Notifications from "@/pages/Notifications";
import StaffWorkerReviewModern from "@/components/StaffWorkerReviewModern";
import StaffInspectionWorkspaceV2 from "@/components/StaffInspectionWorkspaceV2";
import StaffFinanceSummary from "@/components/StaffFinanceSummary";
import StaffFinanceRecords from "@/components/StaffFinanceRecords";
import StaffSecurityOverviewV2 from "@/components/StaffSecurityOverviewV2";
import StaffActivityTrailV2 from "@/components/StaffActivityTrailV2";
import InboxTabs from "@/components/InboxTabs";
import { useStaffPermissions } from "@/hooks/useStaffPermissions";
import { useOperationsInboxSummary } from "@/hooks/useOperationsInboxSummary";
import type { Profile } from "@/types";

type Module =
  | "operations"
  | "finance"
  | "support"
  | "security"
  | "verification"
  | "field_officer";
type MainTab = "home" | "work" | "conversations";
type WorkView =
  | "pipeline"
  | "overview"
  | "payments"
  | "payouts"
  | "ledger"
  | "signals"
  | "trail";
type InboxView = "chats" | "booking" | "activity";
type Props = {
  profile: Profile;
  onLogout: () => void;
  onGoToChat?: (id?: string) => void;
  onNavigate?: (page: string, id?: string) => void;
};
const MODULES: Module[] = [
  "operations",
  "finance",
  "support",
  "security",
  "verification",
  "field_officer",
];
const MODULE_COPY: Record<
  Module,
  { title: string; description: string; workLabel: string }
> = {
  operations: {
    title: "Property Operations",
    description:
      "Move assigned properties from request through inspection and publication.",
    workLabel: "Properties",
  },
  finance: {
    title: "Finance",
    description: "Review assigned payments, payouts and financial records.",
    workLabel: "Finance Work",
  },
  support: {
    title: "Communications",
    description: "Handle WeHouse conversations assigned to your branch.",
    workLabel: "Conversations",
  },
  security: {
    title: "Security Operations",
    description:
      "Review branch authentication and session signals, then escalate verified risks to Admin or Creator.",
    workLabel: "Security Signals",
  },
  verification: {
    title: "Worker Operations",
    description:
      "Review Worker onboarding, professional evidence and the permitted account decision.",
    workLabel: "Workers",
  },
  field_officer: {
    title: "Field Operations",
    description: "Complete property visits and submit inspection evidence.",
    workLabel: "Inspections",
  },
};

export default function StaffWorkspaceRepair({
  profile,
  onLogout,
  onNavigate,
}: Props) {
  const { permissions, loading } = useStaffPermissions(profile.user_id);
  const assigned = useMemo(
    () =>
      permissions.filter((value): value is Module =>
        MODULES.includes(value as Module),
      ),
    [permissions],
  );
  if (loading)
    return (
      <State
        title="Loading your workspace"
        text="Checking your branch and work area…"
      />
    );
  if (!profile.assigned_state || !profile.assigned_lga)
    return (
      <State
        title="Branch assignment required"
        text="An Admin or Creator must assign this team member to a State and LGA before work can begin."
      />
    );
  if (assigned.length !== 1)
    return (
      <State
        title="Work area needs attention"
        text={
          assigned.length
            ? "This account has conflicting work areas. Keep one active work area."
            : "No work area is assigned to this account."
        }
      />
    );
  return (
    <Workspace
      module={assigned[0]}
      profile={profile}
      onLogout={onLogout}
      onNavigate={onNavigate}
    />
  );
}

function Workspace({
  module,
  profile,
  onLogout,
  onNavigate,
}: {
  module: Module;
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string, id?: string) => void;
}) {
  const copy = MODULE_COPY[module],
    directConversation = module === "support";
  const communicationQueue =
    module === "operations" ? "operations" : module === "support" ? "support" : null;
  const inboxSummary = useOperationsInboxSummary(
    profile.user_id,
    "staff",
    communicationQueue,
  );
  const items = directConversation
    ? [
        { id: "home", label: "Home" },
        {
          id: "conversations",
          label: "Inbox",
          badge: inboxSummary.totalUnread,
        },
      ]
    : module === "operations"
      ? [
          { id: "home", label: "Home" },
          { id: "work", label: copy.workLabel },
          {
            id: "conversations",
            label: "Inbox",
            badge: inboxSummary.totalUnread,
          },
        ]
      : [
          { id: "home", label: "Home" },
          { id: "work", label: copy.workLabel },
          {
            id: "conversations",
            label: "Inbox",
            badge: inboxSummary.totalUnread,
          },
        ];
  const [tab, setTab] = useState<MainTab>("home"),
    [workTargetId, setWorkTargetId] = useState<string | undefined>(),
    [bookingTargetId, setBookingTargetId] = useState<string | undefined>(),
    [conversationTargetId, setConversationTargetId] = useState<string | undefined>(),
    [workView, setWorkView] = useState<WorkView>(
      module === "finance"
        ? "overview"
        : module === "security"
          ? "signals"
          : "pipeline",
    );
  const scope = {
      state: profile.assigned_state || "",
      lga: profile.assigned_lga || "",
    },
    branch = [scope.lga, scope.state].filter(Boolean).join(", ");
  function openStaffDestination(page: string, id?: string) {
    const route = page.toLowerCase().replace(/-/g, "_");
    if (/propert|listing|inspection/.test(route)) {
      setWorkTargetId(id);
      setTab("work");
      return;
    }
    if (/booking|reservation/.test(route)) {
      setBookingTargetId(id);
      setTab("conversations");
      return;
    }
    if (["conversation", "messages", "chat", "operations_inbox"].includes(route)) {
      setConversationTargetId(id);
      setTab("conversations");
      return;
    }
    if (/worker|finance|earning|payment|security|device/.test(route)) {
      setWorkTargetId(id);
      setTab("work");
      return;
    }
    onNavigate?.(page, id);
  }
  let content: React.ReactNode;
  if (tab === "home")
    content = (
      <StaffHome
        profile={profile}
        module={module}
        copy={copy}
        branch={branch}
        openWork={() => setTab(directConversation ? "conversations" : "work")}
        onNavigate={onNavigate}
      />
    );
  else if (tab === "conversations" && module === "operations")
    content = (
      <OperationsInbox
        profile={profile}
        scope={scope}
        summary={inboxSummary}
        openProperties={(id) => {
          setWorkTargetId(id);
          setTab("work");
        }}
        initialBookingId={bookingTargetId}
        initialConversationId={conversationTargetId}
        onNavigate={openStaffDestination}
      />
    );
  else if (tab === "conversations" && directConversation)
    content = (
      <SupportInbox profile={profile} scope={scope} initialConversationId={conversationTargetId} onNavigate={openStaffDestination} />
    );
  else if (tab === "conversations")
    content = (
      <ActivityOnlyInbox
        profile={profile}
        unread={inboxSummary.activityUnread}
        onUnreadChange={inboxSummary.refresh}
        onNavigate={openStaffDestination}
      />
    );
  else
    content = (
      <ModuleWork
        module={module}
        profile={profile}
        initialRecordId={workTargetId}
        view={workView}
        setView={setWorkView}
      />
    );
  const activeLabel =
    items.find((item) => item.id === tab)?.label || copy.title;
  return (
    <>
      <Toaster position="top-center" richColors />
      <WorkspaceFrameV2
        label={`WEHOUSE TEAM · ${copy.title}`}
        title={activeLabel}
        description={`${copy.description} · ${branch}`}
        items={items}
        active={tab}
        setActive={(id) => setTab(id as MainTab)}
        onAccount={onNavigate ? () => onNavigate("profile") : undefined}
        onLogout={onLogout}
        compact={tab === "conversations"}
      >
        {content}
      </WorkspaceFrameV2>
    </>
  );
}

function ModuleWork({
  module,
  profile,
  initialRecordId,
  view,
  setView,
}: {
  module: Module;
  profile: Profile;
  initialRecordId?: string;
  view: WorkView;
  setView: (view: WorkView) => void;
}) {
  if (module === "field_officer")
    return <StaffInspectionWorkspaceV2 profile={profile} />;
  if (module === "verification") return <StaffWorkerReviewModern />;
  if (module === "security")
    return (
      <div className="space-y-5">
        <LocalTabs
          items={[
            ["signals", "Signals"],
            ["trail", "Activity trail"],
          ]}
          active={view}
          set={setView}
        />
        {view === "trail" ? (
          <StaffActivityTrailV2 />
        ) : (
          <StaffSecurityOverviewV2 onOpenCases={() => setView("trail")} />
        )}
      </div>
    );
  if (module === "operations")
    return <PropertyPipelineWorkspace profile={profile} initialRecordId={initialRecordId} />;
  if (module === "finance")
    return (
      <div className="space-y-5">
        {view === "overview" ? (
          <StaffFinanceSummary open={(id) => setView(id)} />
        ) : (
          <>
            <LocalTabs
              items={[
                ["overview", "Overview"],
                ["payments", "Payments"],
                ["payouts", "Payouts"],
                ["ledger", "Ledger"],
              ]}
              active={view}
              set={setView}
            />
            <StaffFinanceRecords
              view={view as "payments" | "payouts" | "ledger"}
            />
          </>
        )}
      </div>
    );
  return null;
}

function OperationsInbox({
  profile,
  scope,
  summary,
  openProperties,
  initialBookingId,
  initialConversationId,
  onNavigate,
}: {
  profile: Profile;
  scope: { state: string; lga: string };
  summary: ReturnType<typeof useOperationsInboxSummary>;
  openProperties: (id?: string) => void;
  initialBookingId?: string;
  initialConversationId?: string;
  onNavigate?: (page: string, id?: string) => void;
}) {
  const [view, setView] = useState<InboxView>("chats");
  const [activeBookingId, setActiveBookingId] = useState(initialBookingId);
  useEffect(() => {
    if (initialBookingId) {
      setActiveBookingId(initialBookingId);
      setView("booking");
    }
  }, [initialBookingId]);
  function navigate(page: string, id?: string) {
    if (page === "operations_properties") return openProperties(id);
    if (/booking|reservation/.test(page)) {
      setActiveBookingId(id);
      setView("booking");
      return;
    }
    onNavigate?.(page, id);
  }
  if (view === "booking")
    return (
      <InboxDetail title="Find a booking" back={() => setView("chats")}>
        <HousingOperationsWorkspace initialRecordId={activeBookingId} />
      </InboxDetail>
    );
  return (
    <div className="space-y-4">
      <InboxTabs
        value={view}
        onChange={setView}
        chatCount={summary.messageUnread}
        activityCount={summary.activityUnread}
      />
      {view === "activity" ? (
        <Notifications
          profile={profile}
          scope="staff"
          embedded
          onUnreadChange={summary.refresh}
          onNavigate={navigate}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => setView("booking")}
            className="flex min-h-14 w-full items-center justify-between border-y border-white/[.06] py-3 text-left"
          >
            <span>
              <strong className="block text-xs">Find a booking</strong>
              <span className="mt-1 block text-[9px] text-[#707687]">
                Check a booking code before an arrival or handover
              </span>
            </span>
            <span className="text-[#656B7C]">›</span>
          </button>
          <CommunicationsWorkspace
            profile={profile}
            scope={scope}
            forcedView="inbox"
            hideViewTabs
            queue="operations"
            initialConversationId={initialConversationId}
            onOpenContext={navigate}
            onUnreadChange={summary.refresh}
          />
        </>
      )}
    </div>
  );
}
function SupportInbox({
  profile,
  scope,
  initialConversationId,
  onNavigate,
}: {
  profile: Profile;
  scope: { state: string; lga: string };
  initialConversationId?: string;
  onNavigate?: (page: string, id?: string) => void;
}) {
  const [view, setView] = useState<"chats" | "activity">("chats");
  return (
    <div className="space-y-4">
      <InboxTabs value={view} onChange={setView} />
      {view === "activity" ? (
        <Notifications
          profile={profile}
          scope="staff"
          embedded
          onNavigate={(page, id) => onNavigate?.(page, id)}
        />
      ) : (
        <>
          <CommunicationsWorkspace
            profile={profile}
            scope={scope}
            forcedView="inbox"
            hideViewTabs
            queue="support"
            initialConversationId={initialConversationId}
            onOpenContext={(page, id)=>onNavigate?.(page, id)}
          />
        </>
      )}
    </div>
  );
}
function ActivityOnlyInbox({
  profile,
  unread,
  onUnreadChange,
  onNavigate,
}: {
  profile: Profile;
  unread: number;
  onUnreadChange: () => void;
  onNavigate: (page: string, id?: string) => void;
}) {
  const [view, setView] = useState<"chats" | "activity">("activity");
  return (
    <div className="space-y-4">
      <InboxTabs value={view} onChange={setView} activityCount={unread} />
      {view === "activity" ? (
        <Notifications
          profile={profile}
          scope="staff"
          embedded
          onUnreadChange={onUnreadChange}
          onNavigate={onNavigate}
        />
      ) : (
        <div className="grid min-h-48 place-items-center border-y border-white/[.06] text-center">
          <div>
            <p className="text-sm font-semibold">No conversations assigned</p>
            <p className="mt-2 max-w-xs text-[10px] leading-5 text-[#686F80]">
              Messages appear here only when this work area is authorized for a conversation.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
function InboxDetail({
  title,
  badge = 0,
  back,
  children,
}: {
  title: string;
  badge?: number;
  back: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3 border-b border-white/[.07] pb-3">
        <button
          type="button"
          onClick={back}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/[.04] text-lg"
          aria-label="Back to Inbox"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">
            Inbox
          </p>
          <h2 className="mt-0.5 text-base font-bold">{title}</h2>
        </div>
        {badge > 0 && (
          <span className="grid h-6 min-w-6 place-items-center rounded-full bg-red-500 px-1.5 text-[8px] font-bold">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </header>
      {children}
    </div>
  );
}
function StaffHome({
  module,
  copy,
  branch,
  openWork,
}: {
  profile: Profile;
  module: Module;
  copy: { title: string; description: string; workLabel: string };
  branch: string;
  openWork: () => void;
  onNavigate?: (page: string) => void;
}) {
  return (
    <div className="space-y-6">
      <section className="border-b border-white/[.07] pb-6">
        <p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">
          YOUR WORK AREA
        </p>
        <h2 className="mt-3 text-2xl font-bold">{copy.title}</h2>
        <p className="mt-2 max-w-xl text-xs leading-6 text-[#858B9B]">
          {copy.description}
        </p>
        <p className="mt-2 text-[10px] text-[#666D7E]">Branch · {branch}</p>
      </section>
      <div className="border-y border-white/[.06]">
        <button
          onClick={openWork}
          className="flex min-h-16 w-full items-center justify-between py-3 text-left"
        >
          <span>
            <strong className="block text-sm">
              {module === "support" ? "Open conversations" : copy.workLabel}
            </strong>
            <span className="mt-1 block text-[10px] text-[#6E7484]">
              Continue your assigned work
            </span>
          </span>
          <span className="text-violet-300">›</span>
        </button>
      </div>
    </div>
  );
}
function LocalTabs<T extends string>({
  items,
  active,
  set,
}: {
  items: Array<[T, string]>;
  active: T;
  set: (view: T) => void;
}) {
  return (
    <div className="flex gap-5 overflow-x-auto border-b border-white/[.07]">
      {items.map(([id, label]) => (
        <button
          key={id}
          onClick={() => set(id)}
          className={`relative shrink-0 pb-3 text-[10px] font-semibold ${active === id ? "text-white" : "text-[#6E7484]"}`}
        >
          {label}
          {active === id && (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-violet-500" />
          )}
        </button>
      ))}
    </div>
  );
}
function State({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid min-h-[70dvh] place-items-center bg-[#0A0A0F] px-5 text-white">
      <div className="w-full max-w-lg rounded-3xl border border-white/[.07] bg-[#10141C] p-6 text-center">
        <p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">
          WEHOUSE TEAM
        </p>
        <h1 className="mt-3 text-lg font-bold capitalize">{title}</h1>
        <p className="mt-2 text-[11px] leading-relaxed text-[#747A8B]">
          {text}
        </p>
      </div>
    </div>
  );
}
