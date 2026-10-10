import { internalActivityDestination } from "@/lib/internalActivityDestination";
import { useRecordScreenBack } from "@/hooks/useRecordScreenBack";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import UserProfileModal from "@/components/UserProfileModal";
import CommunicationsWorkspace from "@/components/CommunicationsWorkspace";
import PropertyPipelineWorkspace from "@/components/PropertyPipelineWorkspace";
import WorkerReviewIdentityStatus from "@/components/WorkerReviewIdentityStatus";
import InlineFilterChips from "@/components/InlineFilterChips";
import { canonicalStatusOptions } from "@/lib/status";
import { workerOccupation } from "@/lib/workerTaxonomy";
import StaffListTab from "./StaffListTab";
import WorkspaceFrameV2 from "@/components/WorkspaceFrameV2";
import WorkspaceSectionHeading from "@/components/WorkspaceSectionHeading";
import Notifications from "./Notifications";
import { useCreatorInboxSummary } from "@/hooks/useCreatorInboxSummary";
import HousingOperationsWorkspace from "@/components/HousingOperationsWorkspace";
import type { Profile } from "@/types";
import VideoPlayer from "@/components/VideoPlayer";
import WeHouseSelect from "@/components/WeHouseSelect";
import AccountIdentityReviewQueue from "@/components/AccountIdentityReviewQueue";
import InboxActivityEntry from "@/components/InboxActivityEntry";
import AdminSecurityCases from "@/components/AdminSecurityCases";
import BackButton from "@/components/BackButton";

