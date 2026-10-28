import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Toaster} from 'sonner';
import WorkerDiscovery from '../../src/pages/WorkerDiscovery';
import RoommateBubble from '../../src/components/RoommateMessageBubble';
import {pendingWorkerShare,workerShareMessage} from '../../src/lib/workerShare';
import {parseNavigationRoute} from '../../src/lib/navigationRoute';
import {fixtureProfile} from './authFixture';
import type {Message} from '../../src/types';
import '../../src/index.css';
const id='91000000-0000-4000-8000-000000000001';
const initial=parseNavigationRoute(location.hash)?.params.experienceId||null;
function Fixture(){
 const [target,setTarget]=useState(initial),[destination,setDestination]=useState(''),[draft,setDraft]=useState('');
 function navigate(page:string,ref?:string){
  setDestination(JSON.stringify({page,id:ref}));
  if(page==='experience')setTarget(ref||null);
  if(page==='conversation'||page==='activity'){
   const queued=pendingWorkerShare('customer',ref||'');
   setDraft(queued?workerShareMessage(queued):'');
  }
 }
 return <><main className="bg-[var(--wh-bg)] p-3 text-[var(--wh-text)]">
  <output aria-label="Shared destination">{destination}</output><output aria-label="Prepared activity reference">{draft}</output>
  {([true,false]).map(mine=><section key={String(mine)} aria-label={mine?'Sent activity':'Received activity'}><RoommateBubble mine={mine} msg={{id:mine?'sent':'received',sender_id:mine?'customer':'friend',content:workerShareMessage({id,kind:'experience'}),created_at:'2026-10-28T12:00:00Z'} as Message} onOpenActions={()=>{}} onTapReaction={()=>{}} onReply={()=>{}} onOpenProperty={()=>{}} onOpenExperience={ref=>navigate('experience',ref)}/></section>)}
  </main><WorkerDiscovery profile={{...fixtureProfile,user_id:'customer',role:'user'}} initialExperienceId={target} onInitialExperienceOpened={()=>setTarget(null)} onNavigate={navigate}/><Toaster/></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
