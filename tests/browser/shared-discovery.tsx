import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import GuestBrowseEntry from '@/components/GuestBrowseEntry';
import Search from '@/pages/Search';
import HotelsHome from '@/pages/HotelsHome';
import ListingDetail from '@/pages/ListingDetailCore';
import HotelDetail from '@/pages/HotelDetailExperience';
import ShowcaseMediaThumbnail from '@/components/ShowcaseMediaThumbnail';
import LocationFilterFields from '@/components/LocationFilterFields';
import PrivacySecuritySettings from '@/pages/PrivacySecuritySettings';
import type { Profile } from '@/types';

function Fixture() {
  const [mode, setMode] = useState((window as any).__browse.mode);
  const [region,setRegion]=useState('');
  const [locality,setLocality]=useState('');
  const [savedIds, setSavedIds] = useState(new Set<string>());
  const actor = { user_id: 'qa-viewer', username: 'viewer', role: 'user' } as Profile;
  const signIn = () => { (window as any).__browse.requested = true; };
  (window as any).__switchBrowseMode = setMode;
  const navigate = (page: string, id?: string) => { (window as any).__browse.destination = { page, id }; };
  if (mode === 'privacy') return <PrivacySecuritySettings profile={actor} onUpdate={()=>{}} onBack={()=>setMode('homes')}/>;
  if (mode === 'locations') return <main className="p-4"><LocationFilterFields region={region} locality={locality} onRegionChange={setRegion} onLocalityChange={setLocality}/><output aria-label="Chosen region">{region}</output><output aria-label="Chosen local area">{locality}</output></main>;
  if (mode === 'thumbnail') return <main className="grid grid-cols-3 gap-1 p-4"><div className="aspect-[3/4]"><ShowcaseMediaThumbnail alt="Missing photo" mediaType="image" /></div><div className="aspect-[3/4]"><ShowcaseMediaThumbnail alt="Failed photo" mediaType="image" src="https://assets.wehouse.test/broken.jpg" /></div><div className="aspect-[3/4]"><ShowcaseMediaThumbnail alt="Failed video" mediaType="video" src="https://assets.wehouse.test/broken.mp4" /></div></main>;
  if (mode === 'public') return <GuestBrowseEntry active onSignIn={signIn}>{null}</GuestBrowseEntry>;
  if (mode === 'homes') return <Search savedIds={savedIds} onToggleSave={id => { (window as any).__browse.savedId = id; setSavedIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }} onNavigate={navigate} />;
  if (mode === 'hotels') return <HotelsHome key={(window as any).__browse.sessionKey||'guest'} sessionKey={(window as any).__browse.sessionKey||'guest'} onNavigate={navigate} />;
  if (mode === 'hotel') return <HotelDetail hotelId={7} profile={actor} onBack={() => setMode('hotels')} onBook={(...selection) => { (window as any).__browse.booking = selection; }} />;
  return <ListingDetail listingId="public-home" profile={actor} isSaved={false} onToggleSave={() => {}} onGoToChat={() => {}} onNavigate={() => setMode('homes')} onOpenBooking={() => {}} />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
