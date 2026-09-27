import {createRoot} from 'react-dom/client';
import PropertyManagementPanel from '@/components/PropertyManagementPanel';
import PropertyHostControls from '@/components/PropertyHostControls';
import SecuritySettings from '@/pages/SecuritySettings';
import type {Profile} from '@/types';
const w=window as any;const mode=w.__releaseSix.mode;
const profile={user_id:'owner-a',auth_id:'auth-a',role:mode==='security'?'creator':'property_partner',email:'creator@example.invalid',full_name:'Test Owner',username:'test-owner'} as Profile;
const content=mode==='management'
 ? <><PropertyManagementPanel listingId="11111111-1111-4111-8111-111111111111" profile={profile}/><PropertyHostControls listingId="11111111-1111-4111-8111-111111111111" subType="short_let"/></>
 : <SecuritySettings profile={profile} embedded focus="password"/>;
createRoot(document.getElementById('root')!).render(<main className="mx-auto min-h-screen max-w-2xl bg-[#090B10] p-4 text-white">{content}</main>);
