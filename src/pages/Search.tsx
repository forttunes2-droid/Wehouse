import { useEffect, useMemo, useState } from 'react';
import { NIGERIA_STATES, getCitiesForState } from '@/data/nigeria-locations';
import ListingCard from '@/components/ListingCard';
import PropertyMapExplorer from '@/components/PropertyMapExplorer';
import SearchableSelect from '@/components/SearchableSelect';
import DiscoveryPriceRangeSlider from '@/components/DiscoveryPriceRangeSlider';
import DiscoveryShell, { DiscoveryEmpty, DiscoveryFilterSheet, DiscoveryToolbar } from '@/components/DiscoveryShell';
import { getDiscoverableHomes, type HomeStayType } from '@/lib/housing-discovery';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import type { Listing } from '@/types';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

type SearchProps = { onNavigate:(page:string,listingId?:string)=>void; savedIds:Set<string>; onToggleSave:(listingId:string)=>void };
type UserLocation = { lat:number; lng:number };
type View = 'list'|'map';

const LONG_FLOOR=180000;
const LONG_CEILING=5000000;
const SHORT_FLOOR=5000;
const SHORT_CEILING=500000;
function normalize(value:unknown){return String(value||'').trim().toLowerCase()}
function coords(listing:Listing){const row=listing as Listing&{gps_latitude?:number|null;gps_longitude?:number|null};const lat=Number(row.gps_latitude),lng=Number(row.gps_longitude);return Number.isFinite(lat)&&Number.isFinite(lng)?{lat,lng}:null}
function distanceKm(a:UserLocation,b:{lat:number;lng:number}){const R=6371,dLat=(b.lat-a.lat)*Math.PI/180,dLng=(b.lng-a.lng)*Math.PI/180,q=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;return 2*R*Math.asin(Math.sqrt(q))}

