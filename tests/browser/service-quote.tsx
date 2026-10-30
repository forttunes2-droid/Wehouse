import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import BookingNegotiationChat from '../../src/components/BookingNegotiationChat';
import type {Profile} from '../../src/types';
import '../../src/index.css';
document.documentElement.dataset.whTheme=new URLSearchParams(location.search).get('theme')==='light'?'light':'dark';
function Fixture(){
 const [customer,setCustomer]=useState('quote-customer');
 (window as any).__switchQuoteCustomer=()=>setCustomer('other-customer');
 return <BookingNegotiationChat conversationId="quote-conversation" bookingId="quote-booking" profile={{user_id:customer,auth_id:'95300000-0000-4000-8000-000000000001',full_name:'Customer',username:'customer',role:'user'} as Profile} isWorker={false} onClose={()=>{}}/>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
