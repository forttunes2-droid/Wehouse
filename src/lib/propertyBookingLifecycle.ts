export type PropertyJourneyAudience = "customer" | "operations";
export type PropertyJourneyState = "complete" | "current" | "upcoming" | "stopped";
export type PropertyJourneyAction =
  | "reservation_payment"
  | "choose_inspection_or_rent"
  | "inspection"
  | "rent_payment"
  | "move_in_request"
  | "handover"
  | "tenancy"
  | "completed"
  | "stopped";

export type PropertyJourneyStep = {
  id: string;
  label: string;
  detail: string;
  state: PropertyJourneyState;
  optional?: boolean;
};

export type PropertyJourney = {
  action: PropertyJourneyAction;
  title: string;
  detail: string;
  steps: PropertyJourneyStep[];
  feePaid: boolean;
  rentPaid: boolean;
  inspectionStatus: string | null;
};

const COMPLETE_STATUSES = new Set(["paid", "completed"]);
const RENT_PAID_STATUSES = new Set(["paid", "upfront_paid"]);
const ACTIVE_INSPECTION_STATUSES = new Set([
  "pending",
  "scheduled",
  "in_progress",
]);
const STOPPED_STATUSES = new Set([
  "cancelled",
  "expired",
  "refunded",
  "payment_conflict",
]);

function complete(label: string, detail: string, optional = false): PropertyJourneyStep {
  return { id: label, label, detail, state: "complete", optional };
}
function current(label: string, detail: string, optional = false): PropertyJourneyStep {
  return { id: label, label, detail, state: "current", optional };
}
function upcoming(label: string, detail: string, optional = false): PropertyJourneyStep {
  return { id: label, label, detail, state: "upcoming", optional };
}

function inspectionLabel(status: string | null) {
  if (status === "scheduled") return "Visit scheduled";
  if (status === "in_progress") return "Visit in progress";
  if (status === "completed") return "Inspection completed";
  return "Inspection requested";
}

