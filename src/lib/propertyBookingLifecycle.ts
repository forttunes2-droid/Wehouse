import { displayDate, displayDateTimeAtProperty } from "./displayDate";
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
const ACTIVE_INSPECTION_STATUSES = new Set(["pending", "scheduled", "in_progress"]);
const STOPPED_STATUSES = new Set(["cancelled", "expired", "refunded", "payment_conflict"]);

export function hasProtectedAccommodationPayment(row: Record<string, any>) {
  const shortStay = String(row.stay_type || row._stayKind || "long_stay") === "short_let";
  const protectionId = shortStay
    ? row.stay_payment_protection_id
    : row.year_one_rent_protection_id;
  return (
    RENT_PAID_STATUSES.has(String(row.rent_payment_status || row.payment_status || "not_started")) &&
    Boolean(row.rent_paid_at) &&
    Boolean(protectionId)
  );
}

export function hasUnprotectedPaidAccommodation(row: Record<string, any>) {
  const rentStatus = String(row.rent_payment_status || row.payment_status || "not_started");
  return (
    RENT_PAID_STATUSES.has(rentStatus) &&
    !hasProtectedAccommodationPayment(row)
  );
}

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
  if (status === "completed") return "Viewing completed";
  return "Viewing requested";
}

function shortLetHasCaution(row: Record<string, any>) {
  return Number(
    row.security_deposit_amount ??
      row.stay_security_deposit_amount ??
      row.security_deposit_snapshot ??
      row.caution_amount ??
      0,
  ) > 0;
}

