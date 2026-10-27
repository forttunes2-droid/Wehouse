import { withTimeout } from "@/lib/withTimeout";
import BrandIdentity from '@/components/BrandIdentity';
import { ReceiptDocument, ReceiptPrintButton } from "@/components/PaymentReceipt";
import { getPaymentReceipts, type PaymentReceipt } from "@/lib/supabase/receipts";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { verifyPaymentWithRetry } from '@/lib/supabase/payment-verify';
import { isBookingPurpose, purposeCopy } from '@/lib/paymentPurposes';
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
  if (purpose === 'sponsored_campaign') return role === 'worker' ? 'worker_dashboard' : 'property_partner';
  if (purpose === 'partner_pro_access') return 'property_partner';
  if (isBookingPurpose(purpose)) return 'my_reservations';
  if (role === 'worker') return 'worker_dashboard';
  if (role === 'property_partner') return 'property_partner';
  if (role === 'creator') return 'creator';
  if (role === 'admin') return 'admin';
  if (role === 'staff') return 'staff_dashboard';
  return 'search';
}

const successActionLabel = (purpose?: string) => purposeCopy(purpose).action;

function successMessage(purpose?: string) {
  if (isBookingPurpose(purpose))
    return 'Your payment is confirmed. WeHouse holds it safely and releases it to the other side only when the release conditions are met.';
  return 'Your payment is confirmed.';
}

const paymentHeading = (purpose?: string) => purposeCopy(purpose).heading;

export default function PaymentReturn(props: Props) {
  return <PaymentReturnContent key={props.profile.user_id} {...props} />;
}