export function getPropertyBookingJourney(
  row: Record<string, any>,
  inspection?: Record<string, any> | null,
  audience: PropertyJourneyAudience = "customer",
): PropertyJourney {
  const status = String(row.status || row.reservation_status || "payment_pending");
  const shortStay = String(row.stay_type || row._stayKind || "long_stay") === "short_let";
  const feePaid = Boolean(row.paid_at || row.reservation_fee_paid) &&
    COMPLETE_STATUSES.has(String(row.manual_payment_status || "paid"));
  const rentStatus = String(row.rent_payment_status || row.payment_status || "not_started");
  const rentPaid = RENT_PAID_STATUSES.has(rentStatus);
  const inspectionStatus = inspection?.status
    ? String(inspection.status)
    : status === "inspection_pending"
      ? "pending"
      : row.inspection_completed
        ? "completed"
        : null;
  const inspectionActive = ACTIVE_INSPECTION_STATUSES.has(inspectionStatus || "");
  const inspectionComplete = inspectionStatus === "completed" || Boolean(row.inspection_completed);
  const stopped = STOPPED_STATUSES.has(status);
  const reservationStep = feePaid
    ? complete("Reservation fee", "Paid · this confirmed the booking; it was not rent.")
    : status === "payment_pending"
      ? current("Reservation fee", "Complete the fee to reserve this property.")
      : upcoming("Reservation fee", "Payment confirmation is unavailable.");

  if (stopped) {
    return {
      action: "stopped",
      title: status === "payment_conflict" ? "Payment needs review" : `Booking ${status.replace(/_/g, " ")}`,
      detail: audience === "customer"
        ? "No further property action is available from this record. Message WeHouse if you need help."
        : "This record cannot continue until its stopped or payment-review state is resolved.",
      steps: [reservationStep, {
        id: "stopped",
        label: "Journey stopped",
        detail: status.replace(/_/g, " "),
        state: "stopped",
      }],
      feePaid,
      rentPaid,
      inspectionStatus,
    };
  }

  if (shortStay) {
    const paymentStep = rentPaid
      ? complete("Stay payment", "Stay rent and the refundable deposit are confirmed.")
      : feePaid
        ? current("Stay payment", rentStatus === "payment_pending" ? "Secure checkout started; payment is not confirmed yet." : "Pay the stay rent and refundable deposit.")
        : upcoming("Stay payment", "Available after the reservation fee is confirmed.");
    const arrivalStep = status === "occupied" || status === "completed"
      ? complete("Check-in", "Access was handed over and entry was recorded.")
      : status === "ready_for_move_in" && rentPaid
        ? current("Check-in", "Property Operations verifies the booking code at arrival.")
        : upcoming("Check-in", "Available after full stay payment.");
    const stayStep = status === "completed"
      ? complete("Stay", "The reserved stay has ended.")
      : status === "occupied"
        ? current("Stay", "The Short Let is currently active.")
        : upcoming("Stay", "Starts after check-in.");
    const finishStep = status === "completed"
      ? complete("Checkout", "Stay completed.")
      : upcoming("Checkout", "Property Operations closes the stay after departure.");
    const action: PropertyJourneyAction = status === "completed"
      ? "completed"
      : status === "occupied"
        ? "tenancy"
        : !feePaid
          ? "reservation_payment"
          : !rentPaid
            ? "rent_payment"
            : status === "ready_for_move_in"
              ? "handover"
              : "rent_payment";
    const copy = shortStayCopy(action, audience, rentStatus);
    return {
      action,
      ...copy,
      steps: [reservationStep, paymentStep, arrivalStep, stayStep, finishStep],
      feePaid,
      rentPaid,
      inspectionStatus,
    };
  }

  let action: PropertyJourneyAction;
  if (!feePaid || status === "payment_pending") action = "reservation_payment";
  else if (inspectionActive) action = "inspection";
  else if (rentPaid && status === "ready_for_move_in")
    action = row.requested_move_in_at ? "handover" : "move_in_request";
  else if (status === "occupied") action = "tenancy";
  else if (status === "completed") action = "completed";
  else if (rentStatus === "payment_pending" || status === "ready_for_move_in") action = "rent_payment";
  else action = "choose_inspection_or_rent";

  const inspectionStep = inspectionActive
    ? current("Apartment inspection", inspectionLabel(inspectionStatus), true)
    : inspectionComplete
      ? complete("Apartment inspection", "Visit completed.", true)
      : rentStatus !== "not_started" || rentPaid || status === "ready_for_move_in" || status === "occupied" || status === "completed"
        ? complete("Apartment inspection", "Not requested · customer continued directly to rent.", true)
        : feePaid
          ? current("Choose next step", "Request an inspection, or continue directly to Year 1 rent.")
          : upcoming("Choose next step", "Available after the reservation fee.");
  const rentStep = rentPaid
    ? complete("Year 1 rent", "Required move-in rent is confirmed.")
    : action === "rent_payment"
      ? current("Year 1 rent", rentStatus === "payment_pending" ? "Secure checkout started; payment is not confirmed yet." : "The required Year 1 rent is ready for payment.")
      : upcoming("Year 1 rent", inspectionActive ? "Available after the requested inspection is completed." : "Required before handover.");
  const handoverStep = status === "occupied" || status === "completed"
    ? complete("Property handover", "Booking code verified and access handed over.")
    : action === "handover"
      ? current("Property handover", "Property Operations verifies the move-in code at the requested arrival time before giving access.")
      : upcoming("Property handover", action === "move_in_request" ? "Available after you choose a move-in time." : "Available after Year 1 rent is confirmed.");
  const arrivalStep = status === "occupied" || status === "completed"
    ? complete("Move-in time", "Arrival was completed with the verified handover.")
    : row.requested_move_in_at
      ? complete("Move-in time", `Requested for ${new Date(row.requested_move_in_at).toLocaleString()}.`)
      : action === "move_in_request"
        ? current("Move-in time", "Choose when you can meet Property Operations within the next 3 days.")
        : upcoming("Move-in time", "Available after Year 1 rent is confirmed.");
  const tenancyStep = status === "completed"
    ? complete("Tenancy", "Tenancy completed.")
    : status === "occupied"
      ? current("Tenancy", "The tenancy is active.")
      : upcoming("Tenancy", "Starts after verified handover.");
  const copy = longStayCopy(action, audience, rentStatus, inspectionStatus);
  return {
    action,
    ...copy,
    steps: [reservationStep, inspectionStep, rentStep, arrivalStep, handoverStep, tenancyStep],
    feePaid,
    rentPaid,
    inspectionStatus,
  };
}