type AdminTab = "overview" | "operations" | "inbox";
type Operation = "people" | "staff" | "properties" | "workers" | "bookings" | "security";
type OperationTarget = { operation: Operation; id?: string } | null;
type PersonFilter = "user" | "property_partner";
type Props = {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string, id?: string) => void;
  onGoToChat?: (convId?: string) => void;
};
const NAV = [
  { id: "overview", label: "Overview" },
  { id: "operations", label: "Operations" },
  { id: "inbox", label: "Inbox" },
];
const OPS: [Operation, string, string][] = [
  ["people", "People", "Regular users and Property Partners in your coverage"],
  ["staff", "Team", "Operations members in your coverage"],
  ["properties", "Property Operations", "Property submissions, visits and publishing"],
  [
    "workers",
    "Worker Operations",
    "Worker onboarding and professional evidence review",
  ],
  [
    "bookings",
    "Bookings",
    "Worker services, apartment reservations and hotel stays",
  ],
  [
    "security",
    "Security Operations",
    "Security Operations escalations and account decisions in your coverage",
  ],
];
export default function AdminDashboard({
  profile,
  onLogout,
  onNavigate,
  onGoToChat,
}: Props) {
  const [tab, setTab] = useState<AdminTab>("overview"),
    [operation, setOperation] = useState<Operation | null>(null),
    [operationTarget, setOperationTarget] = useState<OperationTarget>(null),
    [inboxTargetId, setInboxTargetId] = useState<string | undefined>(),
    [stats, setStats] = useState<any>({
      users: 0,
      workers: 0,
      partners: 0,
      staff: 0,
      admins: 0,
      listings: 0,
      pending_verifications: 0,
    }),
    [viewing, setViewing] = useState<Profile | null>(null);
  const coverageReady = Boolean(profile.assigned_state),
    inboxSummary = useCreatorInboxSummary(profile.user_id, "admin");
  async function loadStats() {
    if (!coverageReady) return;
    const { data, error } = await supabase.rpc("admin_get_my_branch_stats");
    if (error) return void toast.error(error.message);
    setStats(data || {});
  }
  useEffect(() => {
    void loadStats();
  }, [coverageReady, profile.assigned_state, profile.assigned_lga]);
  const [inboxVisited, setInboxVisited] = useState(false);
  const [returnToInbox, setReturnToInbox] = useState(false);
  useEffect(() => { if (tab === "inbox") setInboxVisited(true); }, [tab]);
  const closeOperation = useRecordScreenBack(() => {
    setOperation(null); setOperationTarget(null);
    if (returnToInbox) setTab("inbox");
    setReturnToInbox(false);
  }, tab === "operations" && Boolean(operation));
  function openOperation(next: Operation, id?: string) {
    setReturnToInbox(tab === "inbox");
    setOperationTarget({ operation: next, id });
    setOperation(next);
    setTab("operations");
  }
  function openActivity(page: string, id?: string) {
    const route = String(page || "").toLowerCase().replace(/-/g, "_");
    if (["conversation", "messages", "chat", "operations_inbox"].includes(route)) {
      setInboxTargetId(id); setTab("inbox"); return;
    }
    const target = internalActivityDestination(route, id);
    if (target?.operation === "finance") { toast.error("Open Finance Operations from an authorised workspace for this record."); return; }
    if (target) { openOperation(target.operation, target.id); return; }
    if (["profile", "privacy", "security", "devices", "privacy_policy", "terms_of_service"].includes(route)) { onNavigate?.(route, id); return; }
    toast.error("This update cannot be opened in the current workspace. Your workspace has not changed.");
  }

  const nav = NAV.map((item) =>
    item.id === "inbox" ? { ...item, badge: inboxSummary.totalUnread } : item,
  );
  const currentOperation = operation ? OPS.find(([id]) => id === operation) : null;
  const workspaceTitle = tab === "operations" && currentOperation ? currentOperation[1] : NAV.find((item) => item.id === tab)?.label || "Admin";
  return (
    <>

      <WorkspaceFrameV2
        identityName={profile.full_name || profile.username}
        identityAvatar={profile.avatar_url}
        label={`WEHOUSE TEAM · ${profile.assigned_lga ? "LGA ADMIN" : "STATE ADMIN"} · ${profile.assigned_lga || profile.assigned_state || "UNASSIGNED"}`}
        title={workspaceTitle}
        onBack={tab === "operations" && operation ? closeOperation : undefined}
        backLabel={returnToInbox ? "Back to Inbox" : "Back to work areas"}
        items={nav}
        active={tab}
        setActive={(id) => {
          const next = id as AdminTab;
          setTab(next);
          if (next === "operations") {
            setOperation(null);
            setOperationTarget(null);
          }
        }}
        onAccount={onNavigate ? () => onNavigate("profile") : undefined}
        onLogout={onLogout}
        compact={tab === "inbox"}
      >
        {!coverageReady ? (
          <CoverageMissing />
        ) : (
          <>
            {tab === "overview" && (
              <Overview
                stats={stats}
                profile={profile}
                openOperation={openOperation}
                inboxUnread={inboxSummary.totalUnread}
                openCommunications={() => setTab("inbox")}
              />
            )}{" "}
            {tab === "operations" && (
              <Operations
                profile={profile}
                stats={stats}
                active={operation}
                target={operationTarget}
                setActive={(next) => {
                  setOperation(next);
                  if (!next) setOperationTarget(null);
                }}
                onView={setViewing}
                onRefreshStats={loadStats}
                onExitRecord={returnToInbox ? closeOperation : undefined}
              />
            )}{" "}
            {(tab === "inbox" || inboxVisited) && <div hidden={tab !== "inbox"} inert={tab !== "inbox"}>
              <AdminInbox
                profile={profile}
                summary={inboxSummary}
                onNavigate={openActivity}
                initialConversationId={inboxTargetId}
              />
            </div>}
          </>
        )}
      </WorkspaceFrameV2>
      {viewing && (
        <UserProfileModal
          user={viewing}
          adminProfile={profile}
          onClose={() => setViewing(null)}
          onPromote={() => {
            setViewing(null);
            openOperation("staff");
            void loadStats();
          }}
          onNavigate={openActivity}
          onGoToChat={onGoToChat}
        />
      )}
    </>
  );
}

