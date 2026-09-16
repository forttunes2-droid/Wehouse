import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";
import { workerOccupation } from "@/lib/workerTaxonomy";
import MediaViewer from "@/components/MediaViewer";

interface UserProfileModalProps {
  user: Profile | null;
  adminProfile?: Profile | null;
  onClose: () => void;
  onPromote?: () => void;
  onNavigate?: (page: string, id?: string) => void;
  onGoToChat?: (convId?: string) => void;
}

interface ProviderStats {
  totalBookings: number;
  completedBookings: number;
  totalEarnings: number;
  avgRating: number;
  reviewCount: number;
}

interface PartnerProperty {
  id: string;
  title: string;
  sub_type?: string | null;
  address?: string | null;
  state: string;
  city: string;
  price: number;
  status: string;
  images?: string[] | null;
  created_at: string;
}

type StaffModule =
  | "operations"
  | "finance"
  | "support"
  | "security"
  | "verification"
  | "field_officer";
type SectionKey = "overview" | "professional" | "properties" | "assignment" | "access";

const STAFF_MODULES: Array<[StaffModule, string]> = [
  ["operations", "Property Operations"],
  ["finance", "Finance Operations"],
  ["support", "Support Operations"],
  ["security", "Security Operations"],
  ["verification", "Worker Operations"],
  ["field_officer", "Field Operations"],
];

export default function UserProfileModal(props: UserProfileModalProps) {
  if (!props.user) return null;
  return <UserProfileSheet {...props} user={props.user} />;
}

