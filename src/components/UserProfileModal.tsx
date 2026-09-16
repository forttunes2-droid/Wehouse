import { useEffect, useState } from "react";
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
  state: string;
  city: string;
  price: number;
  status: string;
  created_at: string;
}

type StaffModule =
  | "operations"
  | "finance"
  | "support"
  | "security"
  | "verification"
  | "field_officer";

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
      const { data: direct } = await supabase
        .from("listings")
        .select("id,title,state,city,price,status,created_at")
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
        .select("id,title,state,city,price,status,created_at")
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

  const sheet = (
    <div
      className="fixed inset-0 z-[100040] bg-black/70 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-hidden rounded-t-[28px] border-t border-white/[.08] bg-[#0D1017] text-white shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[460px] sm:rounded-none sm:border-l sm:border-t-0">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/15 sm:hidden" />

        <header className="sticky top-0 z-10 border-b border-white/[.06] bg-[#0D1017]/95 px-5 pb-4 pt-4 backdrop-blur-xl">
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
        </header>

        <div className="max-h-[calc(88dvh-92px)] overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-h-[100dvh]">
          {user.role === "worker" && providerStats ? (
            <section className="grid grid-cols-3 gap-2 py-4">
              <Metric label="Jobs" value={providerStats.totalBookings} />
              <Metric label="Completed" value={providerStats.completedBookings} />
              <Metric
                label="Reviews"
                value={providerStats.reviewCount ? providerStats.avgRating.toFixed(1) : "New"}
              />
            </section>
          ) : null}

          {user.role === "property_partner" ? (
            <section className="grid grid-cols-2 gap-2 py-4">
              <Metric label="Properties" value={partnerProperties.length} />
              <Metric
                label="Live"
                value={partnerProperties.filter((item) => item.status === "available").length}
              />
            </section>
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
            {user.role === "admin" ? (
              <Row label="Work area" value="Branch administration" />
            ) : null}
            {user.role === "staff" ? (
              <Row label="Work area" value={existingModule || "Not assigned"} />
            ) : null}
          </Section>

          {user.role === "worker" ? (
            <Section title="Service Provider profile">
              <Row label="Occupation" value={workerOccupation(user) || "Not set"} />
              {user.worker_experience ? (
                <Row label="Experience" value={String(user.worker_experience)} />
              ) : null}
              {user.worker_price ? (
                <Row label="Service price" value={`₦${Number(user.worker_price).toLocaleString()}`} />
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
              {providerStats ? (
                <Row
                  label="Completed-job earnings"
                  value={`₦${providerStats.totalEarnings.toLocaleString()}`}
                />
              ) : null}
            </Section>
          ) : null}

          {user.role === "property_partner" && partnerProperties.length ? (
            <Section title="Properties">
              {partnerProperties.slice(0, 5).map((property) => (
                <button
                  type="button"
                  key={property.id}
                  onClick={() => {
                    onNavigate?.("operations_properties", property.id);
                    onClose();
                  }}
                  className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-white/[.05] py-3 text-left last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-semibold">
                      {property.title}
                    </span>
                    <span className="mt-1 block truncate text-[9px] text-[#686F80]">
                      {[property.city, property.state].filter(Boolean).join(", ")} · {String(property.status || "recorded").replace(/_/g, " ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[10px] font-semibold text-violet-300">
                    ₦{Number(property.price || 0).toLocaleString()} ›
                  </span>
                </button>
              ))}
            </Section>
          ) : null}

          {user.bio ? (
            <Section title="About">
              <TextBlock>{user.bio}</TextBlock>
            </Section>
          ) : null}

          {canAppoint ? (
            <Section title="Branch management">
              <p className="pb-3 text-[9px] leading-5 text-[#747B8C]">
                Add this User to your branch Operations team. Creator-wide team changes remain in the Team workspace rather than this profile viewer.
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
              {!confirmingPromote ? (
                <button
                  type="button"
                  onClick={() => setConfirmingPromote(true)}
                  className="mt-2 h-11 w-full rounded-xl border border-violet-500/20 bg-violet-500/[.07] text-[10px] font-semibold text-violet-200"
                >
                  Add to Operations team
                </button>
              ) : (
                <div className="mt-2 rounded-xl border border-white/[.07] bg-black/15 p-3">
                  <p className="text-[9px] leading-5 text-[#858B9B]">
                    Confirm adding this account to {STAFF_MODULES.find(([id]) => id === adminModule)?.[1]}.
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmingPromote(false)}
                      className="h-10 rounded-xl border border-white/[.08] text-[10px] text-[#8B91A1]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={promoting}
                      onClick={() => void appointToOperations()}
                      className="h-10 rounded-xl bg-violet-500 text-[10px] font-semibold disabled:opacity-40"
                    >
                      {promoting ? "Adding…" : "Confirm"}
                    </button>
                  </div>
                </div>
              )}
            </Section>
          ) : null}

          <p className="py-4 text-center text-[8px] leading-4 text-[#4F5667]">
            Account ID · {user.user_id}
          </p>
        </div>
      </aside>
    </div>
  );

  return createPortal(
    <>
      {sheet}
      {avatarOpen && user.avatar_url ? (
        <MediaViewer
          src={user.avatar_url}
          kind="image"
          title={user.full_name || user.username || "Profile photo"}
          onClose={() => setAvatarOpen(false)}
        />
      ) : null}
    </>,
    document.body,
  );
}

function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "good" | "danger";
}) {
  const style =
    tone === "good"
      ? "border-emerald-500/15 bg-emerald-500/[.06] text-emerald-300"
      : tone === "danger"
        ? "border-red-500/15 bg-red-500/[.06] text-red-300"
        : "border-violet-500/15 bg-violet-500/[.06] text-violet-200";
  return (
    <span className={`rounded-full border px-2 py-1 text-[8px] font-semibold ${style}`}>
      {children}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/[.055] bg-[#11151D] p-3">
      <p className="text-base font-bold">{value}</p>
      <p className="mt-1 text-[8px] text-[#62697A]">{label}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-white/[.06] py-4 last:border-b-0">
      <h3 className="mb-2 text-[9px] font-bold uppercase tracking-[.14em] text-[#676E7F]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 border-b border-white/[.045] py-2 last:border-b-0">
      <span className="shrink-0 text-[9px] text-[#6B7283]">{label}</span>
      <span className="min-w-0 break-words text-right text-[10px] font-medium text-[#D7DAE2]">
        {value}
      </span>
    </div>
  );
}

function TextBlock({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-[10px] leading-5 text-[#B1B6C3]">{children}</p>;
}
