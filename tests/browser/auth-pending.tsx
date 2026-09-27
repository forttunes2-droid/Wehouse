import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Login from '@/pages/Login';
import type {DeviceRegistration} from '@/lib/supabase';
function Fixture(){
 const [error,setError]=useState('');
 const [pendingDevice,setDevice]=useState<DeviceRegistration|null>(null);
 const test=window as unknown as {__accountError:()=>void;__pendingDevice:()=>void};
 test.__accountError=()=>setError('Your account could not be loaded. Please try again.');
 test.__pendingDevice=()=>setDevice({sessionId:'test-device',newDevice:true,trustStatus:'pending',device:'Test phone',os:'Android',browser:'Chrome',location:'Lafia'});
 return <Login onLoginSuccess={()=>{}} onOpenLegal={()=>{}} serverError={error} pendingDevice={pendingDevice}/>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
