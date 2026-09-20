import CreatorOverview from "@/components/CreatorOverview";
import { useRpcRead } from '@/hooks/useRpcRead';
import { withTimeout } from '@/lib/withTimeout';
import InboxActivityEntry from "@/components/InboxActivityEntry";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import WorkspaceFrameV2 from "@/components/WorkspaceFrameV2";
import BackButton from "@/components/BackButton";
import WorkspaceSectionHeading from "@/components/WorkspaceSectionHeading";
import CommunicationsWorkspace from "@/components/CommunicationsWorkspace";
import PropertyPipelineWorkspace from "@/components/PropertyPipelineWorkspace";
import CreatorWorkerOversight from "@/components/CreatorWorkerOversight";
import StaffFinanceRecords from "@/components/StaffFinanceRecords";
import CreatorAuditWorkspace from "@/components/CreatorAuditWorkspace";
import ServiceBookingOversight from "@/components/ServiceBookingOversight";
import UserProfileModal from "@/components/UserProfileModal";
import ServiceCategoryManager from "@/components/ServiceCategoryManager";
import PropertyTypeManager from "@/components/PropertyTypeManager";
import WeHouseSelect from "@/components/WeHouseSelect";
import StaffListTab from "./StaffListTab";
import CreatorAnalyticsV2 from "./CreatorAnalyticsV2";
import CreatorSettingsTabV2 from "./CreatorSettingsTabV2";
import CreatorLegalDocuments from "@/components/CreatorLegalDocuments";
import AccountIdentityReviewQueue from "@/components/AccountIdentityReviewQueue";
import Notifications from "./Notifications";
import { supabase } from "@/lib/supabase";
import { useCreatorInboxSummary } from "@/hooks/useCreatorInboxSummary";
import type { Profile } from "@/types";

type Tab = "overview" | "operations" | "inbox";
type Operation =
  | "people"
  | "team"
  | "properties"
  | "workers"
  | "bookings"
  | "finance"
  | "analytics"
  | "audit"
  | "platform";
type PersonRole = "all" | "property_partner";
type Props = {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string, id?: string) => void;
  onGoToChat?: (id?: string) => void;
};
type OperationTarget = { operation: Operation; id?: string } | null;

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "operations", label: "Operations" },
  { id: "inbox", label: "Inbox" },
];

const NOTES: Record<Tab, string> = {
  overview: "Live inventory, people and work needing attention.",
  operations:
    "People, properties, bookings, finance and platform control in one workspace.",
  inbox: "Chats and Activity linked to their authoritative records.",
};

const OPS: Array<{
  id: Operation;
  label: string;
  note: string;
  group: "Accounts" | "Marketplace" | "Platform";
}> = [
  {
    id: "people",
    label: "People",
    note: "Personal accounts and property partner access.",
    group: "Accounts",
  },
  {
    id: "team",
    label: "WeHouse team",
    note: "Admins, Operations members, branches and work areas.",
    group: "Accounts",
  },
  {
    id: "properties",
    label: "Properties",
    note: "Review submissions, visits and publishing.",
    group: "Marketplace",
  },
  {
    id: "workers",
    label: "Service providers",
    note: "Professional onboarding and account decisions.",
    group: "Marketplace",
  },
  {
    id: "bookings",
    label: "Bookings",
    note: "Worker services, apartments and hotel stays.",
    group: "Marketplace",
  },
  {
    id: "finance",
    label: "Finance",
    note: "Payout requests and platform settlement records.",
    group: "Platform",
  },
  {
    id: "analytics",
    label: "Analytics",
    note: "Platform trends and lifecycle movement.",
    group: "Platform",
  },
  {
    id: "audit",
    label: "Change history",
    note: "Accountable changes to platform records.",
    group: "Platform",
  },
  {
    id: "platform",
    label: "Platform settings",
    note: "Product rules, marketplace choices and published legal documents.",
    group: "Platform",
  },
];
const OP_GROUPS = ["Accounts", "Marketplace", "Platform"] as const;
const PEOPLE_OPTIONS = [
  { value: "all", label: "All accounts", description: "Personal identities, including people with additional workspaces." },
  { value: "property_partner", label: "Property partners", description: "People and businesses supplying property inventory." },
] as const;
const FINANCE_OPTIONS = [
  { value: "payouts", label: "Payout requests", description: "Review money waiting to be released." },
  { value: "commissions", label: "Commission ledger", description: "Inspect settled platform commission records." },
] as const;

