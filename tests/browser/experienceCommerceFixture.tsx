import {useState} from 'react';
import {Toaster} from 'sonner';
import {createRoot} from 'react-dom/client';
import SponsoredCampaignPanel from '../../src/components/SponsoredCampaignPanel';
import ExperienceSessionsPanel from '../../src/components/ExperienceSessionsPanel';
import {CreatorExperienceDiscounts} from '../../src/components/ExperienceDiscountControls';
import ExperienceDiscovery from '../../src/components/ExperienceDiscovery';
import ExperienceBookingDetail from '../../src/components/ExperienceBookingDetail';
import ExperiencePublicationPanel from '../../src/components/ExperiencePublicationPanel';
import ExperienceHostBookings from '../../src/components/ExperienceHostBookings';
import ExperienceFinanceReviews from '../../src/components/ExperienceFinanceReviews';
import WorkerActivationHome from '../../src/components/WorkerActivationHome';
import WorkerWorkspaceModern from '../../src/pages/WorkerWorkspaceModern';
import {useProviderWorkspaceCapabilities} from '../../src/hooks/useProviderWorkspaceCapabilities';
import type {ExperienceActivity} from '../../src/lib/experienceActivities';
import {CreatorAuthProvider} from '../../src/hooks/useCreatorAuth';
import CreatorAuthModal from '../../src/components/CreatorAuthModal';
import MyReservations from '../../src/pages/MyReservations';
import {fixtureProfile} from './authFixture';
import '../../src/index.css';

const params=new URLSearchParams(location.search),mode=params.get('mode')||'discovery';
const aid='91000000-0000-4000-8000-000000000001',bid='91000000-0000-4000-8000-000000000003';
const approvedActivity:ExperienceActivity={id:aid,host_user_id:'host',revision:3,status:'approved',approved_from_revision:2,details:{title:'Campus guided walk',country_code:'NG',timezone:'Africa/Lagos',duration_minutes:60,max_group_size:8} as never,created_at:'2026-10-20T10:00:00Z',updated_at:'2026-10-20T10:00:00Z'};
function ProviderHome({onOpen}:{onOpen:(id?:string)=>void}){
 const access=useProviderWorkspaceCapabilities('host','pending');
 if(access.loading)return <p role="status">Loading workspace...</p>;
 if(access.error)return <div role="alert"><p>{access.error}</p><button onClick={access.refresh}>Refresh workspace</button></div>;
 return <WorkerActivationHome profile={{...fixtureProfile,user_id:'host'}} onProfile={()=>{}} onVerification={()=>{}} onExperiences={()=>{}} activityBookings={access.capabilities?.experience_next} hasActivityBookings={access.capabilities?.has_activity_bookings} onActivityBooking={onOpen} onRefresh={access.refresh}/>;
}
function Fixture(){
 const [booking,setBooking]=useState<string|null>(mode.startsWith('customer')||mode==='host-ready'?bid:null),[hostList,setHostList]=useState(false);
 let body;
 if(mode==='provider-account')body=<WorkerWorkspaceModern profile={{...fixtureProfile,user_id:'host',role:'user',full_name:'Activity Provider',worker_status:null}} onGoToSetup={()=>{}} onLogout={()=>{}} activeWorkspace="worker"/>;
 else if(mode==='provider-overview')body=booking?<ExperienceBookingDetail id={booking} viewerId="host" onClose={()=>setBooking(null)}/>:hostList?<ExperienceHostBookings userId="host" onBack={()=>setHostList(false)}/>:<ProviderHome onOpen={id=>{if(id)setBooking(id);else setHostList(true);}}/>;
 else if(mode==='discount-host'||mode==='approved-dates')body=<ExperienceSessionsPanel activity={approvedActivity} onDirtyChange={dirty=>{(window as unknown as {__dateDirty:boolean}).__dateDirty=dirty;}}/>;
 else if(mode==='discount-creator')body=<CreatorExperienceDiscounts/>;
 else if(mode==='sponsored')body=<SponsoredCampaignPanel types={['worker','experience']}/>;
 else if(mode==='finance')body=<ExperienceFinanceReviews initialBookingId={params.get('id')}/>;
 else if(mode==='publication')body=<ExperiencePublicationPanel activity={approvedActivity}/>;
 else if(mode==='host-list')body=<ExperienceHostBookings userId="host" onBack={()=>setBooking(null)}/>;
 else if(mode==='bookings')body=<MyReservations profile={{...fixtureProfile,user_id:'customer'}}/>;
 else if(booking)body=<ExperienceBookingDetail id={booking} viewerId={mode==='host-ready'?'host':'customer'} onClose={()=>setBooking(null)}/>;
 else body=<ExperienceDiscovery viewerId={mode==='promoted'?'customer':undefined} onBooking={id=>setBooking(id||null)}/>;
 return <CreatorAuthProvider><main className="mx-auto min-h-screen max-w-7xl space-y-4 bg-[var(--wh-bg)] p-4 text-[var(--wh-text)]">{body}</main><CreatorAuthModal/><Toaster/></CreatorAuthProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
