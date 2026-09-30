import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import WorkerProTools from '@/components/WorkerProTools';
import GoldTickBadge from '@/components/GoldTickBadge';
import { supabase } from '@/lib/supabase';
import { isAndroid, isIOS, isNative } from '@/lib/native';
import { getNativeStorePlan, purchaseNativeStoreProduct, restoreNativeStoreSubscriptions, type NativeStorePlan } from '@/lib/nativePurchases';
import type { Profile, WorkerProBillingPeriod, WorkerProEntitlement } from '@/types';

type Props = {
  pro: WorkerProEntitlement | null;
  loading: boolean;
  error: string;
  onRefresh: () => Promise<void>;
  profile: Profile;
};

export default function WorkerProPanel({ pro, loading, error, onRefresh, profile }: Props) {
  const [busy, setBusy] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState<WorkerProBillingPeriod>('monthly');
  const [storePlan, setStorePlan] = useState<NativeStorePlan | null>(null);
  const [storeError, setStoreError] = useState('');
  const native = isNative();
  const underReview = Boolean(pro && 'under_review' in pro && pro.under_review === true);
  const nativeSalesEnabled = Boolean(import.meta.env.VITE_NATIVE_BILLING_ENABLED === 'true'
    && (isIOS() ? pro?.native_sales?.ios_enabled : pro?.native_sales?.android_enabled));
  const nativeProductId = pro?.plans?.find(plan => plan.billing_period === billingPeriod)?.[isIOS() ? 'apple_product_id' : 'google_product_id'] || '';

  useEffect(() => {
    setStorePlan(null);
    setStoreError('');
    if (!native || !nativeSalesEnabled || !nativeProductId || pro?.active) return;
    let live = true;
    void getNativeStorePlan(nativeProductId, 'subscription')
      .then(plan => { if (live) setStorePlan(plan); })
      .catch(reason => { if (live) setStoreError(reason instanceof Error ? reason.message : 'Store plan unavailable'); });
    return () => { live = false; };
  }, [native, nativeSalesEnabled, nativeProductId, pro?.active]);

  useEffect(() => { setTermsAccepted(false); }, [profile.user_id, pro?.terms_version, pro?.terms_content]);

  async function subscribe(selectedBillingPeriod: WorkerProBillingPeriod) {
    if (!pro || underReview || (!native && !pro.sales_enabled)) return;
    if (!termsAccepted) {
      toast.error('Please read and accept the current paid plan subscription terms');
      return;
    }
    setBusy(true);
    try {
      const acceptance = await supabase.rpc('accept_current_worker_pro_terms');
      if (acceptance.error || !acceptance.data?.success) {
        throw new Error(acceptance.data?.error || acceptance.error?.message || 'Subscription terms acceptance could not be recorded');
      }
      if (native) {
        if (!nativeSalesEnabled || !storePlan) throw new Error('This app store plan is unavailable');
        await purchaseNativeStoreProduct(storePlan, 'subscription', {}, 'native-worker-pro');
        await onRefresh();
        toast.success('Your store subscription is verified');
        setBusy(false);
        return;
      }
      const payment = await supabase.rpc('create_worker_pro_web_payment', { p_billing_period: selectedBillingPeriod });
      if (payment.error || !payment.data?.success) {
        throw new Error(payment.data?.error || payment.error?.message || 'Paid plan checkout could not start');
      }
      const reference = String(payment.data.reference || '');
      const initialized = await supabase.functions.invoke('worker-pro-payment-init', {
        body: { reference },
      });
      if (initialized.error || !initialized.data?.authorization_url) {
        throw new Error(initialized.data?.error || initialized.error?.message || 'Paid plan checkout could not start');
      }
      try { localStorage.setItem('wh_worker_pro_payment_ref', reference); } catch {}
      window.location.assign(String(initialized.data.authorization_url));
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Paid plan checkout could not start');
      setBusy(false);
    }
  }

  async function manage() {
    if (!pro?.provider) return;
    if (pro.provider === 'apple') {
      window.open('https://apps.apple.com/account/subscriptions', '_blank', 'noopener,noreferrer');
      return;
    }
    if (pro.provider === 'google') {
      window.open('https://play.google.com/store/account/subscriptions', '_blank', 'noopener,noreferrer');
      return;
    }
    setBusy(true);
    const result = await supabase.functions.invoke('worker-pro-manage');
    setBusy(false);
    if (result.error || !result.data?.url) return toast.error(result.data?.error || result.error?.message || 'Subscription management could not open');
    window.location.assign(String(result.data.url));
  }

  async function restore() {
    setBusy(true);
    try {
      const ids = [...(pro?.plans || []).map(plan => isIOS() ? plan.apple_product_id : plan.google_product_id),
        pro?.provider === (isIOS() ? 'apple' : 'google') ? pro?.product_id : ''].filter(Boolean) as string[];
      const count = await restoreNativeStoreSubscriptions(ids);
      await onRefresh();
      toast.success(count ? 'Store subscription restored' : 'No active store subscription found for this account');
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Store restoration failed');
    } finally { setBusy(false); }
  }

  // Ownership of existing records does not end with the subscription. Unknown
  // entitlement permits read/export only; all writes stay server-authorised.
  const tools = <WorkerProTools key={profile.user_id} profile={profile} canUsePaidTools={Boolean(pro?.active) && !loading && !error} />;
  if (loading) return <div className="space-y-4"><State text="Loading paid Worker plan…" />{tools}</div>;
  if (error || !pro) return <div className="space-y-4"><State text={error || 'Paid Worker plan is unavailable'} retry={onRefresh} />{tools}</div>;
  const storeName = isIOS() ? 'App Store' : isAndroid() ? 'Google Play' : 'Paystack';
  const planOptions = Array.isArray(pro.plans) && pro.plans.length > 0 ? pro.plans : [{
    billing_period: 'monthly' as const,
    period: 'P1M' as const,
    label: 'Monthly',
    price_ngn: Number(pro.monthly_price_ngn || 0),
    web_plan_code: pro.web_paystack_plan_code || '',
    apple_product_id: pro.apple_product_id || '',
    google_product_id: pro.google_product_id || '',
    web_available: Boolean(pro.sales_enabled && pro.monthly_price_ngn > 0 && pro.web_paystack_plan_code),
    saving_ngn: 0,
    discount_percent: 0,
  }];
  const requestedPlan = planOptions.find((plan) => plan.billing_period === billingPeriod);
  const selectedPlan = native ? requestedPlan : requestedPlan?.web_available
    ? requestedPlan
    : planOptions.find((plan) => plan.web_available) || requestedPlan;
  const selectedBillingPeriod = selectedPlan?.billing_period || billingPeriod;
  const anyWebPlanAvailable = planOptions.some((plan) => plan.web_available);
  const checkoutAvailable = !underReview && (native
    ? Boolean(nativeSalesEnabled && storePlan && selectedPlan && pro.terms_content)
    : Boolean(pro.sales_enabled && selectedPlan?.web_available));
  const activeUntil = pro.current_period_end ? new Date(pro.current_period_end).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-violet-700 dark:text-violet-200">WeHouse Pro · Service Worker</p>
            <h2 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">{pro.product_name || 'Work tools'}{pro.active && <GoldTickBadge />}</h2>
          </div>
          <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${pro.active ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-700 dark:text-emerald-200' : checkoutAvailable ? 'border-violet-400/25 bg-violet-400/10 text-violet-700 dark:text-violet-100' : 'border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] text-[var(--wh-text-secondary)]'}`}>{pro.active ? 'Active' : checkoutAvailable ? 'Available' : 'Sales closed'}</span>
        </div>
        <p className="mt-4 max-w-xl text-sm leading-6 text-[var(--wh-text-secondary)]">Business tools for Service Workers: track completed jobs, make quotes and issue invoices. Membership does not change professional review or customer ranking.</p>
        {checkoutAvailable || pro.active ? <p className="mt-5 border-t border-[var(--wh-border-subtle)] pt-4 text-2xl font-semibold">{native ? storePlan?.price || 'Store price' : selectedPlan && selectedPlan.price_ngn > 0 ? `₦${Number(selectedPlan.price_ngn).toLocaleString()}` : 'Price unavailable'}<span className="ml-2 text-sm font-normal text-[var(--wh-text-secondary)]">{native ? `via ${storeName}` : `per ${selectedBillingPeriod === 'yearly' ? 'year' : 'month'}`}</span></p> : null}
      </section>

      <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-base font-semibold">{pro.active ? 'Paid tools are active' : 'Included tools'}</p>
            <p className="mt-1 text-sm leading-5 text-[var(--wh-text-secondary)]">{pro.active ? `${pro.cancel_at_period_end ? 'Access ends' : 'Current period ends'}${activeUntil ? ` ${activeUntil}` : ''}` : 'See what the optional plan adds to your Worker account.'}</p>
          </div>
        </div>
        <div className="mt-4 divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
          {[...pro.features.filter(feature => !/sponsored|priority/i.test(feature)), 'Schedule and in-app work reminders', 'Service packages and featured work on your profile', 'Consented customer records and custom service receipts', 'Priority routing for ordinary support cases'].map((feature) => <div key={feature} className="flex min-h-12 items-center gap-3 py-3 text-sm leading-5 text-[var(--wh-text)]"><span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-400/15 text-sm font-bold text-violet-700 dark:text-violet-200">✓</span><span>{feature}</span></div>)}
        </div>
        {!pro.active && !underReview && (native ? nativeSalesEnabled : pro.sales_enabled && anyWebPlanAvailable) && (
          <div className="mt-4 rounded-xl border border-[var(--wh-border-subtle)] bg-black/10 p-3">
            <div className="mb-3 grid grid-cols-2 gap-2" role="group" aria-label="Billing period">
              {planOptions.map((plan) => (
                <button
                  key={plan.billing_period}
                  type="button"
                  aria-pressed={selectedBillingPeriod === plan.billing_period}
                  disabled={native ? !(isIOS() ? plan.apple_product_id : plan.google_product_id) : !plan.web_available}
                  onClick={() => setBillingPeriod(plan.billing_period)}
                  className={`rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-40 ${selectedBillingPeriod === plan.billing_period ? 'border-amber-300/35 bg-amber-300/10' : 'border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)]'}`}
                >
                  <span className="block text-sm font-semibold">{plan.label}</span>
                  <span className="mt-1 block text-xs text-[var(--wh-text-secondary)]">{native ? plan.billing_period === selectedBillingPeriod ? storePlan?.price || 'Loading store price…' : 'See store price' : `₦${Number(plan.price_ngn).toLocaleString()}`}</span>
                  {!native && plan.billing_period === 'yearly' && plan.saving_ngn > 0 && (
                    <span className="mt-1 block text-xs font-semibold text-amber-700 dark:text-amber-200">Save ₦{Number(plan.saving_ngn).toLocaleString()} ({Number(plan.discount_percent).toLocaleString()}%)</span>
                  )}
                </button>
              ))}
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-[var(--wh-text)]">Read paid plan subscription terms ({pro.terms_version || 'not published'})</summary>
              <p className="mt-3 max-h-44 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-[var(--wh-text-secondary)]">{pro.terms_content || 'Subscription terms are not available. Sales must remain off.'}</p>
            </details>
            <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm leading-6 text-[var(--wh-text-secondary)]">
              <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} className="mt-1 h-4 w-4 accent-amber-300" />
              <span>I accept the current subscription terms. This {selectedBillingPeriod} plan renews automatically until I cancel, and cancellation preserves access through the paid period.</span>
            </label>
          </div>
        )}
        {pro.active ? (
          <button onClick={() => void manage()} disabled={busy} className="mt-4 h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] text-sm font-semibold disabled:opacity-40">{busy ? 'Opening…' : 'Manage or cancel subscription'}</button>
        ) : checkoutAvailable ? (
          <button onClick={() => void subscribe(selectedBillingPeriod)} disabled={busy || !termsAccepted || !pro.terms_content} className="mt-4 h-12 w-full rounded-xl bg-violet-500 text-sm font-bold text-white disabled:opacity-40">{busy ? 'Opening secure checkout…' : `Choose ${selectedBillingPeriod} with ${storeName}`}</button>
        ) : native ? (
          <p className="mt-4 text-sm leading-6 text-[var(--wh-text-secondary)]">{storeError || `Paid sales on ${storeName} are not open yet.`} Your free Worker profile and review status are unchanged.</p>
        ) : (
          <p className="mt-4 text-sm leading-6 text-[var(--wh-text-secondary)]">Paid Worker subscriptions are not open yet. Your free Worker profile, review status and job eligibility are unchanged.</p>
        )}
      </section>
      {underReview && <p role="status" className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-[var(--wh-text)]">Your Worker Pro payment is under Finance review after a provider refund or dispute notice. Paid tools and new checkout are paused. Your free Worker profile, bookings and existing work documents remain available.</p>}
      {native && <button onClick={() => void restore()} disabled={busy || import.meta.env.VITE_NATIVE_BILLING_ENABLED !== 'true'} className="w-full rounded-xl border border-[var(--wh-border-subtle)] px-4 py-3 text-[10px] font-semibold disabled:opacity-40">Restore store subscription</button>}
      {tools}
    </div>
  );
}

function State({ text, retry }: { text: string; retry?: () => Promise<void> }) {
  return <div className="grid min-h-40 place-items-center rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 text-center"><div><p className="text-xs text-[var(--wh-text-secondary)]">{text}</p>{retry && <button onClick={() => void retry()} className="mt-3 rounded-xl border border-[var(--wh-border-subtle)] px-4 py-2 text-[9px] font-semibold">Try again</button>}</div></div>;
}
