import { useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import { supabase } from "@/lib/supabase";
import PropertyPartnerFinancePanel from "@/components/PropertyPartnerFinancePanel";
import PayoutAccountManager from "@/components/PayoutAccountManager";
import CommunicationInbox from "@/components/CommunicationInbox";
import PartnerSubmittedRequests, {
  type PartnerAssetKind,
  type SubmissionFilter,
} from "@/components/PartnerSubmittedRequests";
import PartnerHotelOperations from "@/components/PartnerHotelOperations";
import WorkspaceFrameV2 from "@/components/WorkspaceFrameV2";
import PropertyMediaCarousel from "@/components/PropertyMediaCarousel";
import { ListingMediaImage } from "@/components/ListingCandidateMedia";
import type { Profile } from "@/types";
import { usePartnerInboxSummary } from "@/hooks/usePartnerInboxSummary";
import WeHouseSelect from "@/components/WeHouseSelect";

type PartnerTab = "properties" | "finance" | "communication";
type Props = {
  profile: Profile;
  onLogout: () => void;
  onNavigate: (page: string, id?: string) => void;
  onGoToChat?: (convId?: string) => void;
};
const money = (value: number) =>
  `₦${Number(value || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
export default function PropertyOwnerDashboard({
  profile,
  onLogout,
  onNavigate,
}: Props) {
  const [tab, setTab] = useState<PartnerTab>("properties");
  const [propertyTargetId, setPropertyTargetId] = useState<
    string | undefined
  >();
  const [nestedPropertyView, setNestedPropertyView] = useState(false);
  const inbox = usePartnerInboxSummary(profile.user_id);
  const current = useMemo(() => TABS.find((item) => item.key === tab)!, [tab]);
  function openActivityDestination(page: string, id?: string) {
    const route = page.toLowerCase().replace(/-/g, "_");
    if (/propert|listing|inspection|hotel_detail/.test(route)) {
      setPropertyTargetId(id);
      setTab("properties");
      return;
    }
    if (/finance|earning|payment|wallet/.test(route)) {
      setTab("finance");
      return;
    }
    onNavigate(page, id);
  }
  return (
    <>
      <Toaster position="top-center" richColors />
      <WorkspaceFrameV2
        label="WEHOUSE · PROPERTY PARTNER"
        title={current.label}
        items={TABS.map((item) => ({
          id: item.key,
          label: item.label,
          badge:
            item.key === "communication"
              ? inbox.totalUnread || undefined
              : undefined,
        }))}
        active={tab}
        setActive={(id) => setTab(id as PartnerTab)}
        onAccount={() => onNavigate("profile")}
        onLogout={onLogout}
        compact={tab === "communication"}
        immersive={tab === "properties" && nestedPropertyView}
      >
        {tab === "properties" && (
          <PropertiesWorkspace
            profile={profile}
            initialRecordId={propertyTargetId}
            onNestedChange={setNestedPropertyView}
          />
        )}{" "}
        {tab === "communication" && (
          <CommunicationInbox
            profile={profile}
            onNavigate={openActivityDestination}
            chatUnread={inbox.chatUnread}
            activityUnread={inbox.activityUnread}
          />
        )}{" "}
        {tab === "finance" && <FinanceTab profile={profile} />}
      </WorkspaceFrameV2>
    </>
  );
}
function PropertiesWorkspace({
  profile,
  initialRecordId,
  onNestedChange,
}: {
  profile: Profile;
  initialRecordId?: string;
  onNestedChange?: (nested: boolean) => void;
}) {
  const [filter, setFilter] = useState<SubmissionFilter>("all");
  const [assetKind, setAssetKind] = useState<PartnerAssetKind>("apartment");
  const [viewingDetail, setViewingDetail] = useState(false);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    onNestedChange?.(viewingDetail || creating);
    return () => onNestedChange?.(false);
  }, [creating, onNestedChange, viewingDetail]);
  const filters: Array<{ value: SubmissionFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "submitted", label: "In progress" },
    { value: "public", label: "Live" },
    { value: "rejected", label: "Needs changes" },
  ];
  return (
    <div className="space-y-5">
      {!viewingDetail && !creating && (
        <div className="space-y-4 border-b border-white/[.06] pb-4">
          <div
            className="grid grid-cols-2 rounded-2xl border border-white/[.07] bg-[#0E1118] p-1"
            role="group"
            aria-label="Property type"
          >
            {(["apartment", "hotel"] as PartnerAssetKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={assetKind === kind}
                onClick={() => setAssetKind(kind)}
                className={`h-11 rounded-xl text-xs font-semibold transition ${assetKind === kind ? "bg-violet-500 text-white shadow-lg shadow-violet-500/10" : "text-[#7C8292]"}`}
              >
                {kind === "apartment" ? "Apartments" : "Hotels"}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[.15em] text-[#666C7C]">
                Filter
              </p>
              <p className="mt-1 text-xs text-[#AEB3C1]">Property status</p>
            </div>
            <WeHouseSelect
              value={filter}
              options={filters}
              onChange={setFilter}
              eyebrow="Properties"
              title="Filter by status"
              ariaLabel="Filter properties by status"
            />
          </div>
        </div>
      )}
      {filter === "public" ? (
        <PropertiesTab
          profile={profile}
          assetKind={assetKind}
          onDetailChange={setViewingDetail}
        />
      ) : (
        <PartnerSubmittedRequests
          profile={profile}
          filter={filter}
          initialRecordId={initialRecordId}
          onDetailChange={setViewingDetail}
          onCreationChange={setCreating}
          assetKind={assetKind}
        />
      )}
    </div>
  );
}
function PropertiesTab({
  profile,
  assetKind,
  onDetailChange,
}: {
  profile: Profile;
  assetKind: PartnerAssetKind;
  onDetailChange?: (open: boolean) => void;
}) {
  const [assets, setAssets] = useState<any[]>([]),
    [selected, setSelected] = useState<any | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    (async () => {
      const result =
        assetKind === "apartment"
          ? await supabase
              .from("listings")
              .select("*")
              .or(
                `owner_id.eq.${profile.user_id},partner_id.eq.${profile.user_id}`,
              )
              .in("status", ["available", "reserved", "occupied", "maintenance", "closed"])
              .not("approved_at", "is", null)
              .is("deleted_at", null)
              .order("created_at", { ascending: false })
          : await supabase
              .from("hotels")
              .select("*,hotel_rooms(room_id,total_rooms,price_per_night,images)")
              .eq("owner_id", profile.user_id)
              .eq("status", "active")
              .order("created_at", { ascending: false });
      if (!active) return;
      if (result.error)
        toast.error(
          `Unable to load your ${assetKind === "hotel" ? "hotels" : "apartments"}`,
        );
      setAssets(
        (result.data || []).map((row) =>
          assetKind === "apartment"
            ? {
                ...row,
                _assetKind: "property",
              }
            : {
                ...row,
                _assetKind: "hotel",
                id: `hotel:${row.hotel_id}`,
                title: row.name,
              },
        ),
      );
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [assetKind, profile.user_id]);
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
      <PropertyDetails
        property={selected}
        profile={profile}
        onBack={() => setSelected(null)}
      />
    );
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">
            Live {assetKind === "hotel" ? "hotels" : "apartments"}
          </h2>
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
                  <ListingMediaImage
                    reference={property.images[0]}
                    alt={property.title || "Property"}
                    loading="lazy"
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
                  <Status value={property.availability_status || property.status || "available"} />
                </div>
                <p className="mt-2 text-xs font-bold">
                  {property._assetKind === "hotel"
                    ? hotelInventorySummary(property)
                    : money(Number(property.price || 0))}
                </p>
                {property._assetKind === "hotel" ? (
                  <p className="mt-1 text-[9px] text-violet-300">
                    Open rooms, packages, calendar and stays
                  </p>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
function hotelInventorySummary(property: any) {
  const rooms = Array.isArray(property.hotel_rooms) ? property.hotel_rooms : [];
  const units = rooms.reduce(
    (sum: number, room: { total_rooms?: number | null }) =>
      sum + Number(room.total_rooms || 0),
    0,
  );
  const startingRate = rooms.reduce(
    (lowest: number, room: { price_per_night?: number | null }) => {
      const rate = Number(room.price_per_night || 0);
      return rate > 0 && (!lowest || rate < lowest) ? rate : lowest;
    },
    0,
  );
  const roomLabel = `${rooms.length} room ${rooms.length === 1 ? "type" : "types"} · ${units} ${units === 1 ? "room" : "rooms"}`;
  return startingRate ? `${roomLabel} · from ${money(startingRate)}` : roomLabel;
}
function PropertyDetails({
  property,
  profile,
  onBack,
}: {
  property: any;
  profile: Profile;
  onBack: () => void;
}) {
  const [stays, setStays] = useState<any[]>([]);
  const [loadingStays, setLoadingStays] = useState(true);
  useEffect(() => {
    let active = true;
    void supabase
      .rpc("get_my_property_partner_stays", {
        p_listing_id: String(property.id),
      })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) toast.error("Booking activity could not be loaded");
        setStays(Array.isArray(data) ? data : []);
        setLoadingStays(false);
      });
    return () => {
      active = false;
    };
  }, [profile.user_id, property.id]);
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
          <div className="mt-4 border-y border-white/[.06] py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#696F80]">Published home status</p>
                <p className="mt-1 text-[10px] leading-5 text-[#898F9F]">{partnerPropertyStateMessage(property)}</p>
              </div>
              <Status value={property.availability_status || property.status || "available"} />
            </div>
          </div>
          <button
            onClick={contact}
            className="mt-4 rounded-xl border border-violet-500/15 bg-violet-500/[.06] px-4 py-3 text-xs font-semibold text-violet-300"
          >
            Message WeHouse
          </button>
        </div>
      </section>
      <section className="border-t border-white/[.07] pt-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold">
              {property.sub_type === "short_let"
                ? "Short Let stays"
                : "Rent and tenancy"}
            </h2>
            <p className="mt-1 text-[9px] text-[#707687]">
              {property.sub_type === "short_let"
                ? "Plain updates when a stay is booked, the guest enters and the guest leaves."
                : "WeHouse shows when rent is secured, when the customer chooses a move-in time, and when verified handover starts the tenancy."}
            </p>
          </div>
          <span className="text-[9px] text-[#696F7F]">{stays.length}</span>
        </div>
        {loadingStays ? (
          <Loading />
        ) : stays.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-white/[.08] px-5 py-8 text-center">
            <p className="text-xs font-semibold">
              {(property.availability_status || property.status) === "reserved"
                ? "Reserved through WeHouse"
                : "No active booking yet"}
            </p>
            <p className="mt-2 text-[9px] text-[#666C7C]">
              {(property.availability_status || property.status) === "reserved"
                ? "A customer has completed the reservation fee and the home is held. They are choosing inspection or rent; you do not need to act yet. Customer details remain with Property Operations."
                : property.sub_type === "short_let"
                ? "A stay appears after the guest completes payment."
                : "WeHouse will update this page after a tenant is found and the rent is confirmed."}
            </p>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-white/[.06] border-y border-white/[.06]">
            {stays.map((stay) => (
              <article key={stay.reservation_id} className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold">
                        {partnerStayStage(stay)}
                      </p>
                    </div>
                    {stay.stay_type === "short_let" ? (
                      <p className="mt-1 text-[9px] text-[#696F80]">
                        Stay {stay.booking_code || "confirmed"}
                      </p>
                    ) : null}
                  </div>
                  <span className="rounded-full bg-emerald-500/[.08] px-2 py-1 text-[8px] font-semibold text-emerald-300">
                    {partnerPaymentLabel(stay)}
                  </span>
                </div>
                {stay.stay_type === "short_let" ? (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Info label="Check-in" value={partnerDate(stay.check_in)} />
                    <Info
                      label="Checkout"
                      value={partnerDate(stay.check_out)}
                    />
                    <Info
                      label="Guests"
                      value={String(stay.guest_count || 1)}
                    />
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Info
                      label={stay.tenancy_start_date ? "Move-in" : "Requested arrival"}
                      value={
                        stay.tenancy_start_date
                          ? partnerDate(stay.tenancy_start_date)
                          : partnerDateTime(stay.requested_move_in_at)
                      }
                    />
                    <Info
                      label="Tenancy ends"
                      value={
                        stay.tenancy_end_date
                          ? partnerDate(stay.tenancy_end_date)
                          : "Starts after handover"
                      }
                    />
                  </div>
                )}
                <p className="mt-3 text-[9px] leading-5 text-[#888E9D]">
                  {partnerStayMessage(stay)}
                </p>
              </article>
            ))}
          </div>
        )}
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
      normalized === "live" ||
      normalized === "completed"
        ? "bg-emerald-500/10 text-emerald-300"
        : normalized === "occupied"
          ? "bg-violet-500/10 text-violet-300"
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
function partnerDate(value?: string | null) {
  return value
    ? new Date(`${value}T00:00:00`).toLocaleDateString()
    : "Not started";
}
function partnerDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "Not chosen";
}
function partnerPropertyStateMessage(property: any) {
  const state = String(property.availability_status || property.status || "available");
  if (state === "reserved")
    return "A reservation fee is confirmed and WeHouse is holding this home while the customer chooses inspection or rent.";
  if (state === "occupied")
    return "WeHouse completed the verified handover and the home is currently occupied.";
  if (state === "maintenance")
    return "The published home is temporarily unavailable while operational checks or maintenance are completed.";
  if (state === "closed")
    return "This published home is closed and is not available in discovery.";
  return "This property is published and currently available for a new reservation.";
}
function partnerStayMessage(stay: any) {
  if (stay.stay_type === "short_let") {
    if (stay.status === "occupied")
      return `The guest entered on ${partnerDate(stay.check_in)}. WeHouse will record when the guest leaves.`;
    if (stay.status === "completed")
      return `The guest left on ${partnerDate(stay.check_out)}. WeHouse is handling the final stay and deposit checks.`;
    if (stay.status === "ready_for_move_in")
      return `Payment is confirmed. The guest is expected on ${partnerDate(stay.check_in)} and can only enter during the booked stay.`;
    return `This home is booked from ${partnerDate(stay.check_in)} to ${partnerDate(stay.check_out)}. WeHouse is handling the guest’s arrival.`;
  }
  if (stay.status === "occupied")
    return "WeHouse found a tenant, confirmed the rent and completed the move-in.";
  if (stay.status === "completed")
    return "The tenancy has ended. The rent history remains available in Finance.";
  if (stay.status === "ready_for_move_in")
    return stay.requested_move_in_at
      ? `The customer selected ${partnerDateTime(stay.requested_move_in_at)}. WeHouse will verify their code and hand over access at arrival.`
      : "Year 1 rent is confirmed. WeHouse is waiting for the customer to choose a move-in time; the tenancy has not started.";
  return "WeHouse found a tenant and confirmed the rent. WeHouse is preparing the home for move-in.";
}
function partnerStayStage(stay: any) {
  if (stay.stay_type === "short_let") {
    if (stay.status === "occupied") return "Guest checked in";
    if (stay.status === "completed") return "Guest checked out";
    if (stay.status === "ready_for_move_in") return "Guest expected";
    return "Short Let booked";
  }
  if (stay.status === "occupied") return "Tenant moved in";
  if (stay.status === "completed") return "Tenancy ended";
  if (stay.status === "ready_for_move_in")
    return stay.requested_move_in_at
      ? "Move-in scheduled"
      : "Waiting for move-in time";
  return "Tenant found";
}
function partnerPaymentLabel(stay: any) {
  const paid = ["paid", "upfront_paid", "completed"].includes(
    String(stay.payment_status || stay.manual_payment_status || ""),
  );
  if (stay.stay_type === "short_let")
    return paid ? "Stay paid" : "Payment pending";
  return paid ? "Rent confirmed" : "Rent processing";
}
function friendly(value: any) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
