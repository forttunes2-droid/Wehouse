import { useEffect, useMemo, useState } from 'react';
import { verifyPaymentWithRetry } from '@/lib/supabase/payment-verify';
import type { Profile } from '@/types';
import type { NavPage } from '@/types/nav';

type Props = {
  profile: Profile;
  onNavigate: (page: NavPage) => void;
};

type State =
  | { kind: 'checking'; message: string }
  | { kind: 'success'; message: string; purpose?: string }
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
  if (purpose === 'worker_booking') return role === 'user' ? 'my_reservations' : role === 'worker' ? 'worker_dashboard' : 'search';
  if (purpose === 'hotel_booking') return role === 'user' ? 'my_reservations' : 'search';
  if (['apartment_reservation','apartment_rent','housing_reservation','reservation_fee'].includes(purpose || '')) {
    return role === 'user' ? 'my_reservations' : 'search';
  }
  if (role === 'worker') return 'worker_dashboard';
  if (role === 'property_partner') return 'property_partner';
  if (role === 'creator') return 'creator';
  if (role === 'admin') return 'admin';
  if (role === 'staff') return 'staff_dashboard';
  return 'search';
}

function successMessage(purpose?: string) {
  if (purpose === 'apartment_reservation') return 'Your reservation payment is confirmed.';
  if (purpose === 'apartment_rent') return 'Your rent payment is confirmed.';
  if (purpose === 'worker_booking') return 'Your service payment is confirmed and protected.';
  if (purpose === 'hotel_booking') return 'Your hotel payment is confirmed.';
  if (purpose === 'worker_verification') return 'Your Worker verification payment is confirmed.';
  return 'Your payment is confirmed.';
}

function successActionLabel(purpose?: string) {
  if (purpose === 'worker_booking') return 'Open service booking';
  if (purpose === 'hotel_booking') return 'Open hotel booking';
  if (purpose === 'apartment_reservation') return 'Open apartment booking';
  if (purpose === 'apartment_rent') return 'Open apartment booking';
  if (purpose === 'worker_verification') return 'Continue verification';
  return 'Continue';
}

function paymentHeading(purpose?: string) {
  if (purpose === 'worker_booking') return 'Service payment confirmed';
  if (purpose === 'hotel_booking') return 'Hotel payment confirmed';
  if (purpose === 'apartment_reservation') return 'Reservation payment confirmed';
  if (purpose === 'apartment_rent') return 'Rent payment confirmed';
  if (purpose === 'worker_verification') return 'Verification payment confirmed';
  return 'Payment confirmed';
}

export default function PaymentReturn({ profile, onNavigate }: Props) {
  const reference = useMemo(paymentReferenceFromLocation, []);
  const [state, setState] = useState<State>({ kind: 'checking', message: 'Confirming your payment securely…' });

  useEffect(() => {
    let cancelled = false;
    if (!reference) {
      setState({ kind: 'error', message: 'Paystack did not return a payment reference.' });
      return;
    }
    void (async () => {
      const result = await verifyPaymentWithRetry(reference, undefined, 4);
      if (cancelled) return;
      if (!result.success || !result.verified) {
        setState({ kind: 'error', message: result.error || 'We could not confirm this payment yet. You can retry safely.' });
        return;
      }
      try { localStorage.removeItem('wh_worker_verification_payment_ref'); } catch {}
      setState({ kind: 'success', purpose: result.purpose, message: successMessage(result.purpose) });
    })();
    return () => { cancelled = true; };
  }, [reference]);

  const destination = state.kind === 'success' ? destinationForPurpose(state.purpose, profile.role) : destinationForPurpose(undefined, profile.role);

  async function retry() {
    if (!reference) return;
    setState({ kind: 'checking', message: 'Checking Paystack again…' });
    const result = await verifyPaymentWithRetry(reference, undefined, 4);
    if (!result.success || !result.verified) {
      setState({ kind: 'error', message: result.error || 'Payment is not confirmed yet.' });
      return;
    }
    try { localStorage.removeItem('wh_worker_verification_payment_ref'); } catch {}
    setState({ kind: 'success', purpose: result.purpose, message: successMessage(result.purpose) });
  }

  const successPurpose = state.kind === 'success' ? state.purpose : undefined;

  return <div className="min-h-[100dvh] bg-[#080A0F] px-4 py-8 text-white"><div className="mx-auto max-w-md">
    <div className="mb-8 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl border border-white/[.08] bg-white/[.04] text-sm font-black">WH</div><div><p className="text-[9px] font-bold uppercase tracking-[.2em] text-cyan-300">WEHOUSE PAYMENTS</p><h1 className="mt-1 text-lg font-bold">Payment confirmation</h1></div></div>
    <section className="rounded-3xl border border-white/[.07] bg-[#11151D] p-5 shadow-2xl">
      <div className={`grid h-14 w-14 place-items-center rounded-full text-xl font-bold ${state.kind === 'success' ? 'bg-emerald-500 text-[#04100B]' : state.kind === 'error' ? 'bg-red-500/15 text-red-300' : 'bg-cyan-500/10 text-cyan-300'}`}>{state.kind === 'success' ? '✓' : state.kind === 'error' ? '!' : '…'}</div>
      <h2 className="mt-5 text-xl font-bold">{state.kind === 'success' ? paymentHeading(successPurpose) : state.kind === 'error' ? 'Confirmation needs attention' : 'Verifying with Paystack'}</h2>
      <p className="mt-2 text-sm leading-6 text-[#8C92A1]">{state.message}</p>
      <div className="mt-6 space-y-2">
        {state.kind === 'success' && <button type="button" onClick={() => onNavigate(destination)} className="h-12 w-full rounded-2xl bg-cyan-500 text-xs font-semibold text-[#041014]">{successActionLabel(successPurpose)}</button>}
        {state.kind === 'error' && reference && <button type="button" onClick={() => void retry()} className="h-12 w-full rounded-2xl bg-cyan-500 text-xs font-semibold text-[#041014]">Check payment again</button>}
        {state.kind !== 'checking' && <button type="button" onClick={() => onNavigate(destinationForPurpose(undefined, profile.role))} className="h-11 w-full rounded-2xl border border-white/[.08] text-xs font-semibold text-[#A7ADBA]">Back to WeHouse</button>}
      </div>
    </section>
  </div></div>;
}
