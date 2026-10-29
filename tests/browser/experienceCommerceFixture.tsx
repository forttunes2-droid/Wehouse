import {useState} from 'react';
import {Toaster} from 'sonner';
import SponsoredCampaignPanel from '../../src/components/SponsoredCampaignPanel';
import ExperienceSessionsPanel from '../../src/components/ExperienceSessionsPanel';
import {CreatorExperienceDiscounts} from '../../src/components/ExperienceDiscountControls';
import {createRoot} from 'react-dom/client';
import ExperienceDiscovery from '../../src/components/ExperienceDiscovery';
import ExperienceBookingDetail from '../../src/components/ExperienceBookingDetail';
import ExperiencePublicationPanel from '../../src/components/ExperiencePublicationPanel';
import ExperienceHostBookings from '../../src/components/ExperienceHostBookings';
import ExperienceFinanceReviews from '../../src/components/ExperienceFinanceReviews';
import {CreatorAuthProvider} from '../../src/hooks/useCreatorAuth';
import CreatorAuthModal from '../../src/components/CreatorAuthModal';
import MyReservations from '../../src/pages/MyReservations';
import {fixtureProfile} from './authFixture';
import '../../src/index.css';
const params=new URLSearchParams(location.search),mode=params.get('mode')||'discovery';
const aid='91000000-0000-4000-8000-000000000001',bid='91000000-0000-4000-8000-000000000003';
function Fixture(){const [booking,setBooking]=useState<string|null>(mode.startsWith('customer')||mode==='host-ready'?bid:null);return <CreatorAuthProvider><main className="mx-auto min-h-screen max-w-7xl space-y-4 bg-[var(--wh-bg)] p-4 text-[var(--wh-text)]">
 {mode==='discount-host'?<ExperienceSessionsPanel activity={{id:aid,host_user_id:'host',revision:3,status:'approved',approved_from_revision:3,details:{country_code:'NG',timezone:'Africa/Lagos',duration_minutes:60} as never,created_at:'2026-10-20T10:00:00Z',updated_at:'2026-10-20T10:00:00Z'}} onDirtyChange={()=>{}}/>:mode==='discount-creator'?<CreatorExperienceDiscounts/>:mode==='sponsored'?<SponsoredCampaignPanel types={['worker','experience']}/>:mode==='finance'?<ExperienceFinanceReviews initialBookingId={params.get('id')}/>:mode==='publication'?<ExperiencePublicationPanel activity={{id:aid,host_user_id:'host',revision:3,status:'approved',details:{} as never,created_at:'2026-10-20T10:00:00Z',updated_at:'2026-10-20T10:00:00Z'}}/>:mode==='host-list'?<ExperienceHostBookings userId="host" onBack={()=>setBooking(null)}/>:mode==='bookings'?<MyReservations profile={{...fixtureProfile,user_id:'customer'}}/>:booking?<ExperienceBookingDetail id={booking} viewerId={mode==='host-ready'?'host':'customer'} onClose={()=>setBooking(null)}/>:<ExperienceDiscovery viewerId={mode==='promoted'?'customer':undefined} onBooking={id=>setBooking(id||null)}/>}
 </main><CreatorAuthModal/><Toaster/></CreatorAuthProvider>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
