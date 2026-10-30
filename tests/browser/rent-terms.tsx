import { createRoot } from 'react-dom/client';
import LongLetRentTermsPanel from '../../src/components/LongLetRentTermsPanel';
import LongLetBookingAgreement from '../../src/components/LongLetBookingAgreement';
import LaterRentHistory from '../../src/components/LaterRentHistory';
import PartnerRentAccounts from '../../src/components/PartnerRentAccounts';
import ErrorBoundary from '../../src/components/ErrorBoundary';
import AdminSecurityCases from '../../src/components/AdminSecurityCases';
import SignedOutAccountHelp from '../../src/components/SignedOutAccountHelp';
import ReportDialog from '../../src/components/ReportDialog';
import ReportListingDialog from '../../src/components/ReportListingDialog';
import MyReports from '../../src/components/MyReports';
import SharedHousingDetails from '../../src/components/SharedHousingDetails';
import sharedRentFixture from './shared-rent-fixtures.json';
import AdminReports from '../../src/components/AdminReports';
import { Toaster } from 'sonner';
import { useState } from 'react';
import '../../src/index.css';
document.documentElement.dataset.whTheme=new URLSearchParams(location.search).get('theme')==='light'?'light':'dark';
document.documentElement.classList.toggle('dark',document.documentElement.dataset.whTheme==='dark');
document.documentElement.style.colorScheme=document.documentElement.dataset.whTheme;
function Customer(){const [ready,setReady]=useState(false);return <><LongLetBookingAgreement reservationId="rent-agreement-browser" customerId="rent-customer" onSaved={()=>{(window as any).__rentAgreementSaved=true;}} onCanPayChange={setReady}/><button type="button" disabled={!ready} className="mt-4 min-h-12 rounded-xl bg-violet-600 px-4 text-white">Start rent payment</button></>;}
const mode=new URLSearchParams(location.search).get('mode');
const help=()=>{(window as any).__rentHelpOpened=true;};
function Crash():never{throw Error(mode==='error-chunk'?'Failed to fetch dynamically imported module: synthetic-private-path':'Synthetic private database detail');}
function Reports(){
 const [closed,setClosed]=useState(false);
 return <><Toaster/><main className="mx-auto max-w-3xl p-4 text-[var(--wh-text)]">{mode==='reports-history'?<MyReports/>:mode==='reports-admin'?<AdminReports/>:closed?<p>Report form closed</p>:mode==='reports-generic'?<ReportDialog subjectType="profile" subjectUserId="sample" subjectName="Sample profile" onClose={()=>setClosed(true)}/>:<ReportListingDialog targetType={mode==='reports-hotel'?'hotel':'listing'} listingId={mode==='reports-hotel'?'42':'sample-listing'} listingTitle="Sample listing" onClose={()=>setClosed(true)} onUrgentSafety={()=>{}}/>}</main></>;
}
function SharedRent(){return mode==='shared-rent-partner'?<PartnerRentAccounts listingId="b7990000-2000-4000-8000-000000000001" userId="rent-owner" onDiscuss={help}/>:<SharedHousingDetails groupId={sharedRentFixture.offer.group_id} userId={mode==='shared-rent-peer'?'rent-outsider':'rent-customer'} onBack={()=>{(window as any).__sharedBack=true;}} onChanged={()=>{(window as any).__sharedChanged=((window as any).__sharedChanged||0)+1;}}/>;}
createRoot(document.getElementById('root')!).render(mode?.startsWith('reports-')?<Reports/>:mode?.startsWith('error-')?<ErrorBoundary><Crash/></ErrorBoundary>:<main className="mx-auto max-w-3xl p-4 text-[var(--wh-text)]">{mode?.startsWith('shared-rent-')?<SharedRent/>:mode==='security-cases'?<AdminSecurityCases/>:mode==='account-help'?<SignedOutAccountHelp/>:mode==='history'?<LaterRentHistory reservationId="rent-agreement-browser" userId="rent-customer" onDiscuss={help}/>:mode==='partner-history'?<PartnerRentAccounts listingId="b7990000-2000-4000-8000-000000000001" userId="rent-owner" onDiscuss={help}/>:mode==='customer'?<Customer/>:<LongLetRentTermsPanel listingId="b7990000-2000-4000-8000-000000000001"/>}</main>);
