import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";
import MediaViewer from "@/components/MediaViewer";

type SectionKey =
  | "overview"
  | "workspaces"
  | "professional"
  | "apartments"
  | "hotels"
  | "hotel_team"
  | "wehouse_team"
  | "access";

type WorkspaceRecord = {
  role: string;
  scope_type?: string | null;
  scope_state?: string | null;
  scope_lga?: string | null;
  status?: string | null;
  granted_at?: string | null;
};

type ApartmentRecord = {
  id: string;
  title?: string | null;
  sub_type?: string | null;
  status?: string | null;
  price?: number | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  images?: string[] | null;
  created_at?: string | null;
};

type HotelRecord = {
  hotel_id: number | string;
  name?: string | null;
  status?: string | null;
  city?: string | null;
  state?: string | null;
  area?: string | null;
  address?: string | null;
  images?: string[] | null;
  created_at?: string | null;
};

type HotelTeamRecord = {
  membership_id: string;
  hotel_id: number | string;
  hotel_name?: string | null;
  hotel_role?: string | null;
  status?: string | null;
  capabilities?: string[] | null;
  city?: string | null;
  state?: string | null;
};

type TeamRecord = WorkspaceRecord & { permission?: string | null };

type ProviderRecord = {
  reviewed?: boolean;
  occupation?: string | null;
  experience?: string | null;
  price?: number | null;
  bio?: string | null;
  skills?: string[] | null;
  jobs?: number;
  completed_jobs?: number;
  completed_job_earnings?: number;
  review_count?: number;
  average_rating?: number;
};

type InternalProfileRecord = {
  account?: Record<string, unknown>;
  workspaces?: WorkspaceRecord[];
  service_provider?: ProviderRecord | null;
  apartments?: ApartmentRecord[];
  hotels_owned?: HotelRecord[];
  hotel_team?: HotelTeamRecord[];
  wehouse_team?: TeamRecord[];
};

type SelectedRecord =
  | { kind: "apartment"; row: ApartmentRecord }
  | { kind: "hotel"; row: HotelRecord };

type StaffModule =
  | "operations"
  | "finance"
  | "support"
  | "security"
  | "verification"
  | "field_officer";

interface UserProfileModalProps {
  user: Profile | null;
  adminProfile?: Profile | null;
  onClose: () => void;
  onPromote?: () => void;
  onNavigate?: (page: string, id?: string) => void;
  onGoToChat?: (convId?: string) => void;
}

const STAFF_MODULES: Array<[StaffModule, string]> = [
  ["operations", "Property Operations"],
  ["finance", "Finance Operations"],
  ["support", "Support Operations"],
  ["security", "Security Operations"],
  ["verification", "Worker Operations"],
  ["field_officer", "Field Operations"],
];

const workspaceLabel = (value: string) => {
  if (value === "worker") return "Service Worker";
  if (value === "property_partner") return "Property Partner";
  if (value === "hotel_staff") return "Hotel Team";
  if (value === "staff") return "WeHouse Team";
  if (value === "admin") return "Admin";
  if (value === "creator") return "Creator";
  return value.replace(/_/g, " ");
};

export default function UserProfileModal(props: UserProfileModalProps) {
  if (!props.user) return null;
  return <InternalProfileSheet {...props} user={props.user} />;
}

