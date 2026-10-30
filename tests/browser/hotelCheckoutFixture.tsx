import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Toaster} from 'sonner';
import HotelBooking from '../../src/pages/HotelBooking';
import {hotelCalendarDay} from '../../src/lib/hotelCheckout';
import '../../src/index.css';
const params=new URLSearchParams(location.search);document.documentElement.dataset.whTheme=params.get('theme')==='dark'?'dark':'light';document.documentElement.classList.toggle('dark',params.get('theme')==='dark');
function Fixture(){const [destination,setDestination]=useState('');const today=new Date().toISOString().slice(0,10);return destination?<h1>{destination}</h1>:<><HotelBooking hotelId={7} roomId={12} ratePlanId={13} checkIn={hotelCalendarDay(today,3)} checkOut={hotelCalendarDay(today,5)} profile={{user_id:'hold-guest',username:'guest-handle',full_name:'Sample Guest',phone:'08000000000'}} onBack={()=>setDestination('Room choices')} onComplete={id=>setDestination(id?`Booking ${id} destination`:'My bookings destination')}/><Toaster/></>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
