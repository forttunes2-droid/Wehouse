import { useEffect, useMemo, useState } from "react";
import {
  getMyBookingConversations,
  BOOKING_STATUS_LABELS,
} from "@/lib/supabase/worker-bookings";
import BookingNegotiationChat from "@/components/BookingNegotiationChat";
import WeHouseSelect from "@/components/WeHouseSelect";
import { canonicalStatusOptions } from "@/lib/status";
import type { Profile } from "@/types";
import { Toaster, toast } from "sonner";

export type BookingStage = string;
type Props = { profile: Profile; onBack: () => void; embedded?: boolean; stage?:BookingStage; showFilters?:boolean };
const ATTENTION = new Set([
  "waiting_payment",
  "completed_pending_approval",
  "disputed",
]);

export default function MyBookings({ profile, onBack, embedded = false, stage, showFilters = true }: Props) {
  const [rows, setRows] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [active, setActive] = useState<{
      conversationId: string;
      bookingId: string;
    } | null>(null),
    [statusFilter, setStatusFilter] = useState<BookingStage>("all"),
    [search, setSearch] = useState("");
  async function load() {
    setLoading(true);
    const { conversations, error } = await getMyBookingConversations(
      profile.user_id,
    );
    if (error) toast.error(error.message || "Unable to load Worker bookings");
    setRows(conversations || []);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, [profile.user_id]);
  const view=stage||statusFilter;
  const statusOptions=useMemo(()=>canonicalStatusOptions(rows.map(row=>row.booking_status)),[rows]);
  useEffect(()=>{if(!stage&&!statusOptions.some(option=>option.value===statusFilter))setStatusFilter('all')},[stage,statusFilter,statusOptions]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((row) => {
        const matchesView = view === "all" || row.booking_status === view;
        if (!matchesView) return false;
        if (!q) return true;
        return [
          row.service_type,
          row.booking_code,
          row.other_person_name,
          row.booking_status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .sort(
        (a, b) =>
          new Date(b.updated_at || 0).getTime() -
          new Date(a.updated_at || 0).getTime(),
      );
  }, [rows, view, search]);
  if (active)
    return (
      <BookingNegotiationChat
        conversationId={active.conversationId}
        bookingId={active.bookingId}
        profile={profile}
        isWorker={false}
        onClose={() => {
          setActive(null);
          void load();
        }}
      />
    );
  return (
    <div className={embedded ? "text-white" : "fixed inset-0 z-[100020] min-h-[100dvh] overflow-y-auto bg-[#090A0F] pb-8 text-white"}>
      {!embedded && <Toaster position="top-center" richColors />}
      {!embedded && <header className="sticky top-0 z-40 border-b border-white/[.06] bg-[#090A0F]/95 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button
            onClick={onBack}
            aria-label="Back"
            className="grid h-11 w-11 place-items-center rounded-xl border border-white/[.08] bg-white/[.03] text-xl text-[#A8ADBA]"
          >
            ←
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-bold">Service bookings</h1>
            <p className="mt-0.5 text-[10px] text-[#626879]">
              Track each home-service request, payment and completion status.
            </p>
          </div>
        </div>
      </header>}
      <main className={embedded ? "space-y-4" : "mx-auto max-w-3xl space-y-4 px-4 py-4"}>
        {showFilters && <div className="flex items-center justify-between gap-3 border-y border-white/[.07] py-3"><span className="text-[9px] font-semibold uppercase tracking-wide text-[#686F80]">Status filter</span><WeHouseSelect value={view} options={statusOptions} onChange={setStatusFilter} eyebrow="Booking status" title="Filter by booking status" ariaLabel="Filter service bookings by status" className="max-w-[13rem] rounded-full"/></div>}
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#5E6575]">
            ⌕
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Worker, service or booking code"
            className="h-11 w-full rounded-2xl border border-white/[.07] bg-[#12161E] pl-9 pr-3 text-xs outline-none focus:border-violet-500/35"
          />
        </div>
        {loading ? (
          <Loading />
        ) : shown.length === 0 ? (
          <Empty hasAny={rows.length > 0} onBack={onBack} />
        ) : (
          <div className="space-y-2.5">
            {shown.map((row) => (
              <BookingCard
                key={row.booking_id || row.conversation_id}
                row={row}
                onOpen={() =>
                  setActive({
                    conversationId: row.conversation_id,
                    bookingId: row.booking_id,
                  })
                }
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function BookingCard({ row, onOpen }: { row: any; onOpen: () => void }) {
  const status = BOOKING_STATUS_LABELS[row.booking_status],
    amount = Number(row.negotiated_amount || 0),
    attention = ATTENTION.has(row.booking_status);
  return (
    <button
      onClick={onOpen}
      className={`w-full rounded-2xl border bg-[#10131B] p-4 text-left transition hover:border-violet-500/25 ${attention ? "border-amber-500/15" : "border-white/[.06]"}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">
              {row.service_type || "Service booking"}
            </p>
            {Number(row.unread_count || 0) > 0 && (
              <span className="rounded-full bg-violet-500 px-2 py-0.5 text-[8px] font-bold">
                {row.unread_count} new
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-[10px] text-[#666D7E]">
            #{row.booking_code} · {row.other_person_name || "Worker"}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-semibold ${status?.color || "bg-white/[.05] text-[#A1A6B5]"}`}
        >
          {status?.label ||
            String(row.booking_status || "recorded").replace(/_/g, " ")}
        </span>
      </div>
      {row.last_message && (
        <p className="mt-3 truncate text-[10px] text-[#858A9B]">
          {row.last_message}
        </p>
      )}
      <div className="mt-3 flex items-end justify-between gap-3 border-t border-white/[.05] pt-3">
        <div>
          {amount > 0 && (
            <p className="text-xs font-semibold text-emerald-300">
              ₦{amount.toLocaleString("en-NG")}
            </p>
          )}
          <p className="mt-1 text-[9px] text-[#555C6D]">
            {nextHint(row.booking_status)}
          </p>
        </div>
        <p className="text-[9px] font-semibold text-violet-300">Open →</p>
      </div>
    </button>
  );
}
function nextHint(status: string) {
  const hints: Record<string, string> = {
    booking_requested: "Waiting for the Worker to respond",
    negotiating: "Discussing the work, date and price",
    waiting_payment: "Your payment is required to confirm this job",
    confirmed: "Paid · waiting for the Worker to start",
    in_progress: "Job is in progress",
    completed_pending_approval: "Review the completed work",
    approved_released: "Completed",
    disputed: "WeHouse review in progress",
    cancelled: "Cancelled",
    refunded: "Refunded",
  };
  return hints[status] || "Open for details";
}
function Loading() {
  return (
    <div className="grid min-h-56 place-items-center">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
    </div>
  );
}
function Empty({ hasAny, onBack }: { hasAny: boolean; onBack: () => void }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/[.08] px-5 py-14 text-center">
      <p className="text-sm font-semibold">
        {hasAny ? "Nothing in this view" : "No Worker bookings yet"}
      </p>
      <p className="mt-2 text-[10px] text-[#666C7D]">
        {hasAny
          ? "Choose another filter or search term."
          : "When you request a verified Worker, the job will appear here."}
      </p>
      {!hasAny && (
        <button
          onClick={onBack}
          className="mt-4 rounded-xl bg-violet-500 px-4 py-2.5 text-[10px] font-semibold"
        >
          Find workers
        </button>
      )}
    </div>
  );
}
