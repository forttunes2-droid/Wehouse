import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast, Toaster } from "sonner";
import {
  cancelReservation,
  createInspectionRequest,
  getInspectionRequestsForUser,
  getReservationsForUser,
  initializeReservationPayment,
  requestApartmentMoveIn,
} from "@/lib/supabase/reservations";
import {
  initializeApartmentRentPayment,
  initializeShortStayPayment,
} from "@/lib/supabase/housing-payments";
import {
  getHotelBookingsForUser,
  initializeHotelBookingPayment,
  updateBookingStatus,
} from "@/lib/supabase/hotels";
import type { Profile } from "@/types";
import ConfirmDialog from "@/components/ConfirmDialog";
import BookingNegotiationChat from "@/components/BookingNegotiationChat";
import HotelBookingChat from "@/components/HotelBookingChat";
import {
  BOOKING_STATUS_LABELS,
  getMyBookingConversations,
} from "@/lib/supabase/worker-bookings";
import BackButton from "@/components/BackButton";
import { directionsUrl } from "@/hooks/useDiscoveryLocation";
import WeHouseSelect from "@/components/WeHouseSelect";
import PropertyBookingJourney from "@/components/PropertyBookingJourney";
import {
  getPropertyBookingJourney,
  propertyBookingStatusLabel,
} from "@/lib/propertyBookingLifecycle";
import { verifyPaymentWithRetry } from "@/lib/supabase/payment-verify";

type Props = {
  profile: Profile;
  initialBookingId?: string | null;
  onInitialBookingConsumed?: () => void;
  onOpenConversation?: (id: string) => void;
  onOpenListing?: (id: string) => void;
};
type View = "all" | "housing" | "hotels" | "services";
type StatusView = "all" | BookingGroup;
type BookingItem = {
  kind: "housing" | "hotel" | "service";
  row: any;
  date: string;
};
type BookingGroup = "action" | "active" | "history";
type BookingSourceErrors = Partial<
  Record<"housing" | "hotels" | "services", string>
>;

const VIEW_OPTIONS = [
  {
    value: "all",
    label: "All bookings",
    description: "Apartments, hotels and WeHouse Services",
  },
  {
    value: "housing",
    label: "Apartments",
    description: "Short Let and Long Let",
  },
  {
    value: "hotels",
    label: "Hotels",
    description: "Hotel room and package bookings",
  },
  {
    value: "services",
    label: "WeHouse Services",
    description: "Jobs booked with professionals",
  },
] as const;
const STATUS_OPTIONS = [
  {
    value: "all",
    label: "All statuses",
    description: "Needs action, active and history",
  },
  {
    value: "action",
    label: "Needs action",
    description: "A decision or payment is waiting for you",
  },
  {
    value: "active",
    label: "Active & upcoming",
    description: "Confirmed, upcoming or in progress",
  },
  {
    value: "history",
    label: "History",
    description: "Completed, cancelled, expired or refunded",
  },
] as const;
const money = (value: unknown) => `₦${Number(value || 0).toLocaleString()}`;
const date = (value: any) =>
  value ? new Date(value).toLocaleDateString() : "—";
const isUnpaidHousingDraft = (row: any) =>
  ["cancelled", "expired"].includes(String(row.status || "")) &&
  !row.paid_at &&
  !["paid", "completed"].includes(String(row.manual_payment_status || ""));
const isUnpaidHotelDraft = (row: any) =>
  ["cancelled", "expired"].includes(String(row.status || "")) &&
  !row.paid_at &&
  String(row.payment_status || "") !== "paid";
const HOTEL_STATUS: Record<string, string> = {
  pending: "Awaiting payment",
  confirmed: "Stay confirmed",
  checked_in: "Checked in",
  checked_out: "Checked out",
  completed: "Stay completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
  expired: "Expired",
  payment_conflict: "Payment review",
};

