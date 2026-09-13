import { useState } from 'react';
import { toast } from 'sonner';
import WorkerProBadge from '@/components/WorkerProBadge';
import WorkerProTools from '@/components/WorkerProTools';
import { supabase } from '@/lib/supabase';
import { isAndroid, isIOS, isNative } from '@/lib/native';
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

  async function subscribe(selectedBillingPeriod: WorkerProBillingPeriod) {
    if (!pro?.sales_enabled) return;
    if (isNative()) {
      toast.error('Native store billing is not connected in this build yet. Paid plan sales remain off until receipt verification is ready.');
      return;
    }
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

  if (loading) return <State text="Loading paid Worker plan…" />;
  if (error || !pro) return <State text={error || 'Paid Worker plan is unavailable'} retry={onRefresh} />;
  const storeName = isIOS() ? 'App Store' : isAndroid() ? 'Google Play' : 'Paystack';
  const native = isNative();
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
  const selectedPlan = requestedPlan?.web_available
    ? requestedPlan
    : planOptions.find((plan) => plan.web_available) || requestedPlan;
  const selectedBillingPeriod = selectedPlan?.billing_period || billingPeriod;
  const anyWebPlanAvailable = planOptions.some((plan) => plan.web_available);
  const checkoutAvailable = Boolean(pro.sales_enabled && selectedPlan?.web_available && !native);
  const activeUntil = pro.current_period_end ? new Date(pro.current_period_end).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-3xl border border-amber-300/15 bg-[radial-gradient(circle_at_top_right,rgba(245,190,48,.16),transparent_38%),#11131A] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <WorkerProBadge />
            <h2 className="mt-3 text-xl font-bold">{pro.product_name || 'WeHouse Works'}</h2>
            <p className="mt-2 max-w-xl text-[10px] leading-5 text-[#9196A5]">{pro.product_tagline || 'Run your work with clearer numbers, documents and reach.'} The gold PRO mark shows paid membership only; it never buys Reviewed, Trusted, jobs, organic ranking or favorable dispute treatment.</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-lg font-bold">{native ? 'Store price' : selectedPlan && selectedPlan.price_ngn > 0 ? `₦${Number(selectedPlan.price_ngn).toLocaleString()}` : '—'}</p>
            <p className="text-[8px] text-[#737887]">{native ? `shown by ${storeName}` : `per ${selectedBillingPeriod === 'yearly' ? 'year' : 'month'} on web`}</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{pro.active ? 'Plan is active' : 'Plan features'}</p>
            <p className="mt-1 text-[9px] text-[#707686]">{pro.active ? `${pro.cancel_at_period_end ? 'Access ends' : 'Current period ends'}${activeUntil ? ` ${activeUntil}` : ''}` : 'Business value beyond the gold PRO mark.'}</p>
          </div>
          {pro.active && <WorkerProBadge />}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {pro.features.map((feature) => <div key={feature} className="flex min-h-11 items-center gap-2 rounded-xl border border-white/[.05] bg-black/10 px-3 text-[10px] text-[#C9CCD5]"><span className="text-amber-300">✓</span>{feature}</div>)}
        </div>
        {!pro.active && pro.sales_enabled && anyWebPlanAvailable && !native && (
          <div className="mt-4 rounded-xl border border-white/[.07] bg-black/10 p-3">
            <div className="mb-3 grid grid-cols-2 gap-2" role="group" aria-label="Billing period">
              {planOptions.map((plan) => (
                <button
                  key={plan.billing_period}
                  type="button"
                  aria-pressed={selectedBillingPeriod === plan.billing_period}
                  disabled={!plan.web_available}
                  onClick={() => setBillingPeriod(plan.billing_period)}
                  className={`rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-40 ${selectedBillingPeriod === plan.billing_period ? 'border-amber-300/35 bg-amber-300/10' : 'border-white/[.06] bg-white/[.02]'}`}
                >
                  <span className="block text-[10px] font-semibold">{plan.label}</span>
                  <span className="mt-1 block text-[9px] text-[#8B90A0]">₦{Number(plan.price_ngn).toLocaleString()}</span>
                  {plan.billing_period === 'yearly' && plan.saving_ngn > 0 && (
                    <span className="mt-1 block text-[8px] font-semibold text-amber-200">Save ₦{Number(plan.saving_ngn).toLocaleString()} ({Number(plan.discount_percent).toLocaleString()}%)</span>
                  )}
                </button>
              ))}
            </div>
            <details>
              <summary className="cursor-pointer text-[10px] font-semibold text-[#D6D8DF]">Read paid plan subscription terms ({pro.terms_version || 'not published'})</summary>
              <p className="mt-3 max-h-44 overflow-y-auto whitespace-pre-wrap text-[9px] leading-5 text-[#858B9B]">{pro.terms_content || 'Subscription terms are not available. Sales must remain off.'}</p>
            </details>
            <label className="mt-3 flex cursor-pointer items-start gap-3 text-[9px] leading-5 text-[#B8BBC5]">
              <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} className="mt-1 h-4 w-4 accent-amber-300" />
              <span>I accept the current subscription terms. This {selectedBillingPeriod} plan renews automatically until I cancel, and cancellation preserves access through the paid period.</span>
            </label>
          </div>
        )}
        {pro.active ? (
          <button onClick={() => void manage()} disabled={busy} className="mt-4 h-11 w-full rounded-xl border border-white/[.08] bg-white/[.035] text-[10px] font-semibold disabled:opacity-40">{busy ? 'Opening…' : 'Manage or cancel subscription'}</button>
        ) : checkoutAvailable ? (
          <button onClick={() => void subscribe(selectedBillingPeriod)} disabled={busy || !termsAccepted || !pro.terms_content} className="mt-4 h-12 w-full rounded-xl bg-amber-300 text-[11px] font-bold text-[#241A03] disabled:opacity-40">{busy ? 'Opening secure checkout…' : `Choose ${selectedBillingPeriod} with ${storeName}`}</button>
        ) : native ? (
          <p className="mt-4 rounded-xl border border-violet-500/12 bg-violet-500/[.04] p-3 text-[9px] leading-5 text-violet-100/70">Native purchases will open only after verified {storeName} receipt handling and legal launch approval are deployed. Your free Worker profile and review status are unchanged.</p>
        ) : (
          <p className="mt-4 rounded-xl border border-violet-500/12 bg-violet-500/[.04] p-3 text-[9px] leading-5 text-violet-100/70">Paid Worker subscriptions are not open yet. Your free Worker profile, review status and job eligibility are unchanged.</p>
        )}
      </section>
      {pro.active ? <WorkerProTools profile={profile} /> : null}
    </div>
  );
}

function State({ text, retry }: { text: string; retry?: () => Promise<void> }) {
  return <div className="grid min-h-40 place-items-center rounded-2xl border border-white/[.06] bg-[#10131B] p-5 text-center"><div><p className="text-xs text-[#858B9B]">{text}</p>{retry && <button onClick={() => void retry()} className="mt-3 rounded-xl border border-white/[.08] px-4 py-2 text-[9px] font-semibold">Try again</button>}</div></div>;
}
