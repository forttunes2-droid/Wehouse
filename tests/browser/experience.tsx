import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import App from '../../src/App';
import CommunicationsWorkspace from '../../src/components/CommunicationsWorkspace';
import MyReservations from '../../src/pages/MyReservations';
import WeHouseChoice from '../../src/components/WeHouseChoice';
import { fixtureProfile } from './authFixture';
import '../../src/index.css';
import '../../src/operational-workspaces.css';
import '../../src/worker-discovery-responsive.css';
import '../../src/chat-mobile.css';
const messages = new URLSearchParams(window.location.search).get('fixture') === 'messages';
const bookings = new URLSearchParams(window.location.search).get('fixture') === 'bookings';
const choices = new URLSearchParams(window.location.search).get('fixture') === 'choices';
function ChoiceFixture() {
  const [city, setCity] = useState('Lafia');
  const [days, setDays] = useState(3);
  return <main className="min-h-screen bg-[#090B10] p-4 text-white"><h1 className="mb-5 text-xl">Choices</h1>
    <WeHouseChoice aria-label="City" value={city} onChange={event => setCity(event.target.value)} className="w-full rounded-xl border border-white/10 bg-[#171B24] px-3">
      {['Lafia','Akwanga','Keffi','Karu','Doma','Nasarawa','Toto','Obi','Wamba','Keana'].map(name => <option key={name} value={name}>{name}</option>)}
    </WeHouseChoice>
    <WeHouseChoice aria-label="Duration" value={days} onChange={event => setDays(Number(event.target.value))} className="mt-4 w-full rounded-xl border border-white/10 bg-[#171B24] px-3">
      <option value={3}>3 days</option><option value={7}>7 days</option>
    </WeHouseChoice>
    <WeHouseChoice aria-label="Unavailable role" value="" disabled onChange={() => {}} className="mt-4 w-full rounded-xl border border-white/10 bg-[#171B24] px-3">
      <option value="">Choose role</option>
    </WeHouseChoice>
    <p role="status" className="mt-4">{city} · {days} days</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode>
  {messages ? <main className="min-h-screen bg-[#0A0A0F] p-4 text-white"><h1 className="mb-8">Inbox</h1><CommunicationsWorkspace profile={fixtureProfile} scope="all" forcedView="inbox" hideViewTabs queue="all" onOpenContext={() => {}} /></main> : bookings ? <MyReservations profile={fixtureProfile} /> : choices ? <ChoiceFixture /> : <App />}
  <Toaster />
</StrictMode>);
