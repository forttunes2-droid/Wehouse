import { withTimeout } from "@/lib/withTimeout";
import { getPaymentReceipts } from "@/lib/supabase/receipts";
import { useEffect, useMemo, useState } from 'react';
import { verifyPaymentWithRetry } from '@/lib/supabase/payment-verify';
import type { Profile } from '@/types';
import type { NavPage } from '@/types/nav';

type Props = {
  profile: Profile;
  onNavigate: (page: NavPage, id?: string) => void;
};

type State =
  | { kind: 'checking'; message: string }
  | { kind: 'error'; message: string };

function paymentReferenceFromLocation() {
  const pageParams = new URLSearchParams(window.location.search);
  let reference = pageParams.get('reference') || pageParams.get('trxref') || '';
  if (reference) return reference.trim();
  const hash = window.location.hash || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex >= 0) {
    const hashParams = new URLSearchParams(hash.slice(queryIndex + 1));
    reference = hashParams.get('reference') || hashParams.get('trxref') || '';
  }
  return reference.trim();
}

function destinationForPurpose(purpose: string | undefined, role: string): NavPage {
  if (purpose === 'worker_verification' && role === 'worker') return 'worker_verification';
  if (purpose === 'sponsored_campaign') return role === 'worker' ? 'worker_dashboard' : 'property_partner';
  if (purpose === 'partner_pro_access') return 'property_partner';
  if (['worker_booking', 'hotel_booking', 'apartment_reservation', 'apartment_rent', 'housing_reservation', 'reservation_fee', 'shared_housing_share', 'rent_plan_contribution'].includes(purpose || '')) return 'my_reservations';
  if (role === 'worker') return 'worker_dashboard';
  if (role === 'property_partner') return 'property_partner';
  if (role === 'creator') return 'creator';
  if (role === 'admin') return 'admin';
  if (role === 'staff') return 'staff_dashboard';
  return 'search';
}

function successMessage(purpose?: string) {
  if (purpose === 'sponsored_campaign') return 'Sponsored payment confirmed. Your eligible campaign is now active and can appear in matching discovery results.';
  if (purpose === 'partner_pro_access') return 'Property Partner Pro payment confirmed. Your portfolio tools are available through the paid period.';
  if (purpose === 'apartment_reservation') return 'Reservation payment confirmed. This property is now held for you and the housing workflow is unlocked.';
  if (purpose === 'apartment_rent') return 'Accommodation payment confirmed. Open your booking for arrival details.';
  if (purpose === 'worker_booking') return 'Service payment confirmed. Your job is now in the protected paid stage and remains attached to the service booking.';
  if (purpose === 'hotel_booking') return 'Hotel stay payment confirmed. Your selected room, package and stay dates are now attached to the hotel booking.';
  if (purpose === 'worker_verification') return 'A legacy Worker payment record was confirmed. Worker registration, evidence submission and WeHouse review are now free, and this payment does not grant Reviewed, Trusted or Paid Worker tools.';
  return 'Payment confirmed. WeHouse has recorded the verified Paystack transaction.';
}

function successActionLabel(purpose?: string) {
  if (purpose === 'sponsored_campaign') return 'View my campaigns';
  if (purpose === 'partner_pro_access') return 'Open Property Partner Pro';
  if (purpose === 'worker_booking') return 'Open service booking';
  if (purpose === 'hotel_booking') return 'Open hotel booking';
  if (purpose === 'apartment_reservation') return 'Open apartment booking';
  if (purpose === 'apartment_rent') return 'Open apartment booking';
  if (purpose === 'worker_verification') return 'Continue free Worker setup';
  return 'Continue';
}

function paymentHeading(purpose?: string) {
  if (purpose === 'sponsored_campaign') return 'Sponsored campaign active';
  if (purpose === 'partner_pro_access') return 'Property Partner Pro active';
  if (purpose === 'worker_booking') return 'Service payment confirmed';
  if (purpose === 'hotel_booking') return 'Hotel payment confirmed';
  if (purpose === 'apartment_reservation') return 'Reservation payment confirmed';
  if (purpose === 'apartment_rent') return 'Rent payment confirmed';
  if (purpose === 'worker_verification') return 'Legacy payment record confirmed';
  return 'Payment confirmed';
}

export default function PaymentReturn({ profile, onNavigate }: Props) {
  const reference = useMemo(paymentReferenceFromLocation, []);
  const [receiptAttempt, setReceiptAttempt] = useState(0);
  const [state, setState] = useState<State>({ kind: 'checking', message: 'Confirming your payment securely…' });

  useEffect(() => {
    let cancelled = false;
    if (!reference) {
      setState({ kind: 'error', message: 'Paystack did not return a payment reference.' });
      return;
    }
    void (async () => {
      const result = await withTimeout(verifyPaymentWithRetry(reference, undefined, 4), 30000, "Payment confirmation took too long. Please check again.");
      if (cancelled) return;
      if (!result.success || !result.verified) {
        setState({ kind: 'error', message: result.error || 'We could not confirm this payment yet. You can retry safely.' });
        return;
      }
      try { localStorage.removeItem('wh_worker_verification_payment_ref'); } catch {}
      let bookingId: string | undefined;
      try {
        const receipt = (await getPaymentReceipts(reference))[0];
        bookingId = receipt?.booking_id || undefined;
      } catch { /* Navigation does not depend on receipt loading. */ }
      if (result.purpose === 'partner_pro_access') {
        try { sessionStorage.setItem('wh_partner_return_tab', 'pro'); } catch { /* Navigation still works. */ }
      }
      if (!cancelled) onNavigate(destinationForPurpose(result.purpose, profile.role), bookingId);
    })().catch(() => {
      if (!cancelled) setState({ kind: 'error', message: 'We could not check your payment. Please try again; do not pay a second time.' });
    });
    return () => { cancelled = true; };
  }, [reference, receiptAttempt, onNavigate, profile.role]);

  function retry() {
    setState({ kind: 'checking', message: 'Checking your payment…' });
    setReceiptAttempt(value => value + 1);
  }

  return <div className="grid min-h-[100dvh] place-items-center bg-[var(--wh-bg)] px-5 text-[var(--wh-text)]">
    <div className="w-full max-w-sm text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-violet-500/10 text-xl font-bold text-violet-300">{state.kind === 'error' ? '!' : '…'}</div>
      <h1 className="mt-5 text-lg font-bold">{state.kind === 'error' ? 'Payment confirmation needs attention' : 'Confirming your payment'}</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--wh-text-secondary)]">{state.message}</p>
      {state.kind === 'error' ? <div className="mt-5 space-y-2">
        {reference && <button type="button" onClick={retry} className="h-11 w-full rounded-xl bg-violet-600 text-sm font-semibold text-white">Check payment again</button>}
        <button type="button" onClick={() => onNavigate('my_reservations')} className="h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] text-sm font-semibold">Open bookings</button>
      </div> : null}
    </div>
  </div>;
}