function InternalProfileSheet({
  user,
  adminProfile,
  onClose,
  onPromote,
  onNavigate,
}: UserProfileModalProps & { user: Profile }) {
  const [record, setRecord] = useState<InternalProfileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<SectionKey>("overview");
  const [selected, setSelected] = useState<SelectedRecord | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [adminModule, setAdminModule] = useState<StaffModule>("operations");
  const [confirming, setConfirming] = useState(false);
  const [promoting, setPromoting] = useState(false);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSection("overview");
    setSelected(null);
    void (async () => {
      const { data, error } = await supabase.rpc("get_internal_profile_record", {
        p_target_user_id: user.user_id,
      });
      if (!active) return;
      if (error) {
        toast.error(error.message || "This account record could not be opened");
        setRecord(null);
      } else {
        setRecord((data || {}) as InternalProfileRecord);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [user.user_id]);

  const workspaces = record?.workspaces || [];
  const apartments = record?.apartments || [];
  const hotels = record?.hotels_owned || [];
  const hotelTeam = record?.hotel_team || [];
  const wehouseTeam = record?.wehouse_team || [];
  const provider = record?.service_provider || null;
  const isAdminActor = adminProfile?.role === "admin";
  const targetHasAdminOrCreator = wehouseTeam.some((item) =>
    ["admin", "creator"].includes(item.role),
  );

  const sections = useMemo(() => {
    const next: Array<{ id: SectionKey; label: string; count?: number }> = [
      { id: "overview", label: "Overview" },
      { id: "workspaces", label: "Access", count: workspaces.length },
    ];
    if (provider) next.push({ id: "professional", label: "Service Worker" });
    if (apartments.length)
      next.push({ id: "apartments", label: "Apartments", count: apartments.length });
    if (hotels.length)
      next.push({ id: "hotels", label: "Hotels", count: hotels.length });
    if (hotelTeam.length)
      next.push({ id: "hotel_team", label: "Hotel Team", count: hotelTeam.length });
    if (wehouseTeam.length)
      next.push({ id: "wehouse_team", label: "WeHouse Team", count: wehouseTeam.length });
    if (isAdminActor && !targetHasAdminOrCreator)
      next.push({ id: "access", label: "Team access" });
    return next;
  }, [
    apartments.length,
    hotelTeam.length,
    hotels.length,
    isAdminActor,
    provider,
    targetHasAdminOrCreator,
    wehouseTeam.length,
    workspaces.length,
  ]);

  const initials = String(user.full_name || user.username || user.email || "W")
    .trim()
    .charAt(0)
    .toUpperCase();
  const status = user.deleted
    ? "Deleted"
    : user.banned
      ? "Banned"
      : user.suspended
        ? "Suspended"
        : "Active";

  async function appointToTeam() {
    setPromoting(true);
    const { data, error } = await supabase.rpc("admin_appoint_staff", {
      p_target_user_id: user.user_id,
      p_module: adminModule,
    });
    setPromoting(false);
    setConfirming(false);
    if (error || !data)
      return toast.error(error?.message || "The team assignment was not completed");
    toast.success("WeHouse Team access assigned");
    onPromote?.();
    const refreshed = await supabase.rpc("get_internal_profile_record", {
      p_target_user_id: user.user_id,
    });
    if (!refreshed.error) setRecord((refreshed.data || {}) as InternalProfileRecord);
    setSection("wehouse_team");
  }

  function openOperations(kind: "apartment" | "hotel", id: string) {
    onNavigate?.("operations_properties", id);
    onClose();
  }

  const sheet = (
    <div
      className="fixed inset-0 z-[100040] bg-black/70 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="absolute inset-x-0 bottom-0 max-h-[90dvh] overflow-hidden rounded-t-[28px] border-t border-white/[.08] bg-[#0D1017] text-white shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[500px] sm:rounded-none sm:border-l sm:border-t-0">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/15 sm:hidden" />
        <header className="border-b border-white/[.06] bg-[#0D1017]/95 px-5 pb-3 pt-4 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => user.avatar_url && setAvatarOpen(true)}
              className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-violet-500/15 text-lg font-bold text-violet-200"
              aria-label={user.avatar_url ? "Preview profile photo" : "Profile photo"}
            >
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </button>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-bold">
                {user.full_name || user.username || "WeHouse account"}
              </h2>
              <p className="mt-0.5 truncate text-[10px] text-[#737A8B]">
                @{user.username || "username-not-set"}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone={status === "Active" ? "good" : "danger"}>{status}</Badge>
                {workspaces.slice(0, 3).map((item) => (
                  <Badge key={`${item.role}:${item.scope_lga || item.scope_type || "global"}`}>
                    {workspaceLabel(item.role)}
                  </Badge>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close profile"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[.05] text-lg text-[#8B91A1] active:bg-white/[.1]"
            >
              ×
            </button>
          </div>
          <nav className="mt-4 flex gap-5 overflow-x-auto" aria-label="Profile sections">
            {sections.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  setSelected(null);
                  setSection(item.id);
                }}
                className={`relative shrink-0 pb-2.5 text-[10px] font-semibold ${section === item.id && !selected ? "text-white" : "text-[#707687]"}`}
              >
                {item.label}
                {typeof item.count === "number" ? ` ${item.count}` : ""}
                {section === item.id && !selected ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-violet-500" />
                ) : null}
              </button>
            ))}
          </nav>
        </header>

        <div className="max-h-[calc(90dvh-150px)] overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-h-[calc(100dvh-145px)]">
          {loading ? (
            <Empty text="Loading account record…" />
          ) : !record ? (
            <Empty text="This account record is unavailable to your current workspace." />
          ) : selected ? (
            <PropertyDetail
              selected={selected}
              onBack={() => setSelected(null)}
              onOpenOperations={(id) => openOperations(selected.kind, id)}
            />
          ) : section === "overview" ? (
            <Overview
              user={user}
              workspaces={workspaces}
              provider={provider}
              apartments={apartments}
              hotels={hotels}
              hotelTeam={hotelTeam}
              wehouseTeam={wehouseTeam}
              setSection={setSection}
            />
          ) : section === "workspaces" ? (
            <Workspaces rows={workspaces} />
          ) : section === "professional" && provider ? (
            <Provider provider={provider} onOpen={() => onNavigate?.("worker_operations", user.user_id)} />
          ) : section === "apartments" ? (
            <ApartmentList rows={apartments} onOpen={(row) => setSelected({ kind: "apartment", row })} />
          ) : section === "hotels" ? (
            <HotelList rows={hotels} onOpen={(row) => setSelected({ kind: "hotel", row })} />
          ) : section === "hotel_team" ? (
            <HotelTeam rows={hotelTeam} onOpenHotel={(hotelId) => openOperations("hotel", String(hotelId))} />
          ) : section === "wehouse_team" ? (
            <WeHouseTeam rows={wehouseTeam} />
          ) : (
            <TeamAccess
              module={adminModule}
              setModule={setAdminModule}
              confirming={confirming}
              setConfirming={setConfirming}
              promoting={promoting}
              onConfirm={() => void appointToTeam()}
            />
          )}
        </div>
      </aside>
      {avatarOpen && user.avatar_url ? (
        <MediaViewer
          items={[{ url: user.avatar_url, kind: "image" as const }]}
          initialIndex={0}
          title={user.full_name || user.username || "Profile photo"}
          onClose={() => setAvatarOpen(false)}
        />
      ) : null}
    </div>
  );

  return createPortal(sheet, document.body);
}

function Overview({
  user,
  workspaces,
  provider,
  apartments,
  hotels,
  hotelTeam,
  wehouseTeam,
  setSection,
}: {
  user: Profile;
  workspaces: WorkspaceRecord[];
  provider: ProviderRecord | null;
  apartments: ApartmentRecord[];
  hotels: HotelRecord[];
  hotelTeam: HotelTeamRecord[];
  wehouseTeam: TeamRecord[];
  setSection: (value: SectionKey) => void;
}) {
  return (
    <div className="space-y-5 py-5">
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="Workspaces" value={workspaces.length || 1} onClick={() => setSection("workspaces")} />
        {provider ? <Metric label="Service jobs" value={provider.jobs || 0} onClick={() => setSection("professional")} /> : null}
        {apartments.length ? <Metric label="Apartments" value={apartments.length} onClick={() => setSection("apartments")} /> : null}
        {hotels.length ? <Metric label="Hotels" value={hotels.length} onClick={() => setSection("hotels")} /> : null}
        {hotelTeam.length ? <Metric label="Hotel assignments" value={hotelTeam.length} onClick={() => setSection("hotel_team")} /> : null}
        {wehouseTeam.length ? <Metric label="WeHouse assignments" value={wehouseTeam.length} onClick={() => setSection("wehouse_team")} /> : null}
      </section>
      <Section title="Account">
        <Row label="Name" value={user.full_name || "Not set"} />
        <Row label="Email" value={user.email || "Not set"} />
        <Row label="Phone" value={user.phone || "Not set"} />
        <Row label="State" value={user.state || "Not set"} />
        <Row label="LGA" value={user.local_government || user.city || "Not set"} />
        <Row label="Joined" value={dateLabel(user.created_at)} />
      </Section>
      <p className="text-[10px] leading-5 text-[#707687]">
        Each count opens the authoritative records behind it. Workspace access and sensitive actions are enforced by the server, not by this profile sheet.
      </p>
    </div>
  );
}

function Workspaces({ rows }: { rows: WorkspaceRecord[] }) {
  return (
    <ListShell title="Workspace access" note="One identity can hold several independent WeHouse workspaces.">
      {rows.length ? rows.map((row, index) => (
        <RecordRow
          key={`${row.role}:${row.scope_lga || row.scope_type || index}`}
          title={workspaceLabel(row.role)}
          meta={[row.scope_lga, row.scope_state].filter(Boolean).join(", ") || row.scope_type || "Global"}
          tail={statusText(row.status || "active")}
        />
      )) : <Empty text="Personal access only." />}
    </ListShell>
  );
}

function Provider({ provider, onOpen }: { provider: ProviderRecord; onOpen: () => void }) {
  return (
    <div className="space-y-5 py-5">
      <section className="grid grid-cols-3 gap-2">
        <Metric label="Jobs" value={provider.jobs || 0} />
        <Metric label="Completed" value={provider.completed_jobs || 0} />
        <Metric label="Rating" value={provider.review_count ? Number(provider.average_rating || 0).toFixed(1) : "New"} />
      </section>
      <Section title="Professional profile">
        <Row label="Occupation" value={provider.occupation || "Not set"} />
        <Row label="Experience" value={provider.experience || "Not set"} />
        <Row label="Service price" value={provider.price ? `₦${Number(provider.price).toLocaleString()}` : "Not set"} />
        <Row label="WeHouse review" value={provider.reviewed ? "Reviewed" : "Not reviewed"} />
        <Row label="Completed-job earnings" value={`₦${Number(provider.completed_job_earnings || 0).toLocaleString()}`} />
      </Section>
      {provider.bio ? <Section title="About"><TextBlock>{provider.bio}</TextBlock></Section> : null}
      {provider.skills?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {provider.skills.map((skill) => <Badge key={skill}>{skill}</Badge>)}
        </div>
      ) : null}
      <button type="button" onClick={onOpen} className="h-11 w-full rounded-xl border border-violet-500/20 bg-violet-500/[.07] text-[10px] font-semibold text-violet-200">
        Open in Worker Operations
      </button>
    </div>
  );
}

