import { useEffect, useRef, type ReactNode } from 'react';
import { recordSponsoredImpression } from '@/hooks/useSponsoredDiscovery';
import { observeSponsoredVisibility } from '@/lib/sponsoredVisibility';

export default function SponsoredPlacement({campaignId,context,children}:{campaignId:string;context:'worker_discovery'|'home_discovery'|'hotel_discovery';children:ReactNode}){
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>root.current?observeSponsoredVisibility(root.current,()=>recordSponsoredImpression(campaignId,context)):undefined,[campaignId,context]);
 return <div ref={root} className="min-w-0">{children}</div>;
}
