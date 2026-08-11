import { useState, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react';
import { toast } from 'sonner';
import { useAuth, canCreateListings, isCreator as checkCreator } from '@/hooks/useAuth';
import { CreatorAuthProvider } from '@/hooks/useCreatorAuth';
import { AdminAuthProvider } from '@/hooks/useAdminAuth';
import { getSavedListings, saveListing, unsaveListing, supabase } from '@/lib/supabase';
import CreatorAuthModal from '@/components/CreatorAuthModal';
import AdminAuthModal from '@/components/AdminAuthModal';
import SupportChat from '@/components/SupportChat';
import DesktopLayout from '@/components/DesktopLayout';
import { getNavForRole } from '@/lib/desktop-nav';
import Login from '@/pages/Login';
import Setup from '@/pages/Setup';
import type { NavPage } from '@/types/nav';

const Home = lazy(() => import('@/pages/Home'));
const Search = lazy(() => import('@/pages/Search'));
const Saved = lazy(() => import('@/pages/Saved'));
const ListingDetail = lazy(() => import('@/pages/ListingDetail'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const CreatorDashboard = lazy(() => import('@/pages/CreatorDashboard'));
const AdminDashboard = lazy(() => import('@/pages/AdminDashboard'));
const StaffDashboard = lazy(() => import('@/pages/StaffDashboard'));
const WorkerDashboard = lazy(() => import('@/pages/WorkerDashboard'));
const PropertyPartnerDashboard = lazy(() => import('@/pages/PropertyOwnerDashboard'));
const Roommate = lazy(() => import('@/pages/Roommate'));
const Chat = lazy(() => import('@/pages/Chat'));
const ProfileEdit = lazy(() => import('@/pages/ProfileEdit'));
const AccountCenter = lazy(() => import('@/pages/AccountCenter'));
const PrivacySettings = lazy(() => import('@/pages/PrivacySettings'));
const SecuritySettings = lazy(() => import('@/pages/SecuritySettings'));
const CreateListing = lazy(() => import('@/pages/CreateListing'));
const WorkerSetup = lazy(() => import('@/pages/WorkerSetup'));
const WorkerVerification = lazy(() => import('@/pages/WorkerVerification'));
const WorkerDiscovery = lazy(() => import('@/pages/WorkerDiscovery'));
const WorkerCategories = lazy(() => import('@/pages/WorkerCategories'));
const Activity = lazy(() => import('@/pages/Activity'));
const HotelsHome = lazy(() => import('@/pages/HotelsHome'));
const HotelDetail = lazy(() => import('@/pages/HotelDetail'));
const HotelBooking = lazy(() => import('@/pages/HotelBooking'));
const HotelReservation = lazy(() => import('@/pages/HotelReservation'));
const MyBookings = lazy(() => import('@/pages/MyBookings'));
const MyReservations = lazy(() => import('@/pages/MyReservations'));
const PrivacyPolicyPage = lazy(() => import('@/pages/PrivacyPolicyPage'));
const TermsPage = lazy(() => import('@/pages/TermsPage'));

function PageSkeleton() {
  return <div className="min-h-screen space-y-4 bg-[#0A0A0F] p-5"><div className="h-12 rounded-xl shimmer"/><div className="h-40 rounded-2xl shimmer"/><div className="grid grid-cols-2 gap-3"><div className="h-48 rounded-2xl shimmer"/><div className="h-48 rounded-2xl shimmer"/></div><div className="h-48 rounded-2xl shimmer"/></div>;
}
function ErrorFallback({reset}:{reset:()=>void}) {
  return <div className="flex min-h-screen items-center justify-center bg-[#0A0A0F] px-5"><div className="max-w-sm text-center"><div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg></div><h2 className="mb-2 text-lg font-semibold text-white">Something went wrong</h2><p className="mb-6 text-sm text-[#5C5E72]">The app encountered an error. Please try again.</p><button onClick={reset} className="h-11 rounded-xl bg-[#3B82F6] px-6 text-sm font-semibold text-white hover:bg-[#2563EB]">Reload App</button></div></div>;
}

const NAV_STORAGE_KEY='wh_navpage';
const DETAIL_STORAGE_KEY='wh_detailid';
const RESTORABLE_PAGES:NavPage[]=[
 'home','explore','search','saved','roommate','activity','profile','account','privacy','security',
 'creator','admin','staff_dashboard','worker_dashboard','worker_discovery','worker_categories','worker_verification','worker_setup','worker_wallet',
 'management','analytics','operations','finance','finance_dashboard','field_officer','jobs','calendar','new_listing',
 'hotels','hotel_detail','hotel_booking','hotel_reservation','property_owner','property_partner','my_bookings','my_reservations','messages','wallet','detail','chat','profile_edit','privacy_policy','terms_of_service',
];
function isRestorable(page:string):page is NavPage{return RESTORABLE_PAGES.includes(page as NavPage)}

export default function App(){
 const auth=useAuth();
 const [navPage,setNavPage]=useState<NavPage>('home');
 const [detailId,setDetailId]=useState<string|null>(null);
 const [hotelId,setHotelId]=useState<number|null>(null);
 const [hotelRoomId,setHotelRoomId]=useState<number|null>(null);
 const [hotelCheckIn,setHotelCheckIn]=useState('');
 const [hotelCheckOut,setHotelCheckOut]=useState('');
 const [chatConvId,setChatConvId]=useState<string|null>(null);
 const [workerCategory,setWorkerCategory]=useState<string|null>(null);
 const [savedIds,setSavedIds]=useState<Set<string>>(new Set());
 const [unreadCount,setUnreadCount]=useState(0);
 const [error,setError]=useState<Error|null>(null);
 const profile=auth.profile;
 const userRole=profile?.role||'';
 const isCreatorRole=checkCreator(userRole);
 const isAdminRole=userRole==='admin';
 const isStaffRole=userRole==='staff';
 const isWorkerRole=userRole==='worker';
 const isPropertyPartner=userRole==='property_partner';
 const isUserRole=userRole==='user';
 const canList=canCreateListings(userRole);
 const isCreator=checkCreator(userRole);

 const tabs=useMemo(()=>{
   if(isCreatorRole)return [{id:'creator' as NavPage,label:'Workspace',icon:WorkspaceSvg},{id:'profile' as NavPage,label:'Account',icon:ProfileSvg}];
   if(isAdminRole)return [{id:'admin' as NavPage,label:'Workspace',icon:WorkspaceSvg},{id:'profile' as NavPage,label:'Account',icon:ProfileSvg}];
   if(isStaffRole)return [{id:'staff_dashboard' as NavPage,label:'Workspace',icon:WorkspaceSvg},{id:'profile' as NavPage,label:'Account',icon:ProfileSvg}];
   if(isWorkerRole)return [{id:'worker_dashboard' as NavPage,label:'Workspace',icon:WorkspaceSvg},{id:'profile' as NavPage,label:'Account',icon:ProfileSvg}];
   if(isPropertyPartner)return [{id:'property_partner' as NavPage,label:'Workspace',icon:WorkspaceSvg},{id:'profile' as NavPage,label:'Account',icon:ProfileSvg}];
   return [
     {id:'home' as NavPage,label:'Home',icon:HomeSvg},
     {id:'search' as NavPage,label:'Explore',icon:SearchSvg},
     {id:'saved' as NavPage,label:'Saved',icon:BookmarkSvg},
     {id:'messages' as NavPage,label:'Messages',icon:MessagesSvg},
     {id:'profile' as NavPage,label:'Account',icon:ProfileSvg},
   ];
 },[isCreatorRole,isAdminRole,isStaffRole,isWorkerRole,isPropertyPartner]);

 const restoredRef=useRef(false);
 useEffect(()=>{
   if(auth.isLoading||restoredRef.current)return;
   restoredRef.current=true;
   if(!auth.profile)return;
   let savedPage:NavPage|null=null;
   try{const raw=localStorage.getItem(NAV_STORAGE_KEY);if(raw&&isRestorable(raw))savedPage=raw as NavPage}catch{}
   if(!savedPage)return;
   const role=auth.profile.role;
   let valid=true;
   if(savedPage==='creator'&&!checkCreator(role))valid=false;
   if(savedPage==='admin'&&role!=='admin')valid=false;
   if(savedPage==='staff_dashboard'&&role!=='staff')valid=false;
   if(savedPage==='worker_dashboard'&&role!=='worker')valid=false;
   if((savedPage==='property_owner'||savedPage==='property_partner')&&role!=='property_partner')valid=false;
   if((savedPage==='worker_discovery'||savedPage==='worker_categories')&&role==='worker')valid=false;
   if(savedPage==='roommate'&&role!=='user')valid=false;
   if(valid)setNavPage(savedPage);
 },[auth.isLoading,auth.profile]);

 const hasRestoredRef=useRef(false);
 useEffect(()=>{if(!hasRestoredRef.current){hasRestoredRef.current=true;return}if(isRestorable(navPage))localStorage.setItem(NAV_STORAGE_KEY,navPage);if(detailId)localStorage.setItem(DETAIL_STORAGE_KEY,detailId)},[navPage,detailId]);

 const navHistoryRef=useRef<NavPage[]>(['home']);
 useEffect(()=>{const handlePopState=(e:PopStateEvent)=>{const state=e.state as {page?:NavPage}|null;if(state?.page){setNavPage(state.page);const stack=navHistoryRef.current;if(stack.length>1)navHistoryRef.current=stack.slice(0,-1)}};window.addEventListener('popstate',handlePopState);return()=>window.removeEventListener('popstate',handlePopState)},[]);
 const handleSetNavPage=useCallback((page:NavPage)=>{const currentPage=navHistoryRef.current[navHistoryRef.current.length-1];if(page!==currentPage){window.history.pushState({page},'',`#${page}`);navHistoryRef.current=[...navHistoryRef.current,page]}setNavPage(page);if(isRestorable(page))localStorage.setItem(NAV_STORAGE_KEY,page)},[]);

 useEffect(()=>{const handler=(e:ErrorEvent)=>{setError(e.error);e.preventDefault()};window.addEventListener('error',handler);return()=>window.removeEventListener('error',handler)},[]);
 useEffect(()=>{if(auth.profile?.user_id)getSavedListings(auth.profile.user_id).then(({saved})=>{if(saved)setSavedIds(new Set(saved.map(s=>s.listing_id))}).catch(()=>{})},[auth.profile?.user_id]);
 useEffect(()=>{
   if(!auth.profile?.user_id)return;
   const userId=auth.profile.user_id;
   async function countAllUnread(){const {data:convs}=await supabase.from('conversations').select('participant_a,participant_b,unread_a,unread_b').or(`participant_a.eq.${userId},participant_b.eq.${userId}`);let chatUnread=0;(convs||[]).forEach((c:any)=>{chatUnread+=c.participant_a===userId?(c.unread_a||0):(c.unread_b||0)});const {count:officialUnread}=await supabase.from('announcement_recipients').select('*',{count:'exact',head:true}).eq('user_id',userId).eq('read_status',false);setUnreadCount(chatUnread+(officialUnread||0))}
   void countAllUnread();
   const convChannel=supabase.channel('global-unread-conv').on('postgres_changes',{event:'*',schema:'public',table:'conversations'},()=>{void countAllUnread()}).subscribe();
   const officialChannel=supabase.channel('global-unread-official').on('postgres_changes',{event:'*',schema:'public',table:'announcement_recipients',filter:`user_id=eq.${userId}`},()=>{void countAllUnread()}).subscribe();
   return()=>{supabase.removeChannel(convChannel);supabase.removeChannel(officialChannel)};
 },[auth.profile?.user_id]);

 const handleToggleSave=useCallback(async(listingId:string)=>{if(!auth.profile)return;const userId=auth.profile.user_id;if(savedIds.has(listingId)){await unsaveListing(userId,listingId).catch(()=>{});setSavedIds(prev=>{const n=new Set(prev);n.delete(listingId);return n})}else{await saveListing(userId,listingId).catch(()=>{});setSavedIds(prev=>{const n=new Set(prev);n.add(listingId);return n})}},[auth.profile,savedIds]);
 const goTo=useCallback((page:NavPage,category?:string)=>{if(category)setWorkerCategory(category);handleSetNavPage(page)},[handleSetNavPage]);
 const goToDetail=useCallback((id:string)=>{setDetailId(id);handleSetNavPage('detail')},[handleSetNavPage]);
 const goBack=useCallback(()=>{setDetailId(null);window.history.back()},[]);
 const goToChat=useCallback((convId?:string)=>{setChatConvId(convId||null);handleSetNavPage('chat')},[handleSetNavPage]);
 const goToProfileEdit=useCallback(()=>handleSetNavPage('profile_edit'),[handleSetNavPage]);
 const goToAccount=useCallback(()=>handleSetNavPage('account'),[handleSetNavPage]);
 const goToPrivacy=useCallback(()=>handleSetNavPage('privacy'),[handleSetNavPage]);
 const goToSecurity=useCallback(()=>handleSetNavPage('security'),[handleSetNavPage]);
 const goToNewListing=useCallback(()=>handleSetNavPage('new_listing'),[handleSetNavPage]);
 const goToHotel=useCallback(()=>{setHotelId(null);setHotelRoomId(null);setHotelCheckIn('');setHotelCheckOut('');handleSetNavPage('hotels')},[handleSetNavPage]);
 const goToHotelDetail=useCallback((id:number)=>{setHotelId(id);setHotelRoomId(null);setHotelCheckIn('');setHotelCheckOut('');handleSetNavPage('hotel_detail')},[handleSetNavPage]);
 const goToHotelBooking=useCallback((hId:number,rId:number,checkIn?:string,checkOut?:string)=>{setHotelId(hId);setHotelRoomId(rId);setHotelCheckIn(checkIn||'');setHotelCheckOut(checkOut||'');handleSetNavPage('hotel_booking')},[handleSetNavPage]);
 const goToHotelReservation=useCallback((hId:number,rId:number)=>{setHotelId(hId);setHotelRoomId(rId);setHotelCheckIn('');setHotelCheckOut('');handleSetNavPage('hotel_reservation')},[handleSetNavPage]);

 if(auth.isLoading)return <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0A0A0F]"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3B82F6] border-t-transparent"/><p className="text-sm text-[#5C5E72]">Loading WeHouse...</p></div>;
 if(auth.page==='login')return <Login onLoginSuccess={auth.handleLoginSuccess} serverError={auth.error} kickedOut={auth.kickedOut}/>;
 if(auth.page==='setup'&&auth.profile)return <Setup profile={auth.profile} onSetupComplete={auth.handleSetupComplete}/>;
 if(auth.page==='worker_setup'&&auth.profile)return <WorkerSetup profile={auth.profile} onComplete={()=>auth.handleSetupComplete(auth.profile!)}/>;
 if(error)return <ErrorFallback reset={()=>{setError(null);window.location.reload()}}/>;

 const renderCanonicalWorkspace=()=>{
   if(!profile)return null;
   if(isCreatorRole)return <CreatorDashboard profile={profile} onLogout={auth.logout} onGoToNewListing={goToNewListing} onNavigate={p=>goTo(p as NavPage)} onGoToChat={goToChat}/>;
   if(isAdminRole)return <AdminDashboard profile={profile} onLogout={auth.logout} onNavigate={p=>goTo(p as NavPage)} onGoToChat={goToChat}/>;
   if(isStaffRole)return <StaffDashboard profile={profile} onLogout={auth.logout} onNavigate={p=>goTo(p as NavPage)} onGoToChat={goToChat}/>;
   if(isWorkerRole)return <WorkerDashboard profile={profile} onGoToSetup={()=>goTo('worker_setup')} onLogout={auth.logout} onNavigate={p=>goTo(p as NavPage)} onGoToChat={id=>goToChat(id)}/>;
   if(isPropertyPartner)return <PropertyPartnerDashboard profile={profile} onLogout={auth.logout} onNavigate={p=>goTo(p as NavPage)} onGoToChat={goToChat}/>;
   return null;
 };

 const renderPage=()=>{
   if(navPage==='privacy_policy')return <PrivacyPolicyPage/>;
   if(navPage==='terms_of_service')return <TermsPage/>;
   if(!profile)return <Login onLoginSuccess={auth.handleLoginSuccess} serverError={auth.error}/>;
   const props={profile,savedIds,onToggleSave:handleToggleSave};
   switch(navPage){
     case 'home': {
       const workspace=renderCanonicalWorkspace();
       if(workspace)return workspace;
       return <Home {...props} onNavigate={(p:string,id?:string)=>id?goToDetail(id):goTo(p as NavPage)} isAdmin={canList} onGoToNewListing={goToNewListing}/>;
     }
     case 'creator': return isCreatorRole?renderCanonicalWorkspace():<Home {...props} onNavigate={(p:string,id?:string)=>id?goToDetail(id):goTo(p as NavPage)}/>;
     case 'admin': return isAdminRole?renderCanonicalWorkspace():<Home {...props} onNavigate={(p:string,id?:string)=>id?goToDetail(id):goTo(p as NavPage)}/>;
     case 'staff_dashboard': return isStaffRole?renderCanonicalWorkspace():<Home {...props} onNavigate={(p:string,id?:string)=>id?goToDetail(id):goTo(p as NavPage)}/>;
     case 'worker_dashboard': return isWorkerRole?renderCanonicalWorkspace():<Home {...props} onNavigate={(p:string,id?:string)=>id?goToDetail(id):goTo(p as NavPage)}/>;
     case 'property_owner':
     case 'property_partner': return isPropertyPartner?renderCanonicalWorkspace():<Home {...props} onNavigate={(p:string,id?:string)=>id?goToDetail(id):goTo(p as NavPage)}/>;
     case 'management':
     case 'analytics':
     case 'operations':
     case 'field_officer':
     case 'finance':
     case 'finance_dashboard':
     case 'jobs':
     case 'calendar':
     case 'worker_wallet':
     case 'wallet': {
       const workspace=renderCanonicalWorkspace();
       if(workspace)return workspace;
       return <Home {...props} onNavigate={(p:string,id?:string)=>id?goToDetail(id):goTo(p as NavPage)}/>;
     }
     case 'explore':
     case 'search': return <Search onNavigate={(p:string,id?:string)=>id?goToDetail(id):goTo(p as NavPage)} savedIds={savedIds} onToggleSave={handleToggleSave}/>;
     case 'saved': return <Saved {...props} onNavigate={(p:string,id?:string)=>id?goToDetail(id):goTo(p as NavPage)}/>;
     case 'roommate':
       if(!isUserRole){toast.error('Roommate matching is only available for regular users');handleSetNavPage('home');return null}
       return <Roommate profile={profile}/>;
     case 'activity': return <Activity profile={profile} onNavigate={(p:string,id?:string)=>id?goToDetail(id):goTo(p as NavPage)} onGoToChat={goToChat}/>;
     case 'profile': return <Dashboard profile={profile} onLogout={auth.logout} onGoToProfileEdit={goToProfileEdit} onGoToAccount={goToAccount}/>;
     case 'account': return <AccountCenter profile={profile} onBack={()=>goTo('profile')} onGoToPrivacy={goToPrivacy} onGoToSecurity={goToSecurity} onGoToProfileEdit={goToProfileEdit}/>;
     case 'privacy': return <PrivacySettings profile={profile} onUpdate={u=>auth.handleSetupComplete(u)} onBack={()=>goTo('account')}/>;
     case 'security': return <SecuritySettings profile={profile} onBack={()=>goTo('account')}/>;
     case 'profile_edit':
       if(profile.role==='staff')return <div className="flex min-h-screen items-center justify-center px-5"><div className="max-w-sm text-center"><h2 className="text-lg font-semibold text-white">Profile managed by Admin</h2><p className="mt-2 text-sm text-[#8A8B9C]">Staff profile changes are handled through authorized Admin or Creator workflows.</p><button onClick={()=>goTo('profile')} className="mt-6 h-11 rounded-xl bg-[#3B82F6] px-6 text-sm font-semibold text-white">Back to Account</button></div></div>;
       return <ProfileEdit profile={profile} onUpdate={u=>auth.handleSetupComplete(u)} onBack={()=>goTo('profile')}/>;
     case 'detail': return detailId?<ListingDetail listingId={detailId} onNavigate={goBack} isSaved={savedIds.has(detailId)} onToggleSave={()=>handleToggleSave(detailId)} profile={profile} onGoToChat={goToChat}/>:null;
     case 'chat': return <Chat profile={profile} onNavigate={p=>goTo(p as NavPage)} conversationId={chatConvId}/>;
     case 'messages': {
       if(!isUserRole){const workspace=renderCanonicalWorkspace();if(workspace)return workspace}
       return <Chat profile={profile} onNavigate={p=>goTo(p as NavPage)}/>;
     }
     case 'new_listing':
       if(!canList){handleSetNavPage('home');return null}
       return <CreateListing profile={profile} onBack={()=>goTo('home')} onSuccess={()=>goTo('home')}/>;
     case 'worker_discovery': return <WorkerDiscovery userCity={profile.city} profile={profile} preSelectedCategory={workerCategory} onNavigate={p=>goTo(p as NavPage)}/>;
     case 'worker_categories': return <WorkerCategories onNavigate={p=>goTo(p as NavPage)} profile={profile}/>;
     case 'worker_setup': return <WorkerSetup profile={profile} onComplete={()=>goTo('worker_dashboard')}/>;
     case 'worker_verification': return <WorkerVerification profile={profile} onBack={()=>goTo('worker_dashboard')}/>;
     case 'hotels': return <HotelsHome onNavigate={(p:string,id?:string)=>p==='hotel_detail'&&id?goToHotelDetail(Number(id)):goTo(p as NavPage)}/>;
     case 'hotel_detail': return hotelId?<HotelDetail hotelId={hotelId} onBack={goToHotel} onBook={goToHotelBooking} onReserve={goToHotelReservation} profile={profile}/>:null;
     case 'hotel_booking': return hotelId&&hotelRoomId?<HotelBooking hotelId={hotelId} roomId={hotelRoomId} checkIn={hotelCheckIn} checkOut={hotelCheckOut} profile={profile} onBack={()=>handleSetNavPage('hotel_detail')} onComplete={goToHotel}/>:null;
     case 'hotel_reservation': return hotelId&&hotelRoomId?<HotelReservation hotelId={hotelId} roomId={hotelRoomId} profile={profile} onBack={()=>handleSetNavPage('hotel_detail')} onProceedToBooking={(hId,rId)=>goToHotelBooking(hId,rId)} onComplete={goToHotel}/>:null;
     case 'my_bookings':
       if(profile.role!=='user'&&profile.role!=='worker'){handleSetNavPage('home');return null}
       return <MyBookings profile={profile} onBack={()=>goTo('profile')}/>;
     case 'my_reservations':
       if(profile.role!=='user'&&profile.role!=='worker'){handleSetNavPage('home');return null}
       return <MyReservations profile={profile} onBack={()=>goTo('profile')}/>;
     default: return <Home {...props} onNavigate={(p:string,id?:string)=>id?goToDetail(id):goTo(p as NavPage)}/>;
   }
 };

 const desktopNavItems=getNavForRole(userRole,unreadCount);
 const hideBottomNavPages:NavPage[]=['detail','chat','profile_edit','account','privacy','security','new_listing','worker_setup','worker_verification','hotel_detail','hotel_booking','hotel_reservation','worker_discovery'];
 const showBottomNav=!hideBottomNavPages.includes(navPage);

 return <CreatorAuthProvider><AdminAuthProvider><Suspense fallback={<PageSkeleton/>}><DesktopLayout navItems={desktopNavItems} activePage={navPage} onNavigate={goTo} userName={profile?.full_name||profile?.username||undefined} userRole={profile?.role||undefined} userAvatar={profile?.avatar_url||undefined} onLogout={auth.logout}><div className="page-transition min-h-[100dvh] overflow-y-auto bg-[#0A0A0F] scrollable-content">{renderPage()}</div></DesktopLayout>{isCreator&&<CreatorAuthModal/>}{(isAdminRole||isStaffRole)&&<AdminAuthModal/>}{profile?.role==='user'&&<SupportChat profile={{user_id:profile.user_id,username:profile.username,email:profile.email,role:profile.role}}/>}<div className="lg:hidden">{showBottomNav&&<nav className="bottom-nav fixed bottom-0 left-0 right-0 z-50"><div className={`mx-auto flex max-w-lg items-center py-1 ${tabs.length<=2?'justify-center gap-12':'justify-around'}`}>{tabs.map(tab=>{const active=navPage===tab.id;return <button key={tab.id} onClick={()=>goTo(tab.id)} className={`relative flex min-w-[64px] flex-col items-center gap-0.5 rounded-xl px-3 py-2 transition-all ${active?'text-[#3B82F6]':'text-[#5C5E72]'}`}><tab.icon size={22} active={active}/><span className="text-[9px] font-medium leading-none">{tab.label}</span>{active&&<span className="mt-0.5 h-1 w-1 rounded-full bg-[#3B82F6]"/>}{tab.id==='messages'&&unreadCount>0&&<span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white">{unreadCount>9?'9+':unreadCount}</span>}</button>})}</div></nav>}</div></Suspense></AdminAuthProvider></CreatorAuthProvider>;
}

function HomeSvg({size,active}:{size:number;active:boolean}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active?'#3B82F6':'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>}
function WorkspaceSvg({size,active}:{size:number;active:boolean}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active?'#3B82F6':'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>}
function SearchSvg({size,active}:{size:number;active:boolean}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active?'#3B82F6':'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>}
function BookmarkSvg({size,active}:{size:number;active:boolean}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active?'#3B82F6':'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>}
function MessagesSvg({size,active}:{size:number;active:boolean}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active?'#3B82F6':'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>}
function ProfileSvg({size,active}:{size:number;active:boolean}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active?'#3B82F6':'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