function ApartmentList({ rows, onOpen }: { rows: ApartmentRecord[]; onOpen: (row: ApartmentRecord) => void }) {
  return (
    <ListShell title="Apartments" note="Open an apartment to inspect its linked Property Partner record.">
      {rows.length ? rows.map((row) => (
        <button key={row.id} type="button" onClick={() => onOpen(row)} className="w-full text-left">
          <RecordRow title={row.title || "Untitled apartment"} meta={[row.city,row.state].filter(Boolean).join(", ") || "Location unavailable"} tail={`${statusText(row.status || "recorded")} ›`} />
        </button>
      )) : <Empty text="No apartment records." />}
    </ListShell>
  );
}

function HotelList({ rows, onOpen }: { rows: HotelRecord[]; onOpen: (row: HotelRecord) => void }) {
  return (
    <ListShell title="Hotels" note="Hotels are separate supply records inside the Property Partner workspace.">
      {rows.length ? rows.map((row) => (
        <button key={String(row.hotel_id)} type="button" onClick={() => onOpen(row)} className="w-full text-left">
          <RecordRow title={row.name || "Unnamed hotel"} meta={[row.city,row.state].filter(Boolean).join(", ") || "Location unavailable"} tail={`${statusText(row.status || "recorded")} ›`} />
        </button>
      )) : <Empty text="No owned hotels." />}
    </ListShell>
  );
}

