import { useMemo, useState } from "react";
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
type MainTab = "home" | "work" | "bookings" | "conversations";
type WorkView =
  | "pipeline"
  | "overview"
  | "payments"
  | "payouts"
  | "ledger"
  | "signals"
  | "trail";
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
    module === "operations" ? "operations" : module === "support" ? "support" : module === "field_officer" ? "field_operations" : null;
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
          { id: "bookings", label: "Bookings" },
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
      setTab("bookings");
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
  else if (tab === "bookings" && module === "operations")
    content = <HousingOperationsWorkspace initialRecordId={bookingTargetId} />;
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
        initialConversationId={conversationTargetId}
        onNavigate={openStaffDestination}
      />
    );
  else if (tab === "conversations" && directConversation)
    content = (
      <SupportInbox profile={profile} scope={scope} initialConversationId={conversationTargetId} onNavigate={openStaffDestination} />
    );
  else if (tab === "conversations" && module === "field_officer")
    content = (
      <SupportInbox profile={profile} scope={scope} queue="field_operations" initialConversationId={conversationTargetId} onNavigate={openStaffDestination} />
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
  const activeDescription =
    tab === "bookings"
      ? "Continue exact reservations through arrival, verified handover, active tenancy and completion."
      : tab === "conversations"
        ? "Messages are conversations. Activity contains official updates and work that needs action."
        : tab === "home"
          ? `See today’s ${copy.title.toLowerCase()} work and priorities.`
          : copy.description;
  return (
    <>
      <Toaster position="top-center" richColors />
      <WorkspaceFrameV2
        label={`WEHOUSE TEAM · ${copy.title}`}
        title={activeLabel}
        description={`${activeDescription} · ${branch}`}
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
  initialConversationId,
  onNavigate,
}: {
  profile: Profile;
  scope: { state: string; lga: string };
  summary: ReturnType<typeof useOperationsInboxSummary>;
  openProperties: (id?: string) => void;
  initialConversationId?: string;
  onNavigate?: (page: string, id?: string) => void;
}) {
  function navigate(page: string, id?: string) {
    if (/operations_properties|staff_inspections|inspection|propert/.test(page))
      return openProperties(id);
    onNavigate?.(page, id);
  }
  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between border-b border-white/[.06] pb-3">
          <div><h2 className="text-xs font-semibold">Activity</h2><p className="mt-1 text-[9px] text-[#707687]">Branch work updates linked to their records.</p></div>
          {summary.activityUnread > 0 ? <span className="rounded-full bg-violet-500/12 px-2 py-1 text-[8px] font-semibold text-violet-300">{summary.activityUnread} new</span> : null}
        </div>
        <Notifications
          profile={profile}
          scope="staff"
          embedded
          compact
          previewLimit={3}
          onUnreadChange={summary.refresh}
          onNavigate={navigate}
        />
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between border-b border-white/[.06] pb-3">
          <div><h2 className="text-xs font-semibold">Messages</h2><p className="mt-1 text-[9px] text-[#707687]">Assigned property and Operations conversations.</p></div>
          {summary.messageUnread > 0 ? <span className="rounded-full bg-violet-500/12 px-2 py-1 text-[8px] font-semibold text-violet-300">{summary.messageUnread} new</span> : null}
        </div>
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
      </section>
    </div>
  );
}
function SupportInbox({
  profile,
  scope,
  queue = "support",
  initialConversationId,
  onNavigate,
}: {
  profile: Profile;
  scope: { state: string; lga: string };
  queue?: "support" | "field_operations";
  initialConversationId?: string;
  onNavigate?: (page: string, id?: string) => void;
}) {
  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 border-b border-white/[.06] pb-3"><h2 className="text-xs font-semibold">Activity</h2><p className="mt-1 text-[9px] text-[#707687]">Official updates for this work area.</p></div>
        <Notifications
          profile={profile}
          scope="staff"
          embedded
          compact
          previewLimit={3}
          onNavigate={(page, id) => onNavigate?.(page, id)}
        />
      </section>
      <section>
        <div className="mb-3 border-b border-white/[.06] pb-3"><h2 className="text-xs font-semibold">Messages</h2><p className="mt-1 text-[9px] text-[#707687]">Assigned conversations in one queue.</p></div>
          <CommunicationsWorkspace
            profile={profile}
            scope={scope}
            forcedView="inbox"
            hideViewTabs
            queue={queue}
            initialConversationId={initialConversationId}
            onOpenContext={(page, id)=>onNavigate?.(page, id)}
          />
      </section>
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
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-white/[.06] pb-3">
        <div><h2 className="text-xs font-semibold">Activity</h2><p className="mt-1 text-[9px] text-[#707687]">Updates for this authorized work area.</p></div>
        {unread > 0 ? <span className="rounded-full bg-violet-500/12 px-2 py-1 text-[8px] font-semibold text-violet-300">{unread} new</span> : null}
      </div>
        <Notifications
          profile={profile}
          scope="staff"
          embedded
          onUnreadChange={onUnreadChange}
          onNavigate={onNavigate}
        />
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
