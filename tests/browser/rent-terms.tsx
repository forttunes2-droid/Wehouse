import { createRoot } from 'react-dom/client';
import LongLetRentTermsPanel from '../../src/components/LongLetRentTermsPanel';
import LongLetBookingAgreement from '../../src/components/LongLetBookingAgreement';
import { useState } from 'react';
import '../../src/index.css';
document.documentElement.dataset.whTheme=new URLSearchParams(location.search).get('theme')==='light'?'light':'dark';
function Customer(){const [ready,setReady]=useState(false);return <><LongLetBookingAgreement reservationId="rent-agreement-browser" customerId="rent-customer" onSaved={()=>{(window as any).__rentAgreementSaved=true;}} onCanPayChange={setReady}/><button type="button" disabled={!ready} className="mt-4 min-h-12 rounded-xl bg-violet-600 px-4 text-white">Start rent payment</button></>;}
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-3xl p-4">{new URLSearchParams(location.search).get('mode')==='customer'?<Customer/>:<LongLetRentTermsPanel listingId="b7990000-2000-4000-8000-000000000001"/>}</main>);