export default function Search({onNavigate,savedIds,onToggleSave}:SearchProps){
 const {getNumber}=usePlatformSettings();
 const[listings,setListings]=useState<Listing[]>([]),[loading,setLoading]=useState(true);
 const[stayType,setStayType]=useState<HomeStayType>('long_stay');
 const[priceMin,setPriceMin]=useState<number|''>(''),[priceMax,setPriceMax]=useState<number|''>(''),[bedrooms,setBedrooms]=useState<number|''>('');
 const[filterState,setFilterState]=useState(''),[filterCity,setFilterCity]=useState(''),[showFilters,setShowFilters]=useState(false);
 const[userLocation,setUserLocation]=useState<UserLocation|null>(null),[locating,setLocating]=useState(false),[locationError,setLocationError]=useState(''),[radius,setRadius]=useState<number|''>(''),[view,setView]=useState<View>('list'),[savingSearch,setSavingSearch]=useState(false);

 useEffect(()=>{const saved=sessionStorage.getItem('search_property_type');if(saved==='short_let'||saved==='long_stay')setStayType(saved);sessionStorage.removeItem('search_property_type')},[]);
 useEffect(()=>{let active=true;void(async()=>{const{homes}=await getDiscoverableHomes();if(active){setListings(homes||[]);setLoading(false)}})();return()=>{active=false}},[]);

 const citiesForState=useMemo(()=>getCitiesForState(filterState),[filterState]);
 const stateOptions=useMemo(()=>NIGERIA_STATES.map(item=>({value:item.state,label:item.state})),[]);
 const cityOptions=useMemo(()=>citiesForState.map(city=>({value:city,label:city})),[citiesForState]);
 const priceScale=useMemo(()=>stayType==='short_let'
   ? {floor:getNumber('home_short_stay_min_price',SHORT_FLOOR),ceiling:getNumber('home_short_stay_max_price',SHORT_CEILING),step:1000}
   : {floor:getNumber('home_long_stay_min_price',LONG_FLOOR),ceiling:getNumber('home_long_stay_max_price',LONG_CEILING),step:10000},[stayType,getNumber]);

 const filtered=useMemo(()=>listings.map(listing=>{const c=coords(listing);return{listing,distance:userLocation&&c?distanceKm(userLocation,c):null}}).filter(({listing,distance})=>{
   if(listing.sub_type!==stayType)return false;
   const price=Number(listing.price||0);if(priceMin!==''&&(price<=0||price<priceMin))return false;if(priceMax!==''&&(price<=0||price>priceMax))return false;
   if(bedrooms&&Number(listing.bedrooms||0)<bedrooms)return false;
   if(filterState&&normalize(listing.state)!==normalize(filterState))return false;if(filterCity&&normalize(listing.city)!==normalize(filterCity))return false;
   if(radius&&(distance==null||distance>radius))return false;return true;
 }).sort((a,b)=>userLocation?(a.distance??Infinity)-(b.distance??Infinity):0),[listings,stayType,priceMin,priceMax,bedrooms,filterState,filterCity,userLocation,radius]);

 const mappedCount=useMemo(()=>filtered.filter(({listing})=>Boolean(coords(listing))).length,[filtered]);
 useEffect(()=>{if(view==='map'&&mappedCount===0)setView('list')},[view,mappedCount]);
 const priceActive=priceMin!==''||priceMax!=='';
 const filterCount=[bedrooms,filterState,filterCity,radius].filter(Boolean).length+(priceActive?1:0);
 const hasFilters=Boolean(filterCount||userLocation);
 function clearFilters(){setPriceMin('');setPriceMax('');setBedrooms('');setFilterState('');setFilterCity('');setRadius('');setUserLocation(null);setLocationError('')}
 function chooseStay(next:HomeStayType){if(next===stayType)return;setStayType(next);setPriceMin('');setPriceMax('');setView('list')}
 function chooseState(value:string){setFilterState(value);setFilterCity('')}
 function useLocation(){if(!navigator.geolocation){setLocationError('Current location is not available on this device.');return}setLocating(true);setLocationError('');navigator.geolocation.getCurrentPosition(position=>{setUserLocation({lat:position.coords.latitude,lng:position.coords.longitude});setLocating(false)},()=>{setLocating(false);setLocationError('Allow location access to use distance filtering.')},{enableHighAccuracy:true,timeout:15000,maximumAge:60000})}
 async function followSearch(){setSavingSearch(true);const name=`${stayType==='short_let'?'Short Let':'Long Let'}${filterCity?` · ${filterCity}`:filterState?` · ${filterState}`:''}`;const{error}=await supabase.rpc('save_my_property_search',{p_name:name,p_search_kind:'homes',p_criteria:{sub_type:stayType,state:filterState,city:filterCity,min_price:priceMin===''?null:priceMin,max_price:priceMax===''?null:priceMax,bedrooms:bedrooms===''?null:bedrooms}});setSavingSearch(false);if(error)return toast.error(error.message||'Search could not be followed');toast.success('Search followed. Matching new homes will appear in Notifications.')}
 const modeLabel=stayType==='short_let'?'Short Let':'Long Let';
 const locationSummary=filterCity?`${filterCity}, ${filterState}`:filterState?filterState:`${modeLabel} homes`;
 const emptyTitle=priceActive?`No ${modeLabel} homes match this ${stayType==='short_let'?'nightly':'annual'} price range`:`No ${modeLabel} homes match these filters`;

 return <DiscoveryShell active="homes" title="Find a place that fits" description="Properties, hotels, compatible roommates and trusted WeHouse Services—together in one place." onNavigate={onNavigate}>
  <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
   <DiscoveryToolbar showSearch={false} toolbarLabel={locationSummary} onFilters={()=>setShowFilters(true)} filterCount={filterCount}>
    {mappedCount>0&&<div className="ml-auto flex rounded-xl border border-white/[.07] bg-[#171B24] p-1"><button type="button" onClick={()=>setView('list')} className={`rounded-lg px-3 py-1.5 text-[9px] font-semibold ${view==='list'?'bg-violet-500 text-white':'text-[#73798A]'}`}>List</button><button type="button" onClick={()=>setView('map')} className={`rounded-lg px-3 py-1.5 text-[9px] font-semibold ${view==='map'?'bg-violet-500 text-white':'text-[#73798A]'}`}>Map</button></div>}
   </DiscoveryToolbar>
   <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold">{loading?'Loading homes…':`${filtered.length} ${filtered.length===1?'home':'homes'}`}</p><p className="mt-1 text-[9px] text-[#666D7E]">{modeLabel}</p></div><div className="flex items-center gap-3">{hasFilters&&<button type="button" disabled={savingSearch} onClick={()=>void followSearch()} className="rounded-full border border-violet-500/20 px-3 py-2 text-[9px] font-semibold text-violet-300 disabled:opacity-40">{savingSearch?'Saving…':'Follow search'}</button>}{hasFilters&&<button type="button" onClick={clearFilters} className="text-[9px] font-semibold text-[#858A99]">Clear</button>}</div></div>
   {loading?<div className="grid min-h-56 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>:filtered.length===0?<DiscoveryEmpty title={emptyTitle} text="Change the selected filters to see other homes."/>:view==='map'?<PropertyMapExplorer items={filtered} userLocation={userLocation} radius={radius} onOpen={listing=>onNavigate('detail',listing.id)}/>:<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filtered.map(({listing,distance})=><ListingCard key={listing.id} listing={listing} distanceKm={distance} onClick={()=>onNavigate('detail',listing.id)} isSaved={savedIds.has(listing.id)} onToggleSave={event=>{event.stopPropagation();onToggleSave(listing.id)}}/>)}</div>}
  </main>

  {showFilters&&<DiscoveryFilterSheet title="Find your home" onClose={()=>setShowFilters(false)} onClear={clearFilters} resultLabel={`Show ${filtered.length} ${filtered.length===1?'home':'homes'}`}>
   <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/[.07] bg-[#151922] p-1.5"><button type="button" onClick={()=>chooseStay('long_stay')} className={`rounded-xl px-3 py-2.5 text-[10px] font-semibold ${stayType==='long_stay'?'bg-violet-500 text-white':'text-[#7E8494]'}`}>Long Let</button><button type="button" onClick={()=>chooseStay('short_let')} className={`rounded-xl px-3 py-2.5 text-[10px] font-semibold ${stayType==='short_let'?'bg-violet-500 text-white':'text-[#7E8494]'}`}>Short Let</button></div>
   <div className="grid grid-cols-2 gap-3"><SearchableSelect label="State" value={filterState} onChange={chooseState} options={stateOptions} placeholder="Any State" searchPlaceholder="Search State" /><SearchableSelect label="LGA" value={filterCity} onChange={setFilterCity} options={cityOptions} placeholder={filterState?'Any LGA':'Choose State'} searchPlaceholder="Search LGA" disabled={!filterState} /></div>
   <DiscoveryPriceRangeSlider label={stayType==='short_let'?'Nightly price':'Annual rent'} floor={priceScale.floor} ceiling={priceScale.ceiling} step={priceScale.step} minValue={priceMin} maxValue={priceMax} onMinChange={setPriceMin} onMaxChange={setPriceMax}/>
   <SearchableSelect label="Bedrooms" value={bedrooms===''?'':String(bedrooms)} onChange={value=>setBedrooms(value?Number(value):'')} options={[{value:'1',label:'1+'},{value:'2',label:'2+'},{value:'3',label:'3+'},{value:'4',label:'4+'}]} placeholder="Any" searchPlaceholder="Bedrooms" />
   {mappedCount>0&&<section className="rounded-2xl border border-white/[.07] bg-[#151922] p-3.5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-medium text-[#7B8190]">Distance</p><p className="mt-1 text-[8px] text-[#62697A]">Optional</p></div><button type="button" onClick={useLocation} disabled={locating} className="h-10 rounded-xl border border-white/[.08] px-3 text-[9px] font-semibold text-[#C7CBD5] disabled:opacity-50">{locating?'Finding…':userLocation?'Refresh':'Use my location'}</button></div>{locationError&&<p className="mt-2 text-[8px] text-amber-300">{locationError}</p>}{userLocation&&<div className="mt-3"><SearchableSelect label="Radius" value={radius===''?'':String(radius)} onChange={value=>setRadius(value?Number(value):'')} options={[{value:'',label:'Any distance'},{value:'2',label:'Within 2 km'},{value:'5',label:'Within 5 km'},{value:'10',label:'Within 10 km'},{value:'20',label:'Within 20 km'}]} placeholder="Any distance" searchPlaceholder="Search distance" /></div>}</section>}
  </DiscoveryFilterSheet>}
 </DiscoveryShell>
}
