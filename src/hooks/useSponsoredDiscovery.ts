import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type SponsoredResult = { campaign_id: string; resource_id: string };

export function useSponsoredDiscovery(resourceType: 'worker' | 'property' | 'hotel', state: string, lga: string) {
  const [results, setResults] = useState<SponsoredResult[]>([]);
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void supabase.auth.getSession().then(({ data: session }) => {
        if (!session.session && resourceType === 'worker') { if (live) setResults([]); return; }
        return supabase.rpc('get_sponsored_discovery', {
          p_resource_type: resourceType, p_state: state || null,
          p_lga: lga || null, p_category: null, p_limit: 6,
        }).then(({ data, error }) => { if (live) setResults(error ? [] : (data || []) as SponsoredResult[]); });
      });
    }, 250);
    return () => { live = false; window.clearTimeout(timer); };
  }, [resourceType, state, lga]);
  return results;
}

export function recordSponsoredImpression(campaignId: string, context: 'worker_discovery' | 'home_discovery' | 'hotel_discovery') {
  void supabase.auth.getSession().then(({ data }) => {
    if (data.session) return supabase.rpc('record_my_sponsored_impression', {
      p_campaign_id: campaignId, p_context: context,
    });
  });
}

export function recordSponsoredOpen(campaignId: string) {
  void supabase.auth.getSession().then(({ data }) => {
    if (data.session) return supabase.rpc('record_my_sponsored_open', { p_campaign_id: campaignId });
  });
}
