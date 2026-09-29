import WeHouseChoice from "@/components/WeHouseChoice";
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { isIOS, isNative } from '@/lib/native';
import { getNativeStorePlan, purchaseNativeStoreProduct, recoverPendingNativeSponsored, type NativeStorePlan } from '@/lib/nativePurchases';

type Resource = { resource_type: 'worker' | 'property' | 'hotel'; resource_id: string; label: string };
type Offer = { available: boolean; daily_price_ngn?: number; durations?: number[]; slot_count?: number; market?: string };
type Campaign = { campaign_id: string; resource_type: Resource['resource_type']; resource_id: string; status: string;
  duration_days: number; amount_ngn: number; starts_at: string | null; ends_at: string | null; pause_reason: string | null };
type StoreOffer = { duration_days: number; platform: 'apple' | 'google'; product_id: string };

export default function SponsoredCampaignPanel({ types }: { types: Array<Resource['resource_type']> }) {
  const native = isNative();
  const [resources, setResources] = useState<Resource[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState('');
  const [offer, setOffer] = useState<Offer | null>(null);
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [storeOffers, setStoreOffers] = useState<StoreOffer[]>([]);
  const [storePlan, setStorePlan] = useState<NativeStorePlan | null>(null);
  const [storeError, setStoreError] = useState('');
  const nativeBillingEnabled = native && import.meta.env.VITE_NATIVE_BILLING_ENABLED === 'true';

  async function refresh() {
    const [owned, history] = await Promise.all([
      supabase.rpc('get_my_sponsored_resources'),
      supabase.rpc('get_my_sponsored_campaigns'),
    ]);
    setLoading(false);
    if (owned.error || history.error) return toast.error('Sponsored offers could not be loaded');
    const available = ((owned.data || []) as Resource[]).filter(item => types.includes(item.resource_type));
    setResources(available);
    setSelected(current => available.some(item => `${item.resource_type}:${item.resource_id}` === current)
      ? current : available.length ? `${available[0].resource_type}:${available[0].resource_id}` : '');
    setCampaigns(((history.data || []) as Campaign[]).filter(item => types.includes(item.resource_type)));
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!nativeBillingEnabled) return;
    void recoverPendingNativeSponsored().then(count => {
      if (count) { toast.info('A pending store order was checked'); void refresh(); }
    }).catch(reason => toast.error(reason instanceof Error ? reason.message : 'Store order recovery needs support'));
  }, [nativeBillingEnabled]);
  useEffect(() => {
    const resource = resources.find(item => `${item.resource_type}:${item.resource_id}` === selected);
    setOffer(null); setDuration(0); setAccepted(false); setStoreOffers([]);
    if (!resource) return;
    let live = true;
    void supabase.rpc('get_my_sponsored_offer', {
      p_resource_type: resource.resource_type, p_resource_id: resource.resource_id,
    }).then(({ data, error }) => {
      if (!live) return;
      if (error) return toast.error(error.message || 'Sponsored offer could not be loaded');
      const next = data as Offer;
      setOffer(next);
      setDuration(next.durations?.[0] || 0);
      if (nativeBillingEnabled && next.available) {
        void supabase.rpc('get_my_sponsored_store_offers', {
          p_resource_type: resource.resource_type, p_resource_id: resource.resource_id,
        }).then(({ data: products, error: productsError }) => {
          if (!live) return;
          if (productsError) setStoreError('Store offers could not be loaded');
          else setStoreOffers((products || []) as StoreOffer[]);
        });
      }
    });
    return () => { live = false; };
  }, [resources, selected, nativeBillingEnabled]);
  const selectedStoreOffer = storeOffers.find(item => item.duration_days === duration
    && item.platform === (isIOS() ? 'apple' : 'google'));
  useEffect(() => {
    setStorePlan(null); setStoreError('');
    if (!nativeBillingEnabled || !selectedStoreOffer) return;
    let live = true;
    void getNativeStorePlan(selectedStoreOffer.product_id, 'consumable')
      .then(plan => { if (live) setStorePlan(plan); })
      .catch(reason => { if (live) setStoreError(reason instanceof Error ? reason.message : 'Store product unavailable'); });
    return () => { live = false; };
  }, [nativeBillingEnabled, selectedStoreOffer?.product_id]);

  async function purchase() {
    const resource = resources.find(item => `${item.resource_type}:${item.resource_id}` === selected);
    if (!resource || !offer?.available || !duration || !accepted || busy) return;
    setBusy(true);
    try {
      const { data: quote, error: quoteError } = await supabase.rpc('quote_my_sponsored_campaign', {
        p_resource_type: resource.resource_type, p_resource_id: resource.resource_id,
        p_duration_days: duration,
      });
      if (quoteError || Number(quote?.amount_ngn) <= 0) throw new Error(quoteError?.message || 'Price is unavailable');
      const { data: draft, error: draftError } = await supabase.rpc('prepare_my_sponsored_campaign', {
        p_resource_type: resource.resource_type, p_resource_id: resource.resource_id,
        p_duration_days: duration,
      });
      if (draftError || !draft?.campaign_id) throw new Error(draftError?.message || 'Campaign could not be prepared');
      if (native) {
        if (!nativeBillingEnabled || !storePlan || !selectedStoreOffer)
          throw new Error('This app store product is unavailable');
        const { data: order, error: orderError } = await supabase.rpc('begin_my_sponsored_store_checkout', {
          p_campaign_id: draft.campaign_id, p_platform: isIOS() ? 'apple' : 'google',
        });
        if (orderError || !order?.reference || order.product_id !== storePlan.productId)
          throw new Error(orderError?.message || 'Store order could not be prepared');
        const outcome = await purchaseNativeStoreProduct(storePlan, 'consumable',
          { reference: order.reference }, 'native-sponsored');
        await refresh();
        toast[outcome.success ? 'success' : 'error'](outcome.success
          ? 'Sponsored placement is active' : 'The store charged this order. Finance will review the placement.');
        setBusy(false);
        return;
      }
      const { data: checkout, error: checkoutError } = await supabase.functions.invoke('sponsored-payment-init', {
        body: { campaign_id: draft.campaign_id },
      });
      if (checkoutError || !checkout?.authorization_url)
        throw new Error(checkout?.error || checkoutError?.message || 'Checkout could not start');
      window.location.assign(String(checkout.authorization_url));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sponsored checkout could not start');
      setBusy(false);
      await refresh();
    }
  }

  const total = Number(offer?.daily_price_ngn || 0) * duration;
  return <section aria-labelledby="sponsored-title" className="overflow-hidden rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] text-[var(--wh-text)]">
    <div className="border-b border-[var(--wh-border-subtle)] px-5 py-5 sm:px-6">
      <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-violet-300">Optional promotion</p>
      <h2 id="sponsored-title" className="mt-1 text-lg font-semibold">Sponsored placement</h2>
      <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--wh-text-secondary)]">Show an eligible {types.includes('worker') ? 'Worker profile' : 'home or hotel'} in a clearly marked Sponsored area for a chosen period. Payment never changes verification, reviews, or organic order.</p>
    </div>
    <div className="px-5 py-5 sm:px-6">
    {loading ? <p role="status" className="text-xs text-[var(--wh-text-secondary)]">Loading your promotion options…</p> : resources.length === 0
      ? <p className="rounded-2xl bg-[var(--wh-interactive)] p-4 text-xs leading-5 text-[var(--wh-text-secondary)]">There is no published, eligible {types.includes('worker') ? 'Worker profile' : 'home or hotel'} to promote yet. Your existing campaign history appears below.</p>
      : <div className="space-y-4">
        <label className="block text-xs font-medium text-[#D7DAE3]">Choose what to promote
          <WeHouseChoice className="mt-2 h-12 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3"
            aria-label="Promote" value={selected} onChange={e => setSelected(e.target.value)}>
            {resources.map(item => <option key={`${item.resource_type}:${item.resource_id}`}
              value={`${item.resource_type}:${item.resource_id}`}>{item.resource_type === 'property' ? 'Home' : item.resource_type === 'hotel' ? 'Hotel' : 'Worker'} · {item.label}</option>)}
          </WeHouseChoice>
        </label>
        {offer?.available ? <>
          <p className="text-xs leading-5 text-[var(--wh-text-secondary)]">{offer.market} · {offer.slot_count} placement slots in this market</p>
          <label className="block text-xs font-medium text-[#D7DAE3]">How long?
            <WeHouseChoice className="mt-2 h-12 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3"
              aria-label="Duration" value={duration} onChange={e => setDuration(Number(e.target.value))}>
              {(offer.durations || []).map(days => <option key={days} value={days}>{days} days</option>)}
            </WeHouseChoice>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-400/15 bg-violet-400/[.05] px-4 py-3">
            <span className="text-xs text-[var(--wh-text-secondary)]">{duration} days · {native ? 'Price in your app store' : `₦${Number(offer.daily_price_ngn).toLocaleString('en-NG')} per day`}</span>
            <strong className="shrink-0 text-base text-white">{native ? storePlan?.price || 'Store price' : `₦${total.toLocaleString('en-NG')}`}</strong>
          </div>
          <label className="flex items-start gap-3 text-xs leading-5 text-[var(--wh-text-secondary)]">
            <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-violet-500" />
            <span>I understand this is a paid, time limited placement. Views and bookings are not guaranteed.</span>
          </label>
          {native && (!nativeBillingEnabled || !storePlan) ? <p role="status" className="rounded-xl border border-[var(--wh-border-subtle)] p-3 text-xs leading-5 text-[var(--wh-text-secondary)]">
            {storeError || `Sponsored purchases are unavailable in this ${isIOS() ? 'iOS' : 'Android'} build. Existing campaigns remain visible here.`}
          </p> : <button disabled={!accepted || busy || !duration} onClick={() => void purchase()}
            className="min-h-12 w-full rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-40">
            {busy ? 'Opening secure checkout…' : native ? `Continue to ${isIOS() ? 'App Store' : 'Google Play'} · ${storePlan?.price}`
              : `Continue to Paystack · ₦${total.toLocaleString('en-NG')}`}
          </button>}
          <p className="text-[11px] leading-5 text-[var(--wh-text-secondary)]">Placement begins only after the payment is verified and the resource remains eligible.</p>
        </> : <p className="rounded-2xl bg-[var(--wh-interactive)] p-4 text-xs leading-5 text-[var(--wh-text-secondary)]">Sponsored is not open for this resource’s market.</p>}
      </div>}
    {campaigns.length > 0 && <div className="mt-6 border-t border-[var(--wh-border-subtle)] pt-5">
      <h3 className="text-sm font-semibold">Your placements</h3>
      <ul className="mt-3 space-y-2">{campaigns.slice(0, 10).map(item => <li key={item.campaign_id} className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-white">{item.resource_type === 'property' ? 'Home' : item.resource_type === 'hotel' ? 'Hotel' : 'Worker'} · {item.duration_days} days</p><p className="mt-1 text-[11px] text-[var(--wh-text-secondary)]">₦{Number(item.amount_ngn).toLocaleString('en-NG')}{item.ends_at ? ` · Ends ${new Date(item.ends_at).toLocaleDateString('en-NG')}` : ''}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${item.status === 'active' && (!item.ends_at || new Date(item.ends_at) > new Date()) ? 'bg-emerald-500/10 text-emerald-300' : item.status === 'paused' ? 'bg-amber-400/10 text-amber-200' : 'bg-[var(--wh-interactive)] text-[var(--wh-text-secondary)]'}`}>{item.status === 'active' && item.ends_at && new Date(item.ends_at) <= new Date() ? 'Expired' : item.status.replace(/_/g, ' ')}</span></div>
        {item.pause_reason && <p className="mt-3 text-[11px] leading-5 text-amber-200">WeHouse review: {item.pause_reason}</p>}
      </li>)}</ul>
    </div>}
    </div>
  </section>;
}
