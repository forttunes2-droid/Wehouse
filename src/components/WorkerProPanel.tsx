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

  async function subscribe(selectedBillingPeriod: WorkerProBillingPeriod) {
    if (!pro || (!native && !pro.sales_enabled)) return;
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
  const checkoutAvailable = native
    ? Boolean(nativeSalesEnabled && storePlan && selectedPlan && pro.terms_content)
    : Boolean(pro.sales_enabled && selectedPlan?.web_available);
  const activeUntil = pro.current_period_end ? new Date(pro.current_period_end).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-violet-400/20 bg-[linear-gradient(135deg,#1B1730,#11131B_70%)] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-violet-200">Optional Worker tools</p>
            <h2 className="mt-2 flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">{pro.product_name || 'WeHouse Works'}{pro.active && <GoldTickBadge />}</h2>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${pro.active ? 'bg-emerald-400/15 text-emerald-200' : checkoutAvailable ? 'bg-violet-400/15 text-violet-100' : 'bg-white/[.07] text-[#C4C7D1]'}`}>{pro.active ? 'Active' : checkoutAvailable ? 'Available' : 'Not on sale yet'}</span>
        </div>
        {checkoutAvailable || pro.active ? <p className="mt-4 text-xl font-bold">{native ? storePlan?.price || 'Store price' : selectedPlan && selectedPlan.price_ngn > 0 ? `₦${Number(selectedPlan.price_ngn).toLocaleString()}` : 'Price unavailable'}<span className="ml-2 text-xs font-medium text-[#ADB3C0]">{native ? `via ${storeName}` : `per ${selectedBillingPeriod === 'yearly' ? 'year' : 'month'}`}</span></p> : null}
        <p className="mt-4 max-w-xl text-sm leading-6 text-[#C3C6D2]">Business tools for Service Workers. The gold badge appears only on an active Worker membership. Identity and professional checks stay separate.</p>
      </section>

      <section className="rounded-2xl border border-white/[.08] bg-[#10131B] p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-base font-semibold">{pro.active ? 'Paid tools are active' : 'Included tools'}</p>
            <p className="mt-1 text-sm leading-5 text-[#A3A9B8]">{pro.active ? `${pro.cancel_at_period_end ? 'Access ends' : 'Current period ends'}${activeUntil ? ` ${activeUntil}` : ''}` : 'See what the optional plan adds to your Worker account.'}</p>
          </div>
        </div>
        <div className="mt-4 divide-y divide-white/[.08] border-y border-white/[.08]">
          {pro.features.map((feature) => <div key={feature} className="flex min-h-12 items-center gap-3 py-3 text-sm leading-5 text-[#D3D7E0]"><span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-400/15 text-sm font-bold text-violet-200">✓</span><span>{feature}</span></div>)}
        </div>
        {!pro.active && (native ? nativeSalesEnabled : pro.sales_enabled && anyWebPlanAvailable) && (
          <div className="mt-4 rounded-xl border border-white/[.07] bg-black/10 p-3">
            <div className="mb-3 grid grid-cols-2 gap-2" role="group" aria-label="Billing period">
              {planOptions.map((plan) => (
                <button
                  key={plan.billing_period}
                  type="button"
                  aria-pressed={selectedBillingPeriod === plan.billing_period}
                  disabled={native ? !(isIOS() ? plan.apple_product_id : plan.google_product_id) : !plan.web_available}
                  onClick={() => setBillingPeriod(plan.billing_period)}
                  className={`rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-40 ${selectedBillingPeriod === plan.billing_period ? 'border-amber-300/35 bg-amber-300/10' : 'border-white/[.06] bg-white/[.02]'}`}
                >
                  <span className="block text-sm font-semibold">{plan.label}</span>
                  <span className="mt-1 block text-xs text-[#A8ADBA]">{native ? plan.billing_period === selectedBillingPeriod ? storePlan?.price || 'Loading store price…' : 'See store price' : `₦${Number(plan.price_ngn).toLocaleString()}`}</span>
                  {!native && plan.billing_period === 'yearly' && plan.saving_ngn > 0 && (
                    <span className="mt-1 block text-xs font-semibold text-amber-200">Save ₦{Number(plan.saving_ngn).toLocaleString()} ({Number(plan.discount_percent).toLocaleString()}%)</span>
                  )}
                </button>
              ))}
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-[#D6D8DF]">Read paid plan subscription terms ({pro.terms_version || 'not published'})</summary>
              <p className="mt-3 max-h-44 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-[#B3B8C6]">{pro.terms_content || 'Subscription terms are not available. Sales must remain off.'}</p>
            </details>
            <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm leading-6 text-[#B8BBC5]">
              <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} className="mt-1 h-4 w-4 accent-amber-300" />
              <span>I accept the current subscription terms. This {selectedBillingPeriod} plan renews automatically until I cancel, and cancellation preserves access through the paid period.</span>
            </label>
          </div>
        )}
        {pro.active ? (
          <button onClick={() => void manage()} disabled={busy} className="mt-4 h-11 w-full rounded-xl border border-white/[.08] bg-white/[.035] text-sm font-semibold disabled:opacity-40">{busy ? 'Opening…' : 'Manage or cancel subscription'}</button>
        ) : checkoutAvailable ? (
          <button onClick={() => void subscribe(selectedBillingPeriod)} disabled={busy || !termsAccepted || !pro.terms_content} className="mt-4 h-12 w-full rounded-xl bg-violet-500 text-sm font-bold text-white disabled:opacity-40">{busy ? 'Opening secure checkout…' : `Choose ${selectedBillingPeriod} with ${storeName}`}</button>
        ) : native ? (
          <p className="mt-4 text-sm leading-6 text-[#AEB4C2]">{storeError || `Paid sales on ${storeName} are not open yet.`} Your free Worker profile and review status are unchanged.</p>
        ) : (
          <p className="mt-4 text-sm leading-6 text-[#AEB4C2]">Paid Worker subscriptions are not open yet. Your free Worker profile, review status and job eligibility are unchanged.</p>
        )}
      </section>
      {native && <button onClick={() => void restore()} disabled={busy || import.meta.env.VITE_NATIVE_BILLING_ENABLED !== 'true'} className="w-full rounded-xl border border-white/[.08] px-4 py-3 text-[10px] font-semibold disabled:opacity-40">Restore store subscription</button>}
      {tools}
    </div>
  );
}

function State({ text, retry }: { text: string; retry?: () => Promise<void> }) {
  return <div className="grid min-h-40 place-items-center rounded-2xl border border-white/[.06] bg-[#10131B] p-5 text-center"><div><p className="text-xs text-[#858B9B]">{text}</p>{retry && <button onClick={() => void retry()} className="mt-3 rounded-xl border border-white/[.08] px-4 py-2 text-[9px] font-semibold">Try again</button>}</div></div>;
}