function HotelTeam({ rows, onOpenHotel }: { rows: HotelTeamRecord[]; onOpenHotel: (id: number | string) => void }) {
  return (
    <ListShell title="Hotel Team assignments" note="Each assignment is scoped to one hotel and its granted capabilities.">
      {rows.length ? rows.map((row) => (
        <button key={row.membership_id} type="button" onClick={() => onOpenHotel(row.hotel_id)} className="w-full text-left">
          <RecordRow title={row.hotel_name || "Hotel"} meta={`${statusText(row.hotel_role || "team")} · ${[row.city,row.state].filter(Boolean).join(", ")}`} tail="Open ›" />
        </button>
      )) : <Empty text="No hotel team assignments." />}
    </ListShell>
  );
}

function WeHouseTeam({ rows }: { rows: TeamRecord[] }) {
  return (
    <ListShell title="WeHouse Team assignments" note="Internal authority is scoped by workspace, branch and work area.">
      {rows.length ? rows.map((row, index) => (
        <RecordRow
          key={`${row.role}:${row.permission || index}`}
          title={workspaceLabel(row.role)}
          meta={row.permission ? workspaceLabel(row.permission) : [row.scope_lga,row.scope_state].filter(Boolean).join(", ") || "Global"}
          tail={statusText(row.status || "active")}
        />
      )) : <Empty text="No WeHouse Team assignment." />}
    </ListShell>
  );
}