export default function MyReservations({
  profile,
  initialBookingId,
  onInitialBookingConsumed,
}: Props) {
  const openedInitialRef = useRef<string | null>(null);
  const [housing, setHousing] = useState<any[]>([]);
  const [hotels, setHotels] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [inspections, setInspections] = useState<any[]>([]);
  const [view, setView] = useState<View>("all");
  const [statusView, setStatusView] = useState<StatusView>("all");
  const [sourceErrors, setSourceErrors] = useState<BookingSourceErrors>({});
  const [loading, setLoading] = useState(true);
  const [activeHousing, setActiveHousing] = useState<any | null>(null);
  const [activeHotel, setActiveHotel] = useState<any | null>(null);
  const [activeHotelChat, setActiveHotelChat] = useState<any | null>(null);
  const [activeService, setActiveService] = useState<{
    conversationId: string;
    bookingId: string;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    kind: "cancel_housing" | "cancel_hotel";
    row: any;
  } | null>(null);

  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const [housingResult, hotelResult, serviceResult, inspectionResult] =
        await Promise.allSettled([
          getReservationsForUser(profile.user_id),
          getHotelBookingsForUser(profile.user_id),
          getMyBookingConversations(profile.user_id),
          getInspectionRequestsForUser(profile.user_id),
        ]);
      const nextErrors: BookingSourceErrors = {};
      if (housingResult.status === "fulfilled") {
        if (housingResult.value.reservations) {
          const nextHousing = housingResult.value.reservations.filter(
            (row: any) => !isUnpaidHousingDraft(row),
          );
          setHousing(nextHousing);
          setActiveHousing((current: any) =>
            current
              ? nextHousing.find(
                  (row: any) => String(row.id) === String(current.id),
                ) || current
              : current,
          );
        }
        if (housingResult.value.error)
          nextErrors.housing =
            "Apartment bookings could not be fully refreshed.";
      } else {
        nextErrors.housing = "Apartment bookings could not be refreshed.";
      }
      if (hotelResult.status === "fulfilled") {
        if (!hotelResult.value.error) {
          setHotels(
            (hotelResult.value.bookings || []).filter(
              (row: any) => !isUnpaidHotelDraft(row),
            ),
          );
        } else nextErrors.hotels = "Hotel stays could not be refreshed.";
      } else nextErrors.hotels = "Hotel stays could not be refreshed.";
      if (serviceResult.status === "fulfilled") {
        if (!serviceResult.value.error)
          setServices(serviceResult.value.conversations || []);
        else nextErrors.services = "WeHouse Services could not be refreshed.";
      } else nextErrors.services = "WeHouse Services could not be refreshed.";
      if (inspectionResult.status === "fulfilled") {
        if (!inspectionResult.value.error)
          setInspections(inspectionResult.value.inspections || []);
        else
          nextErrors.housing ||=
            "Apartment inspection updates could not be refreshed.";
      } else
        nextErrors.housing ||=
          "Apartment inspection updates could not be refreshed.";
      setSourceErrors(nextErrors);
    } finally {
      setBusyId(null);
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const refresh = () => void load(true);
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [profile.user_id]);

  useEffect(() => {
    if (
      !initialBookingId ||
      loading ||
      openedInitialRef.current === initialBookingId
    )
      return;
    const housingMatch = housing.find(
      (row) =>
        String(row.id) === initialBookingId ||
        String(row.reservation_code || "") === initialBookingId ||
        String(row.listing_id || "") === initialBookingId,
    );
    if (housingMatch) {
      openedInitialRef.current = initialBookingId;
      setActiveHousing(housingMatch);
      onInitialBookingConsumed?.();
      return;
    }
    const hotelMatch = hotels.find(
      (row) =>
        String(row.id || row.booking_id) === initialBookingId ||
        String(row.reservation_code || row.booking_code || "") ===
          initialBookingId,
    );
    if (hotelMatch) {
      openedInitialRef.current = initialBookingId;
      setActiveHotel(hotelMatch);
      onInitialBookingConsumed?.();
      return;
    }
    const serviceMatch = services.find(
      (row) =>
        String(row.booking_id) === initialBookingId ||
        String(row.conversation_id) === initialBookingId ||
        String(row.booking_code || "") === initialBookingId,
    );
    if (serviceMatch) {
      openedInitialRef.current = initialBookingId;
      setActiveService({
        conversationId: serviceMatch.conversation_id,
        bookingId: serviceMatch.booking_id,
      });
      onInitialBookingConsumed?.();
      return;
    }
    openedInitialRef.current = initialBookingId;
    onInitialBookingConsumed?.();
  }, [
    initialBookingId,
    loading,
    housing,
    hotels,
    services,
    onInitialBookingConsumed,
  ]);

  const rows = useMemo(
    () =>
      [
        ...housing.map((row) => ({
          kind: "housing" as const,
          row,
          date: row.created_at || "",
        })),
        ...hotels.map((row) => ({
          kind: "hotel" as const,
          row,
          date: row.created_at || "",
        })),
        ...services.map((row) => ({
          kind: "service" as const,
          row,
          date: row.updated_at || "",
        })),
      ]
        .filter((item) =>
          view === "all"
            ? true
            : view === "housing"
              ? item.kind === "housing"
              : view === "hotels"
                ? item.kind === "hotel"
                : item.kind === "service",
        )
        .sort(
          (a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime(),
        ),
    [housing, hotels, services, view],
  );

  const sections = useMemo(() => {
    const groups: Record<BookingGroup, BookingItem[]> = {
      action: [],
      active: [],
      history: [],
    };
    for (const item of rows as BookingItem[]) {
      const group = bookingGroup(item);
      if (statusView === "all" || statusView === group) groups[group].push(item);
    }
    return [
      { id: "action" as const, label: "Needs your action", items: groups.action },
      { id: "active" as const, label: "Active & upcoming", items: groups.active },
      { id: "history" as const, label: "History", items: groups.history },
    ].filter((section) => section.items.length > 0);
  }, [rows, statusView]);

  async function cancelHousing(row: any) {
    setBusyId(row.id);
    const { error } = await cancelReservation(row.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Reservation cancelled");
    await load();
  }

  async function cancelHotel(row: any) {
    const id = Number(row.booking_id);
    setBusyId(`hotel-${id}`);
    const { error } = await updateBookingStatus(id, "cancelled");
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Hotel reservation cancelled");
    await load();
  }

  async function payHotel(row: any) {
    const id = Number(row.booking_id);
    setBusyId(`hotel-${id}`);
    const { result, error } = await initializeHotelBookingPayment(id);
    if (error || !result?.success) {
      setBusyId(null);
      return toast.error(
        error?.message || result?.error || "Could not open secure payment",
      );
    }
    if (result.already_paid) {
      toast.success("Hotel payment already confirmed");
      await load();
      return;
    }
    if (!result.authorization_url) {
      setBusyId(null);
      return toast.error("Secure checkout link is missing");
    }
    window.location.assign(String(result.authorization_url));
  }

  async function continueHousing(row: any) {
    if (!row.payment_reference)
      return toast.error(
        "This reservation cannot be resumed. Start again from the apartment.",
      );
    setBusyId(row.id);
    const { result } = await initializeReservationPayment(
      String(row.payment_reference),
    );
    if (!result?.success) {
      setBusyId(null);
      return toast.error(result?.error || "Could not reopen payment");
    }
    if (result.already_paid) {
      toast.success("Reservation payment is already confirmed");
      await load();
      return;
    }
    if (!result.authorization_url) {
      setBusyId(null);
      return toast.error("Secure checkout link is missing");
    }
    window.location.assign(String(result.authorization_url));
  }

  async function inspectHousing(row: any) {
    setBusyId(row.id);
    const { error } = await createInspectionRequest(
      row.id,
      row.listing_id,
      profile.user_id,
      `Inspection requested for ${row.listing_title || "apartment"}`,
    );
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Apartment inspection requested");
    await load();
  }

  async function payHousingRent(row: any) {
    setBusyId(row.id);
    if (
      row.rent_payment_status === "payment_pending" &&
      row.rent_payment_reference
    ) {
      const verified = await verifyPaymentWithRetry(
        String(row.rent_payment_reference),
        { purpose: "apartment_rent" },
        1,
      );
      if (verified.success && verified.verified) {
        toast.success(
          row.stay_type === "short_let"
            ? "Stay payment confirmed"
            : "Year 1 rent confirmed",
        );
        await load(true);
        return;
      }
      if (verified.requires_review) {
        setBusyId(null);
        return toast.error(
          verified.error ||
            "Payment was charged and is now with WeHouse for review",
        );
      }
    }
    const { result, error } =
      row.stay_type === "short_let"
        ? await initializeShortStayPayment(row.id)
        : await initializeApartmentRentPayment(row.id);
    if (error || !result?.success) {
      setBusyId(null);
      return toast.error(
        error?.message || result?.error || "Could not open secure payment",
      );
    }
    if (result.already_paid) {
      toast.success(
        row.stay_type === "short_let"
          ? "Stay payment already confirmed"
          : "Year 1 rent already confirmed",
      );
      await load();
      return;
    }
    if (!result.authorization_url) {
      setBusyId(null);
      return toast.error("Secure checkout link is missing");
    }
    window.location.assign(String(result.authorization_url));
  }

  async function requestMoveIn(row: any, requestedAt: string) {
    setBusyId(row.id);
    const { error } = await requestApartmentMoveIn(
      row.id,
      new Date(requestedAt).toISOString(),
    );
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Move-in time sent to Property Operations");
    await load(true);
  }

  async function runPending() {
    const action = pending;
    setPending(null);
    if (!action) return;
    if (action.kind === "cancel_housing") return cancelHousing(action.row);
    return cancelHotel(action.row);
  }

  function support(row: any) {
    window.dispatchEvent(
      new CustomEvent("openSupportChat", {
        detail: {
          category:
            row.status === "payment_conflict" ||
            row.rent_payment_status === "payment_pending"
              ? "payment"
              : "apartment_booking",
          subject: `${
            row.stay_type === "short_let" ? "Short Let" : "Long Let"
          } · ${row.listing_title || "Apartment"}`,
          contextType: "apartment_reservation",
          contextId: row.id,
          contextSnapshot: {
            reservation_id: row.id,
            listing_id: row.listing_id,
            listing_title: row.listing_title,
            listing_location:
              row.listing_location ||
              row.listing_address ||
              [row.listing_city, row.listing_state].filter(Boolean).join(", "),
            stay_type: row.stay_type,
            status: row.status,
            check_in: row.stay_check_in,
            check_out: row.stay_check_out,
            rent_payment_status: row.rent_payment_status,
          },
        },
      }),
    );
  }

  function hotelSupport(row: any) {
    window.dispatchEvent(
      new CustomEvent("openSupportChat", {
        detail: {
          category: "hotel_booking",
          subject: `Hotel booking help · ${
            row.hotels?.name || row.hotel?.name || row.hotel_name || "Hotel stay"
          }`,
          contextType: "hotel_booking",
          contextId: String(row.booking_id),
          contextSnapshot: {
            booking_id: row.booking_id,
            hotel_id: row.hotel_id,
            hotel_name:
              row.hotels?.name || row.hotel?.name || row.hotel_name,
            room_id: row.room_id,
            room_name:
              row.hotel_rooms?.room_type ||
              row.hotel_rooms?.name ||
              row.room_name,
            rate_plan_id: row.rate_plan_id,
            rate_plan_name:
              row.rate_plan_name || row.hotel_rate_plans?.name,
            check_in: row.check_in_date || row.check_in,
            check_out: row.check_out_date || row.check_out,
            guest_count: row.guest_count,
            guest_name: row.guest_name,
            total_price: row.total_price,
            status: row.status,
            payment_status: row.payment_status,
          },
        },
      }),
    );
  }

  if (activeService)
    return (
      <BookingNegotiationChat
        conversationId={activeService.conversationId}
        bookingId={activeService.bookingId}
        profile={profile}
        isWorker={false}
        onClose={() => {
          setActiveService(null);
          void load();
        }}
      />
    );

  if (activeHotelChat)
    return (
      <HotelBookingChat
        bookingId={Number(activeHotelChat.booking_id)}
        profile={profile}
        title={
          activeHotelChat.hotels?.name ||
          activeHotelChat.hotel?.name ||
          activeHotelChat.hotel_name ||
          "Hotel"
        }
        subtitle={`${
          activeHotelChat.hotel_rooms?.room_type ||
          activeHotelChat.room_name ||
          "Room"
        } · Paid stay`}
        readOnly={!["confirmed", "checked_in"].includes(
          String(activeHotelChat.status || ""),
        )}
        onClose={() => {
          setActiveHotelChat(null);
          void load(true);
        }}
      />
    );

  if (activeHousing)
    return (
      <PropertyBookingDetail
        row={activeHousing}
        inspection={
          inspections.find(
            (item) =>
              String(item.reservation_id) === String(activeHousing.id),
          ) || null
        }
        busy={busyId === activeHousing.id}
        onBack={() => setActiveHousing(null)}
        onDesk={() => support(activeHousing)}
        onResume={() => void continueHousing(activeHousing)}
        onCancel={() => {
          setActiveHousing(null);
          setPending({ kind: "cancel_housing", row: activeHousing });
        }}
        onInspect={() => void inspectHousing(activeHousing)}
        onRent={() => void payHousingRent(activeHousing)}
        onMoveIn={(requestedAt) =>
          void requestMoveIn(activeHousing, requestedAt)
        }
      />
    );

  if (activeHotel)
    return (
      <HotelBookingDetail
        row={activeHotel}
        busy={busyId === `hotel-${activeHotel.booking_id}`}
        onBack={() => setActiveHotel(null)}
        onDesk={() => hotelSupport(activeHotel)}
        onHotel={() => setActiveHotelChat(activeHotel)}
        onPay={() => void payHotel(activeHotel)}
        onCancel={() => {
          setActiveHotel(null);
          setPending({ kind: "cancel_hotel", row: activeHotel });
        }}
      />
    );

  return (
    <div className="min-h-[100dvh] bg-[#090B10] pb-8 text-white">
      <Toaster position="top-center" richColors />
      <header className="sticky top-0 z-40 border-b border-white/[.06] bg-[#090B10]/95 px-4 py-4 backdrop-blur-xl sm:px-5 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-xl font-bold">Bookings</h1>
          <p className="mt-1 text-[10px] text-[#74798B]">
            Your active bookings, things that need action, and history.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4 sm:px-5 lg:px-8">
        <div className="grid grid-cols-2 gap-2 border-b border-white/[.07] pb-4">
          <WeHouseSelect
            value={view}
            options={VIEW_OPTIONS}
            onChange={setView}
            eyebrow="Bookings"
            title="Booking type"
            ariaLabel="Filter bookings by type"
            className="w-full !min-w-0"
          />
          <WeHouseSelect
            value={statusView}
            options={STATUS_OPTIONS}
            onChange={setStatusView}
            eyebrow="Bookings"
            title="Booking status"
            ariaLabel="Filter bookings by status"
            className="w-full !min-w-0"
          />
        </div>

        {Object.keys(sourceErrors).length > 0 ? (
          <div className="mt-3">
            <BookingSourceNotice
              errors={sourceErrors}
              retry={() => void load()}
            />
          </div>
        ) : null}

        {loading ? (
          <Loading />
        ) : sections.length === 0 ? (
          <Empty view={view} statusView={statusView} />
        ) : (
          <div className="mt-4 space-y-5">
            {sections.map((section) => (
              <section key={section.id}>
                <div className="flex items-center justify-between pb-2">
                  <h2
                    className={`text-[9px] font-bold uppercase tracking-[.14em] ${
                      section.id === "action"
                        ? "text-amber-300"
                        : "text-[#747A8B]"
                    }`}
                  >
                    {section.label}
                  </h2>
                  <span className="text-[9px] text-[#555C6D]">
                    {section.items.length}
                  </span>
                </div>
                <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
                  {section.items.map((item) =>
                    item.kind === "housing" ? (
                      <HousingCard
                        key={item.row.id}
                        row={item.row}
                        onOpen={() => setActiveHousing(item.row)}
                      />
                    ) : item.kind === "hotel" ? (
                      <HotelCard
                        key={item.row.booking_id}
                        row={item.row}
                        onOpen={() => setActiveHotel(item.row)}
                      />
                    ) : (
                      <ServiceCard
                        key={
                          item.row.booking_id || item.row.conversation_id
                        }
                        row={item.row}
                        onOpen={() =>
                          setActiveService({
                            conversationId: item.row.conversation_id,
                            bookingId: item.row.booking_id,
                          })
                        }
                      />
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <ConfirmDialog
        isOpen={Boolean(pending)}
        title="Cancel this reservation?"
        description="This releases the reservation and cannot be undone."
        confirmLabel="Cancel reservation"
        variant="danger"
        onCancel={() => setPending(null)}
        onConfirm={() => void runPending()}
      />
    </div>
  );
}

function bookingGroup(item: BookingItem): BookingGroup {
  if (item.kind === "housing") {
    const status = String(item.row.status || "");
    const rentPaid = ["paid", "upfront_paid"].includes(
      String(item.row.rent_payment_status || ""),
    );
    if (
      status === "payment_pending" ||
      status === "payment_conflict" ||
      (status === "reserved" && !rentPaid) ||
      (status === "ready_for_move_in" &&
        (!rentPaid || !item.row.requested_move_in_at))
    )
      return "action";
    if (["completed", "cancelled", "expired", "refunded"].includes(status))
      return "history";
    return "active";
  }
  if (item.kind === "hotel") {
    const status = String(item.row.status || "");
    const payment = String(item.row.payment_status || "");
    if (
      status === "payment_conflict" ||
      (status === "pending" &&
        ["unpaid", "payment_pending", "failed"].includes(payment))
    )
      return "action";
    if (
      ["checked_out", "completed", "cancelled", "expired", "refunded"].includes(
        status,
      )
    )
      return "history";
    return "active";
  }
  const status = String(item.row.booking_status || "");
  if (["waiting_payment", "completed_pending_approval"].includes(status))
    return "action";
  if (["approved_released", "cancelled", "refunded"].includes(status))
    return "history";
  return "active";
}

function BookingSourceNotice({
  errors,
  retry,
}: {
  errors: BookingSourceErrors;
  retry: () => void;
}) {
  const labels = [
    errors.housing && "apartments",
    errors.hotels && "hotels",
    errors.services && "WeHouse Services",
  ].filter(Boolean);
  return (
    <div
      className="flex items-center justify-between gap-3 border-y border-amber-500/15 py-3"
      role="status"
    >
      <div>
        <p className="text-[10px] font-semibold text-amber-200">
          {labels.join(", ")} {labels.length === 1 ? "needs" : "need"} a refresh
        </p>
        <p className="mt-1 text-[9px] text-[#8E8375]">
          Any booking already loaded stays visible.
        </p>
      </div>
      <button
        type="button"
        onClick={retry}
        className="min-h-9 shrink-0 px-3 text-[9px] font-semibold text-amber-200"
      >
        Try again
      </button>
    </div>
  );
}

function ServiceCard({ row, onOpen }: { row: any; onOpen: () => void }) {
  const status = BOOKING_STATUS_LABELS[row.booking_status];
  const amount = Number(row.negotiated_amount || 0);
  return (
    <BookingCard
      eyebrow="WeHouse Service"
      title={row.service_type || "Service request"}
      subtitle={row.other_person_name || "WeHouse professional"}
      status={status?.label || "Status unavailable"}
      image={null}
      fallback="⌁"
      meta={amount > 0 ? [money(amount)] : []}
      next={serviceNextAction(row.booking_status)}
      onOpen={onOpen}
    />
  );
}

function serviceNextAction(status: string) {
  const labels: Record<string, string> = {
    booking_requested: "Waiting for the professional to respond",
    negotiating: "Agree the work, date and price",
    waiting_payment: "Approve and pay the agreed price",
    confirmed: "Payment secured · waiting to start",
    in_progress: "Work is in progress",
    completed_pending_approval: "Review the completed work",
    approved_released: "Completed",
    disputed: "WeHouse review in progress",
    cancelled: "Cancelled",
    refunded: "Refunded",
  };
  return labels[status] || "Open for the next action";
}

function HousingCard({ row, onOpen }: { row: any; onOpen: () => void }) {
  const short = row.stay_type === "short_let";
  const rentPaid = ["paid", "upfront_paid"].includes(
    String(row.rent_payment_status || ""),
  );
  const journey = getPropertyBookingJourney(row);
  const visibleStatus = propertyBookingStatusLabel(row);
  const nextSummary =
    row.status === "occupied"
      ? short
        ? `Checkout ${date(row.check_out_date)}`
        : `Ends ${date(row.tenancy_end_date)}`
      : row.status === "payment_pending"
        ? "Finish your reservation"
        : row.status === "reserved" && !rentPaid
          ? row.rent_payment_status === "payment_pending"
            ? short
              ? "Finish stay payment"
              : "Finish Year 1 rent payment"
            : short
              ? "Pay for your stay"
              : "Choose inspection or Year 1 rent"
          : row.status === "inspection_pending"
            ? "WeHouse is reviewing the apartment"
            : row.status === "ready_for_move_in" && rentPaid
              ? row.requested_move_in_at
                ? `Meet WeHouse ${new Date(
                    row.requested_move_in_at,
                  ).toLocaleString()} for handover`
                : journey.title
              : row.status === "ready_for_move_in"
                ? short
                  ? "Stay payment required"
                  : "Rent payment required"
                : null;
  const dates =
    short && row.stay_check_in
      ? [`${date(row.stay_check_in)} → ${date(row.stay_check_out)}`]
      : row.tenancy_end_date
        ? [`Until ${date(row.tenancy_end_date)}`]
        : [];
  return (
    <BookingCard
      eyebrow={short ? "Short Let" : "Long Let"}
      title={row.listing_title || "Apartment reservation"}
      subtitle={row.listing_location || "WeHouse apartment"}
      status={visibleStatus}
      image={row.listing_image || null}
      fallback="⌂"
      meta={dates}
      next={nextSummary || journey.title}
      onOpen={onOpen}
    />
  );
}

function HotelCard({ row, onOpen }: { row: any; onOpen: () => void }) {
  const visibleStatus =
    HOTEL_STATUS[String(row.status || "")] || "Status unavailable";
  const hotel = row.hotels || row.hotel || {};
  const room = row.hotel_rooms || {};
  const checkIn = `${date(row.check_in_date || row.check_in)} from ${formatStayTime(
    hotel.check_in_time,
    "14:00",
  )}`;
  const checkOut = `${date(row.check_out_date || row.check_out)} by ${formatStayTime(
    hotel.check_out_time,
    "12:00",
  )}`;
  const image = room.images?.[0] || hotel.images?.[0] || null;
  const next =
    row.status === "pending"
      ? "Complete secure payment to confirm this stay"
      : row.status === "confirmed"
        ? `Arrive from ${formatStayTime(hotel.check_in_time, "14:00")}`
        : row.status === "checked_in"
          ? `Checkout by ${formatStayTime(hotel.check_out_time, "12:00")}`
          : "Open the stay record";
  return (
    <BookingCard
      eyebrow="Hotel"
      title={hotel.name || row.hotel_name || "Hotel reservation"}
      subtitle={room.room_type || row.room_name || row.rate_plan_name || "Hotel room"}
      status={visibleStatus}
      image={image}
      fallback="H"
      meta={[checkIn, checkOut]}
      next={next}
      onOpen={onOpen}
    />
  );
}

function BookingCard({
  eyebrow,
  title,
  subtitle,
  status,
  image,
  fallback,
  meta,
  next,
  onOpen,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  status: string;
  image: string | null;
  fallback: string;
  meta: string[];
  next: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 py-3.5 text-left active:bg-white/[.025]"
    >
      {image ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-14 w-16 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <div className="grid h-14 w-16 shrink-0 place-items-center rounded-xl bg-violet-500/[.08] text-base font-bold text-violet-300">
          {fallback}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            {title}
          </p>
          <span className="shrink-0 text-[8px] font-semibold text-[#8A90A0]">
            {status}
          </span>
        </div>
        <p className="mt-1 truncate text-[10px] text-[#73798A]">
          {subtitle}
        </p>
        {meta.length ? (
          <p className="mt-1.5 truncate text-[8px] text-[#62697A]">
            {meta.join(" · ")}
          </p>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <span className="shrink-0 text-[7px] font-bold uppercase tracking-[.12em] text-violet-300">
            {eyebrow}
          </span>
          <span className="truncate text-[8px] text-[#777D8D]">{next}</span>
        </div>
      </div>
      <span className="shrink-0 text-lg text-[#555C6D]">›</span>
    </button>
  );
}

function formatStayTime(value: unknown, fallback: string) {
  const match = String(value || fallback).match(/^(\d{2}):(\d{2})/);
  const [hour, minute] = match ? [Number(match[1]), match[2]] : [0, "00"];
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function PropertyBookingDetail({
  row,
  inspection,
  busy,
  onBack,
  onDesk,
  onResume,
  onCancel,
  onInspect,
  onRent,
  onMoveIn,
}: {
  row: any;
  inspection: any;
  busy: boolean;
  onBack: () => void;
  onDesk: () => void;
  onResume: () => void;
  onCancel: () => void;
  onInspect: () => void;
  onRent: () => void;
  onMoveIn: (requestedAt: string) => void;
}) {
  const short = row.stay_type === "short_let";
  const status = propertyBookingStatusLabel(row);
  const title =
    row.status === "occupied"
      ? short
        ? "Current Short Let"
        : "Your tenancy"
      : short
        ? "Short Let"
        : "Long Let";
  const journey = getPropertyBookingJourney(row, inspection);
  const recordCode =
    Boolean(row.booking_code) &&
    journey.rentPaid &&
    ["handover", "tenancy", "completed"].includes(journey.action);
  const rentAmount = Number(
    short
      ? Number(row.stay_rent_total || 0) +
          Number(row.security_deposit_snapshot || 0)
      : row.upfront_rent_required ||
          row.annual_rent_snapshot ||
          row.listing_price ||
          0,
  );
  const earliestMoveIn = toLocalDateTimeInput(
    new Date(Date.now() + 5 * 60_000),
  );
  const latestMoveIn = toLocalDateTimeInput(
    new Date(Date.now() + 3 * 86_400_000),
  );
  const [moveInAt, setMoveInAt] = useState(
    row.requested_move_in_at
      ? toLocalDateTimeInput(new Date(row.requested_move_in_at))
      : earliestMoveIn,
  );
  const helpRelevant =
    row.status === "payment_conflict" ||
    row.rent_payment_status === "payment_conflict" ||
    (journey.rentPaid && ["handover", "tenancy"].includes(journey.action));

  return (
    <BookingDetailShell title={title} onBack={onBack}>
      <section className="overflow-hidden border-y border-white/[.07] bg-[#11141C]">
        {row.listing_image ? (
          <img
            src={row.listing_image}
            alt={row.listing_title || "Apartment"}
            loading="lazy"
            decoding="async"
            className="aspect-[16/9] w-full object-cover"
          />
        ) : null}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-violet-300">
                {short ? "Short Let" : "Long Let"}
              </p>
              <h1 className="mt-1 break-words text-xl font-bold">
                {row.listing_title || "Apartment booking"}
              </h1>
              <p className="mt-1 text-[10px] leading-4 text-[#777D8E]">
                {row.listing_location ||
                  row.listing_address ||
                  [row.listing_city, row.listing_state].filter(Boolean).join(", ") ||
                  "Area unavailable"}
              </p>
            </div>
            <span className="shrink-0 text-[9px] font-semibold text-violet-200">
              {status}
            </span>
          </div>

          {recordCode ? (
            <p className="mt-4 text-[9px] text-[#777D8E]">
              Move-in code{" "}
              <span className="font-bold tracking-wide text-violet-300">
                {row.booking_code}
              </span>
            </p>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-x-3">
            <Info
              label="Reservation fee"
              value={journey.feePaid ? `Paid · ${money(row.amount)}` : money(row.amount)}
            />
            <Info
              label={short ? "Stay payment" : "Year 1 rent"}
              value={
                journey.rentPaid
                  ? "Paid"
                  : row.rent_payment_status === "payment_pending"
                    ? "Payment started"
                    : "Not paid"
              }
            />
            {short ? (
              <>
                <Info label="Check-in" value={date(row.stay_check_in)} />
                <Info label="Check-out" value={date(row.stay_check_out)} />
              </>
            ) : (
              <>
                <Info
                  label="Tenure"
                  value={`${Number(row.rental_plan_years || 1)} year${
                    Number(row.rental_plan_years || 1) === 1 ? "" : "s"
                  }`}
                />
                <Info label="Year 1 rent" value={money(rentAmount)} />
              </>
            )}
          </div>

          {row.hold_expires_at &&
          !journey.rentPaid &&
          !["occupied", "completed"].includes(row.status) ? (
            <p className="mt-3 text-[9px] text-amber-300">
              Reservation hold until {new Date(row.hold_expires_at).toLocaleString()}
            </p>
          ) : null}

          <PropertyBookingJourney row={row} inspection={inspection} />

          {journey.action === "reservation_payment" ? (
            <div className="mt-5 grid gap-2">
              <button type="button" disabled={busy} onClick={onResume} className="min-h-12 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50">
                {busy ? "Opening secure payment…" : "Pay reservation fee"}
              </button>
              <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 w-full rounded-xl border border-red-500/15 text-xs font-semibold text-red-300 disabled:opacity-50">
                Cancel reservation
              </button>
            </div>
          ) : null}

          {journey.action === "choose_inspection_or_rent" ? (
            <section className="mt-5">
              <p className="text-xs font-semibold">Choose one next step</p>
              <p className="mt-1 text-[9px] leading-4 text-[#727889]">
                An inspection is optional. If you request it, rent waits until the visit is completed.
              </p>
              <button type="button" disabled={busy} onClick={onInspect} className="mt-3 min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50">
                {busy ? "Sending request…" : "Request apartment inspection"}
              </button>
              <button type="button" disabled={busy} onClick={onRent} className="mt-2 min-h-11 w-full rounded-xl border border-emerald-500/25 bg-emerald-500/[.06] text-xs font-semibold text-emerald-300 disabled:opacity-50">
                {busy ? "Opening secure payment…" : `Proceed with Year 1 rent · ${money(rentAmount)}`}
              </button>
            </section>
          ) : null}

          {journey.action === "rent_payment" ? (
            <button type="button" disabled={busy} onClick={onRent} className="mt-5 min-h-12 w-full rounded-xl bg-emerald-500 text-xs font-semibold text-[#03100B] disabled:opacity-50">
              {busy
                ? "Checking payment…"
                : row.rent_payment_status === "payment_pending"
                  ? short
                    ? "Check or continue stay payment"
                    : "Check Year 1 rent payment"
                  : short
                    ? `Pay stay and deposit · ${money(rentAmount)}`
                    : `Pay Year 1 rent · ${money(rentAmount)}`}
            </button>
          ) : null}

          {journey.action === "move_in_request" ? (
            <section className="mt-5 rounded-2xl border border-violet-500/15 bg-violet-500/[.035] p-4">
              <p className="text-xs font-semibold">Choose your move-in time</p>
              <p className="mt-1 text-[9px] leading-4 text-[#777D8E]">
                Choose a time within the next 3 days. Paying rent does not start the tenancy; verified handover does.
              </p>
              <input type="datetime-local" min={earliestMoveIn} max={latestMoveIn} value={moveInAt} onChange={(event) => setMoveInAt(event.target.value)} className="mt-3 h-11 w-full rounded-xl border border-white/[.08] bg-[#151923] px-3 text-xs" />
              <button type="button" disabled={busy || !moveInAt} onClick={() => onMoveIn(moveInAt)} className="mt-3 min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50">
                {busy ? "Saving move-in time…" : "Send move-in time"}
              </button>
            </section>
          ) : null}

          {journey.action === "handover" && row.booking_code ? (
            <div className="mt-5 border-y border-emerald-500/20 bg-emerald-500/[.035] py-4 text-center">
              <p className="text-[8px] uppercase tracking-[.16em] text-emerald-300">
                Show Property Operations
              </p>
              <p className="mt-2 text-xl font-bold tracking-[.14em]">
                {row.booking_code}
              </p>
              <p className="mx-auto mt-2 max-w-sm text-[9px] leading-4 text-[#7C887F]">
                Access is handed over only after the code, property, identity and payment match.
              </p>
            </div>
          ) : null}

          {helpRelevant ? (
            <button type="button" onClick={onDesk} className="mt-4 min-h-11 w-full border-t border-white/[.08] pt-4 text-xs font-semibold text-violet-300">
              Get help from WeHouse
            </button>
          ) : null}
        </div>
      </section>
    </BookingDetailShell>
  );
}

function toLocalDateTimeInput(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function HotelBookingDetail({
  row,
  busy,
  onBack,
  onDesk,
  onHotel,
  onPay,
  onCancel,
}: {
  row: any;
  busy: boolean;
  onBack: () => void;
  onDesk: () => void;
  onHotel: () => void;
  onPay: () => void;
  onCancel: () => void;
}) {
  const name =
    row.hotels?.name || row.hotel?.name || row.hotel_name || "Hotel stay";
  const status = HOTEL_STATUS[String(row.status || "")] || "Status unavailable";
  const room =
    row.hotel_rooms?.room_type ||
    row.hotel_rooms?.name ||
    row.room_name ||
    "Room details unavailable";
  const packageName =
    row.rate_plan_name || row.hotel_rate_plans?.name || "Room package";
  const hotelAddress = row.hotels?.address || null;
  const hotelLatitude = Number(row.hotels?.gps_latitude);
  const hotelLongitude = Number(row.hotels?.gps_longitude);
  const exactDestination =
    row.hotels?.location_exact === true &&
    Number.isFinite(hotelLatitude) &&
    Number.isFinite(hotelLongitude);
  const journeyStatus =
    row.status === "checked_out" ? "completed" : String(row.status || "");
  const stages = ["pending", "confirmed", "checked_in", "completed"];
  const current = Math.max(0, stages.indexOf(journeyStatus));
  const stopped = ["cancelled", "expired", "refunded", "payment_conflict"].includes(
    journeyStatus,
  );
  const roomImage = row.hotel_rooms?.images?.[0] || row.hotels?.images?.[0] || null;
  const showCode =
    Boolean(row.booking_code) &&
    String(row.payment_status) === "paid" &&
    ["confirmed", "checked_in"].includes(journeyStatus);
  const hotelChatOpen =
    String(row.payment_status) === "paid" &&
    ["confirmed", "checked_in"].includes(journeyStatus);
  const helpRelevant =
    journeyStatus === "payment_conflict" ||
    (String(row.payment_status) === "paid" &&
      ["confirmed", "checked_in", "cancelled", "refunded"].includes(journeyStatus));
  const next =
    journeyStatus === "pending"
      ? "Complete secure payment to confirm the room."
      : journeyStatus === "confirmed"
        ? "Your room is confirmed. Contact the hotel for normal stay arrangements."
        : journeyStatus === "checked_in"
          ? "Your stay is in progress."
          : journeyStatus === "completed"
            ? "Stay completed. You can leave a verified hotel review."
            : journeyStatus === "payment_conflict"
              ? "Payment needs WeHouse review."
              : stopped
                ? "This stay is no longer active."
                : "Open this booking for its latest state.";

  return (
    <BookingDetailShell title="Hotel booking" onBack={onBack}>
      <section className="overflow-hidden border-y border-white/[.07] bg-[#11141C]">
        {roomImage ? (
          <img
            src={roomImage}
            alt={`${room} at ${name}`}
            loading="lazy"
            decoding="async"
            className="aspect-[16/10] w-full object-cover"
          />
        ) : null}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wide text-amber-300">
                Hotel
              </p>
              <h1 className="mt-1 text-xl font-bold">{name}</h1>
              <p className="mt-1 text-[10px] text-[#777D8E]">
                {room} · {packageName}
              </p>
              {hotelAddress ? (
                <p className="mt-1 text-[10px] leading-4 text-[#777D8E]">
                  {hotelAddress}
                </p>
              ) : null}
            </div>
            <span className="text-[9px] font-semibold text-amber-200">
              {status}
            </span>
          </div>

          {showCode ? (
            <div className="mt-4 border-y border-violet-500/20 bg-violet-500/[.04] py-3">
              <p className="text-[8px] uppercase tracking-wide text-[#777D8E]">
                Check-in code
              </p>
              <p className="mt-1 text-lg font-bold tracking-[.12em] text-violet-200">
                {row.booking_code}
              </p>
              <p className="mt-1 text-[8px] text-[#777D8E]">
                Show this only to authorized hotel staff at arrival.
              </p>
            </div>
          ) : null}

          {exactDestination ? (
            <a
              href={directionsUrl(hotelLatitude, hotelLongitude)}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex min-h-11 items-center justify-center border-y border-violet-500/20 text-[10px] font-semibold text-violet-300"
            >
              Open road directions
            </a>
          ) : null}

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Info
              label="Check-in"
              value={`${date(row.check_in_date || row.check_in)} from ${formatStayTime(
                row.hotels?.check_in_time || row.hotel?.check_in_time,
                "14:00",
              )}`}
            />
            <Info
              label="Check-out"
              value={`${date(row.check_out_date || row.check_out)} by ${formatStayTime(
                row.hotels?.check_out_time || row.hotel?.check_out_time,
                "12:00",
              )}`}
            />
            <Info label="Guests" value={String(row.guest_count || "—")} />
            <Info label="Payment" value={hotelPaymentLabel(row.payment_status)} />
            <Info label="Room" value={room} />
            <Info label="Package" value={packageName} />
          </div>

          <div className="mt-5">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-[#777D8E]">
              Stay journey
            </p>
            <div className="mt-3 grid grid-cols-4 gap-1">
              {[
                ["pending", "Payment"],
                ["confirmed", "Confirmed"],
                ["checked_in", "Checked in"],
                ["completed", "Completed"],
              ].map(([id, label], index) => (
                <div key={id} className="text-center">
                  <div
                    className={`mx-auto grid h-7 w-7 place-items-center rounded-full text-[9px] font-bold ${
                      !stopped && index <= current
                        ? "bg-violet-500 text-white"
                        : "bg-white/[.05] text-[#686E7E]"
                    }`}
                  >
                    {!stopped && index < current ? "✓" : index + 1}
                  </div>
                  <p
                    className={`mt-1 text-[8px] ${
                      !stopped && index <= current
                        ? "text-violet-300"
                        : "text-[#626879]"
                    }`}
                  >
                    {label}
                  </p>
                </div>
              ))}
            </div>
            <p
              className={`mt-3 px-1 py-2 text-[9px] leading-5 ${
                stopped ? "text-amber-200" : "text-[#A5A9B5]"
              }`}
            >
              {next}
            </p>
          </div>

          {(row.total_price || row.total_amount || row.amount) != null ? (
            <p className="mt-4 text-base font-bold">
              {money(row.total_price || row.total_amount || row.amount)}
            </p>
          ) : null}

          {row.status === "pending" &&
          ["unpaid", "payment_pending", "failed"].includes(
            String(row.payment_status),
          ) ? (
            <>
              <button type="button" disabled={busy} onClick={onPay} className="mt-5 min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">
                {busy ? "Opening payment…" : "Pay securely"}
              </button>
              <button type="button" disabled={busy} onClick={onCancel} className="mt-2 min-h-11 w-full rounded-xl border border-red-500/15 text-xs font-semibold text-red-300 disabled:opacity-40">
                Cancel reservation
              </button>
            </>
          ) : null}

          {hotelChatOpen ? (
            <button type="button" onClick={onHotel} className="mt-3 min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold">
              Message hotel
            </button>
          ) : null}

          {helpRelevant ? (
            <button type="button" onClick={onDesk} className="mt-3 min-h-11 w-full border-t border-white/[.08] pt-3 text-xs font-semibold text-violet-300">
              Get help from WeHouse
            </button>
          ) : null}
        </div>
      </section>
    </BookingDetailShell>
  );
}

function BookingDetailShell({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("wehouse:nested-screen", { detail: { open: true } }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("wehouse:nested-screen", { detail: { open: false } }),
      );
    };
  }, []);
  return (
    <div className="min-h-[100dvh] bg-[#090B10] text-white">
      <header className="sticky top-0 z-40 flex min-h-16 items-center gap-3 border-b border-white/[.06] bg-[#090B10]/95 px-4 backdrop-blur-xl">
        <BackButton onClick={onBack} />
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-400">
            Bookings
          </p>
          <h1 className="text-sm font-semibold">{title}</h1>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-4 sm:p-6">{children}</main>
    </div>
  );
}

function hotelPaymentLabel(value: any) {
  const labels: Record<string, string> = {
    unpaid: "Not paid",
    payment_pending: "Payment pending",
    paid: "Paid",
    refunded: "Refunded",
    failed: "Payment failed",
    expired: "Payment expired",
  };
  return labels[String(value || "")] || "Not available";
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-white/[.05] py-2.5">
      <p className="text-[8px] uppercase text-[#5D6272]">{label}</p>
      <p className="mt-1 truncate text-[10px] font-semibold text-[#C5C8D1]">
        {value}
      </p>
    </div>
  );
}

function Loading() {
  return (
    <div className="grid min-h-56 place-items-center">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
    </div>
  );
}

function Empty({ view, statusView }: { view: View; statusView: StatusView }) {
  const label =
    view === "housing"
      ? "apartment bookings"
      : view === "hotels"
        ? "hotel stays"
        : view === "services"
          ? "WeHouse Services bookings"
          : "bookings";
  return (
    <div className="border-y border-white/[.07] px-5 py-14 text-center">
      <p className="text-sm font-semibold">
        {statusView === "all"
          ? `No ${label} yet`
          : "No bookings match these filters"}
      </p>
      <p className="mt-2 text-[10px] text-[#707788]">
        {statusView === "all"
          ? "New records appear here automatically with their current next step."
          : "Choose another status or booking type to see more records."}
      </p>
    </div>
  );
}
