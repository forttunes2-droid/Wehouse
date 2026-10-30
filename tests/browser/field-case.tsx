import {createRoot} from 'react-dom/client';
import CommunicationsWorkspace from '@/components/CommunicationsWorkspace';
import {conversationId} from './fieldCaseClientFixture';
const profile:any={user_id:'field-a',role:'staff',full_name:'Assigned inspector',username:'inspector',email:'field@example.invalid',assigned_state:'Nasarawa',assigned_lga:'Lafia'};
createRoot(document.getElementById('root')!).render(<main className="min-h-screen bg-[var(--wh-bg)] p-3 text-[var(--wh-text-primary)]"><h1 className="mb-3 text-lg font-semibold">Field Operations</h1><CommunicationsWorkspace profile={profile} scope={{state:'Nasarawa',lga:'Lafia'}} forcedView="inbox" hideViewTabs queue="field_operations" initialConversationId={conversationId}/></main>);
