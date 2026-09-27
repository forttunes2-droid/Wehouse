import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import AccountHelpCenter from '@/components/AccountHelpCenter';
import SupportEntryCard from '@/components/SupportEntryCard';
import SupportChat from '@/components/SupportChat';
import {control} from './supportInboxClientFixture';
const profile:any={user_id:'viewer',role:control.role,username:'viewer',full_name:'Viewer Example',email:'viewer@example.invalid'};
const workspace:any=profile.role==='user'?'personal':profile.role==='hotel_staff'?'hotel':profile.role;
function Fixture(){
 const [page,setPage]=useState<'help'|'inbox'>('help');
 return <><main data-screen={page} className="min-h-screen bg-[#090B10] p-4 text-white">
  {page==='help'?<AccountHelpCenter profile={profile} workspace={workspace} onBack={()=>setPage('inbox')}/>:<><h1 className="text-xl">Inbox</h1><SupportEntryCard profile={profile} compact/><button onClick={()=>setPage('help')}>Open Help</button></>}
  </main><SupportChat profile={profile} onOpenInbox={()=>{history.replaceState({page:'conversation',workspace},'');setPage('inbox')}}/></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
