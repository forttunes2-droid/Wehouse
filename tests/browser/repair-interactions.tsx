import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import HotelBookingChat from '../../src/components/HotelBookingChat';
import ShortLetPaymentReview from '../../src/components/ShortLetPaymentReview';
import NativeSelectBridge from '../../src/components/NativeSelectBridge';
import { useWorkspaceAccess } from '../../src/hooks/useWorkspaceAccess';
import { useDialogInteraction } from '../../src/hooks/useDialogInteraction';
import { createPortal } from 'react-dom';
import { control } from './repairClientFixture';
const actor = {user_id:'qa-viewer',role:'property_partner',full_name:'Hotel Example',username:'hotel-example'} as any;
function WorkspaceFixture(){
 const [profile,setProfile]=useState(false),[clicks,setClicks]=useState(0);
 const workspace=useWorkspaceAccess('qa-viewer');
 (window as any).__workspace=workspace;
 return <main className="p-5 text-white"><h1>Account</h1><p data-testid="active-workspace">{workspace.active}</p><p data-testid="access-state">{workspace.access?'ready':'loading'}</p>
 <button onClick={()=>setProfile(true)}>Open profile</button><button onClick={()=>setClicks(n=>n+1)}>Personal details</button><output>{clicks}</output>
 <button onClick={()=>workspace.setActive('property_partner')}>Select Partner</button><button onClick={()=>workspace.setActive('personal')}>Select Personal</button>
 <button onClick={()=>void workspace.reload()}>Refresh workspaces</button>
 {profile&&<ProfileLayer close={()=>{setProfile(false);workspace.setActive('personal')}}/>}</main>
}
function ProfileLayer({close,inner=false}:{close:()=>void;inner?:boolean}){
 const ref=useDialogInteraction(close);const [child,setChild]=useState(false);
 return createPortal(<div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={inner?'Nested profile':'Profile'} style={{position:'fixed',inset:0,zIndex:inner?100120:100100,background:'#10131b',color:'white',padding:24}}>
 <h2>{inner?'Nested profile':'Profile'}</h2>{inner?<button onClick={close}>Switch workspace</button>:<button onClick={()=>setChild(true)}>Open nested profile</button>}
 <label>Profile filter<select><option>All</option><option>Homes</option></select></label>
 {child&&<ProfileLayer inner close={close}/>}</div>,document.body)
}
function ChatFixture(){
 const [open,setOpen]=useState(true),[booking,setBooking]=useState(1),[revision,setRevision]=useState(0);
 (window as any).__rerender=()=>setRevision(n=>n+1);(window as any).__otherBooking=()=>setBooking(2);(window as any).__close=()=>setOpen(false);
 return <main><p>Underlying Account {revision}</p><button onClick={()=>setOpen(true)}>Open chat</button>{open&&<HotelBookingChat key={booking} bookingId={booking} conversationId={booking===1?'alpha':'beta'} profile={actor} title={booking===1?'Guest Example':'Other guest'} subtitle="Garden Lodge · Deluxe · 24–26 Sep" onClose={()=>setOpen(false)} onUpdated={()=>setRevision(n=>n+1)}/>}</main>
}
const mode=(window as any).__mode;
createRoot(document.getElementById('root')!).render(<StrictMode><NativeSelectBridge/>{['chat','guest-chat'].includes(mode)?<ChatFixture/>:mode==='bill'?<main className="p-6 text-white"><ShortLetPaymentReview row={{stay_type:'short_let',status:'reserved',reservation_fee_status:'paid',manual_payment_status:'paid',reservation_fee_snapshot:10000,short_stay_balance_due_at:new Date(Date.now()+24*60*60*1000).toISOString(),stay_rent_total:240000,security_deposit_snapshot:50000}}/></main>:<WorkspaceFixture/>}</StrictMode>);
void control;
