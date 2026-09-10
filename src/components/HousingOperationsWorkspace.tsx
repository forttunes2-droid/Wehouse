import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  completeApartmentTenancy,
  completeShortStay,
  confirmApartmentHandover,
  confirmShortStayCheckIn,
} from "@/lib/supabase/reservations";
import WeHouseSelect from "@/components/WeHouseSelect";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useConfirm } from "@/hooks/useConfirm";
import PropertyBookingJourney from "@/components/PropertyBookingJourney";
import { propertyBookingStatusLabel } from "@/lib/propertyBookingLifecycle";

type Filter =
  "reserved" | "occupied" | "available" | "maintenance" | "closed" | "all";
const STATUS: Record<string, { label: string; cls: string }> = {
  available: {
    label: "Available",
    cls: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  },
  reserved: {
    label: "Reserved",
    cls: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  },
  occupied: {
    label: "Occupied",
    cls: "border-violet-500/20 bg-violet-500/10 text-violet-300",
  },
  maintenance: {
    label: "Maintenance",
    cls: "border-orange-500/20 bg-orange-500/10 text-orange-300",
  },
  closed: {
    label: "Closed",
    cls: "border-white/10 bg-white/[.04] text-[#8B909E]",
  },
};

export default function HousingOperationsWorkspace({
  initialRecordId,
}: {
  initialRecordId?: string;
}) {
  const openedTarget = useRef<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<any | null>(null);
  const [bookingCode, setBookingCode] = useState("");
  const [search, setSearch] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [checkingCode, setCheckingCode] = useState(false);
  const [checkingInHotel, setCheckingInHotel] = useState(false);
  const [verifiedBooking, setVerifiedBooking] = useState<any | null>(null);
  const [verifiedMoveInCode, setVerifiedMoveInCode] = useState<string | null>(
    null,
  );

  async function load() {
    setLoading(true);
    const [longStay, shortStay] = await Promise.all([
      supabase.rpc("get_my_housing_operations"),
      supabase.rpc("get_my_short_stay_operations_v2"),
    ]);
    const error = longStay.error || shortStay.error;
    if (error) toast.error(error.message);
    const shortRows = (Array.isArray(shortStay.data) ? shortStay.data : []).map(
      (row: any) => ({
        ...row,
        _stayKind: "short_let",
        current_reservation_id: row.reservation_id,
        reservation_status: row.status,
        rent_payment_status: row.payment_status,
        listing_status: row.listing_status,
      }),
    );
    const nextRows = [
      ...(Array.isArray(longStay.data) ? longStay.data : []).map(
        (row: any) => ({
          ...row,
          _stayKind: "long_stay",
        }),
      ),
      ...shortRows,
    ];
    setRows(nextRows);
    if (
      !error &&
      initialRecordId &&
      openedTarget.current !== String(initialRecordId)
    ) {
      openedTarget.current = String(initialRecordId);
      const target = nextRows.find((row: any) =>
        [row.listing_id, row.current_reservation_id, row.reservation_id]
          .filter(Boolean)
          .some((value) => String(value) === String(initialRecordId)),
      );
      if (target) setSelected(target);
      else
        toast.error(
          "The linked booking is no longer available in this branch.",
        );
    }
    setLoading(false);
  }
  useEffect(() => {
    void load();
    const channel = supabase
      .channel("housing-operations-lifecycle")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reservations" },
        () => void load(),
      )
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [initialRecordId]);

  async function verifyCode() {
    const code = bookingCode.trim().toUpperCase();
    if (!code) {
      setLookupError("Enter the customer booking code.");
      return;
    }
    setLookupError("");
    setCheckingCode(true);
    const { data, error } = await supabase.rpc("verify_branch_booking_code", {
      p_code: code,
    });
    setCheckingCode(false);
    if (error) {
      setVerifiedBooking(null);
      setVerifiedMoveInCode(null);
      setLookupError(error.message);
      return;
    }
    if (!data) {
      setVerifiedBooking(null);
      setVerifiedMoveInCode(null);
      setLookupError("No booking with that code was found in this branch.");
      return;
    }
    setVerifiedBooking(data);
    setVerifiedMoveInCode(null);
  }

  async function checkInHotel() {
    if (!verifiedBooking?.can_check_in) return;
    setCheckingInHotel(true);
    const { error } = await supabase.rpc("confirm_hotel_check_in_by_code", {
      p_booking_code: verifiedBooking.code,
    });
    setCheckingInHotel(false);
    if (error) return toast.error(error.message);
    toast.success("Hotel guest checked in");
    setBookingCode("");
    setVerifiedBooking(null);
  }

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (filter !== "all" && row.listing_status !== filter) return false;
        const query = search.trim().toLowerCase();
        if (!query) return true;
        return [
          row.listing_title,
          row.customer_name,
          row.customer_username,
          row.address,
          row.lga,
          row.state,
          row.listing_status,
          row.reservation_status,
          row.rent_payment_status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      }),
    [rows, filter, search],
  );
  const verifiedHousingRow = useMemo(() => {
    if (verifiedBooking?.kind !== "housing") return null;
    return (
      rows.find(
        (row) =>
          String(row.current_reservation_id) ===
          String(verifiedBooking.reservation_id),
      ) || null
    );
  }, [rows, verifiedBooking]);

  if (selected)
    return selected._stayKind === "short_let" ? (
      <ShortStayCase
        row={selected}
        bookingCode={verifiedMoveInCode}
        back={() => {
          setSelected(null);
          setVerifiedBooking(null);
          setVerifiedMoveInCode(null);
          setBookingCode("");
          void load();
        }}
      />
    ) : (
      <HousingCase
        row={selected}
        bookingCode={verifiedMoveInCode}
        back={() => {
          setSelected(null);
          setVerifiedBooking(null);
          setVerifiedMoveInCode(null);
          setBookingCode("");
          void load();
        }}
      />
    );

  return (
    <div className="space-y-5">
      <header className="border-b border-white/[.06] pb-4">
        <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">
          PROPERTY OPERATIONS
        </p>
        <h3 className="mt-2 text-lg font-bold">Bookings and handovers</h3>
        <p className="mt-1 max-w-xl text-[10px] leading-5 text-[#707687]">
          Verify the booking code shown by a customer, then continue the same
          reservation through arrival, handover, stay and completion.
        </p>
      </header>

      <section className="rounded-2xl border border-violet-500/10 bg-violet-500/[.03] p-4">
        <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-violet-300">
          Exact booking verification
        </p>
        <h4 className="mt-1 text-sm font-semibold">
          Enter the code shown by the customer
        </h4>
        <p className="mt-1 text-[9px] leading-5 text-[#747A8B]">
          The code opens one matching booking in this branch. Compare the
          displayed customer, property, status and payment before handing over
          access. It does not confirm ownership or publish a property.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={bookingCode}
            onChange={(event) => {
              setBookingCode(
                event.target.value.toUpperCase().replace(/\s/g, ""),
              );
              setVerifiedBooking(null);
              setVerifiedMoveInCode(null);
              setLookupError("");
            }}
            aria-label="WeHouse booking code"
            autoComplete="off"
            placeholder="Enter booking code"
            maxLength={14}
            className="h-11 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#11151E] px-3 text-xs font-semibold uppercase tracking-wider outline-none focus:border-violet-500/40"
          />
          <button
            disabled={checkingCode}
            onClick={() => void verifyCode()}
            className="h-11 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-50"
          >
            {checkingCode ? "Checking…" : "Verify"}
          </button>
        </div>
        {lookupError && (
          <p
            className="mt-2 rounded-xl bg-red-500/[.06] px-3 py-2 text-[9px] leading-5 text-red-300"
            role="alert"
          >
            {lookupError}
          </p>
        )}
        {verifiedBooking && (
          <div
            className={`mt-3 rounded-xl border p-3 ${verifiedBooking.valid ? "border-emerald-500/15 bg-emerald-500/[.04]" : "border-amber-500/20 bg-amber-500/[.04]"}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p
                  className={`text-xs font-bold tracking-wide ${verifiedBooking.valid ? "text-emerald-300" : "text-amber-300"}`}
                >
                  {verifiedBooking.code}
                </p>
                <p className="mt-1 text-[10px] font-semibold">
                  {verifiedBooking.property_name}
                </p>
              </div>
              <span
                className={`rounded-full border px-2 py-1 text-[8px] capitalize ${verifiedBooking.valid ? "border-emerald-500/20 text-emerald-300" : "border-amber-500/20 text-amber-300"}`}
              >
                {verifiedBooking.valid ? "Valid" : "Not actionable"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Info
                label="Customer"
                value={verifiedBooking.customer_name || "—"}
              />
              <Info
                label="Phone"
                value={verifiedBooking.customer_phone || "—"}
              />
              <Info
                label="Booking status"
                value={String(verifiedBooking.status || "—").replace(/_/g, " ")}
              />
              <Info
                label="Payment"
                value={String(verifiedBooking.payment_status || "—").replace(
                  /_/g,
                  " ",
                )}
              />
            </div>
            {verifiedBooking.kind === "housing" &&
              (verifiedBooking.can_handover || verifiedBooking.can_check_in) &&
              verifiedHousingRow && (
                <button
                  type="button"
                  onClick={() => {
                    setVerifiedMoveInCode(String(verifiedBooking.code));
                    setSelected(verifiedHousingRow);
                  }}
                  className="mt-3 h-11 w-full rounded-xl bg-emerald-500 text-[10px] font-semibold text-[#03100B]"
                >
                  {verifiedBooking.stay_type === "short_let"
                    ? "Continue to guest check-in"
                    : "Continue to verified property handover"}
                </button>
              )}
            {verifiedBooking.kind === "housing" &&
              verifiedBooking.valid &&
              !verifiedBooking.can_handover &&
              !verifiedBooking.can_check_in && (
                <p className="mt-3 rounded-xl bg-amber-500/[.06] p-3 text-[9px] leading-5 text-amber-200">
                  The paid booking exists, but handover is blocked until the
                  required payment and customer arrival time are ready.
                </p>
              )}
            {verifiedBooking.kind === "hotel" && (
              <>
                <p className="mt-3 text-[9px] text-[#8A909F]">
                  Stay:{" "}
                  {verifiedBooking.check_in
                    ? new Date(verifiedBooking.check_in).toLocaleDateString()
                    : "—"}{" "}
                  →{" "}
                  {verifiedBooking.check_out
                    ? new Date(verifiedBooking.check_out).toLocaleDateString()
                    : "—"}{" "}
                  · {verifiedBooking.guest_count || 1} guest(s)
                </p>
                {verifiedBooking.can_check_in ? (
                  <button
                    type="button"
                    disabled={checkingInHotel}
                    onClick={() => void checkInHotel()}
                    className="mt-3 h-11 w-full rounded-xl bg-emerald-500 text-[10px] font-semibold text-[#03100B] disabled:opacity-40"
                  >
                    {checkingInHotel
                      ? "Checking in…"
                      : "Confirm hotel check-in"}
                  </button>
                ) : (
                  <p className="mt-3 rounded-xl bg-amber-500/[.06] p-3 text-[9px] leading-5 text-amber-200">
                    This code cannot check in a guest in its current payment,
                    date or booking state.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3 border-t border-white/[.06] pt-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold">
              Current arrivals and tenancies
            </h4>
            <p className="mt-1 text-[9px] text-[#707687]">
              Search by customer, property, area or a real stored status.
            </p>
          </div>
          <span className="shrink-0 text-[9px] text-[#656B7D]">
            {rows.length} record{rows.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#606576]">
            ⌕
          </span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search customer or property"
            className="h-11 w-full rounded-2xl border border-white/[.07] bg-[#141820] pl-9 pr-3 text-xs outline-none focus:border-violet-500/35"
          />
        </div>
      </section>
      <div className="flex items-center justify-between gap-3 border-b border-white/[.06] pb-3">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#656B7D]">
            Filter
          </p>
          <p className="mt-1 text-[10px] text-[#8A909F]">
            Booking record status
          </p>
        </div>
        <WeHouseSelect
          value={filter}
          options={[
            { value: "all", label: "All records" },
            { value: "available", label: "Available" },
            { value: "reserved", label: "Reserved" },
            { value: "occupied", label: "Occupied" },
            { value: "maintenance", label: "Maintenance" },
            { value: "closed", label: "Closed" },
          ]}
          onChange={(value) => setFilter(value as Filter)}
          eyebrow="Bookings"
          title="Filter booking records"
          ariaLabel="Filter booking records by status"
        />
      </div>
      {loading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <Empty />
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => (
            <button
              key={`${row._stayKind}:${row.current_reservation_id || row.listing_id}`}
              onClick={() => {
                setVerifiedMoveInCode(null);
                setSelected(row);
              }}
              className="w-full rounded-2xl border border-white/[.06] bg-[#10131B] p-4 text-left hover:border-violet-500/20"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs font-semibold">
                      {row.listing_title}
                    </p>
                    {row._stayKind === "short_let" ? (
                      <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[7px] font-semibold text-violet-300">
                        SHORT LET
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-[9px] text-[#686D7E]">
                    {[row.address, row.lga, row.state]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                </div>
                <Badge status={row.listing_status} />
              </div>
              {row.current_reservation_id && (
                <div className="mt-3 flex items-center justify-between border-t border-white/[.05] pt-3">
                  <div>
                    <p className="text-[9px] text-[#626778]">
                      {row.customer_name || "Customer"}
                    </p>
                    <p className="mt-0.5 text-[8px] capitalize text-violet-300">
                      {String(row.reservation_status || "").replace(/_/g, " ")}{" "}
                      · {row._stayKind === "short_let" ? "stay" : "rent"}{" "}
                      {String(row.rent_payment_status || "not started").replace(
                        /_/g,
                        " ",
                      )}
                    </p>
                  </div>
                  {(row.check_out || row.tenancy_end_date) && (
                    <p className="text-[8px] text-[#777C8C]">
                      {row._stayKind === "short_let" ? "Checkout" : "Ends"}{" "}
                      {new Date(
                        row.check_out || row.tenancy_end_date,
                      ).toLocaleDateString()}
                    </p>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ShortStayCase({
  row,
  bookingCode,
  back,
}: {
  row: any;
  bookingCode: string | null;
  back: () => void;
}) {
  const { ask, dialogProps } = useConfirm();
  const firstAllowed = laterDate(
    new Date().toISOString().slice(0, 10),
    String(row.check_in || ""),
  );
  const lastAllowed = previousDate(String(row.check_out || ""));
  const [checkInDate, setCheckInDate] = useState(
    firstAllowed <= lastAllowed ? firstAllowed : String(row.check_in || ""),
  );
  const [nextStatus, setNextStatus] = useState<
    "maintenance" | "available" | "closed"
  >("maintenance");
  const [busy, setBusy] = useState(false);
  const canCheckIn = Boolean(
    row.current_reservation_id &&
    row.reservation_status === "ready_for_move_in" &&
    row.reservation_fee_paid &&
    row.rent_payment_status === "paid",
  );

  async function checkIn() {
    if (!bookingCode)
      return toast.error("Verify the guest booking code before check-in");
    if (
      !checkInDate ||
      checkInDate < String(row.check_in) ||
      checkInDate >= String(row.check_out)
    )
      return toast.error("Check-in must be inside the booked dates");
    if (
      !(await ask({
        title: "Confirm guest check-in?",
        description: `Booking code ${bookingCode} matches this Short Let. Confirm only when the guest has received access.`,
        confirmLabel: "Check guest in",
        variant: "info",
      }))
    )
      return;
    setBusy(true);
    const { error } = await confirmShortStayCheckIn(bookingCode, checkInDate);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Guest checked in. The Property Partner has been notified.");
    back();
  }

  async function checkOut() {
    if (!row.current_reservation_id) return;
    if (
      !(await ask({
        title: "Confirm guest checkout?",
        description: `Close this stay and move the property to ${nextStatus}. Any refundable deposit remains in review.`,
        confirmLabel: "Check guest out",
        variant: "warning",
      }))
    )
      return;
    setBusy(true);
    const { error } = await completeShortStay(
      row.current_reservation_id,
      nextStatus,
    );
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Guest checked out. The Property Partner has been notified.");
    back();
  }

  return (
    <div className="space-y-4">
      <button
        onClick={back}
        className="text-[10px] font-semibold text-violet-300"
      >
        ← Back to arrivals
      </button>
      <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold">{row.listing_title}</h3>
              <span className="rounded-full bg-violet-500/10 px-2 py-1 text-[7px] font-semibold text-violet-300">
                SHORT LET
              </span>
            </div>
            <p className="mt-1 text-[10px] text-[#6D7283]">
              {[row.address, row.lga, row.state].filter(Boolean).join(", ")}
            </p>
          </div>
          <Badge status={row.listing_status} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Info label="Check-in" value={formatDate(row.check_in)} />
          <Info label="Checkout" value={formatDate(row.check_out)} />
          <Info label="Nights" value={String(row.nights || "—")} />
          <Info label="Guests" value={String(row.guest_count || 1)} />
        </div>
      </section>

      <section className="rounded-2xl border border-violet-500/10 bg-violet-500/[.035] p-4">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-violet-300">
          Guest stay
        </p>
        <h4 className="mt-2 text-sm font-semibold">
          {row.customer_name || "Customer"}
        </h4>
        <PropertyBookingJourney
          audience="operations"
          row={{
            ...row,
            status: row.reservation_status,
            stay_type: "short_let",
            paid_at: row.reservation_fee_paid ? row.created_at || true : null,
          }}
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Info
            label="Booking"
            value={String(row.reservation_status || "—").replace(/_/g, " ")}
          />
          <Info
            label="Stay payment"
            value={String(row.rent_payment_status || "not started").replace(
              /_/g,
              " ",
            )}
          />
          <Info
            label="Stay rent"
            value={`₦${Number(row.stay_rent_total || 0).toLocaleString()}`}
          />
          <Info
            label="Deposit"
            value={String(row.security_deposit_status || "pending").replace(
              /_/g,
              " ",
            )}
          />
        </div>
      </section>

      {canCheckIn && bookingCode ? (
        <section className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[.035] p-4">
          <h4 className="text-sm font-semibold text-emerald-300">
            Confirm guest entry
          </h4>
          <p className="mt-1 text-[10px] leading-5 text-[#788090]">
            Code{" "}
            <span className="font-bold text-emerald-200">{bookingCode}</span> is
            verified. The date must stay inside this booking.
          </p>
          <label className="mt-3 block">
            <span className="mb-1 block text-[9px] text-[#757B8C]">
              Check-in date
            </span>
            <input
              type="date"
              min={String(row.check_in)}
              max={lastAllowed}
              value={checkInDate}
              onChange={(event) => setCheckInDate(event.target.value)}
              className="h-11 w-full rounded-xl border border-white/[.08] bg-[#151923] px-3 text-xs"
            />
          </label>
          <button
            disabled={busy}
            onClick={() => void checkIn()}
            className="mt-3 h-11 w-full rounded-xl bg-emerald-500 text-xs font-semibold text-[#03100B] disabled:opacity-50"
          >
            {busy ? "Updating…" : "Confirm check-in → Occupied"}
          </button>
        </section>
      ) : row.reservation_status === "ready_for_move_in" ? (
        <section className="rounded-2xl border border-amber-500/15 bg-amber-500/[.035] p-4">
          <h4 className="text-sm font-semibold text-amber-300">
            {bookingCode
              ? "Payment confirmation required"
              : "Booking code required"}
          </h4>
          <p className="mt-1 text-[10px] leading-5 text-[#85808A]">
            {bookingCode
              ? "Check-in stays blocked until the reservation fee and full Short Let payment are confirmed."
              : "Verify the code shown by the guest from Booking lookup before handing over access."}
          </p>
        </section>
      ) : null}

      {row.listing_status === "occupied" ? (
        <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.035] p-4">
          <h4 className="text-sm font-semibold text-violet-300">
            Confirm checkout
          </h4>
          <p className="mt-1 text-[10px] leading-5 text-[#788090]">
            Use this when the guest leaves. The stay closes and the Property
            Partner receives a checkout update.
          </p>
          <div className="mt-3">
            <WeHouseSelect
              value={nextStatus}
              options={[
                {
                  value: "maintenance",
                  label: "Maintenance",
                  description: "Inspect and reset before the next stay",
                },
                {
                  value: "available",
                  label: "Available",
                  description: "Return it to booking immediately",
                },
                {
                  value: "closed",
                  label: "Closed",
                  description: "Remove it from booking",
                },
              ]}
              onChange={setNextStatus}
              eyebrow="After checkout"
              title="Property state"
              ariaLabel="Choose property state after checkout"
            />
          </div>
          <button
            disabled={busy}
            onClick={() => void checkOut()}
            className="mt-3 h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50"
          >
            {busy ? "Updating…" : "Confirm checkout"}
          </button>
        </section>
      ) : null}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

function HousingCase({
  row,
  bookingCode,
  back,
}: {
  row: any;
  bookingCode: string | null;
  back: () => void;
}) {
  const { ask, dialogProps } = useConfirm();
  const [startDate, setStartDate] = useState(
    row.requested_move_in_at
      ? new Date(row.requested_move_in_at).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  );
  const [nextStatus, setNextStatus] = useState<
    "maintenance" | "available" | "closed"
  >("maintenance");
  const [busy, setBusy] = useState(false);
  const [verifiedCode, setVerifiedCode] = useState<string | null>(bookingCode);
  const [codeInput, setCodeInput] = useState(bookingCode || "");
  const [codeError, setCodeError] = useState("");
  const [checkingCode, setCheckingCode] = useState(false);
  const rentReady = ["paid", "upfront_paid"].includes(
    String(row.rent_payment_status || ""),
  );
  const canMoveIn = Boolean(
    row.current_reservation_id &&
    row.reservation_status === "ready_for_move_in" &&
    row.reservation_fee_paid &&
    rentReady &&
    row.requested_move_in_at,
  );

  useEffect(() => {
    setVerifiedCode(bookingCode);
    setCodeInput(bookingCode || "");
    setCodeError("");
  }, [bookingCode, row.current_reservation_id]);

  async function verifyArrivalCode() {
    const code = codeInput.trim().toUpperCase();
    if (!code) {
      setCodeError("Enter the code shown by this customer.");
      return;
    }
    setCheckingCode(true);
    setCodeError("");
    const { data, error } = await supabase.rpc("verify_branch_booking_code", {
      p_code: code,
    });
    setCheckingCode(false);
    if (error || !data) {
      setVerifiedCode(null);
      setCodeError(error?.message || "This booking code could not be verified.");
      return;
    }
    if (
      String(data.kind || "") !== "housing" ||
      String(data.reservation_id || "") !== String(row.current_reservation_id)
    ) {
      setVerifiedCode(null);
      setCodeError("This code belongs to a different booking. Check the customer and property before continuing.");
      return;
    }
    if (!data.valid || !data.can_handover) {
      setVerifiedCode(null);
      setCodeError("This reservation is not ready for handover. Verified rent and the customer’s selected arrival time are required.");
      return;
    }
    setVerifiedCode(String(data.code || code));
    setCodeInput(String(data.code || code));
    toast.success("Customer, property, payment and move-in time matched.");
  }

  async function activate() {
    if (!verifiedCode)
      return toast.error(
        "Verify the customer booking code before confirming handover",
      );
    if (
      !(await ask({
        title: "Complete move-in handover?",
        description: `Booking code ${verifiedCode} matches ${row.customer_name || "this customer"}, this apartment, the verified rent and the requested arrival time. This starts the tenancy on ${new Date(startDate).toLocaleDateString()}.`,
        confirmLabel: "Start tenancy",
        variant: "info",
      }))
    )
      return;
    setBusy(true);
    const { error } = await confirmApartmentHandover(verifiedCode, startDate);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Tenancy activated. Property is now Occupied.");
    back();
  }

  async function complete() {
    if (!row.current_reservation_id) return;
    if (
      !(await ask({
        title: "Complete tenancy?",
        description: `Confirm the customer has moved out. The property will move to ${nextStatus}.`,
        confirmLabel: "Complete tenancy",
        variant: "warning",
      }))
    )
      return;
    setBusy(true);
    const { error } = await completeApartmentTenancy(
      row.current_reservation_id,
      nextStatus,
    );
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Tenancy completed. Property moved to ${nextStatus}.`);
    back();
  }

  return (
    <div className="space-y-4">
      <button
        onClick={back}
        className="text-[10px] font-semibold text-violet-300"
      >
        ← Back to bookings
      </button>
      <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold">{row.listing_title}</h3>
            <p className="mt-1 text-[10px] text-[#6D7283]">
              {[row.address, row.lga, row.state].filter(Boolean).join(", ")}
            </p>
          </div>
          <Badge status={row.listing_status} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Info
            label="Annual rent"
            value={`₦${Number(row.annual_rent || 0).toLocaleString()}`}
          />
          <Info
            label="Property"
            value={String(
              row.sub_type || row.property_type || "apartment",
            ).replace(/_/g, " ")}
          />
          <Info
            label="Reservation"
            value={propertyBookingStatusLabel({
              ...row,
              status: row.reservation_status,
              stay_type: "long_stay",
            })}
          />
          <Info
            label="Reservation fee"
            value={row.reservation_fee_paid ? "Confirmed" : "Not paid"}
          />
        </div>
      </section>

      {row.current_reservation_id && (
        <section className="rounded-2xl border border-violet-500/10 bg-violet-500/[.035] p-4">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-violet-300">
            Current resident workflow
          </p>
          <h4 className="mt-2 text-sm font-semibold">
            {row.customer_name || "Customer"}
          </h4>
          {row.customer_username && (
            <p className="mt-1 text-[9px] text-[#6C7182]">
              @{row.customer_username}
            </p>
          )}
          <PropertyBookingJourney
            audience="operations"
            row={{
              ...row,
              status: row.reservation_status,
              stay_type: "long_stay",
              paid_at: row.reservation_fee_paid ? row.created_at || true : null,
            }}
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Info
              label="Tenure"
              value={`${row.rental_plan_years || 1} year${Number(row.rental_plan_years || 1) === 1 ? "" : "s"}`}
            />
            <Info
              label="Rent"
              value={String(row.rent_payment_status || "not_started").replace(
                /_/g,
                " ",
              )}
            />
            <Info
              label="Year 1 due"
              value={`₦${Number(row.upfront_rent_required || row.annual_rent || 0).toLocaleString()}`}
            />
            <Info
              label="Future plan"
              value={
                Number(row.rental_plan_years || 1) > 1
                  ? "Months 5–12"
                  : "Not needed"
              }
            />
            <Info
              label="Move-in request"
              value={row.requested_move_in_at ? new Date(row.requested_move_in_at).toLocaleString() : rentReady ? "Waiting for customer" : "Available after rent"}
            />
          </div>
          {Number(row.rental_plan_years || 1) > 1 && (
            <p className="mt-3 text-[9px] leading-5 text-emerald-300">
              Year 1 is paid in full. After move-in, the customer gets four full
              months without future-year contributions; months 5–12 then build
              the next year’s rent gradually. The cycle repeats for each
              additional year.
            </p>
          )}
          {row.hold_expires_at && !rentReady && (
            <p className="mt-3 text-[9px] text-amber-300">
              Reservation hold expires{" "}
              {new Date(row.hold_expires_at).toLocaleString()}
            </p>
          )}
          {row.tenancy_start_date && (
            <div className="mt-3 rounded-xl bg-white/[.025] p-3">
              <SmallRow
                label="Started"
                value={new Date(row.tenancy_start_date).toLocaleDateString()}
              />
              <SmallRow
                label="Tenancy ends"
                value={
                  row.tenancy_end_date
                    ? new Date(row.tenancy_end_date).toLocaleDateString()
                    : "—"
                }
              />
              <SmallRow
                label="Grace until"
                value={
                  row.move_out_grace_until
                    ? new Date(row.move_out_grace_until).toLocaleDateString()
                    : "—"
                }
              />
            </div>
          )}
        </section>
      )}

      {row.reservation_status === "ready_for_move_in" && !rentReady && (
        <section className="rounded-2xl border border-amber-500/15 bg-amber-500/[.035] p-4">
          <h4 className="text-sm font-semibold text-amber-300">
            Waiting for verified Year 1 rent
          </h4>
          <p className="mt-1 text-[10px] leading-5 text-[#85808A]">
            The inspection passed, but Operations cannot activate occupancy
            until the full first-year rent is verified server-side.
          </p>
        </section>
      )}

      {row.reservation_status === "ready_for_move_in" && rentReady && !row.requested_move_in_at && (
        <section className="rounded-2xl border border-amber-500/15 bg-amber-500/[.035] p-4">
          <h4 className="text-sm font-semibold text-amber-300">
            Waiting for customer move-in time
          </h4>
          <p className="mt-1 text-[10px] leading-5 text-[#85808A]">
            Year 1 rent is verified, but the tenancy has not started. The
            customer must choose an arrival time before Operations can verify
            handover.
          </p>
        </section>
      )}

      {canMoveIn && !verifiedCode && (
        <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.035] p-4">
          <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-violet-300">
            Customer arrival verification
          </p>
          <h4 className="mt-1 text-sm font-semibold">
            Match the code for this move-in
          </h4>
          <p className="mt-1 text-[10px] leading-5 text-[#85808A]">
            Ask the customer for the code when they arrive at the selected time. WeHouse checks that it belongs to this customer, apartment and verified rent before handover can continue.
          </p>
          <p className="mt-3 text-[9px] text-[#777D8E]">
            Requested arrival · {new Date(row.requested_move_in_at).toLocaleString()}
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={codeInput}
              onChange={(event) => {
                setCodeInput(event.target.value.toUpperCase().replace(/\s/g, ""));
                setCodeError("");
              }}
              aria-label="Customer move-in code"
              autoComplete="off"
              placeholder="Enter customer code"
              maxLength={14}
              className="h-11 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#11151E] px-3 text-xs font-semibold uppercase tracking-wider outline-none focus:border-violet-500/40"
            />
            <button
              type="button"
              disabled={checkingCode}
              onClick={() => void verifyArrivalCode()}
              className="h-11 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-50"
            >
              {checkingCode ? "Checking…" : "Verify"}
            </button>
          </div>
          {codeError && (
            <p className="mt-2 rounded-xl bg-red-500/[.06] px-3 py-2 text-[9px] leading-5 text-red-300" role="alert">
              {codeError}
            </p>
          )}
        </section>
      )}

      {canMoveIn && verifiedCode && (
        <section className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[.035] p-4">
          <h4 className="text-sm font-semibold text-emerald-300">
            Complete handover and start tenancy
          </h4>
          <p className="mt-1 text-[10px] leading-5 text-[#788090]">
            Code <span className="font-bold text-emerald-200">{verifiedCode}</span>{" "}
            has been matched. Confirm only after the customer receives the keys or access.
          </p>
          <label className="mt-3 block">
            <span className="mb-1 block text-[9px] text-[#757B8C]">
              Move-in date
            </span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="h-11 w-full rounded-xl border border-white/[.08] bg-[#151923] px-3 text-xs"
            />
          </label>
          <button
            disabled={busy}
            onClick={() => void activate()}
            className="mt-3 h-11 w-full rounded-xl bg-emerald-500 text-xs font-semibold text-[#03100B] disabled:opacity-50"
          >
            {busy ? "Updating…" : "Confirm access → Start tenancy"}
          </button>
        </section>
      )}

      {row.listing_status === "occupied" && (
        <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.035] p-4">
          <h4 className="text-sm font-semibold text-violet-300">
            Complete tenancy
          </h4>
          <p className="mt-1 text-[10px] leading-5 text-[#788090]">
            When the customer has moved out, close the tenancy and choose what
            happens to the property next.
          </p>
          <div className="mt-3">
            <WeHouseSelect
              value={nextStatus}
              options={[
                {
                  value: "maintenance",
                  label: "Maintenance",
                  description: "Inspect before returning it to the market",
                },
                {
                  value: "available",
                  label: "Available",
                  description: "Return it to users immediately",
                },
                {
                  value: "closed",
                  label: "Closed",
                  description: "Remove it from the market",
                },
              ]}
              onChange={setNextStatus}
              eyebrow="Tenancy completion"
              title="What happens next?"
              ariaLabel="Choose property state after move-out"
            />
          </div>
          <button
            disabled={busy}
            onClick={() => void complete()}
            className="mt-3 h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50"
          >
            {busy ? "Updating…" : "Complete tenancy"}
          </button>
        </section>
      )}

      {row.listing_status === "maintenance" && (
        <section className="rounded-2xl border border-orange-500/15 bg-orange-500/[.035] p-4">
          <p className="text-xs font-semibold text-orange-300">
            Property is in maintenance
          </p>
          <p className="mt-1 text-[10px] leading-5 text-[#7C8190]">
            Do not mark this property Reserved or Occupied manually. Return it
            to Available only after the operational checks are complete.
          </p>
        </section>
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

function Badge({ status }: { status: string }) {
  const item = STATUS[status] || STATUS.closed;
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-semibold ${item.cls}`}
    >
      {item.label}
    </span>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[.025] p-3">
      <p className="text-[8px] uppercase text-[#5E6373]">{label}</p>
      <p className="mt-1 truncate text-[10px] font-semibold capitalize text-[#C4C7D0]">
        {value}
      </p>
    </div>
  );
}
function SmallRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-1 flex justify-between gap-3 text-[9px]">
      <span className="text-[#717687]">{label}</span>
      <span className="font-semibold text-[#C5C8D2]">{value}</span>
    </div>
  );
}
function Loading() {
  return (
    <div className="grid min-h-48 place-items-center">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
    </div>
  );
}
function Empty() {
  return (
    <div className="rounded-2xl border border-dashed border-white/[.08] p-10 text-center">
      <p className="text-xs font-semibold">
        No arrival or tenancy records match
      </p>
      <p className="mt-1 text-[9px] text-[#626778]">
        Try another search or status. New records appear after a real
        reservation reaches branch operations.
      </p>
    </div>
  );
}
function laterDate(a: string, b: string) {
  return a > b ? a : b;
}
function previousDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
function formatDate(value?: string | null) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString() : "—";
}
