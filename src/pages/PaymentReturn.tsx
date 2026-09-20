import { withTimeout } from "@/lib/withTimeout";
import { ReceiptDocument, ReceiptPrintButton } from "@/components/PaymentReceipt";
import { getPaymentReceipts, type PaymentReceipt } from "@/lib/supabase/receipts";
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
  | { kind: 'success'; message: string; purpose?: string; receipt?: PaymentReceipt }
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
  if (['worker_booking', 'hotel_booking', 'apartment_reservation', 'apartment_rent', 'housing_reservation', 'reservation_fee', 'shared_housing_share', 'rent_plan_contribution'].includes(purpose || '')) return 'my_reservations';
  if (role === 'worker') return 'worker_dashboard';
  if (role === 'property_partner') return 'property_partner';
  if (role === 'creator') return 'creator';
  if (role === 'admin') return 'admin';
  if (role === 'staff') return 'staff_dashboard';
  return 'search';
}

function successMessage(purpose?: string) {
  if (purpose === 'apartment_reservation') return 'Reservation payment confirmed. This property is now held for you and the housing workflow is unlocked.';
  if (purpose === 'apartment_rent') return 'Accommodation payment confirmed. Open your booking for arrival details.';
  if (purpose === 'worker_booking') return 'Service payment confirmed. Your job is now in the protected paid stage and remains attached to the service booking.';
  if (purpose === 'hotel_booking') return 'Hotel stay payment confirmed. Your selected room, package and stay dates are now attached to the hotel booking.';
  if (purpose === 'worker_verification') return 'A legacy Worker payment record was confirmed. Worker registration, evidence submission and WeHouse review are now free, and this payment does not grant Reviewed, Trusted or Paid Worker tools.';
  return 'Payment confirmed. WeHouse has recorded the verified Paystack transaction.';
}

function successActionLabel(purpose?: string) {
  if (purpose === 'worker_booking') return 'Open service booking';
  if (purpose === 'hotel_booking') return 'Open hotel booking';
  if (purpose === 'apartment_reservation') return 'Open apartment booking';
  if (purpose === 'apartment_rent') return 'Open apartment booking';
  if (purpose === 'worker_verification') return 'Continue free Worker setup';
  return 'Continue';
}

function paymentHeading(purpose?: string) {
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
      let receipt: PaymentReceipt | undefined;
      try { receipt = (await getPaymentReceipts(reference))[0]; } catch { /* Keep the verified payment visible while receipt retrieval can retry. */ }
      if (!cancelled) setState({ kind: 'success', purpose: result.purpose, message: successMessage(result.purpose), receipt });
    })().catch(() => {
      if (!cancelled) setState({ kind: 'error', message: 'We could not check your payment. Please try again; do not pay a second time.' });
    });
    return () => { cancelled = true; };
  }, [reference, receiptAttempt]);

  const destination = state.kind === 'success' ? destinationForPurpose(state.purpose, profile.role) : destinationForPurpose(undefined, profile.role);

  function retry() {
    setState({ kind: 'checking', message: 'Checking your payment…' });
    setReceiptAttempt(value => value + 1);
  }

  const successPurpose = state.kind === 'success' ? state.purpose : undefined;

  return <div className="min-h-[100dvh] bg-[#080A0F] px-4 py-8 text-white"><div className="mx-auto max-w-md">
    <div className="mb-8 flex items-center gap-3"><img src="/brand-mark-dark.svg" alt="WeHouse" className="h-11 w-11" /><div><p className="text-[9px] font-bold uppercase tracking-[.2em] text-violet-300">WEHOUSE PAYMENTS</p><h1 className="mt-1 text-lg font-bold">Payment confirmation</h1></div></div>
    <section className="rounded-3xl border border-white/[.07] bg-[#11151D] p-5 shadow-2xl">
      <div className={`grid h-14 w-14 place-items-center rounded-full text-xl font-bold ${state.kind === 'success' ? 'bg-emerald-500 text-[#04100B]' : state.kind === 'error' ? 'bg-red-500/15 text-red-300' : 'bg-violet-500/10 text-violet-300'}`}>{state.kind === 'success' ? '✓' : state.kind === 'error' ? '!' : '…'}</div>
      <h2 className="mt-5 text-xl font-bold">{state.kind === 'success' ? paymentHeading(successPurpose) : state.kind === 'error' ? 'Confirmation needs attention' : 'Verifying with Paystack'}</h2>
      <p className="mt-2 text-sm leading-6 text-[#8C92A1]">{state.message}</p>
      <div className="mt-6 space-y-2">
        {state.kind === 'success' && <button type="button" onClick={() => onNavigate(destination, state.receipt?.booking_id || undefined)} className="h-12 w-full rounded-2xl bg-violet-600 text-sm font-semibold text-white">{successActionLabel(successPurpose)}</button>}
        {state.kind === 'error' && reference && <button type="button" onClick={() => void retry()} className="h-12 w-full rounded-2xl bg-violet-600 text-sm font-semibold text-white">Check payment again</button>}
        {state.kind !== 'checking' && <button type="button" onClick={() => onNavigate(destinationForPurpose(undefined, profile.role))} className="h-11 w-full rounded-2xl border border-white/[.08] text-xs font-semibold text-[#A7ADBA]">Back to WeHouse</button>}
      </div>
    </section>
    {state.kind === 'success' && <section className="mt-5 space-y-3">
      {state.receipt ? <><ReceiptDocument receipt={state.receipt} /><ReceiptPrintButton receipt={state.receipt} /></> : <div role="status" className="text-sm text-[#A1A1AA]"><p>Your payment is confirmed. The receipt could not be loaded yet.</p><button onClick={retry} className="mt-2 min-h-11 font-semibold text-violet-300">Load receipt again</button></div>}
    </section>}
  </div></div>;
}