function UserProfileSheet({
  user,
  adminProfile,
  onClose,
  onPromote,
  onNavigate,
}: UserProfileModalProps & { user: Profile }) {
  const [providerStats, setProviderStats] = useState<ProviderStats | null>(null);
  const [partnerProperties, setPartnerProperties] = useState<PartnerProperty[]>([]);
  const [existingModule, setExistingModule] = useState<string | null>(null);
  const [adminModule, setAdminModule] = useState<StaffModule>("operations");
  const [confirmingPromote, setConfirmingPromote] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [section, setSection] = useState<SectionKey>("overview");
  const [selectedProperty, setSelectedProperty] = useState<PartnerProperty | null>(null);

  const isAdmin = adminProfile?.role === "admin";
  const adminState = adminProfile?.assigned_state || adminProfile?.state || "";
  const adminLga =
    adminProfile?.assigned_lga ||
    adminProfile?.local_government ||
    adminProfile?.city ||
    "";
  const userState = user.state || "";
  const userLga = user.local_government || user.city || "";
  const inBranch = userState === adminState && userLga === adminLga;
  const canAppoint = isAdmin && inBranch && user.role === "user";
  const initials = String(user.full_name || user.username || user.email || "W")
    .trim()
    .charAt(0)
    .toUpperCase();

  useEffect(() => {
    setSection("overview");
    setSelectedProperty(null);
  }, [user.user_id]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadProviderStats() {
      if (user.role !== "worker") return;
      const [{ data: bookings }, { data: reviews }] = await Promise.all([
        supabase
          .from("worker_bookings")
          .select("status,worker_receives")
          .eq("worker_id", user.user_id),
        supabase.from("reviews").select("rating").eq("worker_id", user.user_id),
      ]);
      if (!active) return;
      const bookingRows = bookings || [];
      const reviewRows = reviews || [];
      const completed = bookingRows.filter(
        (row: any) => row.status === "approved_released",
      );
      setProviderStats({
        totalBookings: bookingRows.length,
        completedBookings: completed.length,
        totalEarnings: completed.reduce(
          (sum: number, row: any) => sum + Number(row.worker_receives || 0),
          0,
        ),
        avgRating: reviewRows.length
          ? reviewRows.reduce(
              (sum: number, row: any) => sum + Number(row.rating || 0),
              0,
            ) / reviewRows.length
          : 0,
        reviewCount: reviewRows.length,
      });
    }

    async function loadPartnerProperties() {
      if (user.role !== "property_partner") return;
      const fields = "id,title,sub_type,address,state,city,price,status,images,created_at";
      const { data: direct } = await supabase
        .from("listings")
        .select(fields)
        .eq("partner_id", user.user_id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (!active) return;
      if (direct?.length) {
        setPartnerProperties(direct as PartnerProperty[]);
        return;
      }
      const { data: owned } = await supabase
        .from("listings")
        .select(fields)
        .eq("owner_id", user.user_id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (active) setPartnerProperties((owned || []) as PartnerProperty[]);
    }

    async function loadTeamAssignment() {
      if (user.role !== "staff") return;
      const { data } = await supabase
        .from("staff_permissions")
        .select("permission")
        .eq("staff_id", user.user_id)
        .eq("is_active", true)
        .limit(2);
      if (!active) return;
      const values = (data || []).map((row: any) => String(row.permission));
      setExistingModule(
        values.length === 1
          ? STAFF_MODULES.find(([id]) => id === values[0])?.[1] || values[0]
          : values.length > 1
            ? "Assignment conflict"
            : null,
      );
    }

    void loadProviderStats();
    void loadPartnerProperties();
    void loadTeamAssignment();
    return () => {
      active = false;
    };
  }, [user]);

  async function appointToOperations() {
    setPromoting(true);
    const { data, error } = await supabase.rpc("admin_appoint_staff", {
      p_target_user_id: user.user_id,
      p_module: adminModule,
    });
    setPromoting(false);
    setConfirmingPromote(false);
    if (error) return toast.error(error.message);
    if (!data) return toast.error("The team assignment was not completed");
    toast.success("Operations access assigned");
    onPromote?.();
    onClose();
  }

  const roleLabel =
    user.role === "worker"
      ? "Service Provider"
      : user.role === "property_partner"
        ? "Property Partner"
        : user.role === "staff"
          ? "Operations member"
          : user.role === "admin"
            ? "Admin"
            : user.role === "creator"
              ? "Creator"
              : "User";

  const statusLabel = user.deleted
    ? "Deleted"
    : user.banned
      ? "Banned"
      : user.suspended
        ? "Suspended"
        : "Active";

  const sections = useMemo(() => {
    const next: Array<{ id: SectionKey; label: string; count?: number }> = [
      { id: "overview", label: "Overview" },
    ];
    if (user.role === "worker") next.push({ id: "professional", label: "Provider" });
    if (user.role === "property_partner")
      next.push({ id: "properties", label: "Properties", count: partnerProperties.length });
    if (["staff", "admin", "creator"].includes(user.role))
      next.push({ id: "assignment", label: "Assignment" });
    if (canAppoint) next.push({ id: "access", label: "Access" });
    return next;
  }, [canAppoint, partnerProperties.length, user.role]);

  useEffect(() => {
    if (!sections.some((item) => item.id === section)) setSection("overview");
  }, [section, sections]);

  const sheet = (
    <div
      className="fixed inset-0 z-[100040] bg-black/70 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="absolute inset-x-0 bottom-0 max-h-[90dvh] overflow-hidden rounded-t-[28px] border-t border-white/[.08] bg-[#0D1017] text-white shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[480px] sm:rounded-none sm:border-l sm:border-t-0">
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
                <Badge>{roleLabel}</Badge>
                <Badge tone={statusLabel === "Active" ? "good" : "danger"}>
                  {statusLabel}
                </Badge>
                {user.role === "worker" && user.worker_verified ? (
                  <Badge tone="good">WeHouse reviewed</Badge>
                ) : null}
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
                  setSelectedProperty(null);
                  setSection(item.id);
                }}
                className={`relative shrink-0 pb-2.5 text-[10px] font-semibold ${section === item.id && !selectedProperty ? "text-white" : "text-[#707687]"}`}
              >
                {item.label}
                {typeof item.count === "number" ? ` ${item.count}` : ""}
                {section === item.id && !selectedProperty ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-violet-500" />
                ) : null}
              </button>
            ))}
          </nav>
        </header>

        <div className="max-h-[calc(90dvh-150px)] overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-h-[calc(100dvh-145px)]">
          {selectedProperty ? (
            <PropertyRecord
              property={selectedProperty}
              canOpenOperations={adminProfile?.role === "creator"}
              onBack={() => setSelectedProperty(null)}
              onOpenOperations={() => {
                onNavigate?.("operations_properties", selectedProperty.id);
                onClose();
              }}
            />
          ) : section === "overview" ? (
            <OverviewSection
              user={user}
              providerStats={providerStats}
              partnerProperties={partnerProperties}
              existingModule={existingModule}
              onOpenProperties={() => setSection("properties")}
            />
          ) : section === "professional" ? (
            <ProviderSection user={user} providerStats={providerStats} />
          ) : section === "properties" ? (
            <PropertiesSection
              properties={partnerProperties}
              onOpen={setSelectedProperty}
            />
          ) : section === "assignment" ? (
            <AssignmentSection user={user} existingModule={existingModule} />
          ) : (
            <AccessSection
              adminModule={adminModule}
              setAdminModule={setAdminModule}
              confirming={confirmingPromote}
              setConfirming={setConfirmingPromote}
              promoting={promoting}
              onConfirm={() => void appointToOperations()}
            />
          )}
        </div>
      </aside>

      {avatarOpen && user.avatar_url ? (
        <MediaViewer
          src={user.avatar_url}
          kind="image"
          title={user.full_name || user.username || "Profile photo"}
          onClose={() => setAvatarOpen(false)}
        />
      ) : null}
    </div>
  );

  return createPortal(sheet, document.body);
}

