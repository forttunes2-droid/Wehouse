import WeHouseLoadingState from "@/components/WeHouseLoadingState";
import WeHouseChoice from "@/components/WeHouseChoice";
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { isIOS, isNative } from '@/lib/native';
import { getNativeStorePlan, purchaseNativeStoreProduct, recoverPendingNativeSponsored, type NativeStorePlan } from '@/lib/nativePurchases';
import { formatRecordedMoney } from "@/lib/regional";
import { withTimeout } from '@/lib/withTimeout';
import { matchesSponsoredQuote, sponsoredPriceKobo } from '@/lib/sponsoredQuote';

type Resource = { resource_type: 'worker' | 'property' | 'hotel' | 'experience'; resource_id: string; label: string };
const resourceLabel=(type:Resource['resource_type'])=>({worker:'Service profile',property:'Home',hotel:'Hotel',experience:'Activity'})[type];
const formatMoney=(amount:number)=>formatRecordedMoney(amount,'NGN');
const promotionRequest=<T,>(request:PromiseLike<T>)=>withTimeout(request,20000,'Promotion options took too long. Please retry.');
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
  const [offerError,setOfferError]=useState('');
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError,setLoadError]=useState('');
  const refreshVersion=useRef(0),purchaseLock=useRef(false);
  const typesKey=types.join(',');
  const [accepted, setAccepted] = useState(false);
  const [storeOffers, setStoreOffers] = useState<StoreOffer[]>([]);
  const [storePlan, setStorePlan] = useState<NativeStorePlan | null>(null);
  const [storeError, setStoreError] = useState('');
  const nativeBillingEnabled = native && import.meta.env.VITE_NATIVE_BILLING_ENABLED === 'true';

  const refresh=useCallback(async()=>{
    const version=++refreshVersion.current;
    setLoading(true);setLoadError('');
    try{
    const [owned, history] = await promotionRequest(Promise.all([
      supabase.rpc('get_my_sponsored_resources'),supabase.rpc('get_my_sponsored_campaigns'),
    ]));
    if(version!==refreshVersion.current)return;
    if (owned.error || history.error) throw Error('Sponsored offers could not be loaded. Please retry.');
    const allowed=typesKey.split(',');
    const available = ((owned.data || []) as Resource[]).filter(item => allowed.includes(item.resource_type));
    setResources(available);
    setSelected(current => available.some(item => `${item.resource_type}:${item.resource_id}` === current)
      ? current : available.length ? `${available[0].resource_type}:${available[0].resource_id}` : '');
    setCampaigns(((history.data || []) as Campaign[]).filter(item => allowed.includes(item.resource_type)));
    }catch(e){if(version===refreshVersion.current)setLoadError(e instanceof Error?e.message:'Promotion options could not be loaded.');}
    finally{if(version===refreshVersion.current)setLoading(false);}
  },[typesKey]);
  useEffect(() => { void refresh();return()=>{refreshVersion.current++;}; }, [refresh]);
  useEffect(() => {
    if (!nativeBillingEnabled) return;
    void recoverPendingNativeSponsored().then(count => {
      if (count) { toast.info('A pending store order was checked'); void refresh(); }
    }).catch(reason => toast.error(reason instanceof Error ? reason.message : 'Store order recovery needs support'));
  }, [nativeBillingEnabled,refresh]);
  useEffect(() => {
    const resource = resources.find(item => `${item.resource_type}:${item.resource_id}` === selected);
    setOffer(null); setOfferError(''); setDuration(0); setAccepted(false); setStoreOffers([]);
    if (!resource) return;
    let live = true;
    void promotionRequest(supabase.rpc('get_my_sponsored_offer', {
      p_resource_type: resource.resource_type, p_resource_id: resource.resource_id,
    })).then(({ data, error }) => {
      if (!live) return;
      if (error) throw Error(error.message || 'Sponsored offer could not be loaded');
      const next = data as Offer;
      setOffer(next);
      setDuration(next.durations?.[0] || 0);
      if (nativeBillingEnabled && next.available) {
        void promotionRequest(supabase.rpc('get_my_sponsored_store_offers', {
          p_resource_type: resource.resource_type, p_resource_id: resource.resource_id,
        })).then(({ data: products, error: productsError }) => {
          if (!live) return;
          if (productsError) setStoreError('Store offers could not be loaded');
          else setStoreOffers((products || []) as StoreOffer[]);
        }).catch(()=>{if(live)setStoreError('Store offers could not be loaded. Please retry.');});
      }
    }).catch(e=>{if(live)setOfferError(e instanceof Error?e.message:'Sponsored offer could not be loaded');});
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
    if (!resource || !offer?.available || !duration || !accepted || purchaseLock.current) return;
    purchaseLock.current=true;
    setBusy(true);
    try {
      const { data: quote, error: quoteError } = await promotionRequest(supabase.rpc('quote_my_sponsored_campaign', {
        p_resource_type: resource.resource_type, p_resource_id: resource.resource_id,
        p_duration_days: duration,
      }));
      const expectedKobo = sponsoredPriceKobo(Number(offer.daily_price_ngn) * duration);
      if (quoteError || !matchesSponsoredQuote(quote, resource.resource_type, resource.resource_id, duration, expectedKobo))
        throw new Error(quoteError?.message || 'The offer changed. Review the refreshed price before continuing.');
      const { data: draft, error: draftError } = await promotionRequest(supabase.rpc('prepare_my_sponsored_campaign', {
        p_resource_type: resource.resource_type, p_resource_id: resource.resource_id,
        p_duration_days: duration,
      }));
      if (draftError || !draft?.campaign_id || !matchesSponsoredQuote(draft, resource.resource_type, resource.resource_id, duration, expectedKobo))
        throw new Error(draftError?.message || 'The campaign no longer matches this offer. Review it before paying.');
      if (native) {
        if (!nativeBillingEnabled || !storePlan || !selectedStoreOffer)
          throw new Error('This app store product is unavailable');
        const { data: order, error: orderError } = await promotionRequest(supabase.rpc('begin_my_sponsored_store_checkout', {
          p_campaign_id: draft.campaign_id, p_platform: isIOS() ? 'apple' : 'google',
        }));
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
      const { data: checkout, error: checkoutError } = await promotionRequest(supabase.functions.invoke('sponsored-payment-init', {
        body: { campaign_id: draft.campaign_id, expected_amount_ngn: Number(quote.amount_ngn) },
      }));
      if (checkoutError || !checkout?.authorization_url)
        throw new Error(checkout?.error || checkoutError?.message || 'Checkout could not start');
      window.location.assign(String(checkout.authorization_url));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sponsored checkout could not start');
      setBusy(false);
      await refresh();
    }finally{purchaseLock.current=false;setBusy(false);}
  }

  const total = Number(offer?.daily_price_ngn || 0) * duration;
  return <section aria-labelledby="sponsored-title" className="border-y border-[var(--wh-border-subtle)] text-[var(--wh-text)]">
    <div className="border-b border-[var(--wh-border-subtle)] py-4">
      <p className="text-xs font-bold uppercase tracking-[.16em] text-violet-700 dark:text-violet-300">Optional promotion</p>
      <h2 id="sponsored-title" className="mt-1 text-base font-semibold">Sponsored placement</h2>
      <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--wh-text-secondary)]">Promote one eligible item in a clearly marked Sponsored area. Each campaign belongs to that selection, not your entire account. Payment never changes verification, reviews, or organic order.</p>
    </div>
    <div className="py-4">
    {loadError&&<div role="alert" className="mb-4 space-y-2 text-sm"><p>{loadError}</p><button type="button" className="min-h-11 underline" onClick={()=>void refresh()}>Retry promotion options</button></div>}
    {loading ? <WeHouseLoadingState compact label="Loading your promotion options" /> : resources.length === 0
      ? <p className="rounded-2xl bg-[var(--wh-interactive)] p-4 text-xs leading-5 text-[var(--wh-text-secondary)]">There is nothing published and eligible to promote yet. Your existing campaign history appears below.</p>
      : <div className="space-y-4">
        <label className="block text-xs font-medium text-[var(--wh-text)]">Choose what to promote
          <WeHouseChoice className="mt-2 h-12 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3"
            aria-label="Promote" value={selected} onChange={e => setSelected(e.target.value)}>
            {resources.map(item => <option key={`${item.resource_type}:${item.resource_id}`}
              value={`${item.resource_type}:${item.resource_id}`}>{resourceLabel(item.resource_type)} · {item.label}</option>)}
          </WeHouseChoice>
        </label>
        {offerError?<div role="alert" className="space-y-2 text-sm"><p>{offerError}</p><button type="button" className="min-h-11 underline" onClick={()=>void refresh()}>Retry promotion price</button></div>:offer?.available ? <>
          <p className="text-xs leading-5 text-[var(--wh-text-secondary)]">{offer.market} · Market placement capacity: {offer.slot_count}</p>
          <label className="block text-xs font-medium text-[var(--wh-text)]">How long?
            <WeHouseChoice className="mt-2 h-12 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3"
              aria-label="Duration" value={duration} onChange={e => setDuration(Number(e.target.value))}>
              {(offer.durations || []).map(days => <option key={days} value={days}>{days} days</option>)}
            </WeHouseChoice>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-400/15 bg-violet-400/[.05] px-4 py-3">
            <span className="text-xs text-[var(--wh-text-secondary)]">{duration} days · {native ? 'Price in your app store' : `${formatMoney(Number(offer.daily_price_ngn))} per day`}</span>
            <strong className="shrink-0 text-base text-[var(--wh-text)]">{native ? storePlan?.price || 'Store price' : `${formatMoney(total)}`}</strong>
          </div>
          <label className="flex items-start gap-3 text-xs leading-5 text-[var(--wh-text-secondary)]">
            <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-violet-500" />
            <span>I understand this is a paid, time limited placement. Views and bookings are not guaranteed.</span>
          </label>
          {native && (!nativeBillingEnabled || !storePlan) ? <p role="status" className="rounded-xl border border-[var(--wh-border-subtle)] p-3 text-xs leading-5 text-[var(--wh-text-secondary)]">
            {storeError || `Sponsored purchases are unavailable in this ${isIOS() ? 'iOS' : 'Android'} build. Existing campaigns remain visible here.`}
          </p> : <button disabled={!accepted || busy || !duration} onClick={() => void purchase()}
            className="wh-motion-control min-h-12 w-full rounded-xl bg-violet-700 px-4 text-sm font-semibold text-white hover:bg-violet-800 dark:bg-violet-600 dark:hover:bg-violet-500 disabled:opacity-40">
            {busy ? 'Opening secure checkout…' : native ? `Continue to ${isIOS() ? 'App Store' : 'Google Play'} · ${storePlan?.price}`
              : `Continue to Paystack · ${formatMoney(total)}`}
          </button>}
          <p className="text-xs leading-5 text-[var(--wh-text-secondary)]">Placement begins only after the payment is verified and the resource remains eligible.</p>
        </> : <p className="rounded-2xl bg-[var(--wh-interactive)] p-4 text-xs leading-5 text-[var(--wh-text-secondary)]">Sponsored is not open for this resource’s market.</p>}
      </div>}
    {campaigns.length > 0 && <div className="mt-6 border-t border-[var(--wh-border-subtle)] pt-5">
      <h3 className="text-sm font-semibold">Your placements</h3>
      <ul className="mt-3 space-y-2">{campaigns.slice(0, 10).map(item => <li key={item.campaign_id} className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-[var(--wh-text)]">{resourceLabel(item.resource_type)} · {item.duration_days} days</p><p className="mt-1 text-xs text-[var(--wh-text-secondary)]">{formatMoney(Number(item.amount_ngn))}{item.ends_at ? ` · Ends ${new Date(item.ends_at).toLocaleDateString(undefined)}` : ''}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${item.status === 'active' && (!item.ends_at || new Date(item.ends_at) > new Date()) ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : item.status === 'paused' ? 'bg-amber-400/10 text-amber-700 dark:text-amber-200' : 'bg-[var(--wh-interactive)] text-[var(--wh-text-secondary)]'}`}>{item.status === 'active' && item.ends_at && new Date(item.ends_at) <= new Date() ? 'Expired' : item.status.replace(/_/g, ' ')}</span></div>
        {item.pause_reason && <p className="mt-3 text-xs leading-5 text-amber-800 dark:text-amber-200">WeHouse review: {item.pause_reason}</p>}
      </li>)}</ul>
    </div>}
    </div>
  </section>;
}
