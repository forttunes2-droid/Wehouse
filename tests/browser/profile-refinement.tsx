import {StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Toaster} from 'sonner';
import WorkerPublicProfile from '@/components/WorkerPublicProfile';
import WorkerShowcaseManager from '@/components/WorkerShowcaseManager';
import AccountHelpCenter from '@/components/AccountHelpCenter';
import {state} from './profileRefinementClientFixture';
import '@/index.css';
const w=window as any;
const person=(id:string)=>({user_id:id,full_name:id==='worker-a'?'Sani Example':'Chika Example',username:id==='worker-a'?'sani-carpentry':'chika-fittings',worker_occupation:'Carpenter',worker_skills:['Carpentry'],worker_bio:'Furniture fitting and repairs. Based in Lafia.',worker_status:'verified',worker_verified:true,worker_price:15000,city:'Lafia',state:'Nasarawa',role:'worker'} as any);
function Fixture(){
 const mode=w.__refinementMode||'public';
 const[worker,setWorker]=useState('worker-a'),[open,setOpen]=useState(true);
 w.__switchWorker=()=>setWorker('worker-b');w.__fixtureState=state;
 if(mode==='error'){state.failPosts=true;state.failTrust=true;state.failReviews=true;}
 if(mode==='media-error')state.failMedia=true;
 if(mode==='stale')state.delayWorker='worker-a';
 const publicMode=!['owner','owner-link','help','help-error','help-wrong-user','private'].includes(mode);
 if(mode==='help-error')state.failHelp=true;if(mode==='help-wrong-user')state.wrongAccount=true;
 return <><div className="mx-auto min-h-screen max-w-3xl bg-[#090B10] p-5 text-white"><h1 className="mb-5 text-xl font-semibold">{mode.startsWith('owner')?'Your showcase':'WeHouse'}</h1>
 {open&&(publicMode||mode==='private')&&<WorkerPublicProfile worker={person(worker)} onBack={()=>setOpen(false)} onBook={()=>w.__booked=true} showBookingAction={mode!=='private'} communicationActions={mode==='private'?<button type="button">Call</button>:undefined}/>}
 {mode.startsWith('owner')&&<WorkerShowcaseManager profile={person(worker)} initialPostId={mode==='owner-link'?'worker-a-p26':undefined}/>}
 {mode.startsWith('help')&&<AccountHelpCenter profile={{user_id:'viewer',role:'user'} as any} workspace="personal" onBack={()=>w.__helpBack=true}/>}
 {!open&&<p>Returned to discovery</p>}</div><Toaster theme="dark"/></>;
}
window.addEventListener('openSupportChat',event=>w.__helpEvent=(event as CustomEvent).detail);
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>);