function OverviewSection({
  user,
  providerStats,
  partnerProperties,
  existingModule,
  onOpenProperties,
}: {
  user: Profile;
  providerStats: ProviderStats | null;
  partnerProperties: PartnerProperty[];
  existingModule: string | null;
  onOpenProperties: () => void;
}) {
  return (
    <div className="space-y-5 py-5">
      {user.role === "worker" && providerStats ? (
        <section className="grid grid-cols-3 gap-2">
          <Metric label="Jobs" value={providerStats.totalBookings} />
          <Metric label="Completed" value={providerStats.completedBookings} />
          <Metric
            label="Rating"
            value={providerStats.reviewCount ? providerStats.avgRating.toFixed(1) : "New"}
          />
        </section>
      ) : null}

      {user.role === "property_partner" ? (
        <button
          type="button"
          onClick={onOpenProperties}
          className="grid w-full grid-cols-2 gap-2 text-left"
        >
          <Metric label="Properties" value={partnerProperties.length} action />
          <Metric
            label="Live"
            value={partnerProperties.filter((item) => item.status === "available").length}
            action
          />
        </button>
      ) : null}

      <Section title="Account">
        <Row label="Name" value={user.full_name || "Not set"} />
        <Row label="Email" value={user.email || "Not set"} />
        <Row label="Phone" value={user.phone || "Not set"} />
        <Row label="State" value={user.state || "Not set"} />
        <Row label="LGA" value={user.local_government || user.city || "Not set"} />
        <Row
          label="Joined"
          value={new Date(user.created_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        />
      </Section>

      {user.role === "staff" ? (
        <Section title="Current assignment">
          <Row label="Work area" value={existingModule || "Not assigned"} />
          <Row label="State" value={user.assigned_state || user.state || "Not assigned"} />
          <Row
            label="LGA"
            value={user.assigned_lga || user.local_government || user.city || "Not assigned"}
          />
        </Section>
      ) : null}

      {user.bio ? (
        <Section title="About">
          <TextBlock>{user.bio}</TextBlock>
        </Section>
      ) : null}
    </div>
  );
}

function ProviderSection({
  user,
  providerStats,
}: {
  user: Profile;
  providerStats: ProviderStats | null;
}) {
  return (
    <div className="space-y-5 py-5">
      <Section title="Professional profile">
        <Row label="Occupation" value={workerOccupation(user) || "Not set"} />
        {user.worker_experience ? (
          <Row label="Experience" value={String(user.worker_experience)} />
        ) : null}
        {user.worker_price ? (
          <Row
            label="Service price"
            value={`₦${Number(user.worker_price).toLocaleString()}`}
          />
        ) : null}
        {user.worker_bio ? <TextBlock>{user.worker_bio}</TextBlock> : null}
        {user.worker_skills?.length ? (
          <div className="flex flex-wrap gap-1.5 py-3">
            {user.worker_skills.map((skill: string) => (
              <span
                key={skill}
                className="rounded-full border border-violet-500/15 bg-violet-500/[.06] px-2.5 py-1 text-[9px] text-violet-200"
              >
                {skill}
              </span>
            ))}
          </div>
        ) : null}
      </Section>
      <Section title="WeHouse work record">
        <Row label="Jobs" value={String(providerStats?.totalBookings || 0)} />
        <Row label="Completed" value={String(providerStats?.completedBookings || 0)} />
        <Row label="Reviews" value={String(providerStats?.reviewCount || 0)} />
        <Row
          label="Completed-job earnings"
          value={`₦${Number(providerStats?.totalEarnings || 0).toLocaleString()}`}
        />
      </Section>
    </div>
  );
}

function PropertiesSection({
  properties,
  onOpen,
}: {
  properties: PartnerProperty[];
  onOpen: (property: PartnerProperty) => void;
}) {
  return (
    <div className="py-5">
      <div className="mb-4">
        <p className="text-sm font-bold">Property records</p>
        <p className="mt-1 text-[10px] leading-5 text-[#707687]">
          Open any property to see the record attached to this Property Partner.
        </p>
      </div>
      {properties.length === 0 ? (
        <Empty text="No property records are attached to this Property Partner." />
      ) : (
        <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
          {properties.map((property, index) => (
            <button
              type="button"
              key={property.id}
              onClick={() => onOpen(property)}
              className="flex min-h-16 w-full items-center gap-3 py-3 text-left"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-[10px] font-bold text-violet-200">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-semibold">
                  {property.title || "Untitled property"}
                </span>
                <span className="mt-1 block truncate text-[9px] text-[#686F80]">
                  {[property.city, property.state].filter(Boolean).join(", ") || "Location unavailable"} · {statusText(property.status)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[10px] font-semibold text-violet-300">
                  ₦{Number(property.price || 0).toLocaleString()}
                </span>
                <span className="mt-1 block text-[8px] text-[#62697A]">View ›</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PropertyRecord({
  property,
  canOpenOperations,
  onBack,
  onOpenOperations,
}: {
  property: PartnerProperty;
  canOpenOperations: boolean;
  onBack: () => void;
  onOpenOperations: () => void;
}) {
  const cover = Array.isArray(property.images) ? property.images.find(Boolean) : null;
  return (
    <div className="space-y-5 py-5">
      <button
        type="button"
        onClick={onBack}
        className="text-[10px] font-semibold text-violet-300"
      >
        ← Properties
      </button>
      {cover ? (
        <div className="overflow-hidden rounded-2xl border border-white/[.06] bg-black">
          <img src={cover} alt="" className="max-h-52 w-full object-cover" />
        </div>
      ) : null}
      <section className="border-b border-white/[.07] pb-4">
        <p className="text-[8px] font-bold uppercase tracking-[.16em] text-violet-300">
          Property record
        </p>
        <h3 className="mt-2 text-lg font-bold">{property.title || "Untitled property"}</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge>{property.sub_type ? statusText(property.sub_type) : "Property"}</Badge>
          <Badge tone={property.status === "available" ? "good" : "neutral"}>
            {statusText(property.status || "recorded")}
          </Badge>
        </div>
      </section>
      <Section title="Property facts">
        <Row label="Property ID" value={property.id} />
        <Row label="Price" value={`₦${Number(property.price || 0).toLocaleString()}`} />
        <Row
          label="Location"
          value={[property.city, property.state].filter(Boolean).join(", ") || "Not set"}
        />
        {property.address ? <Row label="Address" value={property.address} /> : null}
        <Row
          label="Submitted"
          value={new Date(property.created_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        />
      </Section>
      {canOpenOperations ? (
        <button
          type="button"
          onClick={onOpenOperations}
          className="h-11 w-full rounded-xl border border-violet-500/20 bg-violet-500/[.07] text-[10px] font-semibold text-violet-200"
        >
          Open in Property Operations
        </button>
      ) : null}
    </div>
  );
}

function AssignmentSection({
  user,
  existingModule,
}: {
  user: Profile;
  existingModule: string | null;
}) {
  const label =
    user.role === "creator"
      ? "Platform Creator"
      : user.role === "admin"
        ? "Branch administration"
        : existingModule || "Not assigned";
  return (
    <div className="space-y-5 py-5">
      <Section title="Work assignment">
        <Row label="Role" value={label} />
        <Row label="State" value={user.assigned_state || user.state || "Not assigned"} />
        <Row
          label="LGA"
          value={user.assigned_lga || user.local_government || user.city || "Not assigned"}
        />
      </Section>
      <p className="text-[10px] leading-5 text-[#707687]">
        Authority is controlled by the assigned WeHouse workspace and server permissions, not by this profile viewer.
      </p>
    </div>
  );
}

function AccessSection({
  adminModule,
  setAdminModule,
  confirming,
  setConfirming,
  promoting,
  onConfirm,
}: {
  adminModule: StaffModule;
  setAdminModule: (module: StaffModule) => void;
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  promoting: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-4 py-5">
      <Section title="Branch team access">
        <p className="pb-3 text-[9px] leading-5 text-[#747B8C]">
          Add this User to one Operations work area in your branch. Creator-wide team changes stay in the Team workspace.
        </p>
        <select
          value={adminModule}
          disabled={promoting}
          onChange={(event) => setAdminModule(event.target.value as StaffModule)}
          className="h-11 w-full rounded-xl border border-white/[.08] bg-[#151922] px-3 text-xs outline-none disabled:opacity-40"
        >
          {STAFF_MODULES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mt-3 h-11 w-full rounded-xl border border-violet-500/20 bg-violet-500/[.07] text-[10px] font-semibold text-violet-200"
          >
            Continue
          </button>
        ) : (
          <div className="mt-3 rounded-2xl border border-amber-500/15 bg-amber-500/[.04] p-3">
            <p className="text-[10px] leading-5 text-amber-100">
              Confirm this branch access assignment. It changes what this account can work on.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={promoting}
                onClick={() => setConfirming(false)}
                className="h-10 rounded-xl border border-white/[.08] text-[9px] font-semibold disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={promoting}
                onClick={onConfirm}
                className="h-10 rounded-xl bg-violet-500 text-[9px] font-semibold disabled:opacity-40"
              >
                {promoting ? "Assigning…" : "Confirm access"}
              </button>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[9px] font-bold uppercase tracking-[.14em] text-[#656C7D]">
        {title}
      </h3>
      <div className="divide-y divide-white/[.055] border-y border-white/[.055]">
        {children}
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2.5 text-[10px]">
      <span className="shrink-0 text-[#6D7383]">{label}</span>
      <span className="min-w-0 break-words text-right font-medium text-[#D6D8E0]">
        {value}
      </span>
    </div>
  );
}

function Metric({
  label,
  value,
  action = false,
}: {
  label: string;
  value: string | number;
  action?: boolean;
}) {
  return (
    <span className="block rounded-2xl border border-white/[.06] bg-white/[.025] p-3">
      <span className="block text-base font-bold">{value}</span>
      <span className="mt-1 flex items-center gap-1 text-[8px] text-[#697080]">
        {label} {action ? <span className="text-violet-300">›</span> : null}
      </span>
    </span>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "danger";
}) {
  const style =
    tone === "good"
      ? "bg-emerald-500/10 text-emerald-300"
      : tone === "danger"
        ? "bg-rose-500/10 text-rose-300"
        : "bg-white/[.05] text-[#A9AFBC]";
  return (
    <span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${style}`}>
      {children}
    </span>
  );
}

function TextBlock({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-[10px] leading-5 text-[#B1B6C3]">{children}</p>;
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-12 text-center text-[10px] text-[#666D7E]">
      {text}
    </div>
  );
}

function statusText(value: string) {
  return String(value || "").replace(/_/g, " ");
}
