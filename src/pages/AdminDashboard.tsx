import { useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
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
import InboxTabs from "@/components/InboxTabs";
import Notifications from "./Notifications";
import { useCreatorInboxSummary } from "@/hooks/useCreatorInboxSummary";
import HousingOperationsWorkspace from "@/components/HousingOperationsWorkspace";
import type { Profile } from "@/types";
import VideoPlayer from "@/components/VideoPlayer";

type AdminTab = "home" | "operations" | "inbox";
type Operation = "people" | "staff" | "properties" | "workers" | "bookings";
type OperationTarget = { operation: Operation; id?: string } | null;
type PersonFilter = "user" | "property_partner";
type Props = {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string, id?: string) => void;
  onGoToChat?: (convId?: string) => void;
};
const NAV = [
  { id: "home", label: "Home" },
  { id: "operations", label: "Operations" },
  { id: "inbox", label: "Inbox" },
];
const NOTES: Record<AdminTab, string> = {
  home: "Branch health and work that needs attention.",
  operations:
    "People, team, properties, workers and bookings in one branch workspace.",
  inbox: "Assigned branch conversations and Activity that require awareness.",
};
const OPS: [Operation, string, string][] = [
  ["people", "People", "Regular users and Property Partners in this branch"],
  ["staff", "Team", "Admins and Operations members in this branch"],
  ["properties", "Properties", "Property submissions, visits and publishing"],
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
];
export default function AdminDashboard({
  profile,
  onLogout,
  onNavigate,
  onGoToChat,
}: Props) {
  const [tab, setTab] = useState<AdminTab>("home"),
    [operation, setOperation] = useState<Operation | null>(null),
    [operationTarget, setOperationTarget] = useState<OperationTarget>(null),
    [inboxTargetId, setInboxTargetId] = useState<string | undefined>(),
    [stats, setStats] = useState<any>({
      users: 0,
      workers: 0,
      partners: 0,
      staff: 0,
      listings: 0,
      pending_verifications: 0,
    }),
    [viewing, setViewing] = useState<Profile | null>(null);
  const branchReady = Boolean(profile.assigned_state && profile.assigned_lga),
    inboxSummary = useCreatorInboxSummary(profile.user_id, "admin");
  async function loadStats() {
    if (!branchReady) return;
    const { data, error } = await supabase.rpc("admin_get_my_branch_stats");
    if (error) return void toast.error(error.message);
    setStats(data || {});
  }
  useEffect(() => {
    void loadStats();
  }, [branchReady, profile.assigned_state, profile.assigned_lga]);
  function openOperation(next: Operation, id?: string) {
    setOperationTarget({ operation: next, id });
    setOperation(next);
    setTab("operations");
  }
  function openActivity(page: string, id?: string) {
    const route = String(page || "").toLowerCase();
    if (
      route.includes("propert") ||
      route === "listing_detail" ||
      route === "detail"
    )
      return openOperation("properties", id);
    if (
      route.includes("reservation") ||
      route.includes("booking") ||
      route === "operations_inbox"
    )
      return openOperation("bookings", id);
    if (route.includes("worker")) return openOperation("workers", id);
    if (["conversation", "messages", "chat", "operations_inbox"].includes(route)) {
      setInboxTargetId(id);
      setTab("inbox");
      return;
    }
    onNavigate?.(page, id);
  }
  const nav = NAV.map((item) =>
    item.id === "inbox" ? { ...item, badge: inboxSummary.totalUnread } : item,
  );
  const currentOperation = operation ? OPS.find(([id]) => id === operation) : null;
  const workspaceTitle = tab === "operations" && currentOperation ? currentOperation[1] : NAV.find((item) => item.id === tab)?.label || "Admin";
  const workspaceDescription = tab === "operations" && currentOperation ? currentOperation[2] : NOTES[tab];
  return (
    <>
      <Toaster position="top-center" richColors />
      <WorkspaceFrameV2
        label={`WEHOUSE · ADMIN · ${profile.assigned_lga || "UNASSIGNED"}`}
        title={workspaceTitle}
        description={`${workspaceDescription}${branchReady ? ` · ${profile.assigned_lga}, ${profile.assigned_state}` : " · Branch assignment required"}`}
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
        {!branchReady ? (
          <BranchMissing />
        ) : (
          <>
            {tab === "home" && (
              <Overview
                stats={stats}
                profile={profile}
                openOperation={openOperation}
                openCommunications={() => setTab("inbox")}
              />
            )}{" "}
            {tab === "operations" && (
              <Operations
                profile={profile}
                active={operation}
                target={operationTarget}
                setActive={(next) => {
                  setOperation(next);
                  if (!next) setOperationTarget(null);
                }}
                onView={setViewing}
                onRefreshStats={loadStats}
              />
            )}{" "}
            {tab === "inbox" && (
              <AdminInbox
                profile={profile}
                summary={inboxSummary}
                onNavigate={openActivity}
                initialConversationId={inboxTargetId}
              />
            )}
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
          onNavigate={onNavigate}
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
  const [view, setView] = useState<"chats" | "activity">("chats");
  return (
    <div className="space-y-4">
      <InboxTabs
        value={view}
        onChange={setView}
        chatCount={summary.messageUnread}
        activityCount={summary.activityUnread}
      />
      {view === "chats" ? (
        <CommunicationsWorkspace
          profile={profile}
          scope={{ state: profile.assigned_state!, lga: profile.assigned_lga! }}
          forcedView="inbox"
          hideViewTabs
          queue="all"
          initialConversationId={initialConversationId}
          onOpenContext={onNavigate}
          onUnreadChange={summary.setMessageUnread}
        />
      ) : (
        <Notifications
          profile={profile}
          scope="admin"
          embedded
          onUnreadChange={summary.setActivityUnread}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}
function Overview({
  stats,
  profile,
  openOperation,
  openCommunications,
}: {
  stats: any;
  profile: Profile;
  openOperation: (t: Operation) => void;
  openCommunications: () => void;
}) {
  const cards: [string, number, Operation, string][] = [
    ["Users", stats.users || 0, "people", "Regular users"],
    ["Property Partners", stats.partners || 0, "people", "Property owners"],
    ["Team", stats.staff || 0, "staff", "Admins and Operations members"],
    [
      "Properties",
      stats.listings || 0,
      "properties",
      "Published branch inventory",
    ],
    [
      "Workers",
      stats.workers || 0,
      "workers",
      `${stats.pending_verifications || 0} awaiting review`,
    ],
  ];
  return (
    <div className="space-y-5">
      <section className="border-b border-white/[.07] pb-5">
        <p className="text-[9px] font-semibold uppercase tracking-[.16em] text-violet-300">Branch workspace</p>
        <h2 className="mt-2 text-2xl font-bold lg:text-3xl">
          {profile.assigned_lga}, {profile.assigned_state}
        </h2>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[#9295A7]">
          Admin manages only this branch. Property authority follows State/LGA;
          Precise location improves maps and distance but never expands branch permissions.
        </p>
      </section>
      <section className="divide-y divide-white/[.06] border-y border-white/[.06]">
        {cards.map(([label, value, target, note]) => (
          <button
            key={label}
            onClick={() => openOperation(target)}
            className="flex min-h-16 w-full items-center gap-4 py-3 text-left"
          >
            <p className="w-12 shrink-0 text-xl font-bold">{value}</p>
            <span className="min-w-0 flex-1"><strong className="block text-xs">{label}</strong><span className="mt-1 block text-[9px] text-[#626678]">{note}</span></span>
            <span className="text-[#666D7E]">›</span>
          </button>
        ))}
      </section>
      <section className="border-y border-white/[.06]">
        <button
          onClick={openCommunications}
          className="flex min-h-16 w-full items-center justify-between gap-4 py-3 text-left"
        >
          <span><strong className="block text-sm">Inbox</strong><span className="mt-1 block text-[10px] text-[#727587]">Contextual branch conversations and official Activity.</span></span>
          <span className="text-[#666D7E]">›</span>
        </button>
      </section>
    </div>
  );
}
function Operations({
  profile,
  active,
  target,
  setActive,
  onView,
  onRefreshStats,
}: {
  profile: Profile;
  active: Operation | null;
  target: OperationTarget;
  setActive: (t: Operation | null) => void;
  onView: (p: Profile) => void;
  onRefreshStats: () => Promise<void> | void;
}) {
  if (!active) return <div className="space-y-4"><p className="max-w-2xl text-[10px] leading-5 text-[#73798A]">Choose a branch work area. Each opens its canonical records here.</p><div className="divide-y divide-white/[.06] border-y border-white/[.06]">{OPS.map(([id,label,note])=><button key={id} onClick={()=>setActive(id)} className="flex min-h-16 w-full items-center justify-between gap-4 py-3 text-left"><span><strong className="block text-sm">{label}</strong><span className="mt-1 block text-[9px] text-[#6D7384]">{note}</span></span><span className="text-[#697082]">›</span></button>)}</div></div>;
  return (
    <div className="space-y-5">
      <button onClick={() => setActive(null)} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/[.07] px-3 text-[10px] font-semibold text-[#A2A7B5]" aria-label="Back to all branch work areas"><span className="text-lg">‹</span><span>All work areas</span></button>
      {active === "people" && <People onView={onView} />}{" "}
      {active === "staff" && <StaffListTab profile={profile} />}{" "}
      {active === "properties" && (
        <PropertyPipelineWorkspace
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
      title="People"
      note="Workers and Operations members are managed in their dedicated areas."
    >
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
        placeholder="Search this branch"
        className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#141720] px-3 text-xs"
      />
      {loading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <Empty
          title="No matching accounts"
          text="Nothing in this branch matches the filter."
        />
      ) : (
        <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
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
                  <p className="truncate text-[10px] text-[#6D7082]">
                    {p.email}
                  </p>
                  <p className="mt-1 text-[9px] capitalize text-[#535667]">
                    {p.role?.replace(/_/g, " ")}
                  </p>
                </div><span className="text-[#62697A]">›</span>
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
              <p className="text-[9px] leading-relaxed text-[#6D7284]">
                Approval is enforced by the server and remains blocked until the
                identity screening evidence is ready for WeHouse review.
              </p>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Rejection reason if rejecting"
                className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#171A23] px-3 text-xs"
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
        <Grid>
          {shown.map((w) => (
            <button
              key={w.user_id}
              onClick={() => setSelected(w)}
              className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left"
            >
              <Top
                title={w.full_name || w.username || "Worker"}
                sub={`${workerOccupation(w)} · ${[w.local_government || w.city, w.state].filter(Boolean).join(", ")}`}
                status={w.suspended ? "suspended" : w.worker_status}
              />
              <p className="mt-3 text-[9px] font-semibold text-violet-400">
                OPEN WORKER →
              </p>
            </button>
          ))}
        </Grid>
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
      <nav
        className="grid grid-cols-3 border-y border-white/[.07]"
        aria-label="Booking types"
      >
        {(
          [
            ["services", "Worker services"],
            ["apartments", "Apartments"],
            ["hotels", "Hotels"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setDomain(id)}
            className={`relative min-h-12 px-1 text-[9px] font-semibold ${domain === id ? "text-violet-300" : "text-[#73798A]"}`}
          >
            {label}
            {domain === id && (
              <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-violet-400" />
            )}
          </button>
        ))}
      </nav>
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
      note="Branch oversight for Worker jobs only."
    >
      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty
          title="No service bookings"
          text="There are no Worker service bookings in this branch."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <Top
                title={r.service_name || r.service || "Service booking"}
                sub={`${r.booking_code || r.id} · ${dateText(r.created_at)}`}
                status={r.status || "pending"}
                right={r.agreed_amount ? money(r.agreed_amount) : undefined}
              />
            </Card>
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
          text="There are no hotel reservations in this branch."
        />
      ) : (
        <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
          {rows.map((row) => (
            <article key={row.booking_id} className="py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {row.guest_name || "Guest"}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-[#858B9A]">
                    {(row.hotels as any)?.name || "Hotel"} ·{" "}
                    {(row.hotel_rooms as any)?.room_type || "Room"}
                  </p>
                  <p className="mt-1 text-[9px] text-[#666D7E]">
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
function BranchMissing() {
  return (
    <div className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.05] p-8 text-center">
      <p className="text-sm font-semibold text-amber-300">
        Branch assignment required
      </p>
      <p className="mx-auto mt-2 max-w-md text-[10px] text-[#777B8D]">
        Creator must assign this Admin to a State and LGA before branch
        operations become available.
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
      <div>
        <h3 className="text-base font-bold">{title}</h3>
        <p className="mt-1 text-[10px] text-[#707386]">{note}</p>
      </div>
      {children}
    </div>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
  );
}
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4">
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
        <p className="mt-1 line-clamp-2 text-[10px] text-[#707386]">{sub}</p>
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
      className={`shrink-0 rounded-xl px-3 py-2 text-[10px] font-semibold ${active ? "bg-violet-500 text-white" : "border border-white/[0.06] bg-[#10131B] text-[#777A8C]"}`}
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
      className={`min-h-10 flex-1 rounded-xl px-3 text-[10px] font-semibold ${danger ? "border border-red-500/20 bg-red-500/10 text-red-300" : secondary ? "border border-white/[0.08] bg-white/[0.04] text-[#A7A9B6]" : "bg-violet-500 text-white"}`}
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
      <p className="mb-2 text-[9px] text-[#6E7183]">{title}</p>
      <VideoPlayer src={url} className="max-h-60 w-full rounded-xl bg-[#161922] object-contain" />
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
      <p className="mx-auto mt-2 max-w-md text-[10px] text-[#66697B]">{text}</p>
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