export default function CreatorDashboard({
  profile,
  onLogout,
  onNavigate,
  onGoToChat,
}: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [platformSection, setPlatformSection] = useState<PlatformSection | null>(null);
  const [operationTarget, setOperationTarget] = useState<OperationTarget>(null);
  const [inboxTargetId, setInboxTargetId] = useState<string | undefined>();
  const [viewing, setViewing] = useState<Profile | null>(null);
  const inboxSummary = useCreatorInboxSummary(profile.user_id, "creator");

  function openOperation(next: Operation, id?: string) {
    setOperationTarget({ operation: next, id });
    setOperation(next);
    setPlatformSection(null);
    setTab("operations");
  }

  function openCreatorDestination(page: string, id?: string) {
    const route = String(page || "").toLowerCase();
    if (["conversation", "messages", "chat", "operations_inbox"].includes(route)) {
      setInboxTargetId(id);
      setTab("inbox");
      return;
    }
    if (
      route === "operations_properties" ||
      route === "listing_detail" ||
      route === "detail" ||
      route.includes("propert")
    ) {
      openOperation("properties", id);
      return;
    }
    if (
      route === "my_reservations" ||
      route === "my_bookings" ||
      route.includes("reservation") ||
      route.includes("booking")
    ) {
      openOperation("bookings", id);
      return;
    }
    if (route.includes("worker")) {
      openOperation("workers", id);
      return;
    }
    onNavigate?.(page, id);
  }

  const nav = NAV.map((item) =>
    item.id === "inbox" ? { ...item, badge: inboxSummary.totalUnread } : item,
  );
  const currentOperation = operation
    ? OPS.find((item) => item.id === operation)
    : null;
  const currentPlatform = tab === "operations" && operation === "platform" ? PLATFORM_SECTIONS.find(item => item.id === platformSection) : undefined;
  const workspaceTitle =
    tab === "operations" && currentOperation
      ? currentOperation.label
      : NAV.find((item) => item.id === tab)?.label || "Creator";
  const workspaceDescription =
    tab === "operations" && currentOperation
      ? currentOperation.note
      : NOTES[tab];
  return (
    <>

      <WorkspaceFrameV2
        label="WEHOUSE · CREATOR"
        title={currentPlatform?.label || workspaceTitle}
        description={currentPlatform?.note || workspaceDescription}
        onBack={tab === "operations" && operation ? () => {
          if (platformSection) setPlatformSection(null);
          else { setOperation(null); setOperationTarget(null); }
        } : undefined}
        backLabel={platformSection ? "Back to platform settings" : "Back to work areas"}
        items={nav}
        active={tab}
        setActive={(id) => {
          const next = id as Tab;
          setTab(next);
          if (next === "operations") {
            setOperation(null);
            setPlatformSection(null);
            setOperationTarget(null);
          }
        }}
        onAccount={onNavigate ? () => onNavigate("profile") : undefined}
        onLogout={onLogout}
        compact={tab === "inbox"}
      >
        {tab === "overview" && <CreatorOverview userId={profile.user_id} onOpen={openOperation} />}
        {tab === "operations" && (
          <Operations
            profile={profile}
            platformSection={platformSection}
            setPlatformSection={setPlatformSection}
            active={operation}
            target={operationTarget}
            setActive={(next) => {
              setOperation(next);
              if (!next) setOperationTarget(null);
            }}
            onView={setViewing}
          />
        )}
        {tab === "inbox" && (
          <CreatorInbox
            profile={profile}
            onNavigate={openCreatorDestination}
            onGoToChat={onGoToChat}
            initialConversationId={inboxTargetId}
            summary={inboxSummary}
          />
        )}
      </WorkspaceFrameV2>
      {viewing && (
        <UserProfileModal
          user={viewing}
          adminProfile={profile}
          onClose={() => setViewing(null)}
          onNavigate={openCreatorDestination}
          onGoToChat={onGoToChat}
        />
      )}
    </>
  );
}

