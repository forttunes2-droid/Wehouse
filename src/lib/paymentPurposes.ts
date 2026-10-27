// The only list of things a person can pay for in WeHouse, with the words shown on screen.
// Adding a payment type means adding it here, in payment-init and in the booking_payments purpose check.
export type PaymentPurpose =
  | 'apartment_reservation'
  | 'apartment_rent'
  | 'rent_plan_contribution'
  | 'shared_housing_share'
  | 'hotel_booking'
  | 'worker_booking'
  | 'experience_booking'
  | 'worker_pro_subscription'
  | 'partner_pro_access'
  | 'sponsored_campaign';

type PurposeCopy = { heading: string; action: string };

// Money held by WeHouse until the stay or job is done.
const BOOKING_PURPOSES: Record<string, PurposeCopy> = {
  apartment_reservation: { heading: 'Reserve fee confirmed', action: 'Open my booking' },
  apartment_rent: { heading: 'Rent payment confirmed', action: 'Open my booking' },
  rent_plan_contribution: { heading: 'Rent payment confirmed', action: 'Open my booking' },
  shared_housing_share: { heading: 'Your share is confirmed', action: 'Open my booking' },
  hotel_booking: { heading: 'Hotel booking confirmed', action: 'Open my booking' },
  worker_booking: { heading: 'Service payment confirmed', action: 'Open my booking' },
  experience_booking: { heading: 'Experience booking confirmed', action: 'Open my booking' },
};

const BUSINESS_PURPOSES: Record<string, PurposeCopy> = {
  worker_pro_subscription: { heading: 'WeHouse Pro active', action: 'Open WeHouse Pro' },
  partner_pro_access: { heading: 'WeHouse Pro active', action: 'Open WeHouse Pro' },
  sponsored_campaign: { heading: 'Sponsored placement active', action: 'View my campaigns' },
};

// Payments made before worker verification became free. They are shown, never created.
const LEGACY_PURPOSES: Record<string, PurposeCopy> = {
  worker_verification: { heading: 'Earlier payment recorded', action: 'Continue Worker setup' },
};

export const isBookingPurpose = (purpose?: string) => Boolean(purpose && purpose in BOOKING_PURPOSES);

export function purposeCopy(purpose?: string): PurposeCopy {
  const key = purpose || '';
  return BOOKING_PURPOSES[key] || BUSINESS_PURPOSES[key] || LEGACY_PURPOSES[key] || { heading: 'Payment confirmed', action: 'Continue' };
}
