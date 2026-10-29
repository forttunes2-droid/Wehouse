import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/withTimeout';

export type SponsoredResult = { campaign_id: string; resource_id: string };

export function useSponsoredDiscovery(resourceType: 'worker' | 'property' | 'hotel' | 'experience', state: string, lga: string, category = '', enabled = true) {
  const [results, setResults] = useState<SponsoredResult[]>([]);
  useEffect(() => {
    let live = true;
    setResults([]);
    if(!enabled)return;
    const timer = window.setTimeout(() => {
      void withTimeout(supabase.auth.getSession(),15000,'Session lookup timed out').then(({ data: session }) => {
        if (!live) return;
        if (!session.session && (resourceType === 'worker'||resourceType === 'experience')) { if (live) setResults([]); return; }
        return withTimeout(supabase.rpc('get_sponsored_discovery', {
          p_resource_type: resourceType, p_state: state || null,
          p_lga: lga || null, p_category: category || null, p_limit: 6,
        }),15000,'Sponsored discovery timed out').then(({ data, error }) => {
          if (live) setResults(error || !Array.isArray(data) ? [] : data.filter(item => item
            && typeof item.campaign_id === 'string' && typeof item.resource_id === 'string').slice(0,6));
        });
      }).catch(() => { if (live) setResults([]); });
    }, 250);
    return () => { live = false; window.clearTimeout(timer); };
  }, [resourceType, state, lga, category, enabled]);
  return results;
}

export function recordSponsoredImpression(campaignId: string, context: 'worker_discovery' | 'home_discovery' | 'hotel_discovery' | 'experience_discovery') {
  void withTimeout(supabase.auth.getSession(),15000,'Session lookup timed out').then(({ data }) => {
    if (data.session) return withTimeout(supabase.rpc('record_my_sponsored_impression', {
      p_campaign_id: campaignId, p_context: context,
    }),15000,'Impression recording timed out');
  }).catch(() => { /* Failed telemetry is not a confirmed impression. */ });
}

export function recordSponsoredOpen(campaignId: string) {
  void withTimeout(supabase.auth.getSession(),15000,'Session lookup timed out').then(({ data }) => {
    if (data.session) return withTimeout(supabase.rpc('record_my_sponsored_open', { p_campaign_id: campaignId }),15000,'Open recording timed out');
  }).catch(() => { /* Failed telemetry is not a confirmed open. */ });
}
