import { ReservationPanel } from '@/pages/ListingDetailCore';
import PropertyShareDialog from '@/components/PropertyShareDialog';
import WorkerShareDialog from '@/components/WorkerShareDialog';
import SharedPropertyCard from '@/components/SharedPropertyCard';
import { pendingPropertyShare } from '@/lib/propertyShare';
import { pendingWorkerShare } from '@/lib/workerShare';
import ServiceBookingOversight from '@/components/ServiceBookingOversight';
import PropertyBookingReview from '@/components/PropertyBookingReview';
import ExperienceSessionsPanel from '@/components/ExperienceSessionsPanel';
import PropertySiteOffers from "@/components/PropertySiteOffers";
import PartnerHotelDiscounts from "@/components/PartnerHotelDiscounts";
import PropertySiteSchedule from "@/components/PropertySiteSchedule";
import PropertyHostControls from "@/components/PropertyHostControls";
import AccountCenter from '@/pages/AccountCenter';
import ExperienceActivitiesPanel from '@/components/ExperienceActivitiesPanel';
import ExperienceActivityReviewQueue from '@/components/ExperienceActivityReviewQueue';
import PhoneNotificationSettings from '@/components/PhoneNotificationSettings';
import NativeSelectBridge from '@/components/NativeSelectBridge';
import FollowedSearches from '@/pages/FollowedSearches';
import Notifications from '@/pages/Notifications';
import EmailAccountSecurity from '@/components/EmailAccountSecurity';
import EmailSignupConfirmation from '@/components/EmailSignupConfirmation';
import NewLoginAlert from '@/components/NewLoginAlert';
import FriendsPanel from '@/components/FriendsPanel';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import DiscoveryPriceRangeSlider from '@/components/DiscoveryPriceRangeSlider';
import PayoutAccountManager from '@/components/PayoutAccountManager';
import StaffFinanceRecords from '@/components/StaffFinanceRecords';
import StaffFinanceSummary from '@/components/StaffFinanceSummary';
import PrivateCallCenter from '@/components/PrivateCallCenter';
import PropertyInspectionRequestPanel from '@/components/PropertyInspectionRequestPanel';
import HotelCancellationPanel from '@/components/HotelCancellationPanel';
import StaffInspectionWorkspaceV2 from '@/components/StaffInspectionWorkspaceV2';
import {SubmissionSummary} from '@/components/PropertyPipelineWorkspace';
import {PropertiesTab,PropertyDetails} from '@/pages/PropertyOwnerDashboard';
import HotelDetailExperience from '@/pages/HotelDetailExperience';
import AdminReports from '@/components/AdminReports';
import MyReports from '@/components/MyReports';
import ReportDialog from '@/components/ReportDialog';
import PropertyDocuments from '@/components/PropertyDocuments';
import WorkerCredentials from '@/components/WorkerCredentials';
import WorkerProfilePanel from '@/components/WorkerProfilePanel';
import WorkerAvailabilityControl from '@/components/WorkerAvailabilityControl';
import WeHouseToaster from '@/components/WeHouseToaster';
import WorkerWallet from '@/pages/WorkerWallet';
import PropertyPartnerFinancePanel from '@/components/PropertyPartnerFinancePanel';
import PropertyPartnerProWorkspace from '@/components/PropertyPartnerProWorkspace';
import PropertyArrivalInstructions from '@/components/PropertyArrivalInstructions';
import PropertyManagementPanel, { HostArrivalAction } from '@/components/PropertyManagementPanel';
import WorkerProPanel from '@/components/WorkerProPanel';
import { useWorkerPro } from '@/hooks/useWorkerPro';
import type { Profile } from '@/types';
const mode = new URLSearchParams(location.search).get('mode') || 'worker';
const profile = { user_id: 'wallet-qa-owner', email: 'wallet-owner@example.invalid', role: 'worker' } as Profile;
function WorkerTools() {
  const pro = useWorkerPro(profile.user_id);
  return <WorkerProPanel profile={profile} pro={pro.pro} loading={pro.loading} error={pro.error} onRefresh={pro.refresh} initialBusinessTools={mode==='worker-pro-reminder'} />;
}
function PriceControls() {
  const [min, setMin] = useState<number | ''>(2000);
  const [max, setMax] = useState<number | ''>(8000);
  return <DiscoveryPriceRangeSlider label="Price range" floor={1000} ceiling={10000} step={1000} minValue={min} maxValue={max} onMinChange={setMin} onMaxChange={setMax} />;
}
function ReportJourney() {
  const [view,setView] = useState(mode.startsWith('reports-generic')?'generic':'hotel');
  return <><nav className="mb-3 flex gap-2"><button onClick={()=>setView('hotel')}>Hotel fixture</button><button onClick={()=>setView('operator')}>Operator fixture</button><button onClick={()=>setView('reporter')}>Reporter fixture</button></nav>{view==='generic'?<ReportDialog subjectType="profile" subjectUserId="qa-owner" subjectName="Test profile" onClose={()=>setView('reporter')}/>:view==='operator'?<AdminReports/>:view==='reporter'?<MyReports/>:<HotelDetailExperience hotelId={42} onBack={()=>{}} onBook={()=>{}} profile={mode==='reports-signed-out'?null:profile} onRequireAuth={()=>{(window as any).__authRequested=true}}/>}</>;
}
function DocumentJourney() {
  const [operator,setOperator]=useState(mode==='documents-unconfigured');
  (window as any).__documentOperator=operator;
  return <><nav className="mb-4 flex flex-wrap gap-2"><button onClick={()=>setOperator(false)}>Partner documents</button><button onClick={()=>setOperator(true)}>Operations documents</button></nav><PropertyDocuments key={String(operator)} requestId="document-request" accountId={operator?'qa-reviewer':profile.user_id} operator={operator}/></>;
}
function CredentialJourney(){
 const [operator,setOperator]=useState(mode==='credentials-unconfigured');(window as any).__credentialOperator=operator;
 return <><nav className="mb-4 flex flex-wrap gap-3"><button onClick={()=>setOperator(false)}>Worker credentials</button><button onClick={()=>setOperator(true)}>Credential review</button></nav><WorkerCredentials key={String(operator)} workerId={profile.user_id} operator={operator}/></>;
}
function ShareJourney(){
 const [selected,setSelected]=useState<any>(null);
 const property={kind:mode.includes('hotel')?'hotel':'listing',id:mode.includes('hotel')?'42':'shared-home'} as const;
 const select=(audience:string,id:string)=>{const queued=mode.includes('service')?pendingWorkerShare(profile.user_id,id):pendingPropertyShare(profile.user_id,id);(window as any).__shareResult={audience,id,queued};setSelected(queued);};
 if(selected)return <div><p>Ready in selected chat</p>{!mode.includes('service')&&<SharedPropertyCard property={selected} onOpen={(page,id)=>{(window as any).__shareOpened={page,id};}}/>}</div>;
 return mode.includes('service')?<WorkerShareDialog userId={profile.user_id} worker={{id:'10100000-0000-4000-8000-000000000055'}} workerName='Test professional' onClose={()=>{}} onConversation={id=>select('roommate',id)} onFriendConversation={id=>select('friend',id)}/>:<PropertyShareDialog userId={profile.user_id} property={property} title='Shared place' onClose={()=>{}} onConversation={id=>select('roommate',id)} onFriendConversation={id=>select('friend',id)}/>;
}
createRoot(document.getElementById('root')!).render(<main className={mode.startsWith('email-')?"wh-auth-screen mx-auto min-h-screen max-w-lg p-5":"mx-auto min-h-screen max-w-3xl p-4 text-[var(--wh-text)]"}>
  {mode.startsWith('experience-applications')&&(mode.includes('review')?<ExperienceActivityReviewQueue initialApplicationId="10100000-0000-4000-8000-000000000091"/>:<ExperienceActivitiesPanel profile={profile} initialApplication={mode.includes('linked')?{id:'10100000-0000-4000-8000-000000000091',sequence:1}:null}/>)}
  {mode.startsWith('phone-')&&<PhoneNotificationSettings userId={profile.user_id}/>}
  {mode==='phone-select'&&<><label className="block min-w-0">Property type<select className="block w-full min-w-0 max-w-full" aria-label="Property type" defaultValue="home"><option value="home">Entire apartment</option><option value="room">Private room in a shared home with access to a shared kitchen</option></select></label><NativeSelectBridge/></>}
  {mode.startsWith('viewing-journey-') ? <ReservationPanel shortStay={false} reservation={{id:'viewing-booking',status:mode.endsWith('cancelled')?'cancelled':'reserved',stay_type:'long_stay',reservation_fee_status:'paid',reservation_fee_paid_at:'2026-10-23T10:00:00Z',rent_payment_status:mode.endsWith('unprotected')?'paid':'not_started',amount:5000}} inspection={mode.endsWith('scheduled')?{status:'scheduled',scheduled_date:'2026-11-01'}:mode.endsWith('completed')?{status:'completed'}:null} busy={false} fee={5000} onResume={()=>{}} onInspect={()=>{(window as any).__viewingAction='viewing';}} onRentPay={()=>{(window as any).__viewingAction='rent';}} onOpenBooking={()=>{(window as any).__viewingAction='booking';}} onSupport={()=>{}}/> : mode.startsWith('share-journey-') ? <ShareJourney/> : mode.startsWith('service-activity-') ? <ServiceBookingOversight initialRecordId='linked-job'/> : mode.startsWith('property-review-') ? <PropertyBookingReview reservationId='review-booking'/> : mode.startsWith('experience-sessions-') ? <ExperienceSessionsPanel activity={{id:'10100000-0000-4000-8000-000000000091',revision:1,status:'draft',details:{country_code:'NG',timezone:'Africa/Lagos',duration_minutes:60,max_group_size:8}} as any} onDirtyChange={()=>{}}/> : mode.startsWith('site-offers-') ? <PropertySiteOffers listingId="site-source" checkIn="2040-04-01" checkOut="2040-04-04" onOpen={id=>{(window as any).__siteOpened=id;}}/> : mode.startsWith('hotel-discount-') ? <PartnerHotelDiscounts hotelId={42} rooms={[]}/> : mode.startsWith('building-schedule-') ? <PropertySiteSchedule siteId="10100000-0000-4000-8000-000000000099" accountId="qa-owner"/> : mode.startsWith('hosting-controls-') ? <PropertyHostControls listingId="host-control-home"/> : mode==='space-review-field' ? <StaffInspectionWorkspaceV2 profile={profile}/> : mode.startsWith('space-review-operations') ? <SubmissionSummary stage="access_review" row={{id:'space-review-request',property_type:'apartment',sub_type:mode.endsWith('short')?'short_let':'long_stay',property_address:'12 Test Road',property_city:'Lafia',property_state:'Nasarawa',owner_name:'Test owner',request_code:'WH-TEST',expected_rent:mode.endsWith('short')?10000:600000,bedrooms:1,bathrooms:1,max_guests:2,space_scope:'private_room',space_label:'Home B / Room 1',shared_areas:['Kitchen','Entrance']}}/> : mode.startsWith('hotel-cancel-') ? <HotelCancellationPanel bookingId={71} onChanged={()=>{(window as any).__hotelChanged=true;}} onReview={()=>{(window as any).__hotelReview=true;}}/> : mode.startsWith('partner-assets-') ? <PropertiesTab profile={profile} assetKind="apartment"/> : mode.startsWith('partner-stays-') ? <PropertyDetails profile={profile} initialReservationId={mode.includes('linked')?'old-stay':undefined} property={{id:'management-home',title:'Compound home',space_label:'Home A / Room 1',site_label:'Lafia compound',space_scope:'private_room',shared_areas:['Kitchen','Entrance'],management_mode:'host',management_updated_at:'2026-10-19T10:00:00Z',_assignment_role:'manager'}} onBack={()=>{}}/> : mode.startsWith('property-spaces-') ? <PropertyInspectionRequestPanel profile={profile}/> : mode.startsWith('private-call') ? <PrivateCallCenter/> : mode.startsWith('experience-applications') ? null : mode.startsWith('worker-availability-') ? <WorkerAvailabilityControl profile={{...profile,available:false}}/> : mode.startsWith('worker-profile-') ? <WorkerProfilePanel profile={{...profile,full_name:'Test Worker',worker_status:'verified',worker_verified:true,worker_bio:'Professional electrician\nServices Offered:\nCareful electrical repairs and honest pricing.',worker_occupation:'Electrician'}} onEdit={()=>{}} onVerification={()=>{}}/> : mode.startsWith('credentials-') ? <CredentialJourney/> : mode.startsWith('phone-') ? null : mode.startsWith('notification-preference') ? <AccountCenter profile={{...profile,auth_id:'auth-wallet-owner',pref_push_notif:true}} onGoToPrivacy={()=>{}} onGoToSaved={()=>{}} onGoToSecurity={()=>{}} onGoToProfileEdit={()=>{}}/> : mode.startsWith('followed-') ? <FollowedSearches profile={profile} onBack={()=>{}} onNavigate={page=>{(window as any).__followedRoute=page;}}/> : mode.startsWith('activity-') ? <Notifications profile={profile} onNavigate={()=>{}} onUnreadChange={count=>{(window as any).__activityUnread=count;}}/> : mode.startsWith('email-signup') ? <EmailSignupConfirmation email="signup@example.invalid" onConfirmed={()=>{(window as any).__emailCompleted='signup';}}/> : mode.startsWith('email-') ? <EmailAccountSecurity purpose={mode.startsWith('email-device')?'device_confirmation':'password_recovery'} sessionId={mode.startsWith('email-device')?'email-pending-session':undefined} onComplete={message=>{(window as any).__emailCompleted=message;}}/> : mode.startsWith('login-notice') ? <NewLoginAlert profile={profile}/> : mode.startsWith('friends-') ? <FriendsPanel myUserId={profile.user_id}/> : mode.startsWith('host-arrival-') ? <HostArrivalAction stay={{id:'arrival-booking',management_mode_snapshot:'host',responsible_host_user_id:profile.user_id,status:'ready_for_move_in',stay_type:mode.includes('short')?'short_let':'long_let'}} profile={profile}/> : mode.startsWith('management-') ? <PropertyManagementPanel listingId="management-home" profile={profile}/> : mode.startsWith('arrival-') ? <PropertyArrivalInstructions kind="hotel" assetId="42" accountId={profile.user_id}/> : mode.startsWith('documents-') ? <DocumentJourney/> : mode.startsWith('reports-') ? <ReportJourney/> : mode.startsWith('finance-summary') ? <StaffFinanceSummary open={id=>{(window as any).__financeOpened=id;}}/> : mode.startsWith('finance-') ? <StaffFinanceRecords view="payouts" creatorProtected /> : mode.startsWith('payout-') ? <PayoutAccountManager profile={profile} workspace="worker" /> : mode === 'price-controls' ? <PriceControls /> : mode.startsWith('worker-pro') ? <WorkerTools /> : mode.includes('pro-') || mode === 'portfolio-timeout'
    ? <PropertyPartnerProWorkspace profile={profile} /> : mode.startsWith('partner')
      ? <PropertyPartnerFinancePanel profile={profile} /> : <WorkerWallet profile={profile} />}
  <WeHouseToaster />
</main>);
