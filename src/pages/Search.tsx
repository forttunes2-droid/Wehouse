import { useEffect, useMemo, useState } from 'react';
import { getAllListings } from '@/lib/supabase';
import { NIGERIA_STATES, getCitiesForState } from '@/data/nigeria-locations';
import ListingCard from '@/components/ListingCard';
import PropertyMapExplorer from '@/components/PropertyMapExplorer';
import SearchableSelect from '@/components/SearchableSelect';
import DiscoveryPriceSlider from '@/components/DiscoveryPriceSlider';
import DiscoveryShell, { DiscoveryEmpty, DiscoveryFilterSheet, DiscoveryToolbar } from '@/components/DiscoveryShell';
import type { Listing } from '@/types';

interface SearchProps { onNavigate:(page:string,listingId?:string)=>void;savedIds:Set<string>;onToggleSave:(listingId:string)=>void; }
type UserLocation={lat:number;lng:number};
type View='list'|'map';
function normalize(value:unknown){return String(value||'').trim().toLowerCase()}
function typeValue(listing:Listing){return String(listing.sub_type||listing.property_type||'').trim()}
function typeLabel(value:string){return value.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
function coords(listing:Listing){const r=listing as Listing&{gps_latitude?:number|null;gps_longitude?:number|null};const lat=Number(r.gps_latitude),lng=Number(r.gps_longitude);return Number.isFinite(lat)&&Number.isFinite(lng)?{lat,lng}:null}
function distanceKm(a:UserLocation,b:{lat:number;lng:number}){const R=6371,dLat=(b.lat-a.lat)*Math.PI/180,dLng=(b.lng-a.lng)*Math.PI/180,q=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;return 2*R*Math.asin(Math.sqrt(q))}

export default function Search({onNavigate,savedIds,onToggleSave}:SearchProps){
 const[listings,setListings]=useState<Listing[]>([]),[loading,setLoading]=useState(true),[query,setQuery]=useState(''),[priceMax,setPriceMax]=useState<number|''>(''),[bedrooms,setBedrooms]=useState<number|''>(''),[filterState,setFilterState]=useState(''),[filterCity,setFilterCity]=useState(''),[propertyType,setPropertyType]=useState(''),[showFilters,setShowFilters]=useState(false),[userLocation,setUserLocation]=useState<UserLocation|null>(null),[locating,setLocating]=useState(false),[locationError,setLocationError]=useState(''),[radius,setRadius]=useState<number|''>(''),[view,setView]=useState<View>('list');
 useEffect(()=>{const saved=sessionStorage.getItem('search_property_type');if(saved&&saved!=='hotel')setPropertyType(saved);sessionStorage.removeItem('search_property_type')},[]);
 useEffect(()=>{let active=true;void(async()=>{const{listings:data}=await getAllListings();if(active){setListings(data||[]);setLoading(false)}})();return()=>{active=false}},[]);
 const citiesForState=useMemo(()=>getCitiesForState(filterState),[filterState]);
 const types=useMemo(()=>{const m=new Map<string,number>();listings.forEach(l=>{const v=typeValue(l);if(v)m.set(v,(m.get(v)||0)+1)});return[...m.entries()].sort((a,b)=>b[1]-a[1]).map(([value,count])=>({value,label:typeLabel(value),count}))},[listings]);
 const stateOptions=useMemo(()=>NIGERIA_STATES.map(i=>({value:i.state,label:i.state})),[]);
 const cityOptions=useMemo(()=>citiesForState.map(city=>({value:city,label:city})),[citiesForState]);
 const typeOptions=useMemo(()=>types.map(i=>({value:i.value,label:i.label,meta:String(i.count)})),[types]);
 const priceBounds=useMemo(()=>{const prices=listings.map(item=>Number(item.price||0)).filter(price=>Number.isFinite(price)&&price>0);if(prices.length<2)return null;const minimum=Math.min(...prices),maximum=Math.max(...prices);return maximum>minimum?{minimum,maximum}:null},[listings]);
 const filtered=useMemo(()=>listings.map(listing=>{const c=coords(listing);return{listing,distance:userLocation&&c?distanceKm(userLocation,c):null}}).filter(({listing,distance})=>{const needle=normalize(query),hay=[listing.title,listing.address,listing.city,listing.state,listing.property_type,listing.sub_type].map(normalize).join(' ');if(needle&&!hay.includes(needle))return false;if(priceMax!==''&&Number(listing.price||0)<=0)return false;if(priceMax!==''&&Number(listing.price||0)>priceMax)return false;if(bedrooms&&Number(listing.bedrooms||0)<bedrooms)return false;if(filterState&&normalize(listing.state)!==normalize(filterState))return false;if(filterCity&&normalize(listing.city)!==normalize(filterCity))return false;if(propertyType&&normalize(typeValue(listing))!==normalize(propertyType))return false;if(radius&&(distance==null||distance>radius))return false;return true}).sort((a,b)=>userLocation?(a.distance??Infinity)-(b.distance??Infinity):0),[listings,query,priceMax,bedrooms,filterState,filterCity,propertyType,userLocation,radius]);
 const mappedCount=useMemo(()=>filtered.filter(({listing})=>Boolean(coords(listing))).length,[filtered]);
 useEffect(()=>{if(view==='map'&&mappedCount===0)setView('list')},[view,mappedCount]);
 const filterCount=[bedrooms,filterState,filterCity,propertyType,radius].filter(Boolean).length+(priceMax!==''?1:0);
 const hasFilters=Boolean(query||filterCount||userLocation);
 function clearFilters(){setQuery('');setPriceMax('');setBedrooms('');setFilterState('');setFilterCity('');setPropertyType('');setRadius('');setUserLocation(null);setLocationError('')}
 function chooseState(value:string){setFilterState(value);setFilterCity('');if(value){setUserLocation(null);setRadius('');setLocationError('')}}
 function useLocation(){if(!navigator.geolocation){setLocationError('Current location is not available on this device.');return}setLocating(true);setLocationError('');navigator.geolocation.getCurrentPosition(p=>{setUserLocation({lat:p.coords.latitude,lng:p.coords.longitude});setFilterState('');setFilterCity('');setLocating(false)},()=>{setLocating(false);setLocationError('Allow location access to search near you.')},{enableHighAccuracy:true,timeout:15000,maximumAge:60000})}
 return <DiscoveryShell active="homes" title="Homes" description="Find available homes by area, type, price or distance." onNavigate={onNavigate}>
  <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
   <DiscoveryToolbar value={query} onChange={setQuery} placeholder="Search home or area" onFilters={()=>setShowFilters(true)} filterCount={filterCount} locationLabel={userLocation?'Near me':'Use my location'} locationActive={!!userLocation} locationBusy={locating} onLocation={useLocation} onClearLocation={()=>{setUserLocation(null);setRadius('')}} locationDetail={locationError||(userLocation?'Using your current location.':'')}>
    {userLocation&&<label className="min-w-36"><span className="sr-only">Distance</span><SearchableSelect value={radius===''?'':String(radius)} onChange={value=>setRadius(value?Number(value):'')} options={[{value:'',label:'Any distance'},{value:'2',label:'Within 2 km'},{value:'5',label:'Within 5 km'},{value:'10',label:'Within 10 km'},{value:'20',label:'Within 20 km'}]} placeholder="Any distance" searchPlaceholder="Search distance" /></label>}
    {mappedCount>0&&<div className="ml-auto flex rounded-xl border border-white/[.07] bg-[#171B24] p-1"><button type="button" onClick={()=>setView('list')} className={`rounded-lg px-3 py-1.5 text-[9px] font-semibold ${view==='list'?'bg-violet-500 text-white':'text-[#73798A]'}`}>List</button><button type="button" onClick={()=>setView('map')} className={`rounded-lg px-3 py-1.5 text-[9px] font-semibold ${view==='map'?'bg-violet-500 text-white':'text-[#73798A]'}`}>Map</button></div>}
   </DiscoveryToolbar>

   <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold">{loading?'Loading homes…':`${filtered.length} ${filtered.length===1?'home':'homes'}`}</p><p className="mt-1 text-[9px] text-[#666D7E]">{userLocation?'Nearest available homes first':filterState?`Showing ${filterCity||filterState}`:'All available locations'}</p></div>{hasFilters&&<button type="button" onClick={clearFilters} className="text-[9px] font-semibold text-violet-300">Clear</button>}</div>

   {loading?<div className="grid min-h-56 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>:filtered.length===0?<DiscoveryEmpty title="No homes match this search" text="Change the location or filters and try again."/>:view==='map'?<PropertyMapExplorer items={filtered} userLocation={userLocation} radius={radius} onOpen={listing=>onNavigate('detail',listing.id)}/>:<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filtered.map(({listing,distance})=><ListingCard key={listing.id} listing={listing} distanceKm={distance} onClick={()=>onNavigate('detail',listing.id)} isSaved={savedIds.has(listing.id)} onToggleSave={event=>{event.stopPropagation();onToggleSave(listing.id)}}/>)}</div>}
  </main>

  {showFilters&&<DiscoveryFilterSheet title="Filter homes" onClose={()=>setShowFilters(false)} onClear={()=>{setPriceMax('');setBedrooms('');setFilterState('');setFilterCity('');setPropertyType('');setRadius('')}} resultLabel={`Show ${filtered.length} ${filtered.length===1?'home':'homes'}`} resultDisabled={filtered.length===0}>
   <div className="grid grid-cols-2 gap-3">
    <SearchableSelect label="State" value={filterState} onChange={chooseState} options={stateOptions} placeholder="Any State" searchPlaceholder="Search State" />
    <SearchableSelect label="LGA" value={filterCity} onChange={setFilterCity} options={cityOptions} placeholder={filterState?'Any LGA':'Choose State'} searchPlaceholder="Search LGA" disabled={!filterState} />
   </div>
   <div className="grid grid-cols-2 gap-3">
    <SearchableSelect label="Property type" value={propertyType} onChange={setPropertyType} options={typeOptions} placeholder="Any type" searchPlaceholder="Search type" />
    <SearchableSelect label="Bedrooms" value={bedrooms===''?'':String(bedrooms)} onChange={value=>setBedrooms(value?Number(value):'')} options={[{value:'1',label:'1+'},{value:'2',label:'2+'},{value:'3',label:'3+'},{value:'4',label:'4+'}]} placeholder="Any" searchPlaceholder="Bedrooms" />
   </div>
   {priceBounds&&<DiscoveryPriceSlider label="Maximum price" minimum={priceBounds.minimum} maximum={priceBounds.maximum} value={priceMax} onChange={setPriceMax}/>} 
  </DiscoveryFilterSheet>}
 </DiscoveryShell>
}