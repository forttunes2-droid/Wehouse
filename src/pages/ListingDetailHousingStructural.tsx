import { useEffect, useState } from 'react';
import type { Listing, Profile } from '@/types';
import { getListing } from '@/lib/supabase/listings';
import LegacyLongStayDetail from './ListingDetail';
import ShortStayListingDetail from './ShortStayListingDetail';

type Props={listingId:string;onNavigate:()=>void;isSaved:boolean;onToggleSave:()=>void;profile:Profile;onGoToChat:(convId:string)=>void};

export default function ListingDetailHousingStructural(props:Props){
 const[listing,setListing]=useState<Listing|null>(null),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;void(async()=>{const{listing:row}=await getListing(props.listingId);if(active){setListing(row);setLoading(false)}})();return()=>{active=false}},[props.listingId]);
 if(loading)return <div className="grid min-h-[70dvh] place-items-center bg-[#090A0F]"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>;
 if(listing?.sub_type==='short_let')return <ShortStayListingDetail listing={listing} profile={props.profile} onNavigate={props.onNavigate} isSaved={props.isSaved} onToggleSave={props.onToggleSave}/>;
 return <LegacyLongStayDetail {...props}/>;
}