function AdminInbox({
  profile,
  summary,
  onNavigate,
  initialConversationId,
}: {
  profile: Profile;
  summary: ReturnType<typeof useCreatorInboxSummary>;
  onNavigate: (page: string, id?: string) => void;
  initialConversationId?: string;
}) {
  const [activityOpen, setActivityOpen] = useState(false);

  useEffect(() => {
    if (initialConversationId) setActivityOpen(false);
  }, [initialConversationId]);

  if (activityOpen) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 border-b border-[var(--wh-border-subtle)] pb-3">
          <BackButton onClick={() => setActivityOpen(false)} ariaLabel="Back to Inbox messages" />
          <div className="min-w-0">
            <p className="text-[8px] font-bold uppercase tracking-[.14em] text-violet-300">
              Inbox
            </p>
            <h2 className="text-sm font-semibold">Activity</h2>
          </div>
        </div>
        <Notifications
          profile={profile}
          scope="admin"
          embedded
          onUnreadChange={summary.setActivityUnread}
          onNavigate={onNavigate}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--wh-border-subtle)] pb-2">
        <div>
          <h2 className="text-xs font-semibold">Messages</h2>
          <p className="mt-0.5 text-[9px] text-[var(--wh-text-muted)]">
            Assigned conversations in your coverage.
          </p>
        </div>
        <InboxActivityEntry
          compact
          unread={summary.activityUnread}
          onOpen={() => setActivityOpen(true)}
        />
      </div>
      <CommunicationsWorkspace
        profile={profile}
        scope={{ state: profile.assigned_state!, lga: profile.assigned_lga || "" }}
        forcedView="inbox"
        hideViewTabs
        queue="all"
        initialConversationId={initialConversationId}
        onOpenContext={onNavigate}
        onUnreadChange={summary.setMessageUnread}
      />
    </div>
  );
}
function Overview({
  stats,
  profile,
  openOperation,
  inboxUnread,
  openCommunications,
}: {
  stats: any;
  profile: Profile;
  openOperation: (t: Operation) => void;
  inboxUnread: number;
  openCommunications: () => void;
}) {
  const fmt = (value: unknown) => Number(value || 0).toLocaleString("en-NG");
  const cards: { label: string; value: number; target: Operation; note: string; tone: string; mark: string }[] = [
    { label: "Users", value: Number(stats.users || 0), target: "people", note: "Personal accounts in your coverage", tone: "violet", mark: "↗" },
    { label: "Property Partners", value: Number(stats.partners || 0), target: "people", note: "Accommodation providers", tone: "blue", mark: "⌂" },
    { label: "Team", value: Number(stats.staff || 0) + Number(stats.admins || 0), target: "staff", note: "Admins and Operations members", tone: "teal", mark: "✳" },
    { label: "Properties", value: Number(stats.listings || 0), target: "properties", note: "Published inventory in this coverage", tone: "amber", mark: "▦" },
    { label: "Workers", value: Number(stats.workers || 0), target: "workers", note: `${fmt(stats.pending_verifications)} waiting for review`, tone: "violet", mark: "✓" },
  ];
  const attention = [
    Number(stats.pending_verifications || 0) > 0
      ? { key: "workers", label: "Worker review", detail: `${fmt(stats.pending_verifications)} Worker${Number(stats.pending_verifications) === 1 ? "" : "s"} waiting for a decision`, action: () => openOperation("workers"), count: Number(stats.pending_verifications) }
      : null,
    inboxUnread > 0
      ? { key: "inbox", label: "Inbox & Activity", detail: `${fmt(inboxUnread)} unread conversation${inboxUnread === 1 ? "" : "s"} or Activity item${inboxUnread === 1 ? "" : "s"}`, action: openCommunications, count: inboxUnread }
      : null,
  ].filter(Boolean) as Array<{ key: string; label: string; detail: string; action: () => void; count: number }>;
  const coverage = profile.assigned_lga ? `${profile.assigned_lga}, ${profile.assigned_state}` : `${profile.assigned_state} State`;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-violet-500/20 bg-[radial-gradient(ellipse_at_90%_0%,rgba(124,92,255,.16),transparent_42%),linear-gradient(125deg,rgba(124,92,255,.07),var(--wh-surface)_52%,var(--wh-bg))] p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-violet-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,.12)]" /> Operations workspace</span>
          <span className="rounded-full border border-[var(--wh-border)] px-3 py-1.5 text-[10px] text-[var(--wh-text-muted)]">Scoped access · Admin</span>
        </div>
        <p className="mt-5 text-xs font-semibold text-[var(--wh-text-muted)]">YOUR COVERAGE</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{coverage}</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--wh-text-secondary)]">Keep local marketplace operations moving. This workspace only exposes records and actions within your Creator-assigned State or LGA coverage.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={() => openOperation("workers")} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-500 px-4 text-xs font-bold text-white transition hover:bg-violet-400">Review Workers <span aria-hidden="true">→</span></button>
          <button type="button" onClick={openCommunications} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--wh-border)] bg-white/[.025] px-4 text-xs font-bold transition hover:bg-white/[.06]">Open Inbox <span aria-hidden="true">↗</span></button>
        </div>
      </section>

      <section aria-label="Coverage metrics" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {cards.map((card, index) => (
          <button key={card.label} type="button" onClick={() => openOperation(card.target)} className="group min-w-0 rounded-2xl border border-[var(--wh-border-subtle)] bg-[linear-gradient(145deg,rgba(255,255,255,.035),transparent_75%),var(--wh-surface)] p-4 text-left transition hover:-translate-y-0.5 hover:border-violet-400/30" style={{ animationDelay: `${index * 35}ms` }}>
            <span className="flex items-center justify-between gap-2"><span className="text-[11px] font-semibold text-[var(--wh-text-secondary)]">{card.label}</span><span className={`grid h-8 w-8 place-items-center rounded-xl text-sm ${card.tone === "blue" ? "bg-blue-400/10 text-blue-300" : card.tone === "teal" ? "bg-teal-400/10 text-teal-300" : card.tone === "amber" ? "bg-amber-400/10 text-amber-300" : "bg-violet-400/10 text-violet-300"}`} aria-hidden="true">{card.mark}</span></span>
            <strong className="mt-5 block text-3xl font-semibold tracking-tight tabular-nums">{fmt(card.value)}</strong>
            <span className="mt-2 block min-h-9 text-[11px] leading-5 text-[var(--wh-text-muted)]">{card.note}</span>
            <span className="mt-3 flex items-center justify-between border-t border-[var(--wh-border-subtle)] pt-3 text-[10px] font-bold text-[var(--wh-accent-text)]">Open area <span aria-hidden="true" className="transition group-hover:translate-x-0.5">→</span></span>
          </button>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,.75fr)]">
        <section className="overflow-hidden rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--wh-border-subtle)] pb-4"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-violet-300">ACTION QUEUE</p><h3 className="mt-1 text-lg font-semibold">Needs attention</h3><p className="mt-1 text-xs text-[var(--wh-text-muted)]">Only items with an action available to this Admin.</p></div><span className="rounded-full border border-[var(--wh-border-subtle)] px-2.5 py-1 text-[10px] text-[var(--wh-text-muted)]">{attention.length} queues</span></div>
          {attention.length ? <div className="divide-y divide-[var(--wh-border-subtle)]">{attention.map(item => <button key={item.key} type="button" onClick={item.action} className="flex min-h-[5.25rem] w-full items-center gap-3 py-3 text-left transition hover:bg-[var(--wh-interactive)]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-amber-400/20 bg-amber-400/[.07] text-sm font-bold text-amber-300">{item.count}</span><span className="min-w-0 flex-1"><strong className="block text-sm font-semibold">{item.label}</strong><span className="mt-1 block text-xs leading-5 text-[var(--wh-text-muted)]">{item.detail}</span></span><span className="text-[var(--wh-text-muted)]">→</span>
          </button>)}</div> : <div className="py-7"><p className="text-sm font-semibold">You’re up to date</p><p className="mt-1 text-xs leading-5 text-[var(--wh-text-muted)]">No Worker reviews or unread Inbox items currently require attention in this coverage.</p></div>}
        </section>

        <section className="overflow-hidden rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 sm:p-5">
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-violet-300">QUICK ACCESS</p><h3 className="mt-1 text-lg font-semibold">Operational areas</h3><p className="mt-1 text-xs leading-5 text-[var(--wh-text-muted)]">Go straight to the work without navigating through unrelated sections.</p>
          <div className="mt-4 space-y-1">
            {[
              { label: "Property lifecycle", note: "Submissions, inspections and publishing", target: "properties" as Operation, icon: "⌂" },
              { label: "Worker Operations", note: "Review and service marketplace status", target: "workers" as Operation, icon: "✳" },
              { label: "Team access", note: "Admins and assigned Operations members", target: "staff" as Operation, icon: "◎" },
            ].map(item => <button key={item.target} type="button" onClick={() => openOperation(item.target)} className="flex min-h-[4.5rem] w-full items-center gap-3 rounded-xl px-2 text-left transition hover:bg-[var(--wh-interactive)]">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[var(--wh-border-subtle)] bg-white/[.025] text-sm text-violet-300">{item.icon}</span><span className="min-w-0 flex-1"><strong className="block text-xs font-semibold">{item.label}</strong><span className="mt-1 block text-[10px] leading-4 text-[var(--wh-text-muted)]">{item.note}</span></span><span className="text-[var(--wh-text-muted)]">→</span>
            </button>)}
          </div>
          <button type="button" onClick={openCommunications} className="mt-3 flex min-h-11 w-full items-center justify-between border-t border-[var(--wh-border-subtle)] pt-3 text-left text-xs font-bold text-[var(--wh-accent-text)]">Inbox & Activity <span aria-hidden="true">↗</span></button>
        </section>
      </div>
      <p className="text-[10px] leading-5 text-[var(--wh-text-muted)]">Coverage is enforced by the platform. Location accuracy helps operations but never grants access beyond your assigned area.</p>
    </div>
  );
}

