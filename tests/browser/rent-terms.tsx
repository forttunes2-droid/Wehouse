import { createRoot } from 'react-dom/client';
import LongLetRentTermsPanel from '../../src/components/LongLetRentTermsPanel';
import LongLetBookingAgreement from '../../src/components/LongLetBookingAgreement';
import LaterRentHistory from '../../src/components/LaterRentHistory';
import PartnerRentAccounts from '../../src/components/PartnerRentAccounts';
import { useState } from 'react';
import '../../src/index.css';
document.documentElement.dataset.whTheme=new URLSearchParams(location.search).get('theme')==='light'?'light':'dark';
function Customer(){const [ready,setReady]=useState(false);return <><LongLetBookingAgreement reservationId="rent-agreement-browser" customerId="rent-customer" onSaved={()=>{(window as any).__rentAgreementSaved=true;}} onCanPayChange={setReady}/><button type="button" disabled={!ready} className="mt-4 min-h-12 rounded-xl bg-violet-600 px-4 text-white">Start rent payment</button></>;}
const mode=new URLSearchParams(location.search).get('mode');
const help=()=>{(window as any).__rentHelpOpened=true;};
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-3xl p-4">{mode==='history'?<LaterRentHistory reservationId="rent-agreement-browser" userId="rent-customer" onDiscuss={help}/>:mode==='partner-history'?<PartnerRentAccounts listingId="b7990000-2000-4000-8000-000000000001" userId="rent-owner" onDiscuss={help}/>:mode==='customer'?<Customer/>:<LongLetRentTermsPanel listingId="b7990000-2000-4000-8000-000000000001"/>}</main>);