function PropertyDetail({ selected, onBack, onOpenOperations }: { selected: SelectedRecord; onBack: () => void; onOpenOperations: (id: string) => void }) {
  const hotel = selected.kind === "hotel";
  const row = selected.row;
  const id = hotel ? String((row as HotelRecord).hotel_id) : String((row as ApartmentRecord).id);
  const title = hotel ? (row as HotelRecord).name || "Hotel" : (row as ApartmentRecord).title || "Apartment";
  const images = Array.isArray(row.images) ? row.images : [];
  return (
    <div className="space-y-5 py-5">
      <button type="button" onClick={onBack} className="text-[10px] font-semibold text-violet-300">← Back</button>
      {images[0] ? <img src={images[0]} alt="" className="max-h-52 w-full rounded-2xl object-cover" /> : null}
      <Section title={hotel ? "Hotel record" : "Apartment record"}>
        <Row label="Name" value={title} />
        <Row label="Record ID" value={id} />
        <Row label="Status" value={statusText(row.status || "recorded")} />
        <Row label="Location" value={[row.city,row.state].filter(Boolean).join(", ") || "Not set"} />
        {row.address ? <Row label="Address" value={row.address} /> : null}
        {!hotel && (row as ApartmentRecord).price != null ? <Row label="Price" value={`₦${Number((row as ApartmentRecord).price || 0).toLocaleString()}`} /> : null}
        <Row label="Added" value={dateLabel(row.created_at || "")} />
      </Section>
      <button type="button" onClick={() => onOpenOperations(id)} className="h-11 w-full rounded-xl border border-violet-500/20 bg-violet-500/[.07] text-[10px] font-semibold text-violet-200">
        Open in Property Operations
      </button>
    </div>
  );
}