function PaymentReturnContent({ profile, onNavigate }: Props) {
  const reference = useMemo(paymentReferenceFromLocation, []);
  const [receiptAttempt, setReceiptAttempt] = useState(0);
  const [state, setState] = useState<State>({ kind: 'checking', message: 'Confirming your payment securely…' });

  const [receiptLoading, setReceiptLoading] = useState(false);
  const receiptGeneration = useRef(0);
  const refreshReceipt = useCallback(async (purpose?: string) => {
    const request = ++receiptGeneration.current;
    setReceiptLoading(true);
    try {
      let receipt = (await getPaymentReceipts(reference))[0];
      if (receipt && purpose && receipt.purpose !== purpose) throw new Error('Receipt purpose does not match the verified payment.');
      if (receipt && purpose === 'sponsored_campaign') receipt = { ...receipt, description: 'Sponsored placement', merchant_name: 'WeHouse' };
      if (receipt && purpose === 'partner_pro_access') receipt = { ...receipt, description: 'WeHouse Pro (Property Partner)', merchant_name: 'WeHouse' };
      if (request === receiptGeneration.current && receipt) {
        setState(previous => previous.kind === 'success' ? { ...previous, receipt } : previous);
      }
    } catch { /* A receipt read failure never reverses a verified payment. */ }
    finally { if (request === receiptGeneration.current) setReceiptLoading(false); }
  }, [reference]);
  useEffect(() => () => { receiptGeneration.current += 1; }, []);

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
      if (result.purpose === 'partner_pro_access') {
        try { sessionStorage.setItem('wh_partner_return_tab', 'pro'); } catch { /* Navigation still works. */ }
      }
      if (cancelled) return;
      // Retain the reference so reload can recover through owner-checked verification.
      try {
        const clean = new URL(window.location.href);
        clean.searchParams.set('reference', reference);
        clean.searchParams.delete('trxref');
        window.history.replaceState(window.history.state, '', clean.pathname + clean.search + '#payment-return');
      } catch { /* The confirmation still shows. */ }
      setState({ kind: 'success', message: successMessage(result.purpose), purpose: result.purpose });
      void refreshReceipt(result.purpose);
    })().catch(() => {
      if (!cancelled) setState({ kind: 'error', message: 'We could not check your payment. Please try again; do not pay a second time.' });
    });
    return () => { cancelled = true; };
  }, [reference, receiptAttempt, refreshReceipt]);

  const destination = state.kind === 'success' ? destinationForPurpose(state.purpose, profile.role) : destinationForPurpose(undefined, profile.role);

  function retry() {
    setState({ kind: 'checking', message: 'Checking your payment…' });
    setReceiptAttempt(value => value + 1);
  }

  const successPurpose = state.kind === 'success' ? state.purpose : undefined;

  return <div className="min-h-[100dvh] bg-[var(--wh-bg)] px-4 py-8 text-[var(--wh-text)]"><div className="mx-auto max-w-md">
    <div className="mb-8 flex items-center gap-3"><BrandIdentity mark className="h-11 w-11"/><div><p className="text-xs font-bold uppercase tracking-[.2em] text-[var(--wh-accent-text)]">WEHOUSE PAYMENTS</p><h1 className="mt-1 text-lg font-bold">Payment confirmation</h1></div></div>
    <section className="rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 shadow-2xl">
      <div className={`grid h-14 w-14 place-items-center rounded-full text-xl font-bold ${state.kind === 'success' ? 'bg-emerald-500 text-[#04100B]' : state.kind === 'error' ? 'bg-red-500/15 text-red-700 dark:text-red-300' : 'bg-violet-500/10 text-[var(--wh-accent-text)]'}`}>{state.kind === 'success' ? '✓' : state.kind === 'error' ? '!' : <span aria-hidden="true" className="h-6 w-6 animate-spin rounded-full border-2 border-violet-300 border-t-transparent motion-reduce:animate-none" />}</div>
      <h2 className="mt-5 text-xl font-bold">{state.kind === 'success' ? paymentHeading(successPurpose) : state.kind === 'error' ? 'Confirmation needs attention' : 'Verifying with Paystack'}</h2>
      <p role={state.kind === "error" ? "alert" : "status"} className="mt-2 text-sm leading-6 text-[var(--wh-text-secondary)]">{state.message}</p>
      <div className="mt-6 space-y-2">
        {state.kind === 'success' && <button type="button" onClick={() => {
          if (successPurpose === 'partner_pro_access') {
            try { sessionStorage.setItem('wh_partner_return_tab', 'pro'); } catch { /* Navigation still works. */ }
          }
          onNavigate(destination, state.receipt?.booking_id ? (successPurpose==='experience_booking'?`experience:${state.receipt.booking_id}`:state.receipt.booking_id) : undefined);
        }} className="wh-motion-control h-12 w-full rounded-2xl bg-violet-600 text-sm font-semibold text-white">{successActionLabel(successPurpose)}</button>}
        {state.kind === 'error' && reference && <button type="button" onClick={() => void retry()} className="wh-motion-control h-12 w-full rounded-2xl bg-violet-600 text-sm font-semibold text-white">Check payment again</button>}
        {state.kind === 'error' && <button type="button" onClick={() => onNavigate('my_reservations')} className="wh-motion-control h-12 w-full rounded-2xl border border-violet-400/25 bg-violet-500/[.08] text-sm font-semibold text-[var(--wh-accent-text)]">Open my bookings</button>}
        {state.kind === 'error' && <button type="button" onClick={() => onNavigate(destinationForPurpose(undefined, profile.role))} className="wh-motion-control h-11 w-full rounded-2xl border border-[var(--wh-border-subtle)] text-xs font-semibold text-[var(--wh-text-secondary)]">Back to WeHouse</button>}
      </div>
    </section>
    {state.kind === 'success' && <section className="mt-5 space-y-3">
      {state.receipt ? <><ReceiptDocument receipt={state.receipt} /><ReceiptPrintButton receipt={state.receipt} /></> : <div role="status" className="text-sm text-[var(--wh-text-secondary)]"><p>{receiptLoading ? "Your payment is confirmed. Loading your receipt..." : "Your payment is confirmed. The receipt could not be loaded yet."}</p><button type="button" disabled={receiptLoading} onClick={() => void refreshReceipt(successPurpose)} className="wh-motion-control mt-2 min-h-11 font-semibold text-[var(--wh-accent-text)] disabled:opacity-60">{receiptLoading ? "Loading receipt..." : "Load receipt again"}</button></div>}
    </section>}
  </div></div>;
}