export function propertyBookingStatusLabel(row: Record<string, any>) {
  const status = String(row.status || row.reservation_status || "payment_pending");
  const shortStay = String(row.stay_type || row._stayKind || "long_stay") === "short_let";
  const rentPaid = RENT_PAID_STATUSES.has(
    String(row.rent_payment_status || row.payment_status || "not_started"),
  );

  if (status === "ready_for_move_in") {
    if (shortStay) return rentPaid ? "Ready for check-in" : "Stay payment required";
    if (!rentPaid) return "Year 1 rent required";
    return row.requested_move_in_at ? "Move-in scheduled" : "Choose move-in time";
  }
  if (status === "occupied") return shortStay ? "Checked in" : "Tenancy active";
  if (status === "completed") return shortStay ? "Stay completed" : "Tenancy completed";
  if (status === "inspection_pending") return "Inspection in progress";
  if (status === "payment_pending") return "Reservation payment pending";
  if (status === "payment_conflict") return "Payment needs review";
  if (status === "reserved") return "Reserved";
  if (status === "cancelled") return "Cancelled";
  if (status === "expired") return "Expired";
  if (status === "refunded") return "Refunded";
  return "Status unavailable";
}

function longStayCopy(
  action: PropertyJourneyAction,
  audience: PropertyJourneyAudience,
  rentStatus: string,
  inspectionStatus: string | null,
) {
  const operations = audience === "operations";
  if (action === "reservation_payment") return {
    title: operations ? "Waiting for reservation payment" : "Complete your reservation",
    detail: operations ? "Do not start inspection, rent or handover until the reservation fee is confirmed." : "Pay the reservation fee first. It confirms the booking but does not pay the rent.",
  };
  if (action === "choose_inspection_or_rent") return {
    title: operations ? "Customer is choosing the next step" : "Choose what happens next",
    detail: operations ? "The property is reserved. The customer can request a Field Operations inspection or continue directly to Year 1 rent." : "Inspect the apartment first, or continue directly to Year 1 rent if you are satisfied with it.",
  };
  if (action === "inspection") return {
    title: operations ? "Complete the requested inspection" : "Inspection is in progress",
    detail: operations ? `Continue the assigned Field Operations visit (${inspectionStatus || "pending"}). Rent remains blocked until the inspection finishes.` : "WeHouse will update this booking when the assigned Field Operations visit is completed. You do not need to pay rent while it is in progress.",
  };
  if (action === "rent_payment") return {
    title: operations ? "Waiting for verified Year 1 rent" : rentStatus === "payment_pending" ? "Finish Year 1 rent payment" : "Pay the required Year 1 rent",
    detail: operations ? "Do not hand over access until the payment is verified and the booking becomes ready for move-in." : "Year 1 rent is required before Property Operations can hand over the apartment.",
  };
  if (action === "move_in_request") return {
    title: operations ? "Waiting for the customer’s move-in time" : "Choose your move-in time",
    detail: operations ? "Year 1 rent is verified. The customer must choose an arrival time before handover can be confirmed." : "Your rent is confirmed, but your tenancy has not started. Choose a time within the next 3 days to meet Property Operations for handover.",
  };
  if (action === "handover") return {
    title: operations ? "Verify code and hand over access" : "Move-in requested · awaiting handover",
    detail: operations ? "Match the move-in code, customer, property, verified rent and requested time before handing over access and activating the tenancy." : "Your rent is paid, but your tenancy starts only when Property Operations hands over access and verifies your move-in code.",
  };
  if (action === "tenancy") return {
    title: "Tenancy active",
    detail: operations ? "The property is occupied. Complete the tenancy only after the customer moves out." : "Your move-in is confirmed and the tenancy dates are active.",
  };
  return { title: "Tenancy completed", detail: "The reservation, rent, handover and tenancy history remain attached to this booking." };
}

function shortStayCopy(
  action: PropertyJourneyAction,
  audience: PropertyJourneyAudience,
  rentStatus: string,
) {
  const operations = audience === "operations";
  if (action === "reservation_payment") return { title: "Complete the reservation", detail: "The preliminary reservation fee must be confirmed before the stay payment." };
  if (action === "rent_payment") return {
    title: operations ? "Waiting for full stay payment" : rentStatus === "payment_pending" ? "Finish stay payment" : "Pay for the Short Let",
    detail: operations ? "Do not check the guest in until stay rent and the refundable deposit are verified." : "Pay the stay rent and refundable deposit before arrival.",
  };
  if (action === "handover") return {
    title: operations ? "Verify code and check the guest in" : "Ready for check-in",
    detail: operations ? "Confirm the booking code and reserved dates before handing over access." : "Show the booking code to Property Operations during the reserved check-in period.",
  };
  if (action === "tenancy") return { title: "Stay in progress", detail: "The Short Let is active until the recorded checkout date." };
  return { title: "Stay completed", detail: "The booking and any refundable-deposit review remain attached to this record." };
}