function TeamAccess({ module, setModule, confirming, setConfirming, promoting, onConfirm }: {
  module: StaffModule;
  setModule: (value: StaffModule) => void;
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  promoting: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-4 py-5">
      <Section title="Add WeHouse Team access">
        <p className="pb-3 text-[9px] leading-5 text-[#747B8C]">
          This does not replace the person’s Personal, Service Worker or Property Partner access. It adds one branch-scoped WeHouse Team assignment.
        </p>
        <select value={module} disabled={promoting} onChange={(e) => setModule(e.target.value as StaffModule)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#151922] px-3 text-xs outline-none">
          {STAFF_MODULES.map(([id,label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        {!confirming ? (
          <button type="button" onClick={() => setConfirming(true)} className="mt-3 h-11 w-full rounded-xl border border-violet-500/20 bg-violet-500/[.07] text-[10px] font-semibold text-violet-200">Continue</button>
        ) : (
          <div className="mt-3 rounded-2xl border border-amber-500/15 bg-amber-500/[.04] p-3">
            <p className="text-[9px] leading-5 text-amber-100">Confirm this internal assignment. The server still checks your Admin branch and authority.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" disabled={promoting} onClick={() => setConfirming(false)} className="h-10 rounded-xl border border-white/[.08] text-[9px] font-semibold">Cancel</button>
              <button type="button" disabled={promoting} onClick={onConfirm} className="h-10 rounded-xl bg-violet-500 text-[9px] font-semibold">{promoting ? "Assigning…" : "Assign access"}</button>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function ListShell({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return <div className="py-5"><div className="mb-4"><h3 className="text-sm font-bold">{title}</h3><p className="mt-1 text-[10px] leading-5 text-[#707687]">{note}</p></div><div className="divide-y divide-white/[.06] border-y border-white/[.06]">{children}</div></div>;
}
function RecordRow({ title, meta, tail }: { title: string; meta: string; tail: string }) {
  return <div className="flex min-h-16 items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold">{title}</p><p className="mt-1 truncate text-[9px] text-[#686F80]">{meta}</p></div><span className="shrink-0 text-[9px] font-semibold text-violet-300">{tail}</span></div>;
}
function Metric({ label, value, onClick }: { label: string; value: string | number; onClick?: () => void }) {
  const content = <div className="rounded-2xl border border-white/[.06] bg-white/[.025] p-3"><p className="text-lg font-bold">{value}</p><p className="mt-1 text-[8px] text-[#697082]">{label}{onClick ? " ›" : ""}</p></div>;
  return onClick ? <button type="button" onClick={onClick} className="text-left">{content}</button> : content;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-2 text-[9px] font-bold uppercase tracking-[.14em] text-[#686F80]">{title}</h3><div className="divide-y divide-white/[.055] border-y border-white/[.055]">{children}</div></section>;
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex min-h-11 items-center justify-between gap-4 py-2.5 text-[10px]"><span className="text-[#6D7384]">{label}</span><span className="max-w-[68%] break-words text-right font-semibold text-[#D8DAE2]">{value}</span></div>;
}
function TextBlock({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-[10px] leading-5 text-[#A2A7B4]">{children}</p>;
}
function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "danger" }) {
  const style = tone === "good" ? "bg-emerald-500/10 text-emerald-300" : tone === "danger" ? "bg-rose-500/10 text-rose-300" : "bg-white/[.05] text-[#A5AAB7]";
  return <span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${style}`}>{children}</span>;
}
function Empty({ text }: { text: string }) {
  return <div className="my-5 rounded-2xl border border-dashed border-white/[.08] px-5 py-10 text-center text-[10px] text-[#676E7F]">{text}</div>;
}
function statusText(value: string) { return String(value || "").replace(/_/g, " "); }
function dateLabel(value: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleDateString(undefined,{ month:"short", day:"numeric", year:"numeric" });
}
