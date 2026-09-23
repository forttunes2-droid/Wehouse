import HotelBookingChat from "../../src/components/HotelBookingChat";
import GuestBrowseEntry from "../../src/components/GuestBrowseEntry";
// Isolated test entry. Production builds do not import fixtures or mock auth.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import Saved from '../../src/pages/Saved';
import ListingDetail from '../../src/pages/ListingDetail';
import HotelDetailExperience from '../../src/pages/HotelDetailExperience';
import SharedPropertyCard from '../../src/components/SharedPropertyCard';
import Chat from '../../src/pages/Chat';
import Notifications from '../../src/pages/Notifications';
import { pendingPropertyShare } from '../../src/lib/propertyShare';
import { publicPropertyDestination } from '../../src/lib/publicPropertyDestination';
import { fixtureProfile } from './authFixture';
import '../../src/index.css';
const actor = { ...fixtureProfile, user_id: 'qa-personal', role: 'user' as const };
const mode = new URLSearchParams(location.search).get('mode') || 'saved';
function Fixture() {
 const [, setRenders] = useState(0);
 (window as any).__rerenderHotel = () => setRenders(value => value + 1);
 const [view, setView] = useState(mode), [id, setId] = useState(mode === 'long' ? 'long-home' : 'short-home');
 const [savedIds, setSavedIds] = useState(new Set(['short-home', 'long-home', 'unavailable-home']));
 const [conversationId, setConversationId] = useState('');
 const navigate = (page: string, record?: string) => {
   const target = publicPropertyDestination(page, record);
   (window as any).__destination = target;
   if (target) { setView(target.kind); setId(String(target.id)); }
 };
 const openChat = (conversation: string) => {
   (window as any).__draftAtOpen = pendingPropertyShare(actor.user_id, conversation);
   (window as any).__conversation = conversation;
   setConversationId(conversation); setView('chat');
 };
 const back = () => setView('saved');
 if (view === 'hotel-chat') return <HotelBookingChat bookingId={42} conversationId="qa-hotel-chat" profile={actor} title="Garden Lodge" onClose={() => setView('saved')} />;
 if (view === 'guest') return <main><GuestBrowseEntry onSignIn={() => { (window as any).__guestSignIn = true; }} /></main>;
 if (view === 'chat') return <Chat profile={actor} onNavigate={navigate} conversationId={conversationId} onConversationClose={back} conversationOnly />;
 if (view === 'listing' || view === 'short' || view === 'long') return <ListingDetail listingId={id} profile={actor} isSaved onToggleSave={() => {}} onNavigate={back} onGoToChat={openChat} onOpenBooking={reservationId => { (window as any).__booking = reservationId; setView('booking-target'); }} />;
 if (view === 'booking-target') return <main><h1>Existing booking destination</h1><p>{(window as any).__booking}</p></main>;
 if (view === 'hotel') return <HotelDetailExperience hotelId={Number(id)} profile={actor} onBack={back} onBook={() => {}} onGoToChat={openChat} />;
 if (view === 'received') return <main className="min-h-screen bg-[#090B10] p-5 text-white"><h1>A shared place</h1><SharedPropertyCard property={{ kind: 'hotel', id: '7' }} onOpen={navigate} /></main>;
 if (view === 'activity') return <Notifications profile={actor} scope="property_partner" onNavigate={(page, record) => { (window as any).__activityDestination = { page, record }; }} />;
 return <Saved profile={actor} onNavigate={navigate} savedIds={savedIds} onBack={() => {}} onToggleSave={value => setSavedIds(current => { const next = new Set(current); next.delete(value); return next; })} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /><Toaster /></StrictMode>);