export function getPropertyBookingJourney(
  row: Record<string, any>,
  inspection?: Record<string, any> | null,
  audience: PropertyJourneyAudience = "customer",
): PropertyJourney {
  const status = String(row.status || row.reservation_status || "payment_pending");
  const shortStay = String(row.stay_type || row._stayKind || "long_stay") === "short_let";
  const arrivalHandler = row.management_mode_snapshot === "host" ? "your authorised property host" : "Property Operations";
  const feePaid = (row.reservation_fee_status==='paid'&&Boolean(row.reservation_fee_paid_at||row.paid_at)) || (Boolean(row.paid_at || row.reservation_fee_paid) &&
    COMPLETE_STATUSES.has(String(row.manual_payment_status || "paid")));
  const rentStatus = String(row.rent_payment_status || row.payment_status || "not_started");
  const rentPaid = hasProtectedAccommodationPayment(row);
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
  const reservationLabel=shortStay?'Reserve date payment':'Reservation fee';
  const reservationStep = feePaid
    ? complete(reservationLabel, "Paid · this confirmed the booking; it was not rent.")
    : status === "payment_pending"
      ? current(reservationLabel, "Complete the fee to reserve this property.")
      : upcoming(reservationLabel, "Payment confirmation is unavailable.");

  if (hasUnprotectedPaidAccommodation(row)) {
    return {
      action: "stopped",
      title: "Payment needs WeHouse review",
      detail:
        "This booking has a paid status without its required Payment Protection record. Move-in and check-in stay blocked while WeHouse reconciles the payment evidence.",
      steps: [
        ...(shortStay ? [] : [reservationStep]),
        {
          id: "payment-protection-review",
          label: "Payment Protection review",
          detail: "The paid status and protected-funds record do not match.",
          state: "stopped",
        },
      ],
      feePaid,
      rentPaid: false,
      inspectionStatus,
    };
  }

  if (stopped) {
    return {
      action: "stopped",
      title: status === "payment_conflict" ? "Payment needs review" : `Booking ${status.replace(/_/g, " ")}`,
      detail: audience === "customer"
        ? "No further property action is available from this record. Message WeHouse if you need help."
        : "This record cannot continue until its stopped or payment-review state is resolved.",
      steps: [...(shortStay ? [] : [reservationStep]), {
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
    const cautionEnabled = shortLetHasCaution(row);
    const paymentStep = rentPaid
      ? complete(
          "Stay payment",
          cautionEnabled
            ? "Stay payment and the separately refundable caution are confirmed."
            : "Stay payment is confirmed. This Short Let has no refundable caution.",
        )
      : current(
            "Stay payment",
            rentStatus === "payment_pending"
              ? "Secure checkout started; payment is not confirmed yet."
              : cautionEnabled
                ? "Pay the stay price and the separately refundable caution."
                : "Pay the stay price. No refundable caution is required for this Short Let.",
          );
    const arrivalStep = status === "occupied" || status === "completed"
      ? complete("Check-in", "Access was handed over and entry was recorded.")
      : status === "ready_for_move_in" && rentPaid
        ? current("Check-in", `${arrivalHandler} verifies the booking code at arrival.`)
        : upcoming("Check-in", "Available after the required stay payment is confirmed.");
    const stayStep = status === "completed"
      ? complete("Stay", "The reserved stay has ended.")
      : status === "occupied"
        ? current("Stay", "The Short Let is currently active.")
        : upcoming("Stay", "Starts after check-in.");
    const finishStep = status === "completed"
      ? complete("Checkout", "Stay completed.")
      : upcoming("Checkout", `${arrivalHandler} records checkout after departure.`);
    const action: PropertyJourneyAction = status === "completed"
      ? "completed"
      : status === "occupied"
        ? "tenancy"
        : !rentPaid && !feePaid
            ? "reservation_payment"
            : !rentPaid
            ? "rent_payment"
            : status === "ready_for_move_in"
              ? "handover"
              : "rent_payment";
    const copy = shortStayCopy(action, audience, rentStatus, cautionEnabled, row.stay_check_in || row.check_in, arrivalHandler);
    return {
      action,
      ...copy,
      steps: [reservationStep, {...paymentStep,state:!feePaid&&!rentPaid?'upcoming':paymentStep.state}, arrivalStep, stayStep, finishStep],
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
  else if (inspectionComplete || rentStatus === "payment_pending" || status === "ready_for_move_in") action = "rent_payment";
  else action = "choose_inspection_or_rent";

  const inspectionStep = inspectionActive
    ? current("Property viewing", inspectionLabel(inspectionStatus), true)
    : inspectionComplete
      ? complete("Property viewing", "Visit completed.", true)
      : rentStatus !== "not_started" || rentPaid || status === "ready_for_move_in" || status === "occupied" || status === "completed"
        ? complete("Property viewing", "Not requested · customer continued directly to rent.", true)
        : feePaid
          ? current("Choose next step", "Request a viewing, or review your rental agreement and payment.")
          : upcoming("Choose next step", "Available after the reservation fee.");
  const rentStep = rentPaid
    ? complete("Rent payment", "The agreed payment before handover is confirmed.")
    : action === "rent_payment"
      ? current("Rent payment", rentStatus === "payment_pending" ? "Secure checkout started; payment is not confirmed yet." : "Review the agreed rent amount before paying.")
      : upcoming("Rent payment", inspectionActive ? "Available after the requested viewing is completed." : "The agreed amount is required before handover.");
  const operations = audience === "operations";
  const handoverStep = status === "occupied" || status === "completed"
    ? complete("Property handover", "Booking code verified and access handed over.")
    : action === "handover"
      ? current(
          "Property handover",
          operations
            ? "At the customer’s requested time, verify the code, customer, property and paid rent before giving access."
            : `${arrivalHandler} verifies your move-in code at the requested arrival time before giving access.`,
        )
      : upcoming(
          "Property handover",
          action === "move_in_request"
            ? operations
              ? "No action yet · wait for the customer to choose a move-in time."
              : "Available after you choose a move-in time."
            : "Available after the agreed rent payment is confirmed.",
        );
  const arrivalStep = status === "occupied" || status === "completed"
    ? complete(
        operations ? "Customer move-in" : "Move-in time",
        "Arrival was completed with the verified handover.",
      )
    : row.requested_move_in_at
      ? complete(
          operations ? "Customer move-in time" : "Move-in time",
          `${operations ? "Customer requested" : "Requested for"} ${displayDateTimeAtProperty(row.requested_move_in_at)}.`,
        )
      : action === "move_in_request"
        ? current(
            operations ? "Waiting for customer" : "Move-in time",
            operations
              ? "No move-in time has been submitted. Operations has no handover action yet."
              : `Choose when you can meet ${arrivalHandler} within the next 3 days.`,
          )
        : upcoming("Move-in time", "Available after the agreed rent payment is confirmed.");
  const tenancyStep = status === "completed"
    ? complete("Tenancy", "Tenancy completed.")
    : status === "occupied"
      ? current("Tenancy", "The tenancy is active.")
      : upcoming("Tenancy", "Starts after verified handover.");
  const copy = longStayCopy(action, audience, rentStatus, inspectionStatus, arrivalHandler);
  return {
    action,
    ...copy,
    steps: [reservationStep, inspectionStep, rentStep, arrivalStep, handoverStep, tenancyStep],
    feePaid,
    rentPaid,
    inspectionStatus,
  };
}

export function propertyBookingStatusLabel(
  row: Record<string, any>,
  audience: PropertyJourneyAudience = "customer",
) {
  const status = String(row.status || row.reservation_status || "payment_pending");
  const shortStay = String(row.stay_type || row._stayKind || "long_stay") === "short_let";
  const rentPaid = hasProtectedAccommodationPayment(row);

  if (hasUnprotectedPaidAccommodation(row)) return "Payment needs review";

  if (status === "ready_for_move_in") {
    if (shortStay) return rentPaid ? "Stay confirmed" : "Stay payment required";
    if (!rentPaid) return "Agreed rent payment required";
    return row.requested_move_in_at
      ? "Move-in scheduled"
      : audience === "operations"
        ? "Waiting for customer move-in time"
        : "Choose move-in time";
  }
  if (status === "occupied") return shortStay ? "Checked in" : "Tenancy active";
  if (status === "completed") return shortStay ? "Stay completed" : "Tenancy completed";
  if (status === "inspection_pending") return "Viewing in progress";
  if (status === "payment_pending") return shortStay ? "Stay payment pending" : "Reservation payment pending";
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
  arrivalHandler: string,
) {
  const operations = audience === "operations";
  if (action === "reservation_payment") return {
    title: operations ? "Waiting for reservation payment" : "Complete your reservation",
    detail: operations ? "Do not start a viewing, rent or handover until the reservation fee is confirmed." : "Pay the reservation fee first. It confirms the booking but does not pay the rent.",
  };
  if (action === "choose_inspection_or_rent") return {
    title: operations ? "Customer is choosing the next step" : "Choose what happens next",
    detail: operations ? "The property is reserved. The customer can request a Field Operations viewing or review their rental agreement and payment." : "Request a viewing first, or review your rental agreement and payment if you are satisfied with the home.",
  };
  if (action === "inspection") return {
    title: operations ? "Complete the requested viewing" : "Your viewing is being arranged",
    detail: operations ? `Continue the assigned Field Operations visit (${inspectionStatus || "pending"}). Rent remains blocked until the viewing finishes.` : "WeHouse will update this booking when the assigned Field Operations visit is completed. You do not need to pay rent while it is in progress.",
  };
  if (action === "rent_payment") return {
    title: operations ? "Waiting for verified rent payment" : rentStatus === "payment_pending" ? "Finish rent payment" : "Pay the agreed rent amount",
    detail: operations ? "Do not hand over access until the payment is verified and the booking becomes ready for move-in." : `The payment in your rental agreement is required before ${arrivalHandler} can hand over the home.`,
  };
  if (action === "move_in_request") return {
    title: operations ? "Waiting for the customer’s move-in time" : "Choose your move-in time",
    detail: operations ? "The agreed rent payment is verified. The customer must choose an arrival time before handover can be confirmed." : `Your required rent payment is confirmed, but your tenancy has not started. Choose a time within the next 3 days to meet ${arrivalHandler} for handover.`,
  };
  if (action === "handover") return {
    title: operations ? "Verify code and hand over access" : "Move-in requested · awaiting handover",
    detail: operations ? "Match the move-in code, customer, property, verified rent and requested time before handing over access and activating the tenancy." : `Your required rent payment is confirmed. Your tenancy starts when ${arrivalHandler} hands over access and verifies your move-in code.`,
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
  cautionEnabled: boolean,
  checkIn?: string,
  arrivalHandler = "Property Operations",
) {
  const operations = audience === "operations";
  if (action === "reservation_payment") return {
    title: "Reserve your dates",
    detail: "Pay the reservation fee to hold these dates before completing the stay payment.",
  };
  if (action === "rent_payment") return {
    title: operations
      ? "Waiting for required stay payment"
      : rentStatus === "payment_pending"
        ? "Finish stay payment"
        : "Pay for the Short Let",
    detail: operations
      ? cautionEnabled
        ? "Do not check the guest in until the stay payment and separately refundable caution are verified."
        : "Do not check the guest in until the stay payment is verified. This booking has no refundable caution."
      : cautionEnabled
        ? "Pay the stay price and the separately refundable caution before arrival."
        : "Pay the stay price before arrival. No refundable caution is required for this Short Let.",
  };
  if (action === "handover") return {
    title: operations ? "Verify arrival and booking code" : `Check-in from ${displayDate(checkIn)}`,
    detail: operations
      ? "Check in only after the guest arrives within the reserved dates. Verify the booking code before handing over access."
      : `Arrive on your booked date and show this code to ${arrivalHandler} for the keys or access. Payment confirms your dates; it does not check you in.`,
  };
  if (action === "tenancy") {
    return {
      title: "Stay in progress",
      detail: cautionEnabled
        ? "You are checked in until the booked checkout date. If the property already has damage, record it within the caution check-in evidence window."
        : "You are checked in until the booked checkout date.",
    };
  }
  return {
    title: "Stay completed",
    detail: cautionEnabled
      ? "The stay is complete. Any caution claim or refund remains attached to this booking."
      : "The stay is complete and remains attached to this booking history.",
  };
}
