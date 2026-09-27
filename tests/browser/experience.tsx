import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import App from '../../src/App';
import CommunicationsWorkspace from '../../src/components/CommunicationsWorkspace';
import { fixtureProfile } from './authFixture';
import '../../src/index.css';
import '../../src/operational-workspaces.css';
import '../../src/worker-discovery-responsive.css';
import '../../src/chat-mobile.css';
const messages = new URLSearchParams(window.location.search).get('fixture') === 'messages';
createRoot(document.getElementById('root')!).render(<StrictMode>
  {messages ? <main className="min-h-screen bg-[#0A0A0F] p-4 text-white"><h1 className="mb-8">Inbox</h1><CommunicationsWorkspace profile={fixtureProfile} scope="all" forcedView="inbox" hideViewTabs queue="all" /></main> : <App />}
  <Toaster />
</StrictMode>);