function Operations({
  profile,
  platformSection,
  setPlatformSection,
  active,
  target,
  setActive,
  onView,
}: {
  profile: Profile;
  platformSection: PlatformSection | null;
  setPlatformSection: (section: PlatformSection | null) => void;
  active: Operation | null;
  target: OperationTarget;
  setActive: (value: Operation | null) => void;
  onView: (profile: Profile) => void;
}) {
  if (!active)
    return (
      <div className="space-y-6">
        <p className="max-w-2xl text-[10px] leading-5 text-[#73798A]">
          Choose the area you want to manage.
        </p>
        {OP_GROUPS.map((group) => (
          <section key={group}>
            <h2 className="mb-1 text-[9px] font-bold uppercase tracking-[.16em] text-[#686F80]">
              {group}
            </h2>
            <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
              {OPS.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActive(item.id)}
                  className="flex min-h-16 w-full items-center justify-between gap-4 py-3 text-left"
                >
                  <span>
                    <strong className="block text-sm">{item.label}</strong>
                    <span className="mt-1 block text-[9px] text-[#6D7384]">
                      {item.note}
                    </span>
                  </span>
                  <span className="text-[#697082]">›</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  return (
    <div className="space-y-5">
      {active === "people" && <People userId={profile.user_id} initialRole={target?.operation === 'people' && target.id === 'property_partner' ? 'property_partner' : 'all'} onView={onView} />}
      {active === "team" && <StaffListTab profile={profile} />}
      {active === "properties" && (
        <div className="space-y-5">
          <AccountIdentityReviewQueue accountRole="property_partner" />
          <PropertyPipelineWorkspace
            profile={profile}
            initialRecordId={
              target?.operation === "properties" ? target.id : undefined
            }
          />
        </div>
      )}
      {active === "workers" && <div className="space-y-5"><AccountIdentityReviewQueue accountRole="worker"/><CreatorWorkerOversight userId={profile.user_id} /></div>}
      {active === "bookings" && (
        <Bookings
          initialRecordId={
            target?.operation === "bookings" ? target.id : undefined
          }
        />
      )}
      {active === "finance" && <Finance />}
      {active === "analytics" && <CreatorAnalyticsV2 profile={profile} />}
      {active === "audit" && <CreatorAuditWorkspace />}
      {active === "platform" && <PlatformControl profile={profile} section={platformSection} setSection={setPlatformSection} />}
    </div>
  );
}

function CreatorInbox({
  profile,
  onNavigate,
  onGoToChat,
  initialConversationId,
  summary,
}: {
  profile: Profile;
  onNavigate?: Props["onNavigate"];
  onGoToChat?: Props["onGoToChat"];
  initialConversationId?: string;
  summary: ReturnType<typeof useCreatorInboxSummary>;
}) {
  const [composing, setComposing] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  useEffect(() => {
    if (initialConversationId) { setComposing(false); setActivityOpen(false); }
  }, [initialConversationId]);
  if (composing)
    return (
      <Nested title="New update" back={() => setComposing(false)}>
        <CommunicationsWorkspace
          profile={profile}
          scope="all"
          forcedView="broadcast"
          hideViewTabs
        />
      </Nested>
    );
  if (activityOpen) return (
    <Nested title="Activity" back={() => setActivityOpen(false)}>
      <button type="button" onClick={() => setComposing(true)} className="min-h-11 text-sm font-semibold text-violet-300">Post update</button>
      <Notifications profile={profile} scope="creator" embedded compact onUnreadChange={summary.setActivityUnread} onNavigate={(page, id) => onNavigate?.(page, id)} />
    </Nested>
  );
  return (
    <div className="space-y-5">
      <InboxActivityEntry unread={summary.activityUnread} onOpen={() => setActivityOpen(true)} />
      <section>
        <div className="mb-3 flex items-center justify-between border-b border-white/[.06] pb-3">
          <div>
            <h2 className="text-xs font-semibold">Messages</h2>

          </div>
          {summary.messageUnread > 0 ? <span className="rounded-full bg-violet-500/12 px-2 py-1 text-[8px] font-semibold text-violet-300">{summary.messageUnread} new</span> : null}
        </div>
        <CommunicationsWorkspace
          profile={profile}
          scope="all"
          forcedView="inbox"
          hideViewTabs
          queue="all"
          initialConversationId={initialConversationId}
          onOpenConversation={onGoToChat}
          onOpenContext={(page,id)=>onNavigate?.(page,id)}
          onUnreadChange={summary.setMessageUnread}
        />
      </section>
    </div>
  );
}

function Nested({
  title,
  back,
  children,
}: {
  title: string;
  back: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3 border-b border-white/[.07] pb-3">
        <BackButton onClick={back} />
        <h2 className="text-lg font-bold">{title}</h2>
      </header>
      {children}
    </div>
  );
}

function People({ userId, initialRole, onView }: { userId: string; initialRole: PersonRole; onView: (profile: Profile) => void }) {
  const [role, setRole] = useState<PersonRole>(initialRole);
  const { data, loading, error, refresh } = useRpcRead<Profile[]>('creator_get_people', userId, { p_workspace: role === 'all' ? null : role });
  const rows = useMemo(() => data || [], [data]);
  const [search, setSearch] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  async function openCanonical(person: Profile) {
    setOpening(person.user_id);
    try {
    const { data, error } = await withTimeout(supabase.rpc("creator_get_people", {
      p_workspace: role === 'all' ? null : role,
    }), 15000, 'The current profile could not be loaded');
    if (error) return toast.error("The current profile could not be loaded");
    const current = (Array.isArray(data) ? data : []).find(
      (row: any) => row.user_id === person.user_id,
    );
    if (!current) return toast.error("This profile is no longer available");
    onView(current as Profile);
    } catch { toast.error('The current profile could not be loaded'); }
    finally { setOpening(null); }
  }
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        !q ||
        [
          row.full_name,
          row.username,
          row.email,
          row.user_id,
          row.state,
          row.local_government,
          row.city,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
    );
  }, [rows, search]);
  return (
    <Section
      title="People"
      note="One Personal account per person. Property partner access is an additional workspace."
    >
      <WeHouseSelect
        value={role}
        options={PEOPLE_OPTIONS}
        onChange={setRole}
        eyebrow="People"
        title="Account type"
        ariaLabel="Filter people by account type"
      />
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search accounts"
        className="h-11 w-full rounded-xl border border-white/[.08] bg-[#141720] px-3 text-xs outline-none focus:border-violet-500/40"
      />
      {loading ? (
        <Loading />
      ) : error ? <div role="alert" className="py-4 text-sm text-amber-100"><p>Accounts could not be loaded.</p><button type="button" onClick={() => void refresh()} className="min-h-11 text-violet-300">Try again</button></div> : shown.length === 0 ? (
        <Empty text="No matching accounts." />
      ) : (
        <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
          {shown.slice(0, 120).map((person) => (
            <button
              key={person.user_id}
              disabled={opening === person.user_id}
              onClick={() => void openCanonical(person)}
              className="flex w-full items-center gap-3 py-4 text-left disabled:opacity-50"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-xs font-bold">
                {person.avatar_url ? (
                  <img
                    src={person.avatar_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  String(
                    person.full_name || person.username || "W",
                  )[0].toUpperCase()
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {person.full_name || person.username || "WeHouse account"}
                </span>
                <span className="mt-1 block truncate text-[9px] text-[#666D7E]">
                  {person.email}
                </span>
                <span className="mt-2 block text-[8px] capitalize text-[#565D6E]">
                  {String(person.role || "user").replace(/_/g, " ")} ·{" "}
                  {[person.local_government || person.city, person.state]
                    .filter(Boolean)
                    .join(", ") || "Location not set"}
                </span>
              </span>
              <span className="text-[#62697A]">›</span>
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

function Bookings({ initialRecordId }: { initialRecordId?: string }) {
  const [view, setView] = useState<"worker" | "apartments" | "hotels">(
    initialRecordId ? "apartments" : "worker",
  );
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  useEffect(() => {
    if (initialRecordId) setView("apartments");
  }, [initialRecordId]);
  useEffect(() => {
    if (view !== "worker") void load();
  }, [view, initialRecordId]);
  async function load() {
    setLoading(true);
    let data: any[] = [];
    let error: any = null;
    if (view === "apartments") {
      const reservations = await supabase
        .from("reservations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      data = reservations.data || [];
      error = reservations.error;
      if (!error) {
        const ids = [
          ...new Set(data.map((row: any) => row.listing_id).filter(Boolean)),
        ];
        if (ids.length) {
          const listings = await supabase
            .from("listings")
            .select("id,title,address,city,state,images,sub_type")
            .in("id", ids);
          if (listings.error) error = listings.error;
          else {
            const byId = new Map(
              (listings.data || []).map((listing: any) => [
                listing.id,
                listing,
              ]),
            );
            data = data.map((row: any) => ({
              ...row,
              listing: byId.get(row.listing_id) || null,
            }));
          }
        }
      }
    } else if (view === "hotels") {
      const result = await supabase
        .from("hotel_bookings")
        .select("*,hotels(name,city,state,images),hotel_rooms(room_type)")
        .order("created_at", { ascending: false })
        .limit(100);
      data = result.data || [];
      error = result.error;
    }
    if (!error && data.length) {
      const userIds = [
        ...new Set(data.map((row: any) => row.user_id).filter(Boolean)),
      ];
      if (userIds.length) {
        const profiles = await supabase
          .from("profiles")
          .select("user_id,full_name,username,email,phone")
          .in("user_id", userIds);
        if (profiles.error) error = profiles.error;
        else {
          const byId = new Map(
            (profiles.data || []).map((person: any) => [
              person.user_id,
              person,
            ]),
          );
          data = data.map((row: any) => ({
            ...row,
            customer: byId.get(row.user_id) || null,
          }));
        }
      }
    }
    if (error) toast.error(error.message);
    setRows(data);
    if (!error && initialRecordId) {
      const target = data.find((row: any) =>
        [row.id, row.booking_id, row.reservation_id]
          .filter(Boolean)
          .some((value) => String(value) === String(initialRecordId)),
      );
      if (target) setSelected(target);
      else if (view === "apartments")
        toast.error("The linked booking record is no longer available.");
    }
    setLoading(false);
  }
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const property =
        view === "hotels"
          ? row.hotels?.name
          : row.listing?.title || row.listing_title;
      const customer =
        row.guest_name ||
        row.customer?.full_name ||
        row.customer?.username ||
        row.customer?.email ||
        row.user_email;
      const code = row.booking_code;
      return (
        !q ||
        [
          property,
          customer,
          code,
          row.hotels?.city,
          row.hotels?.state,
          row.listing?.city,
          row.listing?.state,
          row.status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [rows, search, view]);
  if (selected)
    return (
      <BookingRecord
        row={selected}
        kind={view === "hotels" ? "hotel" : "apartment"}
        onBack={() => setSelected(null)}
      />
    );
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 border-y border-white/[.07] py-3">
        <div><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#686F80]">Record type</p><p className="mt-1 text-[9px] text-[#8A90A0]">One workspace, one active filter</p></div>
        <WeHouseSelect value={view} options={[{ value: "worker", label: "Worker services" }, { value: "apartments", label: "Apartments" }, { value: "hotels", label: "Hotels" }]} onChange={(next) => { setView(next); setSearch(""); setSelected(null); }} eyebrow="Bookings" title="Record type" ariaLabel="Filter booking records by type" />
      </div>
      {view === "worker" ? (
        <ServiceBookingOversight
          title="Worker service bookings"
          note="Platform-wide oversight. Participants control the job; WeHouse watches lifecycle and exceptions."
        />
      ) : (
        <>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={`Search ${view} bookings`}
            placeholder="Search customer, property or booking code"
            className="h-11 w-full border-b border-white/[.08] bg-transparent px-1 text-xs outline-none focus:border-violet-500/40"
          />
          {loading ? (
            <Loading />
          ) : shown.length === 0 ? (
            <Empty
              text={
                rows.length
                  ? "No bookings match your search."
                  : "No bookings in this view."
              }
            />
          ) : (
            <div className="divide-y divide-white/[.065] border-y border-white/[.065]">
              {shown.map((row) => {
                const media =
                  view === "hotels"
                    ? row.hotels?.images?.[0]
                    : row.listing?.images?.[0];
                const title =
                  view === "hotels"
                    ? row.hotels?.name || "Hotel booking"
                    : row.listing?.title ||
                      row.listing_title ||
                      "Apartment reservation";
                const location =
                  view === "hotels"
                    ? [row.hotels?.city, row.hotels?.state]
                    : [row.listing?.city, row.listing?.state];
                const customer =
                  row.guest_name ||
                  row.customer?.full_name ||
                  row.customer?.username ||
                  row.customer?.email ||
                  row.user_email ||
                  "Customer name unavailable";
                const code = row.booking_code || "Booking code unavailable";
                return (
                  <button
                    key={row.id || row.booking_id}
                    onClick={() => setSelected(row)}
                    className="flex min-h-24 w-full items-center gap-3 py-3 text-left"
                  >
                    {media ? (
                      <img
                        src={media}
                        alt=""
                        className="h-14 w-14 shrink-0 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-violet-500/[.08] text-xs font-bold text-violet-300">
                        WH
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {customer}
                      </p>
                      <p className="mt-1 truncate text-[10px] text-[#9BA0AF]">
                        {title}
                      </p>
                      <p className="mt-1 truncate text-[9px] text-[#686F7F]">
                        {location.filter(Boolean).join(", ") ||
                          "Location unavailable"}{" "}
                        · {new Date(row.created_at).toLocaleString()}
                      </p>
                      <p className="mt-1 truncate text-[8px] font-semibold tracking-wide text-violet-300">
                        {code}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {(row.total_price ||
                        row.amount ||
                        row.reservation_fee_amount) != null && (
                        <p className="mb-1 text-xs font-bold">
                          ₦
                          {Number(
                            row.total_price ||
                              row.amount ||
                              row.reservation_fee_amount ||
                              0,
                          ).toLocaleString("en-NG")}
                        </p>
                      )}
                      <span className="rounded-full bg-white/[.05] px-2 py-1 text-[8px] capitalize text-[#A2A7B5]">
                        {String(row.status || "recorded").replace(/_/g, " ")}
                      </span>
                      <span className="ml-2 text-[#686F7F]">›</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BookingRecord({
  row,
  kind,
  onBack,
}: {
  row: any;
  kind: "apartment" | "hotel";
  onBack: () => void;
}) {
  const property =
    kind === "hotel"
      ? row.hotels?.name || "Hotel stay"
      : row.listing?.title || row.listing_title || "Apartment reservation";
  const location =
    kind === "hotel"
      ? [row.hotels?.city, row.hotels?.state]
      : [row.listing?.city, row.listing?.state];
  const customer =
    row.guest_name ||
    row.customer?.full_name ||
    row.customer?.username ||
    row.customer?.email ||
    row.user_email ||
    "Customer name unavailable";
  const amount = Number(
    row.total_price || row.amount || row.reservation_fee_amount || 0,
  );
  const facts = [
    ["Customer", customer],
    ["Property", property],
    ["Location", location.filter(Boolean).join(", ") || "Location unavailable"],
    ["Booking code", row.booking_code || "Unavailable"],
    [
      "Created",
      row.created_at
        ? new Date(row.created_at).toLocaleString()
        : "Unavailable",
    ],
    ["Amount", amount ? `₦${amount.toLocaleString("en-NG")}` : "Not recorded"],
  ];
  return (
    <section className="space-y-5">
      <header className="flex items-start gap-3 border-b border-white/[.07] pb-4">
        <BackButton onClick={onBack} />
        <div className="min-w-0 flex-1">
          <p className="text-[8px] font-bold uppercase tracking-[.16em] text-violet-300">
            {kind === "hotel" ? "Hotel booking" : "Apartment reservation"}
          </p>
          <h2 className="mt-1 truncate text-lg font-bold">{property}</h2>
          <p className="mt-1 truncate text-[10px] text-[#707687]">
            {row.booking_code || String(row.id || row.booking_id || "")}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-violet-500/10 px-3 py-1.5 text-[9px] font-semibold capitalize text-violet-200">
          {String(row.status || "recorded").replace(/_/g, " ")}
        </span>
      </header>
      <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
        {facts.map(([label, value]) => (
          <div
            key={label}
            className="flex min-h-12 items-center justify-between gap-4 py-3 text-[10px]"
          >
            <span className="text-[#6D7384]">{label}</span>
            <span className="max-w-[68%] text-right font-semibold text-[#D8DAE2]">
              {value}
            </span>
          </div>
        ))}
      </div>
      {row.rent_payment_status && (
        <div className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4">
          <p className="text-[9px] uppercase tracking-wide text-[#686F80]">
            Payment state
          </p>
          <p className="mt-2 text-sm font-semibold capitalize">
            {String(row.rent_payment_status).replace(/_/g, " ")}
          </p>
        </div>
      )}
    </section>
  );
}

function Finance() {
  const [view, setView] = useState<"payouts" | "commissions">("payouts");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void load();
  }, [view]);
  async function load() {
    setLoading(true);
    const result =
      view === "payouts"
        ? await supabase
            .from("withdrawals")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(100)
        : await supabase
            .from("commission_ledger")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(100);
    if (result.error) toast.error(result.error.message);
    setRows(result.data || []);
    setLoading(false);
  }
  return (
    <Section
      title="Finance"
      note="Review payout requests, monitor Paystack settlement and inspect commission records. Product rules are managed in Operations → Platform settings."
    >
      <WeHouseSelect
        value={view}
        options={FINANCE_OPTIONS}
        onChange={setView}
        eyebrow="Finance"
        title="Finance record"
        ariaLabel="Choose finance records"
      />
      {view === "payouts" ? (
        <StaffFinanceRecords view="payouts" />
      ) : loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty text="No commission records." />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <Card key={row.id}>
              <Top
                title={row.booking_type || "Commission"}
                sub={new Date(row.created_at).toLocaleString()}
                status={row.status || "recorded"}
                amount={row.commission_amount}
              />
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}

type PlatformSection =
  "identity" | "access" | "workers" | "worker_plan" | "properties" | "legal";
const PLATFORM_SECTIONS: Array<{
  id: PlatformSection;
  label: string;
  note: string;
}> = [
  {
    id: "identity",
    label: "Identity & contact",
    note: "WeHouse name and public support details.",
  },
  {
    id: "access",
    label: "Access & registration",
    note: "Maintenance mode and new-account access.",
  },
  {
    id: "workers",
    label: "Worker marketplace",
    note: "Onboarding, trust, occupations and services.",
  },
  {
    id: "worker_plan",
    label: "Paid Service Provider plan",
    note: "Plan name, prices, subscription terms and sales controls.",
  },
  {
    id: "properties",
    label: "Property marketplace",
    note: "Property choices used in submission and discovery.",
  },
  {
    id: "legal",
    label: "Legal documents",
    note: "Published Privacy Policy and Terms of Service.",
  },
];
function PlatformControl({ profile, section, setSection }: { profile: Profile; section: PlatformSection | null; setSection: (section: PlatformSection | null) => void }) {
  if (!section)
    return (
      <div className="space-y-4">
        <div className="overflow-hidden border-y border-white/[.07]">
          {PLATFORM_SECTIONS.map((item, index) => (
            <div key={item.id}>
              {index > 0 && <div className="ml-12 h-px bg-white/[.055]" />}
              <button
                type="button"
                onClick={() => setSection(item.id)}
                className="flex min-h-[68px] w-full items-center gap-3 py-3 text-left"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-xs font-bold text-violet-300">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm">{item.label}</strong>
                  <span className="mt-1 block text-[9px] leading-4 text-[#6C7283]">
                    {item.note}
                  </span>
                </span>
                <span className="text-[#646B7C]">›</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  return (
    <div className="space-y-5">
      {section === "identity" && (
        <CreatorSettingsTabV2
          profile={profile}
          groups={["identity"]}
          embedded
          title="Identity & contact"
          description="Canonical public details used across WeHouse."
        />
      )}
      {section === "access" && (
        <CreatorSettingsTabV2
          profile={profile}
          groups={["access"]}
          embedded
          title="Access & registration"
          description="Platform-wide availability and account creation controls."
        />
      )}
      {section === "workers" && (
        <div className="space-y-5">
          <CreatorSettingsTabV2
            profile={profile}
            groups={["worker_trust"]}
            embedded
            title="Worker marketplace rules"
            description="Worker onboarding and earned marketplace trust."
          />
          <section className="border-t border-white/[.07] pt-5">
            <h3 className="mb-1 text-sm font-semibold">
              Occupations and services
            </h3>
            <p className="mb-4 text-[9px] leading-5 text-[#686F80]">
              Occupation describes who the Worker is; services describe the work
              customers can request.
            </p>
            <ServiceCategoryManager profile={profile} />
          </section>
        </div>
      )}
      {section === "worker_plan" && <CreatorSettingsTabV2 profile={profile} groups={["worker_pro"]} embedded />}
      {section === "properties" && (
        <section>
          <h3 className="mb-1 text-sm font-semibold">Property types</h3>
          <p className="mb-4 text-[9px] leading-5 text-[#686F80]">
            One canonical list shared by Property Partner submission and public
            discovery.
          </p>
          <PropertyTypeManager profile={profile} />
        </section>
      )}
      {section === "legal" && (
        <CreatorLegalDocuments embedded />
      )}
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
    <div className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4">
      {children}
    </div>
  );
}
function Top({
  title,
  sub,
  status,
  amount,
}: {
  title: string;
  sub: string;
  status: string;
  amount?: any;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="mt-1 text-[9px] text-[#686F7F]">{sub}</p>
      </div>
      <div className="shrink-0 text-right">
        {amount != null && (
          <p className="mb-1 text-sm font-bold">
            ₦{Number(amount || 0).toLocaleString("en-NG")}
          </p>
        )}
        <span className="rounded-full bg-white/[.05] px-2 py-1 text-[8px] capitalize text-[#A2A7B5]">
          {String(status).replace(/_/g, " ")}
        </span>
      </div>
    </div>
  );
}
function Loading() {
  return (
    <div className="grid min-h-44 place-items-center">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-12 text-center text-[10px] text-[#666C7D]">
      {text}
    </div>
  );
}
