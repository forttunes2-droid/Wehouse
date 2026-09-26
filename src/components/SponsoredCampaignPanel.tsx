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

  return <section className="rounded-3xl border border-amber-300/15 bg-[#10131B] p-5 text-white">
    <p className="text-[9px] font-bold uppercase tracking-[.16em] text-amber-300">Sponsored · paid visibility</p>
    <h2 className="mt-2 text-lg font-semibold">Promote your {types.includes('worker') ? 'Worker profile' : 'home or hotel'}</h2>
    <p className="mt-2 text-xs leading-5 text-[#9196A5]">Sponsored appears separately among matching results. It does not change reviews, verification, trust or organic order. Placement starts only after payment is verified.</p>
    {loading ? <p className="mt-4 text-xs">Loading offers…</p> : resources.length === 0
      ? <p className="mt-4 text-xs text-[#A0A5B2]">An eligible, published resource is required before promotion.</p>
      : <div className="mt-4 space-y-3">
        <label className="block text-xs">Promote
          <select className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-[#171B24] px-3"
            value={selected} onChange={e => setSelected(e.target.value)}>
            {resources.map(item => <option key={`${item.resource_type}:${item.resource_id}`}
              value={`${item.resource_type}:${item.resource_id}`}>{item.resource_type === 'property' ? 'Home' : item.resource_type === 'hotel' ? 'Hotel' : 'Worker'} · {item.label}</option>)}
          </select>
        </label>
        {offer?.available ? <>
          <p className="text-xs text-[#A0A5B2]">{offer.market} · {offer.slot_count} slots{native ? ' · store price at checkout' : ` · ₦${Number(offer.daily_price_ngn).toLocaleString('en-NG')} per day`}</p>
          <label className="block text-xs">Duration
            <select className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-[#171B24] px-3"
              value={duration} onChange={e => setDuration(Number(e.target.value))}>
              {(offer.durations || []).map(days => <option key={days} value={days}>{days} days{native ? '' : ` · ₦${(Number(offer.daily_price_ngn) * days).toLocaleString('en-NG')}`}</option>)}
            </select>
          </label>
          <label className="flex items-start gap-2 text-xs leading-5 text-[#B8BBC5]">
            <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-1 h-4 w-4 accent-amber-300" />
            <span>I understand this is paid, time limited visibility; it does not guarantee views or bookings.</span>
          </label>
          {native && (!nativeBillingEnabled || !storePlan) ? <p role="status" className="rounded-xl border border-white/10 p-3 text-xs leading-5 text-[#B8BBC5]">
            {storeError || `Sponsored purchases are unavailable in this ${isIOS() ? 'iOS' : 'Android'} build. Existing campaigns remain visible here.`}
          </p> : <button disabled={!accepted || busy} onClick={() => void purchase()}
            className="h-11 w-full rounded-xl bg-amber-400 px-4 text-xs font-semibold text-black disabled:opacity-40">
            {busy ? 'Opening secure checkout…' : native ? `Continue to ${isIOS() ? 'App Store' : 'Google Play'} · ${storePlan?.price}`
              : `Continue to Paystack · ₦${(Number(offer.daily_price_ngn) * duration).toLocaleString('en-NG')}`}
          </button>}
        </> : <p className="text-xs text-[#A0A5B2]">Sponsored is not open for this resource’s market.</p>}
      </div>}
    {campaigns.length > 0 && <div className="mt-5 border-t border-white/10 pt-4">
      <h3 className="text-xs font-semibold">Your campaigns</h3>
      <ul className="mt-2 space-y-2 text-xs text-[#B8BBC5]">{campaigns.slice(0, 10).map(item => <li key={item.campaign_id} className="rounded-xl border border-white/5 p-3">
        {item.resource_type === 'property' ? 'Home' : item.resource_type === 'hotel' ? 'Hotel' : 'Worker'} · {item.duration_days} days · ₦{Number(item.amount_ngn).toLocaleString('en-NG')} · <strong>{item.status === 'active' && item.ends_at && new Date(item.ends_at) <= new Date() ? 'expired' : item.status}</strong>
        {item.ends_at && <span className="block text-[#858B9B]">Ends {new Date(item.ends_at).toLocaleDateString()}</span>}
        {item.pause_reason && <span className="block text-amber-200">WeHouse review: {item.pause_reason}</span>}
      </li>)}</ul>
    </div>}
  </section>;
}
