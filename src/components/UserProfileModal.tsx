import { propertyRecordKey } from "@/lib/propertyNavigation";
import PropertyPipelineWorkspace from "@/components/PropertyPipelineWorkspace";
import { useRecordScreenBack } from "@/hooks/useRecordScreenBack";
import { useEffect, useState } from "react";
import { withTimeout } from "@/lib/withTimeout";
import { useDialogInteraction } from "@/hooks/useDialogInteraction";
import BackButton from "@/components/BackButton";
import { createPortal } from "react-dom";
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
  | "wehouse_team";

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

interface UserProfileModalProps {
  user: Profile | null;
  adminProfile?: Profile | null;
  onClose: () => void;
  onPromote?: () => void;
  onNavigate?: (page: string, id?: string) => void;
  onGoToChat?: (convId?: string) => void;
}

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
  return <InternalProfileSheet key={`${props.adminProfile?.user_id || "viewer"}:${props.user.user_id}`} {...props} user={props.user} />;
}

function InternalProfileSheet({ user, adminProfile, onClose, onNavigate }: UserProfileModalProps & { user: Profile }) {
  const [record, setRecord] = useState<InternalProfileRecord | null>(null);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [section, setSection] = useState<SectionKey>("overview");
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [operationTarget, setOperationTarget] = useState<string>();
  const dismiss = useRecordScreenBack(onClose);
  const closeSection = useRecordScreenBack(() => setSection("overview"), section !== "overview");
  const closeOperation = useRecordScreenBack(() => setOperationTarget(undefined), Boolean(operationTarget));
  const back = operationTarget ? closeOperation : section !== "overview" ? closeSection : dismiss;
  // A property owns its full-screen dialog. Keep profile state/history, not
  // an empty profile portal above that dialog or a competing focus trap.
  const dialogRef = useDialogInteraction(back, !operationTarget);

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(""); setRecord(null);
    void (async () => {
      try {
        const { data, error } = await withTimeout(supabase.rpc("get_internal_profile_record", { p_target_user_id: user.user_id }), 15000, "Profile request timed out.");
        if (!active) return;
        if (error) throw error;
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Profile response unavailable.");
        setRecord(data as InternalProfileRecord);
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || "");
        setLoadError(/outside|scope|workspace required/i.test(message) ? "This profile is outside your current work coverage." : "Profile details could not be loaded. Please try again.");
        setRecord(null);
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [user.user_id, reloadKey]);

  const workspaces = Array.isArray(record?.workspaces) ? record.workspaces : [], apartments = Array.isArray(record?.apartments) ? record.apartments : [], hotels = Array.isArray(record?.hotels_owned) ? record.hotels_owned : [];
  const hotelTeam = record?.hotel_team || [], wehouseTeam = record?.wehouse_team || [], provider = record?.service_provider || null;
  const initials = String(user.full_name || user.username || "W").trim().charAt(0).toUpperCase();
  const status = user.deleted ? "Deleted" : user.banned ? "Banned" : user.suspended ? "Suspended" : "Active";
  const titles: Record<SectionKey, string> = { overview: "Account profile", workspaces: "Workspace access", professional: "Service Worker", apartments: "Homes", hotels: "Hotels", hotel_team: "Hotel Team", wehouse_team: "WeHouse Team" };

  function openOperations(kind: "apartment" | "hotel", id: string) {
    const target = propertyRecordKey(kind === "hotel" ? "hotel" : "listing", id);
    if (adminProfile) setOperationTarget(target);
    else if (onNavigate) { onClose(); onNavigate("operations_properties", target); }
  }

  if (operationTarget && adminProfile) {
    return <PropertyPipelineWorkspace profile={adminProfile} initialRecordId={operationTarget} onExitRecord={closeOperation} />;
  }

  return createPortal(<div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[100040] flex items-end justify-center bg-[#090B10] text-white sm:items-center sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget) back(); }}>
    <aside role="dialog" aria-modal="true" aria-label="Account profile" className="flex h-[94dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-white/[.08] bg-[#0D1017] shadow-2xl sm:rounded-3xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-white/[.08] px-5 py-4">
          <BackButton onClick={back} ariaLabel={section === "overview" ? "Close profile" : "Back to account profile"} />
          <div className="min-w-0"><h2 className="text-base font-semibold">{titles[section]}</h2>{section !== "overview" && <p className="mt-1 break-words text-sm text-[#A1A7B4]">{user.full_name || user.username || "WeHouse account"}</p>}</div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {loading ? <div role="status"><Empty text="Loading account record…" /></div> : !record ? <div role="alert" className="py-8 text-center"><p className="text-sm leading-6 text-[#D8DAE2]">{loadError || "Profile details are unavailable."}</p><button type="button" onClick={() => setReloadKey(value => value + 1)} className="mt-4 min-h-11 rounded-xl border border-violet-500/20 px-4 text-sm font-semibold text-violet-300">Try again</button></div> : section === "overview" ? <div className="space-y-6 py-5">
            <section className="flex items-center gap-4">
              <button type="button" disabled={!user.avatar_url} onClick={() => setAvatarOpen(true)} className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-violet-500/15 text-xl font-bold text-violet-200" aria-label="Preview profile photo">{user.avatar_url ? <img src={user.avatar_url} alt="" className="h-full w-full object-cover" /> : initials}</button>
              <div className="min-w-0 flex-1"><h3 className="break-words text-xl font-semibold">{user.full_name || user.username || "WeHouse account"}</h3>{user.username && <p className="mt-1 break-words text-sm text-[#A1A7B4]">@{user.username}</p>}<div className="mt-2"><Badge tone={status === "Active" ? "good" : "danger"}>{status}</Badge></div></div>
            </section>
            <Section title="Account details"><Row label="Email" value={user.email || "Not set"} /><Row label="Phone" value={user.phone || "Not set"} /><Row label="Location" value={[user.local_government || user.city, user.state].filter(Boolean).join(", ") || "Not set"} /><Row label="Joined" value={dateLabel(user.created_at)} /></Section>
            <Section title="Linked records">
              <button type="button" onClick={() => setSection("workspaces")} className="w-full text-left"><RecordRow title="Workspace access" meta="Current approved access" tail={`${workspaces.length} ›`} /></button>
              {provider && <button type="button" onClick={() => setSection("professional")} className="w-full text-left"><RecordRow title="Service Worker" meta={provider.occupation || "Professional profile"} tail="View ›" /></button>}
              {apartments.length > 0 && <button type="button" onClick={() => setSection("apartments")} className="w-full text-left"><RecordRow title="Homes" meta="Short Let and Long Let properties" tail={`${apartments.length} ›`} /></button>}
              {hotels.length > 0 && <button type="button" onClick={() => setSection("hotels")} className="w-full text-left"><RecordRow title="Hotels" meta="Owned hotel properties" tail={`${hotels.length} ›`} /></button>}
              {hotelTeam.length > 0 && <button type="button" onClick={() => setSection("hotel_team")} className="w-full text-left"><RecordRow title="Hotel Team" meta="Assigned hotels" tail={`${hotelTeam.length} ›`} /></button>}
              {wehouseTeam.length > 0 && <button type="button" onClick={() => setSection("wehouse_team")} className="w-full text-left"><RecordRow title="WeHouse Team" meta="Assigned work and coverage" tail={`${wehouseTeam.length} ›`} /></button>}
            </Section>
          </div> : section === "workspaces" ? <Workspaces rows={workspaces} /> : section === "professional" && provider ? <Provider provider={provider} onOpen={() => { if (onNavigate) { onClose(); onNavigate("worker_operations", user.user_id); } }} /> : section === "apartments" ? <ApartmentList rows={apartments} onOpen={row => openOperations("apartment", row.id)} /> : section === "hotels" ? <HotelList rows={hotels} onOpen={row => openOperations("hotel", String(row.hotel_id))} /> : section === "hotel_team" ? <HotelTeam rows={hotelTeam} onOpenHotel={id => openOperations("hotel", String(id))} /> : <WeHouseTeam rows={wehouseTeam} />}
        </div>
    </aside>
    {avatarOpen && user.avatar_url && <MediaViewer items={[{ url: user.avatar_url, kind: "image" as const }]} initialIndex={0} title={user.full_name || user.username || "Profile photo"} onClose={() => setAvatarOpen(false)} />}
  </div>, document.body);
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
      <button type="button" onClick={onOpen} className="h-11 w-full rounded-xl border border-violet-500/20 bg-violet-500/[.07] text-sm font-semibold text-violet-200">
        Open in Worker Operations
      </button>
    </div>
  );
}

function ApartmentList({ rows, onOpen }: { rows: ApartmentRecord[]; onOpen: (row: ApartmentRecord) => void }) {
  return (
    <ListShell title="Homes" note="Open a property to review its current record.">
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
    <ListShell title="Hotels" note="Open a hotel to review its current record.">
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

function ListShell({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return <div className="py-5"><div className="mb-4"><h3 className="text-sm font-bold">{title}</h3><p className="mt-1 text-sm leading-5 text-[#A1A7B4]">{note}</p></div><div className="divide-y divide-white/[.06] border-y border-white/[.06]">{children}</div></div>;
}
function RecordRow({ title, meta, tail }: { title: string; meta: string; tail: string }) {
  return <div className="flex min-h-16 items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{title}</p><p className="mt-1 break-words text-sm text-[#A1A7B4]">{meta}</p></div><span className="shrink-0 text-sm font-semibold text-violet-300">{tail}</span></div>;
}
function Metric({ label, value, onClick }: { label: string; value: string | number; onClick?: () => void }) {
  const content = <div className="rounded-2xl border border-white/[.06] bg-white/[.025] p-3"><p className="text-lg font-bold">{value}</p><p className="mt-1 text-sm text-[#A1A7B4]">{label}{onClick ? " ›" : ""}</p></div>;
  return onClick ? <button type="button" onClick={onClick} className="text-left">{content}</button> : content;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-2 text-sm font-bold uppercase tracking-[.14em] text-[#A1A7B4]">{title}</h3><div className="divide-y divide-white/[.055] border-y border-white/[.055]">{children}</div></section>;
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex min-h-11 items-center justify-between gap-4 py-2.5 text-sm"><span className="text-[#A1A7B4]">{label}</span><span className="max-w-[68%] break-words text-right font-semibold text-[#D8DAE2]">{value}</span></div>;
}
function TextBlock({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-sm leading-5 text-[#A2A7B4]">{children}</p>;
}
function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "danger" }) {
  const style = tone === "good" ? "bg-emerald-500/10 text-emerald-300" : tone === "danger" ? "bg-rose-500/10 text-rose-300" : "bg-white/[.05] text-[#A5AAB7]";
  return <span className={`rounded-full px-2 py-1 text-sm font-semibold ${style}`}>{children}</span>;
}
function Empty({ text }: { text: string }) {
  return <div className="my-5 rounded-2xl border border-dashed border-white/[.08] px-5 py-10 text-center text-sm text-[#676E7F]">{text}</div>;
}
function statusText(value: string) { return String(value || "").replace(/_/g, " "); }
function dateLabel(value: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleDateString(undefined,{ month:"short", day:"numeric", year:"numeric" });
}
