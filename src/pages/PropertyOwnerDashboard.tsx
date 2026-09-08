import { useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import { supabase } from "@/lib/supabase";
import PropertyInspectionRequestPanel from "@/components/PropertyInspectionRequestPanel";
import PropertyPartnerFinancePanel from "@/components/PropertyPartnerFinancePanel";
import PayoutAccountManager from "@/components/PayoutAccountManager";
import CommunicationInbox from "@/components/CommunicationInbox";
import PartnerSubmittedRequests, {
  type SubmissionFilter,
} from "@/components/PartnerSubmittedRequests";
import PartnerHotelOperations from "@/components/PartnerHotelOperations";
import WeHouseSelect from "@/components/WeHouseSelect";
import WorkspaceFrameV2 from "@/components/WorkspaceFrameV2";
import PropertyMediaCarousel from "@/components/PropertyMediaCarousel";
import type { Profile } from "@/types";
import { usePartnerInboxSummary } from "@/hooks/usePartnerInboxSummary";

type PartnerTab = "properties" | "finance" | "communication";
type Props = {
  profile: Profile;
  onLogout: () => void;
  onNavigate: (page: string) => void;
  onGoToChat?: (convId?: string) => void;
};
type EarningRelease = {
  id: string;
  earning_type: string;
  status: "pending" | "available" | "held" | "reversed";
  net_amount: number;
  release_event: string | null;
  created_at: string;
};
const TABS: Array<{ key: PartnerTab; label: string; description: string }> = [
  {
    key: "properties",
    label: "Properties",
    description: "Submit properties and follow them through publication",
  },
  {
    key: "communication",
    label: "Inbox",
    description: "Your conversations and official activity in one place",
  },
  {
    key: "finance",
    label: "Finance",
    description: "Your wallet, earnings and withdrawals",
  },
];
const money = (value: number) =>
  `₦${Number(value || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PropertyOwnerDashboard({
  profile,
  onLogout,
  onNavigate,
}: Props) {
  const [tab, setTab] = useState<PartnerTab>("properties");
  const [nestedPropertyView, setNestedPropertyView] = useState(false);
  const inbox = usePartnerInboxSummary(profile.user_id);
  const current = useMemo(() => TABS.find((item) => item.key === tab)!, [tab]);
  return (
    <>
      <Toaster position="top-center" richColors />
      <WorkspaceFrameV2
        label="WEHOUSE · PROPERTY PARTNER"
        title={current.label}
        description={current.description}
        items={TABS.map((item) => ({ id: item.key, label: item.label, badge: item.key === "communication" ? inbox.totalUnread || undefined : undefined }))}
        active={tab}
        setActive={(id) => setTab(id as PartnerTab)}
        onAccount={() => onNavigate("profile")}
        onLogout={onLogout}
        compact={tab === "communication"}
        immersive={tab === "properties" && nestedPropertyView}
      >
        {tab === "properties" && <PropertiesWorkspace profile={profile} onNestedChange={setNestedPropertyView} />}{" "}
        {tab === "communication" && (
          <CommunicationInbox profile={profile} onNavigate={onNavigate} chatUnread={inbox.chatUnread} activityUnread={inbox.activityUnread} />
        )}{" "}
        {tab === "finance" && <FinanceTab profile={profile} />}
      </WorkspaceFrameV2>
    </>
  );
}
function PropertiesWorkspace({ profile, onNestedChange }: { profile: Profile; onNestedChange?: (nested: boolean) => void }) {
  const [filter, setFilter] = useState<SubmissionFilter>("all");
  const [viewingDetail, setViewingDetail] = useState(false);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    onNestedChange?.(viewingDetail || creating);
    return () => onNestedChange?.(false);
  }, [creating, onNestedChange, viewingDetail]);
  const filters: Array<{
    value: SubmissionFilter;
    label: string;
    description: string;
  }> = [
    {
      value: "all",
      label: "All submissions",
      description: "Every submitted property",
    },
    {
      value: "submitted",
      label: "In progress",
      description: "Currently moving through review",
    },
    { value: "public", label: "Live", description: "Published properties" },
    {
      value: "rejected",
      label: "Changes requested",
      description: "Properties needing correction",
    },
  ];
  return (
    <div className="space-y-5">
      {!viewingDetail && !creating && (
        <div className="flex items-center justify-between gap-3 border-b border-white/[.06] pb-3">
          <div>
            <h2 className="text-sm font-semibold">Your properties</h2>
            <p className="mt-1 text-[9px] text-[#686B7D]">
              The selection filters one property workspace; lifecycle states
              stay on each property.
            </p>
          </div>
          <WeHouseSelect
            value={filter}
            options={filters}
            onChange={setFilter}
            eyebrow="Properties"
            title="Choose what to show"
            ariaLabel="Filter property submissions"
          />
        </div>
      )}
      {filter === "public" ? (
        <PropertiesTab profile={profile} onDetailChange={setViewingDetail} />
      ) : (
        <PartnerSubmittedRequests
          profile={profile}
          filter={filter}
          onDetailChange={setViewingDetail}
          onCreationChange={setCreating}
        />
      )}
    </div>
  );
}
// Compatibility export retained for bookmarked legacy Partner requests.
export function RequestsTab({ profile }: { profile: Profile }) {
  const [requests, setRequests] = useState<any[]>([]),
    [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("inspection_requests")
      .select(
        "id,request_code,property_address,property_type,property_state,property_city,expected_rent,status,created_at,scheduled_date,completed_at,notes,rejection_reason,submission_batch_id,submission_batch_position",
      )
      .eq("owner_id", profile.user_id)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message || "Unable to load property requests");
      setRequests([]);
    } else setRequests(data || []);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, [profile.user_id]);
  function contact(request: any) {
    window.dispatchEvent(
      new CustomEvent("openSupportChat", {
        detail: {
          category: "property_inspection",
          subject: `Property inspection ${request.request_code || ""}`.trim(),
          contextType: "property_inspection",
          contextId: request.id,
          contextSnapshot: {
            request_code: request.request_code,
            property_address: request.property_address,
            property_type: request.property_type,
            city: request.property_city,
            state: request.property_state,
            status: request.status,
          },
        },
      }),
    );
  }
  const batchCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of requests)
      if (r.submission_batch_id)
        map.set(
          r.submission_batch_id,
          (map.get(r.submission_batch_id) || 0) + 1,
        );
    return map;
  }, [requests]);
  return (
    <div className="space-y-6">
      <PropertyInspectionRequestPanel profile={profile} />
      <section>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Your submitted properties</h2>
            <p className="mt-1 text-[10px] text-[#66687B]">
              Every property keeps its own progress, even when you submit
              several together.
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="w-fit rounded-lg border border-white/[.07] px-3 py-2 text-[9px] text-[#888A9B]"
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <Loading />
        ) : requests.length === 0 ? (
          <Empty
            title="No properties submitted yet"
            text="Use Add properties above to send one property or a batch."
          />
        ) : (
          <div className="space-y-3">
            {requests.map((request) => (
              <section
                key={request.id}
                className="rounded-2xl border border-white/[.06] bg-[#111119] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words text-xs font-semibold">
                        {request.property_address ||
                          request.property_type ||
                          "Property"}
                      </p>
                      {request.submission_batch_id &&
                        Number(
                          batchCounts.get(request.submission_batch_id) || 0,
                        ) > 1 && (
                          <span className="rounded-full bg-violet-500/10 px-2 py-1 text-[8px] font-semibold text-violet-300">
                            Batch · {request.submission_batch_position}/
                            {batchCounts.get(request.submission_batch_id)}
                          </span>
                        )}
                    </div>
                    <p className="mt-1 break-words text-[10px] text-[#66687B]">
                      {[request.property_city, request.property_state]
                        .filter(Boolean)
                        .join(", ")}{" "}
                      {request.request_code ? `· ${request.request_code}` : ""}
                    </p>
                  </div>
                  <Status value={request.status || "pending"} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <Info
                    label="Type"
                    value={request.property_type || "Not specified"}
                  />
                  <Info
                    label="Expected rent"
                    value={
                      request.expected_rent
                        ? money(Number(request.expected_rent))
                        : "—"
                    }
                  />
                  <Info
                    label="Sent"
                    value={
                      request.created_at
                        ? new Date(request.created_at).toLocaleDateString()
                        : "—"
                    }
                  />
                  <Info
                    label="Visit"
                    value={
                      request.scheduled_date
                        ? new Date(request.scheduled_date).toLocaleDateString()
                        : request.completed_at
                          ? new Date(request.completed_at).toLocaleDateString()
                          : "Not scheduled"
                    }
                  />
                </div>
                {(request.notes || request.rejection_reason) && (
                  <div className="mt-3 rounded-xl border border-white/[.05] bg-white/[.02] p-3">
                    <p className="text-[9px] uppercase tracking-wide text-[#66687B]">
                      Latest update
                    </p>
                    <p className="mt-1 text-[10px] leading-relaxed text-[#A4A5B2]">
                      {request.rejection_reason || request.notes}
                    </p>
                  </div>
                )}
                <button
                  onClick={() => contact(request)}
                  className="mt-3 rounded-xl border border-violet-500/15 bg-violet-500/[.06] px-3 py-2 text-[10px] font-semibold text-violet-300"
                >
                  Message WeHouse
                </button>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
function PropertiesTab({
  profile,
  onDetailChange,
}: {
  profile: Profile;
  onDetailChange?: (open: boolean) => void;
}) {
  const [assets, setAssets] = useState<any[]>([]),
    [selected, setSelected] = useState<any | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    (async () => {
      const [propertyResult, hotelResult] = await Promise.all([
        supabase
          .from("listings")
          .select("*")
          .or(`owner_id.eq.${profile.user_id},partner_id.eq.${profile.user_id}`)
          .eq("status", "available")
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        supabase
          .from("hotels")
          .select("*")
          .eq("owner_id", profile.user_id)
          .eq("status", "active")
          .order("created_at", { ascending: false }),
      ]);
      if (!active) return;
      if (propertyResult.error || hotelResult.error)
        toast.error("Unable to load all of your properties and hotels");
      setAssets(
        [
          ...(propertyResult.data || []).map((row) => ({
            ...row,
            _assetKind: "property",
          })),
          ...(hotelResult.data || []).map((row) => ({
            ...row,
            _assetKind: "hotel",
            id: `hotel:${row.hotel_id}`,
            title: row.name,
          })),
        ].sort(
          (a, b) =>
            new Date(b.created_at || 0).getTime() -
            new Date(a.created_at || 0).getTime(),
        ),
      );
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [profile.user_id]);
  useEffect(() => {
    onDetailChange?.(Boolean(selected));
    return () => onDetailChange?.(false);
  }, [selected, onDetailChange]);
  if (selected?._assetKind === "hotel")
    return (
      <PartnerHotelOperations
        hotel={selected}
        accessRole="owner"
        profile={profile}
        onBack={() => setSelected(null)}
      />
    );
  if (selected)
    return (
      <PropertyDetails property={selected} onBack={() => setSelected(null)} />
    );
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">
            Published properties and hotels
          </h2>
          <p className="mt-1 text-[10px] text-[#66687B]">
            Open an asset to manage it at the depth it needs.
          </p>
        </div>
        <span className="rounded-full bg-white/[.04] px-3 py-1 text-[10px] text-[#888A9B]">
          {assets.length}
        </span>
      </div>
      {loading ? (
        <Loading />
      ) : assets.length === 0 ? (
        <Empty
          title="Nothing published yet"
          text="A property appears here after it is ready and published by WeHouse."
        />
      ) : (
        <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
          {assets.map((property) => (
            <button
              key={property.id}
              onClick={() => setSelected(property)}
              className="flex w-full items-center gap-3 py-4 text-left transition hover:bg-white/[.02]"
            >
              <div className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-[#171722]">
                {property.images?.[0] ? (
                  <img
                    src={property.images[0]}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-[#46485A]">
                    No image
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {property.title || "Property"}
                    </p>
                    <p className="mt-1 truncate text-[10px] text-[#66687B]">
                      {[property.city, property.state]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  </div>
                  <Status value={"live"} />
                </div>
                <p className="mt-2 text-xs font-bold">
                  {property._assetKind === "hotel"
                    ? "Hotel operation"
                    : money(Number(property.price || 0))}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
function PropertyDetails({
  property,
  onBack,
}: {
  property: any;
  onBack: () => void;
}) {
  function contact() {
    window.dispatchEvent(
      new CustomEvent("openSupportChat", {
        detail: {
          category: "property_inspection",
          subject: `Listing help: ${property.title || "Property"}`,
          contextType: "property_listing",
          contextId: String(property.id),
          contextSnapshot: {
            property_name: property.title,
            address: property.address,
            city: property.city,
            state: property.state,
            status: property.status,
          },
        },
      }),
    );
  }
  return (
    <div className="space-y-5">
      <button
        onClick={onBack}
        className="text-xs text-[#888A9B] hover:text-white"
      >
        ← Back to properties
      </button>
      <section className="overflow-hidden rounded-3xl border border-white/[.06] bg-[#111119]">
        {property.images?.length || property.videos?.length ? (
          <PropertyMediaCarousel
            images={property.images}
            videos={property.videos || []}
            title={property.title || "Property"}
          />
        ) : null}
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="break-words text-xl font-bold">
                {property.title || "Property"}
              </h2>
              <p className="mt-1 break-words text-xs text-[#747689]">
                {[property.address, property.city, property.state]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            </div>
            <Status
              value={
                property.availability_status || property.status || "pending"
              }
            />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Info label="Group" value={property.property_type || "Apartment"} />
            <Info label="Type" value={property.sub_type || "Not specified"} />
            <Info label="Bedrooms" value={property.bedrooms ?? "—"} />
            <Info label="Bathrooms" value={property.bathrooms ?? "—"} />
          </div>
          <button
            onClick={contact}
            className="mt-4 rounded-xl border border-violet-500/15 bg-violet-500/[.06] px-4 py-3 text-xs font-semibold text-violet-300"
          >
            Message WeHouse
          </button>
        </div>
      </section>
    </div>
  );
}
function FinanceTab({ profile }: { profile: Profile }) {
  const key = `wh_finance_amounts_visible_${profile.user_id}`;
  const [showAmounts, setShowAmounts] = useState(() => {
    try {
      return localStorage.getItem(key) !== "false";
    } catch {
      return true;
    }
  });
  function toggleAmounts() {
    setShowAmounts((current) => {
      const next = !current;
      try {
        localStorage.setItem(key, String(next));
      } catch {}
      return next;
    });
  }
  return (
    <div className="space-y-5">
      <PropertyPartnerFinancePanel
        profile={profile}
        showAmounts={showAmounts}
        onToggleAmounts={toggleAmounts}
      />
      <PayoutAccountManager profile={profile} />
      <section className="border-t border-white/[.07] pt-5">
        <div className="mb-4">
          <h2 className="text-sm font-bold">Property earnings</h2>
          <p className="mt-1 text-[9px] text-[#66687B]">
            Every property-income release in the same Finance workspace.
          </p>
        </div>
        <EarningsTab
          profile={profile}
          showAmounts={showAmounts}
        />
      </section>
    </div>
  );
}
function EarningsTab({
  profile,
  showAmounts,
}: {
  profile: Profile;
  showAmounts: boolean;
}) {
  const [rows, setRows] = useState<EarningRelease[]>([]),
    [loading, setLoading] = useState(true),
    [filter, setFilter] = useState<"all" | EarningRelease["status"]>("all");
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("property_partner_earning_releases")
        .select("id,earning_type,status,net_amount,release_event,created_at")
        .eq("partner_id", profile.user_id)
        .order("created_at", { ascending: false });
      if (!active) return;
      if (error) toast.error("Unable to load earnings");
      setRows((data || []) as EarningRelease[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [profile.user_id]);
  const shown = filter === "all" ? rows : rows.filter((row) => row.status === filter);
  return (
    <div className="space-y-4">
      <p className="border-b border-white/[.06] pb-3 text-[10px] leading-5 text-[#76827F]">This is the itemised record behind the single Finance balance above—not another wallet.</p>
      <section>
        <div className="mb-3 flex gap-2 overflow-x-auto scrollbar-hide">
          {(["all", "available", "pending", "held", "reversed"] as const).map(
            (value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`shrink-0 rounded-xl px-3 py-2 text-[9px] font-semibold capitalize ${filter === value ? "bg-violet-500 text-white" : "border border-white/[.06] bg-[#111119] text-[#777A8B]"}`}
              >
                {value}
              </button>
            ),
          )}
        </div>
        {loading ? (
          <Loading />
        ) : shown.length === 0 ? (
          <Empty
            title={
              rows.length
                ? "No earnings in this group"
                : "No property earnings yet"
            }
            text={
              rows.length
                ? "Choose another earning status."
                : "Eligible property income will appear here when it is recorded."
            }
          />
        ) : (
          <div className="space-y-2">
            {shown.map((row) => (
              <article
                key={row.id}
                className="rounded-2xl border border-white/[.06] bg-[#111119] p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="break-words text-xs font-semibold">
                      {friendly(row.earning_type)}
                    </p>
                    <p className="mt-1 text-[9px] text-[#626477]">
                      {new Date(row.created_at).toLocaleDateString()}{" "}
                      {row.release_event
                        ? `· ${friendly(row.release_event)}`
                        : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold">
                      {showAmounts ? money(row.net_amount) : "••••"}
                    </p>
                    <div className="mt-1">
                      <Status value={row.status} />
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/[.06] bg-[#111119] p-4">
      <p className="text-[9px] uppercase tracking-wide text-[#616375]">
        {label}
      </p>
      <p className="mt-1 break-words text-xs font-medium capitalize text-[#D3D4DC]">
        {value}
      </p>
    </div>
  );
}
function Status({ value }: { value: string }) {
  const normalized = value.toLowerCase(),
    style =
      normalized === "available" ||
      normalized === "approved" ||
      normalized === "completed"
        ? "bg-emerald-500/10 text-emerald-300"
        : normalized === "rejected" || normalized === "reversed"
          ? "bg-red-500/10 text-red-300"
          : normalized === "held"
            ? "bg-orange-500/10 text-orange-300"
            : "bg-amber-500/10 text-amber-300";
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-1 text-[8px] font-semibold capitalize ${style}`}
    >
      {friendly(value)}
    </span>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[.08] bg-white/[.015] px-5 py-12 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#626477]">
        {text}
      </p>
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
function friendly(value: any) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