function Operations({
  profile,
  stats,
  active,
  target,
  setActive,
  onView,
  onRefreshStats,
  onExitRecord,
}: {
  onExitRecord?: () => void;
  profile: Profile;
  stats: any;
  active: Operation | null;
  target: OperationTarget;
  setActive: (t: Operation | null) => void;
  onView: (p: Profile) => void;
  onRefreshStats: () => Promise<void> | void;
}) {
  if (!active) {
    const counts: Partial<Record<Operation, string>> = {
      people: `${Number(stats.users || 0) + Number(stats.partners || 0)} accounts`,
      staff: `${Number(stats.staff || 0) + Number(stats.admins || 0)} team members`,
      properties: `${Number(stats.listings || 0)} live properties`,
      workers: stats.pending_verifications
        ? `${stats.pending_verifications} of ${stats.workers || 0} need review`
        : `${stats.workers || 0} Workers`,
    };
    return (
      <div className="space-y-5">
        <header className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[radial-gradient(ellipse_at_100%_0%,rgba(124,92,255,.12),transparent_48%),var(--wh-surface)] p-5 sm:p-6">
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-violet-300">LOCAL CONTROL</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">Operations directory</h2>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--wh-text-secondary)]">Choose a focused workspace for your assigned coverage. Each record has one canonical home, so the same task is not repeated across sections.</p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {OPS.map(([id, label, note], index) => (
            <button key={id} type="button" onClick={() => setActive(id)} className="group flex min-h-[8.25rem] min-w-0 flex-col rounded-2xl border border-[var(--wh-border-subtle)] bg-[linear-gradient(145deg,rgba(255,255,255,.025),transparent_75%),var(--wh-surface)] p-4 text-left transition hover:-translate-y-0.5 hover:border-violet-400/30" style={{ animationDelay: `${index * 30}ms` }}>
              <span className="flex w-full items-start justify-between gap-3"><strong className="text-sm font-semibold">{label}</strong><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-[var(--wh-border-subtle)] bg-white/[.025] text-sm text-violet-300 transition group-hover:bg-violet-500/10">↗</span></span>
              <span className="mt-2 block text-xs leading-5 text-[var(--wh-text-muted)]">{note}</span>
              <span className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4"><span className="text-[10px] font-semibold text-[var(--wh-accent-text)]">{counts[id] || "Scoped workspace"}</span><span className="text-[10px] font-bold text-[var(--wh-accent-text)]">Open →</span></span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {active === "people" && <People onView={onView} />}{" "}
      {active === "staff" && <StaffListTab profile={profile} />}{" "}
      {active === "properties" && (
        <PropertyPipelineWorkspace
          onExitRecord={onExitRecord}
          profile={profile}
          initialRecordId={target?.operation === "properties" ? target.id : undefined}
        />
      )}{" "}
      {active === "workers" && <Workers onChanged={onRefreshStats} />}{" "}
      {active === "bookings" && (
        <BookingsWorkspace
          initialRecordId={target?.operation === "bookings" ? target.id : undefined}
        />
      )}{" "}
      {active === "security" && (
        <AdminSecurityCases
          onViewAccount={onView}
          initialCaseId={target?.operation === "security" ? target.id : undefined}
        />
      )}{" "}
    </div>
  );
}
function People({ onView }: { onView: (p: Profile) => void }) {
  const [role, setRole] = useState<PersonFilter>("user"),
    [rows, setRows] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState("");
  useEffect(() => {
    void load();
  }, [role]);
  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_get_my_branch_profiles", {
      p_role: role,
    });
    if (error) toast.error(error.message);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          !search.trim() ||
          [r.full_name, r.username, r.email, r.user_id]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [rows, search],
  );
  return (
    <Section
      title={role === "property_partner" ? "Property Partners" : "People"}
      note={role === "property_partner"
        ? "Partner account and identity review lives here. Property records stay in Property Operations."
        : "Personal accounts in your coverage. Workers and WeHouse Team members stay in their own work areas."}
    >
      {role === "property_partner" ? <AccountIdentityReviewQueue accountRole="property_partner" /> : null}
      <div className="flex gap-2">
        {(
          [
            ["user", "Users"],
            ["property_partner", "Property Partners"],
          ] as const
        ).map(([id, label]) => (
          <Chip key={id} active={role === id} onClick={() => setRole(id)}>
            {label}
          </Chip>
        ))}
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search this coverage"
        className="h-11 w-full rounded-xl border border-white/[0.08] bg-[var(--wh-elevated)] px-3 text-xs"
      />
      {loading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <Empty
          title="No matching accounts"
          text="Nothing in this coverage matches the filter."
        />
      ) : (
        <div className="divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
          {filtered.map((p) => (
            <button
              key={p.user_id}
              onClick={() => onView(p)}
              className="flex w-full items-center gap-3 py-3 text-left"
            >
              <div className="flex gap-3">
                <Avatar text={p.full_name || p.username || p.email} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {p.full_name || p.username || "WeHouse account"}
                  </p>
                  <p className="truncate text-[10px] text-[var(--wh-text-muted)]">
                    {p.email}
                  </p>
                  <p className="mt-1 text-[9px] capitalize text-[var(--wh-text-muted)]">
                    {p.role?.replace(/_/g, " ")}
                  </p>
                </div><span className="text-[var(--wh-text-muted)]">›</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}
function Workers({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const [rows, setRows] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<any | null>(null),
    [reason, setReason] = useState("");
  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_get_my_branch_profiles", {
      p_role: "worker",
    });
    if (error) toast.error(error.message);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);
  const statusOptions = useMemo(
    () =>
      canonicalStatusOptions(
        rows.map((worker) =>
          worker.suspended ? "suspended" : worker.worker_status || "pending",
        ),
      ),
    [rows],
  );
  useEffect(() => {
    if (!statusOptions.some((option) => option.value === filter))
      setFilter("all");
  }, [filter, statusOptions]);
  const shown =
    filter === "all"
      ? rows
      : rows.filter(
          (worker) =>
            (worker.suspended
              ? "suspended"
              : worker.worker_status || "pending") === filter,
        );
  async function review(id: string, decision: "approve" | "reject") {
    if (decision === "reject" && !reason.trim())
      return toast.error("Enter a rejection reason");
    const { error } = await supabase.rpc("admin_review_my_branch_worker", {
      p_worker_id: id,
      p_decision: decision,
      p_reason: decision === "reject" ? reason.trim() : null,
    });
    if (error) return toast.error(error.message);
    toast.success(
      decision === "approve" ? "Worker verified" : "Worker rejected",
    );
    setSelected(null);
    setReason("");
    await load();
    await onChanged();
  }
  if (selected)
    return (
      <Section
        title="Worker review"
        note="Service details, professional evidence and private identity screening."
      >
        <button
          onClick={() => {
            setSelected(null);
            setReason("");
          }}
          className="text-[10px] font-semibold text-violet-400"
        >
          ← Back to workers
        </button>
        <Card>
          <Top
            title={selected.full_name || selected.username || "Worker"}
            sub={`${workerOccupation(selected)} · ${[selected.local_government || selected.city, selected.state].filter(Boolean).join(", ")}`}
            status={selected.worker_status}
          />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <WorkerReviewIdentityStatus workerId={selected.user_id} />
            {selected.worker_video_url ? (
              <Video title="Skill video" url={selected.worker_video_url} />
            ) : (
              <Missing label="Skill video" />
            )}
          </div>
          {selected.worker_status === "profile_under_review" && (
            <div className="mt-4 space-y-2">
              <p className="text-[9px] leading-relaxed text-[var(--wh-text-muted)]">
                Approval is enforced by the server and remains blocked until the
                identity screening evidence is ready for WeHouse review.
              </p>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Rejection reason if rejecting"
                className="h-10 w-full rounded-xl border border-white/[0.08] bg-[var(--wh-elevated)] px-3 text-xs"
              />
              <div className="flex gap-2">
                <Button onClick={() => review(selected.user_id, "approve")}>
                  Verify worker
                </Button>
                <Button
                  danger
                  onClick={() => review(selected.user_id, "reject")}
                >
                  Reject
                </Button>
              </div>
            </div>
          )}
        </Card>
      </Section>
    );
  return (
    <Section
      title="Workers"
      note="Worker lifecycle review lives here. Availability is controlled only by the Worker and is not part of this filter."
    >
      <InlineFilterChips
        value={filter}
        options={statusOptions}
        onChange={setFilter}
        ariaLabel="Show workers by lifecycle"
      />
      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Empty title="No workers" text="No workers match this view." />
      ) : (
        <div className="divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
          {shown.map((w) => (
            <button
              key={w.user_id}
              onClick={() => setSelected(w)}
              className="flex min-h-[4.5rem] w-full items-center gap-3 py-3 text-left"
            >
              <Avatar text={w.full_name || w.username || "Worker"} />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm font-semibold">{w.full_name || w.username || "Worker"}</strong>
                <span className="mt-1 block truncate text-[9px] text-[var(--wh-text-muted)]">
                  {workerOccupation(w)} · {[w.local_government || w.city, w.state].filter(Boolean).join(", ")}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[9px] capitalize text-[var(--wh-text-secondary)]">{String(w.suspended ? "suspended" : w.worker_status || "pending").replace(/_/g, " ")}</span>
                <span className="mt-1 block text-violet-300">›</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}
function BookingsWorkspace({ initialRecordId }: { initialRecordId?: string }) {
  const [domain, setDomain] = useState<"services" | "apartments" | "hotels">(
    initialRecordId ? "apartments" : "services",
  );
  useEffect(() => {
    if (initialRecordId) setDomain("apartments");
  }, [initialRecordId]);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 border-y border-[var(--wh-border-subtle)] py-3">
        <div><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[var(--wh-text-muted)]">Record type</p><p className="mt-1 text-[9px] text-[var(--wh-text-secondary)]">One booking type at a time</p></div>
        <WeHouseSelect value={domain} options={[{ value: "services", label: "Worker services" }, { value: "apartments", label: "Apartments" }, { value: "hotels", label: "Hotels" }]} onChange={setDomain} eyebrow="Bookings" title="Record type" ariaLabel="Filter booking records by type" />
      </div>
      {domain === "services" ? (
        <ServiceBookings />
      ) : domain === "apartments" ? (
        <HousingOperationsWorkspace initialRecordId={initialRecordId} />
      ) : (
        <HotelBookings />
      )}
    </div>
  );
}
function ServiceBookings() {
  const [rows, setRows] = useState<any[]>([]),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_my_branch_worker_bookings",
      );
      if (error) toast.error(error.message);
      setRows(Array.isArray(data) ? data : []);
      setLoading(false);
    })();
  }, []);
  return (
    <Section
      title="Worker service bookings"
      note="Worker service bookings in your coverage."
    >
      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty
          title="No service bookings"
          text="There are no Worker service bookings in this coverage."
        />
      ) : (
        <div className="divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
          {rows.map((r) => (
            <div key={r.id} className="flex min-h-[4.5rem] items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm font-semibold">{r.service_name || r.service || "Service booking"}</strong>
                <span className="mt-1 block truncate text-[9px] text-[var(--wh-text-muted)]">{r.booking_code || r.id} · {dateText(r.created_at)}</span>
              </span>
              <span className="shrink-0 text-right">
                {r.agreed_amount ? <strong className="block text-xs">{money(r.agreed_amount)}</strong> : null}
                <span className="mt-1 block text-[9px] capitalize text-[var(--wh-text-secondary)]">{String(r.status || "pending").replace(/_/g, " ")}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
function HotelBookings() {
  const [rows, setRows] = useState<any[]>([]),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("hotel_bookings")
        .select(
          "booking_id,booking_code,status,payment_status,total_price,check_in,check_out,guest_name,created_at,hotels(name,city,state),hotel_rooms(room_type)",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) toast.error(error.message);
      setRows(data || []);
      setLoading(false);
    })();
  }, []);
  return (
    <Section
      title="Hotel stays"
      note="Hotel reservations remain separate from apartments and Worker services."
    >
      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty
          title="No hotel stays"
          text="There are no hotel reservations in this coverage."
        />
      ) : (
        <div className="divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
          {rows.map((row) => (
            <article key={row.booking_id} className="py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {row.guest_name || "Guest"}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-[var(--wh-text-secondary)]">
                    {(row.hotels as any)?.name || "Hotel"} ·{" "}
                    {(row.hotel_rooms as any)?.room_type || "Room"}
                  </p>
                  <p className="mt-1 text-[9px] text-[var(--wh-text-muted)]">
                    {row.check_in
                      ? new Date(row.check_in).toLocaleDateString()
                      : "—"}{" "}
                    →{" "}
                    {row.check_out
                      ? new Date(row.check_out).toLocaleDateString()
                      : "—"}{" "}
                    · {row.booking_code || "Code unavailable"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-bold">{money(row.total_price)}</p>
                  <Badge
                    value={row.status || row.payment_status || "pending"}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </Section>
  );
}
function CoverageMissing() {
  return (
    <div className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.05] p-8 text-center">
      <p className="text-sm font-semibold text-amber-300">
        Coverage assignment required
      </p>
      <p className="mx-auto mt-2 max-w-md text-[10px] text-[var(--wh-text-muted)]">
        Creator must assign this Admin to a State or one LGA before operations become available.
      </p>
    </div>
  );
}
function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <WorkspaceSectionHeading title={title} description={note} />
      {children}
    </div>
  );
}
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[var(--wh-surface)] p-4">
      {children}
    </div>
  );
}
function Top({
  title,
  sub,
  status,
  right,
}: {
  title: string;
  sub: string;
  status: string;
  right?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="mt-1 line-clamp-2 text-[10px] text-[var(--wh-text-muted)]">{sub}</p>
      </div>
      <div className="shrink-0 text-right">
        {right && <p className="mb-1 text-sm font-bold">{right}</p>}
        <Badge value={status} />
      </div>
    </div>
  );
}
function Badge({ value }: { value: string }) {
  const t = String(value || "unknown").toLowerCase();
  const good = [
      "available",
      "active",
      "approved",
      "completed",
      "resolved",
      "verified",
      "paid",
    ].some((x) => t.includes(x)),
    bad = ["rejected", "suspended", "failed", "cancelled"].some((x) =>
      t.includes(x),
    );
  return (
    <span
      className={`rounded-full px-2 py-1 text-[8px] font-semibold capitalize ${good ? "bg-emerald-500/10 text-emerald-300" : bad ? "bg-red-500/10 text-red-300" : "bg-amber-500/10 text-amber-300"}`}
    >
      {t.replace(/_/g, " ")}
    </span>
  );
}
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-xl px-3 py-2 text-[10px] font-semibold ${active ? "bg-violet-500 text-white" : "border border-white/[0.06] bg-[var(--wh-surface)] text-[var(--wh-text-muted)]"}`}
    >
      {children}
    </button>
  );
}
function Button({
  children,
  onClick,
  danger,
  secondary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  secondary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`min-h-10 flex-1 rounded-xl px-3 text-[10px] font-semibold ${danger ? "border border-red-500/20 bg-red-500/10 text-red-300" : secondary ? "border border-white/[0.08] bg-white/[0.04] text-[var(--wh-text-secondary)]" : "bg-violet-500 text-white"}`}
    >
      {children}
    </button>
  );
}
function Avatar({ text }: { text: string }) {
  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-600 text-sm font-bold">
      {(text || "W")[0].toUpperCase()}
    </div>
  );
}
function Video({ title, url }: { title: string; url: string }) {
  return (
    <div>
      <p className="mb-2 text-[9px] text-[var(--wh-text-muted)]">{title}</p>
      <VideoPlayer src={url} className="max-h-60 w-full rounded-xl bg-[var(--wh-elevated)] object-contain" />
    </div>
  );
}
function Missing({ label }: { label: string }) {
  return (
    <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-red-500/20 bg-red-500/[0.03] text-[10px] text-red-300">
      No {label} uploaded
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-12 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-[10px] text-[var(--wh-text-muted)]">{text}</p>
    </div>
  );
}
function Loading() {
  return (
    <div className="grid min-h-40 place-items-center">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
    </div>
  );
}
function money(v: any) {
  return `₦${Number(v || 0).toLocaleString("en-NG")}`;
}
function dateText(v: any) {
  if (!v) return "Date unavailable";
  try {
    return new Date(v).toLocaleDateString();
  } catch {
    return String(v);
  }
}
